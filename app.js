// app.js — 报餐小程序全局入口（云开发模式）
const { saveTokens, clearAuth, getCachedUserInfo, setCachedUserInfo, refreshUserInfo } = require('./utils/auth')
const { getCachedPriceConfig, loadAndCachePriceConfig, clearAllCache } = require('./utils/cache')

App({
  globalData: {
    /** 当前登录用户信息 */
    userInfo: null,
    /** 用户角色 code */
    roleCode: '',
    /** 是否已完成初始化登录检测 */
    authReady: false,
    /** 系统信息 */
    systemInfo: null,
    /** 全局公告内容 */
    announcement: null,
    /** 缓存：价格配置 */
    priceConfig: null,
  },

  onLaunch() {
    // 初始化云开发环境
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d6gef7cuzfdcc6b71', // TODO: 替换为你的云环境 ID
        traceUser: true,
      })
      console.log('[App] Cloud initialized')
    } else {
      console.error('[App] Cloud not supported')
    }

    // 获取系统信息
    try {
      this.globalData.systemInfo = wx.getSystemInfoSync()
    } catch (e) {
      console.error('[App] getSystemInfoSync failed', e)
    }

    // 执行登录检测
    this._initAuth()
  },

  onShow() {},
  onHide() {},

  /**
   * 初始化登录状态
   * - 缓存有效（7 天内）→ 恢复登录态
   * - 缓存过期 → 调用云函数按 openid 静默刷新，重建缓存与登录态
   * - 无缓存 / 刷新失败 → 跳转登录页
   */
  async _initAuth() {
    const app = this

    try {
      const cached = getCachedUserInfo()
      if (cached && cached.id) {
        app._restoreSession(cached)
      } else {
        // 缓存缺失或已过期（超过 7 天）：静默刷新最新用户信息
        const fresh = await refreshUserInfo()
        if (fresh && fresh.id) {
          app._restoreSession(fresh)
          console.info('[App] Restored user from remote refresh:', fresh.name)
        } else {
          app._redirectToLogin()
        }
      }
    } catch (e) {
      console.warn('[App] _initAuth error', e)
      app._redirectToLogin()
    }
  },

  /**
   * 恢复/建立登录态（写入 globalData 并通知等待方）
   */
  _restoreSession(user) {
    const app = this
    app.globalData.userInfo = user
    app.globalData.roleCode = user.role_code || 'employee'
    app.globalData.authReady = true
    app._resolveAuthCallbacks(true)
    console.info('[App] Restored user from cache:', user.name)

    // 恢复缓存的价格配置（按部门 + 有效期校验，同步读 Storage，异步刷新）
    app.globalData.priceConfig = getCachedPriceConfig(user.dept_id)
    // 后台静刷新（如果缓存过期/失效会自动重新拉取）
    app._preloadCache(user.dept_id)
  },

  /**
   * 跳转登录页
   */
  _redirectToLogin() {
    this.globalData.authReady = true
    this.globalData.userInfo = null
    this.globalData.roleCode = ''
    this._resolveAuthCallbacks(false)
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/login/index' })
    }, 100)
  },

  /**
   * 等待鉴权完成的 Promise
   * @returns {Promise<boolean>} true=已登录 false=未登录
   */
  waitForAuth() {
    if (this.globalData.authReady) {
      return Promise.resolve(!!this.globalData.userInfo)
    }
    return new Promise((resolve) => {
      if (!this._authCallbacks) this._authCallbacks = []
      this._authCallbacks.push(resolve)
    })
  },

  _resolveAuthCallbacks(result) {
    if (this._authCallbacks && this._authCallbacks.length) {
      this._authCallbacks.forEach((cb) => cb(result))
      this._authCallbacks = []
    }
  },

  /**
   * 预加载缓存数据（价格配置）
   * 缓存有效期内直接返回，过期则重新拉取
   */
  async _preloadCache(dept_id) {
    if (!dept_id) return
    try {
      const priceConfig = await loadAndCachePriceConfig(dept_id)
      if (priceConfig) this.globalData.priceConfig = priceConfig
      console.info('[App] Cache preloaded:', { priceConfig })
    } catch (e) {
      console.warn('[App] _preloadCache error:', e)
    }
  },

  /**
   * 退出登录：清除本地凭证，回到登录页
   */
  logout() {
    clearAuth()
    clearAllCache()
    this.globalData.userInfo = null
    this.globalData.roleCode = ''
    this.globalData.authReady = false
    this.globalData.priceConfig = null
    wx.reLaunch({ url: '/pages/login/index' })
  },
})
