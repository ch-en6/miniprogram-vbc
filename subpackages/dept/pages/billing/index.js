// subpackages/dept/pages/billing/index.js — 部门工作台 · 收费管理
// 月份 / 最近一次结果经 utils/dept-store 跨页保留
const store = require('../../../../utils/dept-store')
const { state } = store
const { KitchenAPI } = require('../../../../services/api')

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
  },

  async onShow() {
    wx.hideHomeButton()
    store.ensureBillingDefault()
    await store.ensureDepts()
    const b = state.billing
    // 本页记忆过部门则恢复，否则用默认（用户所在部门优先）
    const idx = typeof b.deptIndex === 'number' ? b.deptIndex : store.defaultDeptIndex()
    this.setData({
      depts: state.depts,
      currentDeptIndex: idx,
      selectedMonth: b.selectedMonth,
      monthPickerEnd: b.monthPickerEnd,
    })
    this._ensureFreshResult()
  },

  // 本页当前部门 id（结果缓存 / 恢复时按部门校验）
  _currentDeptId() {
    const { depts, currentDeptIndex } = this.data
    const dept = depts && depts[currentDeptIndex]
    return dept ? Number(dept.dept_id) : 0
  },

  // 进入页面时的结果处理：
  // 结果与当前部门 + 月份一致 → 秒显缓存，再静默刷新保证最新；
  // 不一致（首次进入 / 条件已变）→ 清空旧结果，按当前条件带加载态自动查询一次
  _ensureFreshResult() {
    const b = state.billing
    const restored = b.hasQueried
      && b.queriedMonth === b.selectedMonth
      && b.queriedDeptId === this._currentDeptId()
    if (restored) {
      this.setData({
        billingList: b.billingList,
        totalAmount: b.totalAmount,
        hasQueried: true,
        billingLoading: false,
      })
      this._loadBilling(true)
      return
    }
    this.setData({
      billingList: [],
      totalAmount: 0,
      hasQueried: b.hasQueried,
      billingLoading: false,
    })
    if (this.data.selectedMonth && this.data.depts && this.data.depts.length > 0) {
      this._loadBilling(false)
    }
  },

  // 切换部门：作废旧账单并按新部门自动重查
  onDeptChange(e) {
    const index = Number(e.detail.value) || 0
    store.setBilling({
      deptIndex: index,
      queriedMonth: '',
      queriedDeptId: '',
      billingList: [],
      totalAmount: 0,
      hasQueried: false,
    })
    this.setData({
      currentDeptIndex: index,
      billingList: [],
      totalAmount: 0,
      hasQueried: false,
    }, () => this._loadBilling(false))
  },

  // 切换月份：仅更新条件，不自动重查
  onMonthChange(e) {
    const selectedMonth = e.detail.value
    store.setBilling({ selectedMonth })
    this.setData({ selectedMonth })
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

  // 加载收费账单
  _loadBilling(silent) {
    const { selectedMonth, monthPickerEnd, depts, currentDeptIndex } = this.data
    if (!selectedMonth) return
    // 兜底：禁查未来月份（正常由 picker end 限制，此处防极端情况）
    if (monthPickerEnd && selectedMonth > monthPickerEnd) return
    const dept = depts && depts.length > 0 ? depts[currentDeptIndex] : null
    if (!dept) return

    if (!silent) this.setData({ billingLoading: true })

    KitchenAPI.getMonthBilling({ month: selectedMonth, deptId: dept.dept_id })
      .then(res => {
        const billingList = (res && res.list) || []
        const totalAmount = (res && res.totalAmount) || 0
        store.setBilling({
          selectedMonth,
          queriedMonth: selectedMonth,
          queriedDeptId: Number(dept.dept_id),
          billingList,
          totalAmount,
          hasQueried: true,
        })
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
        store.setBilling({ queriedMonth: '', billingList: [], totalAmount: 0, hasQueried: false })
        wx.showToast({ title: (err && err.message) || '查询失败，请重试', icon: 'none' })
      })
  },

  onExportBilling() {
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
      // 重名时追加副本序号，避免覆盖历史文件
      const baseName = filename.replace(/\.xlsx$/, '')
      const fs = wx.getFileSystemManager()
      const resolveUniquePath = () => {
        let name = `${baseName}.xlsx`
        let path = `${wx.env.USER_DATA_PATH}/${name}`
        let n = 1
        for (;;) {
          try {
            fs.accessSync(path)
            n += 1
            const suffix = n === 2 ? ' - 副本' : ` - 副本 (${n - 1})`
            name = `${baseName}${suffix}.xlsx`
            path = `${wx.env.USER_DATA_PATH}/${name}`
          } catch (e) {
            break
          }
        }
        return { fileName: name, filePath: path }
      }
      const { filePath } = resolveUniquePath()

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
