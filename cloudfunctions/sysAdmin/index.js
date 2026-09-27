// 云函数 - 系统管理员后台（价格配置 / 部门管理 / 食堂管理 / 角色管理）
//
// 职责：系统管理员（sysAdmin）专属的“系统管理”唯一读写入口。
//       价格配置 / 部门 / 食堂 / 角色 四类基础数据的增删改查均在此完成。
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
// 常量
// ──────────────────────────────────────────────────────────────────

// price_config 为宽表：一行 = 部门一套价格（三餐共享生效区间与状态）
const MEAL_KEYS = [
  { key: 'breakfast', label: '早餐', prefix: 'bf' },
  { key: 'lunch', label: '午餐', prefix: 'lunch' },
  { key: 'dinner', label: '晚餐', prefix: 'dinner' },
]

// 全局角色：不绑定食堂（员工 / 系统管理员），不允许删除
const GLOBAL_ROLE_CODES = ['employee', 'sysAdmin']
// 角色展示排序：基础角色优先，其余按 id
const ROLE_CODE_ORDER = "FIELD(r.`code`, 'employee', 'kitchen', 'deptAdmin', 'sysAdmin')"
// 新增允许的角色（食堂员工 / 部门管理员）
const ALLOWED_CREATE_ROLE_CODES = ['kitchen', 'deptAdmin']

// ──────────────────────────────────────────────────────────────────
// 基础工具：SQL / 数值
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
      '[sysAdmin][DEBUG] $runSQL SELECT FAILED:',
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
      '[sysAdmin][DEBUG] $runSQL WRITE FAILED:',
      err.message || err,
      '\nSQL:', sql,
      '\nPARAMS:', JSON.stringify(params)
    )
    throw err
  }
}

const ok = (data) => ({ code: 0, message: 'success', data })
const fail = (message) => ({ code: -1, message, data: null })

const pad2 = n => (n < 10 ? '0' + n : String(n))

/**
 * 归一化日期为 `YYYY-MM-DD`
 */
function formatDate(value) {
  if (!value) return ''
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
  }
  const m = String(value).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (!m) return ''
  return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`
}

/** 校验 YYYY-MM-DD 是否为合法日期 */
function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime())
}

/** 金额保留两位小数 */
function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

/** 状态归一化为 0 / 1 */
function normStatus(v) {
  return Number(v) === 0 ? 0 : 1
}

/**
 * 构造 IN 占位符，返回 { ph: '{{p0}}, {{p1}}', params: { p0, p1 } }
 */
function buildInClause(prefix, values) {
  const params = {}
  const ph = values.map((v, i) => {
    params[prefix + i] = v
    return `{{${prefix}${i}}}`
  }).join(', ')
  return { ph, params }
}

// ──────────────────────────────────────────────────────────────────
// 权限：openid -> 员工身份，仅放行 sysAdmin
// ──────────────────────────────────────────────────────────────────

async function requireSysAdmin() {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''
  if (!openid) return { ok: false, resp: fail('无法识别用户身份，请重新登录') }

  const rows = await query(
    'SELECT e.`id`, e.`role_id`, COALESCE(r.`code`, \'\') AS role_code ' +
    'FROM `sys_emp` e ' +
    'LEFT JOIN `sys_role` r ON r.`id` = e.`role_id` AND r.`status` = 1 ' +
    'WHERE e.`_openid` = {{openid}} AND e.`status` = 1 LIMIT 1',
    { openid }
  )
  const roleCode = rows.length ? String(rows[0].role_code || '') : ''
  if (roleCode !== 'sysAdmin') return { ok: false, resp: fail('无系统管理员权限') }
  return { ok: true, openid, empId: rows.length ? Number(rows[0].id) || 0 : 0 }
}

// ──────────────────────────────────────────────────────────────────
// 食堂管理（sys_location）
// ──────────────────────────────────────────────────────────────────

/**
 * Action: getLocationList
 *   出参：{ list: [{ id, name, status, dept_count }] }
 */
async function actionGetLocationList() {
  const rows = await query(
    'SELECT l.`id`, l.`name`, l.`status`, ' +
    '       COUNT(DISTINCT d.`id`) AS dept_count ' +
    'FROM `sys_location` l ' +
    'LEFT JOIN `sys_dept` d ON d.`location_id` = l.`id` ' +
    'GROUP BY l.`id`, l.`name`, l.`status` ' +
    'ORDER BY l.`id` ASC'
  )
  const list = rows.map(r => ({
    id: Number(r.id) || 0,
    name: (r.name && String(r.name)) || '',
    status: Number(r.status) === 1 ? 1 : 0,
    dept_count: Number(r.dept_count) || 0,
  }))
  return ok({ list })
}

/**
 * Action: saveLocation（id 为 0/空表示新增）
 *   入参：{ id?, name, status }
 */
async function actionSaveLocation(event) {
  const id = Number(event.id) || 0
  const name = (event.name != null ? String(event.name) : '').trim()
  const status = normStatus(event.status)
  const openid = (cloud.getWXContext() || {}).OPENID || ''

  if (!name) return fail('请填写食堂名称')
  if (name.length > 50) return fail('食堂名称不能超过 50 个字符')

  const dup = await query(
    'SELECT `id` FROM `sys_location` WHERE `name` = {{name}} AND `id` <> {{id}} LIMIT 1',
    { name, id }
  )
  if (dup.length) return fail('已存在同名食堂')

  if (id > 0) {
    const exists = await query('SELECT `id` FROM `sys_location` WHERE `id` = {{id}} LIMIT 1', { id })
    if (!exists.length) return fail('食堂不存在或已被删除')
    // _openid 记录操作人（编辑时更新为最后修改人）
    await update(
      'UPDATE `sys_location` SET `name` = {{name}}, `status` = {{status}}, `_openid` = {{openid}}, `updated_at` = NOW() WHERE `id` = {{id}}',
      { name, status, openid, id }
    )
  } else {
    await update(
      'INSERT INTO `sys_location` (`name`, `status`, `_openid`, `created_at`, `updated_at`) ' +
      'VALUES ({{name}}, {{status}}, {{openid}}, NOW(), NOW())',
      { name, status, openid }
    )
  }
  return ok(null)
}

/**
 * Action: deleteLocation
 *   入参：{ id }
 *   语义：存在部门或已被角色绑定时禁止删除，避免产生悬空数据。
 */
async function actionDeleteLocation(event) {
  const id = Number(event.id) || 0
  if (id <= 0) return fail('缺少食堂 id')

  const exists = await query('SELECT `id` FROM `sys_location` WHERE `id` = {{id}} LIMIT 1', { id })
  if (!exists.length) return fail('食堂不存在或已被删除')

  const deptRows = await query('SELECT COUNT(*) AS c FROM `sys_dept` WHERE `location_id` = {{id}}', { id })
  const deptCount = deptRows.length ? Number(deptRows[0].c) || 0 : 0
  if (deptCount > 0) return fail(`该食堂下仍有 ${deptCount} 个部门，请先调整部门归属`)

  const roleRows = await query('SELECT COUNT(*) AS c FROM `sys_role_location` WHERE `location_id` = {{id}}', { id })
  const roleCount = roleRows.length ? Number(roleRows[0].c) || 0 : 0
  if (roleCount > 0) return fail('该食堂已被角色绑定，请先在「角色管理」中解除绑定')

  await update('DELETE FROM `sys_location` WHERE `id` = {{id}}', { id })
  return ok(null)
}

// ──────────────────────────────────────────────────────────────────
// 部门管理（sys_dept）
// ──────────────────────────────────────────────────────────────────

/**
 * Action: getDeptList
 *   出参：{ list: [{ id, name, location_id, location_name, status, emp_count }] }
 */
async function actionGetDeptList() {
  const rows = await query(
    'SELECT d.`id`, d.`name`, d.`location_id`, d.`status`, ' +
    '       COALESCE(l.`name`, \'\') AS location_name, ' +
    '       COUNT(DISTINCT e.`id`) AS emp_count ' +
    'FROM `sys_dept` d ' +
    'LEFT JOIN `sys_location` l ON l.`id` = d.`location_id` ' +
    'LEFT JOIN `sys_emp` e ON e.`dept_id` = d.`id` ' +
    'GROUP BY d.`id`, d.`name`, d.`location_id`, d.`status`, l.`name` ' +
    'ORDER BY d.`location_id` ASC, d.`id` ASC'
  )
  const list = rows.map(r => ({
    id: Number(r.id) || 0,
    name: (r.name && String(r.name)) || '',
    location_id: Number(r.location_id) || 0,
    location_name: (r.location_name && String(r.location_name)) || '',
    status: Number(r.status) === 1 ? 1 : 0,
    emp_count: Number(r.emp_count) || 0,
  }))
  return ok({ list })
}

/**
 * Action: saveDept（id 为 0/空表示新增）
 *   入参：{ id?, name, location_id, status }
 */
async function actionSaveDept(event) {
  const id = Number(event.id) || 0
  const name = (event.name != null ? String(event.name) : '').trim()
  const locationId = Number(event.location_id) || 0
  const status = normStatus(event.status)
  const openid = (cloud.getWXContext() || {}).OPENID || ''

  if (!name) return fail('请填写部门名称')
  if (name.length > 30) return fail('部门名称不能超过 30 个字符')
  if (locationId <= 0) return fail('请选择所属食堂')

  const dup = await query(
    'SELECT `id` FROM `sys_dept` WHERE `name` = {{name}} AND `id` <> {{id}} LIMIT 1',
    { name, id }
  )
  if (dup.length) return fail('已存在同名部门')

  const locRows = await query(
    'SELECT `id`, `status` FROM `sys_location` WHERE `id` = {{id}} LIMIT 1',
    { id: locationId }
  )
  if (!locRows.length) return fail('所选食堂不存在')

  if (id > 0) {
    const exists = await query(
      'SELECT `id`, `location_id` FROM `sys_dept` WHERE `id` = {{id}} LIMIT 1',
      { id }
    )
    if (!exists.length) return fail('部门不存在或已被删除')
    const oldLocationId = Number(exists[0].location_id) || 0
    // 归属未变更时允许保留在已停用食堂下；变更归属则要求目标食堂处于启用状态
    if (oldLocationId !== locationId && Number(locRows[0].status) !== 1) {
      return fail('所选食堂已停用，请先启用后再调整归属')
    }
    await update(
      'UPDATE `sys_dept` SET `name` = {{name}}, `location_id` = {{location_id}}, `status` = {{status}}, `_openid` = {{openid}}, `updated_at` = NOW() ' +
      'WHERE `id` = {{id}}',
      { name, location_id: locationId, status, openid, id }
    )
  } else {
    if (Number(locRows[0].status) !== 1) return fail('所选食堂已停用，请先启用后再新增部门')
    // _openid 记录操作人（新增=创建人；编辑时更新为最后修改人）
    await update(
      'INSERT INTO `sys_dept` (`name`, `location_id`, `status`, `_openid`, `created_at`, `updated_at`) ' +
      'VALUES ({{name}}, {{location_id}}, {{status}}, {{openid}}, NOW(), NOW())',
      { name, location_id: locationId, status, openid }
    )
  }
  return ok(null)
}

/**
 * Action: deleteDept
 *   入参：{ id }
 *   语义：部门下有员工时禁止删除；否则连带清理该部门的价格配置。
 */
async function actionDeleteDept(event) {
  const id = Number(event.id) || 0
  if (id <= 0) return fail('缺少部门 id')

  const exists = await query('SELECT `id` FROM `sys_dept` WHERE `id` = {{id}} LIMIT 1', { id })
  if (!exists.length) return fail('部门不存在或已被删除')

  const empRows = await query('SELECT COUNT(*) AS c FROM `sys_emp` WHERE `dept_id` = {{id}}', { id })
  const empCount = empRows.length ? Number(empRows[0].c) || 0 : 0
  if (empCount > 0) return fail(`该部门下仍有 ${empCount} 名员工，请先调整员工所属部门`)

  // 连带清理该部门的价格配置，避免残留脏数据
  await update('DELETE FROM `price_config` WHERE `dept_id` = {{dept_id}}', { dept_id: id })
  await update('DELETE FROM `sys_dept` WHERE `id` = {{id}}', { id })
  return ok(null)
}

// ──────────────────────────────────────────────────────────────────
// 角色管理（sys_role + sys_role_location）
// ──────────────────────────────────────────────────────────────────

/**
 * 校验食堂列表存在且处于启用状态
 */
async function validateLocations(locationIds) {
  const { ph, params } = buildInClause('loc', locationIds)
  const rows = await query(
    'SELECT `id`, `status` FROM `sys_location` WHERE `id` IN (' + ph + ')',
    params
  )
  const statusMap = new Map()
  rows.forEach(r => statusMap.set(Number(r.id) || 0, Number(r.status) === 1 ? 1 : 0))
  for (const lid of locationIds) {
    if (!statusMap.has(lid)) return { ok: false, message: '所选食堂不存在，请刷新后重试' }
    if (statusMap.get(lid) !== 1) return { ok: false, message: '所选食堂已停用，无法绑定' }
  }
  return { ok: true }
}

/**
 * 重写某角色的食堂绑定（_openid 记录最后操作人）
 */
async function replaceRoleLocations(roleId, locationIds, openid) {
  await update('DELETE FROM `sys_role_location` WHERE `role_id` = {{role_id}}', { role_id: roleId })
  if (!locationIds.length) return
  const params = { role_id: roleId, openid: openid || '' }
  const values = locationIds.map((lid, i) => {
    params['loc' + i] = lid
    return `({{role_id}}, {{loc${i}}}, {{openid}})`
  }).join(', ')
  await update(
    'INSERT INTO `sys_role_location` (`role_id`, `location_id`, `_openid`) VALUES ' + values,
    params
  )
}

/**
 * Action: getRoleList
 *   出参：{ list: [{ id, code, name, status, is_global,
 *                    location_ids, location_names, emp_count }] }
 */
async function actionGetRoleList() {
  const rows = await query(
    'SELECT r.`id`, r.`code`, r.`name`, r.`status`, ' +
    '       rl.`location_id`, COALESCE(l.`name`, \'\') AS location_name ' +
    'FROM `sys_role` r ' +
    'LEFT JOIN `sys_role_location` rl ON rl.`role_id` = r.`id` ' +
    'LEFT JOIN `sys_location` l ON l.`id` = rl.`location_id` ' +
    'ORDER BY ' + ROLE_CODE_ORDER + ', r.`id` ASC'
  )

  const empRows = await query('SELECT `role_id`, COUNT(*) AS c FROM `sys_emp` GROUP BY `role_id`')
  const empMap = new Map()
  empRows.forEach(r => empMap.set(Number(r.role_id) || 0, Number(r.c) || 0))

  const byRole = new Map()
  rows.forEach(r => {
    const id = Number(r.id) || 0
    if (!byRole.has(id)) {
      const code = String(r.code || '')
      byRole.set(id, {
        id,
        code,
        name: (r.name && String(r.name)) || '',
        status: Number(r.status) === 1 ? 1 : 0,
        is_global: GLOBAL_ROLE_CODES.includes(code),
        location_ids: [],
        location_names: [],
        emp_count: empMap.get(id) || 0,
      })
    }
    const item = byRole.get(id)
    const lid = Number(r.location_id) || 0
    if (lid > 0 && !item.location_ids.includes(lid)) {
      item.location_ids.push(lid)
      item.location_names.push((r.location_name && String(r.location_name)) || '')
    }
  })

  return ok({ list: Array.from(byRole.values()) })
}

/**
 * 校验是否已存在「同身份且绑定食堂集合完全相同」的角色
 */
async function hasDuplicateRoleLocationSet(code, locationIds, excludeRoleId) {
  const rows = await query(
    'SELECT r.`id` AS role_id, rl.`location_id` AS location_id ' +
    'FROM `sys_role` r ' +
    'JOIN `sys_role_location` rl ON rl.`role_id` = r.`id` ' +
    'WHERE r.`code` = {{code}}',
    { code }
  )
  const locationsByRole = {}
  rows.forEach(row => {
    const rid = Number(row.role_id) || 0
    if (!locationsByRole[rid]) locationsByRole[rid] = new Set()
    locationsByRole[rid].add(Number(row.location_id) || 0)
  })
  const selectedSet = new Set(locationIds)
  return Object.keys(locationsByRole).some(rid => {
    if (Number(rid) === Number(excludeRoleId)) return false
    const s = locationsByRole[rid]
    return s.size === selectedSet.size && locationIds.every(id => s.has(id))
  })
}

/**
 * Action: saveRole
 *   入参：{ id?, code?, name, status, location_ids?: number[] }
 *   语义：id>0 编辑（code 不可变）；id=0 新增角色。
 */
async function actionSaveRole(event) {
  const id = Number(event.id) || 0
  const name = (event.name != null ? String(event.name) : '').trim()
  const status = normStatus(event.status)
  const rawIds = Array.isArray(event.location_ids) ? event.location_ids : []
  const locationIds = Array.from(new Set(rawIds.map(n => Number(n) || 0).filter(n => n > 0)))
  const openid = (cloud.getWXContext() || {}).OPENID || ''

  if (!name) return fail('请填写角色名称')
  if (name.length > 30) return fail('角色名称不能超过 30 个字符')

  if (id > 0) {
    const exists = await query('SELECT `id`, `code` FROM `sys_role` WHERE `id` = {{id}} LIMIT 1', { id })
    if (!exists.length) return fail('角色不存在或已被删除')
    const code = String(exists[0].code || '')
    const isGlobal = GLOBAL_ROLE_CODES.includes(code)
    if (!isGlobal) {
      if (!locationIds.length) return fail('该角色需至少绑定一个食堂')
      const check = await validateLocations(locationIds)
      if (!check.ok) return fail(check.message)
      if (await hasDuplicateRoleLocationSet(code, locationIds, id)) {
        return fail('系统已存在该身份')
      }
    }
    // 编辑：名称全局唯一（排除自身）
    const dup = await query(
      'SELECT `id` FROM `sys_role` WHERE `name` = {{name}} AND `id` <> {{id}} LIMIT 1',
      { name, id }
    )
    if (dup.length) return fail('角色名称已存在')
    await update(
      'UPDATE `sys_role` SET `name` = {{name}}, `status` = {{status}}, `_openid` = {{openid}} WHERE `id` = {{id}}',
      { name, status, openid, id }
    )
    if (!isGlobal) await replaceRoleLocations(id, locationIds, openid)
    return ok(null)
  }

  // 新增：身份仅允许 食堂员工(kitchen) / 部门管理员(deptAdmin)，且必须绑定一个食堂
  const code = (event.code != null ? String(event.code) : '').trim()
  if (!code) return fail('请选择身份')
  if (!ALLOWED_CREATE_ROLE_CODES.includes(code)) {
    return fail('仅支持新增食堂员工或部门管理员角色')
  }
  if (!locationIds.length) return fail('请选择绑定的食堂')

  const check = await validateLocations(locationIds)
  if (!check.ok) return fail(check.message)

  // 名称全局唯一
  const nameDup = await query(
    'SELECT `id` FROM `sys_role` WHERE `name` = {{name}} LIMIT 1',
    { name }
  )
  if (nameDup.length) return fail('角色名称已存在')

  // 新增：同身份且绑定食堂集合完全相同的角色不允许创建
  if (await hasDuplicateRoleLocationSet(code, locationIds, 0)) {
    return fail('系统已存在该身份')
  }

  await update(
    'INSERT INTO `sys_role` (`code`, `name`, `status`, `_openid`) VALUES ({{code}}, {{name}}, {{status}}, {{openid}})',
    { code, name, status, openid }
  )
  const created = await query(
    'SELECT `id` FROM `sys_role` WHERE `name` = {{name}} and `code` = {{code}} ORDER BY `id` DESC LIMIT 1',
    { name, code }
  )
  const newId = created.length ? Number(created[0].id) || 0 : 0
  if (newId > 0 && locationIds.length) await replaceRoleLocations(newId, locationIds, openid)
  return ok({ id: newId })
}

/**
 * Action: deleteRole
 *   入参：{ id }
 *   语义：基础角色（employee / sysAdmin）不可删除；
 *         其余角色（kitchen / deptAdmin / 自定义）可删除，角色下有员工时禁止删除。
 */
async function actionDeleteRole(event) {
  const id = Number(event.id) || 0
  if (id <= 0) return fail('缺少角色 id')

  const rows = await query('SELECT `id`, `code` FROM `sys_role` WHERE `id` = {{id}} LIMIT 1', { id })
  if (!rows.length) return fail('角色不存在或已被删除')
  if (GLOBAL_ROLE_CODES.includes(String(rows[0].code || ''))) {
    return fail('该角色为基础角色，不可删除')
  }

  const empRows = await query('SELECT COUNT(*) AS c FROM `sys_emp` WHERE `role_id` = {{id}}', { id })
  const empCount = empRows.length ? Number(empRows[0].c) || 0 : 0
  if (empCount > 0) return fail(`该角色下仍有 ${empCount} 名员工，无法删除`)

  await update('DELETE FROM `sys_role_location` WHERE `role_id` = {{role_id}}', { role_id: id })
  await update('DELETE FROM `sys_role` WHERE `id` = {{id}}', { id })
  return ok(null)
}

// ──────────────────────────────────────────────────────────────────
// 价格配置
// ──────────────────────────────────────────────────────────────────

/**
 * Action: getPriceConfigList
 *   入参：{ dept_id }
 *   出参：{ dept_id, dept_name, list: [{ id, status, start_date, end_date,
 *                                       meals: [{ key, label, emp_price, family_price }] }] }
 */
async function actionGetPriceConfigList(event) {
  const deptId = Number(event.dept_id) || 0
  if (deptId <= 0) return fail('请选择部门')

  const deptRows = await query('SELECT `name` FROM `sys_dept` WHERE `id` = {{id}} LIMIT 1', { id: deptId })
  if (!deptRows.length) return fail('部门不存在或已被删除')
  const deptName = (deptRows[0].name && String(deptRows[0].name)) || ''

  const rows = await query(
    'SELECT `id`, `status`, `start_date`, `end_date`, ' +
    MEAL_KEYS.map(m => `\`${m.prefix}_emp\`, \`${m.prefix}_family\``).join(', ') +
    ' FROM `price_config` WHERE `dept_id` = {{dept_id}} ' +
    'ORDER BY `start_date` DESC, `id` DESC',
    { dept_id: deptId }
  )

  const list = rows.map(r => ({
    id: Number(r.id) || 0,
    status: Number(r.status) === 1 ? 1 : 0,
    start_date: formatDate(r.start_date),
    end_date: formatDate(r.end_date),
    meals: MEAL_KEYS.map(m => ({
      key: m.key,
      label: m.label,
      emp_price: r[`${m.prefix}_emp`] == null ? '' : Number(r[`${m.prefix}_emp`]),
      family_price: r[`${m.prefix}_family`] == null ? '' : Number(r[`${m.prefix}_family`]),
    })),
  }))
  return ok({ dept_id: deptId, dept_name: deptName, list })
}

/**
 * Action: savePriceConfig（id 为 0/空表示新增）
 *   入参：{ id?, dept_id, prices, start_date, end_date, status }
 *     prices = { breakfast: {emp_price, family_price}, lunch: ..., dinner: ... }
 */
async function actionSavePriceConfig(event) {
  const id = Number(event.id) || 0
  const deptId = Number(event.dept_id) || 0
  const status = normStatus(event.status)
  const startDate = (event.start_date != null ? String(event.start_date) : '').trim()
  const endDate = (event.end_date != null ? String(event.end_date) : '').trim()
  const rawPrices = (event && typeof event.prices === 'object' && event.prices) || {}
  const openid = (cloud.getWXContext() || {}).OPENID || ''

  if (deptId <= 0) return fail('请选择部门')
  if (!isValidDate(startDate) || !isValidDate(endDate)) return fail('请选择有效的生效 / 失效日期')
  if (startDate > endDate) return fail('生效日期不能晚于失效日期')

  // 逐餐次解析价格：三餐的员工价 / 家属价均为必填
  const prices = {}
  for (const m of MEAL_KEYS) {
    const item = rawPrices[m.key] || {}
    const empRaw = item.emp_price
    const famRaw = item.family_price
    if (empRaw === '' || empRaw == null) return fail(`请填写「${m.label}」员工价`)
    if (famRaw === '' || famRaw == null) return fail(`请填写「${m.label}」家属价`)
    const emp = Number(empRaw)
    const fam = Number(famRaw)
    if (isNaN(emp) || emp < 0) return fail(`「${m.label}」员工价无效`)
    if (isNaN(fam) || fam < 0) return fail(`「${m.label}」家属价无效`)
    prices[m.key] = { emp_price: round2(emp), family_price: round2(fam) }
  }

  const deptRows = await query('SELECT `id`, `status` FROM `sys_dept` WHERE `id` = {{id}} LIMIT 1', { id: deptId })
  if (!deptRows.length) return fail('部门不存在或已被删除')
  if (id <= 0 && Number(deptRows[0].status) !== 1) {
    return fail('该部门已停用，无法新增价格配置')
  }

  // 启用状态下校验同部门生效区间不重叠（保证同一时间只有一套价格）
  if (status === 1) {
    const conflictRows = await query(
      'SELECT `id`, `start_date`, `end_date` FROM `price_config` ' +
      'WHERE `dept_id` = {{dept_id}} AND `status` = 1 AND `id` <> {{id}} ' +
      'AND `start_date` <= {{end_date}} AND `end_date` >= {{start_date}} LIMIT 1',
      { dept_id: deptId, id, start_date: startDate, end_date: endDate }
    )
    if (conflictRows.length) {
      const c = conflictRows[0]
      return fail(
        `生效区间与已有启用中的价格配置重叠（${formatDate(c.start_date)} 至 ${formatDate(c.end_date)}），同一时间只能有一套生效价格`
      )
    }
  }

  const params = {
    dept_id: deptId,
    status,
    start_date: startDate,
    end_date: endDate,
    openid,
  }
  MEAL_KEYS.forEach(m => {
    const p = prices[m.key]
    params[`${m.prefix}_emp`] = p.emp_price
    params[`${m.prefix}_family`] = p.family_price
  })

  if (id > 0) {
    const exists = await query('SELECT `id` FROM `price_config` WHERE `id` = {{id}} LIMIT 1', { id })
    if (!exists.length) return fail('价格配置不存在或已被删除')
    params.id = id
    await update(
      'UPDATE `price_config` SET `dept_id` = {{dept_id}}, `status` = {{status}}, ' +
      '`start_date` = {{start_date}}, `end_date` = {{end_date}}, ' +
      MEAL_KEYS.map(m => `\`${m.prefix}_emp\` = {{${m.prefix}_emp}}, \`${m.prefix}_family\` = {{${m.prefix}_family}}`).join(', ') +
      ', `_openid` = {{openid}}, `updated_at` = NOW() WHERE `id` = {{id}}',
      params
    )
  } else {
    await update(
      'INSERT INTO `price_config` ' +
      '(`dept_id`, `status`, `start_date`, `end_date`, ' +
      MEAL_KEYS.map(m => `\`${m.prefix}_emp\`, \`${m.prefix}_family\``).join(', ') + ', `created_at`, `updated_at`, `_openid`) ' +
      'VALUES (' + ['{{dept_id}}', '{{status}}', '{{start_date}}', '{{end_date}}']
        .concat(MEAL_KEYS.reduce(
          (acc, m) => { acc.push(`{{${m.prefix}_emp}}`, `{{${m.prefix}_family}}`); return acc },
          []
        ))
        .concat(['NOW()', 'NOW()', '{{openid}}'])
        .join(', ') + ')',
      params
    )
  }
  return ok(null)
}

/**
 * Action: deletePriceConfig
 *   入参：{ id }
 */
async function actionDeletePriceConfig(event) {
  const id = Number(event.id) || 0
  if (id <= 0) return fail('缺少价格配置 id')
  const exists = await query('SELECT `id` FROM `price_config` WHERE `id` = {{id}} LIMIT 1', { id })
  if (!exists.length) return fail('价格配置不存在或已被删除')
  await update('DELETE FROM `price_config` WHERE `id` = {{id}}', { id })
  return ok(null)
}

// ──────────────────────────────────────────────────────────────────
// 入口
// ──────────────────────────────────────────────────────────────────

const ACTIONS = {
  // 食堂管理
  getLocationList: actionGetLocationList,
  saveLocation: actionSaveLocation,
  deleteLocation: actionDeleteLocation,
  // 部门管理
  getDeptList: actionGetDeptList,
  saveDept: actionSaveDept,
  deleteDept: actionDeleteDept,
  // 角色管理
  getRoleList: actionGetRoleList,
  saveRole: actionSaveRole,
  deleteRole: actionDeleteRole,
  // 价格配置
  getPriceConfigList: actionGetPriceConfigList,
  savePriceConfig: actionSavePriceConfig,
  deletePriceConfig: actionDeletePriceConfig,
}

exports.main = async (event, context) => {
  const action = (event || {}).action
  const handler = ACTIONS[action]
  if (!handler) {
    return { code: -1, message: `未知 action: ${action}`, data: null }
  }
  try {
    const auth = await requireSysAdmin()
    if (!auth.ok) return auth.resp
    return await handler(event)
  } catch (err) {
    // 详细错误只进日志（query/update 已在上层打印完整 SQL 与参数）
    console.error('[sysAdmin] error:', err)
    console.error('[sysAdmin] error stack:', err && err.stack)
    return { code: -1, message: '操作失败，请重试', data: null }
  }
}
