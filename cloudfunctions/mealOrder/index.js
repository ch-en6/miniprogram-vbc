// 云函数 - 报餐记录操作（meal_order 表）
// 支持 action：
//   getMonth           - 查询当前用户某月的所有报餐记录
//   getRange           - 查询当前用户指定日期范围内的所有报餐记录
//   save               - 保存/更新某日的报餐记录（upsert）
//   remove             - 删除某日的报餐记录
//   getPriceConfig     - 获取餐费价格配置
//   searchByName       - 按姓名查询指定日期的报餐记录
//   searchByPhone      - 按手机号查询指定日期的报餐记录
//   getKitchenSummary  - 食堂工作台：按日期汇总报餐数据（按部门维度）
//   getKitchenDetail   - 食堂工作台：按日期查询报餐明细（员工维度，分页）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const MAX_LIMIT = 100
const MEAL_KEYS = ['breakfast', 'lunch', 'dinner']

// ─── 工具函数 ────────────────────────────────────────────

/**
 * 通用分页查询：自动翻页获取全部数据
 * @param {string} collection - 集合名
 * @param {object} where - 查询条件
 * @param {object} [options] - 可选 { orderBy, field }
 * @returns {Array} 全部匹配记录
 */
async function fetchAll(collection, where, options = {}) {
  const { orderBy, field } = options
  let allData = []
  let skip = 0
  while (true) {
    let query = db.collection(collection).where(where)
    if (orderBy) query = query.orderBy(orderBy[0], orderBy[1])
    if (field) query = query.field(field)
    const res = await query.skip(skip).limit(MAX_LIMIT).get()
    allData = allData.concat(res.data)
    if (res.data.length < MAX_LIMIT) break
    skip += MAX_LIMIT
  }
  return allData
}

/**
 * 统一成功响应
 */
function ok(data, message = 'success') {
  return { code: 0, message, data }
}

/**
 * 统一错误响应
 */
function fail(message, data = null) {
  return { code: -1, message, data }
}

/**
 * 构建员工报餐搜索结果
 * @param {Array} empList - 员工列表（来自 sys_emp）
 * @param {string} date - 查询日期
 * @param {string} [meal] - 可选餐别筛选
 * @returns {object} 搜索结果 data
 */
async function buildSearchResult(empList, date, meal) {
  if (empList.length === 0) {
    return { found: false, keyword: '', list: [] }
  }

  const empIds = empList.map(e => e._id)

  // 批量查询报餐记录
  const orders = await fetchAll('meal_order', { emp_id: _.in(empIds), date })
  const orderMap = {}
  orders.forEach(o => { orderMap[o.emp_id] = o })

  // 批量查询部门名称
  const deptIds = [...new Set(empList.map(e => e.dept_id).filter(Boolean))]
  const deptMap = {}
  if (deptIds.length > 0) {
    const deptRes = await db.collection('sys_dept')
      .where({ _id: _.in(deptIds) })
      .field({ _id: true, name: true })
      .get()
    deptRes.data.forEach(d => { deptMap[d._id] = d.name })
  }

  // 组装列表
  const list = empList.map(emp => {
    const order = orderMap[emp._id] || {}
    const breakfast = order.breakfast || 0
    const lunch = order.lunch || 0
    const dinner = order.dinner || 0
    return {
      emp_id: emp._id,
      name: emp.name,
      phone: emp.phone || '',
      dept_name: deptMap[emp.dept_id] || '',
      breakfast, lunch, dinner,
      has_order: breakfast > 0 || lunch > 0 || dinner > 0,
    }
  })

  // 餐别筛选
  let filtered = list
  if (meal) {
    filtered = list.filter(item => item[meal] > 0)
  }

  return { found: filtered.length > 0, list: filtered }
}

// ─── 主入口 ──────────────────────────────────────────────

exports.main = async (event, context) => {
  const { action, emp_id } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) return fail('无法获取用户信息')

  // 不需要 emp_id 的 action 白名单
  const NO_EMP_ACTIONS = ['getPriceConfig', 'searchByName', 'searchByPhone', 'getKitchenSummary', 'getKitchenDetail']
  if (!NO_EMP_ACTIONS.includes(action) && !emp_id) {
    return fail('缺少用户ID参数(emp_id)')
  }

  try {
    switch (action) {
      case 'getMonth':          return await getMonth(event, emp_id)
      case 'getRange':          return await getRange(event, emp_id)
      case 'save':              return await save(event, emp_id, openid)
      case 'remove':            return await remove(event, emp_id)
      case 'getPriceConfig':    return await getPriceConfig(event)
      case 'searchByName':      return await searchByName(event)
      case 'searchByPhone':     return await searchByPhone(event)
      case 'getKitchenSummary': return await getKitchenSummary(event)
      case 'getKitchenDetail':  return await getKitchenDetail(event)
      default:                  return fail('未知操作: ' + action)
    }
  } catch (err) {
    console.error('[mealOrder] error:', err)
    return fail('操作失败: ' + err.message)
  }
}

// ─── 各 action 实现 ──────────────────────────────────────

/**
 * 查询某月报餐记录
 */
async function getMonth(event, emp_id) {
  const { month } = event
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return fail('缺少月份参数或格式错误')
  }
  const data = await fetchAll('meal_order', {
    emp_id,
    date: _.gte(month + '-01').and(_.lte(month + '-31'))
  }, { orderBy: ['date', 'asc'] })
  return ok(data)
}

/**
 * 查询指定日期范围内的报餐记录
 */
async function getRange(event, emp_id) {
  const { startDate, endDate } = event
  if (!startDate || !endDate) return fail('缺少日期范围参数')
  const data = await fetchAll('meal_order', {
    emp_id,
    date: _.gte(startDate).and(_.lte(endDate))
  }, { orderBy: ['date', 'asc'] })
  return ok(data)
}

/**
 * 保存/更新某日报餐记录（upsert）
 */
async function save(event, emp_id, openid) {
  const { date, breakfast, lunch, dinner } = event
  if (!date) return fail('缺少日期参数')

  const existing = await db.collection('meal_order')
    .where({ emp_id, date })
    .limit(1)
    .get()

  const now = new Date()
  const mealData = {
    emp_id, _openid: openid,
    breakfast: breakfast || 0,
    lunch: lunch || 0,
    dinner: dinner || 0,
    updated_at: now,
  }

  if (existing.data.length > 0) {
    const recordId = existing.data[0]._id
    await db.collection('meal_order').doc(recordId).update({ data: mealData })
    return ok({ _id: recordId, date, breakfast, lunch, dinner }, '更新成功')
  }

  mealData.date = date
  mealData.created_at = now
  const res = await db.collection('meal_order').add({ data: mealData })
  return ok({ _id: res._id, date, breakfast, lunch, dinner }, '保存成功')
}

/**
 * 删除某日报餐记录
 */
async function remove(event, emp_id) {
  const { date } = event
  if (!date) return fail('缺少日期参数')

  const existing = await db.collection('meal_order')
    .where({ emp_id, date })
    .limit(1)
    .get()

  if (existing.data.length > 0) {
    await db.collection('meal_order').doc(existing.data[0]._id).remove()
    return ok(null, '删除成功')
  }
  return ok(null, '记录不存在，无需删除')
}

/**
 * 按姓名/手机号查询报餐记录（统一入口）
 */
async function searchByName(event) {
  const { keyword, date, meal } = event
  if (!keyword || !date) return fail('缺少姓名或日期参数')

  const empRes = await db.collection('sys_emp')
    .where({ name: db.RegExp({ regexp: keyword, options: 'i' }) })
    .field({ _id: true, name: true, phone: true, dept_id: true })
    .limit(50)
    .get()

  const result = await buildSearchResult(empRes.data || [], date, meal)
  return ok({ ...result, keyword, date, total: result.list.length })
}

async function searchByPhone(event) {
  const { keyword, date, meal } = event
  if (!keyword || !date) return fail('缺少手机号或日期参数')

  const empRes = await db.collection('sys_emp')
    .where({ phone: db.RegExp({ regexp: keyword, options: 'i' }) })
    .field({ _id: true, name: true, phone: true, dept_id: true })
    .limit(50)
    .get()

  const result = await buildSearchResult(empRes.data || [], date, meal)
  return ok({ ...result, keyword, date, total: result.list.length })
}

/**
 * 食堂工作台：按日期汇总报餐数据（按部门维度）
 */
async function getKitchenSummary(event) {
  const { date } = event
  if (!date) return fail('缺少日期参数')

  // 并行查询：报餐记录、部门列表、员工列表
  const [allOrders, deptRes, allEmps] = await Promise.all([
    fetchAll('meal_order', { date }),
    db.collection('sys_dept').field({ _id: true, name: true }).get(),
    fetchAll('sys_emp', {}, { field: { _id: true, dept_id: true } }),
  ])

  const deptMap = {}
  deptRes.data.forEach(d => { deptMap[d._id] = d.name })

  const empDeptMap = {}
  allEmps.forEach(e => { empDeptMap[e._id] = e.dept_id })

  // 初始化餐次汇总
  const mealTotals = {}
  MEAL_KEYS.forEach(k => { mealTotals[k] = { head_count: 0, total_qty: 0, family_qty: 0 } })

  // 按部门汇总
  const deptStats = {}

  allOrders.forEach(order => {
    const deptId = empDeptMap[order.emp_id] || 'unknown'
    const deptName = deptMap[deptId] || '未知部门'

    if (!deptStats[deptId]) {
      deptStats[deptId] = { dept_id: deptId, dept_name: deptName, breakfast: 0, lunch: 0, dinner: 0 }
    }
    const ds = deptStats[deptId]

    MEAL_KEYS.forEach(meal => {
      const qty = order[meal] || 0
      if (qty > 0) {
        ds[meal] += qty
        mealTotals[meal].head_count += 1
        mealTotals[meal].total_qty += qty
        mealTotals[meal].family_qty += Math.max(qty - 1, 0)
      }
    })
  })

  // 过滤无报餐的部门，按总量降序
  const depts = Object.values(deptStats)
    .filter(d => d.breakfast + d.lunch + d.dinner > 0)
    .sort((a, b) =>
      (b.breakfast + b.lunch + b.dinner) - (a.breakfast + a.lunch + a.dinner)
    )

  return ok({ date, meals: mealTotals, depts })
}

/**
 * 食堂工作台：按日期查询报餐明细（员工维度，支持分页、搜索、餐别筛选）
 */
async function getKitchenDetail(event) {
  const { date, page = 1, page_size = 20, keyword, meal_type } = event
  if (!date) return fail('缺少日期参数')

  const allOrders = await fetchAll('meal_order', { date })
  if (allOrders.length === 0) return ok({ list: [], total: 0, total_qty: 0 })

  // 获取涉及的 emp_id
  const empIds = [...new Set(allOrders.map(o => o.emp_id))]

  // 分页查询员工信息（避免超过 100 条限制）
  const empMap = {}
  const empChunks = []
  for (let i = 0; i < empIds.length; i += MAX_LIMIT) {
    empChunks.push(empIds.slice(i, i + MAX_LIMIT))
  }
  await Promise.all(empChunks.map(async chunk => {
    const res = await db.collection('sys_emp')
      .where({ _id: _.in(chunk) })
      .field({ _id: true, name: true, phone: true, dept_id: true })
      .get()
    res.data.forEach(e => { empMap[e._id] = e })
  }))

  // 批量查询部门名称
  const deptIds = [...new Set(Object.values(empMap).map(e => e.dept_id).filter(Boolean))]
  const deptMap = {}
  if (deptIds.length > 0) {
    const deptRes = await db.collection('sys_dept')
      .where({ _id: _.in(deptIds) })
      .field({ _id: true, name: true })
      .get()
    deptRes.data.forEach(d => { deptMap[d._id] = d.name })
  }

  // 展开为各餐次明细行
  let allRows = []
  allOrders.forEach(order => {
    const emp = empMap[order.emp_id] || {}
    const deptName = deptMap[emp.dept_id] || '未知部门'
    MEAL_KEYS.forEach(meal => {
      const qty = order[meal] || 0
      if (qty > 0) {
        allRows.push({
          user_id: order.emp_id,
          name: emp.name || '',
          phone: emp.phone || '',
          dept_name: deptName,
          meal_type: meal,
          qty,
        })
      }
    })
  })

  // 关键词搜索（姓名 / 部门 / 手机号）
  if (keyword) {
    const key = keyword.toLowerCase()
    allRows = allRows.filter(r =>
      (r.name || '').toLowerCase().includes(key) ||
      (r.dept_name || '').toLowerCase().includes(key) ||
      (r.phone || '').includes(key)
    )
  }

  // 餐别筛选
  if (meal_type) {
    allRows = allRows.filter(r => r.meal_type === meal_type)
  }

  // 汇总 + 分页
  const total = allRows.length
  const total_qty = allRows.reduce((sum, r) => sum + r.qty, 0)
  const start = (page - 1) * page_size
  const paged = allRows.slice(start, start + page_size)

  return ok({ list: paged, total, total_qty })
}

/**
 * 获取餐费价格配置
 */
async function getPriceConfig(event) {
  const { dept_id } = event
  if (!dept_id) return fail('缺少必需的部门ID参数')

  // meal_type: 0-早餐, 1-午餐, 2-晚餐
  const MEAL_TYPE_MAP = { 0: 'breakfast', 1: 'lunch', 2: 'dinner' }
  const DEFAULTS = {
    breakfast: { emp_price: 100, family_price: 1000 },
    lunch:     { emp_price: 200, family_price: 2000 },
    dinner:    { emp_price: 200, family_price: 2000 },
  }

  const res = await db.collection('price_config')
    .where({ dept_id, status: 1 })
    .get()

  if (!res.data || res.data.length === 0) {
    return fail(`部门 ${dept_id} 未配置价格，请联系管理员`)
  }

  const priceConfig = { ...DEFAULTS, dept_id }
  res.data.forEach(config => {
    const mealName = MEAL_TYPE_MAP[config.meal_type]
    if (mealName) {
      priceConfig[mealName] = {
        emp_price: config.emp_price || DEFAULTS[mealName].emp_price,
        family_price: config.family_price || DEFAULTS[mealName].family_price,
      }
    }
  })

  return ok(priceConfig)
}
