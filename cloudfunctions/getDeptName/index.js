// 云函数 - 根据部门ID查询部门名称
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  const { dept_id } = event

  if (!dept_id) {
    return { code: -1, message: '缺少部门ID参数(dept_id)', data: null }
  }

  try {
    const deptRes = await db.collection('sys_dept')
      .where({ _id: dept_id })
      .field({ name: true })
      .limit(1)
      .get()

    if (!deptRes.data || deptRes.data.length === 0) {
      return { code: -1, message: '未找到该部门信息', data: null }
    }

    return {
      code: 0,
      message: 'success',
      data: {
        dept_id: dept_id,
        dept_name: deptRes.data[0].name || ''
      }
    }
  } catch (err) {
    console.error('[getDeptName] error:', err)
    return { code: -1, message: '查询失败: ' + err.message, data: null }
  }
}
