// pages/index/index.js — 员工首页
const { formatDate, formatMonth, getBookDeadlineInfo } = require('../../utils/time')
const { ROLE } = require('../../utils/const')

Page({
  data: {
    heroSub: '',
    announcement: '',
    announcementObj: {},  // 最新公告完整对象（弹层展示用）
    noticeVisible: false, // 公告详情弹层是否显示
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
    isDeptAdmin: false,
    isSysAdmin: false,
    isKitchen: false,
  },

  onLoad() {
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
    const roleCode = app.globalData.roleCode || 'employee'
    const isDeptAdmin = roleCode === ROLE.DEPT_ADMIN
    const isSysAdmin = roleCode === ROLE.SYS_ADMIN
    const isKitchen = roleCode === ROLE.KITCHEN

    const dNow = new Date()
    const dTomorrow = new Date(dNow)
    dTomorrow.setDate(dTomorrow.getDate() + 1)
    this.setData({
      heroSub, isDeptAdmin, isSysAdmin, isKitchen,
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
        data: { action: 'getMonth', month, emp_id: userInfo.id }
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
              data: { action: 'getMonth', month: tomorrowMonth, emp_id: userInfo.id }
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
      const app = getApp()
      const userInfo = app.globalData.userInfo || {}

      // 调用云函数获取最新公告，优先传 location_id，无则传 dept_id 由云函数换算
      const res = await wx.cloud.callFunction({
        name: 'getLatestNotice',
        data: {
          location_id: userInfo.location_id || null,
          dept_id: userInfo.dept_id || null
        }
      })

      if (res.result && res.result.code === 0 && res.result.data) {
        const notice = res.result.data
        this.setData({
          announcement: notice.content || '',
          announcementObj: notice,
          announcements: [notice]
        })
      } else {
        // 没有公告或出错
        this.setData({
          announcement: '',
          announcementObj: {},
          announcements: []
        })
      }
    } catch (err) {
      console.error('获取公告失败:', err)
      // 出错时保持空值
      this.setData({
        announcement: '',
        announcementObj: {},
        announcements: []
      })
    }
  },

  /** 点击公告条，展开完整公告内容 */
  showNotice() {
    this.setData({ noticeVisible: true })
  },

  /** 关闭公告详情弹层 */
  hideNotice() {
    this.setData({ noticeVisible: false })
  },

  /** 阻止弹层内容区冒泡 */
  noop() {},

  goBook() {
    wx.switchTab({ url: '/pages/book/index' })
  },

  goWorkbench() {
    const app = getApp()
    const roleCode = app.globalData.roleCode || 'employee'
    let url
    if (roleCode === ROLE.SYS_ADMIN) {
      url = '/subpackages/admin/pages/dept-manage/index'
    } else if (roleCode === ROLE.DEPT_ADMIN) {
      url = '/subpackages/dept/pages/workspace/index'
    } else if (roleCode === ROLE.KITCHEN) {
      url = '/subpackages/kitchen/pages/today/index'
    }
    if (url) wx.navigateTo({ url })
  },
})
