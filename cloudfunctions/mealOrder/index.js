// 云函数 - 报餐记录操作（meal_order 表）
// 支持 action：
//   getMonth  - 查询当前用户某月的所有报餐记录
//   getRange  - 查询当前用户指定日期范围内的所有报餐记录
//   save      - 保存/更新某日的报餐记录（upsert）
//   remove    - 删除某日的报餐记录
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { action } = event

  // 获取当前调用用户的 openid
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { code: -1, message: '无法获取用户信息', data: null }
  }

  try {
    switch (action) {
      case 'getMonth':
        return await getMonth(event, openid)
      case 'getRange':
        return await getRange(event, openid)
      case 'save':
        return await save(event, openid)
      case 'remove':
        return await remove(event, openid)
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
async function getMonth(event, openid) {
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
        _openid: openid,
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
async function getRange(event, openid) {
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
        _openid: openid,
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
async function save(event, openid) {
  const { date, breakfast, lunch, dinner } = event

  if (!date) {
    return { code: -1, message: '缺少日期参数', data: null }
  }

  // 查询是否已存在该日记录
  const existing = await db.collection('meal_order')
    .where({
      _openid: openid,
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
async function remove(event, openid) {
  const { date } = event

  if (!date) {
    return { code: -1, message: '缺少日期参数', data: null }
  }

  const existing = await db.collection('meal_order')
    .where({
      _openid: openid,
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
