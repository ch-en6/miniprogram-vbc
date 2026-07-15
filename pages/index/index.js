// pages/index/index.js — 员工首页
const { formatDate, formatMonth, getBookDeadlineInfo } = require('../../utils/time')
const { ROLE } = require('../../utils/const')
const M = require('../../utils/mock')

Page({
  data: {
    heroSub: '',
    announcement: '',
    announcements: [],    // 动态公告列表（Phase 4.3）
    todayMeals: [
      { key: 'breakfast', name: '早餐', qty: 0, tagType: 'warning', tagText: '未报' },
      { key: 'lunch', name: '午餐', qty: 0, tagType: 'warning', tagText: '未报' },
      { key: 'dinner', name: '晚餐', qty: 0, tagType: 'warning', tagText: '未报' },
    ],
    tomorrowMeals: [
      { key: 'breakfast', name: '早餐', qty: 0, tagType: 'warning', tagText: '未报' },
      { key: 'lunch', name: '午餐', qty: 0, tagType: 'warning', tagText: '未报' },
      { key: 'dinner', name: '晚餐', qty: 0, tagType: 'warning', tagText: '未报' },
    ],
    todayDateStr: '',
    tomorrowDateStr: '',
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
      const todayMeals = this._buildMealRows({
        breakfast: today.breakfast.qty,
        lunch: today.lunch.qty,
        dinner: today.dinner.qty,
      })
      // mock 明日数据：午餐已报 1 份，其余未报
      const tomorrowMeals = this._buildMealRows({ breakfast: 0, lunch: 1, dinner: 0 })

      const dNow = new Date()
      const dTomorrow = new Date(dNow)
      dTomorrow.setDate(dTomorrow.getDate() + 1)

      // Phase 4.3: 动态公告（取第一条已发布公告）
      const publishedAnnouncements = (M.mockAnnouncements || []).filter(a => a.status === 'published')
      const announcement = publishedAnnouncements.length > 0 ? publishedAnnouncements[0].content : M.mockAnnouncement

      this.setData({
        heroSub,
        announcement,
        announcements: publishedAnnouncements,
        todayMeals,
        tomorrowMeals,
        todayDateStr: formatDate(dNow),
        tomorrowDateStr: formatDate(dTomorrow),
        monthStat: M.mockMonthStat,
        hasWorkbench,
        isDeptAdmin,
        isSysAdmin,
        isKitchen,
      })
      return
    }

    // 生产模式：从云数据库读取
    const dNow = new Date()
    const dTomorrow = new Date(dNow)
    dTomorrow.setDate(dTomorrow.getDate() + 1)
    this.setData({
      heroSub, hasWorkbench, isDeptAdmin, isSysAdmin, isKitchen,
      todayDateStr: formatDate(dNow),
      tomorrowDateStr: formatDate(dTomorrow),
    })
    this._fetchLatestNotice()
    this._fetchTodayAndMonthStat()
  },

  /**
   * 根据报餐记录生成三餐数据
   * @param {object|null} record - 含 breakfast/lunch/dinner 字段的记录
   */
  _buildMealRows(record) {
    const buildRow = (key, name, qty) => ({
      key, name, qty,
      tagType: qty > 0 ? 'success' : 'warning',
      tagText: qty > 0 ? `${qty}份` : '未报',
    })
    return [
      buildRow('breakfast', '早餐', record ? record.breakfast || 0 : 0),
      buildRow('lunch', '午餐', record ? record.lunch || 0 : 0),
      buildRow('dinner', '晚餐', record ? record.dinner || 0 : 0),
    ]
  },

  /**
   * 从云数据库获取今日/明日报餐状态 + 本月统计
   */
  async _fetchTodayAndMonthStat() {
    try {
      const now = new Date()
      const today = formatDate(now)
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = formatDate(tomorrow)
      const month = formatMonth(now)

      const app = getApp()
      const userInfo = app.globalData.userInfo || {}

      // 获取当月记录
      const res = await wx.cloud.callFunction({
        name: 'mealOrder',
        data: { action: 'getMonth', month, emp_id: userInfo._id }
      })

      if (res.result && res.result.code === 0 && res.result.data) {
        const records = res.result.data
        const todayRecord = records.find(r => r.date === today) || null

        // 明日可能在当月或下月
        let tomorrowRecord = records.find(r => r.date === tomorrowStr) || null
        if (!tomorrowRecord) {
          const tomorrowMonth = formatMonth(tomorrow)
          if (tomorrowMonth !== month) {
            const res2 = await wx.cloud.callFunction({
              name: 'mealOrder',
              data: { action: 'getMonth', month: tomorrowMonth, emp_id: userInfo._id }
            })
            if (res2.result && res2.result.code === 0 && res2.result.data) {
              tomorrowRecord = res2.result.data.find(r => r.date === tomorrowStr) || null
            }
          }
        }

        // 本月统计
        const monthStat = { breakfast: 0, lunch: 0, dinner: 0 }
        records.forEach(r => {
          monthStat.breakfast += r.breakfast || 0
          monthStat.lunch += r.lunch || 0
          monthStat.dinner += r.dinner || 0
        })

        this.setData({
          todayMeals: this._buildMealRows(todayRecord),
          tomorrowMeals: this._buildMealRows(tomorrowRecord),
          monthStat,
        })
      }
    } catch (err) {
      console.error('[首页] 获取报餐数据失败:', err)
    }
  },

  /**
   * 从云数据库获取最新一条已发布的公告（通过云函数）
   */
  async _fetchLatestNotice() {
    try {
      // 调用云函数获取最新公告
      const res = await wx.cloud.callFunction({
        name: 'getLatestNotice',
        data: {}
      })
      
      if (res.result && res.result.code === 0 && res.result.data) {
        const notice = res.result.data
        this.setData({
          announcement: notice.content || '',
          announcements: [notice]
        })
      } else {
        // 没有公告或出错
        this.setData({
          announcement: '',
          announcements: []
        })
      }
    } catch (err) {
      console.error('获取公告失败:', err)
      // 出错时保持空值
      this.setData({
        announcement: '',
        announcements: []
      })
    }
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
