// pages/index/index.js — 员工首页
const { formatDate, getBookDeadlineInfo } = require('../../utils/time')
const { ROLE } = require('../../utils/const')
const M = require('../../utils/mock')

Page({
  data: {
    heroSub: '',
    announcement: '',
    announcements: [],    // 动态公告列表（Phase 4.3）
    mealRows: [],
    monthStat: { breakfast: 0, lunch: 0, dinner: 0 },
    hasWorkbench: false,
    isDeptAdmin: false,
    isSysAdmin: false,
    isKitchen: false,
  },

  onLoad() {
    const app = getApp()
    // DEV MOCK 兜底：直接打开页面时若 app._initAuth 尚未完成，手动注入 mock 用户
    if (app.globalData.devMock && !app.globalData.userInfo) {
      const MU = require('../../utils/mock-user')
      app.globalData.userInfo = { ...MU }
      app.globalData.roles = [...MU.roles]
      app.globalData.authReady = true
    }
    this._initDisplay()
  },

  onShow() {
    this._initDisplay()
  },

  _initDisplay() {
    const app = getApp()
    const userInfo = app.globalData.userInfo || {}

    // Hero 副标题
    const now = new Date()
    const dateStr = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`
    const deadlineInfo = getBookDeadlineInfo()
    const heroSub = `今天是 ${dateStr}，次日报餐截止：${deadlineInfo.isPast ? '已截止' : '今天 ' + deadlineInfo.deadlineTime}`

    // 角色判断
    const roles = userInfo.roles || ['employee']
    const isDeptAdmin = roles.includes(ROLE.DEPT_ADMIN)
    const isSysAdmin = roles.includes(ROLE.SYS_ADMIN)
    const isKitchen = roles.includes(ROLE.KITCHEN)
    const hasWorkbench = isDeptAdmin || isSysAdmin || isKitchen

    // DEV_MOCK 模式使用 mock 数据
    if (app.globalData.devMock) {
      const today = M.mockTodayStatus
      const mealRows = [
        { key: 'breakfast', name: '早餐', desc: today.breakfast.qty > 0 ? `已报 ${today.breakfast.qty} 份` : '暂未报餐', tagType: today.breakfast.status === 'booked' ? 'success' : 'warning', tagText: today.breakfast.status === 'booked' ? '已报' : '未报' },
        { key: 'lunch', name: '午餐', desc: today.lunch.qty > 0 ? `已报 ${today.lunch.qty} 份${today.lunch.family ? '，含家属餐 ' + today.lunch.family + ' 份' : ''}` : '暂未报餐', tagType: today.lunch.status === 'booked' ? 'success' : 'warning', tagText: today.lunch.status === 'booked' ? '已报' : '未报' },
        { key: 'dinner', name: '晚餐', desc: today.dinner.qty > 0 ? `已报 ${today.dinner.qty} 份` : '暂未报餐', tagType: today.dinner.status === 'booked' ? 'success' : 'warning', tagText: today.dinner.status === 'booked' ? '已报' : '未报' },
      ]

      // Phase 4.3: 动态公告（取第一条已发布公告）
      const publishedAnnouncements = (M.mockAnnouncements || []).filter(a => a.status === 'published')
      const announcement = publishedAnnouncements.length > 0 ? publishedAnnouncements[0].content : M.mockAnnouncement

      this.setData({
        heroSub,
        announcement,
        announcements: publishedAnnouncements,
        mealRows,
        monthStat: M.mockMonthStat,
        hasWorkbench,
        isDeptAdmin,
        isSysAdmin,
        isKitchen,
      })
      return
    }

    // 生产模式：调接口
    // TODO: 接入真实 API — GET /announcements?status=published
  },

  goBook() {
    wx.switchTab({ url: '/pages/book/index' })
  },

  goWorkbench() {
    const app = getApp()
    const roles = (app.globalData.userInfo && app.globalData.userInfo.roles) || ['employee']
    let url
    if (roles.includes(ROLE.SYS_ADMIN)) {
      url = '/subpackages/admin/pages/dept-manage/index'
    } else if (roles.includes(ROLE.DEPT_ADMIN)) {
      url = '/subpackages/dept/pages/workspace/index'
    } else if (roles.includes(ROLE.KITCHEN)) {
      url = '/subpackages/kitchen/pages/today/index'
    }
    if (url) wx.navigateTo({ url })
  },
})
