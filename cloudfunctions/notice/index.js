// 云函数 - 公告服务（@cloudbase/node-sdk 访问云 MySQL sys_notice 表）
//
// 职责：公告（sys_notice）管理端唯一读写入口，供部门工作台「公告」Tab 使用。
//
// 权限模型：与部门工作台其他管理页一致
//   openid -> sys_emp.role_id -> sys_role_location -> location_id[]（食堂），
//   所有读写限定在角色管辖的食堂范围内（sysAdmin 为全部食堂）。
//   身份一律取自云函数上下文 OPENID，不信任前端传入的 role / location 参数。

const cloud = require('wx-server-sdk')
const cloudbaseSDK = require('@cloudbase/node-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const cloudbase = cloudbaseSDK.init({
  env: cloudbaseSDK.SYMBOL_CURRENT_ENV
})
const models = cloudbase.models

// ──────────────────────────────────────────────────────────────────
// 基础工具：SQL / 日期
// ──────────────────────────────────────────────────────────────────

/**
 * 执行 SQL 查询，返回行数组
 */
async function query(sql, params = {}) {
  try {
    const result = await models.$runSQL(sql, params)
    return (result && result.data && result.data.executeResultList) || []
  } catch (err) {
    console.error(
      '[notice][DEBUG] $runSQL SELECT FAILED:',
      err.message || err,
      '\nSQL:', sql,
      '\nPARAMS:', JSON.stringify(params)
    )
    throw err
  }
}

/**
 * 执行 SQL 写操作
 * @returns {Promise<number>} 受影响行数
 */
async function update(sql, params = {}) {
  try {
    const result = await models.$runSQL(sql, params)
    return (result && result.data && result.data.total) || 0
  } catch (err) {
    console.error(
      '[notice][DEBUG] $runSQL WRITE FAILED:',
      err.message || err,
      '\nSQL:', sql,
      '\nPARAMS:', JSON.stringify(params)
    )
    throw err
  }
}

const pad2 = n => (n < 10 ? '0' + n : String(n))

/**
 * 归一化日期时间为 `YYYY-MM-DD HH:mm:ss`
 * 兼容 Date 对象、"YYYY-MM-DD HH:mm:ss"、"YYYY-MM-DD HH:mm"、"YYYY-MM-DD"、"YYYY/MM/DD" 等
 * @returns {string} 非法/空值返回 ''
 */
function normalizeDateTime(value) {
  if (value == null || value === '') return ''
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())} ` +
      `${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`
  }
  const m = String(value).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (!m) return ''
  return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))} ` +
    `${pad2(Number(m[4] || 0))}:${pad2(Number(m[5] || 0))}:${pad2(Number(m[6] || 0))}`
}

// ──────────────────────────────────────────────────────────────────
// 权限解析：openid -> role_id -> location_id[]（食堂）
// ──────────────────────────────────────────────────────────────────

/**
 * 根据 openid 反查身份：role_id + emp_id + role_code（一次查询）
 * 未查到角色或员工被禁用（sys_emp.status=0）时 roleId = 0、roleCode = ''
 */
async function resolveIdentity(openid) {
  if (!openid) return { roleId: 0, empId: 0, roleCode: '' }
  const emps = await query(
    'SELECT e.`id`, e.`role_id`, COALESCE(r.`code`, \'\') AS role_code ' +
    'FROM `sys_emp` e ' +
    'LEFT JOIN `sys_role` r ON r.`id` = e.`role_id` AND r.`status` = 1 ' +
    'WHERE e.`_openid` = {{openid}} AND e.`status` = 1 LIMIT 1',
    { openid }
  )
  if (!emps.length) return { roleId: 0, empId: 0, roleCode: '' }
  const rawRoleId = Number(emps[0].role_id) || 0
  const roleCode = String(emps[0].role_code || '')
  return {
    roleId: roleCode ? rawRoleId : 0,
    empId: Number(emps[0].id) || 0,
    roleCode,
  }
}

/**
 * 根据 openid 反查角色关联的食堂 location_id 列表
 * 返回 Number(location_id) 数组；无角色/未配置食堂时返回 []
 */
async function resolveRoleLocations(openid) {
  const { roleId, roleCode } = await resolveIdentity(openid)
  if (!roleId) return []
  if (roleCode === 'sysAdmin') {
    const all = await query('SELECT `id` FROM `sys_location`')
    return all.map(r => Number(r.id)).filter(id => id > 0)
  }
  const rows = await query(
    'SELECT `location_id` FROM `sys_role_location` WHERE `role_id` = {{role_id}}',
    { role_id: roleId }
  )
  return rows.map(r => Number(r.location_id)).filter(id => id > 0)
}

/**
 * 校验目标食堂是否在角色管辖范围内（sysAdmin 为全部食堂）
 */
async function isLocationInRoleScope(openid, locationId) {
  if (!locationId || locationId <= 0) return false
  const ids = await resolveRoleLocations(openid)
  return ids.includes(locationId)
}

/**
 * 批量查询发布人姓名：created_by(sys_emp.id) -> name
 * @param {Array<number>} empIds
 * @returns {Promise<Object>} { [empId]: name }
 */
async function resolveEmpNames(empIds) {
  const ids = Array.from(new Set((empIds || []).map(id => Number(id)).filter(id => id > 0)))
  if (!ids.length) return {}
  const params = {}
  const ph = ids.map((id, i) => {
    params['eid' + i] = id
    return `{{eid${i}}}`
  }).join(', ')
  const rows = await query(
    'SELECT `id`, `name` FROM `sys_emp` WHERE `id` IN (' + ph + ')',
    params
  )
  const map = {}
  rows.forEach(r => {
    const id = Number(r.id) || 0
    if (id > 0) map[id] = (r.name && String(r.name)) || ''
  })
  return map
}

// ──────────────────────────────────────────────────────────────────
// Action: getNoticeList（管理端）
//   入参：{
//     location_id,                   // 必填，归属食堂
//     keyword?: string,              // 可选：按 title / content 做 LIKE 模糊匹配（最大 50 字符）
//     status?: 0 | 1 | 'all',        // 可选：'all'=不按状态过滤（默认），1=已发布，0=草稿
//   }
//   出参：{ location_id, list: [{ id, title, content, status, publish_time,
//                                created_by, created_by_name, created_at, updated_at }] }
//   语义：按发布时间倒序返回该食堂的公告（按入参再叠加关键词 / 状态筛选）。
//         系统管理员（sysAdmin）可查看该食堂全部公告；
//         其他角色（部门管理员等）只能看到 created_by 为自己的公告。
// ──────────────────────────────────────────────────────────────────
async function actionGetNoticeList(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const locationId = Number(event.location_id) || 0
  if (locationId <= 0) return { code: -1, message: '请选择食堂', data: null }
  if (!await isLocationInRoleScope(openid, locationId)) {
    return { code: -1, message: '无权查看该食堂的公告', data: null }
  }

  // ── 身份：非系统管理员只显示自己发布的公告 ──
  const { empId, roleCode } = await resolveIdentity(openid)
  const isSysAdmin = roleCode === 'sysAdmin'

  // ── 状态筛选：'all' / 1 / 0，其它值统一视作 'all' ──
  const statusRaw = event.status
  const statusVal = (statusRaw === 1 || statusRaw === '1' || statusRaw === 0 || statusRaw === '0')
    ? Number(statusRaw)
    : 'all'

  // ── 关键词筛选：trim + 截断 50 字符；%...% 放进参数值，靠 {{kw_like}} 占位符防注入
  const rawKw = (event.keyword != null ? String(event.keyword) : '').trim().slice(0, 50)
  const hasKw = rawKw.length > 0
  const kwLike = hasKw ? '%' + rawKw + '%' : ''

  // ── 动态拼 WHERE：location_id 始终过滤；status / keyword 按需追加 ──
  let where = 'WHERE `location_id` = {{location_id}}'
  const params = { location_id: locationId }
  if (statusVal !== 'all') {
    where += ' AND `status` = {{status}}'
    params.status = statusVal
  }
  if (hasKw) {
    where += ' AND (`title` LIKE {{kw_like}} OR `content` LIKE {{kw_like}})'
    params.kw_like = kwLike
  }
  // 部门管理员：只显示发布人是自己的公告
  if (!isSysAdmin) {
    if (empId <= 0) {
      return { code: -1, message: '未找到您的员工信息，请联系管理员', data: null }
    }
    where += ' AND `created_by` = {{created_by}}'
    params.created_by = empId
  }

  const rows = await query(
    'SELECT `id`, `title`, `content`, `status`, `publish_time`, ' +
    '`created_by`, `created_at`, `updated_at`, `location_id` ' +
    'FROM `sys_notice` ' + where + ' ' +
    'ORDER BY `publish_time` DESC, `id` DESC',
    params
  )

  // 发布人姓名批量补齐（避免 N+1）
  const nameMap = await resolveEmpNames(rows.map(r => r.created_by))

  const list = rows.map(r => ({
    id: Number(r.id),
    title: (r.title && String(r.title)) || '',
    content: (r.content && String(r.content)) || '',
    status: Number(r.status) === 1 ? 1 : 0,
    publish_time: normalizeDateTime(r.publish_time),
    created_by: Number(r.created_by) || 0,
    created_by_name: nameMap[Number(r.created_by)] || '',
    created_at: normalizeDateTime(r.created_at),
    updated_at: normalizeDateTime(r.updated_at),
    location_id: Number(r.location_id) || 0,
  }))

  return {
    code: 0,
    message: 'success',
    data: { location_id: locationId, list },
  }
}

// ──────────────────────────────────────────────────────────────────
// Action: saveNotice（管理端）
//   入参：{ id?(0/空=新增), title, content, status, location_id, publish_time? }
//   出参：{ id }
//   语义：upsert sys_notice。
//         - status=1 且未传 publish_time 时由数据库 NOW() 生成；
//         - status=0（草稿）时保留传入的发布时间，未传则置空（publish_time = NULL）；
//         - created_by 取调用者 sys_emp.id，_openid 记为最近操作人。
// ──────────────────────────────────────────────────────────────────
async function actionSaveNotice(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const { empId } = await resolveIdentity(openid)
  if (empId <= 0) {
    return { code: -1, message: '未找到您的员工信息，请联系管理员', data: null }
  }

  const id = Number(event.id) || 0
  const title = (event.title != null ? String(event.title) : '').trim()
  const content = (event.content != null ? String(event.content) : '').trim()
  const locationId = Number(event.location_id) || 0
  const status = Number(event.status) === 1 ? 1 : 0

  if (!title) return { code: -1, message: '请填写公告标题', data: null }
  if (title.length > 100) return { code: -1, message: '公告标题不能超过 100 个字符', data: null }
  if (!content) return { code: -1, message: '请填写公告内容', data: null }
  if (locationId <= 0) return { code: -1, message: '请选择食堂', data: null }
  if (!await isLocationInRoleScope(openid, locationId)) {
    return { code: -1, message: '无权管理该食堂的公告', data: null }
  }

  const publishTime = normalizeDateTime(event.publish_time)
  let publishTimeExpr
  let publishTimeParams
  if (publishTime) {
    publishTimeExpr = '{{publish_time}}'
    publishTimeParams = { publish_time: publishTime }
  } else if (status === 1) {
    publishTimeExpr = 'NOW()'
    publishTimeParams = {}
  } else {
    publishTimeExpr = 'NULL'
    publishTimeParams = {}
  }

  let noticeId = id
  if (noticeId > 0) {
    // 编辑：原公告须存在，且原食堂与目标食堂都在管辖范围内
    const old = await query(
      'SELECT `location_id` FROM `sys_notice` WHERE `id` = {{id}} LIMIT 1',
      { id: noticeId }
    )
    if (!old.length) return { code: -1, message: '公告不存在', data: null }
    if (!await isLocationInRoleScope(openid, Number(old[0].location_id) || 0)) {
      return { code: -1, message: '无权编辑该公告', data: null }
    }
    await update(
      'UPDATE `sys_notice` SET `title` = {{title}}, `content` = {{content}}, ' +
      '`status` = {{status}}, `publish_time` = ' + publishTimeExpr + ', ' +
      '`location_id` = {{location_id}}, `_openid` = {{openid}}, `updated_at` = NOW() ' +
      'WHERE `id` = {{id}}',
      {
        title,
        content,
        status,
        location_id: locationId,
        openid,
        id: noticeId,
        ...publishTimeParams,
      }
    )
  } else {
    await update(
      'INSERT INTO `sys_notice` ' +
      '(`title`, `content`, `status`, `publish_time`, `created_by`, `created_at`, `updated_at`, `_openid`, `location_id`) ' +
      'VALUES ({{title}}, {{content}}, {{status}}, ' + publishTimeExpr + ', ' +
      '{{created_by}}, NOW(), NOW(), {{openid}}, {{location_id}})',
      {
        title,
        content,
        status,
        created_by: empId,
        openid,
        location_id: locationId,
        ...publishTimeParams,
      }
    )
    const created = await query(
      'SELECT `id` FROM `sys_notice` WHERE `location_id` = {{location_id}} ' +
      'AND `title` = {{title}} ORDER BY `id` DESC LIMIT 1',
      { location_id: locationId, title }
    )
    if (!created.length) return { code: -1, message: '公告创建失败，请重试', data: null }
    noticeId = Number(created[0].id) || 0
  }

  return { code: 0, message: 'success', data: { id: noticeId } }
}

// ──────────────────────────────────────────────────────────────────
// Action: deleteNotice（管理端）
//   入参：{ id }
//   语义：删除公告，仅限角色管辖食堂内的公告
// ──────────────────────────────────────────────────────────────────
async function actionDeleteNotice(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const id = Number(event.id) || 0
  if (id <= 0) return { code: -1, message: '缺少公告 id', data: null }

  const rows = await query(
    'SELECT `location_id` FROM `sys_notice` WHERE `id` = {{id}} LIMIT 1',
    { id }
  )
  if (!rows.length) return { code: -1, message: '公告不存在', data: null }
  if (!await isLocationInRoleScope(openid, Number(rows[0].location_id) || 0)) {
    return { code: -1, message: '无权删除该公告', data: null }
  }

  await update('DELETE FROM `sys_notice` WHERE `id` = {{id}}', { id })

  return { code: 0, message: 'success', data: null }
}

// ──────────────────────────────────────────────────────────────────
// Action: getLatestNotice（员工端 / 首页）
//   入参：{ location_id?: number, dept_id?: number }
//   出参：{ code, message, data: { id, title, content, status,
//                                 publish_time, created_by, created_by_name,
//                                 created_at, updated_at, location_id } | null }
//   语义：返回某食堂最新一条已发布（status=1 且 publish_time <= NOW()）的公告。
// ──────────────────────────────────────────────────────────────────
async function actionGetLatestNotice(event) {
  let { location_id, dept_id } = event || {}

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
    'SELECT `id`, `title`, `content`, `status`, `publish_time`, ' +
    '`created_by`, `created_at`, `updated_at`, `location_id` ' +
    'FROM `sys_notice` ' +
    'WHERE `status` = 1 AND `publish_time` <= NOW() AND `location_id` = {{location_id}} ' +
    'ORDER BY `publish_time` DESC, `id` DESC LIMIT 1',
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
      createdByName = String(empRows[0].name)
    }
  }

  return {
    code: 0,
    message: 'success',
    data: {
      id: Number(notice.id),
      title: (notice.title && String(notice.title)) || '',
      content: (notice.content && String(notice.content)) || '',
      status: Number(notice.status) === 1 ? 1 : 0,
      publish_time: normalizeDateTime(notice.publish_time),
      created_by: Number(notice.created_by) || 0,
      created_by_name: createdByName,
      created_at: normalizeDateTime(notice.created_at),
      updated_at: normalizeDateTime(notice.updated_at),
      location_id: Number(notice.location_id) || 0,
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// 入口
// ──────────────────────────────────────────────────────────────────
exports.main = async (event, context) => {
  const { action } = event || {}
  try {
    switch (action) {
      case 'getNoticeList':   return await actionGetNoticeList(event)
      case 'saveNotice':      return await actionSaveNotice(event)
      case 'deleteNotice':    return await actionDeleteNotice(event)
      case 'getLatestNotice': return await actionGetLatestNotice(event)
      default:
        return { code: -1, message: `未知 action: ${action}`, data: null }
    }
  } catch (err) {
    // 详细错误只进日志（query/update 已在上层打印完整 SQL 与参数）
    console.error('[notice] error:', err)
    console.error('[notice] error stack:', err && err.stack)
    // 对外只给统一中文提示，避免把 $runSQL 的英文原始错误直接甩给用户
    return { code: -1, message: '操作失败，请重试', data: null }
  }
}
