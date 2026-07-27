// 云函数 - 根据角色ID数组查询角色名称
// 从 sys_role 表中根据 _id 批量查询 name
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { role_ids } = event

  if (!role_ids || !Array.isArray(role_ids) || role_ids.length === 0) {
    return { code: -1, message: '缺少角色ID参数(role_ids)', data: null }
  }

  try {
    const roleRes = await db.collection('sys_role')
      .where({ _id: _.in(role_ids) })
      .field({ name: true })
      .get()

    const roleNames = (roleRes.data && roleRes.data.length > 0)
      ? roleRes.data.map(r => r.name || '')
      : []

    return {
      code: 0,
      message: 'success',
      data: { role_names: roleNames }
    }
  } catch (err) {
    console.error('[getRoleNames] error:', err)
    return { code: -1, message: '查询失败: ' + err.message, data: null }
  }
}
