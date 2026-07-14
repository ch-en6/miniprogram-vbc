// pages/profile/index.js — 个人中心
const { ROLE } = require('../../utils/const')
const QR = require('../../utils/qrcode')

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
    empNo: '',
    isDisabled: false, // 员工是否被停用
    isKitchen: false,
    isDeptAdmin: false,
    isSysAdmin: false,
    // 换绑
    showRebind: false,
    newPhone: '',
    smsCode: '',
    smsCooldown: 0,
    // 订阅消息
    subscribed: false,
    templateIds: ['mock_template_id_1'],
  },

  onLoad() {
    this._initDisplay()
  },

  onShow() {
    this._initDisplay()
  },

  onReady() {
    // 页面初次渲染完成后生成二维码
    this._drawQRCode()
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

    // 员工状态
    const isDisabled = userInfo.status === 'disabled'

    this.setData({
      userInfo,
      phoneMasked,
      roleName: ROLE_NAME_MAP[primaryRole] || '普通员工',
      empNo: userInfo.emp_no || '',
      isDisabled,
      isKitchen: roles.includes(ROLE.KITCHEN),
      isDeptAdmin: roles.includes(ROLE.DEPT_ADMIN),
      isSysAdmin: roles.includes(ROLE.SYS_ADMIN),
    })
  },

  _drawQRCode() {
    const { userInfo } = this.data
    if (!userInfo || !userInfo._id) return

    // 用员工ID生成二维码内容（工牌标识）
    const qrContent = 'EMP:' + userInfo._id
    QR.draw('qrCanvas', this, qrContent, 360)
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
    // TODO: 调用云函数发送短信验证码
    wx.showToast({ title: '验证码已发送', icon: 'success' })
    this._startCooldown()
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

  onSubscribeMessage() {
    const templateIds = this.data.templateIds
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
      fail: () => {
        wx.showToast({ title: '授权失败，请重试', icon: 'none' })
      },
    })
  },

  confirmRebind() {
    // TODO: 调用云函数换绑手机号
    wx.showToast({ title: '换绑申请已提交', icon: 'success' })
    this.setData({ showRebind: false })
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
    }).catch(() => {})
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
  },
})
