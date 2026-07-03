// pages/login/index.js
const { AuthAPI } = require('../../services/api')
const { saveTokens, setCachedUserInfo } = require('../../utils/auth')
const Toast = require('@vant/weapp/toast/toast').default

// ─── DEV MOCK 统一配置（编辑 utils/mock-user.js 切换角色，无需改多处）────────────
const DEV_MOCK = true
const MOCK_USER = require('../../utils/mock-user')
// ──────────────────────────────────────────────────────────────────────────────────

Page({
  data: {
    loading: false,
    // 短信登录
    showSmsLogin: false,
    phone: '',
    smsCode: '',
    smsCooldown: 0,
  },

  onLoad() {
    // 若已有 userInfo（已登录），直接跳首页
    const app = getApp()
    if (app.globalData.userInfo) {
      this._goHome(app.globalData.userInfo.roles)
    }
  },

  // ─── 微信授权手机号登录 ─────────────────────────────────────

  /**
   * open-type="getPhoneNumber" 回调
   * 微信 2022+ 使用 code 方式获取手机号
   */
  async onGetPhoneNumber(e) {
    if (this.data.loading) return

    const { code, errMsg } = e.detail

    // 用户点了拒绝
    if (errMsg && errMsg !== 'getPhoneNumber:ok') {
      Toast.fail('请授权手机号以完成登录')
      return
    }

    this.setData({ loading: true })

    // ── DEV MOCK 模式：无需后端，直接写入 mock 数据 ──────────
    if (DEV_MOCK) {
      setTimeout(() => {
        this._applyMockLogin()
      }, 600) // 模拟网络延迟
      return
    }
    // ────────────────────────────────────────────────────────

    try {
      // 1. 获取微信 wx.login code
      const loginRes = await new Promise((res, rej) =>
        wx.login({ success: res, fail: rej })
      )
      // 2. 调后端：wx_code + phone_code → tokens + user
      const result = await AuthAPI.loginWithPhone(loginRes.code, code)
      this._handleLoginSuccess(result)
    } catch (err) {
      this._handleLoginError(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  // ─── 手机号 + 短信验证码登录 ────────────────────────────────

  toggleSmsLogin() {
    this.setData({ showSmsLogin: !this.data.showSmsLogin })
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail })
  },

  onSmsInput(e) {
    this.setData({ smsCode: e.detail })
  },

  async sendSmsCode() {
    const { phone } = this.data
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      Toast.fail('请输入正确的手机号')
      return
    }
    if (DEV_MOCK) {
      Toast.success('验证码已发送（DEV: 任意6位即可）')
      this._startCooldown()
      return
    }
    try {
      await AuthAPI.sendSmsCode(phone)
      Toast.success('验证码已发送')
      this._startCooldown()
    } catch (err) {
      Toast.fail(err?.message || '发送失败，请重试')
    }
  },

  _startCooldown() {
    let count = 60
    this.setData({ smsCooldown: count })
    const timer = setInterval(() => {
      count -= 1
      this.setData({ smsCooldown: count })
      if (count <= 0) clearInterval(timer)
    }, 1000)
  },

  async onSmsLogin() {
    const { phone, smsCode } = this.data
    if (this.data.loading) return
    this.setData({ loading: true })

    if (DEV_MOCK) {
      setTimeout(() => this._applyMockLogin(), 600)
      return
    }

    try {
      const loginRes = await new Promise((res, rej) =>
        wx.login({ success: res, fail: rej })
      )
      const result = await AuthAPI.loginWithSms(loginRes.code, phone, smsCode)
      this._handleLoginSuccess(result)
    } catch (err) {
      this._handleLoginError(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  // ─── 公共处理 ────────────────────────────────────────────────

  /** DEV MOCK 模式：直接写入本地缓存并进入首页 */
  _applyMockLogin() {
    const mockTokens = { access_token: 'dev-mock-token', refresh_token: 'dev-mock-refresh' }
    const mockResult = { user: MOCK_USER, ...mockTokens }
    saveTokens(mockTokens)
    setCachedUserInfo(MOCK_USER)
    this._handleLoginSuccess(mockResult)
  },

  _handleLoginSuccess(result) {
    const app = getApp()
    app.globalData.userInfo = result.user
    app.globalData.roles = result.user.roles || ['employee']
    app.globalData.authReady = true
    // 通知等待 auth 的回调
    if (app._authCallbacks && app._authCallbacks.length) {
      app._authCallbacks.forEach(cb => cb(result.user))
      app._authCallbacks = []
    }
    this.setData({ loading: false })
    this._goHome(result.user.roles)
  },

  _handleLoginError(err) {
    console.error('[Login Error]', err)
    this.setData({ loading: false })
    const code = err?.code || err?.status
    const msg = err?.message || err?.msg || ''

    if (code === 403 || msg.includes('未开通')) {
      Toast.fail({ message: '此账号暂未开通\n请联系管理员', duration: 3000 })
    } else if (msg.includes('已绑定')) {
      Toast.fail({ message: '该手机号已绑定\n其他微信账号', duration: 3000 })
    } else if (msg.includes('停用') || msg.includes('禁用') || code === 423) {
      Toast.fail({ message: '当前账号不可使用\n请联系管理员', duration: 3000 })
    } else {
      Toast.fail(msg || '登录失败，请重试')
    }
  },

  _goHome(roles = []) {
    if (roles.includes('kitchen')) {
      wx.reLaunch({ url: '/subpackages/kitchen/pages/today/index' })
    } else {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  showPrivacy() {
    wx.showModal({
      title: '用户隐私协议',
      content: '本应用收集您的手机号用于企业内部用餐管理，不会将数据泄露给第三方。',
      showCancel: false,
      confirmText: '我知道了',
    })
  },
})
