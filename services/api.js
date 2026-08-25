// services/api.js — 业务接口封装（集中管理所有接口调用）

// ═══════════════════════════════════════════════════════════
// 认证模块
// ═══════════════════════════════════════════════════════════
const AuthAPI = {
  /**
   * 账号密码登录（云函数：校验账号密码 + 用 code 换 openid 并写入 sys_emp）
   * @param {{ phone: string, password: string, loginCode: string }} params
   * @returns {Promise<{result: {code: number, message?: string, data?: object}}>}
   */
  checkLogin: ({ phone, password, loginCode }) =>
    wx.cloud.callFunction({ name: 'checkLogin', data: { phone, password, loginCode } }),
}

// ═══════════════════════════════════════════════════════════
// 报餐记录云函数模块（mealOrder 用户侧 action）
// ═══════════════════════════════════════════════════════════
const MealOrderAPI = {
  /**
   * 获取指定日期区间的报餐记录（按员工；emp_id 可选，云函数按 openid 反查身份，防越权）
   * @param {{ startDate: string, endDate: string, emp_id?: number|string }} params
   * @returns {Promise<{result: {code: number, message?: string, data?: Array}}>} - 云函数原始返回
   */
  getRange: (params) =>
    wx.cloud.callFunction({
      name: 'mealOrder',
      data: { action: 'getRange', ...params }
    }),
  /**
   * 获取某月报餐记录（按员工，月历/首页用；emp_id 可选，云函数按 openid 反查身份，防越权）
   * @param {{ month: string, emp_id?: number|string }} params - month 格式 "YYYY-MM"
   * @returns {Promise<{result: {code: number, message?: string, data?: Array}}>}
   */
  getMonth: (params) =>
    wx.cloud.callFunction({
      name: 'mealOrder',
      data: { action: 'getMonth', ...params }
    }),
  /**
   * 保存/更新单日报餐
   * 说明：员工身份/部门/食堂由云函数按 openid 反查，前端无需传 emp_id/dept_id/location_id/_openid（传了也会被忽略）
   * @param {{ date: string, breakfast: number, lunch: number, dinner: number }} params
   * @returns {Promise<{result: {code: number, message?: string, data?: *}}>}
   */
  save: (params) =>
    wx.cloud.callFunction({
      name: 'mealOrder',
      data: { action: 'save', ...params }
    }),
  /**
   * 删除单日报餐记录（emp_id 可选，云函数按 openid 反查身份，防越权）
   * @param {{ date: string, emp_id?: number|string }} params
   * @returns {Promise<{result: {code: number, message?: string}}>}
   */
  remove: (params) =>
    wx.cloud.callFunction({
      name: 'mealOrder',
      data: { action: 'remove', ...params }
    }),
}

// ═══════════════════════════════════════════════════════════
// 价格配置云函数模块
// ═══════════════════════════════════════════════════════════
const PriceConfigAPI = {
  /**
   * 获取价格配置（按部门）
   * @param {number|string} dept_id
   * @returns {Promise<{result: {code: number, message?: string, data?: object}}>}
   */
  getConfig: (dept_id) =>
    wx.cloud.callFunction({
      name: 'getPriceConfig',
      data: { dept_id }
    }),
}

// ═══════════════════════════════════════════════════════════
// 菜单云函数模块
// ═══════════════════════════════════════════════════════════
const MenuAPI = {
  /**
   * 获取当前轮换菜单（自动根据时间范围轮换，且仅返回当前用户部门的菜单）
   * @param {number|string} locationId - 当前用户的 location_id（部门/食堂）
   * @returns {Promise<Menu>} - 返回包含meals数组的菜单对象
   */
  getCurrentMenu: (locationId) =>
    wx.cloud.callFunction({ name: 'getMenuList', data: { location_id: locationId } }),
}

// ═══════════════════════════════════════════════════════════
// 用户资料模块（云函数）
// ═══════════════════════════════════════════════════════════
const UserAPI = {
  /**
   * 获取部门名称（兜底：老版本缓存缺 dept_name 时调用）
   * @param {number|string} dept_id
   * @returns {Promise<{result: {code: number, message?: string, data?: {dept_name: string}}}>}
   */
  getDeptName: (dept_id) =>
    wx.cloud.callFunction({ name: 'getDeptName', data: { dept_id } }),
  /**
   * 修改密码（empId 可选，云函数按 openid 反查身份，防越权）
   * @param {{ empId?: number|string, oldPassword: string, newPassword: string }} params
   * @returns {Promise<{result: {code: number, message?: string}}>}
   */
  changePassword: ({ empId, oldPassword, newPassword }) =>
    wx.cloud.callFunction({
      name: 'changePassword',
      data: { empId, oldPassword, newPassword }
    }),
}

// ═══════════════════════════════════════════════════════════
// 食堂工作台模块
// ═══════════════════════════════════════════════════════════
const KitchenAPI = {
  /**
   * 食堂工作台：按日期汇总报餐数据（云函数，按部门维度）
   * @param {string} date - 日期 YYYY-MM-DD
   * @returns {Promise<{meals, depts}>}
   */
  getTodaySummary: (date) =>
    wx.cloud.callFunction({
      name: 'mealOrder',
      data: { action: 'getKitchenSummary', date }
    }).then(res => {
      const result = res.result || {}
      if (result.code === 0) return result.data
      throw new Error(result.message || '查询失败')
    }),
  /** 获取报餐明细列表（员工维度，分页） */
  getTodayDetail: (params = {}) =>
    wx.cloud.callFunction({
      name: 'mealOrder',
      data: { action: 'getKitchenDetail', ...params }
    }).then(res => {
      const result = res.result || {}
      if (result.code === 0) return result.data
      throw new Error(result.message || '查询明细失败')
    }),
  /**
   * 按姓名从云数据库查询报餐记录
   * @param {string} keyword - 姓名关键词
   * @param {string} date - 日期 YYYY-MM-DD
   * @param {string} [meal] - 餐别筛选 'breakfast'|'lunch'|'dinner'
   */
  searchByName: (keyword, date, meal) =>
    wx.cloud.callFunction({
      name: 'mealOrder',
      data: { action: 'searchByName', keyword, date, meal }
    }),
  /**
   * 按手机号从云数据库查询报餐记录
   * @param {string} keyword - 手机号关键词
   * @param {string} date - 日期 YYYY-MM-DD
   * @param {string} [meal] - 餐别筛选 'breakfast'|'lunch'|'dinner'
   */
  searchByPhone: (keyword, date, meal) =>
    wx.cloud.callFunction({
      name: 'mealOrder',
      data: { action: 'searchByPhone', keyword, date, meal }
    }),
}

// ═══════════════════════════════════════════════════════════
// 公告模块
// ═══════════════════════════════════════════════════════════
const NoticeAPI = {
  /** 获取最新公告（云函数，按 location/dept 换算归属） */
  getLatest: (params = {}) =>
    wx.cloud.callFunction({
      name: 'getLatestNotice',
      data: params
    }),
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
