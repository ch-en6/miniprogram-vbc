// pages/login/index.js
const Toast = require('@vant/weapp/toast/toast').default
const { saveTokens, setCachedUserInfo } = require('../../utils/auth')
const { AuthAPI } = require('../../services/api')

Page({
  data: {
    loading: false,
    phone: '',
    password: '',
  },

  onLoad() {
    // 若已有 userInfo（已登录），直接跳首页
    const app = getApp()
    if (app.globalData.userInfo) {
      this._goHome(app.globalData.roleCode || '')
    }
  },

  // ─── 输入事件 ───────────────────────────────────────────────

  onPhoneInput(e) {
    this.setData({ phone: e.detail })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail })
  },

  // ─── 账号密码登录 ──────────────────────────────────────────

  async onLogin() {
    const { phone, password } = this.data
    if (this.data.loading) return

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      Toast.fail('请输入正确的手机号')
      return
    }

    this.setData({ loading: true })

    try {
      // 1. 调用 wx.login() 获取临时 code，用于换取 openid
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({
          success: res => resolve(res),
          fail: err => reject(err)
        })
      })

      if (!loginRes.code) {
        Toast.fail('获取登录凭证失败，请重试')
        this.setData({ loading: false })
        return
      }

      // 2. 调用云函数：校验账号密码 + 用 code 换 openid 并写入 sys_emp
      //    业务失败（未注册/已绑定/密码错误）以 code === 0 + allowed/pwdError 正常返回；
      //    真实异常（参数缺失/云函数报错）才会 reject，由下方 catch 兜底
      const data = await AuthAPI.checkLogin({ phone, password, loginCode: loginRes.code })

      const { allowed, emp, pwdError } = data || {}

      // 3. 不允许登录：未注册 / 微信已绑定其他账号等（展示云函数返回的具体原因）
      if (!allowed) {
        Toast.fail({ message: (data && data.message) || '该账号未注册\n请联系管理员添加', duration: 3000 })
        this.setData({ loading: false })
        return
      }

      // 4. 密码错误
      if (pwdError) {
        Toast.fail('密码错误，请重新输入')
        this.setData({ loading: false })
        return
      }

      // 5. 员工已被停用
      if (emp.status === 0) {
        Toast.fail({ message: '该员工已被停用\n请联系管理员', duration: 3000 })
        this.setData({ loading: false })
        return
      }

      // 6. 校验通过，进入首页
      this._handleLoginSuccess({ user: emp })
    } catch (err) {
      console.error('[Login Error]', err)
      this.setData({ loading: false })
      Toast.fail(err.message || '登录失败，请重试')
    }
  },

  // ─── 公共处理 ────────────────────────────────────────────────

  _handleLoginSuccess(result) {
    const app = getApp()
    const user = result.user

    app.globalData.userInfo = user
    app.globalData.roleCode = user.role_code || 'employee'
    app.globalData.authReady = true

    // 保存 token（云开发模式下可用空 token 占位）
    saveTokens({ access_token: 'cloud-token', refresh_token: 'cloud-refresh' })
    setCachedUserInfo(user)

    // 登录成功后预加载缓存（部门名称 + 价格配置）
    app._preloadCache(user.dept_id)

    // 通知等待 auth 的回调
    if (app._authCallbacks && app._authCallbacks.length) {
      app._authCallbacks.forEach(cb => cb(user))
      app._authCallbacks = []
    }

    this.setData({ loading: false })
    this._goHome(user.role_code)
  },

  _goHome(roleCode = '') {
    if (roleCode === 'kitchen') {
      wx.reLaunch({ url: '/subpackages/kitchen/pages/today/index' })
    } else {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  showPrivacy() {
    wx.showModal({
      title: '用户隐私协议',
      content: '',
      showCancel: false,
      confirmText: '我知道了',
    })
  },
})
