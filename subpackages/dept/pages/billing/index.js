// subpackages/dept/pages/billing/index.js — 月度收费统计页
const M = require('../../../../utils/mock')

Page({
  data: {
    // 部门选择
    departments: [],
    departmentNames: [],
    currentDeptIndex: 0,

    // 月份选择
    selectedMonth: '',

    // 收费明细
    billingList: [],
    totalAmount: 0,
    loading: false,
    hasQueried: false,

    // 快照状态（Phase 3.3）
    isSnapshot: false,
    snapshotTime: '',
    snapshotBy: '',
    snapshotMonth: '',
  },

  onLoad() {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    this.setData({ selectedMonth: `${year}-${month}` })
    this._loadDepartments()
  },

  // 加载部门列表
  _loadDepartments() {
    const app = getApp()
    if (app.globalData.devMock) {
      const departments = M.mockDepartments || [
        { id: 1, name: '研发部' },
        { id: 2, name: '行政部' },
      ]
      const departmentNames = departments.map(d => d.name)
      this.setData({ departments, departmentNames })
      return
    }
    // TODO: 接入真实 API
  },

  // 部门切换
  onDeptChange(e) {
    this.setData({ currentDeptIndex: e.detail.value })
    if (this.data.hasQueried) {
      this._loadBilling()
    }
  },

  // 月份选择
  onMonthChange(e) {
    this.setData({ selectedMonth: e.detail.value })
  },

  // 查询
  onQuery() {
    if (!this.data.selectedMonth) {
      wx.showToast({ title: '请选择月份', icon: 'none' })
      return
    }
    this.setData({ hasQueried: true })
    this._loadBilling()
  },

  // 加载收费明细（Phase 3.1/3.2 正确计算金额）
  _loadBilling() {
    const app = getApp()
    if (app.globalData.devMock) {
      // 根据当前选中部门过滤 mock 数据
      const deptId = this.data.departments[this.data.currentDeptIndex]?.id
      // mock 数据中：研发部 id=1，行政部 id=2
      // 只显示当前部门的数据
      const allData = M.mockBillingList || []
      const deptName = this.data.departmentNames[this.data.currentDeptIndex]
      const billingList = allData.filter(item => {
        // 根据姓名简单判断部门（mock 数据简化）
        if (deptId === 1) return ['张三', '李四'].includes(item.name)
        if (deptId === 2) return ['王五'].includes(item.name)
        return true
      })

      // 计算汇总金额
      const totalAmount = billingList.reduce((sum, item) => sum + item.amount, 0)

      // 快照状态（Phase 3.3）
      const snapshot = M.mockBillingSnapshot || {}

      this.setData({
        billingList,
        totalAmount,
        isSnapshot: !!snapshot.isSnapshot,
        snapshotTime: snapshot.snapshotTime || '',
        snapshotBy: snapshot.snapshotBy || '',
        snapshotMonth: snapshot.snapshotMonth || '',
      })
      return
    }
    // TODO: 接入真实 API
    // 真实场景中，后端根据部门餐价配置计算：
    //   familyQty = max(qty - 1, 0)
    //   empAmount = min(qty, 1) * empPrice
    //   famAmount = familyQty * famPrice
    //   amount = empAmount + famAmount
  },

  // 导出 Excel（Phase 3.5 按固定模板字段）
  onExport() {
    const { selectedMonth, departments, currentDeptIndex, hasQueried } = this.data

    if (!hasQueried) {
      wx.showToast({ title: '请先查询数据', icon: 'none' })
      return
    }

    const departmentId = departments[currentDeptIndex]?.id
    const departmentName = departments[currentDeptIndex]?.name || ''

    const app = getApp()
    if (app.globalData.devMock) {
      wx.showLoading({ title: '导出中...' })
      setTimeout(() => {
        wx.hideLoading()
        wx.showModal({
          title: '导出成功（Mock）',
          content: `月度收费报表已导出\n月份：${selectedMonth}\n部门：${departmentName}\n\n（真实环境中将下载 Excel 文件）`,
          showCancel: false,
        })
      }, 1500)
      return
    }

    // 真实模式：调用导出 API
    wx.showLoading({ title: '导出中...' })

    const { request } = require('../../../../utils/request')
    request({
      url: '/manager/billing/export',
      method: 'POST',
      data: { month: selectedMonth, departmentId },
      responseType: 'arraybuffer',
    }).then((res) => {
      if (res.fileUrl) {
        this._downloadAndOpenFile(res.fileUrl)
        return
      }

      const fs = wx.getFileSystemManager()
      const filePath = `${wx.env.USER_DATA_PATH}/billing_${selectedMonth}_${Date.now()}.xlsx`
      fs.writeFileSync(filePath, res, 'binary')

      wx.hideLoading()
      wx.openDocument({
        filePath,
        showMenu: true,
        success: () => { wx.showToast({ title: '导出成功', icon: 'success' }) },
        fail: () => { wx.showToast({ title: '打开文件失败', icon: 'none' }) },
      })
    }).catch((err) => {
      wx.hideLoading()
      wx.showToast({ title: err.message || '导出失败', icon: 'none' })
    })
  },

  // 下载并打开文件
  _downloadAndOpenFile(fileUrl) {
    wx.downloadFile({
      url: fileUrl,
      success: (res) => {
        wx.hideLoading()
        if (res.statusCode === 200) {
          wx.openDocument({
            filePath: res.tempFilePath,
            showMenu: true,
            success: () => { wx.showToast({ title: '导出成功', icon: 'success' }) },
            fail: () => { wx.showToast({ title: '打开文件失败', icon: 'none' }) },
          })
        } else {
          wx.showToast({ title: '下载失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '下载失败', icon: 'none' })
      },
    })
  },
})
