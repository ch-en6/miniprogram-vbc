// 云函数 - 报餐记录操作（meal_order 表）
// 支持 action：
//   getMonth       - 查询当前用户某月的所有报餐记录
//   getRange       - 查询当前用户指定日期范围内的所有报餐记录
//   save           - 保存/更新某日的报餐记录（upsert）
//   remove         - 删除某日的报餐记录
//   getPriceConfig - 获取餐费价格配置
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
  
  // 前端传入用户 _id 作为 emp_id
  if (action !== 'getPriceConfig' && !emp_id) {
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
