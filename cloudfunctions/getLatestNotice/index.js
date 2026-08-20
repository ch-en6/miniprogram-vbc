// 云函数 - 获取最新一条已发布公告（从云 MySQL sys_notice 表读取）
// 读取逻辑：
//   1. 优先使用前端传入的 location_id 参数
//   2. 否则使用前端传入的 dept_id 查 sys_dept 的 location_id
//   3. 在 sys_notice 中查询 status = 1（已发布）且 location_id 相同的最新公告
//
// 前提：云开发环境中已绑定/接入 MySQL 数据源（sys_notice、sys_dept 表）
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

/**
 * 解析发布时间为可排序字符串
 * @param {any} dateVal
 * @returns {string}
 */
function formatDateTime(dateVal) {
  if (!dateVal) return ''
  const d = new Date(dateVal)
  if (isNaN(d.getTime())) return String(dateVal)
  const pad = (n) => (n < 10 ? '0' + n : n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

exports.main = async (event, context) => {
  try {
    let { location_id, dept_id } = event

    // 没有传入 location_id 时，用 dept_id 查 sys_dept 的 location_id
    if (!location_id && dept_id) {
      const deptRows = await query(
        'SELECT `location_id` FROM `sys_dept` WHERE `id` = {{dept_id}} LIMIT 1',
        { dept_id }
      )

      if (!deptRows || deptRows.length === 0 || !deptRows[0].location_id) {
        return { code: 0, message: '暂无公告', data: null }
      }

      location_id = deptRows[0].location_id
    }

    if (!location_id) {
      return { code: 0, message: '暂无公告', data: null }
    }

    // 从 sys_notice 查询该范围最新已发布公告
    const rows = await query(
      'SELECT * FROM `sys_notice` ' +
      'WHERE `status` = 1 AND `location_id` = {{location_id}} ' +
      'ORDER BY `publish_time` DESC, `id` DESC ' +
      'LIMIT 1',
      { location_id }
    )

    if (!rows || rows.length === 0) {
      return { code: 0, message: '暂无公告', data: null }
    }

    const notice = rows[0]

    // 根据 created_by（sys_emp.id）查询发布者姓名
    let createdByName = ''
    if (notice.created_by) {
      const empRows = await query(
        'SELECT `name` FROM `sys_emp` WHERE `id` = {{created_by}} LIMIT 1',
        { created_by: notice.created_by }
      )
      if (empRows && empRows.length > 0 && empRows[0].name) {
        createdByName = empRows[0].name
      }
    }

    return {
      code: 0,
      message: 'success',
      data: {
        id: notice.id,
        title: notice.title || '',
        content: notice.content || '',
        status: notice.status,
        publish_time: formatDateTime(notice.publish_time),
        created_by: notice.created_by,
        created_by_name: createdByName,
        created_at: formatDateTime(notice.created_at),
        updated_at: formatDateTime(notice.updated_at),
        location_id: notice.location_id,
        _openid: notice._openid,
      }
    }
  } catch (err) {
    console.error('[getLatestNotice] 获取公告失败:', err)
    return {
      code: -1,
      message: '获取公告失败: ' + (err.message || err),
      data: null
    }
  }
}
