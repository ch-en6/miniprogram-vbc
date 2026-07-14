// app.js — 企业报餐小程序全局入口（云开发模式）
const { saveTokens, clearAuth, getCachedUserInfo, setCachedUserInfo } = require('./utils/auth')

App({
  globalData: {
    /** 当前登录用户信息 */
    userInfo: null,
    /** 用户角色数组 */
    roles: [],
    /** 是否已完成初始化登录检测 */
    authReady: false,
    /** 系统信息 */
    systemInfo: null,
    /** 全局公告内容 */
    announcement: null,
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
   * 检查本地缓存的用户信息，若存在则恢复登录态，否则跳转登录页
   */
  async _initAuth() {
    const app = this

    try {
      const cached = getCachedUserInfo()
      if (cached && cached._id) {
        // 有缓存用户，恢复登录态
        app.globalData.userInfo = cached
        app.globalData.roles = cached.roles || ['employee']
        app.globalData.authReady = true
        app._resolveAuthCallbacks(true)
        console.info('[App] Restored user from cache:', cached.name)
      } else {
        // 无缓存，跳登录页
        app._redirectToLogin()
      }
    } catch (e) {
      console.warn('[App] _initAuth error', e)
      app._redirectToLogin()
    }
  },

  /**
   * 跳转登录页
   */
  _redirectToLogin() {
    this.globalData.authReady = true
    this.globalData.userInfo = null
    this.globalData.roles = []
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
   * 退出登录：清除本地凭证，回到登录页
   */
  logout() {
    clearAuth()
    this.globalData.userInfo = null
    this.globalData.roles = []
    this.globalData.authReady = false
    wx.reLaunch({ url: '/pages/login/index' })
  },
})
