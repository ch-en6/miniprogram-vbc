// pages/record/index.js — 报餐记录页（云开发模式）
const T = require('../../utils/time')
const { MAX_RANGE_DAYS } = require('../../utils/const')
const { MealOrderAPI } = require('../../services/api')

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
    verifiedQty: 0,      // 区间已核销份数
    unverifiedQty: 0,    // 区间未核销份数
    activeQuickRange: '', // '' | 'thisMonth' | 'thisWeek' | 'lastWeek' | 'lastMonth'

    // 筛选条件
    startDate: '',
    endDate: '',
    pickerStart: '2026-06-01',  // 结束日期选择器的可选下限
    pickerEnd: '2030-12-31',    // 开始日期选择器的可选上限
    mealFilter: '',    // '' | 'breakfast' | 'lunch' | 'dinner'
  },

  onLoad() {
    this._setDefaultDateRange()
    this._loadRecords()
  },

  onShow() {
    this._loadRecords()
  },

  /**
   * 计算餐费（阶梯计费：第1份员工价，超出部分家属价）
   * 价格直接从 meal_order 行快照中读取，不再使用缓存或配置。
   * @param {object} r - 包含 qty/emp_price/family_price 的记录
   * @returns {number} 总费用
   */
  _calculateMealAmount(r) {
    if (!r || !r.qty || r.qty <= 0) return 0

    const empPrice = Number(r.emp_price) || 0
    const familyPrice = Number(r.family_price) || 0

    // 阶梯计费：第1份员工价，超出部分家属价
    if (r.qty === 1) {
      return empPrice
    } else {
      return empPrice + (r.qty - 1) * familyPrice
    }
  },

  // 设置默认日期范围（本月）
  _setDefaultDateRange() {
    this._applyDateRange(this._getThisMonthRange(), 'thisMonth')
  },

  // 统一应用日期范围，并同步 picker 的起止限制
  _applyDateRange(range, quickType = '') {
    this.setData({
      startDate: range.start,
      endDate: range.end,
      activeQuickRange: quickType,
      pickerStart: range.start,
      pickerEnd: range.end,
    })
  },

  // ─── 快捷日期范围 ────────────────────────────────────────────

  _getThisMonthRange() {
    return T.getMonthRange(T.formatMonth(new Date()))
  },

  _getThisWeekRange() {
    return T.getWeekRange()
  },

  _getLastWeekRange() {
    return T.getWeekRange(new Date(), -1)
  },

  _getLastMonthRange() {
    return T.getMonthRange(T.prevMonth(T.formatMonth(new Date())))
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
      case 'lastMonth':
        range = this._getLastMonthRange()
        break
      default:
        return
    }
    this._applyDateRange(range, type)
    this._loadRecords()
  },

  // ─── 日期选择 ────────────────────────────────────────────────

  onStartDateChange(e) {
    const startDate = e.detail.value
    // 防呆：若开始日期晚于结束日期，结束日期自动跟随
    const endDate = this.data.endDate && startDate > this.data.endDate
      ? startDate
      : this.data.endDate
    this.setData({
      startDate,
      endDate,
      activeQuickRange: '',
      pickerStart: startDate,
      pickerEnd: endDate || '2035-12-31',
    })
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
      activeQuickRange: '',
      pickerStart: startDate || '2026-06-01',
      pickerEnd: endDate,
    })
  },

  // 餐别筛选
  onMealFilter(e) {
    const meal = e.currentTarget.dataset.meal
    this.setData({ mealFilter: meal })
    this._loadRecords()
  },

  // 查询按钮
  onSearch() {
    if (!this._validateRange()) return
    this._loadRecords()
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

  // 重置筛选
  onReset() {
    this._setDefaultDateRange()
    this.setData({ mealFilter: '' })
    this._loadRecords()
  },

  // ─── 加载记录（云函数） ────────────────────────────────────────────────

  async _loadRecords() {
    this.setData({ loading: true })

    try {
      const rawData = (await MealOrderAPI.getRange({
        startDate: this.data.startDate,
        endDate: this.data.endDate,
      })) || []

      // 1. 过滤 qty > 0 的记录 + 餐别筛选；价格随每行快照携带
      let records = []
      rawData.forEach(r => {
        const meals = [
          { mealType: 'breakfast', qty: r.breakfast || 0, emp_price: r.breakfast_emp_price || 0, family_price: r.breakfast_family_price || 0,
            verified: r.breakfast_verified || 0, verified_at: r.breakfast_verified_at || '', verified_by: r.breakfast_verified_by || '' },
          { mealType: 'lunch',     qty: r.lunch || 0,     emp_price: r.lunch_emp_price || 0,     family_price: r.lunch_family_price || 0,
            verified: r.lunch_verified || 0,     verified_at: r.lunch_verified_at || '',     verified_by: r.lunch_verified_by || '' },
          { mealType: 'dinner',    qty: r.dinner || 0,    emp_price: r.dinner_emp_price || 0,    family_price: r.dinner_family_price || 0,
            verified: r.dinner_verified || 0,    verified_at: r.dinner_verified_at || '',    verified_by: r.dinner_verified_by || '' },
        ]
        meals.forEach(m => {
          if (m.qty > 0) {
            if (!this.data.mealFilter || m.mealType === this.data.mealFilter) {
              records.push({
                date: r.date,
                mealType: m.mealType,
                qty: m.qty,
                emp_price: m.emp_price,
                family_price: m.family_price,
                time: r.submitted_at || '',
                verified: m.verified,
                verified_at: m.verified_at,
                verified_by: m.verified_by,
              })
            }
          }
        })
      })

      // 2. 按日期合并（同一天早午晚餐合成一条）
      const grouped = {}
      records.forEach(r => {
        if (!grouped[r.date]) {
          grouped[r.date] = {
            date: r.date,
            dateDisplay: r.date.slice(5),
            weekDay: T.getWeekDay(r.date),
            meals: {},
            dayTotalQty: 0,
            dayTotalAmount: 0,
            lastTime: '',
          }
        }
        const day = grouped[r.date]
        const amount = this._calculateMealAmount(r)

        day.meals[r.mealType] = {
          qty: r.qty,
          amount,
          verified: r.verified || 0,
          verifiedAt: this._formatTime(r.verified_at),
          verifiedBy: r.verified_by || '',
        }
        day.dayTotalQty += r.qty
        day.dayTotalAmount += amount

        // 格式化时间
        const timeStr = this._formatTime(r.time)
        if (timeStr > day.lastTime) day.lastTime = timeStr
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
      let verifiedQty = 0
      records.forEach(r => {
        const amount = this._calculateMealAmount(r)
        const m = mealSummary[r.mealType]
        if (m) {
          m.qty += r.qty
          m.amount += amount
        }
        totalQty += r.qty
        totalAmount += amount
        if (r.verified) verifiedQty += r.qty
      })
      const unverifiedQty = totalQty - verifiedQty

      this.setData({
        records: mergedRecords,
        mealSummary,
        totalQty,
        totalAmount,
        verifiedQty,
        unverifiedQty,
        loading: false,
      })
    } catch (err) {
      console.error('[Record] 加载记录失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
    }
  },

  // 格式化时间（云数据库返回的 Date 对象或字符串）
  _formatTime(timeVal) {
    if (!timeVal) return ''
    
    let date
    
    // 处理云数据库返回的不同格式
    if (typeof timeVal === 'string') {
      // 字符串格式："2026-07-13T16:07:56.000Z" 或 "Mon Jul 13 2026 16:07:56 GMT+0800"
      date = new Date(timeVal)
    } else if (timeVal.$date) {
      // MongoDB 日期格式：{ $date: timestamp }
      date = new Date(timeVal.$date)
    } else if (timeVal instanceof Date) {
      // Date 对象
      date = timeVal
    } else {
      // 其他情况尝试转换
      date = new Date(timeVal)
    }
    
    // 验证日期是否有效
    if (isNaN(date.getTime())) {
      console.warn('[Record] 无效的时间格式:', timeVal)
      return ''
    }
    
    // 使用 utils/time 中的 formatDateTime 方法
    return T.formatDateTime(date)
  },

  // 获取餐别标签
  _getMealLabel(meal) {
    const map = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }
    return map[meal] || meal
  },
})
