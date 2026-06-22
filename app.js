// app.js — 企业报餐小程序全局入口
const { checkLogin, clearAuth, getCachedUserInfo } = require('./utils/auth')

// ─── 开发调试开关（与 pages/login/index.js 保持一致）────────────
// true  = 启动时若本地有 mock token，直接用缓存 userInfo，不请求后端
// false = 生产模式，走真实接口验证
const DEV_MOCK = true

// DEV_MOCK 模式统一 mock 用户配置（修改 roles 切换测试角色）
// 编辑 utils/mock-user.js 即可生效，无需改多处
const MOCK_USER = require('./utils/mock-user')
const FORCE_FRESH_MOCK = true  // true = 每次启动强制用最新 mock 数据（忽略本地缓存，roles 修改后立即生效）
// ──────────────────────────────────────────────────────────────

App({
  // ─── 全局数据 ────────────────────────────────────────────────
  globalData: {
    /** 当前登录用户信息，结构同后端 /auth/me 返回 */
    userInfo: null,
    /**
     * 用户角色数组，可多角色叠加
     * 可选值: 'employee' | 'kitchen' | 'dept_admin' | 'sys_admin'
     */
    roles: [],
    /** 是否已完成初始化登录检测 */
    authReady: false,
    /** 系统信息（屏幕高度等） */
    systemInfo: null,
    /** 全局公告内容 */
    announcement: null,
    /** 是否处于开发 Mock 模式（供页面判断是否跳过接口） */
    devMock: DEV_MOCK,
  },

  // ─── 生命周期 ────────────────────────────────────────────────
  onLaunch() {
    // 1. 获取系统信息
    try {
      const info = wx.getSystemInfoSync()
      this.globalData.systemInfo = info
    } catch (e) {
      console.error('[App] getSystemInfoSync failed', e)
    }

    // 2. 执行登录检测（不阻塞页面渲染）
    this._initAuth()
  },

  onShow() {},
  onHide() {},

  // ─── 内部方法 ────────────────────────────────────────────────

  /**
   * 初始化登录状态
   *
   * DEV_MOCK = true 时：
   *   - FORCE_FRESH_MOCK = true  → 每次启动都用最新的 MOCK_USER，忽略本地缓存（修改 roles 后立即生效）
   *   - FORCE_FRESH_MOCK = false → 若本地缓存有 userInfo（上次 mock 登录留下的）→ 直接用，不调后端
   *   - 若缓存无数据 → 跳登录页让用户点一次授权按钮
   *
   * DEV_MOCK = false（生产）：
   *   - 有 token → 验证 token / 拉取 userInfo
   *   - 无 token → 跳登录页
   */
  async _initAuth() {
    const app = this

    // ── DEV MOCK 快速通道 ──────────────────────────────────
    if (DEV_MOCK) {
      if (FORCE_FRESH_MOCK) {
        // 强制使用最新 MOCK_USER，忽略本地缓存（roles 修改后立即生效）
        app.globalData.userInfo = { ...MOCK_USER }
        app.globalData.roles = MOCK_USER.roles || ['employee']
        app.globalData.authReady = true
        // 同步写入缓存，确保 login 页面的 _applyMockLogin 也读到最新数据
        const { setCachedUserInfo } = require('./utils/auth')
        setCachedUserInfo(MOCK_USER)
        app._resolveAuthCallbacks(true)
        console.info('[DEV MOCK] Forced fresh mock user:', MOCK_USER.name, 'roles:', MOCK_USER.roles)
        return
      }

      // 旧逻辑：有缓存则恢复，无缓存则跳登录页
      const { getCachedUserInfo } = require('./utils/auth')
      const cached = getCachedUserInfo()
      if (cached && cached.id) {
        // 有缓存 mock 用户，直接恢复登录态，不跳转（停留当前页）
        app.globalData.userInfo = cached
        app.globalData.roles = cached.roles || ['employee']
        app.globalData.authReady = true
        app._resolveAuthCallbacks(true)
        console.info('[DEV MOCK] Restored user from cache:', cached.name)
        return
      }
      // 无缓存 → 跳登录页
      app._redirectToLogin()
      return
    }
    // ──────────────────────────────────────────────────────

    // 生产模式
    try {
      const userInfo = await checkLogin()
      if (userInfo) {
        app.globalData.userInfo = userInfo
        app.globalData.roles = userInfo.roles || ['employee']
        app.globalData.authReady = true
        app._resolveAuthCallbacks(true)
      } else {
        app._redirectToLogin()
      }
    } catch (e) {
      console.warn('[App] _initAuth error, redirect to login', e)
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
    // 延迟确保页面栈已初始化
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/login/index' })
    }, 100)
  },

  /**
   * 等待鉴权完成的 Promise（供各 Page.onLoad 使用）
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
