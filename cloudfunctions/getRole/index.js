// 云函数 - 根据角色ID数组查询角色名称
// 从 MySQL sys_role 表（主键 id、角色编码 code）根据 id 批量查询 code
const cloud = require('wx-server-sdk')
const cloudbaseSDK = require('@cloudbase/node-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 初始化 CloudBase 应用（云函数环境自动关联当前环境）
const cloudbase = cloudbaseSDK.init({
  env: cloudbaseSDK.SYMBOL_CURRENT_ENV
})
const models = cloudbase.models

/**
 * 执行 SQL 查询（预编译模式，参数用 {{key}} 绑定，防 SQL 注入）
 * @param {string} sql - SQL 语句
 * @param {object} [params] - 参数对象
 * @returns {Promise<Array>} 查询结果行数组
 */
async function query(sql, params = {}) {
  const result = await models.$runSQL(sql, params)
  return (result && result.data && result.data.executeResultList) || []
}

exports.main = async (event, context) => {
  const { role_ids } = event

  if (!role_ids || !Array.isArray(role_ids) || role_ids.length === 0) {
    return { code: -1, message: '缺少角色ID参数(role_ids)', data: null }
  }

  try {
    const placeholders = role_ids.map((_, idx) => `{{id${idx}}}`).join(',')
    const params = {}
    role_ids.forEach((v, idx) => { params[`id${idx}`] = v })

    const roleRes = await query(
      `SELECT \`code\` FROM \`sys_role\` WHERE \`id\` IN (${placeholders})`,
      params
    )

    const roleNames = (roleRes && roleRes.length > 0)
      ? roleRes.map(r => r.code || '')
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
