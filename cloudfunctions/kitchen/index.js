// 云函数 - 食堂端报餐查询（@cloudbase/node-sdk 访问云 MySQL）
//
// 职责：食堂工作台按"角色管理的食堂范围"查询报餐汇总 / 明细 / 人员搜索。
//
// 权限模型：
//   食堂侧：openid -> sys_emp.role_id -> sys_role_location(多对多) -> location_id[]
//           所有查询限定在角色关联的食堂范围内（数据域隔离）；
//           未配置角色/食堂时返回空数据而非报错（无权限静默降级）。
//   身份一律取自云函数上下文 OPENID，不信任前端传入任何 role/location 参数。
//
const cloud = require('wx-server-sdk')
const cloudbaseSDK = require('@cloudbase/node-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const cloudbase = cloudbaseSDK.init({
  env: cloudbaseSDK.SYMBOL_CURRENT_ENV
})
const models = cloudbase.models

// meal_type 数值 -> 前端餐次字符串（与 mealOrder / getPriceConfig 保持一致）
const MEAL_TYPE_NAME = {
  0: 'breakfast',
  1: 'lunch',
  2: 'dinner',
}

// 前端餐次字符串 -> meal_type 数值
const NAME_TO_MEAL_TYPE = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
}

// ──────────────────────────────────────────────────────────────────
// 权限解析：根据 openid 反查角色关联的食堂 location_id 列表
//   sys_emp.role_id -> sys_role_location.role_id -> location_id[]
// 返回 Number(location_id) 数组；无角色/未配置食堂时返回 []（调用方按无权限处理）
// ──────────────────────────────────────────────────────────────────
/**
 * 根据 openid 反查身份：role_id + emp_id（一次查询，供权限与核销人记录复用）
 * 返回 { roleId, empId }；未查到角色时 roleId = 0
 */
async function resolveIdentity(openid) {
  if (!openid) return { roleId: 0, empId: 0 }
  const emps = await query(
    'SELECT `id`, `role_id` FROM `sys_emp` WHERE `_openid` = {{openid}} LIMIT 1',
    { openid }
  )
  if (!emps.length) return { roleId: 0, empId: 0 }
  return {
    roleId: Number(emps[0].role_id) || 0,
    empId: Number(emps[0].id) || 0,
  }
}

/**
 * 根据 openid 反查角色关联的食堂 location_id 列表
 *   sys_emp.role_id -> sys_role_location.role_id -> location_id[]
 * 返回 Number(location_id) 数组；无角色/未配置食堂时返回 []（调用方按无权限处理）
 */
async function resolveRoleLocations(openid) {
  const { roleId } = await resolveIdentity(openid)
  if (!roleId) return []
  const rows = await query(
    'SELECT `location_id` FROM `sys_role_location` WHERE `role_id` = {{role_id}}',
    { role_id: roleId }
  )
  return rows.map(r => Number(r.location_id)).filter(id => id > 0)
}

/**
 * 执行 SQL 查询（预编译模式，参数用 {{key}} 绑定，防 SQL 注入）
 */
async function query(sql, params = {}) {
  try {
    const result = await models.$runSQL(sql, params)
    return (result && result.data && result.data.executeResultList) || []
  } catch (err) {
    console.error(
      '[kitchen][DEBUG] $runSQL SELECT FAILED:',
      err.message || err,
      '\nSQL:', sql,
      '\nPARAMS:', JSON.stringify(params)
    )
    throw err
  }
}

/**
 * 执行 SQL 写操作（UPDATE），返回受影响行数
 * 注意：MySQL 默认只统计「值发生变化」的行，因此不能仅凭 affected 判断记录是否存在
 */
async function update(sql, params = {}) {
  try {
    const result = await models.$runSQL(sql, params)
    return (result && result.data && result.data.total) || 0
  } catch (err) {
    console.error(
      '[kitchen][DEBUG] $runSQL WRITE FAILED:',
      err.message || err,
      '\nSQL:', sql,
      '\nPARAMS:', JSON.stringify(params)
    )
    throw err
  }
}

/**
 * 将任意日期值规范化为 YYYY-MM-DD 字符串
 */
function ymd(val) {
  if (!val) return ''
  if (typeof val === 'string') {
    // 兼容 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm:ss' 等
    const m = val.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) {
      return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
    }
  }
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val)
  const pad = n => (n < 10 ? '0' + n : n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 生成 location 范围过滤：IN 占位符 + 对应参数（location 数量动态，走预编译防注入）
function buildLocClause(locations) {
  const ph = locations.map((_, i) => `{{loc${i}}}`).join(', ')
  const params = {}
  locations.forEach((loc, i) => { params['loc' + i] = loc })
  return { ph, params }
}

// ──────────────────────────────────────────────────────────────────
// Action: getKitchenSummary
//   入参：{ date: 'YYYY-MM-DD' }
//   出参：{ date, meals: { breakfast: {head_count,total_qty,family_qty}, ... }, depts: [...] }
//   语义：汇总指定角色食堂范围内的当日报餐：
//         - meals 三餐汇总：head_count 报餐人数、total_qty 总份数、family_qty 家属份数(= 份数-人数)
//         - depts 部门汇总：按部门透视 早/中/晚 三列份数，按总份数倒序
// 三餐空汇总（无权限/无数据时复用）
function emptyMeals() {
  return {
    breakfast: { head_count: 0, total_qty: 0, family_qty: 0 },
    lunch:     { head_count: 0, total_qty: 0, family_qty: 0 },
    dinner:    { head_count: 0, total_qty: 0, family_qty: 0 },
  }
}

// ──────────────────────────────────────────────────────────────────
async function actionGetKitchenSummary(event) {
  const day = ymd(event.date)
  if (!day) {
    return { code: -1, message: '缺少日期参数', data: null }
  }

  const wxContext = cloud.getWXContext() || {}
  const locations = await resolveRoleLocations(wxContext.OPENID || '')
  if (!locations.length) {
    return {
      code: 0, message: 'success',
      data: { date: day, meals: emptyMeals(), depts: [] },
    }
  }
  const { ph: locPh, params: locParams } = buildLocClause(locations)

  // 1. 三餐汇总（按 meal_type 分组；quantity > 0 为有效报餐行）
  const mealRows = await query(
    'SELECT `meal_type`, COUNT(*) AS head_count, SUM(`quantity`) AS total_qty, ' +
    '       SUM(`quantity`) - COUNT(*) AS family_qty ' +
    'FROM `meal_order` ' +
    'WHERE `meal_date` = {{day}} AND `quantity` > 0 ' +
    '  AND `location_id` IN (' + locPh + ') ' +
    'GROUP BY `meal_type`',
    { day, ...locParams }
  )
  const meals = emptyMeals()
  mealRows.forEach(r => {
    const name = MEAL_TYPE_NAME[r.meal_type]
    if (!name) return
    meals[name] = {
      head_count: Number(r.head_count) || 0,
      total_qty: Number(r.total_qty) || 0,
      family_qty: Number(r.family_qty) || 0,
    }
  })

  // 2. 部门汇总（联表取部门名，按 部门+餐次 分组后透视为三列）
  const deptRows = await query(
    'SELECT COALESCE(d.`id`, 0) AS dept_id, COALESCE(d.`name`, \'未知部门\') AS dept_name, ' +
    '       mo.`meal_type`, SUM(mo.`quantity`) AS qty ' +
    'FROM `meal_order` mo ' +
    'LEFT JOIN `sys_emp` e ON e.`id` = mo.`emp_id` ' +
    'LEFT JOIN `sys_dept` d ON d.`id` = e.`dept_id` ' +
    'WHERE mo.`meal_date` = {{day}} AND mo.`quantity` > 0 ' +
    '  AND mo.`location_id` IN (' + locPh + ') ' +
    'GROUP BY d.`id`, d.`name`, mo.`meal_type`',
    { day, ...locParams }
  )
  const deptMap = new Map()
  deptRows.forEach(r => {
    const key = String(r.dept_id)
    if (!deptMap.has(key)) {
      deptMap.set(key, {
        dept_id: r.dept_id,
        dept_name: r.dept_name,
        breakfast: 0, lunch: 0, dinner: 0,
      })
    }
    const ds = deptMap.get(key)
    const name = MEAL_TYPE_NAME[r.meal_type]
    if (name) ds[name] = Number(r.qty) || 0
  })
  const depts = Array.from(deptMap.values())
    .filter(d => d.breakfast + d.lunch + d.dinner > 0)
    .sort((a, b) =>
      (b.breakfast + b.lunch + b.dinner) - (a.breakfast + a.lunch + a.dinner)
    )

  return { code: 0, message: 'success', data: { date: day, meals, depts } }
}

// ──────────────────────────────────────────────────────────────────
// Action: getKitchenDetail
//   入参：{ date, page = 1, page_size = 20, keyword?, meal_type? }
//   meal_type 为前端餐次字符串 'breakfast'|'lunch'|'dinner'
//   出参：{ list: [{ user_id, name, phone, dept_name, meal_type, qty }], total, total_qty }
//   语义：当日明细按"每人每餐一行"展开，支持 姓名/部门/手机号 模糊搜索、餐次筛选、分页
// ──────────────────────────────────────────────────────────────────
async function actionGetKitchenDetail(event) {
  const day = ymd(event.date)
  if (!day) {
    return { code: -1, message: '缺少日期参数', data: null }
  }

  const wxContext = cloud.getWXContext() || {}
  const locations = await resolveRoleLocations(wxContext.OPENID || '')
  if (!locations.length) {
    return { code: 0, message: 'success', data: { list: [], total: 0, total_qty: 0 } }
  }
  const { ph: locPh, params: locParams } = buildLocClause(locations)

  const pageNum = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(event.page_size) || 20))

  // 动态拼接 WHERE，参数一律走 {{key}} 绑定，防注入
  const where = ['mo.`meal_date` = {{day}}', 'mo.`quantity` > 0']
  const params = { day }
  const kw = event.keyword ? String(event.keyword).trim() : ''
  if (kw) {
    where.push(
      '(e.`name` LIKE CONCAT(\'%\', {{kw}}, \'%\') ' +
      ' OR d.`name` LIKE CONCAT(\'%\', {{kw}}, \'%\') ' +
      ' OR e.`phone` LIKE CONCAT(\'%\', {{kw}}, \'%\'))'
    )
    params.kw = kw
  }
  if (event.meal_type && NAME_TO_MEAL_TYPE[event.meal_type] !== undefined) {
    params.mealTypeNum = NAME_TO_MEAL_TYPE[event.meal_type]
    where.push('mo.`meal_type` = {{mealTypeNum}}')
  }
  // location 范围限定
  where.push('mo.`location_id` IN (' + locPh + ')')
  const whereSql = 'WHERE ' + where.join(' AND ')

  const JOIN_SQL =
    'FROM `meal_order` mo ' +
    'LEFT JOIN `sys_emp` e ON e.`id` = mo.`emp_id` ' +
    'LEFT JOIN `sys_dept` d ON d.`id` = e.`dept_id` '

  // 1. 汇总（总行数 + 总份数）
  const aggRows = await query(
    'SELECT COUNT(*) AS total, IFNULL(SUM(mo.`quantity`), 0) AS total_qty ' +
    JOIN_SQL + whereSql,
    { ...params, ...locParams }
  )
  const total = aggRows.length ? Number(aggRows[0].total) || 0 : 0
  const total_qty = aggRows.length ? Number(aggRows[0].total_qty) || 0 : 0

  // 2. 分页明细（meal_type 转为前端字符串，供 MEAL_TYPE_LABEL 映射）
  const rows = await query(
    'SELECT mo.`emp_id` AS user_id, COALESCE(e.`name`, \'\') AS name, ' +
    '       COALESCE(e.`phone`, \'\') AS phone, COALESCE(d.`name`, \'\') AS dept_name, ' +
    '       mo.`meal_type`, mo.`quantity` AS qty, ' +
    '       IFNULL(mo.`verified_status`, 0) AS verified ' +
    JOIN_SQL + whereSql + ' ' +
    'ORDER BY mo.`emp_id` ASC, mo.`meal_type` ASC ' +
    'LIMIT {{offset}}, {{limit}}',
    { ...params, ...locParams, offset: (pageNum - 1) * pageSize, limit: pageSize }
  )
  const list = rows.map(r => ({
    user_id: r.user_id,
    name: r.name || '',
    phone: r.phone || '',
    dept_name: r.dept_name || '',
    meal_type: MEAL_TYPE_NAME[r.meal_type] || String(r.meal_type),
    qty: Number(r.qty) || 0,
    verified: Number(r.verified) === 1 ? 1 : 0,
  }))

  return { code: 0, message: 'success', data: { list, total, total_qty } }
}

// ──────────────────────────────────────────────────────────────────
// Action: searchByKeyword
//   入参：{ keyword, date, meal? }   meal 为前端餐次字符串
//   出参：{ found, keyword, date, total,
//           list: [{ emp_id, name, phone, dept_name, breakfast, lunch, dinner, has_order }] }
//   语义：按姓名/手机号查询员工，
//         联查其在指定日期的三餐份数；
//         未报餐的人员也返回（has_order=false，前端展示"未报餐"）；最多返回 50 人
//         注意：location 条件放在 LEFT JOIN 的 ON 子句中，
//         保证"食堂范围内但当日未报餐"的员工仍然被列出。
// ──────────────────────────────────────────────────────────────────
async function actionSearchByKeyword(event) {
  const day = ymd(event.date)
  const kw = event.keyword ? String(event.keyword).trim() : ''
  if (!kw || !day) {
    return { code: -1, message: '缺少查询关键词或日期参数', data: null }
  }

  const wxContext = cloud.getWXContext() || {}
  const locations = await resolveRoleLocations(wxContext.OPENID || '')
  if (!locations.length) {
    return {
      code: 0, message: 'success',
      data: { found: false, keyword: kw, date: day, total: 0, list: [] },
    }
  }
  const { ph: locPh, params: locParams } = buildLocClause(locations)

  // 姓名/手机号合并模糊匹配（kw 走预编译绑定，无注入风险）
  const whereClause = 'WHERE (e.`name` LIKE CONCAT(\'%\', {{kw}}, \'%\') ' +
    'OR e.`phone` LIKE CONCAT(\'%\', {{kw}}, \'%\')) '

  // 餐次筛选下推到 SQL（HAVING）：
  // 若先 LIMIT 50 再在 JS 过滤，目标餐次的报餐人员可能被截断在 50 名之外而漏查
  const queryParams = { day, kw, ...locParams }
  let havingClause = ''
  if (event.meal && NAME_TO_MEAL_TYPE[event.meal] !== undefined) {
    queryParams.mt = NAME_TO_MEAL_TYPE[event.meal]
    havingClause = 'HAVING IFNULL(SUM(CASE WHEN mo.`meal_type` = {{mt}} THEN mo.`quantity` ELSE 0 END), 0) > 0 '
  }

  const rows = await query(
    'SELECT e.`id` AS emp_id, e.`name`, COALESCE(e.`phone`, \'\') AS phone, ' +
    '       COALESCE(d.`name`, \'\') AS dept_name, ' +
    '       IFNULL(SUM(CASE WHEN mo.`meal_type` = 0 THEN mo.`quantity` ELSE 0 END), 0) AS breakfast, ' +
    '       IFNULL(SUM(CASE WHEN mo.`meal_type` = 1 THEN mo.`quantity` ELSE 0 END), 0) AS lunch, ' +
    '       IFNULL(SUM(CASE WHEN mo.`meal_type` = 2 THEN mo.`quantity` ELSE 0 END), 0) AS dinner, ' +
    '       IFNULL(MAX(CASE WHEN mo.`meal_type` = 0 THEN mo.`verified_status` ELSE NULL END), 0) AS breakfast_verified, ' +
    '       IFNULL(MAX(CASE WHEN mo.`meal_type` = 1 THEN mo.`verified_status` ELSE NULL END), 0) AS lunch_verified, ' +
    '       IFNULL(MAX(CASE WHEN mo.`meal_type` = 2 THEN mo.`verified_status` ELSE NULL END), 0) AS dinner_verified ' +
    'FROM `sys_emp` e ' +
    'LEFT JOIN `sys_dept` d ON d.`id` = e.`dept_id` ' +
    'LEFT JOIN `meal_order` mo ON mo.`emp_id` = e.`id` ' +
    '  AND mo.`meal_date` = {{day}} AND mo.`quantity` > 0 ' +
    '  AND mo.`location_id` IN (' + locPh + ') ' +
    whereClause +
    'GROUP BY e.`id`, e.`name`, e.`phone`, d.`name` ' +
    havingClause +
    // 有报餐的排前面，未报餐的排后面；同组内按员工 id 升序
    'ORDER BY IFNULL(SUM(mo.`quantity`), 0) > 0 DESC, e.`id` ASC ' +
    'LIMIT 50',
    queryParams
  )

  const list = rows.map(r => {
    const breakfast = Number(r.breakfast) || 0
    const lunch = Number(r.lunch) || 0
    const dinner = Number(r.dinner) || 0
    return {
      emp_id: r.emp_id,
      name: r.name || '',
      phone: r.phone || '',
      dept_name: r.dept_name || '',
      breakfast,
      lunch,
      dinner,
      breakfast_verified: Number(r.breakfast_verified) === 1 ? 1 : 0,
      lunch_verified: Number(r.lunch_verified) === 1 ? 1 : 0,
      dinner_verified: Number(r.dinner_verified) === 1 ? 1 : 0,
      has_order: breakfast > 0 || lunch > 0 || dinner > 0,
    }
  })

  return {
    code: 0,
    message: 'success',
    data: {
      found: list.length > 0,
      keyword: kw,
      date: day,
      total: list.length,
      list,
    },
  }
}

// ──────────────────────────────────────────────────────────────────
// Action: verifyMeal
//   入参：{ emp_id, date, meal_type, verified? }
//   meal_type 支持前端字符串 'breakfast'|'lunch'|'dinner' 或数值 0/1/2
//   verified: 1 = 核销（默认），0 = 撤销核销
//   出参：{ affected }
//   食堂人员在查询结果中直接核销/撤销某员工某餐次的报餐。
//         行归属（location_id）必须在角色关联食堂范围内；
//         先查记录存在性再 UPDATE，避免「重复写相同值 affected=0」的误判。
// ──────────────────────────────────────────────────────────────────
async function actionVerifyMeal(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''
  // 一次反查身份：role_id 用于食堂范围，emp_id 用于记录核销人
  const { roleId, empId: operatorId } = await resolveIdentity(openid)
  if (!roleId) {
    return { code: -1, message: '无食堂操作权限', data: null }
  }
  const rows = await query(
    'SELECT `location_id` FROM `sys_role_location` WHERE `role_id` = {{role_id}}',
    { role_id: roleId }
  )
  const locations = rows.map(r => Number(r.location_id)).filter(id => id > 0)
  if (!locations.length) {
    return { code: -1, message: '无食堂操作权限', data: null }
  }
  const { ph: locPh, params: locParams } = buildLocClause(locations)

  const day = ymd(event.date)
  const emp_id = Number(event.emp_id)
  if (!day || !emp_id) {
    return { code: -1, message: '缺少参数 emp_id/date', data: null }
  }

  // 餐次归一化：字符串或数值都转成 0/1/2
  let meal_type = event.meal_type
  if (typeof meal_type === 'string') {
    if (NAME_TO_MEAL_TYPE[meal_type] === undefined) {
      return { code: -1, message: '餐次参数不合法', data: null }
    }
    meal_type = NAME_TO_MEAL_TYPE[meal_type]
  }
  meal_type = Number(meal_type)
  if (meal_type !== 0 && meal_type !== 1 && meal_type !== 2) {
    return { code: -1, message: '餐次参数不合法', data: null }
  }

  const verified = (event.verified === 0 || event.verified === '0') ? 0 : 1

  // 1. 先确认该员工此餐次存在有效报餐且位于权限食堂范围内
  const existsRows = await query(
    'SELECT 1 FROM `meal_order` ' +
    'WHERE `emp_id` = {{emp_id}} AND `meal_date` = {{day}} ' +
    '  AND `meal_type` = {{mt}} AND `quantity` > 0 ' +
    '  AND `location_id` IN (' + locPh + ') ' +
    'LIMIT 1',
    { emp_id, day, mt: meal_type, ...locParams }
  )
  if (!existsRows.length) {
    return { code: -1, message: '未找到该员工此餐次的报餐记录', data: null }
  }

  // 2. 更新核销状态，同时记录核销时间和核销人；撤销时清空这两个字段
  await update(
    'UPDATE `meal_order` ' +
    'SET `verified_status` = {{verified}}, ' +
    '    `verified_at` = IF({{verified}} = 1, NOW(), NULL), ' +
    '    `verified_by` = IF({{verified}} = 1, {{operatorId}}, NULL), ' +
    '    `updated_at` = NOW() ' +
    'WHERE `emp_id` = {{emp_id}} AND `meal_date` = {{day}} ' +
    '  AND `meal_type` = {{mt}} AND `quantity` > 0 ' +
    '  AND `location_id` IN (' + locPh + ')',
    { verified, operatorId, emp_id, day, mt: meal_type, ...locParams }
  )

  return {
    code: 0,
    message: 'success',
    data: { affected: 1, verified: verified === 1 ? 1 : 0, operatorId },
  }
}

// ──────────────────────────────────────────────────────────────────
// 入口
// ──────────────────────────────────────────────────────────────────
exports.main = async (event, context) => {
  const { action } = event || {}
  try {
    switch (action) {
      case 'getKitchenSummary': return await actionGetKitchenSummary(event)
      case 'getKitchenDetail':  return await actionGetKitchenDetail(event)
      case 'searchByKeyword':   return await actionSearchByKeyword(event)
      case 'verifyMeal':        return await actionVerifyMeal(event)
      default:
        return { code: -1, message: `未知 action: ${action}`, data: null }
    }
  } catch (err) {
    // 详细错误只进日志（query 已在上层打印完整 SQL 与参数）
    console.error('[kitchen] error:', err)
    console.error('[kitchen] error stack:', err && err.stack)
    // 对前端只给统一中文提示，避免把 $runSQL 的英文原始错误直接甩给用户
    return { code: -1, message: '操作失败，请重试', data: null }
  }
}
