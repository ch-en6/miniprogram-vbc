// 云函数 - 食堂端报餐统计导出（@cloudbase/node-sdk 访问云 MySQL）
//
// 职责：
//   exportPersonStatRange 人员×日期每餐数量 xlsx 用餐登记表
//
// 权限模型：与 kitchen 一致
//   食堂侧：openid -> sys_emp.role_id -> sys_role_location(多对多) -> location_id[]
//           所有查询限定在角色关联的食堂范围内（数据域隔离）；
//           未配置角色/食堂时返回空数据而非报错（无权限静默降级）。
//   身份一律取自云函数上下文 OPENID，不信任前端传入任何 role/location 参数。
//
const cloud = require('wx-server-sdk')
const cloudbaseSDK = require('@cloudbase/node-sdk')
const ExcelJS = require('exceljs')

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

// ──────────────────────────────────────────────────────────────────
// 权限解析：根据 openid 反查角色关联的食堂 location_id 列表
//   sys_emp.role_id -> sys_role_location.role_id -> location_id[]
// 返回 Number(location_id) 数组；无角色/未配置食堂时返回 []（调用方按无权限处理）
// ──────────────────────────────────────────────────────────────────
/**
 * 根据 openid 反查身份：role_id + emp_id
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
 * 根据角色关联的食堂，解析其下全部部门 id 列表
 *   resolveRoleLocations -> sys_dept.location_id IN (食堂) -> dept_id[]
 */
async function resolveRoleDeptIds(openid) {
  const locations = await resolveRoleLocations(openid)
  if (!locations.length) return []
  const { ph, params } = buildLocClause(locations)
  const deptRows = await query(
    'SELECT `id` FROM `sys_dept` WHERE `location_id` IN (' + ph + ')',
    params
  )
  return deptRows.map(r => Number(r.id)).filter(id => id > 0)
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
      '[kitchenExport][DEBUG] $runSQL SELECT FAILED:',
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

// 导出时间 -> "YYYY年M月"（展示于表名下方；未传则用云函数当前时间）
function formatExportDate(val) {
  let d
  if (val && typeof val === 'string') {
    const mm = val.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (mm) d = new Date(Number(mm[1]), Number(mm[2]) - 1, Number(mm[3]))
  }
  if (!d || isNaN(d.getTime())) d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
}

// 为单元格区域统一设置边框（合并单元格需逐格设置，保证网格完整）
function applyBorder(ws, startRow, startCol, endRow, endCol, border) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      ws.getCell(r, c).border = border
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Action: exportPersonStatRange
//   入参：{ startDate, endDate, dept_id?, deptName? }
//   出参：{ filename, content }  content 为 .xlsx 文件 base64
//   语义：查询时间段内每个人每天的每餐报餐数量，生成人员×日期用餐登记表
// ──────────────────────────────────────────────────────────────────
async function actionExportPersonStatRange(event) {
  const startDate = ymd(event.startDate)
  const endDate = ymd(event.endDate)
  if (!startDate || !endDate) {
    return { code: -1, message: '请提供开始和结束日期', data: null }
  }
  // 部门名：仅用于 Excel 标题与文件名展示（不参与 SQL，无注入面）
  const rawDeptName = String(event.deptName || '').trim()
  const safeDeptName = rawDeptName.replace(/[\\/:*?"<>|]/g, '_')
  const spanDays = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1
  if (spanDays > 92) {
    return { code: -1, message: '查询范围过大，最多支持 92 天', data: null }
  }

  const wxContext = cloud.getWXContext() || {}
  const deptIds = await resolveRoleDeptIds(wxContext.OPENID || '')
  if (!deptIds.length) {
    return { code: 0, message: 'success', data: { filename: '', content: '' } }
  }
  const { ph: deptPh, params: deptScopeParams } = buildLocClause(deptIds)

  // 指定部门（可选）
  const deptId = Number(event.dept_id) || 0
  let deptWhere = ''
  let deptParams = {}
  if (deptId > 0) {
    deptWhere = ' AND e.`dept_id` = {{dept_id}} '
    deptParams = { dept_id: deptId }
  }

  const rows = await query(
    'SELECT mo.`meal_date`, mo.`meal_type`, mo.`quantity`, e.`id` AS emp_id, e.`name` ' +
    'FROM `meal_order` mo ' +
    'LEFT JOIN `sys_emp` e ON e.`id` = mo.`emp_id` ' +
    'WHERE mo.`meal_date` BETWEEN {{startDate}} AND {{endDate}} ' +
    '  AND mo.`quantity` > 0 ' +
    '  AND e.`dept_id` IN (' + deptPh + ') ' +
    deptWhere +
    'ORDER BY e.`id` ASC, mo.`meal_date` ASC, mo.`meal_type` ASC',
    { startDate, endDate, ...deptScopeParams, ...deptParams }
  )

  // 生成日期列表
  const dates = []
  let cur = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  while (cur <= end) {
    dates.push(ymd(cur))
    cur.setDate(cur.getDate() + 1)
  }

  // 按人员分组
  const personMap = new Map()
  rows.forEach(r => {
    const key = String(r.emp_id)
    if (!personMap.has(key)) {
      personMap.set(key, {
        empId: r.emp_id,
        name: r.name || '未命名',
        records: {},
      })
    }
    const p = personMap.get(key)
    const date = r.meal_date
    if (!p.records[date]) {
      p.records[date] = { breakfast: 0, lunch: 0, dinner: 0 }
    }
    const mealType = Number(r.meal_type)
    const qty = Number(r.quantity) || 0
    if (mealType === 1) p.records[date].breakfast = qty
    if (mealType === 2) p.records[date].lunch = qty
    if (mealType === 3) p.records[date].dinner = qty
  })

  const persons = Array.from(personMap.values())
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'))

  if (!persons.length) {
    return { code: 0, message: 'success', data: { filename: '', content: '' } }
  }

  // ── 用 exceljs 生成真正的 .xlsx ──────────────────────────────
  const mealLabels = ['早餐', '午餐', '晚餐']
  const mealKeys = ['breakfast', 'lunch', 'dinner']
  const dateCount = dates.length
  const colCount = 3 + dateCount + 1 // 序号+姓名+餐别 + 日期 + 备注

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('用餐登记表')

  // 列宽（字符单位，参考原 HTML 的像素宽度）
  ws.getColumn(1).width = 6   // 序号
  ws.getColumn(2).width = 12  // 姓名
  ws.getColumn(3).width = 8   // 餐别
  for (let i = 0; i < dateCount; i++) {
    ws.getColumn(4 + i).width = 5.5 // 日期
  }
  ws.getColumn(colCount).width = 12 // 备注

  // 边框样式
  const thinBorder = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  }

  // 第 1 行：标题
  ws.mergeCells(1, 1, 1, colCount)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = rawDeptName ? `${rawDeptName}用餐登记表` : '用餐登记表'
  titleCell.font = { size: 16, bold: true, name: '仿宋_GB2312' }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 32

  // 第 2 行：日期（右对齐）
  ws.mergeCells(2, 1, 2, colCount)
  const dateCell = ws.getCell(2, 1)
  dateCell.value = `日期：${startDate.replace(/-/g, '.')} - ${endDate.replace(/-/g, '.')}`
  dateCell.font = { size: 11, name: '仿宋_GB2312' }
  dateCell.alignment = { horizontal: 'right', vertical: 'middle' }
  ws.getRow(2).height = 22

  // 第 3 行：表头
  const headerRow = ws.getRow(3)
  headerRow.height = 35
  const headerValues = ['序号', '姓名', '餐别']
  dates.forEach(d => headerValues.push(String(parseInt(d.slice(8, 10), 10))))
  headerValues.push('备注')
  headerValues.forEach((v, idx) => {
    const cell = ws.getCell(3, idx + 1)
    cell.value = v
    cell.font = { bold: true, name: '仿宋_GB2312', size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
    cell.border = thinBorder
  })

  // 数据行：每人 3 行（早/午/晚），序号/姓名/备注跨 3 行合并
  let rowIdx = 4
  persons.forEach((p, idx) => {
    const startRow = rowIdx
    mealKeys.forEach((mealKey, mIdx) => {
      dates.forEach(date => {
        const record = p.records[date] || {}
        const qty = record[mealKey] || 0
        const cell = ws.getCell(rowIdx, 4 + dates.indexOf(date))
        cell.value = qty > 0 ? qty : null
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = thinBorder
        cell.font = { name: '仿宋_GB2312', size: 10 }
      })
      const mealCell = ws.getCell(rowIdx, 3)
      mealCell.value = mealLabels[mIdx]
      mealCell.alignment = { horizontal: 'center', vertical: 'middle' }
      mealCell.border = thinBorder
      mealCell.font = { name: '仿宋_GB2312', size: 10 }
      ws.getRow(rowIdx).height = 20
      rowIdx += 1
    })
    // 序号 / 姓名 / 备注 合并
    ws.mergeCells(startRow, 1, startRow + 2, 1)
    const seqCell = ws.getCell(startRow, 1)
    seqCell.value = idx + 1
    seqCell.alignment = { horizontal: 'center', vertical: 'middle' }
    seqCell.border = thinBorder
    seqCell.font = { name: '仿宋_GB2312', size: 10 }

    ws.mergeCells(startRow, 2, startRow + 2, 2)
    const nameCell = ws.getCell(startRow, 2)
    nameCell.value = p.name
    nameCell.alignment = { horizontal: 'center', vertical: 'middle' }
    nameCell.border = thinBorder
    nameCell.font = { name: '仿宋_GB2312', size: 10 }

    ws.mergeCells(startRow, colCount, startRow + 2, colCount)
    const remarkCell = ws.getCell(startRow, colCount)
    remarkCell.border = thinBorder
  })

  const buffer = await wb.xlsx.writeBuffer()
  return {
    code: 0,
    message: 'success',
    data: {
      filename: `${safeDeptName}用餐登记表_${startDate}_${endDate}.xlsx`,
      content: buffer.toString('base64'),
    },
  }
}

// ──────────────────────────────────────────────────────────────────
// Action: exportMonthBilling
//   入参：{ month, dept_id?, deptName?, exportTime? }
//   出参：{ filename, content }  content 为 .xlsx 文件 base64
//   语义：按部门×月份聚合收费账单，生成「饮食自交情况表」
//        每人固定 3 行（早/中/晚），序号/姓名/自交金额/签字/备注 跨行合并
//        列定义（与图片样式一致）：
//          序号 | 姓名 | 餐别 | 餐数 | 标准 | 家属用餐 | 自交金额 | 签字 | 备注
//          餐数=总数量(qty)、标准=员工单价(empPrice)、家属用餐=家属餐总价(famAmount)
// ──────────────────────────────────────────────────────────────────
async function actionExportMonthBilling(event) {
  const month = String(event.month || '').trim()
  const mm = month.match(/^(\d{4})-(\d{1,2})$/)
  if (!mm) {
    return { code: -1, message: 'month 参数格式应为 YYYY-MM', data: null }
  }
  const year = Number(mm[1])
  const monthNum = Number(mm[2])
  const pad = n => (n < 10 ? '0' + n : n)
  const startDate = `${year}-${pad(monthNum)}-01`
  const endDate = `${year}-${pad(monthNum)}-${pad(new Date(year, monthNum, 0).getDate())}`

  const dept_id = Number(event.dept_id) || 0
  if (dept_id <= 0) {
    return { code: -1, message: '缺少部门参数', data: null }
  }

  const rawDeptName = String(event.deptName || '').trim()
  const safeDeptName = rawDeptName.replace(/[\\/:*?"<>|]/g, '_')

  const wxContext = cloud.getWXContext() || {}
  const deptIds = await resolveRoleDeptIds(wxContext.OPENID || '')
  if (!deptIds.includes(dept_id)) {
    return { code: 0, message: 'success', data: { filename: '', content: '' } }
  }

  // 部门名（展示用；入参未传时兜底取库表）
  let deptName = rawDeptName
  if (!deptName) {
    const deptRows = await query(
      'SELECT `name` FROM `sys_dept` WHERE `id` = {{dept_id}} LIMIT 1',
      { dept_id }
    )
    deptName = deptRows.length ? String(deptRows[0].name || '') : ''
  }

  const rows = await query(
    'SELECT mo.`emp_id`, COALESCE(e.`name`, \'\') AS name, mo.`meal_type`, ' +
    '       SUM(mo.`quantity`) AS qty, ' +
    '       MAX(mo.`emp_price`) AS emp_price, ' +
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

  const round2 = n => Math.round(n * 100) / 100

  const personMap = new Map()
  rows.forEach(r => {
    const eid = String(r.emp_id)
    if (!personMap.has(eid)) {
      personMap.set(eid, { empId: r.emp_id, name: r.name || '未命名', meals: {} })
    }
    const p = personMap.get(eid)
    const mt = Number(r.meal_type)
    p.meals[mt] = {
      qty: Number(r.qty) || 0,
      empPrice: round2(Number(r.emp_price) || 0),
      famAmount: round2(Number(r.fam_amount) || 0),
      amount: round2((Number(r.emp_amount) || 0) + (Number(r.fam_amount) || 0)),
    }
  })

  const persons = Array.from(personMap.values()).sort((a, b) => Number(a.empId) - Number(b.empId))
  if (!persons.length) {
    return { code: 0, message: 'success', data: { filename: '', content: '' } }
  }

  const colCount = 9
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('伙食自交情况表')

  // 列宽
  ws.getColumn(1).width = 6   // 序号
  ws.getColumn(2).width = 12  // 姓名
  ws.getColumn(3).width = 8   // 餐别
  ws.getColumn(4).width = 8   // 餐数
  ws.getColumn(5).width = 8   // 标准
  ws.getColumn(6).width = 12  // 家属用餐
  ws.getColumn(7).width = 12  // 自交金额
  ws.getColumn(8).width = 12  // 签字
  ws.getColumn(9).width = 12  // 备注

  const thinBorder = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  }
  const baseFont = { name: '仿宋_GB2312', size: 10 }

  // 第 1 行：标题
  ws.mergeCells(1, 1, 1, colCount)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = `${deptName}${year}年${monthNum}月伙食自交情况表`.trim()
  titleCell.font = { size: 16, bold: true, name: '仿宋_GB2312' }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 34

  // 第 2 行：导出时间（右对齐）
  ws.mergeCells(2, 1, 2, colCount)
  const timeCell = ws.getCell(2, 1)
  timeCell.value = formatExportDate(event.exportTime || '')
  timeCell.font = { size: 11, name: '仿宋_GB2312' }
  timeCell.alignment = { horizontal: 'right', vertical: 'middle' }
  ws.getRow(2).height = 22

  // 第 3 行：表头
  const headers = ['序号', '姓名', '餐别', '餐数', '标准', '家属用餐', '自交金额', '签字', '备注']
  const headerRow = ws.getRow(3)
  headerRow.height = 24
  headers.forEach((v, idx) => {
    const cell = ws.getCell(3, idx + 1)
    cell.value = v
    cell.font = { bold: true, name: '仿宋_GB2312', size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
    cell.border = thinBorder
  })

  // 数据行：每人 3 行（早/中/晚），序号/姓名/自交金额/签字/备注 跨 3 行合并
  const mealLabels = ['早餐', '中餐', '晚餐'] // 与图片样式一致
  let rowIdx = 4
  persons.forEach((p, idx) => {
    const startRow = rowIdx
    let personTotal = 0
    for (let m = 0; m < 3; m++) {
      const meal = p.meals[m] || {}
      personTotal += Number(meal.amount) || 0

      const mealCell = ws.getCell(rowIdx, 3)
      mealCell.value = mealLabels[m]
      mealCell.font = baseFont
      mealCell.alignment = { horizontal: 'center', vertical: 'middle' }
      mealCell.border = thinBorder

      const qtyCell = ws.getCell(rowIdx, 4)
      qtyCell.value = Number(meal.qty) > 0 ? meal.qty : null
      qtyCell.font = baseFont
      qtyCell.alignment = { horizontal: 'center', vertical: 'middle' }
      qtyCell.border = thinBorder

      const priceCell = ws.getCell(rowIdx, 5)
      priceCell.value = Number(meal.empPrice) > 0 ? meal.empPrice : null
      priceCell.font = baseFont
      priceCell.alignment = { horizontal: 'center', vertical: 'middle' }
      priceCell.border = thinBorder

      const famCell = ws.getCell(rowIdx, 6)
      famCell.value = Number(meal.famAmount) > 0 ? meal.famAmount : null
      famCell.font = baseFont
      famCell.alignment = { horizontal: 'center', vertical: 'middle' }
      famCell.border = thinBorder

      ws.getRow(rowIdx).height = 20
      rowIdx += 1
    }
    personTotal = round2(personTotal)

    // 序号
    ws.mergeCells(startRow, 1, startRow + 2, 1)
    applyBorder(ws, startRow, 1, startRow + 2, 1, thinBorder)
    const seqCell = ws.getCell(startRow, 1)
    seqCell.value = idx + 1
    seqCell.font = baseFont
    seqCell.alignment = { horizontal: 'center', vertical: 'middle' }

    // 姓名
    ws.mergeCells(startRow, 2, startRow + 2, 2)
    applyBorder(ws, startRow, 2, startRow + 2, 2, thinBorder)
    const nameCell = ws.getCell(startRow, 2)
    nameCell.value = p.name
    nameCell.font = baseFont
    nameCell.alignment = { horizontal: 'center', vertical: 'middle' }

    // 自交金额（当月该人所有餐次合计）
    ws.mergeCells(startRow, 7, startRow + 2, 7)
    applyBorder(ws, startRow, 7, startRow + 2, 7, thinBorder)
    const amountCell = ws.getCell(startRow, 7)
    amountCell.value = personTotal
    amountCell.font = baseFont
    amountCell.alignment = { horizontal: 'center', vertical: 'middle' }

    // 签字
    ws.mergeCells(startRow, 8, startRow + 2, 8)
    applyBorder(ws, startRow, 8, startRow + 2, 8, thinBorder)
    const signCell = ws.getCell(startRow, 8)
    signCell.font = baseFont
    signCell.alignment = { horizontal: 'center', vertical: 'middle' }

    // 备注
    ws.mergeCells(startRow, 9, startRow + 2, 9)
    applyBorder(ws, startRow, 9, startRow + 2, 9, thinBorder)
    const remarkCell = ws.getCell(startRow, 9)
    remarkCell.font = baseFont
    remarkCell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  const buffer = await wb.xlsx.writeBuffer()
  return {
    code: 0,
    message: 'success',
    data: {
      filename: `${safeDeptName}伙食自交情况表_${month}.xlsx`,
      content: buffer.toString('base64'),
    },
  }
}

// ──────────────────────────────────────────────────────────────────
// 入口
// ──────────────────────────────────────────────────────────────────
exports.main = async (event, context) => {
  const { action } = event || {}
  try {
    switch (action) {
      case 'exportPersonStatRange': return await actionExportPersonStatRange(event)
      case 'exportMonthBilling': return await actionExportMonthBilling(event)
      default:
        return { code: -1, message: `未知 action: ${action}`, data: null }
    }
  } catch (err) {
    console.error('[kitchenExport] error:', err)
    console.error('[kitchenExport] error stack:', err && err.stack)
    return { code: -1, message: '操作失败，请重试', data: null }
  }
}
