// pages/profile/index.js — 个人中心
const { ROLE } = require('../../utils/const')
const QR = require('../../utils/qrcode')
const { UserAPI } = require('../../services/api')
const { isValidPassword, PASSWORD_RULE_TIP } = require('../../utils/util')

Page({
  data: {
    userInfo: {},
    phoneMasked: '',
    deptName: '',
    showWorkspace: false, // 是否显示工作台
    // 换绑
    showRebind: false,
    newPhone: '',
    smsCode: '',
    smsCooldown: 0,
    // 修改密码
    showChangePwd: false,
    oldPwd: '',
    newPwd: '',
    confirmPwd: '',
    pwdLoading: false,
    // 订阅消息
    // subscribed: false,
    // templateIds: ['mock_template_id_1'],
  },

  onLoad() {
    this._initDisplay()
    this._loadDeptName()
  },

  onShow() {
    this._initDisplay()
    this._loadDeptName()
  },

  onReady() {
    // 页面初次渲染完成后生成二维码
    // this._drawQRCode()
  },

  _initDisplay() {
    const app = getApp()
    const userInfo = app.globalData.userInfo || {}
    // 使用登录时缓存的角色 code
    const roleCode = app.globalData.roleCode || ''

    // 手机号脱敏
    const phone = userInfo.phone || ''
    const phoneMasked = phone.length >= 11
      ? phone.slice(0, 3) + '****' + phone.slice(-4)
      : phone

    // 判断是否显示工作台（只有部门管理员/系统管理员才显示）
    const showWorkspace = [ROLE.DEPT_ADMIN, ROLE.SYS_ADMIN].includes(roleCode)

    this.setData({
      userInfo,
      phoneMasked,
      showWorkspace,
    })
  },

  /**
   * 加载部门名称
   * 链路：
   *   1. userInfo.dept_name（登录时 checkLogin 已联查并随 userInfo 缓存，零额外请求）
   *   2. 兜底：调用云函数 getDeptName 查询（老版本缓存缺失 dept_name 时），不写缓存
   *   3. 兜底显示 '—'
   */
  async _loadDeptName() {
    const app = getApp()
    const userInfo = app.globalData.userInfo || {}
    const dept_id = userInfo.dept_id

    // 1. 登录时已随 userInfo 返回部门名，直接使用
    if (userInfo.dept_name) {
      this.setData({ deptName: userInfo.dept_name })
      return
    }

    // 2. 兜底：请求云函数（不写缓存，下次登录会重新带 dept_name）
    if (!dept_id) {
      this.setData({ deptName: '—' })
      return
    }
    try {
      const data = await UserAPI.getDeptName(dept_id)
      this.setData({ deptName: (data && data.dept_name) || '—' })
    } catch (err) {
      console.error('[profile] loadDeptName error:', err)
      this.setData({ deptName: '—' })
    }
  },

  // _drawQRCode() {
  //   const { userInfo } = this.data
  //   if (!userInfo || !userInfo._id) return

  //   // 用员工ID生成二维码内容（工牌标识）
  //   const qrContent = 'EMP:' + userInfo._id
  //   QR.draw('qrCanvas', this, qrContent, 360)
  // },

  // ─── 换绑手机号 ──────────────────────────────────────────────

  toggleRebind() {
    this.setData({ showRebind: !this.data.showRebind })
  },

  // ─── 修改密码 ────────────────────────────────────────────────

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
      // 业务失败会 reject，由 catch 兜底展示具体原因
      await UserAPI.changePassword({
        oldPassword: oldPwd,
        newPassword: newPwd
      })
      wx.showToast({ title: '密码修改成功', icon: 'success' })
      this.setData({ showChangePwd: false, oldPwd: '', newPwd: '', confirmPwd: '' })
    } catch (err) {
      console.error('[profile] changePassword error:', err)
      wx.showToast({ title: err.message || '修改失败，请重试', icon: 'none' })
    } finally {
      this.setData({ pwdLoading: false })
    }
  },

  // onNewPhoneInput(e) {
  //   this.setData({ newPhone: e.detail })
  // },

  // onSmsInput(e) {
  //   this.setData({ smsCode: e.detail })
  // },

  // sendSmsCode() {
  //   const { newPhone } = this.data
  //   if (!/^1[3-9]\d{9}$/.test(newPhone)) {
  //     wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
  //     return
  //   }
  //   // TODO: 调用云函数发送短信验证码
  //   wx.showToast({ title: '验证码已发送', icon: 'success' })
  //   this._startCooldown()
  // },

  // _startCooldown() {
  //   let count = 60
  //   this.setData({ smsCooldown: count })
  //   this._timer = setInterval(() => {
  //     count -= 1
  //     this.setData({ smsCooldown: count })
  //     if (count <= 0) clearInterval(this._timer)
  //   }, 1000)
  // },

  // onSubscribeMessage() {
  //   const templateIds = this.data.templateIds
  //   wx.requestSubscribeMessage({
  //     tmplIds: templateIds,
  //     success: (res) => {
  //       const accepted = templateIds.filter(id => res[id] === 'accept')
  //       if (accepted.length > 0) {
  //         this.setData({ subscribed: true })
  //         wx.showToast({ title: '订阅成功', icon: 'success' })
  //       } else {
  //         wx.showToast({ title: '已取消订阅', icon: 'none' })
  //       }
  //     },
  //     fail: () => {
  //       wx.showToast({ title: '授权失败，请重试', icon: 'none' })
  //     },
  //   })
  // },

  // confirmRebind() {
  //   // TODO: 调用云函数换绑手机号
  //   wx.showToast({ title: '换绑申请已提交', icon: 'success' })
  //   this.setData({ showRebind: false })
  // },

  // ─── 页面跳转 ────────────────────────────────────────────────

  goEmployee() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  // 食堂工作台：跳转食堂管理分包
  goKitchenWorkbench() {
    wx.redirectTo({ url: '/subpackages/kitchen/pages/today/index' })
  },

  // 管理员工作台（部门管理员/系统管理员）
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
    }).catch(() => {})
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
  },
})
