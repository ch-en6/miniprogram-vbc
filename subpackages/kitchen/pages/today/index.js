// subpackages/kitchen/pages/today/index.js — 食堂今日页面（自定义导航栏 + 报餐查询）
const { KitchenAPI } = require('../../../../services/api')
const { formatDate, formatDateCN } = require('../../../../utils/time')
const { MEAL_TYPE_ORDER, MEAL_TYPE_LABEL, ROLE } = require('../../../../utils/const')
const M = require('../../../../utils/mock')

Page({
  data: {
    // 自定义导航栏
    statusBarHeight: 20,
    navBarHeight: 64,
    safeBottom: 0, // iPhone 底部安全区
    pageTitle: '报餐查询', // 顶部 navbar 标题，随 tab 变化

    activeTab: 'search',     // 'search' | 'today' | 'tomorrow' | 'profile'
    searchKeyword: '',
    searchFocus: false,
    loading: true,
    personSearchResult: null,
    searchMealFilter: '',     // '' = 全天, 'breakfast', 'lunch', 'dinner'

    // 今日数据
    todayDate: '',
    todayLabel: '',
    todayDateFull: '',
    todayDay: '',
    todayWeek: '',
    todayData: {
      mealSummary: [],
      deptCards: [],
    },

    // 明日数据
    tomorrowDate: '',
    tomorrowLabel: '',
    tomorrowDeadline: '',  // '可报餐' | '已截止'
    tomorrowDateFull: '',
    tomorrowDay: '',
    tomorrowWeek: '',
    tomorrowData: {
      mealSummary: [],
      deptCards: [],
    },

    // 个人中心
    userInfo: {},
    phoneMasked: '',
    roleName: '普通员工',
    isKitchen: false,
    isDeptAdmin: false,
    isSysAdmin: false,
    // 换绑
    showRebind: false,
    newPhone: '',
    smsCode: '',
    smsCooldown: 0,
  },

  onLoad() {
    const app = getApp()
    // DEV MOCK 兜底：直接打开页面时若 app._initAuth 尚未完成，手动注入 mock 用户
    if (app.globalData.devMock && !app.globalData.userInfo) {
      const MU = require('../../../../utils/mock-user')
      app.globalData.userInfo = { ...MU }
      app.globalData.roles = [...MU.roles]
      app.globalData.authReady = true
    }

    const sysInfo = wx.getSystemInfoSync()
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const todayFull = this._formatFullDate(today)
    const tomorrowFull = this._formatFullDate(tomorrow)

    // 顶部 navbar 标题 = 当前 tab 名称
    const pageTitle = this._getPageTitle(this.data.activeTab)

    this.setData({
      statusBarHeight: sysInfo.statusBarHeight,
      navBarHeight: sysInfo.statusBarHeight + 44,
      safeBottom: sysInfo.safeArea ? Math.max(0, sysInfo.screenHeight - sysInfo.safeArea.bottom) : 0,
      todayDate: formatDate(today),
      todayLabel: formatDateCN(formatDate(today)),
      todayDateFull: todayFull,
      todayDay: todayFull.split(' ')[0],
      todayWeek: todayFull.split(' ')[1],
      tomorrowDate: formatDate(tomorrow),
      tomorrowLabel: formatDateCN(formatDate(tomorrow)),
      tomorrowDateFull: tomorrowFull,
      tomorrowDay: tomorrowFull.split(' ')[0],
      tomorrowWeek: tomorrowFull.split(' ')[1],
      tomorrowDeadline: this._checkDeadline(tomorrow),
      pageTitle,
    })

    this._initUserInfo()
    this._loadAllData()
  },

  onShow() {
    if (this.data.activeTab !== 'search') {
      this._loadAllData()
    }
    this._initUserInfo()
  },

  // ─── 自定义导航栏刷新 ──────────────────────────────────────

  onRefreshTap() {
    wx.showToast({ title: '刷新中', icon: 'loading', duration: 500 })
    if (this.data.activeTab !== 'search') {
      this._loadAllData()
    }
  },

  // ─── 数据加载 ───────────────────────────────────────────────

  _loadAllData() {
    const app = getApp()
    if (app.globalData.devMock) {
      this._loadMockData()
      return
    }

    this.setData({ loading: true })
    try {
      Promise.all([
        KitchenAPI.getTodaySummary(this.data.todayDate),
        KitchenAPI.getTodaySummary(this.data.tomorrowDate),
      ])
        .then(([todayRes, tomorrowRes]) => {
          this.setData({
            todayData: this._parseData(todayRes),
            tomorrowData: this._parseData(tomorrowRes),
            loading: false,
          })
        })
        .catch((e) => {
          console.error('[Kitchen Today]', e)
          this._loadMockData()
        })
    } catch (e) {
      console.error('[Kitchen Today]', e)
      this._loadMockData()
    }
  },

  _parseData(res) {
    const mealSummary = MEAL_TYPE_ORDER.map((type) => {
      const data = res?.meals?.[type] || {}
      return {
        type,
        label: MEAL_TYPE_LABEL[type],
        headCount: data.head_count || 0,
        totalQty: data.total_qty || 0,
        familyQty: data.family_qty || 0,
      }
    })

    const deptCards = (res?.depts || []).map((d) => ({
      deptId: d.dept_id,
      deptName: d.dept_name,
      breakfast: d.breakfast || 0,
      lunch: d.lunch || 0,
      dinner: d.dinner || 0,
      total: (d.breakfast || 0) + (d.lunch || 0) + (d.dinner || 0),
    }))

    return { mealSummary, deptCards }
  },

  _loadMockData() {
    const mock = M.mockKitchenToday || {}
    const summary = mock.summary || {}

    const mealSummary = [
      { type: 'breakfast', label: '早餐', headCount: summary.breakfast?.persons || 0, totalQty: summary.breakfast?.portions || 0, familyQty: summary.breakfast?.family || 0 },
      { type: 'lunch', label: '午餐', headCount: summary.lunch?.persons || 0, totalQty: summary.lunch?.portions || 0, familyQty: summary.lunch?.family || 0 },
      { type: 'dinner', label: '晚餐', headCount: summary.dinner?.persons || 0, totalQty: summary.dinner?.portions || 0, familyQty: summary.dinner?.family || 0 },
    ]

    const deptCards = (mock.departments || []).map(d => ({
      deptName: d.name,
      breakfast: d.breakfast || 0,
      lunch: d.lunch || 0,
      dinner: d.dinner || 0,
      total: (d.breakfast || 0) + (d.lunch || 0) + (d.dinner || 0),
    }))

    this.setData({
      'todayData.mealSummary': mealSummary,
      'todayData.deptCards': deptCards,
      'tomorrowData.mealSummary': mealSummary,
      'tomorrowData.deptCards': deptCards,
      loading: false,
    })
  },

  // ─── Tab 切换 ──────────────────────────────────────────────

  /**
   * 顶部 navbar 标题随底部 tab 变化
   * 4 tab: search / today / tomorrow / profile
   */
  _getPageTitle(tab) {
    const map = {
      search: '报餐查询',
      today: '今日报餐',
      tomorrow: '明日报餐',
      profile: '个人中心',
    }
    return map[tab] || '食堂工作台'
  },

  _initUserInfo() {
    const app = getApp()
    const userInfo = app.globalData.userInfo || {}
    const roles = userInfo.roles || ['employee']
    const primaryRole = roles.find(r => r !== 'employee') || 'employee'

    const phone = userInfo.phone || ''
    const phoneMasked = phone.length >= 11
      ? phone.slice(0, 3) + '****' + phone.slice(-4)
      : phone

    const ROLE_NAME_MAP = {
      employee: '普通员工',
      kitchen: '食堂员工',
      dept_admin: '部门管理员',
      sys_admin: '系统管理员',
    }

    this.setData({
      userInfo,
      phoneMasked,
      roleName: ROLE_NAME_MAP[primaryRole] || '普通员工',
      isKitchen: roles.includes(ROLE.KITCHEN),
      isDeptAdmin: roles.includes(ROLE.DEPT_ADMIN),
      isSysAdmin: roles.includes(ROLE.SYS_ADMIN),
    })
  },

  // 格式化完整日期（YYYY年MM月DD日 星期X）
  _formatFullDate(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const weekDays = ['日', '一', '二', '三', '四', '五', '六']
    const week = weekDays[date.getDay()]
    return `${year}年${month}月${day}日 星期${week}`
  },

  // 判断明日是否已过 17:00 截止时间
  _checkDeadline(tomorrowDate) {
    const now = new Date()
    const deadline = new Date(tomorrowDate)
    deadline.setDate(deadline.getDate() - 1) // 截止时间是前一天
    deadline.setHours(17, 0, 0, 0)
    return now > deadline ? '已截止' : '可报餐'
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({
      activeTab: tab,
      pageTitle: this._getPageTitle(tab),
    })
    if (tab === 'today' || tab === 'tomorrow') {
      this._loadAllData()
    }
  },

  // ─── 人员查询（只查今日） ───────────────────────────────────

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value })
  },

  onClearSearch() {
    this.setData({
      searchKeyword: '',
      personSearchResult: null,
      searchFocus: true,
    })
  },

  onSelectMeal(e) {
    const meal = e.currentTarget.dataset.meal
    this.setData({ searchMealFilter: meal })
    // 已有查询结果时，切换餐别立即重新查询
    if (this.data.personSearchResult !== null && this.data.searchKeyword) {
      this._doPersonSearch(this.data.searchKeyword)
    }
  },

  onSearchTap() {
    const keyword = (this.data.searchKeyword || '').trim()
    if (!keyword) {
      this.setData({ personSearchResult: null })
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    this._doPersonSearch(keyword)
  },

  _doPersonSearch(keyword) {
    const app = getApp()
    const mealFilter = this.data.searchMealFilter

    if (app.globalData.devMock) {
      this._mockPersonSearch(keyword)
      return
    }

    // 只查询今日的报餐情况
    KitchenAPI.searchPerson({
      keyword,
      date: this.data.todayDate,
      meal: mealFilter,
    })
      .then((res) => {
        this.setData({
          personSearchResult: {
            found: res?.found || false,
            name: keyword,
            deptName: res?.dept_name || res?.deptName || '',
            breakfast: res?.breakfast || false,
            lunch: res?.lunch || false,
            dinner: res?.dinner || false,
          },
        })
      })
      .catch(() => {
        this._mockPersonSearch(keyword)
      })
  },

  _mockPersonSearch(keyword) {
    const mealFilter = this.data.searchMealFilter

    // 从 mockKitchenDetail 中查找该姓名今日的报餐记录
    const mockList = M.mockKitchenDetail || []
    const personRecords = mockList.filter(r => r.name === keyword)

    if (personRecords.length > 0) {
      // 找到该人员，返回真实报餐情况
      const deptName = personRecords[0].dept_name || ''
      const result = {
        found: true,
        name: keyword,
        deptName,
        breakfast: personRecords.some(r => r.meal_type === 'breakfast'),
        lunch: personRecords.some(r => r.meal_type === 'lunch'),
        dinner: personRecords.some(r => r.meal_type === 'dinner'),
      }
      this.setData({ personSearchResult: result })
      return
    }

    // 未找到该姓名，70% 概率返回「未报餐」，30% 概率返回随机报餐
    // 使用姓名哈希确保同一姓名每次结果一致
    const hash = keyword.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
    const seededRandom = (hash % 100) / 100

    if (seededRandom < 0.7) {
      // 未报餐
      this.setData({
        personSearchResult: {
          found: false,
          name: keyword,
          deptName: '',
          breakfast: false,
          lunch: false,
          dinner: false,
        },
      })
    } else {
      // 随机报餐（但结果固定）
      const result = {
        found: true,
        name: keyword,
        deptName: '未知部门',
        breakfast: (hash + 1) % 3 === 0,
        lunch: (hash + 2) % 3 !== 0,
        dinner: (hash + 3) % 2 === 0,
      }
      this.setData({ personSearchResult: result })
    }
  },

  // ─── 个人中心（换绑手机号） ─────────────────────────────────

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
    const app = getApp()
    if (app.globalData.devMock) {
      wx.showToast({ title: '验证码已发送（DEV）', icon: 'success' })
      this._startCooldown()
      return
    }
    // TODO: 接入真实 API
  },

  _startCooldown() {
    let count = 60
    this.setData({ smsCooldown: count })
    this._timer = setInterval(() => {
      count -= 1
      this.setData({ smsCooldown: count })
      if (count <= 0) clearInterval(this._timer)
    }, 1000)
  },

  confirmRebind() {
    const app = getApp()
    if (app.globalData.devMock) {
      wx.showToast({ title: '换绑成功（DEV）', icon: 'success' })
      this.setData({ showRebind: false })
      return
    }
    // TODO: 接入真实 API
  },

  // ─── 页面跳转 ────────────────────────────────────────────────

  goEmployee() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  goWorkbench() {
    const { isSysAdmin, isDeptAdmin, isKitchen } = this.data
    let url
    if (isSysAdmin) {
      url = '/subpackages/admin/pages/dept-manage/index'
    } else if (isDeptAdmin) {
      url = '/subpackages/dept/pages/workspace/index'
    } else if (isKitchen) {
      url = '/subpackages/kitchen/pages/today/index'
    }
    if (url) wx.navigateTo({ url })
  },

  // ─── 退出登录 ────────────────────────────────────────────────

  logout() {
    const Dialog = require('@vant/weapp/dialog/dialog').default
    Dialog.confirm({
      title: '退出登录',
      message: '确定要退出登录吗？',
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      confirmButtonColor: '#ee0a24',
    }).then(() => {
      const app = getApp()
      app.logout()
    }).catch(() => {
      // 用户取消，不做操作
    })
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
  },

  // ─── 跳转明细页 ────────────────────────────────────────────

  goDetail(e) {
    const date = e.currentTarget.dataset.date || this.data.todayDate
    wx.navigateTo({
      url: `/subpackages/kitchen/pages/detail/index?date=${date}`,
    })
  },
})
