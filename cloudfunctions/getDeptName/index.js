// 云函数 - 根据部门ID查询部门名称（通过 @cloudbase/node-sdk 访问云 MySQL sys_dept 表）
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
  const { dept_id } = event

  if (!dept_id) {
    return { code: -1, message: '缺少部门ID参数(dept_id)', data: null }
  }

  try {
    const deptRows = await query(
      'SELECT `name` FROM `sys_dept` WHERE `id` = {{dept_id}} LIMIT 1',
      { dept_id }
    )

    if (!deptRows || deptRows.length === 0) {
      return { code: -1, message: '未找到该部门信息', data: null }
    }

    return {
      code: 0,
      message: 'success',
      data: {
        dept_id: dept_id,
        dept_name: deptRows[0].name || ''
      }
    }
  } catch (err) {
    console.error('[getDeptName] error:', err)
    return { code: -1, message: '查询失败: ' + err.message, data: null }
  }
}
