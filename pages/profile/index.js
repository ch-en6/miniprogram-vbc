// pages/profile/index.js — 个人中心
const { ROLE } = require('../../utils/const')
const QR = require('../../utils/qrcode')

Page({
  data: {
    userInfo: {},
    phoneMasked: '',
    deptName: '',
    isDisabled: false, // 员工是否被停用
    showWorkspace: false, // 是否显示工作台
    isKitchen: false,
    isDeptAdmin: false,
    isSysAdmin: false,
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
    // 使用登录时缓存的角色 code 数组
    const roles = app.globalData.roles || []

    // 手机号脱敏
    const phone = userInfo.phone || ''
    const phoneMasked = phone.length >= 11
      ? phone.slice(0, 3) + '****' + phone.slice(-4)
      : phone

    // 员工状态
    const isDisabled = userInfo.status === 'disabled'

    // 判断是否显示工作台（只有部门管理员/系统管理员才显示）
    const showWorkspace = roles.some(r =>
      [ROLE.DEPT_ADMIN, ROLE.SYS_ADMIN].includes(r)
    )

    this.setData({
      userInfo,
      phoneMasked,
      isDisabled,
      showWorkspace,
      isKitchen: roles.includes(ROLE.KITCHEN),
      isDeptAdmin: roles.includes(ROLE.DEPT_ADMIN),
      isSysAdmin: roles.includes(ROLE.SYS_ADMIN),
    })
  },

  /**
   * 加载部门名称：优先从 app 缓存读取，缓存没有再请求云函数
   */
  async _loadDeptName() {
    const app = getApp()
    const userInfo = app.globalData.userInfo || {}
    const dept_id = userInfo.dept_id
    if (!dept_id) return

    // 优先从 app 全局缓存读取
    if (app.globalData.deptName) {
      this.setData({ deptName: app.globalData.deptName })
      return
    }

    // 缓存没有，请求云函数
    try {
      const res = await wx.cloud.callFunction({
        name: 'getDeptName',
        data: { dept_id }
      })
      const result = res.result
      if (result.code === 0 && result.data) {
        const deptName = result.data.dept_name || '—'
        app.globalData.deptName = deptName
        this.setData({ deptName })
      } else {
        this.setData({ deptName: '—' })
      }
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
    if (newPwd.length < 8) {
      wx.showToast({ title: '新密码至少8位', icon: 'none' })
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
      const res = await wx.cloud.callFunction({
        name: 'changePassword',
        data: {
          empId: userInfo._id,
          oldPassword: oldPwd,
          newPassword: newPwd
        }
      })
      const result = res.result
      if (result.code === 0) {
        wx.showToast({ title: '密码修改成功', icon: 'success' })
        this.setData({ showChangePwd: false, oldPwd: '', newPwd: '', confirmPwd: '' })
      } else {
        wx.showToast({ title: result.message || '修改失败', icon: 'none' })
      }
    } catch (err) {
      console.error('[profile] changePassword error:', err)
      wx.showToast({ title: '修改失败，请重试', icon: 'none' })
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

  goWorkbench() {
    const { isSysAdmin, isDeptAdmin, isKitchen } = this.data
    let url = '/subpackages/kitchen/pages/today/index'
    // if (isSysAdmin) {
    //   url = '/subpackages/admin/pages/dept-manage/index'
    // } else if (isDeptAdmin) {
    //   url = '/subpackages/dept/pages/workspace/index'
    // } else if (isKitchen) {
    //   url = '/subpackages/kitchen/pages/today/index'
    // }
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
