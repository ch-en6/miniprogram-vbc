// 云函数 - 部门管理后台（@cloudbase/node-sdk 访问云 MySQL）
//
// 职责：部门工作台「统计范围 / 收费 / 员工管理」的后端能力——
//
const cloud = require('wx-server-sdk')
const cloudbaseSDK = require('@cloudbase/node-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const cloudbase = cloudbaseSDK.init({
  env: cloudbaseSDK.SYMBOL_CURRENT_ENV
})
const models = cloudbase.models

// meal_type 数值 -> 中文餐别
const MEAL_TYPE_LABEL_CN = {
  0: '早餐',
  1: '午餐',
  2: '晚餐',
}

/**
 * 执行 SQL 查询，返回行数组
 */
async function query(sql, params = {}) {
  try {
    const result = await models.$runSQL(sql, params)
    return (result && result.data && result.data.executeResultList) || []
  } catch (err) {
    console.error(
      '[deptAdmin][DEBUG] $runSQL SELECT FAILED:',
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
      '[deptAdmin][DEBUG] $runSQL WRITE FAILED:',
      err.message || err,
      '\nSQL:', sql,
      '\nPARAMS:', JSON.stringify(params)
    )
    throw err
  }
}

// ──────────────────────────────────────────────────────────────────
// 权限解析：openid -> role_id -> location_id[] -> dept_id[]
// ──────────────────────────────────────────────────────────────────

/**
 * 根据 openid 反查身份：role_id + emp_id + role_code（一次查询）
 * 返回 { roleId, empId, roleCode }；未查到角色或员工被禁用（sys_emp.status=0）时
 * roleId = 0、roleCode = ''（禁用员工在已登录缓存会话下也不得再操作后台）
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
 * 根据角色关联的食堂，解析其下全部部门 id 列表
 * 注意：sysAdmin 全局，恒返回全部部门（含未挂食堂的历史部门）
 */
async function resolveRoleDeptIds(openid) {
  const { roleId, roleCode } = await resolveIdentity(openid)
  if (!roleId) return []
  if (roleCode === 'sysAdmin') {
    const all = await query('SELECT `id` FROM `sys_dept`')
    return all.map(r => Number(r.id)).filter(id => id > 0)
  }
  const rows = await query(
    'SELECT `location_id` FROM `sys_role_location` WHERE `role_id` = {{role_id}}',
    { role_id: roleId }
  )
  const locations = rows.map(r => Number(r.location_id)).filter(id => id > 0)
  if (!locations.length) return []
  const { ph, params } = buildLocClause(locations)
  const deptRows = await query(
    'SELECT `id` FROM `sys_dept` WHERE `location_id` IN (' + ph + ')',
    params
  )
  return deptRows.map(r => Number(r.id)).filter(id => id > 0)
}

// 生成 location/dept 范围过滤：IN 占位符 + 对应参数（数量动态，走预编译防注入）
function buildLocClause(locations) {
  const ph = locations.map((_, i) => `{{loc${i}}}`).join(', ')
  const params = {}
  locations.forEach((loc, i) => { params['loc' + i] = loc })
  return { ph, params }
}

// ──────────────────────────────────────────────────────────────────
// Action: getMyDepts
// ──────────────────────────────────────────────────────────────────
async function actionGetMyDepts() {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''
  const { roleId, roleCode } = await resolveIdentity(openid)
  const isSysAdmin = !!roleId && roleCode === 'sysAdmin'
  const locations = await resolveRoleLocations(openid)
  if (!locations.length) {
    return { code: 0, message: 'success', data: { locations: [], depts: [] } }
  }
  const { ph: locPh, params: locParams } = buildLocClause(locations)

  // 1. 角色管理的食堂（sysAdmin 经 resolveRoleLocations 已得到全部食堂）
  const locRows = await query(
    'SELECT `id`, `name`, `status` FROM `sys_location` WHERE `id` IN (' + locPh + ')',
    locParams
  )
  const locationsInfo = locRows.map(r => ({
    id: Number(r.id),
    name: (r.name && String(r.name)) || '',
    status: Number(r.status) || 0,
  }))

  // 2. 部门列表（sys_dept.location_id 指向食堂）
  const deptRows = isSysAdmin
    ? await query(
        'SELECT `id`, `name`, `location_id`, `status` FROM `sys_dept` ' +
        'ORDER BY `location_id` ASC, `id` ASC'
      )
    : await query(
        'SELECT `id`, `name`, `location_id`, `status` FROM `sys_dept` ' +
        'WHERE `location_id` IN (' + locPh + ') ' +
        'ORDER BY `location_id` ASC, `id` ASC',
        locParams
      )
  const depts = deptRows.map(r => ({
    dept_id: Number(r.id),
    dept_name: (r.name && String(r.name)) || '',
    location_id: Number(r.location_id) || 0,
    status: Number(r.status) || 0,
  }))

  return { code: 0, message: 'success', data: { locations: locationsInfo, depts } }
}

// ──────────────────────────────────────────────────────────────────
// Action: getMonthBilling
// ──────────────────────────────────────────────────────────────────
async function actionGetMonthBilling(event) {
  const month = event.month ? String(event.month).trim() : ''
  const m = month.match(/^(\d{4})-(\d{1,2})$/)
  if (!m) {
    return { code: -1, message: 'month 参数格式应为 YYYY-MM', data: null }
  }
  const year = Number(m[1])
  const month1 = Number(m[2])
  const pad = n => (n < 10 ? '0' + n : n)
  const startDate = `${year}-${pad(month1)}-01`
  const endDate = `${year}-${pad(month1)}-${pad(new Date(year, month1, 0).getDate())}`

  const dept_id = Number(event.dept_id) || 0
  if (dept_id <= 0) {
    return { code: -1, message: '缺少部门参数', data: null }
  }

  const wxContext = cloud.getWXContext() || {}
  const deptIds = await resolveRoleDeptIds(wxContext.OPENID || '')
  if (!deptIds.length || !deptIds.includes(dept_id)) {
    // 无角色食堂范围 / 部门不在角色范围内：静默降级返回空账单
    return {
      code: 0, message: 'success',
      data: { month, dept_id, dept_name: '', list: [], totalAmount: 0 },
    }
  }

  // 部门名（展示用）
  const deptRows = await query(
    'SELECT `name` FROM `sys_dept` WHERE `id` = {{dept_id}} LIMIT 1',
    { dept_id }
  )
  const dept_name = deptRows.length ? String(deptRows[0].name || '') : ''

  const rows = await query(
    'SELECT mo.`emp_id`, COALESCE(e.`name`, \'\') AS name, mo.`meal_type`, ' +
    '       COUNT(*) AS days, ' +
    '       SUM(mo.`quantity`) AS qty, ' +
    '       SUM(GREATEST(mo.`quantity` - 1, 0)) AS family, ' +
    '       MAX(mo.`emp_price`) AS emp_price, ' +
    '       MAX(mo.`family_price`) AS family_price, ' +
    '       SUM(mo.`emp_price`) AS emp_amount, ' +
    '       SUM(GREATEST(mo.`quantity` - 1, 0) * mo.`family_price`) AS fam_amount ' +
    'FROM `meal_order` mo ' +
    'LEFT JOIN `sys_emp` e ON e.`id` = mo.`emp_id` ' +
    'WHERE mo.`meal_date` BETWEEN {{startDate}} AND {{endDate}} ' +
    '  AND mo.`quantity` > 0 ' +
    '  AND e.`dept_id` = {{dept_id}} ' +
    'GROUP BY mo.`emp_id`, e.`name`, mo.`meal_type` ' +
    'ORDER BY mo.`emp_id` ASC, mo.`meal_type` ASC',
    { startDate, endDate, dept_id }
  )

  // 金额统一保留两位小数精度（展示值），避免浮点误差
  const round2 = n => Math.round(n * 100) / 100

  const list = rows.map(r => {
    const emp_amount = round2(Number(r.emp_amount) || 0)
    const fam_amount = round2(Number(r.fam_amount) || 0)
    const meal_type = Number(r.meal_type)
    return {
      id: `${r.emp_id}_${meal_type}`, // wx:key
      name: r.name || '',
      mealLabel: MEAL_TYPE_LABEL_CN[meal_type] || '',
      qty: Number(r.qty) || 0,
      family: Number(r.family) || 0,
      empPrice: round2(Number(r.emp_price) || 0),
      familyPrice: round2(Number(r.family_price) || 0),
      empAmount: emp_amount,
      famAmount: fam_amount,
      amount: round2(emp_amount + fam_amount),
    }
  })

  const totalAmount = round2(list.reduce((sum, it) => sum + it.amount, 0))

  return { code: 0, message: 'success', data: { month, dept_id, dept_name, list, totalAmount } }
}

// ──────────────────────────────────────────────────────────────────
// 员工管理公共模块
//   权限模型：openid -> sys_emp.role_id -> sys_role_location -> location_id[]
//           -> sys_dept.id[]（角色可管理部门）
//           所有员工增删改查的目标 dept_id 必须落在角色范围内；
//           不在范围时静默或显式报错（按调用方语义选择）。
// ──────────────────────────────────────────────────────────────────

// SHA-256 + salt 密码哈希
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex')
}

// 生成员工初始密码
//  返回 { password, password_hash, password_salt }
//  password       = 明文初始密码，仅此次返回（前端弹窗展示一次，之后不可再读）
//  password_hash  = pbkdf2(明文, salt) 哈希，`password` 入库字段使用该值
function genStaffPassword() {
  const password = String(Math.floor(10000000 + Math.random() * 90000000)) // 8 位数字
  const password_salt = crypto.randomBytes(16).toString('hex') // 16 字符
  const password_hash = hashPassword(password, password_salt)
  return { password, password_hash, password_salt }
}

// 校验目标 dept_id 是否在角色范围内
async function isDeptInRoleScope(openid, dept_id) {
  if (!dept_id || dept_id <= 0) return false
  const ids = await resolveRoleDeptIds(openid)
  return ids.some(id => id === dept_id)
}

// 根据员工 id 反查 dept_id；未找到返回 0
async function fetchEmpDeptId(empId) {
  const rows = await query(
    'SELECT `dept_id` FROM `sys_emp` WHERE `id` = {{id}} LIMIT 1',
    { id: empId }
  )
  if (!rows.length) return 0
  return Number(rows[0].dept_id) || 0
}

// ──────────────────────────────────────────────────────────────────
// 员工身份(role)公共模块
// ──────────────────────────────────────────────────────────────────

// 食堂是否在营业（sys_location.status = 1）；食堂不存在视为停用（判定从严）
async function isLocationEnabled(locationId) {
  if (!locationId || locationId <= 0) return false
  const rows = await query(
    'SELECT `status` FROM `sys_location` WHERE `id` = {{id}} LIMIT 1',
    { id: locationId }
  )
  if (!rows.length) return false
  return Number(rows[0].status) === 1
}

// 一组食堂是否全部在营业；列表为空 / 任一停用（或不存在）即返回 false
async function areAllLocationsEnabled(locationIds) {
  const ids = (locationIds || []).map(Number).filter(id => id > 0)
  if (!ids.length) return false
  for (const id of ids) {
    if (!await isLocationEnabled(id)) return false
  }
  return true
}

// 部门是否启用（sys_dept.status = 1）；部门不存在视为停用（判定从严）
async function isDeptEnabled(deptId) {
  if (!deptId || deptId <= 0) return false
  const rows = await query(
    'SELECT `status` FROM `sys_dept` WHERE `id` = {{id}} LIMIT 1',
    { id: deptId }
  )
  if (!rows.length) return false
  return Number(rows[0].status) === 1
}

// 查询角色信息：{ roleId, code, locationIds }；角色不存在或已停用（status=0）返回 null
async function fetchRoleInfo(roleId) {
  const codeRows = await query(
    'SELECT `code` FROM `sys_role` WHERE `id` = {{id}} AND `status` = 1 LIMIT 1',
    { id: roleId }
  )
  if (!codeRows.length) return null
  const locRows = await query(
    'SELECT `location_id` FROM `sys_role_location` WHERE `role_id` = {{role_id}}',
    { role_id: roleId }
  )
  return {
    roleId: Number(roleId),
    code: String(codeRows[0].code || ''),
    locationIds: locRows.map(r => Number(r.location_id)).filter(id => id > 0),
  }
}

// ──────────────────────────────────────────────────────────────────
// 角色分配白名单
// ──────────────────────────────────────────────────────────────────
const STAFF_MGMT_ROLE_CODES = ['deptAdmin', 'sysAdmin']
const ASSIGNABLE_CODES_BY_OPERATOR = {
  deptAdmin: ['employee', 'kitchen'],
  sysAdmin: ['employee', 'kitchen', 'deptAdmin', 'sysAdmin'],
}

// 操作者是否为可管理员工并分配角色的角色
function canManageStaff(roleCode) {
  return STAFF_MGMT_ROLE_CODES.includes(roleCode)
}

// 校验操作者能否把员工设为 roleId 角色
async function canAssignRole(openid, operatorCode, roleId) {
  if (!operatorCode || !roleId || roleId <= 0) return false
  const allowedCodes = ASSIGNABLE_CODES_BY_OPERATOR[operatorCode] || []
  if (!allowedCodes.length) return false
  const role = await fetchRoleInfo(roleId)
  if (!role || !role.code || !allowedCodes.includes(role.code)) return false
  // 全局角色：employee / sysAdmin 不校验食堂绑定
  if (role.code === 'employee' || role.code === 'sysAdmin') return true
  // 食堂绑定角色：绑定食堂须非空、全部在操作者管辖范围内、且全部营业中
  if (!role.locationIds.length) return false
  const scope = await resolveRoleLocations(openid)
  if (!role.locationIds.every(id => scope.includes(id))) return false
  return await areAllLocationsEnabled(role.locationIds)
}

// ──────────────────────────────────────────────────────────────────
// Action: getStaffList
//   入参：{ dept_id, keyword }
//     - dept_id = 0 表示「角色范围内全部部门」（汇总视图）
//     - keyword 模糊匹配 name / phone
// ──────────────────────────────────────────────────────────────────
async function actionGetStaffList(event) {
  const wxContext = cloud.getWXContext() || {}
  const deptIds = await resolveRoleDeptIds(wxContext.OPENID || '')
  if (!deptIds.length) {
    return { code: 0, message: 'success', data: { list: [] } }
  }
  const { ph, params } = buildLocClause(deptIds)

  const deptId = Number(event.dept_id) || 0
  if (deptId > 0 && !deptIds.includes(deptId)) {
    return { code: -1, message: '无权查看该部门员工', data: null }
  }

  const where = ['e.`dept_id` IN (' + ph + ')']
  const sqlParams = { ...params }
  if (deptId > 0) {
    where.push('e.`dept_id` = {{dept_id}}')
    sqlParams.dept_id = deptId
  }
  const keyword = (event.keyword != null ? String(event.keyword) : '').trim()
  if (keyword) {
    where.push('(e.`name` LIKE {{kw}} OR e.`phone` LIKE {{kw}})')
    sqlParams.kw = '%' + keyword + '%'
  }

  const rows = await query(
    'SELECT e.`id`, e.`name`, e.`phone`, e.`dept_id`, e.`role_id`, e.`status`, ' +
    '       e.`created_at`, e.`updated_at`, e.`_openid`, ' +
    '       COALESCE(d.`name`, \'未分配\') AS dept_name, ' +
    '       COALESCE(r.`name`, \'\') AS role_name, ' +
    '       COALESCE(r.`code`, \'\') AS role_code ' +
    'FROM `sys_emp` e ' +
    'LEFT JOIN `sys_dept` d ON d.`id` = e.`dept_id` ' +
    'LEFT JOIN `sys_role` r ON r.`id` = e.`role_id` ' +
    'WHERE ' + where.join(' AND ') + ' ' +
    'ORDER BY e.`dept_id` ASC, e.`id` ASC',
    sqlParams
  )

  const list = rows.map(r => ({
    id: Number(r.id),
    name: (r.name && String(r.name)) || '',
    phone: (r.phone && String(r.phone)) || '',
    dept_id: Number(r.dept_id) || 0,
    dept_name: (r.dept_name && String(r.dept_name)) || '',
    role_name: (r.role_name && String(r.role_name)) || '',
    role_code: (r.role_code && String(r.role_code)) || '',
    role_id: Number(r.role_id) || 0,
    status: Number(r.status) === 1 ? 1 : 0,
    has_openid: !!(r._openid && String(r._openid).length),
    created_at: r.created_at || '',
    updated_at: r.updated_at || '',
  }))

  return { code: 0, message: 'success', data: { list } }
}

// ──────────────────────────────────────────────────────────────────
// Action: addStaff
//   入参：{ name, phone, dept_id, status, role_id }
//   出参：{ id, password }
//   备注：初始密码 8 位随机数字，仅此次返回（前端弹窗告知用户保存）
// ──────────────────────────────────────────────────────────────────
async function actionAddStaff(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const name = (event.name != null ? String(event.name) : '').trim()
  const phone = (event.phone != null ? String(event.phone) : '').trim()
  const dept_id = Number(event.dept_id) || 0
  const status = Number(event.status) === 0 ? 0 : 1
  const role_id = Number(event.role_id) || 0

  if (!name)        return { code: -1, message: '请填写姓名', data: null }
  if (!phone)       return { code: -1, message: '请填写手机号', data: null }
  if (!/^1\d{10}$/.test(phone)) {
    return { code: -1, message: '手机号格式不正确', data: null }
  }
  if (dept_id <= 0) return { code: -1, message: '请选择部门', data: null }
  if (!await isDeptInRoleScope(openid, dept_id)) {
    return { code: -1, message: '无权在该部门下添加员工', data: null }
  }
  // 停用部门不再进新人：目标部门已停用（sys_dept.status=0）时拒绝
  if (!await isDeptEnabled(dept_id)) {
    return { code: -1, message: '该部门已停用，无法新增员工', data: null }
  }

  // 手机号全系统唯一
  const dup = await query(
    'SELECT `id` FROM `sys_emp` WHERE `phone` = {{phone}} LIMIT 1',
    { phone }
  )
  if (dup.length) {
    return { code: -1, message: '该手机号已被其他员工使用', data: null }
  }

  // 操作者权限：仅 deptAdmin / sysAdmin 可新增员工
  const { roleCode: opRoleCode } = await resolveIdentity(openid)
  if (!canManageStaff(opRoleCode)) {
    return { code: -1, message: '无权新增员工', data: null }
  }

  // 身份解析：新增必须显式指定可分配角色
  if (role_id <= 0) {
    return { code: -1, message: '请选择员工身份', data: null }
  }
  if (!await canAssignRole(openid, opRoleCode, role_id)) {
    return { code: -1, message: '所选身份不可分配（超出你的管辖食堂范围），无法创建', data: null }
  }
  const assignRoleId = role_id

  // 初始密码：8 位随机数字；password_hash 为 pbkdf2 哈希（与登录/改密一致），明文仅本次返回
  const { password, password_hash, password_salt } = genStaffPassword()
  // 未绑定微信 = _openid NULL（与解绑/登录绑定逻辑一致；uk_openid 唯一索引允许多个 NULL，避免空串占位冲突）
  const insertCols = ['`name`', '`phone`', '`dept_id`', '`_openid`', '`role_id`', '`password`', '`password_salt`', '`status`']
  const insertVals = ['{{name}}', '{{phone}}', '{{dept_id}}', 'NULL', '{{role_id}}', '{{password}}', '{{password_salt}}', '{{status}}']
  const insertParams = { name, phone, dept_id, role_id: assignRoleId, password: password_hash, password_salt, status }
  const inserted = await update(
    'INSERT INTO `sys_emp` (' + insertCols.join(', ') + ') ' +
    'VALUES (' + insertVals.join(', ') + ')',
    insertParams
  )
  // INSERT 正常必然影响 1 行；以受影响行数判定成功
  if (!inserted) {
    return { code: -1, message: '新增失败，请重试', data: null }
  }
  return { code: 0, message: 'success', data: { password } }
}

// ──────────────────────────────────────────────────────────────────
// Action: batchAddStaff
//   入参：{ dept_id, role_id, password, staff: [{ name, phone }] }（上限 100 条）
//   出参：{ total, successCount, failCount,
//           results: [{ line, name, phone, ok, message }] }
// ──────────────────────────────────────────────────────────────────
const BATCH_IMPORT_MAX = 100

async function actionBatchAddStaff(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const dept_id = Number(event.dept_id) || 0
  const role_id = Number(event.role_id) || 0
  const staffArr = Array.isArray(event.staff) ? event.staff : []

  if (dept_id <= 0) return { code: -1, message: '请选择部门', data: null }
  if (role_id <= 0) return { code: -1, message: '请选择员工身份', data: null }
  if (!staffArr.length) return { code: -1, message: '没有可导入的员工', data: null }
  if (staffArr.length > BATCH_IMPORT_MAX) {
    return { code: -1, message: `单次最多导入 ${BATCH_IMPORT_MAX} 名员工`, data: null }
  }

  if (!await isDeptInRoleScope(openid, dept_id)) {
    return { code: -1, message: '无权在该部门下添加员工', data: null }
  }
  if (!await isDeptEnabled(dept_id)) {
    return { code: -1, message: '该部门已停用，无法新增员工', data: null }
  }

  const { roleCode: opRoleCode } = await resolveIdentity(openid)
  if (!canManageStaff(opRoleCode)) {
    return { code: -1, message: '无权新增员工', data: null }
  }
  if (!await canAssignRole(openid, opRoleCode, role_id)) {
    return { code: -1, message: '所选身份不可分配', data: null }
  }

  const FIXED_PWD_RE = /^[\x21-\x7e]{8,20}$/
  const fixedPassword = event.password != null ? String(event.password) : ''
  if (!fixedPassword) {
    return { code: -1, message: '请填写统一初始密码', data: null }
  }
  if (!FIXED_PWD_RE.test(fixedPassword)) {
    return { code: -1, message: '统一密码须为 8-20 位字母、数字或符号（不含空格）', data: null }
  }
  const fixedPwdSalt = crypto.randomBytes(16).toString('hex')
  const fixedPwdHash = hashPassword(fixedPassword, fixedPwdSalt)

  // ── 逐行规范化 + 批内手机号去重（保留首见行号，报错可定位） ──
  const results = []
  const seen = new Map() // phone -> 首次出现的行号
  const valid = []
  staffArr.forEach((item, i) => {
    const line = i + 1
    const name = (item && item.name != null ? String(item.name) : '').trim().slice(0, 20)
    const phone = (item && item.phone != null ? String(item.phone) : '').trim()
    if (!name) {
      results.push({ line, name, phone, ok: false, message: '姓名为空' })
      return
    }
    if (!/^1\d{10}$/.test(phone)) {
      results.push({ line, name, phone, ok: false, message: '手机号格式不正确' })
      return
    }
    if (seen.has(phone)) {
      results.push({ line, name, phone, ok: false, message: `手机号与第 ${seen.get(phone)} 行重复` })
      return
    }
    seen.set(phone, line)
    valid.push({ line, name, phone })
  })

  if (valid.length) {
    // ── DB 手机号批量查重（一次 IN 查询，避免 N 次往返） ──
    const ph = valid.map((_, i) => `{{q${i}}}`).join(', ')
    const params = {}
    valid.forEach((s, i) => { params['q' + i] = s.phone })
    const dupRows = await query(
      'SELECT `phone` FROM `sys_emp` WHERE `phone` IN (' + ph + ')',
      params
    )
    const dbPhones = new Set(dupRows.map(r => String(r.phone || '')))

    const pending = []
    for (const s of valid) {
      if (dbPhones.has(s.phone)) {
        results.push({ line: s.line, name: s.name, phone: s.phone, ok: false, message: '该手机号已被其他员工使用' })
      } else {
        pending.push(s)
      }
    }

    // ── 逐条插入（单条失败不影响其余行；密码整批统一） ──
    for (const s of pending) {
      const password_hash = fixedPwdHash
      const password_salt = fixedPwdSalt
      try {
        const inserted = await update(
          'INSERT INTO `sys_emp` (`name`, `phone`, `dept_id`, `_openid`, `role_id`, `password`, `password_salt`, `status`) ' +
          'VALUES ({{name}}, {{phone}}, {{dept_id}}, NULL, {{role_id}}, {{password}}, {{password_salt}}, 1)',
          { name: s.name, phone: s.phone, dept_id, role_id, password: password_hash, password_salt }
        )
        if (inserted) {
          results.push({ line: s.line, name: s.name, phone: s.phone, ok: true })
        } else {
          results.push({ line: s.line, name: s.name, phone: s.phone, ok: false, message: '写入失败，请重试' })
        }
      } catch (err) {
        console.error('[deptAdmin][batchAddStaff] insert failed:', s.phone, err.message || err)
        results.push({ line: s.line, name: s.name, phone: s.phone, ok: false, message: '写入失败，请重试' })
      }
    }
  }

  // 按原行号排序，结果与粘贴顺序一致，便于对照
  results.sort((a, b) => a.line - b.line)
  const successCount = results.filter(r => r.ok).length
  return {
    code: 0,
    message: 'success',
    data: {
      total: staffArr.length,
      successCount,
      failCount: staffArr.length - successCount,
      results,
    },
  }
}

// ──────────────────────────────────────────────────────────────────
// Action: updateStaff
//   入参：{ id, name, phone, dept_id, status, role_id? }
// ──────────────────────────────────────────────────────────────────
async function actionUpdateStaff(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const id = Number(event.id) || 0
  const name = (event.name != null ? String(event.name) : '').trim()
  const phone = (event.phone != null ? String(event.phone) : '').trim()
  const dept_id = Number(event.dept_id) || 0
  const status = Number(event.status) === 0 ? 0 : 1

  if (id <= 0)      return { code: -1, message: '缺少员工 id', data: null }
  if (!name)        return { code: -1, message: '请填写姓名', data: null }
  if (!phone)       return { code: -1, message: '请填写手机号', data: null }
  if (!/^1\d{10}$/.test(phone)) {
    return { code: -1, message: '手机号格式不正确', data: null }
  }
  if (dept_id <= 0) return { code: -1, message: '请选择部门', data: null }

  // 读取员工当前归属与身份（一次查询）
  const oldRows = await query(
    'SELECT `dept_id`, `role_id`, `name`, `phone`, `status` FROM `sys_emp` WHERE `id` = {{id}} LIMIT 1',
    { id }
  )
  if (!oldRows.length) return { code: -1, message: '员工不存在', data: null }
  const oldDeptId = Number(oldRows[0].dept_id) || 0
  const oldRoleId = Number(oldRows[0].role_id) || 0
  const oldName = (oldRows[0].name != null ? String(oldRows[0].name) : '')
  const oldPhone = (oldRows[0].phone != null ? String(oldRows[0].phone) : '')
  const oldStatus = Number(oldRows[0].status) === 1 ? 1 : 0

  if (!await isDeptInRoleScope(openid, oldDeptId)) {
    return { code: -1, message: '无权编辑该员工', data: null }
  }
  if (dept_id !== oldDeptId && !await isDeptInRoleScope(openid, dept_id)) {
    return { code: -1, message: '无权将员工调整到该部门', data: null }
  }
  // 调岗到停用部门：拒绝
  if (dept_id !== oldDeptId && !await isDeptEnabled(dept_id)) {
    return { code: -1, message: '目标部门已停用', data: null }
  }

  // 手机号全系统唯一（排除自身）
  const dup = await query(
    'SELECT `id` FROM `sys_emp` WHERE `phone` = {{phone}} AND `id` <> {{id}} LIMIT 1',
    { phone, id }
  )
  if (dup.length) {
    return { code: -1, message: '该手机号已被其他员工使用', data: null }
  }

  // ── 身份(role_id)变更 ──
  const { roleCode: opRoleCode, empId: opEmpId } = await resolveIdentity(openid)
  if (!canManageStaff(opRoleCode)) {
    return { code: -1, message: '无权编辑员工身份', data: null }
  }

  const hasRoleSpec = event.role_id !== undefined && event.role_id !== null
    && String(event.role_id).trim() !== ''
  const specRoleId = hasRoleSpec ? (Number(event.role_id) || 0) : 0
  if (hasRoleSpec && specRoleId <= 0) {
    return { code: -1, message: '员工身份参数无效', data: null }
  }

  // 旧身份信息（role 行不存在视为未知，安全默认拒绝）
  const oldRoleInfo = oldRoleId > 0 ? await fetchRoleInfo(oldRoleId) : null
  const oldCode = oldRoleInfo ? oldRoleInfo.code : ''

  // 是否"意图"改变身份
  const intentChanged = hasRoleSpec && specRoleId !== oldRoleId

  if (intentChanged && id === opEmpId) {
    return { code: -1, message: '不能修改自己的员工身份', data: null }
  }
  if (id === opEmpId && Number(status) === 0) {
    return { code: -1, message: '不能停用自己的账号', data: null }
  }
  if (id === opEmpId && dept_id > 0 && dept_id !== Number(oldDeptId)) {
    return { code: -1, message: '不能调整自己的部门，请联系系统管理员', data: null }
  }

  // 1) 管理级角色员工（deptAdmin / sysAdmin）：所有敏感改动仅 sysAdmin 可执行
  if (opRoleCode !== 'sysAdmin' && oldRoleId > 0 && canManageStaff(oldCode)) {
    if (intentChanged) {
      return { code: -1, message: '无权修改该员工的管理角色', data: null }
    }
    const infoChanged = id !== opEmpId && (
      name !== String(oldName)
      || phone !== String(oldPhone)
      || Number(status) !== Number(oldStatus)
      || dept_id !== Number(oldDeptId)
    )
    if (infoChanged) {
      return { code: -1, message: '无权修改管理级账号的信息，请联系系统管理员', data: null }
    }
  }

  // 目标身份 role_id：不传保持原值
  let targetRoleId = oldRoleId
  if (hasRoleSpec) {
    // 身份发生变化时：按操作者等级白名单 + 角色绑定食堂范围校验（与新增同一套规则）
    if (specRoleId !== oldRoleId && !await canAssignRole(openid, opRoleCode, specRoleId)) {
      return { code: -1, message: '所选身份不可分配（超出你的管辖食堂范围）', data: null }
    }
    targetRoleId = specRoleId
  }

  const roleSetSql = targetRoleId > 0 ? '`role_id` = {{role_id}}' : '`role_id` = NULL'
  const updateParams = { name, phone, dept_id, status, id }
  if (targetRoleId > 0) updateParams.role_id = targetRoleId
  await update(
    'UPDATE `sys_emp` SET `name` = {{name}}, `phone` = {{phone}}, ' +
    '`dept_id` = {{dept_id}}, `status` = {{status}}, ' + roleSetSql + ', ' +
    '`updated_at` = NOW() WHERE `id` = {{id}}',
    updateParams
  )
  return { code: 0, message: 'success', data: null }
}

// ──────────────────────────────────────────────────────────────────
// Action: unbindStaffWechat
//   入参：{ id }
//   语义：清空 _openid（解绑微信），不影响其他字段
// ──────────────────────────────────────────────────────────────────
async function actionUnbindStaffWechat(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const id = Number(event.id) || 0
  if (id <= 0) return { code: -1, message: '缺少员工 id', data: null }

  const rows = await query(
    'SELECT `dept_id`, `_openid` FROM `sys_emp` WHERE `id` = {{id}} LIMIT 1',
    { id }
  )
  if (!rows.length) return { code: -1, message: '员工不存在', data: null }

  const deptId = Number(rows[0].dept_id) || 0
  if (!await isDeptInRoleScope(openid, deptId)) {
    return { code: -1, message: '无权操作该员工', data: null }
  }
  const { empId: opEmpId, roleCode: opRoleCode } = await resolveIdentity(openid)
  if (id === opEmpId) {
    return { code: -1, message: '不能解绑自己的微信', data: null }
  }
  // 管理级账号（deptAdmin / sysAdmin）：微信绑定的解绑仅 sysAdmin 可执行
  if (opRoleCode !== 'sysAdmin') {
    const roleRows = await query(
      'SELECT COALESCE(r.`code`, \'\') AS role_code FROM `sys_emp` e ' +
      'LEFT JOIN `sys_role` r ON r.`id` = e.`role_id` WHERE e.`id` = {{id}} LIMIT 1',
      { id }
    )
    const targetCode = roleRows.length ? String(roleRows[0].role_code || '') : ''
    if (canManageStaff(targetCode)) {
      return { code: -1, message: '无权操作管理级账号，请联系系统管理员', data: null }
    }
  }
  if (!rows[0]._openid) {
    return { code: 0, message: '该员工未绑定微信，无需解绑', data: null }
  }

  await update(
    'UPDATE `sys_emp` SET `_openid` = NULL, `updated_at` = NOW() WHERE `id` = {{id}}',
    { id }
  )
  return { code: 0, message: 'success', data: null }
}

// ──────────────────────────────────────────────────────────────────
// Action: resetStaffPassword
//   入参：{ id }
//   语义：重置为 8 位随机数字新密码，仅此次返回明文
// ──────────────────────────────────────────────────────────────────
async function actionResetStaffPassword(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const id = Number(event.id) || 0
  if (id <= 0) return { code: -1, message: '缺少员工 id', data: null }

  const deptId = await fetchEmpDeptId(id)
  if (!deptId) return { code: -1, message: '员工不存在', data: null }
  if (!await isDeptInRoleScope(openid, deptId)) {
    return { code: -1, message: '无权操作该员工', data: null }
  }
  const { empId: opEmpId, roleCode: opRoleCode } = await resolveIdentity(openid)
  if (id === opEmpId) {
    return { code: -1, message: '不能重置自己的密码，请在个人中心修改', data: null }
  }
  // 管理级账号（deptAdmin / sysAdmin）：密码重置仅 sysAdmin 可执行
  if (opRoleCode !== 'sysAdmin') {
    const roleRows = await query(
      'SELECT COALESCE(r.`code`, \'\') AS role_code FROM `sys_emp` e ' +
      'LEFT JOIN `sys_role` r ON r.`id` = e.`role_id` WHERE e.`id` = {{id}} LIMIT 1',
      { id }
    )
    const targetCode = roleRows.length ? String(roleRows[0].role_code || '') : ''
    if (canManageStaff(targetCode)) {
      return { code: -1, message: '无权重置管理级账号的密码，请联系系统管理员', data: null }
    }
  }

  const { password, password_hash, password_salt } = genStaffPassword()
  await update(
    'UPDATE `sys_emp` SET `password` = {{password}}, `password_salt` = {{password_salt}}, `updated_at` = NOW() WHERE `id` = {{id}}',
    { password: password_hash, password_salt, id }
  )
  return { code: 0, message: 'success', data: { password } }
}

// ──────────────────────────────────────────────────────────────────
// Action: deleteStaff
//   入参：{ id }
// ──────────────────────────────────────────────────────────────────
async function actionDeleteStaff(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const id = Number(event.id) || 0
  if (id <= 0) return { code: -1, message: '缺少员工 id', data: null }

  const rows = await query(
    'SELECT `dept_id`, `role_id` FROM `sys_emp` WHERE `id` = {{id}} LIMIT 1',
    { id }
  )
  if (!rows.length) return { code: -1, message: '员工不存在', data: null }

  const deptId = Number(rows[0].dept_id) || 0
  const roleId = Number(rows[0].role_id) || 0

  if (!await isDeptInRoleScope(openid, deptId)) {
    return { code: -1, message: '无权操作该员工', data: null }
  }

  const { roleCode: opRoleCode, empId: opEmpId } = await resolveIdentity(openid)
  if (!canManageStaff(opRoleCode)) {
    return { code: -1, message: '无权删除员工', data: null }
  }
  // 不能删除自己（防止删除后失去管理入口）
  if (id === opEmpId) {
    return { code: -1, message: '不能删除自己的账号', data: null }
  }
  const roleInfo = roleId > 0 ? await fetchRoleInfo(roleId) : null
  const roleCode = roleInfo ? String(roleInfo.code || '') : ''
  if (canManageStaff(roleCode) && opRoleCode !== 'sysAdmin') {
    return { code: -1, message: '无权删除管理级账号', data: null }
  }

  // 存在报餐记录则拒绝删除（历史账单按 emp_id 关联员工姓名）
  const orderRows = await query(
    'SELECT COUNT(*) AS cnt FROM `meal_order` WHERE `emp_id` = {{id}}',
    { id }
  )
  const orderCnt = Number((orderRows[0] || {}).cnt) || 0
  if (orderCnt > 0) {
    return { code: -1, message: '该员工存在报餐记录，无法删除，可改为禁用', data: null }
  }

  await update('DELETE FROM `sys_emp` WHERE `id` = {{id}}', { id })
  return { code: 0, message: 'success', data: null }
}

// ──────────────────────────────────────────────────────────────────
// Action: getAssignableRoles
//   入参：{ dept_id, role_id? }（role_id = 编辑中员工的当前身份，用于回补不可分配项）
//   出参：{ list: [{ role_id, role_code, role_name, preserved? }], operator_code }
//   语义：返回"当前操作者可在 dept_id 部门分配"的全部角色，供新增/编辑员工时选择身份。
//         deptAdmin -> 普通员工 + 其管辖食堂内的 kitchen 角色
//         sysAdmin  -> 普通员工 + kitchen + deptAdmin + sysAdmin（全局）
//         preserved = true：该员工原身份不在可分配范围内，仅回显保留（勿改动即保持原身份）。
//         operator_code 供前端决定 UI（如 deptAdmin 编辑管理级员工时隐藏身份区）。
// ──────────────────────────────────────────────────────────────────
async function actionGetAssignableRoles(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const dept_id = Number(event.dept_id) || 0
  if (dept_id <= 0) return { code: -1, message: '缺少部门参数', data: null }
  if (!await isDeptInRoleScope(openid, dept_id)) {
    return { code: -1, message: '无权操作该部门', data: null }
  }

  const { roleCode: opRoleCode } = await resolveIdentity(openid)
  if (!canManageStaff(opRoleCode)) {
    return { code: -1, message: '无权操作员工身份', data: null }
  }
  const allowedCodes = ASSIGNABLE_CODES_BY_OPERATOR[opRoleCode] || []
  if (!allowedCodes.length) {
    return { code: 0, message: 'success', data: { list: [], operator_code: opRoleCode } }
  }

  const { ph, params } = buildLocClause(allowedCodes)
  const rows = await query(
    'SELECT r.`id`, r.`code`, COALESCE(r.`name`, r.`code`) AS role_name, ' +
    '       rl.`location_id` ' +
    'FROM `sys_role` r ' +
    'LEFT JOIN `sys_role_location` rl ON rl.`role_id` = r.`id` ' +
    'WHERE r.`code` IN (' + ph + ') AND r.`status` = 1 ' +
    "ORDER BY FIELD(r.`code`, 'employee', 'kitchen', 'deptAdmin', 'sysAdmin'), r.`id` ASC",
    params
  )

  // 操作者管辖的食堂 id 列表（sysAdmin 为全部食堂），用于判定绑定角色可否分配
  const scope = await resolveRoleLocations(openid)

  // 按角色分组 locationIds
  const byRole = new Map()
  rows.forEach(r => {
    const rid = Number(r.id)
    if (!byRole.has(rid)) {
      byRole.set(rid, {
        role_id: rid,
        role_code: String(r.code || ''),
        role_name: (r.role_name && String(r.role_name)) || '',
        locationIds: [],
      })
    }
    const lid = Number(r.location_id)
    if (lid > 0) byRole.get(rid).locationIds.push(lid)
  })

  const list = []
  for (const item of byRole.values()) {
    // 全局角色（employee / sysAdmin）恒可分配
    if (item.role_code === 'employee' || item.role_code === 'sysAdmin') {
      list.push({ role_id: item.role_id, role_code: item.role_code, role_name: item.role_name })
      continue
    }
    // 食堂绑定角色（kitchen / deptAdmin）：绑定食堂须全部在操作者管辖范围内且营业中
    const locs = item.locationIds
    if (!locs.length || !locs.every(id => scope.includes(id))) continue
    if (!await areAllLocationsEnabled(locs)) continue
    list.push({ role_id: item.role_id, role_code: item.role_code, role_name: item.role_name })
  }

  // 编辑场景回补：员工原身份可能不在可分配范围内（如跨食堂的 kitchen 由 sysAdmin 分配），
  // 保留该角色以免前端下拉缺原身份时被静默改成普通员工（是否改动仍由 canAssignRole 把关）
  const keepRoleId = Number(event.role_id) || 0
  if (keepRoleId > 0 && !list.some(r => r.role_id === keepRoleId)) {
    const keepRows = await query(
      'SELECT `id`, `code`, COALESCE(`name`, `code`) AS role_name ' +
      'FROM `sys_role` WHERE `id` = {{id}} AND `status` = 1 LIMIT 1',
      { id: keepRoleId }
    )
    if (keepRows.length) {
      list.push({
        role_id: Number(keepRows[0].id),
        role_code: String(keepRows[0].code || ''),
        role_name: (keepRows[0].role_name && String(keepRows[0].role_name)) || '',
        preserved: true,
      })
    }
  }

  return { code: 0, message: 'success', data: { list, operator_code: opRoleCode } }
}

// ──────────────────────────────────────────────────────────────────
// 入口
// ──────────────────────────────────────────────────────────────────
exports.main = async (event, context) => {
  const { action } = event || {}
  try {
    switch (action) {
      case 'getMyDepts':          return await actionGetMyDepts()
      case 'getMonthBilling':     return await actionGetMonthBilling(event)
      case 'getStaffList':        return await actionGetStaffList(event)
      case 'addStaff':            return await actionAddStaff(event)
      case 'batchAddStaff':       return await actionBatchAddStaff(event)
      case 'updateStaff':         return await actionUpdateStaff(event)
      case 'getAssignableRoles':  return await actionGetAssignableRoles(event)
      case 'unbindStaffWechat':   return await actionUnbindStaffWechat(event)
      case 'deleteStaff':         return await actionDeleteStaff(event)
      case 'resetStaffPassword':  return await actionResetStaffPassword(event)
      default:
        return { code: -1, message: `未知 action: ${action}`, data: null }
    }
  } catch (err) {
    console.error('[deptAdmin] error:', err)
    console.error('[deptAdmin] error stack:', err && err.stack)
    return { code: -1, message: '操作失败，请重试', data: null }
  }
}
