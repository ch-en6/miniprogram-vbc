// pages/record/index.js — 报餐记录页（云开发模式）
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
    activeQuickRange: '', // '' | 'thisMonth' | 'thisWeek' | 'lastWeek' | 'lastMonth'

    // 筛选条件
    startDate: '',
    endDate: '',
    mealFilter: '',    // '' | 'breakfast' | 'lunch' | 'dinner'

    // 价格配置（从云数据库读取）
    priceConfig: null,
  },

  onLoad() {
    this._setDefaultDateRange()
    this._loadPriceConfig()
    this._loadRecords()
  },

  onShow() {
    this._loadRecords()
  },

  /**
   * 从云数据库加载价格配置
   */
  async _loadPriceConfig() {
    try {
      // 获取当前用户的部门ID
      const app = getApp()
      const userInfo = app.globalData.userInfo || {}
      const dept_id = userInfo.dept_id
      
      if (!dept_id) {
        console.warn('[Record] 用户没有部门ID，无法加载价格配置')
        wx.showToast({ title: '未找到部门信息', icon: 'none' })
        return
      }
      
      const res = await wx.cloud.callFunction({
        name: 'mealOrder',
        data: {
          action: 'getPriceConfig',
          dept_id: dept_id
        }
      })

      if (res.result && res.result.code === 0 && res.result.data) {
        this.setData({
          priceConfig: res.result.data
        })
        console.log('[Record] 价格配置加载成功:', res.result.data)
      } else {
        console.error('[Record] 价格配置加载失败:', res.result?.message)
        wx.showToast({ title: res.result?.message || '加载价格失败', icon: 'none' })
      }
    } catch (err) {
      console.error('[Record] 加载价格配置失败:', err)
      wx.showToast({ title: '加载价格配置失败', icon: 'none' })
    }
  },

  /**
   * 计算餐费（阶梯计费：第1份员工价，超出部分家属价）
   * @param {string} mealType - 'breakfast' | 'lunch' | 'dinner'
   * @param {number} qty - 报餐数量
   * @returns {number} 总费用
   */
  _calculateMealAmount(mealType, qty) {
    if (!qty || qty <= 0) return 0
    
    const config = this.data.priceConfig
    if (!config || !config[mealType]) {
      // 如果配置未加载，返回默认值
      const defaultPrices = {
        breakfast: { emp_price: 100, family_price: 1000 },
        lunch: { emp_price: 200, family_price: 2000 },
        dinner: { emp_price: 200, family_price: 2000 }
      }
      const prices = defaultPrices[mealType] || { emp_price: 0, family_price: 0 }
      
      // 阶梯计费：第1份员工价，超出部分家属价
      if (qty === 1) {
        return prices.emp_price
      } else {
        return prices.emp_price + (qty - 1) * prices.family_price
      }
    }
    
    const empPrice = config[mealType].emp_price || 0
    const familyPrice = config[mealType].family_price || 0
    
    // 阶梯计费：第1份员工价，超出部分家属价
    if (qty === 1) {
      return empPrice
    } else {
      return empPrice + (qty - 1) * familyPrice
    }
  },

  /**
   * 获取指定餐次的员工价格
   * @param {string} mealType - 'breakfast' | 'lunch' | 'dinner'
   * @returns {number} 员工价格
   */
  _getMealPrice(mealType) {
    const config = this.data.priceConfig
    if (!config || !config[mealType]) {
      // 如果配置未加载，返回默认值
      const defaultPrices = {
        breakfast: 100,
        lunch: 200,
        dinner: 200
      }
      return defaultPrices[mealType] || 0
    }
    return config[mealType].emp_price || 0
  },

  /**
   * 获取指定餐次的家属价格
   * @param {string} mealType - 'breakfast' | 'lunch' | 'dinner'
   * @returns {number} 家属价格
   */
  _getFamilyMealPrice(mealType) {
    const config = this.data.priceConfig
    if (!config || !config[mealType]) {
      // 如果配置未加载，返回默认值
      const defaultPrices = {
        breakfast: 1000,
        lunch: 2000,
        dinner: 2000
      }
      return defaultPrices[mealType] || 0
    }
    return config[mealType].family_price || 0
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

  _getLastMonthRange() {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() // 0-based, so this is "last month" when -1
    const lastMonth = new Date(year, month - 1, 1)
    const lastMonthEnd = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0)
    return {
      start: T.formatDate(lastMonth),
      end: T.formatDate(lastMonthEnd),
    }
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
    this.setData({
      startDate: range.start,
      endDate: range.end,
      activeQuickRange: type,
    })
    this._loadRecords()
  },

  // ─── 日期选择 ────────────────────────────────────────────────

  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value, activeQuickRange: '' })
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value, activeQuickRange: '' })
  },

  // 餐别筛选
  onMealFilter(e) {
    const meal = e.currentTarget.dataset.meal
    this.setData({ mealFilter: meal })
    this._loadRecords()
  },

  // 查询按钮
  onSearch() {
    this._loadRecords()
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
      const app = getApp()
      const userInfo = app.globalData.userInfo || {}
      const res = await wx.cloud.callFunction({
        name: 'mealOrder',
        data: {
          action: 'getRange',
          startDate: this.data.startDate,
          endDate: this.data.endDate,
          emp_id: userInfo._id,
        }
      })

      if (res.result && res.result.code === 0 && res.result.data) {
        const rawData = res.result.data

        // 1. 过滤 qty > 0 的记录 + 餐别筛选
        let records = []
        rawData.forEach(r => {
          const meals = [
            { mealType: 'breakfast', qty: r.breakfast || 0 },
            { mealType: 'lunch',     qty: r.lunch || 0 },
            { mealType: 'dinner',    qty: r.dinner || 0 },
          ]
          meals.forEach(m => {
            if (m.qty > 0) {
              if (!this.data.mealFilter || m.mealType === this.data.mealFilter) {
                records.push({
                  date: r.date,
                  mealType: m.mealType,
                  qty: m.qty,
                  time: r.updated_at || r.created_at || '',
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
          const amount = this._calculateMealAmount(r.mealType, r.qty)

          day.meals[r.mealType] = {
            qty: r.qty,
            amount,
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
        records.forEach(r => {
          const amount = this._calculateMealAmount(r.mealType, r.qty)
          const m = mealSummary[r.mealType]
          if (m) {
            m.qty += r.qty
            m.amount += amount
          }
          totalQty += r.qty
          totalAmount += amount
        })

        this.setData({
          records: mergedRecords,
          mealSummary,
          totalQty,
          totalAmount,
          loading: false,
        })
      } else {
        this.setData({ loading: false })
        wx.showToast({ title: res.result?.message || '查询失败', icon: 'none' })
      }
    } catch (err) {
      console.error('[Record] 加载记录失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
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
