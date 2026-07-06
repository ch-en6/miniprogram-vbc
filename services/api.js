// services/api.js — 业务接口封装（集中管理所有接口调用）

const { get, post, put, patch, del, downloadFile, BASE_URL } = require('../utils/request')
const { getAccessToken } = require('../utils/auth')

// ═══════════════════════════════════════════════════════════
// 认证模块
// ═══════════════════════════════════════════════════════════
const AuthAPI = {
  /** 微信登录（仅 code，无手机号） */
  login: (code) => post('/auth/wechat-login', { code }, { skipAuth: true }),
  /**
   * 微信授权手机号一键登录（主流程）
   * @param {string} wxCode - wx.login() 获取的 code
   * @param {string} phoneCode - open-type="getPhoneNumber" 获取的 code
   */
  loginWithPhone: (wxCode, phoneCode) =>
    post('/auth/login-with-phone', { wx_code: wxCode, phone_code: phoneCode }, { skipAuth: true }),
  /**
   * 手机号 + 短信验证码登录（备选）
   */
  loginWithSms: (wxCode, phone, smsCode) =>
    post('/auth/login-with-sms', { wx_code: wxCode, phone, sms_code: smsCode }, { skipAuth: true }),
  /** 发送短信验证码 */
  sendSmsCode: (phone) => post('/auth/sms-code', { phone }, { skipAuth: true }),
  /** 刷新 token */
  refresh: (refreshToken) => post('/auth/refresh', { refresh_token: refreshToken }, { skipAuth: true }),
  /** 获取当前用户信息 */
  getMe: () => get('/auth/me'),
  /** 绑定手机号（使用微信授权 code） */
  bindPhone: (phoneCode) => post('/auth/bind-phone', { phone_code: phoneCode }),
  /** 换绑手机号 */
  rebindPhone: (phoneCode) => post('/auth/rebind-phone', { phone_code: phoneCode }),
  /** 换绑手机号（短信方式） */
  rebindPhoneSms: (phone, smsCode) => post('/auth/rebind-phone-sms', { phone, sms_code: smsCode }),
}

// ═══════════════════════════════════════════════════════════
// 报餐模块
// ═══════════════════════════════════════════════════════════
const BookAPI = {
  /**
   * 获取某月报餐状态（月历用）
   * @param {string} month - "YYYY-MM"
   * @returns {Promise<BookRecord[]>}
   */
  getMonthStatus: (month) => get('/bookings/month', { month }),

  /**
   * 批量报餐（一次提交多天）
   */
  batchBook: (bookings) => post('/bookings/batch', { bookings }),

  /**
   * 提交单日报餐（新增或覆盖）
   * @param {string} date - "YYYY-MM-DD"
   * @param {{ breakfast: number, lunch: number, dinner: number }} meals
   */
  submitDay: (date, meals) => post('/bookings', { date, ...meals }),

  /**
   * 取消单日报餐
   * @param {string} date - "YYYY-MM-DD"
   */
  cancel: (date) => del('/bookings', { date }),

  /**
   * 取消单日某餐次
   * @param {string} date
   * @param {string} mealType - 'breakfast'|'lunch'|'dinner'
   */
  cancelMeal: (date, mealType) => del('/bookings/meal', { date, meal_type: mealType }),

  /**
   * 修改单日报餐
   */
  update: (date, meals) => put('/bookings', { date, ...meals }),

  /**
   * 获取个人历史记录（分页）
   */
  getRecords: (params = {}) => get('/bookings/records', params),

  /**
   * 获取当日报餐汇总（首页状态卡片用）
   */
  getTodayStatus: () => get('/bookings/today'),

  /**
   * 获取本月报餐份数统计（首页小卡片用）
   * @param {string} month - "YYYY-MM"
   */
  getMonthStat: (month) => get('/bookings/month-stat', { month }),
}

// ═══════════════════════════════════════════════════════════
// 菜单模块
// ═══════════════════════════════════════════════════════════
const MenuAPI = {
  /** 获取指定日期菜单 */
  getMenu: (date) => get('/menu', { date }),
  /** 获取本周菜单 */
  getWeekMenu: (weekStart) => get('/menu/week', { week_start: weekStart }),
}

// ═══════════════════════════════════════════════════════════
// 食堂工作台模块
// ═══════════════════════════════════════════════════════════
const KitchenAPI = {
  /** 今日报餐总量汇总（各餐次数量） */
  getTodaySummary: (date) => get('/kitchen/summary', { date }),
  /** 获取今日报餐详情列表（部门维度） */
  getTodayDetail: (params = {}) => get('/kitchen/detail', params),
  /** 按姓名查询今日报餐情况 */
  searchPerson: (params = {}) => get('/kitchen/search', params),
  /** 导出今日报餐 Excel */
  exportTodayExcel: (date) => {
    const token = getAccessToken()
    return downloadFile(
      `${BASE_URL}/kitchen/export?date=${date}&token=${token}`,
      `报餐明细_${date}.xlsx`
    )
  },
}

// ═══════════════════════════════════════════════════════════
// 部门管理员模块
// ═══════════════════════════════════════════════════════════
const DeptAPI = {
  // ─── 员工管理 ───
  /** 获取部门员工列表 */
  getStaffList: (params = {}) => get('/dept/staff', params),
  /** 添加员工 */
  addStaff: (data) => post('/dept/staff', data),
  /** 编辑员工信息 */
  updateStaff: (id, data) => put(`/dept/staff/${id}`, data),
  /** 删除/停用员工 */
  removeStaff: (id) => del(`/dept/staff/${id}`),
  /** 批量导入员工（Excel） */
  importStaff: (filePath) => {
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: `${BASE_URL}/dept/staff/import`,
        filePath,
        name: 'file',
        header: { Authorization: `Bearer ${getAccessToken()}` },
        success: (res) => {
          const data = JSON.parse(res.data)
          if (data.code === 0) resolve(data.data)
          else reject(data)
        },
        fail: reject,
      })
    })
  },

  // ─── 报餐统计 ───
  /** 获取部门本月报餐统计 */
  getMonthStat: (month) => get('/dept/stat/month', { month }),
  /** 获取部门报餐详情（员工维度） */
  getStatDetail: (params) => get('/dept/stat/detail', params),

  // ─── 月度收费 ───
  /** 生成月度收费快照 */
  generateBilling: (month) => post('/dept/billing/generate', { month }),
  /** 获取月度收费列表 */
  getBillingList: (month) => get('/dept/billing', { month }),
  /** 导出收费 Excel */
  exportBilling: (month) => {
    const token = getAccessToken()
    return downloadFile(
      `${BASE_URL}/dept/billing/export?month=${month}&token=${token}`,
      `月度收费_${month}.xlsx`
    )
  },
}

// ═══════════════════════════════════════════════════════════
// 系统管理员模块
// ═══════════════════════════════════════════════════════════
const AdminAPI = {
  // ─── 部门管理 ───
  getDeptList: () => get('/admin/departments'),
  createDept: (data) => post('/admin/departments', data),
  updateDept: (id, data) => put(`/admin/departments/${id}`, data),
  deleteDept: (id) => del(`/admin/departments/${id}`),

  // ─── 权限管理 ───
  getUserList: (params) => get('/admin/users', params),
  assignRole: (userId, roles) => patch(`/admin/users/${userId}/roles`, { roles }),

  // ─── 系统配置 ───
  getSysConfig: () => get('/admin/config'),
  updateSysConfig: (data) => put('/admin/config', data),

  // ─── 操作日志 ───
  getOpLogs: (params) => get('/admin/logs', params),
}

// ═══════════════════════════════════════════════════════════
// 公告模块
// ═══════════════════════════════════════════════════════════
const NoticeAPI = {
  /** 获取最新公告 */
  getLatest: () => get('/notices/latest'),
  /** 获取公告列表 */
  getList: (params) => get('/notices', params),
}

module.exports = {
  AuthAPI,
  BookAPI,
  MenuAPI,
  KitchenAPI,
  DeptAPI,
  AdminAPI,
  NoticeAPI,
}
