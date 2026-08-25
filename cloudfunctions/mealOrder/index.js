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

/**
 * 通过 openid 反查员工身份（防水平越权核心）
 * 员工 ID / 部门 / 食堂一律以服务端为准，不信任前端传入的 emp_id/dept_id/location_id。
 * @param {string} openid - 云函数上下文中的 OPENID（不可伪造）
 * @returns {Promise<{emp_id: number, dept_id: number, location_id: number|null} | null>}
 */
async function resolveEmpIdentity(openid) {
  if (!openid) return null
  const emps = await query(
    'SELECT `id`, `dept_id` FROM `sys_emp` WHERE `_openid` = {{openid}} LIMIT 1',
    { openid }
  )
  if (!emps.length) return null
  const emp = emps[0]
  const identity = {
    emp_id: Number(emp.id) || 0,
    dept_id: Number(emp.dept_id) || 0,
    location_id: null,
  }
  if (identity.dept_id) {
    const depts = await query(
      'SELECT `location_id` FROM `sys_dept` WHERE `id` = {{dept_id}} LIMIT 1',
      { dept_id: identity.dept_id }
    )
    if (depts.length && depts[0].location_id != null) {
      identity.location_id = Number(depts[0].location_id)
    }
  }
  return identity
}

// ──────────────────────────────────────────────────────────────────
// Action: getRange
//   入参：{ startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }（emp_id 忽略，身份由 openid 反查）
//   出参：[{ date, breakfast, lunch, dinner,
//            breakfast_emp_price, breakfast_family_price,
//            lunch_emp_price, lunch_family_price,
//            dinner_emp_price, dinner_family_price,
//            submitted_at }]，每天最多一条
// ──────────────────────────────────────────────────────────────────
async function actionGetRange(event) {
  const { startDate, endDate } = event
  if (!startDate || !endDate) {
    return { code: -1, message: '缺少参数 startDate/endDate', data: null }
  }

  // 员工身份一律以 openid 反查为准，忽略前端传入的 emp_id，防止越权查看他人记录
  const wxContext = cloud.getWXContext() || {}
  const identity = await resolveEmpIdentity(wxContext.OPENID || '')
  if (!identity) {
    return { code: -1, message: '登录状态失效，请重新登录', data: null }
  }
  const emp_id = identity.emp_id

  // 时间区间校验：格式、开始 ≤ 结束、跨度上限（与前端保持一致，防止绕过前端直接调用）
  const MAX_RANGE_DAYS = 183
  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
    return { code: -1, message: '日期格式应为 YYYY-MM-DD', data: null }
  }
  if (startDate > endDate) {
    return { code: -1, message: '开始日期不能晚于结束日期', data: null }
  }
  const s = startDate.split('-').map(Number)
  const e = endDate.split('-').map(Number)
  const spanDays = Math.round(
    (new Date(e[0], e[1] - 1, e[2]) - new Date(s[0], s[1] - 1, s[2])) / 86400000
  ) + 1
  if (spanDays > MAX_RANGE_DAYS) {
    return { code: -1, message: '查询区间不能超过半年', data: null }
  }

  const rows = await query(
    'SELECT `meal_date`, `meal_type`, `quantity`, `emp_price`, `family_price`, ' +
    '       `submitted_at` ' +
    'FROM `meal_order` ' +
    'WHERE `emp_id` = {{emp_id}} ' +
    '  AND `meal_date` BETWEEN {{startDate}} AND {{endDate}} ' +
    '  AND `quantity` > 0 ' +
    'ORDER BY `meal_date` ASC, `meal_type` ASC',
    { emp_id, startDate, endDate }
  )

  // 按 meal_date 聚合为前端契约格式，同时保留每餐次的价格快照
  const byDate = new Map()
  rows.forEach(r => {
    const date = ymd(r.meal_date)
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        breakfast: 0, lunch: 0, dinner: 0,
        breakfast_emp_price: 0, breakfast_family_price: 0,
        lunch_emp_price: 0, lunch_family_price: 0,
        dinner_emp_price: 0, dinner_family_price: 0,
        submitted_at: '',
      })
    }
    const bucket = byDate.get(date)
    const name = MEAL_TYPE_NAME[r.meal_type]
    if (name) {
      bucket[name] = Number(r.quantity) || 0
      bucket[`${name}_emp_price`] = Number(r.emp_price) || 0
      bucket[`${name}_family_price`] = Number(r.family_price) || 0
    }
    // 保留该日期最新的 submitted_at 作为最后提交时间展示
    const t = r.submitted_at || ''
    if (t && String(t) > String(bucket.submitted_at)) {
      bucket.submitted_at = t
    }
  })

  return { code: 0, message: 'success', data: Array.from(byDate.values()) }
}

// ──────────────────────────────────────────────────────────────────
// Action: getMonth
//   入参：{ month: 'YYYY-MM' }（emp_id 忽略，身份由 openid 反查）
//   出参：[{ date, breakfast, lunch, dinner }]，每天最多一条
// ──────────────────────────────────────────────────────────────────
async function actionGetMonth(event) {
  const { month } = event
  if (!month) {
    return { code: -1, message: '缺少参数 month', data: null }
  }

  // 员工身份以 openid 反查为准，忽略前端传入的 emp_id，防止越权查看他人记录
  const wxContext = cloud.getWXContext() || {}
  const identity = await resolveEmpIdentity(wxContext.OPENID || '')
  if (!identity) {
    return { code: -1, message: '登录状态失效，请重新登录', data: null }
  }
  const emp_id = identity.emp_id
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
    '  AND `meal_date` BETWEEN {{start}} AND {{end}} ' +
    '  AND `quantity` > 0 ' +
    'ORDER BY `meal_date` ASC, `meal_type` ASC',
    { emp_id, start, end }
  )

  // 按 meal_date 聚合为 { date, breakfast, lunch, dinner }
  const byDate = new Map()
  rows.forEach(r => {
    const date = ymd(r.meal_date)
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
//   入参：{ date, breakfast, lunch, dinner }
//   emp_id/dept_id/location_id/_openid 一律由 openid 反查获得，忽略前端传入（防越权/防伪造）
//   语义：
//     - 数量 > 0：upsert 该 (emp_id, meal_date, meal_type) 行；写入价格快照
//     - 数量 = 0：删除该 (emp_id, meal_date, meal_type) 行
//   优化说明（依赖唯一索引 uk_emp_date_meal(emp_id, meal_date, meal_type)）：
//     - 无需先 SELECT 判断行是否存在：
//         * 数量 > 0 的餐次 → 一条批量 INSERT ... ON DUPLICATE KEY UPDATE（冲突即更新）
//         * 数量 = 0 的餐次 → 一条按唯一键的批量 DELETE
//     - 整个 save = 1 条价格查询 + 至多 2 条写 SQL（原来最多 5 条往返）
// ──────────────────────────────────────────────────────────────────
async function actionSave(event) {
  // 员工身份/部门/食堂一律以 openid 反查为准：
  //  - 忽略前端传入的 emp_id，防止水平越权（替他人报餐/取消）
  //  - 忽略前端传入的 _openid，防止伪造 openid 污染数据
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''
  const identity = await resolveEmpIdentity(openid)
  if (!identity) {
    return { code: -1, message: '登录状态失效，请重新登录', data: null }
  }
  const emp_id = identity.emp_id
  const dept_id = identity.dept_id
  const location_id = identity.location_id
  const _openid = openid
  const date = ymd(event.date)

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
    { dept_id }
  )
  const priceMap = new Map()
  priceRows.forEach(r => {
    priceMap.set(Number(r.meal_type), {
      emp_price: Number(r.emp_price) || 100,
      family_price: Number(r.family_price) || 1000,
    })
  })

  // 2. 按数量拆分：>0 走 upsert，==0 走删除
  //    注意：参数名不能用 date（与 SQL 保留字 DATE 冲突，SDK 解析失败），用 day 代替
  const toUpsert = []
  const toDelete = []
  for (const name of MEAL_NAMES) {
    const meal_type = NAME_TO_MEAL_TYPE[name]
    const quantity = quantities[name]
    const price = priceMap.get(meal_type) || { emp_price: 100, family_price: 1000 }
    if (quantity === 0) {
      toDelete.push(meal_type)
    } else {
      toUpsert.push({
        meal_type,
        quantity,
        emp_price: price.emp_price,
        family_price: price.family_price,
      })
    }
  }

  const summary = { upserted: 0, deleted: 0 }
  let failedStep = '' // 部分失败时标记步骤：'upsert' | 'delete'

  try {
    // 3. 先批量 upsert（一次 SQL 写入/更新全部数量 >0 的餐次）
    //    多行 VALUES 中同一参数不能复用，故每行参数带行号后缀
    if (toUpsert.length > 0) {
      failedStep = 'upsert'
      const valueRows = []
      const params = { emp_id, day: date, location_id, _openid }
      toUpsert.forEach((u, i) => {
        const P = key => `{{${key}${i}}}`
        valueRows.push(
          `(${P('emp_id')}, ${P('day')}, ${P('meal_type')}, ${P('quantity')}, ${P('location_id')}, ` +
          `NOW(), 0, NOW(), NOW(), ${P('openid')}, ${P('emp_price')}, ${P('family_price')})`
        )
        Object.assign(params, {
          [`emp_id${i}`]: emp_id,
          [`day${i}`]: date,
          [`meal_type${i}`]: u.meal_type,
          [`quantity${i}`]: u.quantity,
          [`location_id${i}`]: location_id,
          [`openid${i}`]: _openid,
          [`emp_price${i}`]: u.emp_price,
          [`family_price${i}`]: u.family_price,
        })
      })

      const sql =
        'INSERT INTO `meal_order` ' +
        '(`emp_id`, `meal_date`, `meal_type`, `quantity`, `location_id`, ' +
        ' `submitted_at`, `verified_status`, `created_at`, `updated_at`, ' +
        ' `_openid`, `emp_price`, `family_price`) ' +
        'VALUES ' + valueRows.join(', ') +
        ' ON DUPLICATE KEY UPDATE ' +
        '  `quantity`     = VALUES(`quantity`), ' +
        '  `location_id`  = VALUES(`location_id`), ' +
        '  `emp_price`    = VALUES(`emp_price`), ' +
        '  `family_price` = VALUES(`family_price`), ' +
        '  `submitted_at` = NOW(), ' +
        '  `updated_at`   = NOW()'

      summary.upserted = await update(sql, params)
    }

    // 4. 后批量删除（数量 = 0 的餐次，按唯一键删除，无需先查 id；不存在的行影响 0 行）
    //    注意顺序：必须先写后删。原因：CloudBase $runSQL 不支持多语句事务，
    //    若 DELETE 先执行而 INSERT 失败，会留下"提示失败但数据已被删"的部分成功；
    //    先 upsert 后 delete 时，即使 DELETE 失败也只是"取消失败"，新报的餐已落库，
    //    危害最小，且前端失败后会强制刷新展示真实状态，用户重试即可。
    if (toDelete.length > 0) {
      failedStep = 'delete'
      const placeholders = toDelete.map((_, i) => `{{mt${i}}}`).join(', ')
      const params = { emp_id, day: date }
      toDelete.forEach((mt, i) => { params['mt' + i] = mt })
      summary.deleted = await update(
        'DELETE FROM `meal_order` ' +
        'WHERE `emp_id` = {{emp_id}} AND `meal_date` = {{day}} ' +
        '  AND `meal_type` IN (' + placeholders + ')',
        params
      )
    }
  } catch (err) {
    // 部分失败：不抛给顶层通用错误，改为返回友好的中文提示
    console.error('[mealOrder] save 部分失败，步骤:', failedStep, err)
    return {
      code: -1,
      message: failedStep === 'delete' ? '取消失败，请稍后重试' : '保存失败，请稍后重试',
      data: summary,
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
  const date = ymd(event.date)
  if (!date) {
    return { code: -1, message: '缺少参数 date', data: null }
  }

  // 员工身份以 openid 反查为准，忽略前端传入的 emp_id，防止越权删除他人记录
  const wxContext = cloud.getWXContext() || {}
  const identity = await resolveEmpIdentity(wxContext.OPENID || '')
  if (!identity) {
    return { code: -1, message: '登录状态失效，请重新登录', data: null }
  }
  const emp_id = identity.emp_id

  const affected = await update(
    'DELETE FROM `meal_order` WHERE `emp_id` = {{emp_id}} AND `meal_date` = {{day}}',
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
      case 'getRange':         return await actionGetRange(event)
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
    // 详细错误只进日志（query/update 已在上层打印完整 SQL 与参数）
    console.error('[mealOrder] error:', err)
    console.error('[mealOrder] error stack:', err && err.stack)
    // 对前端只给统一中文提示，避免把 $runSQL 的英文原始错误直接甩给用户
    return { code: -1, message: '操作失败，请重试', data: null }
  }
}
