// pages/profile/index.js — 个人中心（对齐原型 ProfilePage）
const { ROLE } = require('../../utils/const')

const ROLE_NAME_MAP = {
  employee: '普通员工',
  kitchen: '食堂员工',
  dept_admin: '部门管理员',
  sys_admin: '系统管理员',
}

Page({
  data: {
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
    // Phase 4.1: 订阅消息
    subscribed: false,
    templateIds: ['mock_template_id_1'],  // 真实环境中替换为后端配置的模板 ID
  },

  onLoad() {
    const app = getApp()
    // DEV MOCK 兜底：直接打开页面时若 app._initAuth 尚未完成，手动注入 mock 用户
    if (app.globalData.devMock && !app.globalData.userInfo) {
      const MU = require('../../utils/mock-user')
      app.globalData.userInfo = { ...MU }
      app.globalData.roles = [...MU.roles]
      app.globalData.authReady = true
    }
    this._initDisplay()
  },

  onShow() {
    this._initDisplay()
  },

  _initDisplay() {
    const app = getApp()
    const userInfo = app.globalData.userInfo || {}
    const roles = userInfo.roles || ['employee']
    const primaryRole = roles.find(r => r !== 'employee') || 'employee'

    // 手机号脱敏
    const phone = userInfo.phone || ''
    const phoneMasked = phone.length >= 11
      ? phone.slice(0, 3) + '****' + phone.slice(-4)
      : phone

    this.setData({
      userInfo,
      phoneMasked,
      roleName: ROLE_NAME_MAP[primaryRole] || '普通员工',
      isKitchen: roles.includes(ROLE.KITCHEN),
      isDeptAdmin: roles.includes(ROLE.DEPT_ADMIN),
      isSysAdmin: roles.includes(ROLE.SYS_ADMIN),
    })
  },

  // ─── 换绑手机号 ──────────────────────────────────────────────

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

  // Phase 4.1: 微信订阅消息授权
  onSubscribeMessage() {
    const templateIds = this.data.templateIds

    const app = getApp()
    if (app.globalData.devMock) {
      // Mock 模式：模拟授权
      wx.showModal({
        title: '订阅消息授权',
        content: '订阅后将在报餐截止前（每天 15:00）收到微信提醒。\n\n（Dev 模式：模拟授权成功）',
        confirmText: '允许',
        success: (res) => {
          if (res.confirm) {
            this.setData({ subscribed: true })
            wx.showToast({ title: '订阅成功', icon: 'success' })
          }
        },
      })
      return
    }

    // 真实模式：调用微信订阅消息接口
    wx.requestSubscribeMessage({
      tmplIds: templateIds,
      success: (res) => {
        const accepted = templateIds.filter(id => res[id] === 'accept')
        if (accepted.length > 0) {
          this.setData({ subscribed: true })
          wx.showToast({ title: '订阅成功', icon: 'success' })
        } else {
          wx.showToast({ title: '已取消订阅', icon: 'none' })
        }
      },
      fail: (err) => {
        console.error('Subscription request failed:', err)
        wx.showToast({ title: '授权失败，请重试', icon: 'none' })
      },
    })
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
})
