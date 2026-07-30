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

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { action, emp_id } = event

  // 获取当前用户的 openid
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { code: -1, message: '无法获取用户信息', data: null}
  }
  
  // 前端传入用户 _id 作为 emp_id（searchByName / getKitchenSummary 不需要 emp_id）
  if (!['getPriceConfig', 'searchByName', 'searchByPhone', 'getKitchenSummary', 'getKitchenDetail'].includes(action) && !emp_id) {
    return { code: -1, message: '缺少用户ID参数(emp_id)', data: null }
  }

  try {
    switch (action) {
      case 'getMonth':
        return await getMonth(event, emp_id)
      case 'getRange':
        return await getRange(event, emp_id)
      case 'save':
        return await save(event, emp_id, openid)
      case 'remove':
        return await remove(event, emp_id)
      case 'getPriceConfig':
        return await getPriceConfig(event)
      case 'searchByName':
        return await searchByName(event)
      case 'searchByPhone':
        return await searchByPhone(event)
      case 'getKitchenSummary':
        return await getKitchenSummary(event)
      case 'getKitchenDetail':
        return await getKitchenDetail(event)
      default:
        return { code: -1, message: '未知操作: ' + action, data: null }
    }
  } catch (err) {
    console.error('[mealOrder] error:', err)
    return { code: -1, message: '操作失败: ' + err.message, data: null }
  }
}

/**
 * 查询某月报餐记录
 * @param {object} event - { action: 'getMonth', month: 'YYYY-MM' }
 */
async function getMonth(event, emp_id) {
  const { month } = event
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return { code: -1, message: '缺少月份参数或格式错误', data: null }
  }

  // 构造日期范围：YYYY-MM-01 ~ YYYY-MM-31（覆盖所有天）
  const startDate = month + '-01'
  const endDate = month + '-31'

  // 分页查询，云数据库单次最多返回 100 条
  const MAX_LIMIT = 100
  let allData = []
  let hasMore = true
  let skip = 0

  while (hasMore) {
    const res = await db.collection('meal_order')
      .where({
        emp_id: emp_id,
        date: _.gte(startDate).and(_.lte(endDate))
      })
      .orderBy('date', 'asc')
      .skip(skip)
      .limit(MAX_LIMIT)
      .get()

    allData = allData.concat(res.data)
    hasMore = res.data.length === MAX_LIMIT
    skip += MAX_LIMIT
  }

  return {
    code: 0,
    message: 'success',
    data: allData
  }
}

/**
 * 查询指定日期范围内的报餐记录
 * @param {object} event - { action: 'getRange', startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
 */
async function getRange(event, emp_id) {
  const { startDate, endDate } = event
  if (!startDate || !endDate) {
    return { code: -1, message: '缺少日期范围参数', data: null }
  }

  // 分页查询，云数据库单次最多返回 100 条
  const MAX_LIMIT = 100
  let allData = []
  let hasMore = true
  let skip = 0

  while (hasMore) {
    const res = await db.collection('meal_order')
      .where({
        emp_id: emp_id,
        date: _.gte(startDate).and(_.lte(endDate))
      })
      .orderBy('date', 'asc')
      .skip(skip)
      .limit(MAX_LIMIT)
      .get()

    allData = allData.concat(res.data)
    hasMore = res.data.length === MAX_LIMIT
    skip += MAX_LIMIT
  }

  return {
    code: 0,
    message: 'success',
    data: allData
  }
}

/**
 * 保存/更新某日报餐记录（upsert）
 * @param {object} event - { action: 'save', date: 'YYYY-MM-DD', breakfast: n, lunch: n, dinner: n }
 */
async function save(event, emp_id, openid) {
  const { date, breakfast, lunch, dinner } = event

  if (!date) {
    return { code: -1, message: '缺少日期参数', data: null }
  }

  // 查询是否已存在该日记录
  const existing = await db.collection('meal_order')
    .where({
      emp_id: emp_id,
      date: date
    })
    .limit(1)
    .get()

  const now = new Date()

  if (existing.data && existing.data.length > 0) {
    // 已存在 → 更新
    const recordId = existing.data[0]._id
    await db.collection('meal_order').doc(recordId).update({
      data: {
        emp_id: emp_id,
        _openid: openid,
        breakfast: breakfast || 0,
        lunch: lunch || 0,
        dinner: dinner || 0,
        updated_at: now
      }
    })
    return { code: 0, message: '更新成功', data: { _id: recordId, date, breakfast, lunch, dinner } }
  } else {
    // 不存在 → 新增
    const res = await db.collection('meal_order').add({
      data: {
        emp_id: emp_id,
        _openid: openid,
        date: date,
        breakfast: breakfast || 0,
        lunch: lunch || 0,
        dinner: dinner || 0,
        created_at: now,
        updated_at: now
      }
    })
    return { code: 0, message: '保存成功', data: { _id: res._id, date, breakfast, lunch, dinner } }
  }
}

/**
 * 删除某日报餐记录
 * @param {object} event - { action: 'remove', date: 'YYYY-MM-DD' }
 */
async function remove(event, emp_id) {
  const { date } = event

  if (!date) {
    return { code: -1, message: '缺少日期参数', data: null }
  }

  const existing = await db.collection('meal_order')
    .where({
      emp_id: emp_id,
      date: date
    })
    .limit(1)
    .get()

  if (existing.data && existing.data.length > 0) {
    await db.collection('meal_order').doc(existing.data[0]._id).remove()
    return { code: 0, message: '删除成功', data: null }
  } else {
    return { code: 0, message: '记录不存在，无需删除', data: null }
  }
}

/**
 * 按姓名查询指定日期的报餐记录
 * @param {object} event - { action: 'searchByName', keyword: string, date: 'YYYY-MM-DD', meal?: string }
 */
async function searchByName(event) {
  const { keyword, date, meal } = event

  if (!keyword || !date) {
    return { code: -1, message: '缺少姓名或日期参数', data: null }
  }

  // 1. 从 sys_emp 表按姓名模糊搜索
  const empRes = await db.collection('sys_emp')
    .where({
      name: db.RegExp({ regexp: keyword, options: 'i' })
    })
    .field({ _id: true, name: true, phone: true, dept_id: true })
    .limit(50)
    .get()

  if (!empRes.data || empRes.data.length === 0) {
    return { code: 0, message: '未找到该人员', data: { found: false, keyword, list: [] } }
  }

  const empList = empRes.data
  const empIds = empList.map(e => e._id)

  // 2. 批量查询这些员工在指定日期的 meal_order 记录
  const orderRes = await db.collection('meal_order')
    .where({
      emp_id: _.in(empIds),
      date: date
    })
    .get()

  // 建立 emp_id -> order 的映射
  const orderMap = {}
  ;(orderRes.data || []).forEach(o => {
    orderMap[o.emp_id] = o
  })

  // 3. 批量查询部门名称（去重 dept_id）
  const deptIds = [...new Set(empList.map(e => e.dept_id).filter(Boolean))]
  const deptMap = {}
  if (deptIds.length > 0) {
    const deptRes = await db.collection('sys_dept')
      .where({ _id: _.in(deptIds) })
      .field({ _id: true, name: true })
      .get()
    ;(deptRes.data || []).forEach(d => {
      deptMap[d._id] = d.name
    })
  }

  // 4. 组装结果
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
      breakfast,
      lunch,
      dinner,
      has_order: breakfast > 0 || lunch > 0 || dinner > 0,
    }
  })

  // 如果有餐别筛选，只返回该餐次有报餐的人员
  let filteredList = list
  if (meal) {
    filteredList = list.filter(item => {
      if (meal === 'breakfast') return item.breakfast > 0
      if (meal === 'lunch') return item.lunch > 0
      if (meal === 'dinner') return item.dinner > 0
      return true
    })
  }

  return {
    code: 0,
    message: 'success',
    data: {
      found: filteredList.length > 0,
      keyword,
      date,
      total: filteredList.length,
      list: filteredList,
    }
  }
}

/**
 * 按手机号查询指定日期的报餐记录
 * @param {object} event - { action: 'searchByPhone', keyword: string, date: 'YYYY-MM-DD', meal?: string }
 */
async function searchByPhone(event) {
  const { keyword, date, meal } = event

  if (!keyword || !date) {
    return { code: -1, message: '缺少手机号或日期参数', data: null }
  }

  // 1. 从 sys_emp 表按手机号精确/模糊匹配
  const empRes = await db.collection('sys_emp')
    .where({
      phone: db.RegExp({ regexp: keyword, options: 'i' })
    })
    .field({ _id: true, name: true, phone: true, dept_id: true })
    .limit(50)
    .get()

  if (!empRes.data || empRes.data.length === 0) {
    return { code: 0, message: '未找到该人员', data: { found: false, keyword, list: [] } }
  }

  const empList = empRes.data
  const empIds = empList.map(e => e._id)

  // 2. 批量查询这些员工在指定日期的 meal_order 记录
  const orderRes = await db.collection('meal_order')
    .where({
      emp_id: _.in(empIds),
      date: date
    })
    .get()

  const orderMap = {}
  ;(orderRes.data || []).forEach(o => {
    orderMap[o.emp_id] = o
  })

  // 3. 批量查询部门名称
  const deptIds = [...new Set(empList.map(e => e.dept_id).filter(Boolean))]
  const deptMap = {}
  if (deptIds.length > 0) {
    const deptRes = await db.collection('sys_dept')
      .where({ _id: _.in(deptIds) })
      .field({ _id: true, name: true })
      .get()
    ;(deptRes.data || []).forEach(d => {
      deptMap[d._id] = d.name
    })
  }

  // 4. 组装结果
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
      breakfast,
      lunch,
      dinner,
      has_order: breakfast > 0 || lunch > 0 || dinner > 0,
    }
  })

  let filteredList = list
  if (meal) {
    filteredList = list.filter(item => {
      if (meal === 'breakfast') return item.breakfast > 0
      if (meal === 'lunch') return item.lunch > 0
      if (meal === 'dinner') return item.dinner > 0
      return true
    })
  }

  return {
    code: 0,
    message: 'success',
    data: {
      found: filteredList.length > 0,
      keyword,
      date,
      total: filteredList.length,
      list: filteredList,
    }
  }
}

/**
 * 食堂工作台：按日期汇总报餐数据（按部门维度）
 * @param {object} event - { action: 'getKitchenSummary', date: 'YYYY-MM-DD' }
 * @returns {Object} { meals: { breakfast: { head_count, total_qty, family_qty }, ... }, depts: [...] }
 */
async function getKitchenSummary(event) {
  const { date } = event
  if (!date) {
    return { code: -1, message: '缺少日期参数', data: null }
  }

  // 1. 分页查询该日所有报餐记录
  const MAX_LIMIT = 100
  let allOrders = []
  let hasMore = true
  let skip = 0

  while (hasMore) {
    const res = await db.collection('meal_order')
      .where({ date })
      .skip(skip)
      .limit(MAX_LIMIT)
      .get()
    allOrders = allOrders.concat(res.data)
    hasMore = res.data.length === MAX_LIMIT
    skip += MAX_LIMIT
  }

  // 2. 查询所有部门
  const deptRes = await db.collection('sys_dept')
    .field({ _id: true, name: true })
    .get()
  const deptMap = {}
  ;(deptRes.data || []).forEach(d => {
    deptMap[d._id] = d.name
  })

  // 3. 查询所有员工（获取 emp_id -> dept_id 映射）
  const MAX_EMP = 100
  let allEmps = []
  let empHasMore = true
  let empSkip = 0
  while (empHasMore) {
    const empRes = await db.collection('sys_emp')
      .field({ _id: true, dept_id: true })
      .skip(empSkip)
      .limit(MAX_EMP)
      .get()
    allEmps = allEmps.concat(empRes.data)
    empHasMore = empRes.data.length === MAX_EMP
    empSkip += MAX_EMP
  }
  const empDeptMap = {}
  allEmps.forEach(e => { empDeptMap[e._id] = e.dept_id })

  // 4. 按部门汇总
  const deptStats = {}  // dept_id -> { dept_id, dept_name, breakfast, lunch, dinner, head_count, total_qty, family_qty }
  const mealTotals = {
    breakfast: { head_count: 0, total_qty: 0, family_qty: 0 },
    lunch:     { head_count: 0, total_qty: 0, family_qty: 0 },
    dinner:    { head_count: 0, total_qty: 0, family_qty: 0 },
  }

  allOrders.forEach(order => {
    const deptId = empDeptMap[order.emp_id] || 'unknown'
    const deptName = deptMap[deptId] || '未知部门'

    if (!deptStats[deptId]) {
      deptStats[deptId] = {
        dept_id: deptId,
        dept_name: deptName,
        breakfast: 0, lunch: 0, dinner: 0,
      }
    }

    const ds = deptStats[deptId]

    // 早餐
    if (order.breakfast && order.breakfast > 0) {
      ds.breakfast += order.breakfast
      mealTotals.breakfast.head_count += 1
      mealTotals.breakfast.total_qty += order.breakfast
      mealTotals.breakfast.family_qty += Math.max(order.breakfast - 1, 0)
    }
    // 午餐
    if (order.lunch && order.lunch > 0) {
      ds.lunch += order.lunch
      mealTotals.lunch.head_count += 1
      mealTotals.lunch.total_qty += order.lunch
      mealTotals.lunch.family_qty += Math.max(order.lunch - 1, 0)
    }
    // 晚餐
    if (order.dinner && order.dinner > 0) {
      ds.dinner += order.dinner
      mealTotals.dinner.head_count += 1
      mealTotals.dinner.total_qty += order.dinner
      mealTotals.dinner.family_qty += Math.max(order.dinner - 1, 0)
    }
  })

  // 5. 部门列表（过滤无报餐的部门，按名称排序）
  const depts = Object.values(deptStats)
    .filter(d => d.breakfast + d.lunch + d.dinner > 0)
    .sort((a, b) => (b.breakfast + b.lunch + b.dinner) - (a.breakfast + a.lunch + a.dinner))

  return {
    code: 0,
    message: 'success',
    data: {
      date,
      meals: mealTotals,
      depts,
    }
  }
}

/**
 * 食堂工作台：按日期查询报餐明细（员工维度，支持分页、搜索、餐别筛选）
 * @param {object} event - { action: 'getKitchenDetail', date: 'YYYY-MM-DD', page?: number, page_size?: number, keyword?: string, meal_type?: string }
 * @returns {Object} { list: [...], total: number, total_qty: number }
 */
async function getKitchenDetail(event) {
  const { date, page = 1, page_size = 20, keyword, meal_type } = event
  if (!date) {
    return { code: -1, message: '缺少日期参数', data: null }
  }

  // 1. 分页查询该日所有报餐记录
  const MAX_LIMIT = 100
  let allOrders = []
  let hasMore = true
  let skip = 0
  while (hasMore) {
    const res = await db.collection('meal_order')
      .where({ date })
      .skip(skip)
      .limit(MAX_LIMIT)
      .get()
    allOrders = allOrders.concat(res.data)
    hasMore = res.data.length === MAX_LIMIT
    skip += MAX_LIMIT
  }

  if (allOrders.length === 0) {
    return { code: 0, message: 'success', data: { list: [], total: 0, total_qty: 0 } }
  }

  // 2. 获取所有涉及的 emp_id
  const empIds = [...new Set(allOrders.map(o => o.emp_id))]

  // 3. 批量查询员工信息
  const empRes = await db.collection('sys_emp')
    .where({ _id: _.in(empIds) })
    .field({ _id: true, name: true, phone: true, dept_id: true })
    .limit(MAX_LIMIT)
    .get()
  const empMap = {}
  ;(empRes.data || []).forEach(e => { empMap[e._id] = e })

  // 4. 批量查询部门名称
  const deptIds = [...new Set(Object.values(empMap).map(e => e.dept_id).filter(Boolean))]
  const deptMap = {}
  if (deptIds.length > 0) {
    const deptRes = await db.collection('sys_dept')
      .where({ _id: _.in(deptIds) })
      .field({ _id: true, name: true })
      .get()
    ;(deptRes.data || []).forEach(d => { deptMap[d._id] = d.name })
  }

  // 5. 将每条 order 记录展开为各餐次的明细行
  const MEAL_KEYS = ['breakfast', 'lunch', 'dinner']
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
          qty: qty,
        })
      }
    })
  })

  // 6. 关键词搜索（姓名 / 部门 / 手机号）
  if (keyword) {
    const key = keyword.toLowerCase()
    allRows = allRows.filter(r =>
      (r.name || '').toLowerCase().includes(key) ||
      (r.dept_name || '').toLowerCase().includes(key) ||
      (r.phone || '').includes(key)
    )
  }

  // 7. 餐别筛选
  if (meal_type) {
    allRows = allRows.filter(r => r.meal_type === meal_type)
  }

  // 8. 计算汇总
  const total = allRows.length
  const total_qty = allRows.reduce((sum, r) => sum + r.qty, 0)

  // 9. 分页
  const start = (page - 1) * page_size
  const paged = allRows.slice(start, start + page_size)

  return {
    code: 0,
    message: 'success',
    data: {
      list: paged,
      total,
      total_qty,
    }
  }
}

/**
 * 获取餐费价格配置
 * @param {object} event - { action: 'getPriceConfig', dept_id: string }
 * @returns {Object} 价格配置对象，包含早中晚餐的员工价和家属价
 */
async function getPriceConfig(event) {
  const { dept_id } = event
  
  // 强制要求传入部门ID
  if (!dept_id) {
    return {
      code: -1,
      message: '缺少必需的部门ID参数',
      data: null
    }
  }
  
  // meal_type: 0-早餐, 1-午餐, 2-晚餐
  const MEAL_TYPE_MAP = {
    0: 'breakfast',
    1: 'lunch',
    2: 'dinner'
  }
  
  try {
    // 查询指定部门的启用状态的价格配置（status=1）
    const res = await db.collection('price_config')
      .where({
        dept_id: dept_id,
        status: 1  // 只获取启用状态的配置
      })
      .get()
    
    if (res.data && res.data.length > 0) {
      // 按 meal_type 组织价格数据
      const priceConfig = {
        breakfast: { emp_price: 100, family_price: 1000 },   // 默认值
        lunch: { emp_price: 200, family_price: 2000 },       // 默认值
        dinner: { emp_price: 200, family_price: 2000 },       // 默认值
        dept_id: dept_id
      }
      
      // 遍历查询结果，填充各餐次的价格
      res.data.forEach(config => {
        const mealTypeName = MEAL_TYPE_MAP[config.meal_type]
        if (mealTypeName) {
          priceConfig[mealTypeName] = {
            emp_price: config.emp_price || priceConfig[mealTypeName].emp_price,
            family_price: config.family_price || priceConfig[mealTypeName].family_price
          }
        }
      })
      
      return {
        code: 0,
        message: 'success',
        data: priceConfig
      }
    } else {
      // 该部门没有配置，返回错误提示
      return {
        code: -1,
        message: `部门 ${dept_id} 未配置价格，请联系管理员`,
        data: null
      }
    }
  } catch (err) {
    console.error('[getPriceConfig] error:', err)
    return {
      code: -1,
      message: '获取价格配置失败: ' + err.message,
      data: null
    }
  }
}
