// subpackages/kitchen/pages/today/index.js — 食堂今日页面（自定义导航栏 + 报餐查询）
const { KitchenAPI, UserAPI } = require('../../../../services/api')
const { formatDate, formatDateCN } = require('../../../../utils/time')
const { MEAL_TYPE_ORDER, MEAL_TYPE_LABEL, ROLE } = require('../../../../utils/const')

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
    searchMode: 'phone',     // 'phone' | 'name' — 查询方式，默认手机号
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

    // 我的
    userInfo: {},
    phoneMasked: '',
    deptName: '',
    isKitchen: false,
    isDeptAdmin: false,
    isSysAdmin: false,
    // 换绑
    showRebind: false,
    // 修改密码
    showChangePwd: false,
    oldPwd: '',
    newPwd: '',
    confirmPwd: '',
    pwdLoading: false,
    // 是否显示工作台
    showWorkspace: false, 
  },

  onLoad() {
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
    this._loadDeptName()
    this._loadAllData()
  },

  onShow() {
    if (this.data.activeTab !== 'search') {
      this._loadAllData()
    }
    this._initUserInfo()
    this._loadDeptName()
  },

  // ─── 自定义导航栏刷新 ──────────────────────────────────────

  onRefreshTap() {
    wx.showToast({ title: '刷新中', icon: 'loading', duration: 500 })
    if (this.data.activeTab === 'search') {
      // 查询 tab：如果有已查询的结果，重新执行查询；否则加载汇总数据
      if (this.data.personSearchResult !== null && this.data.searchKeyword) {
        this._doPersonSearch(this.data.searchKeyword)
      } else {
        this._loadAllData()
      }
    } else {
      this._loadAllData()
    }
  },

  // ─── 数据加载 ───────────────────────────────────────────────

  _loadAllData() {
    this.setData({ loading: true })

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
        wx.showToast({ title: '加载失败，请下拉刷新', icon: 'none' })
        this.setData({ loading: false })
      })
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
      profile: '我的',
    }
    return map[tab] || '食堂工作台'
  },

  _initUserInfo() {
    const app = getApp()
    const userInfo = app.globalData.userInfo || {}
    const roleCode = app.globalData.roleCode || ''

    // 判断是否显示工作台（只有部门管理员/系统管理员才显示）
    const showWorkspace = [ROLE.DEPT_ADMIN, ROLE.SYS_ADMIN].includes(roleCode)

    const phone = userInfo.phone || ''
    const phoneMasked = phone.length >= 11
      ? phone.slice(0, 3) + '****' + phone.slice(-4)
      : phone

    this.setData({
      userInfo,
      phoneMasked,
      isKitchen: roleCode === ROLE.KITCHEN,
      isDeptAdmin: roleCode === ROLE.DEPT_ADMIN,
      isSysAdmin: roleCode === ROLE.SYS_ADMIN,
      showWorkspace: showWorkspace,
    })
  },

  async _loadDeptName() {
    const app = getApp()
    const userInfo = app.globalData.userInfo || {}
    const dept_id = userInfo.dept_id
    if (!dept_id) return

    // 1. 登录时已随 userInfo 返回部门名，直接使用
    if (userInfo.dept_name) {
      this.setData({ deptName: userInfo.dept_name })
      return
    }

    // 2. 兜底：请求云函数（不写缓存，下次登录会重新带 dept_name）
    try {
      const res = await UserAPI.getDeptName(dept_id)
      const result = res.result
      if (result.code === 0 && result.data) {
        this.setData({ deptName: result.data.dept_name || '—' })
      } else {
        this.setData({ deptName: '—' })
      }
    } catch (err) {
      console.error('[kitchen profile] loadDeptName error:', err)
      this.setData({ deptName: '—' })
    }
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

  onSearchModeChange(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({
      searchMode: mode,
      searchKeyword: '',
      personSearchResult: null,
    })
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
      const tip = this.data.searchMode === 'phone' ? '请输入手机号' : '请输入姓名'
      wx.showToast({ title: tip, icon: 'none' })
      return
    }
    this._doPersonSearch(keyword)
  },

  _doPersonSearch(keyword) {
    const mode = this.data.searchMode
    const mealFilter = this.data.searchMealFilter
    const searchDate = this.data.todayDate
    const dateLabel = this.data.todayLabel

    this.setData({ loading: true })

    const apiCall = mode === 'phone'
      ? KitchenAPI.searchByPhone(keyword, searchDate, mealFilter || undefined)
      : KitchenAPI.searchByName(keyword, searchDate, mealFilter || undefined)

    apiCall.then((res) => {
        const result = res.result || {}
        if (result.code === 0 && result.data) {
          const data = result.data
          // 为每条记录添加手机号脱敏
          const list = (data.list || []).map(item => ({
            ...item,
            phoneMasked: item.phone
              ? item.phone.slice(0, 3) + '****' + item.phone.slice(-4)
              : '',
          }))
          this.setData({
            personSearchResult: {
              found: data.found,
              keyword: data.keyword || keyword,
              date: data.date || searchDate,
              dateLabel,
              total: data.total || 0,
              list,
            },
            loading: false,
          })
        } else {
          this.setData({
            personSearchResult: { found: false, keyword, date: searchDate, dateLabel, total: 0, list: [] },
            loading: false,
          })
        }
      })
      .catch((err) => {
        console.error('[Kitchen Search]', err)
        wx.showToast({ title: '查询失败，请重试', icon: 'none' })
        this.setData({
          personSearchResult: null,
          loading: false,
        })
      })
  },

  // ─── 我的（换绑 + 修改密码） ─────────────────────────────────

  toggleRebind() {
    this.setData({ showRebind: !this.data.showRebind })
  },

  toggleChangePwd() {
    this.setData({
      showChangePwd: !this.data.showChangePwd,
      oldPwd: '',
      newPwd: '',
      confirmPwd: ''
    })
  },

  onOldPwdInput(e) {
    this.setData({ oldPwd: e.detail })
  },

  onNewPwdInput(e) {
    this.setData({ newPwd: e.detail })
  },

  onConfirmPwdInput(e) {
    this.setData({ confirmPwd: e.detail })
  },

  async confirmChangePwd() {
    const { oldPwd, newPwd, confirmPwd } = this.data
    if (!oldPwd) {
      wx.showToast({ title: '请输入旧密码', icon: 'none' })
      return
    }
    if (newPwd.length < 8) {
      wx.showToast({ title: '新密码至少8位', icon: 'none' })
      return
    }
    if (newPwd !== confirmPwd) {
      wx.showToast({ title: '两次新密码不一致', icon: 'none' })
      return
    }

    this.setData({ pwdLoading: true })

    try {
      const app = getApp()
      const userInfo = app.globalData.userInfo || {}
      const res = await UserAPI.changePassword({
        empId: userInfo.id,
        oldPassword: oldPwd,
        newPassword: newPwd
      })
      const result = res.result
      if (result.code === 0) {
        wx.showToast({ title: '密码修改成功', icon: 'success' })
        this.setData({ showChangePwd: false, oldPwd: '', newPwd: '', confirmPwd: '' })
      } else {
        wx.showToast({ title: result.message || '修改失败', icon: 'none' })
      }
    } catch (err) {
      console.error('[kitchen profile] changePassword error:', err)
      wx.showToast({ title: '修改失败，请重试', icon: 'none' })
    } finally {
      this.setData({ pwdLoading: false })
    }
  },

  // ─── 页面跳转 ────────────────────────────────────────────────

  goEmployee() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  // goWorkbench() {
  //   const { isSysAdmin, isDeptAdmin, isKitchen } = this.data
  //   let url = '/pages/index/index'
  //   if (isSysAdmin) {
  //     url = '/subpackages/admin/pages/dept-manage/index'
  //   } else if (isDeptAdmin) {
  //     url = '/subpackages/dept/pages/workspace/index'
  //   } else if (isKitchen) {
  //     url = '/subpackages/kitchen/pages/today/index'
  //   }
  //   if (url) wx.navigateTo({ url })
  // },

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
