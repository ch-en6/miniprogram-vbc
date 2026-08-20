// 云函数 - 员工报餐读写（@cloudbase/node-sdk 访问云 MySQL meal_order 表）
//
// 数据模型说明（与 book 页面契约对齐）：
//   后端按 "每人每天每餐次 = 一行" 存储；
//   前端 book 页面按 "每天三餐聚合" 展示（{ date, breakfast, lunch, dinner }）。
//   聚合/拆分都在本函数内完成，book 页面只看到聚合形态。
//
const cloud = require('wx-server-sdk')
const cloudbaseSDK = require('@cloudbase/node-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const cloudbase = cloudbaseSDK.init({
  env: cloudbaseSDK.SYMBOL_CURRENT_ENV
})
const models = cloudbase.models

// meal_type 数值 -> 前端餐次字符串（与 getPriceConfig 保持一致）
const MEAL_TYPE_NAME = {
  0: 'breakfast',
  1: 'lunch',
  2: 'dinner',
}

// 前端餐次字符串 -> meal_type 数值
const NAME_TO_MEAL_TYPE = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
}

// 餐次列表（用于遍历 save 时的三次插入/更新/删除）
const MEAL_NAMES = ['breakfast', 'lunch', 'dinner']

/**
 * 执行 SQL 查询（预编译模式，参数用 {{key}} 绑定，防 SQL 注入）
 */
async function query(sql, params = {}) {
  console.log('[mealOrder][DEBUG] $runSQL SELECT ->', sql)
  console.log('[mealOrder][DEBUG] $runSQL SELECT params ->', JSON.stringify(params))
  try {
    const result = await models.$runSQL(sql, params)
    return (result && result.data && result.data.executeResultList) || []
  } catch (err) {
    console.error(
      '[mealOrder][DEBUG] $runSQL SELECT FAILED:',
      err.message || err,
      '\nSQL:', sql,
      '\nPARAMS:', JSON.stringify(params)
    )
    throw err
  }
}

/**
 * 执行 SQL 写操作
 * @returns {Promise<number>} 受影响行数
 */
async function update(sql, params = {}) {
  console.log('[mealOrder][DEBUG] $runSQL WRITE ->', sql)
  console.log('[mealOrder][DEBUG] $runSQL WRITE params ->', JSON.stringify(params))
  try {
    const result = await models.$runSQL(sql, params)
    return (result && result.data && result.data.total) || 0
  } catch (err) {
    console.error(
      '[mealOrder][DEBUG] $runSQL WRITE FAILED:',
      err.message || err,
      '\nSQL:', sql,
      '\nPARAMS:', JSON.stringify(params)
    )
    throw err
  }
}

/**
 * 将任意日期值规范化为 YYYY-MM-DD 字符串
 */
function ymd(val) {
  if (!val) return ''
  if (typeof val === 'string') {
    // 兼容 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm:ss' 等
    const m = val.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) {
      return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
    }
  }
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val)
  const pad = n => (n < 10 ? '0' + n : n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 给定月份，返回起止日期字符串 [start, end]
 * @param {number} year
 * @param {number} month1 - 1-based 月份
 */
function monthRange(year, month1) {
  const pad = n => (n < 10 ? '0' + n : n)
  const start = `${year}-${pad(month1)}-01`
  const lastDay = new Date(year, month1, 0).getDate()
  const end = `${year}-${pad(month1)}-${pad(lastDay)}`
  return { start, end }
}

// ──────────────────────────────────────────────────────────────────
// Action: getMonth
//   入参：{ emp_id: number, month: 'YYYY-MM' }
//   出参：[{ date, breakfast, lunch, dinner }]，每天最多一条
// ──────────────────────────────────────────────────────────────────
async function actionGetMonth(event) {
  const { emp_id, month } = event
  if (!emp_id || !month) {
    return { code: -1, message: '缺少参数 emp_id/month', data: null }
  }
  const m = String(month).match(/^(\d{4})-(\d{1,2})$/)
  if (!m) {
    return { code: -1, message: 'month 参数格式应为 YYYY-MM', data: null }
  }
  const year = Number(m[1])
  const month1 = Number(m[2])
  const { start, end } = monthRange(year, month1)

  const rows = await query(
    'SELECT * FROM `meal_order` ' +
    'WHERE `emp_id` = {{emp_id}} ' +
    '  AND `date` BETWEEN {{start}} AND {{end}} ' +
    '  AND `quantity` > 0 ' +
    'ORDER BY `date` ASC, `meal_type` ASC',
    { emp_id, start, end }
  )

  // 按 date 聚合为 { date, breakfast, lunch, dinner }
  const byDate = new Map()
  rows.forEach(r => {
    const date = ymd(r.date)
    if (!byDate.has(date)) {
      byDate.set(date, { date, breakfast: 0, lunch: 0, dinner: 0 })
    }
    const bucket = byDate.get(date)
    const name = MEAL_TYPE_NAME[r.meal_type]
    if (name) bucket[name] = Number(r.quantity) || 0
  })

  return { code: 0, message: 'success', data: Array.from(byDate.values()) }
}

// ──────────────────────────────────────────────────────────────────
// Action: save
//   入参：{
//     emp_id, date, breakfast, lunch, dinner,
//     dept_id, location_id, openid
//   }
//   语义：
//     - 数量 > 0：upsert 该 (emp_id, date, meal_type) 行；写入价格快照
//     - 数量 = 0：删除该 (emp_id, date, meal_type) 行
// ──────────────────────────────────────────────────────────────────
async function actionSave(event) {
  const wxContext = cloud.getWXContext() || {}
  const openidFromCtx = wxContext.OPENID || ''

  const emp_id = Number(event.emp_id) || 0
  const date = ymd(event.date)
  const dept_id = Number(event.dept_id) || 0
  const location_id = event.location_id == null ? null : Number(event.location_id)
  const _openid = openidFromCtx || event._openid

  if (!emp_id || !date) {
    return { code: -1, message: '缺少参数 emp_id/date', data: null }
  }
  if (!dept_id) {
    return { code: -1, message: '缺少部门ID，无法加载价格', data: null }
  }

  const quantities = {
    breakfast: Number(event.breakfast) || 0,
    lunch: Number(event.lunch) || 0,
    dinner: Number(event.dinner) || 0,
  }

  // 1. 加载该部门当日启用的价格（按 meal_type 取当前生效记录）
  const priceRows = await query(
    'SELECT `meal_type`, `emp_price`, `family_price` FROM `price_config` ' +
    'WHERE `dept_id` = {{dept_id}} AND `status` = 1 ' +
    'AND `start_date` <= CURDATE() AND `end_date` >= CURDATE()',
    { dept_id}
  )
  const priceMap = new Map()
  priceRows.forEach(r => {
    priceMap.set(Number(r.meal_type), {
      emp_price: Number(r.emp_price) || 100,
      family_price: Number(r.family_price) || 1000,
    })
  })

  // 2. 加载该员工当天的现有记录（避免重复查询）
  //    注意：参数名不能用 date（与 SQL 保留字 DATE 冲突，SDK 解析失败），用 day 代替
  const existingRows = await query(
    'SELECT `id`, `meal_type` FROM `meal_order` ' +
    'WHERE `emp_id` = {{emp_id}} AND `date` = {{day}}',
    { emp_id, day: date }
  )
  const existingMap = new Map()
  existingRows.forEach(r => existingMap.set(Number(r.meal_type), r))

  const summary = { inserted: 0, updated: 0, deleted: 0 }

  // 3. 逐个 meal_type 处理
  for (const name of MEAL_NAMES) {
    const meal_type = NAME_TO_MEAL_TYPE[name]
    const quantity = quantities[name]
    const exists = existingMap.has(meal_type)
    const price = priceMap.get(meal_type) || { emp_price: 100, family_price: 1000 }

    if (quantity === 0) {
      // 数量为 0 → 删除（保留历史行为一致；如需审计可改为设置 verified_status）
      if (exists) {
        await update(
          'DELETE FROM `meal_order` WHERE `id` = {{id}}',
          { id: existingMap.get(meal_type).id }
        )
        summary.deleted += 1
      }
      continue
    }

    if (exists) {
      // 更新现有记录
      await update(
        'UPDATE `meal_order` SET ' +
        '  `quantity`     = {{quantity}}, ' +
        '  `location_id`  = {{location_id}}, ' +
        '  `emp_price`    = {{emp_price}}, ' +
        '  `family_price` = {{family_price}}, ' +
        '  `submitted_at` = NOW(), ' +
        '  `updated_at`   = NOW() ' +
        'WHERE `id` = {{id}}',
        {
          id: existingMap.get(meal_type).id,
          quantity,
          location_id,
          emp_price: price.emp_price,
          family_price: price.family_price,
        }
      )
      summary.updated += 1
    } else {
      // 新增
      await update(
        'INSERT INTO `meal_order` ' +
        '(`emp_id`, `date`, `meal_type`, `quantity`, `location_id`, ' +
        ' `submitted_at`, `verified_status`, `created_at`, `updated_at`, ' +
        ' `_openid`, `emp_price`, `family_price`) ' +
        'VALUES ' +
        '({{emp_id}}, {{day}}, {{meal_type}}, {{quantity}}, {{location_id}}, ' +
        ' NOW(), 0, NOW(), NOW(), ' +
        ' {{_openid}}, {{emp_price}}, {{family_price}})',
        {
          emp_id,
          day: date,
          meal_type,
          quantity,
          location_id,
          _openid,
          emp_price: price.emp_price,
          family_price: price.family_price,
        }
      )
      summary.inserted += 1
    }
  }

  return { code: 0, message: 'success', data: summary }
}

// ──────────────────────────────────────────────────────────────────
// Action: remove
//   入参：{ emp_id, date }
//   删除该员工当天的全部 meal_order 行
// ──────────────────────────────────────────────────────────────────
async function actionRemove(event) {
  const emp_id = Number(event.emp_id) || 0
  const date = ymd(event.date)
  if (!emp_id || !date) {
    return { code: -1, message: '缺少参数 emp_id/date', data: null }
  }
  const affected = await update(
    'DELETE FROM `meal_order` WHERE `emp_id` = {{emp_id}} AND `date` = {{day}}',
    { emp_id, day: date }
  )
  return { code: 0, message: 'success', data: { removed: affected } }
}

// ──────────────────────────────────────────────────────────────────
// 兼容 kitchen 工作台 action（services/api.js KitchenAPI 仍引用）
// 当前任务（book 页面）不涉及；返回空数据以避免云函数 not found。
// ──────────────────────────────────────────────────────────────────
async function actionKitchenStub() {
  return { code: 0, message: 'success', data: [] }
}

// ──────────────────────────────────────────────────────────────────
// 入口
// ──────────────────────────────────────────────────────────────────
exports.main = async (event, context) => {
  const { action } = event || {}
  try {
    switch (action) {
      case 'getMonth':         return await actionGetMonth(event)
      case 'save':             return await actionSave(event)
      case 'remove':           return await actionRemove(event)
      case 'getKitchenSummary':
      case 'getKitchenDetail':
      case 'searchByName':
      case 'searchByPhone':    return await actionKitchenStub()
      default:
        return { code: -1, message: `未知 action: ${action}`, data: null }
    }
  } catch (err) {
    console.error('[mealOrder] error:', err)
    return { code: -1, message: '服务器错误: ' + (err.message || err), data: null }
  }
}
