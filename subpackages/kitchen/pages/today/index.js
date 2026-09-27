// subpackages/kitchen/pages/today/index.js — 食堂今日页面（系统导航栏 + 报餐查询）
const { KitchenAPI, UserAPI } = require('../../../../services/api')
const { formatDate, formatDateCN, isBookable } = require('../../../../utils/time')
const { MEAL_TYPE_ORDER, MEAL_TYPE_LABEL, ROLE } = require('../../../../utils/const')
const { verifyMeal } = require('../../utils/verify')
const { isValidPassword, PASSWORD_RULE_TIP } = require('../../../../utils/util')

Page({
  data: {
    safeBottom: 0, // iPhone 底部安全区

    activeTab: 'search',     // 'search' | 'today' | 'tomorrow' | 'profile'
    searchKeyword: '',
    searchFocus: false,
    loading: true,
    personSearchResult: null,
    searchMealFilter: '',     // '' = 全部, 'breakfast', 'lunch', 'dinner'

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

    // 顶部导航栏标题 = 当前 tab 名称（与员工端一致，使用系统默认导航栏）
    wx.setNavigationBarTitle({ title: this._getPageTitle(this.data.activeTab) })

    this.setData({
      safeBottom: sysInfo.safeArea ? Math.max(0, sysInfo.screenHeight - sysInfo.safeArea.bottom) : 0,
      todayDate: formatDate(today),
      todayLabel: formatDateCN(today),
      todayDateFull: todayFull,
      todayDay: todayFull.split(' ')[0],
      todayWeek: todayFull.split(' ')[1],
      tomorrowDate: formatDate(tomorrow),
      tomorrowLabel: formatDateCN(tomorrow),
      tomorrowDateFull: tomorrowFull,
      tomorrowDay: tomorrowFull.split(' ')[0],
      tomorrowWeek: tomorrowFull.split(' ')[1],
      tomorrowDeadline: this._checkDeadline(tomorrow),
    })

    this._loadAllData()
  },

  onShow() {
    // 隐藏左上角「返回首页」按钮（非 tabBar 页面作为栈底时微信会显示该按钮）
    wx.hideHomeButton()

    if (this.data.activeTab !== 'search') {
      this._loadAllData()
    }
    this._initUserInfo()
    this._loadDeptName()
  },

  // ─── 下拉刷新 ─────────────

  onPullDownRefresh() {
    if (this.data.activeTab === 'search') {
      // 查询 tab：如果有已查询的结果，重新执行查询；否则加载汇总数据
      if (this.data.personSearchResult !== null && this.data.searchKeyword) {
        this._doPersonSearch(this.data.searchKeyword, { silent: true })
      } else {
        this._loadAllData({ silent: true })
      }
    } else {
      this._loadAllData({ silent: true })
    }
  },

  // ─── 数据加载 ───────────────────────────────────────────────

  _loadAllData(opts = {}) {
    if (!opts.silent) {
      this.setData({ loading: true })
    }

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
      .finally(() => {
        // 关闭原生下拉刷新头
        wx.stopPullDownRefresh()
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
      showWorkspace,
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
      const data = await UserAPI.getDeptName(dept_id)
      this.setData({ deptName: (data && data.dept_name) || '—' })
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
    const week = '日一二三四五六'[date.getDay()]
    return `${year}年${month}月${day}日 星期${week}`
  },

  // 判断目标报餐日是否已过截止时间（截止 = 前一天 17:00，与 utils/time.isBookable 一致）
  _checkDeadline(targetDate) {
    return isBookable(targetDate) ? '可报餐' : '已截止'
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
    wx.setNavigationBarTitle({ title: this._getPageTitle(tab) })
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
      wx.showToast({ title: '请输入姓名或手机号', icon: 'none' })
      return
    }
    // 前端校验兜底：过短的关键词会大量误命中（如单个数字），至少 2 位再查询
    if (keyword.length < 2) {
      wx.showToast({ title: '请输入至少 2 个字符', icon: 'none' })
      return
    }
    this._doPersonSearch(keyword)
  },

  _doPersonSearch(keyword, opts = {}) {
    const mealFilter = this.data.searchMealFilter
    const searchDate = this.data.todayDate
    const dateLabel = this.data.todayLabel

    if (!opts.silent) {
      this.setData({ loading: true })
    }

    const apiCall = KitchenAPI.searchByKeyword(keyword, searchDate, mealFilter || undefined)

    apiCall.then((data) => {
        if (data) {
          // 为每条记录添加手机号脱敏 + 核销状态兜底 + 家属餐数量（总份数减1，与报餐明细一致）
          const list = (data.list || []).map(item => {
            const breakfast = Number(item.breakfast) || 0
            const lunch = Number(item.lunch) || 0
            const dinner = Number(item.dinner) || 0
            return {
              ...item,
              breakfast,
              lunch,
              dinner,
              breakfast_family: Math.max(breakfast - 1, 0),
              lunch_family: Math.max(lunch - 1, 0),
              dinner_family: Math.max(dinner - 1, 0),
              phoneMasked: item.phone
                ? item.phone.slice(0, 3) + '****' + item.phone.slice(-4)
                : '',
              breakfast_verified: item.breakfast_verified === 1 ? 1 : 0,
              lunch_verified: item.lunch_verified === 1 ? 1 : 0,
              dinner_verified: item.dinner_verified === 1 ? 1 : 0,
              verifyingMeal: '', // 当前正在核销的餐次（防重复点击）
            }
          })
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
        wx.showToast({ title: err.message || '查询失败，请重试', icon: 'none' })
        this.setData({
          personSearchResult: null,
          loading: false,
        })
      })
      .finally(() => {
        // 静默模式下需要主动关闭原生下拉刷新头
        if (opts.silent) wx.stopPullDownRefresh()
      })
  },

  // ─── 核销 / 撤销核销 ───────────────────────────────────────

  /**
   * 点击核销按钮：未核销 -> 直接核销；已核销 -> 弹确认后撤销
   */
  onVerifyMeal(e) {
    const { empId, meal, verified } = e.currentTarget.dataset
    const result = this.data.personSearchResult
    if (!result || !result.list) return
    const idx = result.list.findIndex(it => String(it.emp_id) === String(empId))
    if (idx === -1) return
    const item = result.list[idx]

    verifyMeal(this, {
      empId,
      date: result.date,
      meal,
      verified,
      name: item.name,
      isBusy: () => !!item.verifyingMeal,
      setBusy: (m) => this.setData({ [`personSearchResult.list[${idx}].verifyingMeal`]: m }),
      clearBusy: () => this.setData({ [`personSearchResult.list[${idx}].verifyingMeal`]: '' }),
      onSuccess: (nv) => {
        const field = `${meal}_verified`
        this.setData({ [`personSearchResult.list[${idx}].${field}`]: nv })
      },
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
    if (!isValidPassword(newPwd)) {
      wx.showToast({ title: PASSWORD_RULE_TIP, icon: 'none' })
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
      // 业务失败会 reject，由 catch 兜底展示具体原因
      await UserAPI.changePassword({
        empId: userInfo.id,
        oldPassword: oldPwd,
        newPassword: newPwd
      })
      wx.showToast({ title: '密码修改成功', icon: 'success' })
      this.setData({ showChangePwd: false, oldPwd: '', newPwd: '', confirmPwd: '' })
    } catch (err) {
      console.error('[kitchen profile] changePassword error:', err)
      wx.showToast({ title: err.message || '修改失败，请重试', icon: 'none' })
    } finally {
      this.setData({ pwdLoading: false })
    }
  },

  // ─── 页面跳转 ────────────────────────────────────────────────

  goEmployee() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  // 管理员工作台
  goDeptWorkbench() {
    wx.redirectTo({ url: '/subpackages/dept/pages/stats/index' })
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

  // ─── 跳转明细页 ────────────────────────────────────────────

  goDetail(e) {
    // 兼容组件事件（e.detail.date）与历史 dataset 传参
    const date = (e && e.detail && e.detail.date) || (e && e.currentTarget && e.currentTarget.dataset.date) || this.data.todayDate
    wx.navigateTo({
      url: `/subpackages/kitchen/pages/detail/index?date=${date}`,
    })
  },
})
