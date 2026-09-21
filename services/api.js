// services/api.js — 业务接口封装（集中管理所有接口调用）
// 统一约定：云函数统一返回 { code, message, data }；
//   所有方法成功（code === 0）时 resolve 业务数据 data；
//   失败（code !== 0 或云函数异常）时 reject Error(message)，message 为可直接展示的中文提示。
// 页面调用统一用 try/catch + err.message 处理，不再关心 result/code 包装结构。

/**
 * 统一的云函数调用包装（解包）
 * @param {string} name 云函数名
 * @param {object} [data] 入参
 * @returns {Promise<*>} 成功 resolve data；失败 reject Error
 */
function call(name, data) {
  return wx.cloud.callFunction({ name, data }).then(res => {
    const result = res && res.result
    if (result && result.code === 0) return result.data
    throw new Error((result && result.message) || '操作失败，请重试')
  })
}

// ═══════════════════════════════════════════════════════════
// 认证模块
// ═══════════════════════════════════════════════════════════
const AuthAPI = {
  /**
   * 账号密码登录（云函数：校验账号密码 + 用 code 换 openid 并写入 sys_emp）
   * 注意：未注册 / 微信已绑定 / 密码错误 等业务失败以 code === 0 + allowed/pwdError 返回，
   * 本方法会正常 resolve，由调用方按 allowed/pwdError 分支处理（data.message 为具体原因）。
   * @param {{ phone: string, password: string, loginCode: string }} params
   * @returns {Promise<{allowed: boolean, pwdError: boolean, emp?: object|null, message?: string}>}
   */
  checkLogin: ({ phone, password, loginCode }) =>
    call('checkLogin', { phone, password, loginCode }),
}

// ═══════════════════════════════════════════════════════════
// 报餐记录云函数模块（mealOrder 用户侧 action）
// ═══════════════════════════════════════════════════════════
const MealOrderAPI = {
  /**
   * 获取指定日期区间的报餐记录（按员工；emp_id 可选，云函数按 openid 反查身份，防越权）
   * @param {{ startDate: string, endDate: string, emp_id?: number|string }} params
   * @returns {Promise<Array>} 报餐记录数组
   */
  getRange: (params) => call('mealOrder', { action: 'getRange', ...params }),
  /**
   * 获取某月报餐记录（按员工，月历/首页用；emp_id 可选，云函数按 openid 反查身份，防越权）
   * @param {{ month: string, emp_id?: number|string }} params - month 格式 "YYYY-MM"
   * @returns {Promise<Array>} 当月报餐记录数组
   */
  getMonth: (params) => call('mealOrder', { action: 'getMonth', ...params }),
  /**
   * 保存/更新单日报餐
   * 说明：员工身份/部门/食堂由云函数按 openid 反查
   * @param {{ date: string, breakfast: number, lunch: number, dinner: number }} params
   * @returns {Promise<*>}
   */
  save: (params) => call('mealOrder', { action: 'save', ...params }),
  /**
   * 删除单日报餐记录（emp_id 可选，云函数按 openid 反查身份，防越权）
   * @param {{ date: string, emp_id?: number|string }} params
   * @returns {Promise<*>}
   */
  remove: (params) => call('mealOrder', { action: 'remove', ...params }),
  /**
   * 获取当前员工所属食堂的启用状态
   * @returns {Promise<{ location_id: number, enabled: boolean }>} enabled=true 表示可报餐
   */
  getLocationStatus: () => call('mealOrder', { action: 'getLocationStatus' }),
}

// ═══════════════════════════════════════════════════════════
// 价格配置云函数模块
// ═══════════════════════════════════════════════════════════
const PriceConfigAPI = {
  /**
   * 获取价格配置（按部门）
   * @param {number|string} dept_id
   * @returns {Promise<object>} 价格配置对象
   */
  getConfig: (dept_id) => call('getPriceConfig', { dept_id }),
}

// ═══════════════════════════════════════════════════════════
// 菜单云函数模块（云函数：menu）
// ═══════════════════════════════════════════════════════════
const MenuAPI = {
  /**
   * 获取当前轮换菜单（自动根据时间范围轮换，且仅返回该食堂的菜单）
   * @param {number|string} locationId - 目标食堂/部门 location_id
   * @returns {Promise<{plan: object, meals: Array}>} 菜单对象（含 meals 数组）
   *   meals 元素: { bf, lunch, dinner }，index 0 对应周一
   */
  getCurrentMenu: (locationId) =>
    call('menu', { action: 'getCurrentMenu', location_id: locationId }),
  /**
   * 菜单配置：查询某食堂的菜单计划列表（受当前角色管理范围约束）
   * @param {{ locationId: number|string }} params
   * @returns {Promise<{location_id: number, list: Array}>}
   *   list 元素: { id, name, status, start_date, end_date, location_id, dish_count }
   */
  getMenuPlans: ({ locationId }) =>
    call('menu', { action: 'getMenuPlans', location_id: Number(locationId) || 0 }),
  /**
   * 菜单配置：查询菜单计划详情（含 7 天 × 3 餐菜品网格）
   * @param {{ id: number|string }} params
   * @returns {Promise<{id, name, status, start_date, end_date, location_id, days}>}
   *   days 元素: { day_of_week: 1~7, label, bf, lunch, dinner }
   */
  getMenuPlanDetail: ({ id }) =>
    call('menu', { action: 'getMenuPlanDetail', id: Number(id) || 0 }),
  /**
   * 菜单配置：新增/更新菜单计划（菜品明细按传入网格整体重写）
   * @param {{ id?: number|string, name: string, locationId: number|string, status: 0|1,
   *           startDate: string, endDate: string,
   *           days: Array<{ day_of_week: number, bf: string, lunch: string, dinner: string }> }} params
   * @returns {Promise<{id: number}>}
   */
  saveMenuPlan: ({ id, name, locationId, status, startDate, endDate, days }) =>
    call('menu', {
      action: 'saveMenuPlan',
      id: Number(id) || 0,
      name,
      location_id: Number(locationId) || 0,
      status: Number(status) === 0 ? 0 : 1,
      start_date: startDate,
      end_date: endDate,
      days: Array.isArray(days) ? days : [],
    }),
  /**
   * 菜单配置：删除菜单计划（连带删除其全部菜品明细）
   * @param {{ id: number|string }} params
   * @returns {Promise<*>}
   */
  deleteMenuPlan: ({ id }) =>
    call('menu', { action: 'deleteMenuPlan', id: Number(id) || 0 }),
}

// ═══════════════════════════════════════════════════════════
// 用户资料模块（云函数）
// ═══════════════════════════════════════════════════════════
const UserAPI = {
  /**
   * 获取部门名称（兜底：老版本缓存缺 dept_name 时调用）
   * @param {number|string} dept_id
   * @returns {Promise<{dept_name: string}>}
   */
  getDeptName: (dept_id) => call('getDeptName', { dept_id }),
  /**
   * 修改密码（empId 可选，云函数按 openid 反查身份，防越权）
   * @param {{ empId?: number|string, oldPassword: string, newPassword: string }} params
   * @returns {Promise<*>}
   */
  changePassword: ({ empId, oldPassword, newPassword }) =>
    call('changePassword', { empId, oldPassword, newPassword }),
}

// ═══════════════════════════════════════════════════════════
// 食堂工作台模块
// ═══════════════════════════════════════════════════════════
const KitchenAPI = {
  /**
   * 食堂工作台：按日期汇总报餐数据（云函数，按部门维度）
   * @param {string} date - 日期 YYYY-MM-DD
   * @returns {Promise<{meals: object, depts: Array}>}
   */
  getTodaySummary: (date) => call('kitchen', { action: 'getKitchenSummary', date }),
  /**
   * 获取报餐明细列表（员工维度，分页）
   * @param {object} [params]
   * @returns {Promise<{list: Array, total: number, total_qty: number}>}
   */
  getTodayDetail: (params = {}) => call('kitchen', { action: 'getKitchenDetail', ...params }),
  /**
   * 按姓名或手机号（合并模糊匹配）从云数据库查询报餐记录
   * @param {string} keyword - 姓名/手机号关键词
   * @param {string} date - 日期 YYYY-MM-DD
   * @param {string} [meal] - 餐别筛选 'breakfast'|'lunch'|'dinner'
   * @returns {Promise<{found: boolean, list: Array, total: number, keyword: string, date: string}>}
   */
  searchByKeyword: (keyword, date, meal) =>
    call('kitchen', { action: 'searchByKeyword', keyword, date, meal }),
  /**
   * 核销/撤销核销某员工某餐次的报餐
   * @param {{ empId: number|string, date: string, mealType: 'breakfast'|'lunch'|'dinner', verified?: 1|0 }} params
   *   verified: 1 = 核销，0 = 撤销核销
   * @returns {Promise<*>}
   */
  verifyMeal: ({ empId, date, mealType, verified }) =>
    call('kitchen', { action: 'verifyMeal', emp_id: empId, date, meal_type: mealType, verified }),
  /**
   * 统计页：按日期范围统计每日三餐报餐份数（含家属份数）
   * @param {{ startDate: string, endDate: string, deptId?: number|string }} params - YYYY-MM-DD
   * @returns {Promise<{range: {startDate: string, endDate: string}, days: Array, summary: object}>}
   *   days 元素: { date, weekday, breakfast, lunch, dinner, breakfastFamily, lunchFamily, dinnerFamily, total }
   */
  getStatRange: ({ startDate, endDate, deptId }) =>
    call('kitchen', { action: 'getStatRange', startDate, endDate, dept_id: deptId || 0 }),
  /**
   * 统计页：导出人员×日期维度的用餐登记表
   * @param {{ startDate: string, endDate: string, deptId?: number|string, deptName?: string }} params - YYYY-MM-DD
   *   deptName 用于 Excel 标题与文件名展示
   * @returns {Promise<{filename: string, content: string}>} content 为 xlsx 文件的 base64
   */
  exportPersonStatRange: ({ startDate, endDate, deptId, deptName }) =>
    call('kitchenExport', { action: 'exportPersonStatRange', startDate, endDate, dept_id: deptId || 0, deptName }),
  /**
   * 部门统计页：获取当前用户角色管理的食堂及归属食堂的部门列表
   * @returns {Promise<{locations: Array, depts: Array}>}
   */
  getMyDepts: () => call('deptAdmin', { action: 'getMyDepts' }),
  /**
   * 收费管理：查询某部门某月收费账单（数据源 meal_order，按 人×餐别 聚合计费）
   * @param {{ month: string, deptId: number|string }} params - month 格式 YYYY-MM
   * @returns {Promise<{month: string, dept_id: number, dept_name: string, list: Array, totalAmount: number}>}
   *   list 元素: { id, name, mealLabel, qty, family, empPrice, familyPrice, empAmount, famAmount, amount }
   */
  getMonthBilling: ({ month, deptId }) =>
    call('deptAdmin', { action: 'getMonthBilling', month, dept_id: deptId }),
  /**
   * 收费管理：导出某部门某月「伙食自交情况表」（Excel）
   * @param {{ month: string, deptId: number|string, deptName?: string, exportTime?: string }} params
   *   - month 格式 YYYY-MM（标题、文件名、数据范围）
   *   - deptName 用于 Excel 标题（缺省时云函数取库表）
   *   - exportTime 客户端本地导出时间 YYYY-MM-DD，用于表名下方日期展示（缺省用云函数当前时间）
   * @returns {Promise<{filename: string, content: string}>} content 为 xlsx 文件的 base64
   */
  exportMonthBilling: ({ month, deptId, deptName, exportTime }) =>
    call('kitchenExport', {
      action: 'exportMonthBilling',
      month,
      dept_id: deptId || 0,
      deptName,
      exportTime,
    }),
  /**
   * 员工管理：按部门 + 关键字查询员工列表（受当前角色管理范围约束）
   * @param {{ deptId?: number|string, keyword?: string }} [params]
   *   deptId = 0 或不传表示角色范围内全部部门
   * @returns {Promise<{list: Array}>}
   *   list 元素: { id, name, phone, dept_id, dept_name, role_id, role_name,
   *             role_code, status, has_openid, created_at, updated_at }
   *   role_code: 'employee' 普通员工 / 'kitchen' 食堂员工
   */
  getStaffList: (params = {}) => {
    const { deptId, keyword } = params || {}
    return call('deptAdmin', {
      action: 'getStaffList',
      dept_id: Number(deptId) || 0,
      keyword: keyword || '',
    })
  },
  /**
   * 员工管理：新增员工
   * @param {{ name: string, phone: string, deptId: number|string, status?: 0|1, roleId?: number|string }} params
   * @returns {Promise<{id: number, password: string}>} password 为后端生成的初始密码（仅返回一次）
   */
  addStaff: ({ name, phone, deptId, status, roleId }) =>
    call('deptAdmin', {
      action: 'addStaff',
      name,
      phone,
      dept_id: Number(deptId) || 0,
      status: Number(status) === 0 ? 0 : 1,
      role_id: Number(roleId) || 0,
    }),
  /**
   * 员工管理：编辑员工基础信息 + 身份（roleId）
   *   roleId 不传 = 保持原身份；0 = 转普通员工（写全局 employee 角色）；>0 = 转食堂员工
   * @param {{ id: number|string, name: string, phone: string, deptId: number|string,
   *           status: 0|1, roleId?: number|string }} params
   * @returns {Promise<*>}
   */
  updateStaff: ({ id, name, phone, deptId, status, roleId }) => {
    const payload = {
      action: 'updateStaff',
      id: Number(id) || 0,
      name,
      phone,
      dept_id: Number(deptId) || 0,
      status: Number(status) === 0 ? 0 : 1,
    }
    // 显式传 roleId（含 0）才提交身份变更；不传表示保持原身份（后端兼容旧调用）
    if (roleId !== undefined && roleId !== null && String(roleId) !== '') {
      payload.role_id = Number(roleId)
    }
    return call('deptAdmin', payload)
  },
  /**
   * 员工管理：解绑员工微信（清空 _openid）
   * @param {{ id: number|string }} params
   * @returns {Promise<*>}
   */
  unbindStaffWechat: ({ id }) =>
    call('deptAdmin', { action: 'unbindStaffWechat', id: Number(id) || 0 }),
  /**
   * 员工管理：重置员工密码（返回新密码明文，仅一次）
   * @param {{ id: number|string }} params
   * @returns {Promise<{password: string}>}
   */
  resetStaffPassword: ({ id }) =>
    call('deptAdmin', { action: 'resetStaffPassword', id: Number(id) || 0 }),
  /**
   * 员工管理：查询 deptId 部门当前操作者可分配的角色（添加/编辑员工选身份用）
   * @param {{ deptId: number|string, roleId?: number|string }} params
   *   roleId: 编辑中员工的当前身份，后端会回补该项（preserved=true）保证下拉能回显原身份
   * @returns {Promise<{list: Array<{role_id: number, role_code: string,
   *                                 role_name: string, preserved?: boolean}>,
   *                     operator_code: string}>}
   *   operator_code: 操作者角色 code（deptAdmin / sysAdmin），供前端决定 UI
   */
  getAssignableRoles: ({ deptId, roleId }) =>
    call('deptAdmin', {
      action: 'getAssignableRoles',
      dept_id: Number(deptId) || 0,
      role_id: Number(roleId) || 0,
    }),
}

// ═══════════════════════════════════════════════════════════
// 公告模块
// ═══════════════════════════════════════════════════════════
const NoticeAPI = {
  /**
   * 获取最新公告
   * @param {object} [params]
   * @param {number} [params.location_id] 优先按 location_id 过滤
   * @param {number} [params.dept_id] 未传 location_id 时按 dept_id 反查 sys_dept.location_id
   * @returns {Promise<object|null>} 公告对象；无公告时 resolve null
   */
  getLatest: (params = {}) => call('notice', { action: 'getLatestNotice', ...params }),
  /**
   * 公告管理：查询某食堂的公告列表（含草稿，按发布时间倒序；受当前角色管理范围约束）
   * @param {object} params
   * @param {number|string} params.locationId      归属食堂 id
   * @param {string} [params.keyword='']           标题 / 正文模糊匹配关键词，最大 50 字符（截断）
   * @param {0|1|'all'} [params.status='all']      'all'=不按状态过滤，1=已发布，0=草稿
   * @returns {Promise<{location_id: number, list: Array}>}
   *   list 元素: { id, title, content, status, publish_time, created_by,
   *                created_by_name, created_at, updated_at, location_id }
   */
  getNoticeList: ({ locationId, keyword = '', status = 'all' } = {}) =>
    call('notice', {
      action: 'getNoticeList',
      location_id: Number(locationId) || 0,
      keyword: String(keyword || ''),
      status,
    }),
  /**
   * 公告管理：新增 / 编辑公告（id 为空或 0 表示新增）
   * @param {{ id?: number|string, title: string, content: string, status: number,
   *           locationId: number|string, publishTime?: string }} params
   *   status: 1=发布，0=草稿；publishTime 留空且发布时由后端取当前时间
   * @returns {Promise<{id: number}>}
   */
  saveNotice: ({ id = 0, title, content, status, locationId, publishTime = '' }) =>
    call('notice', {
      action: 'saveNotice',
      id: Number(id) || 0,
      title: title || '',
      content: content || '',
      status: Number(status) === 1 ? 1 : 0,
      location_id: Number(locationId) || 0,
      publish_time: publishTime || '',
    }),
  /**
   * 公告管理：删除公告
   * @param {{ id: number|string }} params
   * @returns {Promise<null>}
   */
  deleteNotice: ({ id }) => call('notice', { action: 'deleteNotice', id: Number(id) || 0 }),
}

module.exports = {
  AuthAPI,
  MealOrderAPI,
  PriceConfigAPI,
  MenuAPI,
  UserAPI,
  KitchenAPI,
  NoticeAPI,
}
