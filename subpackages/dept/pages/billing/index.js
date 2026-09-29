// subpackages/dept/pages/billing/index.js — 部门工作台 · 收费管理
const { KitchenAPI } = require('../../../../services/api')

function curMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

Page({
  data: {
    depts: [],
    currentDeptIndex: 0,
    selectedMonth: '',
    monthPickerEnd: '',  // 月份选择器的可选上限（当前月，禁选未来）
    billingLoading: false,
    billingList: [],
    totalAmount: 0,
    hasQueried: false,
    hasPermission: true, 
  },

  async onShow() {
    wx.hideHomeButton()
    const depts = await this._loadDepts()
    const hasPermission = depts.length > 0
    const idx = this._defaultDeptIndex(depts)
    const month = curMonth()
    this.setData({
      depts,
      currentDeptIndex: idx,
      selectedMonth: month,
      monthPickerEnd: month,
      billingList: [],
      totalAmount: 0,
      hasQueried: false,
      hasPermission,
    })
    if (hasPermission) this._loadBilling(false)
  },

  async _loadDepts() {
    try {
      const res = await KitchenAPI.getMyDepts()
      return (((res && res.depts) || []).filter(d => d && d.dept_name))
    } catch (err) {
      console.error('[dept billing] loadDepts error:', err)
      return []
    }
  },

  _defaultDeptIndex(depts) {
    const list = depts || []
    if (!list.length) return 0
    const app = getApp()
    const deptId = ((app && app.globalData && app.globalData.userInfo) || {}).dept_id
    const idx = list.findIndex(d => Number(d.dept_id) === Number(deptId))
    return idx > -1 ? idx : 0
  },

  // 切换部门：作废旧账单并按新部门自动重查
  onDeptChange(e) {
    const index = Number(e.detail.value) || 0
    this.setData({
      currentDeptIndex: index,
      billingList: [],
      totalAmount: 0,
      hasQueried: false,
    }, () => this._loadBilling(false))
  },

  // 切换月份：仅更新条件，不自动重查
  onMonthChange(e) {
    this.setData({ selectedMonth: e.detail.value })
  },

  // 手动查询：校验通过后走统一请求
  onQuery() {
    const { selectedMonth, monthPickerEnd, depts, currentDeptIndex } = this.data
    if (!selectedMonth) {
      wx.showToast({ title: '请选择月份', icon: 'none' })
      return
    }
    // 兜底：禁查未来月份（正常由 picker end 限制，此处防极端情况）
    if (monthPickerEnd && selectedMonth > monthPickerEnd) {
      wx.showToast({ title: '不能查询未来月份', icon: 'none' })
      return
    }
    const dept = depts && depts.length > 0 ? depts[currentDeptIndex] : null
    if (!dept) {
      wx.showToast({ title: '暂无可查询的部门', icon: 'none' })
      return
    }
    this._loadBilling(false)
  },

  // ── 下拉刷新：重新拉取部门列表，再按当前部门 + 月份重查 ──
  async onPullDownRefresh() {
    const depts = await this._loadDepts()
    const hasPermission = depts.length > 0
    const curIdx = Number(this.data.currentDeptIndex) || 0
    const idx = curIdx < depts.length ? curIdx : this._defaultDeptIndex(depts)
    this.setData({ depts, currentDeptIndex: idx, hasPermission })
    if (!hasPermission) {
      wx.stopPullDownRefresh()
      return
    }
    await this._loadBilling(true)
    wx.stopPullDownRefresh()
  },

  // 加载收费账单
  _loadBilling(silent) {
    if (!this.data.hasPermission) return
    const { selectedMonth, monthPickerEnd, depts, currentDeptIndex } = this.data
    if (!selectedMonth) return
    // 兜底：禁查未来月份（正常由 picker end 限制，此处防极端情况）
    if (monthPickerEnd && selectedMonth > monthPickerEnd) return
    const dept = depts && depts.length > 0 ? depts[currentDeptIndex] : null
    if (!dept) return

    if (!silent) this.setData({ billingLoading: true })

    // 返回 Promise，便于下拉刷新 await 到请求真正结束再收起原生指示器
    return KitchenAPI.getMonthBilling({ month: selectedMonth, deptId: dept.dept_id })
      .then(res => {
        const billingList = (res && res.list) || []
        const totalAmount = (res && res.totalAmount) || 0
        this.setData({
          billingList,
          totalAmount,
          hasQueried: true,
          billingLoading: false,
        })
      })
      .catch(err => {
        console.error('[dept billing] query error:', err)
        if (silent) {
          // 静默刷新失败：保留已展示的缓存结果，仅记录日志
          this.setData({ billingLoading: false })
          return
        }
        // 主动查询失败：清空结果并提示用户重试
        this.setData({
          billingList: [],
          totalAmount: 0,
          hasQueried: true,
          billingLoading: false,
        })
        wx.showToast({ title: (err && err.message) || '查询失败，请重试', icon: 'none' })
      })
  },

  onExportBilling() {
    if (!this.data.hasPermission) {
      wx.showToast({ title: '当前账号暂无管理任何部门', icon: 'none' })
      return
    }
    const { selectedMonth, depts, currentDeptIndex, billingList } = this.data
    if (!billingList || billingList.length === 0) {
      wx.showToast({ title: '暂无数据可导出', icon: 'none' })
      return
    }
    if (!selectedMonth) {
      wx.showToast({ title: '请选择月份', icon: 'none' })
      return
    }
    const dept = depts && depts.length > 0 ? depts[currentDeptIndex] : null
    const deptName = dept ? dept.dept_name : ''

    // 表名下方日期 = 导出时间（取客户端本地时间，规避云函数时区差异）
    const now = new Date()
    const pad = n => (n < 10 ? '0' + n : n)
    const exportTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

    wx.showLoading({ title: '正在生成报表…', mask: true })
    KitchenAPI.exportMonthBilling({
      month: selectedMonth,
      deptId: dept ? dept.dept_id : 0,
      deptName,
      exportTime,
    }).then(res => {
      const { filename, content } = res || {}
      if (!filename || !content) {
        wx.hideLoading()
        wx.showToast({ title: '暂无数据可导出', icon: 'none' })
        return
      }
      const baseName = filename.replace(/\.xlsx$/, '')
      const fs = wx.getFileSystemManager()

      // 清理历史导出文件，避免 USER_DATA_PATH 容量超限（writeFile:fail storage limit）
      try {
        fs.readdirSync(wx.env.USER_DATA_PATH)
          .filter(n => /\.xlsx$/i.test(n))
          .forEach(n => {
            try {
              if (fs.statSync(`${wx.env.USER_DATA_PATH}/${n}`).isDirectory()) return
              fs.unlinkSync(`${wx.env.USER_DATA_PATH}/${n}`)
            } catch (e) { }
          })
      } catch (e) { }

      const filePath = `${wx.env.USER_DATA_PATH}/${baseName}.xlsx`

      fs.writeFile({
        filePath,
        data: wx.base64ToArrayBuffer(content),
        success: () => {
          wx.hideLoading()
          wx.openDocument({
            filePath,
            fileType: 'xlsx',
            showMenu: true,
            success: () => console.log('[billing export] open success'),
            fail: err => {
              console.error('[billing export] open fail:', err)
              wx.showToast({ title: '打开文件失败', icon: 'none' })
            },
          })
        },
        fail: err => {
          wx.hideLoading()
          console.error('[billing export] write fail:', err)
          wx.showToast({ title: '生成文件失败', icon: 'none' })
        },
      })
    }).catch(err => {
      wx.hideLoading()
      console.error('[billing export] fail:', err)
      wx.showToast({ title: (err && err.message) || '导出失败', icon: 'none' })
    })
  },
})
