// subpackages/dept/pages/stats/index.js — 部门工作台 · 统计查询
// 部门列表 / 筛选条件 / 最近结果存于 utils/dept-store，跨页切换不丢
const { MAX_RANGE_DAYS } = require('../../../../utils/const')
const T = require('../../../../utils/time')
const { KitchenAPI } = require('../../../../services/api')
const store = require('../../../../utils/dept-store')
const { state } = store

Page({
  data: {
    depts: [],
    currentDeptIndex: 0,
    startDate: '',
    endDate: '',
    quickType: '',    // 快捷范围：'' / curMonth / prevMonth / curWeek / prevWeek
    pickerStart: '',  // 结束日期选择器的可选下限
    pickerEnd: '',    // 开始日期选择器的可选上限
    statList: [],
    statLoading: false,
    hasQueried: false,
    hasPermission: true, 
  },

  async onShow() {
    wx.hideHomeButton()
    store.ensureStatsDefault()
    await store.ensureDepts()
    const s = state.stats
    // 本页记忆过部门则恢复，否则用默认（用户所在部门优先）
    const idx = typeof s.deptIndex === 'number' ? s.deptIndex : store.defaultDeptIndex()
    const depts = state.depts || []
    this.setData({
      depts,
      currentDeptIndex: idx,
      startDate: s.startDate,
      endDate: s.endDate,
      quickType: s.quickType,
      pickerStart: s.pickerStart,
      pickerEnd: s.pickerEnd,
      hasPermission: depts.length > 0,
    })
    this._ensureFreshList()
  },

  // 结果与当前条件一致则先秒显缓存再静默刷新；否则带加载态查询
  _ensureFreshList() {
    if (!this.data.hasPermission) {
      this.setData({ statList: [], statLoading: false, hasQueried: false })
      return
    }
    const s = state.stats
    const key = this._resultKey()
    const cached = s.hasQueried && s.resultKey === key
    if (cached) {
      this.setData({ statList: s.statList, statLoading: false, hasQueried: true })
      this._loadStatList(true)
      return
    }
    this.setData({ statList: [], statLoading: false, hasQueried: s.hasQueried })
    if (this.data.startDate && this.data.endDate) {
      this._loadStatList(false)
    }
  },

  _resultKey() {
    const { depts, currentDeptIndex } = this.data
    const dept = depts && depts[currentDeptIndex]
    return [
      this.data.startDate,
      this.data.endDate,
      dept ? Number(dept.dept_id) : 0,
    ].join('|')
  },

  // 把当前筛选条件同步回 store（供其它页面 / 下次进入恢复）
  _syncConditions() {
    const { startDate, endDate, quickType, pickerStart, pickerEnd } = this.data
    store.setStats({ startDate, endDate, quickType, pickerStart, pickerEnd })
  },

  // ─── 部门 ────────────────────────────────────────────────

  // 切换部门：仅更新统计页自身的记忆并作废旧结果，按新部门重查
  // （不影响员工 / 收费页各自的部门选择）
  onDeptChange(e) {
    const index = Number(e.detail.value) || 0
    store.setStats({ deptIndex: index, statList: [], resultKey: '', hasQueried: false })
    this.setData({
      currentDeptIndex: index,
      statList: [],
      hasQueried: false,
    }, () => this._loadStatList(false))
  },

  // ─── 日期选择（不自动查询，仅更新条件） ──────────────────

  onStartDateChange(e) {
    const startDate = e.detail.value
    // 防呆：若开始日期晚于结束日期，结束日期自动跟随（与 pages/record 一致）
    const endDate = this.data.endDate && startDate > this.data.endDate
      ? startDate
      : this.data.endDate
    this.setData({
      startDate,
      endDate,
      quickType: '',
      pickerStart: startDate,
      pickerEnd: endDate || '2035-12-31',
    }, () => this._syncConditions())
  },

  onEndDateChange(e) {
    const endDate = e.detail.value
    // 防呆：若结束日期早于开始日期，开始日期自动跟随
    const startDate = this.data.startDate && this.data.startDate > endDate
      ? endDate
      : this.data.startDate
    this.setData({
      startDate,
      endDate,
      quickType: '',
      pickerStart: startDate || '2026-06-01',
      pickerEnd: endDate,
    }, () => this._syncConditions())
  },

  // ── 快捷日期范围 ──────────────────────────────

  _applyQuickRange(range, quickType) {
    this.setData({
      startDate: range.start,
      endDate: range.end,
      quickType,
      pickerStart: range.start,
      pickerEnd: range.end,
    }, () => {
      this._syncConditions()
      this._loadStatList(false)
    })
  },

  // 快捷日期范围：单入口按 data-type 分发
  onQuickRange(e) {
    const type = e.currentTarget.dataset.type
    let range
    switch (type) {
      case 'curMonth':
        range = T.getMonthRange(T.formatMonth(new Date()))
        break
      case 'prevMonth':
        range = T.getMonthRange(T.prevMonth(T.formatMonth(new Date())))
        break
      case 'curWeek':
        range = T.getWeekRange()
        break
      case 'prevWeek':
        range = T.getWeekRange(new Date(), -1)
        break
      default:
        return
    }
    this._applyQuickRange(range, type)
  },

  // 校验时间区间：开始 ≤ 结束，且跨度不超过 92 天
  _validateRange() {
    const { startDate, endDate } = this.data
    if (!startDate || !endDate) {
      wx.showToast({ title: '请选择完整的时间区间', icon: 'none' })
      return false
    }
    if (startDate > endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' })
      return false
    }
    const days = Math.round((T.toDate(endDate) - T.toDate(startDate)) / 86400000) + 1
    if (days > MAX_RANGE_DAYS) {
      wx.showToast({ title: '查询区间最多支持一季度', icon: 'none' })
      return false
    }
    return true
  },

  onSearch() {
    if (!this._validateRange()) return
    this.setData({ quickType: '' }, () => {
      this._syncConditions()
      this._loadStatList(false)
    })
  },

  // ── 下拉刷新：按当前生效条件（部门 + 日期区间）重查 ──
  async onPullDownRefresh() {
    // 强制重拉部门/食堂列表（启用/停用状态可能已被修改）并同步页面
    await store.refreshDepts()
    const depts = state.depts || []
    this.setData({ depts, hasPermission: depts.length > 0 })
    if (!this.data.hasPermission) {
      wx.stopPullDownRefresh()
      return
    }
    await this._loadStatList(true)
    wx.stopPullDownRefresh()
  },

  // 加载统计列表；silent=true 时不展示加载态（用于缓存命中后的静默刷新）
  _loadStatList(silent) {
    if (!this.data.hasPermission) return
    const { startDate, endDate } = this.data
    if (!startDate || !endDate) return
    const { depts, currentDeptIndex } = this.data
    const dept = depts && depts[currentDeptIndex]
    const deptId = dept ? Number(dept.dept_id) : 0

    if (!silent) this.setData({ statLoading: true })

    return KitchenAPI.getStatRange({ startDate, endDate, deptId })
      .then(res => {
        const statList = (res && res.days) || []
        this.setData({ statList, statLoading: false, hasQueried: true })
        store.setStats({ statList, hasQueried: true, resultKey: this._resultKey() })
      })
      .catch(err => {
        this.setData({ statLoading: false, hasQueried: true })
        if (!silent) {
          wx.showToast({ title: (err && err.message) || '统计查询失败', icon: 'none' })
        } else {
          console.warn('[dept stats] silent refresh fail:', err)
        }
      })
  },

  // 点击某一天：跳到报餐明细页
  onItemTap(e) {
    const { date } = e.currentTarget.dataset || {}
    if (!date) return
    wx.navigateTo({
      url: `/subpackages/kitchen/pages/detail/index?date=${date}`,
    })
  },

  onExport() {
    if (!this.data.hasPermission) {
      wx.showToast({ title: '当前账号暂无管理任何部门', icon: 'none' })
      return
    }
    const { startDate, endDate, depts, currentDeptIndex, statList } = this.data
    if (!statList || statList.length === 0) {
      wx.showToast({ title: '暂无数据可导出', icon: 'none' })
      return
    }
    const deptName = (depts && depts.length > 0)
      ? depts[currentDeptIndex].dept_name
      : ''

    wx.showLoading({ title: '正在生成报表...', mask: true })
    KitchenAPI.exportPersonStatRange({
      startDate,
      endDate,
      deptId: depts && depts.length > 0 ? depts[currentDeptIndex].dept_id : 0,
      deptName,
    }).then(res => {
      const { filename, content } = res || {}
      if (!filename || !content) {
        wx.hideLoading()
        wx.showToast({ title: '暂无数据可导出', icon: 'none' })
        return
      }
      const baseName = filename.replace(/\.xlsx$/, '')
      const fs = wx.getFileSystemManager()

      // 生成唯一文件名：已存在时自动加 "- 副本" / "- 副本 (2)" / ...
      const resolveUniquePath = () => {
        let name = `${baseName}.xlsx`
        let path = `${wx.env.USER_DATA_PATH}/${name}`
        let n = 1
        while (true) {
          try {
            fs.accessSync(path)
            n += 1
            const suffix = n === 2 ? ' - 副本' : ` - 副本 (${n - 1})`
            name = `${baseName}${suffix}.xlsx`
            path = `${wx.env.USER_DATA_PATH}/${name}`
          } catch (e) {
            // 文件不存在，可用
            break
          }
        }
        return { fileName: name, filePath: path }
      }
      const { fileName, filePath } = resolveUniquePath()

      fs.writeFile({
        filePath,
        data: wx.base64ToArrayBuffer(content),
        success: () => {
          wx.hideLoading()
          wx.openDocument({
            filePath,
            fileType: 'xlsx',
            showMenu: true,
            success: () => console.log('[export] open success'),
            fail: err => {
              console.error('[export] open fail:', err)
              wx.showToast({ title: '打开文件失败', icon: 'none' })
            }
          })
        },
        fail: err => {
          wx.hideLoading()
          console.error('[export] write fail:', err)
          wx.showToast({ title: '生成文件失败', icon: 'none' })
        }
      })
    }).catch(err => {
      wx.hideLoading()
      console.error('[export] fail:', err)
      wx.showToast({ title: (err && err.message) || '导出失败', icon: 'none' })
    })
  },
})
