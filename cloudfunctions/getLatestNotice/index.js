// 云函数入口文件 - 获取最新一条已发布的公告
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV // 使用当前云环境
})

const db = cloud.database()

exports.main = async (event, context) => {
  try {
    // 从 sys_notice 表中查询最新一条已发布的公告
    const res = await db.collection('sys_notice')
      .where({
        status: 1 // 只查询已发布的公告
      })
      .orderBy('publish_time', 'desc') // 按发布时间降序
      .orderBy('created_at', 'desc')   // 如果发布时间相同，按创建时间降序
      .limit(1)                         // 只取第一条
      .get()

    // 返回结果
    if (res.data && res.data.length > 0) {
      return {
        code: 0,
        message: 'success',
        data: res.data[0]
      }
    } else {
      return {
        code: 0,
        message: '暂无公告',
        data: null
      }
    }
  } catch (err) {
    console.error('获取公告失败:', err)
    return {
      code: -1,
      message: '获取公告失败: ' + err.message,
      data: null
    }
  }
}
