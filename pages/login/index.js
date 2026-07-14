// pages/login/index.js
const Toast = require('@vant/weapp/toast/toast').default
const { saveTokens, setCachedUserInfo } = require('../../utils/auth')

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

    try {
      // 1. 通过 phone_code 调用微信接口获取真实手机号
      const phoneResult = await this._getPhoneNumberByCode(code)
      const phone = phoneResult.phoneNumber

      if (!phone) {
        Toast.fail('获取手机号失败，请重试')
        this.setData({ loading: false })
        return
      }

      // 2. 调用云函数检查手机号是否在 sys_emp 表中
      const checkRes = await wx.cloud.callFunction({
        name: 'checkEmpPhone',
        data: { phone }
      })

      const result = checkRes.result
      if (result.code !== 0) {
        Toast.fail(result.message || '查询失败，请重试')
        this.setData({ loading: false })
        return
      }

      const { allowed, emp } = result.data

      // 3. 手机号不在 sys_emp 表中，不允许登录
      if (!allowed) {
        Toast.fail({ message: '该手机号未注册\n请联系管理员添加', duration: 3000 })
        this.setData({ loading: false })
        return
      }

      // 4. 员工已被停用
      if (emp.status === 'disabled') {
        Toast.fail({ message: '该员工已被停用\n请联系管理员', duration: 3000 })
        this.setData({ loading: false })
        return
      }

      // 5. 校验通过，写入用户信息并进入首页
      this._handleLoginSuccess({ user: emp })
    } catch (err) {
      console.error('[Login Error]', err)
      this.setData({ loading: false })
      Toast.fail(err.errMsg || '登录失败，请重试')
    }
  },

  /**
   * 通过微信 phone_code 获取真实手机号
   * 使用云函数调用微信接口 getPhoneNumber
   */
  async _getPhoneNumberByCode(phoneCode) {
    // 调用云函数获取手机号（需要后端/云函数调用微信接口）
    const res = await wx.cloud.callFunction({
      name: 'getPhoneNumber',
      data: { phone_code: phoneCode }
    })

    if (res.result && res.result.code === 0) {
      return res.result.data
    }

    // 如果 getPhoneNumber 云函数不存在，尝试直接使用 phone_code 中的信息
    // 微信新版接口需要通过后端调用 wxa/business/getuserphonenumber
    throw new Error('获取手机号失败：请先部署 getPhoneNumber 云函数')
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
    // TODO: 调用云函数发送短信验证码
    Toast.success('验证码已发送')
    this._startCooldown()
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
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      Toast.fail('请输入正确的手机号')
      return
    }
    if (smsCode.length !== 6) {
      Toast.fail('请输入6位验证码')
      return
    }

    this.setData({ loading: true })

    try {
      // 1. 调用云函数检查手机号是否在 sys_emp 表中
      const checkRes = await wx.cloud.callFunction({
        name: 'checkEmpPhone',
        data: { phone }
      })

      const result = checkRes.result
      if (result.code !== 0) {
        Toast.fail(result.message || '查询失败，请重试')
        this.setData({ loading: false })
        return
      }

      const { allowed, emp } = result.data

      if (!allowed) {
        Toast.fail({ message: '该手机号未注册\n请联系管理员添加', duration: 3000 })
        this.setData({ loading: false })
        return
      }

      if (emp.status === '0') {
        Toast.fail({ message: '该员工已被停用\n请联系管理员', duration: 3000 })
        this.setData({ loading: false })
        return
      }

      // 2. TODO: 校验短信验证码（需接入短信验证码云函数）

      // 3. 校验通过，写入用户信息并进入首页
      this._handleLoginSuccess({ user: emp })
    } catch (err) {
      console.error('[Login Error]', err)
      this.setData({ loading: false })
      Toast.fail(err.errMsg || '登录失败，请重试')
    }
  },

  // ─── 公共处理 ────────────────────────────────────────────────

  _handleLoginSuccess(result) {
    const app = getApp()
    const user = result.user

    app.globalData.userInfo = user
    app.globalData.roles = user.roles || ['employee']
    app.globalData.authReady = true

    // 保存 token（云开发模式下可用空 token 占位）
    saveTokens({ access_token: 'cloud-token', refresh_token: 'cloud-refresh' })
    setCachedUserInfo(user)

    // 通知等待 auth 的回调
    if (app._authCallbacks && app._authCallbacks.length) {
      app._authCallbacks.forEach(cb => cb(user))
      app._authCallbacks = []
    }

    this.setData({ loading: false })
    this._goHome(user.roles)
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
