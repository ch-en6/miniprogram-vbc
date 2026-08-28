// subpackages/dept/pages/workspace/index.js — 部门管理员工作台
// 严格对齐原型：4 Tab（员工/统计/收费/我的），van-tabbar 切换

const M = require('../../../../utils/mock')
const { ROLE } = require('../../../../utils/const')

const ROLE_NAME_MAP = {
  employee: '普通员工',
  kitchen: '食堂员工',
  dept_admin: '部门管理员',
  sys_admin: '系统管理员',
}

Page({
  data: {
    activeTab: 'm-stats',  // 默认统计 Tab（与原型一致）

    // 个人信息
    userInfo: {},
    phoneMasked: '',
    roleName: '部门管理员',

    // 换绑
    showRebind: false,
    newPhone: '',
    smsCode: '',
    smsCooldown: 0,

    // 员工 Tab
    searchKey: '',
    staffList: [],

    // 统计 Tab
    departmentNames: ['研发部', '行政部', '运营部'],
    currentDeptIndex: 0,
    tomorrowStat: { breakfast: 49, lunch: 86, dinner: 58 },
    startDate: '',
    endDate: '',
    statList: [],

    // 收费 Tab
    selectedMonth: '',
    hasQueried: false,
    isSnapshot: false,
    snapshotMonth: '',
    snapshotTime: '',
    snapshotBy: '',
    billingList: [],
    totalAmount: 0,
  },

  onLoad() {
    const app = getApp()
    if (app.globalData.devMock && !app.globalData.userInfo) {
      const MU = require('../../../../utils/mock-user')
      app.globalData.userInfo = { ...MU }
      app.globalData.roles = [...MU.roles]
      app.globalData.authReady = true
    }
    this._initDefaults()
    this._initUserInfo()
    this._loadMockData()
  },

  onShow() {
    this._initUserInfo()
  },

  // 初始化默认日期 / 月份
  _initDefaults() {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const lastDay = new Date(year, month, 0).getDate()
    this.setData({
      startDate: `${year}-${String(month).padStart(2, '0')}-01`,
      endDate: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      selectedMonth: `${year}-${String(month).padStart(2, '0')}`,
    })
  },

  _initUserInfo() {
    const app = getApp()
    const userInfo = app.globalData.userInfo || {}
    const roles = userInfo.roles || ['dept_admin']
    const primaryRole = roles.find(r => r !== 'employee') || 'dept_admin'
    const phone = userInfo.phone || ''
    const phoneMasked = phone.length >= 11
      ? phone.slice(0, 3) + '****' + phone.slice(-4)
      : phone

    this.setData({
      userInfo,
      phoneMasked,
      roleName: ROLE_NAME_MAP[primaryRole] || '部门管理员',
    })
  },

  _loadMockData() {
    // ── 员工列表 ──
    const staffList = [
      { id: 1, name: '张三', phone: '138****0001', department: '研发部', status: 'active', wechatBound: true },
      { id: 2, name: '李四', phone: '139****2234', department: '研发部', status: 'active', wechatBound: true },
      { id: 3, name: '王五', phone: '137****8822', department: '研发部', status: 'disabled', wechatBound: false },
    ]

    // ── 统计列表 ──
    const statList = [
      { date: '2026-07-01', breakfast: 38, breakfastFamily: 11, lunch: 66, lunchFamily: 13, dinner: 42, dinnerFamily: 5 },
      { date: '2026-07-02', breakfast: 41, breakfastFamily: 8, lunch: 70, lunchFamily: 9, dinner: 45, dinnerFamily: 3 },
    ]

    this.setData({ staffList, statList })
  },

  // ─── Tab 切换 ────────────────────────────────────────────

  onTabbarChange(e) {
    this.setData({ activeTab: e.detail })
  },

  // ─── 员工 Tab ────────────────────────────────────────────

  onStaffSearch(e) {
    this._filterStaffList(e.detail || '')
  },

  onStaffClear() {
    this.setData({ searchKey: '' })
    this._filterStaffList('')
  },

  _filterStaffList(keyword) {
    const all = [
      { id: 1, name: '张三', phone: '138****0001', department: '研发部', status: 'active', wechatBound: true },
      { id: 2, name: '李四', phone: '139****2234', department: '研发部', status: 'active', wechatBound: true },
      { id: 3, name: '王五', phone: '137****8822', department: '研发部', status: 'disabled', wechatBound: false },
    ]
    if (!keyword) {
      this.setData({ staffList: all })
      return
    }
    this.setData({
      staffList: all.filter(s => s.name.includes(keyword) || s.phone.includes(keyword)),
    })
  },

  onAddStaff() {
    const Toast = require('@vant/weapp/toast/toast').default
    Toast('新增员工')
  },

  onBatchImport() {
    const Toast = require('@vant/weapp/toast/toast').default
    Toast('批量导入')
  },

  onEditStaff(e) {
    const Toast = require('@vant/weapp/toast/toast').default
    const item = this.data.staffList.find(s => s.id === e.currentTarget.dataset.id)
    Toast('编辑 ' + (item ? item.name : ''))
  },

  onToggleStatus(e) {
    const Toast = require('@vant/weapp/toast/toast').default
    const status = e.currentTarget.dataset.status
    Toast(status === 'active' ? '禁用' : '启用')
  },

  onChangePhone(e) {
    const Toast = require('@vant/weapp/toast/toast').default
    const item = this.data.staffList.find(s => s.id === e.currentTarget.dataset.id)
    Toast('改手机号 ' + (item ? item.name : ''))
  },

  onUnbindWechat(e) {
    const Toast = require('@vant/weapp/toast/toast').default
    const item = this.data.staffList.find(s => s.id === e.currentTarget.dataset.id)
    Toast('解绑 ' + (item ? item.name : ''))
  },

  // ─── 统计 Tab ────────────────────────────────────────────

  onDeptChange(e) {
    this.setData({ currentDeptIndex: e.detail.value })
  },

  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value })
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value })
  },

  onSearch() {
    const Toast = require('@vant/weapp/toast/toast').default
    Toast('查询中…')
  },

  onExport() {
    const Toast = require('@vant/weapp/toast/toast').default
    Toast('正在导出…')
  },

  // ─── 收费 Tab ────────────────────────────────────────────

  onMonthChange(e) {
    this.setData({ selectedMonth: e.detail.value })
  },

  onQuery() {
    const Toast = require('@vant/weapp/toast/toast').default
    const { selectedMonth } = this.data
    if (!selectedMonth) {
      Toast('请选择月份')
      return
    }
    const billingList = [
      { id: 1, name: '张三', mealLabel: '午餐', qty: 18, empPrice: 2, family: 22, empAmount: 36, famAmount: 242, amount: 278 },
      { id: 2, name: '李四', mealLabel: '早餐', qty: 20, empPrice: 1, family: 8, empAmount: 20, famAmount: 32, amount: 52 },
      { id: 3, name: '王五', mealLabel: '午餐', qty: 15, empPrice: 2, family: 10, empAmount: 30, famAmount: 110, amount: 140 },
    ]
    this.setData({
      billingList,
      totalAmount: 2368,
      hasQueried: true,
      isSnapshot: true,
      snapshotMonth: selectedMonth,
      snapshotTime: '2026-06-30 23:59',
      snapshotBy: '张三',
    })
    Toast('查询完成')
  },

  onExportBilling() {
    const Toast = require('@vant/weapp/toast/toast').default
    Toast('正在导出…')
  },

  // ─── 我的 Tab ────────────────────────────────────────────

  toggleRebind() {
    this.setData({ showRebind: !this.data.showRebind })
  },

  onNewPhoneInput(e) {
    this.setData({ newPhone: e.detail })
  },

  onSmsInput(e) {
    this.setData({ smsCode: e.detail })
  },

  sendSmsCode() {
    const { newPhone } = this.data
    if (!/^1[3-9]\d{9}$/.test(newPhone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    wx.showToast({ title: '验证码已发送', icon: 'success' })
    let count = 60
    this.setData({ smsCooldown: count })
    this._timer = setInterval(() => {
      count -= 1
      this.setData({ smsCooldown: count })
      if (count <= 0) clearInterval(this._timer)
    }, 1000)
  },

  confirmRebind() {
    wx.showToast({ title: '换绑成功', icon: 'success' })
    this.setData({ showRebind: false, newPhone: '', smsCode: '' })
  },

  // ─── 导航 ────────────────────────────────────────────────

  goEmployee() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
  },
})

  }
})