// pages/record/index.js — 报餐记录页（完善版）
const M = require('../../utils/mock')
const T = require('../../utils/time')

Page({
  data: {
    records: [],
    loading: false,
    mealSummary: {       // 区间按餐别汇总（份数 + 费用）
      breakfast: { qty: 0, amount: 0 },
      lunch:     { qty: 0, amount: 0 },
      dinner:    { qty: 0, amount: 0 },
    },
    totalQty: 0,         // 区间总份数
    totalAmount: 0,      // 区间总费用
    activeQuickRange: '', // '' | 'thisMonth' | 'thisWeek' | 'lastWeek'

    // 筛选条件
    startDate: '',
    endDate: '',
    mealFilter: '',    // '' | 'breakfast' | 'lunch' | 'dinner'
  },

  onLoad() {
    // 默认显示本月数据
    this._setDefaultDateRange()
    this._loadRecords()
  },

  onShow() {
    this._loadRecords()
  },

  // 设置默认日期范围（本月）
  _setDefaultDateRange() {
    const range = this._getThisMonthRange()
    this.setData({
      startDate: range.start,
      endDate: range.end,
      activeQuickRange: 'thisMonth',
    })
  },

  // ─── 快捷日期范围 ────────────────────────────────────────────

  _getThisMonthRange() {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    return {
      start: `${year}-${String(month).padStart(2, '0')}-01`,
      end: `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`,
    }
  },

  _getThisWeekRange() {
    const now = new Date()
    const day = now.getDay() || 7 // 周日 = 0 → 7
    const monday = new Date(now)
    monday.setDate(now.getDate() - day + 1)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { start: T.formatDate(monday), end: T.formatDate(sunday) }
  },

  _getLastWeekRange() {
    const thisWeek = this._getThisWeekRange()
    const monday = T.toDate(thisWeek.start)
    monday.setDate(monday.getDate() - 7)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { start: T.formatDate(monday), end: T.formatDate(sunday) }
  },

  onQuickRange(e) {
    const type = e.currentTarget.dataset.type
    let range
    switch (type) {
      case 'thisMonth':
        range = this._getThisMonthRange()
        break
      case 'thisWeek':
        range = this._getThisWeekRange()
        break
      case 'lastWeek':
        range = this._getLastWeekRange()
        break
      default:
        return
    }
    // 只修改日期范围，不自动查询
    this.setData({
      startDate: range.start,
      endDate: range.end,
      activeQuickRange: type,
    })
  },

  // ─── 日期选择 ────────────────────────────────────────────────

  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value, activeQuickRange: '' })
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value, activeQuickRange: '' })
  },

  // 餐别筛选 — 只修改筛选条件，不自动查询
  onMealFilter(e) {
    const meal = e.currentTarget.dataset.meal
    this.setData({ mealFilter: meal })
  },

  // 查询按钮
  onSearch() {
    this._loadRecords()
  },

  // ─── 加载记录 ────────────────────────────────────────────────

  _loadRecords() {
    const app = getApp()
    if (app.globalData.devMock) {
      // 1. 过滤 + 餐别筛选
      let records = M.mockRecords
        .filter(r => r.qty > 0)

      if (this.data.mealFilter) {
        records = records.filter(r => r.mealType === this.data.mealFilter)
      }
      if (this.data.startDate) {
        records = records.filter(r => r.date >= this.data.startDate)
      }
      if (this.data.endDate) {
        records = records.filter(r => r.date <= this.data.endDate)
      }

      // 2. 按日期合并（同一天早午晚餐合成一条）
      const grouped = {}
      records.forEach(r => {
        if (!grouped[r.date]) {
          grouped[r.date] = {
            date: r.date,
            dateDisplay: r.date.slice(5),
            meals: {},
            dayTotalQty: 0,
            dayTotalAmount: 0,
            dayTotalEmpAmount: 0,
            dayTotalFamAmount: 0,
            lastTime: r.time,
          }
        }
        const day = grouped[r.date]
        const empQty = Math.max(r.qty - r.family, 0)
        day.meals[r.mealType] = {
          qty: r.qty,
          empQty,
          family: r.family,
          empAmount: r.empAmount,
          famAmount: r.famAmount,
          amount: r.amount,
          time: r.time,
        }
        day.dayTotalQty += r.qty
        day.dayTotalAmount += r.amount
        day.dayTotalEmpAmount += r.empAmount
        day.dayTotalFamAmount += r.famAmount
        if (r.time > day.lastTime) day.lastTime = r.time
      })

      const mergedRecords = Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date))

      // 3. 计算区间按餐别汇总（用于顶部卡片）
      const mealSummary = {
        breakfast: { qty: 0, amount: 0 },
        lunch:     { qty: 0, amount: 0 },
        dinner:    { qty: 0, amount: 0 },
      }
      let totalQty = 0
      let totalAmount = 0
      records.forEach(r => {
        const m = mealSummary[r.mealType]
        if (m) {
          m.qty += r.qty
          m.amount += r.amount
        }
        totalQty += r.qty
        totalAmount += r.amount
      })

      this.setData({
        records: mergedRecords,
        mealSummary,
        totalQty,
        totalAmount,
      })
      return
    }
    // TODO: 接入真实 API — GET /meals/records?start=xxx&end=xxx
    // 后端仅返回 qty > 0 的记录，含费用字段；前端按 date 合并
  },

  // 获取餐别标签
  _getMealLabel(meal) {
    const map = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }
    return map[meal] || meal
  },
})
