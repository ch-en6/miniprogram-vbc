// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    // 获取当前日期
    const now = new Date()
    // const today = formatDate(now)
    
    // 查询条件：status为1，且当前时间在start_date和end_date范围内
    const result = await db.collection('meal_menu')
      .where({
        status: 1,
        start_date: _.lte(now),
        end_date: _.gte(now)
      })
      .orderBy('name', 'asc') // 按name升序排序（字符串"1" < "2"）
      .get()
    
    if (!result.data || result.data.length === 0) {
      return {
        code: 404,
        message: '未找到有效菜单',
        data: null
      }
    }
    
    // 对结果进行二次排序，确保按数字大小排序（处理字符串类型的name）
    const sortedMenus = result.data.sort((a, b) => {
      const numA = parseInt(a.name) || 0
      const numB = parseInt(b.name) || 0
      return numA - numB
    })
    
    // 如果有多张菜单，进行轮换（每周轮换一次）
    let menuData
    if (sortedMenus.length > 1) {
      // 使用周数计算轮换索引（每周轮换一次）
      const weekIndex = getWeekOfYear(now)
      const rotateIndex = weekIndex % sortedMenus.length
      menuData = sortedMenus[rotateIndex]
    } else {
      menuData = sortedMenus[0]
    }
    
    return {
      code: 0,
      message: 'success',
      data: menuData
    }
  } catch (err) {
    console.error(err)
    return {
      code: -1,
      message: '查询失败',
      error: err.message
    }
  }
}

// /**
//  * 格式化日期为 YYYY-MM-DD
//  */
// function formatDate(date) {
//   const year = date.getFullYear()
//   const month = String(date.getMonth() + 1).padStart(2, '0')
//   const day = String(date.getDate()).padStart(2, '0')
//   return `${year}-${month}-${day}`
// }

/**
 * 获取一年中的第几周（用于轮换计算）
 */
function getWeekOfYear(date) {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1)
  const pastDaysOfYear = (date - firstDayOfYear) / 86400000
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7)
}
