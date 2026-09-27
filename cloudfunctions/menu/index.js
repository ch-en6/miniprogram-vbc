// 云函数 - 菜单服务（@cloudbase/node-sdk 访问云 MySQL menu_plan + menu_daily 表）
//
// 职责：菜单领域（menu_plan / menu_daily）的唯一读写入口。
//
// 数据模型：
//   menu_plan   一行 = 一份菜单计划（status=1 生效 + start_date/end_date 生效区间 + location_id 食堂）
//   menu_daily  一行 = (plan_id, day_of_week 1~7, meal_type 0/1/2) 的菜品串
//
// 权限模型：
//   getCurrentMenu  展示端「今天吃什么」：openid -> sys_emp.dept_id -> sys_dept.location_id
//   其余 action      管理端：openid -> sys_emp.role_id -> sys_role_location -> location_id[]，
//                   所有读写限定在角色管辖的食堂范围内（sysAdmin 为全部食堂）。
//                   身份一律取自云函数上下文 OPENID，不信任前端传入的 role/location 参数。

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
// 每份计划的固定天数（day_of_week 1~7）
const DAYS_PER_PLAN = 7

// day_of_week 数值（1~7）-> 中文星期
const DAY_OF_WEEK_LABEL_CN = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
}

// meal_type 中文键 -> 数值（menu_daily.meal_type）
const MENU_MEAL_FIELD = { bf: 0, lunch: 1, dinner: 2 }
// meal_type 数值 -> 中文键（前端菜品表格列）
const MENU_MEAL_FIELD_BY_TYPE = { 0: 'bf', 1: 'lunch', 2: 'dinner' }

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
      '[menu][DEBUG] $runSQL SELECT FAILED:',
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
      '[menu][DEBUG] $runSQL WRITE FAILED:',
      err.message || err,
      '\nSQL:', sql,
      '\nPARAMS:', JSON.stringify(params)
    )
    throw err
  }
}

// 生成 id 列表过滤：IN 占位符 + 对应参数（数量动态，走预编译防注入）
function buildIdClause(ids) {
  const ph = ids.map((_, i) => `{{mid${i}}}`).join(', ')
  const params = {}
  ids.forEach((id, i) => { params['mid' + i] = id })
  return { ph, params }
}

// 归一化日期串为 YYYY-MM-DD；非法/空返回 ''
// 兼容 DATE 字段被驱动返回的 Date 对象、"YYYY-MM-DD HH:mm:ss"、中文日期串等
function normalizeDate(value) {
  if (value == null || value === '') return ''
  if (value instanceof Date && !isNaN(value.getTime())) {
    const pad = n => (n < 10 ? '0' + n : String(n))
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  const m = String(value).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (!m) return ''
  const pad = n => (n < 10 ? '0' + n : String(n))
  return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`
}

/**
 * 自然周序号：以周一为一周开始（周一~周日），
 * 从 1970-01-05（周一）起算经过的完整周数。
 * 同一自然周内恒定不变，跨周 +1，无跨年跳变。
 */
function naturalWeekIndex(date) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const MONDAY_EPOCH = new Date(1970, 0, 5).getTime() // 1970-01-05 是周一
  return Math.floor((day.getTime() - MONDAY_EPOCH) / (7 * 86400000))
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
 * 食堂是否启用（sys_location.status = 1）；不存在视为停用（判定从严）
 */
async function isLocationEnabled(locationId) {
  if (!locationId || locationId <= 0) return false
  const rows = await query(
    'SELECT `status` FROM `sys_location` WHERE `id` = {{id}} LIMIT 1',
    { id: locationId }
  )
  if (!rows.length) return false
  return Number(rows[0].status) === 1
}

/**
 * 根据 openid 反查员工本人所属食堂：openid -> sys_emp.dept_id -> sys_dept.location_id
 * @returns {Promise<number>} location_id；无有效归属时返回 0
 */
async function resolveEmpLocationId(openid) {
  if (!openid) return 0
  const rows = await query(
    'SELECT d.`location_id` FROM `sys_emp` e ' +
    'LEFT JOIN `sys_dept` d ON d.`id` = e.`dept_id` ' +
    'WHERE e.`_openid` = {{openid}} AND e.`status` = 1 LIMIT 1',
    { openid }
  )
  if (!rows.length) return 0
  return Number(rows[0].location_id) || 0
}

/**
 * 选出某食堂「当前正在生效」的那一张菜单计划（即员工端今天实际看到的那张）。
 *
 * @param {number} locationId 食堂 id
 * @returns {Promise<{ picked: object|null, candidates: object[] }>}
 *          - picked     轮换选中的那张；无候选时为 null
 *          - candidates 全部候选（status=1 且今天在起止区间内），已按轮换顺序排好
 */
async function pickActivePlan(locationId) {
  if (!locationId || locationId <= 0) return { picked: null, candidates: [] }

  // 候选：启用中、食堂匹配、今天落在 start_date~end_date 内
  const plans = await query(
    'SELECT `id`, `name`, `status`, `start_date`, `end_date`, `location_id` ' +
    'FROM `menu_plan` ' +
    'WHERE `status` = 1 ' +
    '  AND `location_id` = {{location_id}} ' +
    '  AND `start_date` <= CURDATE() ' +
    '  AND `end_date`   >= CURDATE() ' +
    'ORDER BY `id` ASC',
    { location_id: locationId }
  )
  if (!plans || plans.length === 0) return { picked: null, candidates: [] }

  // 轮换顺序基准（必须完全确定，否则多计划时周次对应关系会整体错位）
  //    - name 为 "1""2""3" 时按数字升序（兼容历史数据存的字符串数字）；
  //    - name 无法解析为数字时 parseInt 结果为 NaN，均归 0，此时以 id 升序兜底。
  plans.sort((a, b) => {
    const na = parseInt(a.name) || 0
    const nb = parseInt(b.name) || 0
    return (na - nb) || (Number(a.id) - Number(b.id))
  })

  // 多 plan 时按自然周轮换
  //    例：start_date = 9月1日(周二) →
  //       9/1~9/6（该自然周）   第 1 周 → 菜单1
  //       9/7~9/13（下一自然周）第 2 周 → 菜单2
  let picked
  if (plans.length > 1) {
    // 只以解析成功的 start_date 作为锚点，避免脏数据导致 Invalid Date
    const anchorTimes = plans
      .map(p => new Date(normalizeDate(p.start_date) + 'T00:00:00').getTime())
      .filter(ts => !isNaN(ts))
    const weekDiff = anchorTimes.length
      ? naturalWeekIndex(new Date()) - naturalWeekIndex(new Date(Math.min(...anchorTimes)))
      : 0
    // 取模后再取正，确保下标始终落在 [0, length)
    picked = plans[((weekDiff % plans.length) + plans.length) % plans.length]
  } else {
    picked = plans[0]
  }
  return { picked, candidates: plans }
}

// ──────────────────────────────────────────────────────────────────
// Action: getCurrentMenu
//   入参：{ location_id? }
//   出参：{ plan: { id, name, status, start_date, end_date, location_id },
//           meals: [{ bf, lunch, dinner } × 7] }（index 0 对应 day_of_week=1 周一）
//   语义：取调用者本人所属食堂当前生效（status=1 且今天落在起止区间内）的计划；
//         多张计划时按自然周轮换——以最早 start_date 所在自然周为第 1 周，
//         同一自然周内恒定，跨周 +1，超出计划数回到第 1 张。
// ──────────────────────────────────────────────────────────────────
async function actionGetCurrentMenu(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''
  const locationId = await resolveEmpLocationId(openid)
  if (locationId <= 0) {
    return { code: -1, message: '未找到部门信息，请联系管理员', data: null }
  }

  // 1. 取当前生效的计划（轮换算法与 getMenuPlans 的「当前生效」标记同源）
  const { picked } = await pickActivePlan(locationId)
  if (!picked) {
    return { code: -1, message: '暂无菜单', data: null }
  }
  const planId = Number(picked.id)

  // 2. 该 plan 的每日菜品（7 天 × 3 餐 = 至多 21 行）
  const dailies = await query(
    'SELECT `day_of_week`, `meal_type`, `dish` ' +
    'FROM `menu_daily` ' +
    'WHERE `plan_id` = {{plan_id}} ' +
    'ORDER BY `day_of_week` ASC, `meal_type` ASC',
    { plan_id: planId }
  )

  // 3. 按 day_of_week 聚合为 7 天的 meals 数组（前端契约不变）
  const meals = []
  for (let i = 0; i < DAYS_PER_PLAN; i++) {
    meals.push({ bf: '', lunch: '', dinner: '' })
  }
  dailies.forEach(r => {
    const dow = Number(r.day_of_week)
    const field = MENU_MEAL_FIELD_BY_TYPE[Number(r.meal_type)]
    if (field && dow >= 1 && dow <= DAYS_PER_PLAN) {
      meals[dow - 1][field] = r.dish || ''
    }
  })

  return {
    code: 0,
    message: 'success',
    data: {
      plan: {
        id: picked.id,
        name: picked.name,
        status: picked.status,
        start_date: normalizeDate(picked.start_date),
        end_date: normalizeDate(picked.end_date),
        location_id: picked.location_id,
      },
      meals,
    },
  }
}

// ──────────────────────────────────────────────────────────────────
// Action: getMenuPlans（管理端）
//   入参：{ location_id }
//   出参：{ location_id, active_plan_id,
//           list: [{ id, name, status, start_date, end_date, location_id, dish_count,
//                    is_active, in_range }] }
//   语义：active_plan_id 为当前正在生效（轮换选中）的计划 id，0 表示无；
//         is_active 标记该条是否为当前生效（与员工端 getCurrentMenu 同源），
//         in_range 标记该条是否在有效期内但本轮未轮到（有效期重叠时才会出现）。
// ──────────────────────────────────────────────────────────────────
async function actionGetMenuPlans(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const locationId = Number(event.location_id) || 0
  if (locationId <= 0) return { code: -1, message: '请选择食堂', data: null }
  if (!await isLocationInRoleScope(openid, locationId)) {
    return { code: -1, message: '无权查看该食堂的菜单', data: null }
  }

  const plans = await query(
    'SELECT `id`, `name`, `status`, `start_date`, `end_date`, `location_id` ' +
    'FROM `menu_plan` WHERE `location_id` = {{location_id}} ' +
    'ORDER BY `start_date` DESC, `end_date` DESC, `id` ASC',
    { location_id: locationId }
  )

  // 统计各计划的菜品条数（批量一次查询，避免 N+1）
  const planIds = plans.map(p => Number(p.id)).filter(id => id > 0)
  const countMap = {}
  if (planIds.length) {
    const { ph, params } = buildIdClause(planIds)
    const countRows = await query(
      'SELECT `plan_id`, COUNT(*) AS cnt FROM `menu_daily` ' +
      'WHERE `plan_id` IN (' + ph + ') GROUP BY `plan_id`',
      params
    )
    countRows.forEach(r => { countMap[Number(r.plan_id)] = Number(r.cnt) || 0 })
  }

  // 计算「当前生效」的那一张：必须复用 pickActivePlan（与员工端 getCurrentMenu 同源），
  // 注意这里不能复用上面的 plans：上面查的是全部计划（含停用/未生效），
  // 而生效判定需 status=1 且今天落在起止区间内，语义不同，故单独取一次。
  const { picked: activePlan, candidates } = await pickActivePlan(locationId)
  const activePlanId = activePlan ? Number(activePlan.id) : 0
  const candidateIds = candidates.map(p => Number(p.id))
  const isCandidate = id => candidateIds.indexOf(Number(id)) >= 0

  const list = plans.map(p => {
    const startStr = normalizeDate(p.start_date)
    const endStr = normalizeDate(p.end_date)
    return {
      id: Number(p.id),
      name: (p.name && String(p.name)) || '',
      status: Number(p.status) === 0 ? 0 : 1,
      start_date: startStr,
      end_date: endStr,
      location_id: Number(p.location_id),
      dish_count: countMap[Number(p.id)] || 0,
      // 前端直接据此渲染标签，不在前端做任何日期/轮换判断（避免时区与算法漂移）
      is_active: Number(p.id) === activePlanId,
      // 在有效期内但本轮未轮到（多张计划有效期重叠时才会出现）
      in_range: isCandidate(p.id),
    }
  })

  return {
    code: 0,
    message: 'success',
    data: {
      location_id: locationId,
      active_plan_id: activePlanId,
      // 全部候选均为停用/过期时为 0，前端据此提示「当前无生效计划」
      list,
    },
  }
}

// ──────────────────────────────────────────────────────────────────
// Action: getMenuPlanDetail（管理端）
//   入参：{ id }
//   出参：{ id, name, status, start_date, end_date, location_id,
//           days: [{ day_of_week, label, bf, lunch, dinner }] }（固定 7 天）
// ──────────────────────────────────────────────────────────────────
async function actionGetMenuPlanDetail(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const id = Number(event.id) || 0
  if (id <= 0) return { code: -1, message: '缺少菜单计划 id', data: null }

  const rows = await query(
    'SELECT `id`, `name`, `status`, `start_date`, `end_date`, `location_id` ' +
    'FROM `menu_plan` WHERE `id` = {{id}} LIMIT 1',
    { id }
  )
  if (!rows.length) return { code: -1, message: '菜单计划不存在', data: null }

  const plan = rows[0]
  const locationId = Number(plan.location_id) || 0
  if (!await isLocationInRoleScope(openid, locationId)) {
    return { code: -1, message: '无权查看该菜单计划', data: null }
  }

  const dishRows = await query(
    'SELECT `day_of_week`, `meal_type`, `dish` FROM `menu_daily` WHERE `plan_id` = {{plan_id}}',
    { plan_id: id }
  )

  const days = []
  for (let d = 1; d <= 7; d++) {
    days.push({ day_of_week: d, label: DAY_OF_WEEK_LABEL_CN[d], bf: '', lunch: '', dinner: '' })
  }
  dishRows.forEach(r => {
    const d = Number(r.day_of_week)
    const field = MENU_MEAL_FIELD_BY_TYPE[Number(r.meal_type)]
    if (!field || d < 1 || d > 7) return
    days[d - 1][field] = (r.dish && String(r.dish)) || ''
  })

  return {
    code: 0,
    message: 'success',
    data: {
      id: Number(plan.id),
      name: (plan.name && String(plan.name)) || '',
      status: Number(plan.status) === 0 ? 0 : 1,
      start_date: normalizeDate(plan.start_date),
      end_date: normalizeDate(plan.end_date),
      location_id: locationId,
      days,
    },
  }
}

// ──────────────────────────────────────────────────────────────────
// Action: saveMenuPlan（管理端）
//   入参：{ id?(0/空=新增), name, location_id, status, start_date, end_date,
//           days: [{ day_of_week, bf, lunch, dinner }] }
//   出参：{ id }
//   语义：upsert menu_plan 后整体重写该计划的 menu_daily（先清后插，与前端表格保持一致）
// ──────────────────────────────────────────────────────────────────
async function actionSaveMenuPlan(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const id = Number(event.id) || 0
  const name = (event.name != null ? String(event.name) : '').trim()
  const locationId = Number(event.location_id) || 0
  const status = Number(event.status) === 0 ? 0 : 1
  const startDate = normalizeDate(event.start_date)
  const endDate = normalizeDate(event.end_date)

  if (!name) return { code: -1, message: '请填写菜单名称', data: null }
  if (locationId <= 0) return { code: -1, message: '请选择食堂', data: null }
  if (!startDate || !endDate) return { code: -1, message: '请选择起止日期', data: null }
  if (endDate < startDate) return { code: -1, message: '结束日期不能早于开始日期', data: null }
  if (!await isLocationInRoleScope(openid, locationId)) {
    return { code: -1, message: '无权配置该食堂的菜单', data: null }
  }
  // 新增仅允许落到启用中的食堂；编辑不拦（存量计划可能挂在已停用食堂下，保留编辑能力）
  if (id <= 0 && !await isLocationEnabled(locationId)) {
    return { code: -1, message: '该食堂已停用，无法新增菜单计划', data: null }
  }

  // 整理菜品网格：仅保留非空菜品
  const dishRows = []
  const days = Array.isArray(event.days) ? event.days : []
  days.forEach(item => {
    const d = Number(item && item.day_of_week) || 0
    if (d < 1 || d > 7) return
    Object.keys(MENU_MEAL_FIELD).forEach(field => {
      const dish = (item && item[field] != null ? String(item[field]) : '').trim()
      if (dish) dishRows.push({ day_of_week: d, meal_type: MENU_MEAL_FIELD[field], dish })
    })
  })

  let planId = id
  if (planId > 0) {
    // 编辑：原计划须存在，且原食堂与目标食堂都在管辖范围内
    const old = await query(
      'SELECT `location_id` FROM `menu_plan` WHERE `id` = {{id}} LIMIT 1',
      { id: planId }
    )
    if (!old.length) return { code: -1, message: '菜单计划不存在', data: null }
    if (!await isLocationInRoleScope(openid, Number(old[0].location_id) || 0)) {
      return { code: -1, message: '无权编辑该菜单计划', data: null }
    }
    await update(
      'UPDATE `menu_plan` SET `name` = {{name}}, `status` = {{status}}, ' +
      '`start_date` = {{start_date}}, `end_date` = {{end_date}}, ' +
      '`location_id` = {{location_id}}, `_openid` = {{openid}}, `updated_at` = NOW() ' +
      'WHERE `id` = {{id}}',
      {
        name,
        status,
        start_date: startDate,
        end_date: endDate,
        location_id: locationId,
        openid,
        id: planId,
      }
    )
  } else {
    await update(
      'INSERT INTO `menu_plan` (`name`, `status`, `start_date`, `end_date`, `location_id`, `_openid`) ' +
      'VALUES ({{name}}, {{status}}, {{start_date}}, {{end_date}}, {{location_id}}, {{openid}})',
      {
        name,
        status,
        start_date: startDate,
        end_date: endDate,
        location_id: locationId,
        openid,
      }
    )
    const created = await query(
      'SELECT `id` FROM `menu_plan` WHERE `location_id` = {{location_id}} AND `name` = {{name}} ' +
      'AND `start_date` = {{start_date}} AND `end_date` = {{end_date}} ' +
      'ORDER BY `id` DESC LIMIT 1',
      { location_id: locationId, name, start_date: startDate, end_date: endDate }
    )
    if (!created.length) return { code: -1, message: '菜单计划创建失败，请重试', data: null }
    planId = Number(created[0].id) || 0
  }

  // 重写菜品明细：先清空旧明细，再批量插入非空菜品
  await update('DELETE FROM `menu_daily` WHERE `plan_id` = {{plan_id}}', { plan_id: planId })
  if (dishRows.length) {
    const params = { plan_id: planId, openid }
    const values = dishRows.map((row, i) => {
      params['md_day' + i] = row.day_of_week
      params['md_meal' + i] = row.meal_type
      params['md_dish' + i] = row.dish
      return `({{plan_id}}, {{md_day${i}}}, {{md_meal${i}}}, {{md_dish${i}}}, {{openid}})`
    }).join(', ')
    await update(
      'INSERT INTO `menu_daily` (`plan_id`, `day_of_week`, `meal_type`, `dish`, `_openid`) ' +
      'VALUES ' + values,
      params
    )
  }

  return { code: 0, message: 'success', data: { id: planId } }
}

// ──────────────────────────────────────────────────────────────────
// Action: deleteMenuPlan（管理端）
//   入参：{ id }
//   语义：删除菜单计划及其全部菜品明细（menu_daily 先删，避免悬挂明细）
// ──────────────────────────────────────────────────────────────────
async function actionDeleteMenuPlan(event) {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''

  const id = Number(event.id) || 0
  if (id <= 0) return { code: -1, message: '缺少菜单计划 id', data: null }

  const rows = await query(
    'SELECT `location_id` FROM `menu_plan` WHERE `id` = {{id}} LIMIT 1',
    { id }
  )
  if (!rows.length) return { code: -1, message: '菜单计划不存在', data: null }
  if (!await isLocationInRoleScope(openid, Number(rows[0].location_id) || 0)) {
    return { code: -1, message: '无权删除该菜单计划', data: null }
  }

  await update('DELETE FROM `menu_daily` WHERE `plan_id` = {{plan_id}}', { plan_id: id })
  await update('DELETE FROM `menu_plan` WHERE `id` = {{id}}', { id })

  return { code: 0, message: 'success', data: null }
}

// ──────────────────────────────────────────────────────────────────
// 入口
// ──────────────────────────────────────────────────────────────────
exports.main = async (event, context) => {
  const { action } = event || {}
  try {
    switch (action) {
      case 'getCurrentMenu':      return await actionGetCurrentMenu(event)
      case 'getMenuPlans':        return await actionGetMenuPlans(event)
      case 'getMenuPlanDetail':   return await actionGetMenuPlanDetail(event)
      case 'saveMenuPlan':        return await actionSaveMenuPlan(event)
      case 'deleteMenuPlan':      return await actionDeleteMenuPlan(event)
      default:
        return { code: -1, message: `未知 action: ${action}`, data: null }
    }
  } catch (err) {
    // 详细错误只进日志（query/update 已在上层打印完整 SQL 与参数）
    console.error('[menu] error:', err)
    console.error('[menu] error stack:', err && err.stack)
    // getCurrentMenu 沿用原有对外提示，便于展示端区分「暂无菜单」与「服务异常」
    if (action === 'getCurrentMenu') {
      return { code: -1, message: '获取菜单失败: ' + (err.message || err), data: null }
    }
    // 其余（管理端）只给统一中文提示，避免把 $runSQL 的英文原始错误直接甩给用户
    return { code: -1, message: '操作失败，请重试', data: null }
  }
}
