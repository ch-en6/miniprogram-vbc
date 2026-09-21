// pages/book/index.js — 月历报餐页（对齐原型 EmployeeBook）
const { formatMonth, getWeekDay, isBookable, formatDate, compareDate } = require('../../utils/time')
const { isPriceConfigValid, setCache, getPriceCacheKey } = require('../../utils/cache')
const { MealOrderAPI, PriceConfigAPI } = require('../../services/api')

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAYS_SHORT = ['日', '一', '二', '三', '四', '五', '六']

Page({
  data: {
    monthText: '',
    calendarDays: [],
    selectedDay: null,
    meals: [
      { key: 'breakfast', label: '早餐'},
      { key: 'lunch', label: '午餐'},
      { key: 'dinner', label: '晚餐'},
    ],
    // 价格配置（从云数据库读取）
    priceConfig: null,
    // 当前食堂是否启用
    locationEnabled: true,
  },

  onLoad() {
    this._currentDate = new Date()
    this._loadPriceConfig()
    this._loadLocationStatus()
    this._buildCalendar()
  },

  async onShow() {
    await this._loadLocationStatus()
    await this._buildCalendar()
  },

  /**
   * 加载当前食堂启用状态：食堂停用（status = 0）时禁止报餐
   * @returns {Promise<boolean>} 当前食堂是否可报餐
   */
  async _loadLocationStatus() {
    try {
      const res = (await MealOrderAPI.getLocationStatus()) || {}
      const locationEnabled = res.enabled !== false
      this.setData({ locationEnabled })
      return locationEnabled
    } catch (err) {
      // 查询失败不阻断报餐（云函数 save 会二次兜底拦截），维持上一次的判定结果
      console.error('[Book] 加载食堂状态失败:', err)
      return this.data.locationEnabled
    }
  },

  /**
   * 加载价格配置：优先从 app 缓存读取，缓存没有再请求云函数
   * @param {{silent?: boolean}} [opts] - silent=true 时失败不弹 toast（提交前静默重试用）
   * @returns {Promise<boolean>} 是否成功拿到价格配置
   */
  async _loadPriceConfig({ silent = false } = {}) {
    try {
      const app = getApp()
      const userInfo = app.globalData.userInfo || {}
      const dept_id = userInfo.dept_id
      
      if (!dept_id) {
        console.warn('[Book] 用户没有部门ID，无法加载价格配置')
        if (!silent) wx.showToast({ title: '未找到部门信息', icon: 'none' })
        return false
      }

      // 优先从 app 全局缓存读取（校验有效期，避免跨天/改价后仍用旧价格）
      if (app.globalData.priceConfig && isPriceConfigValid(app.globalData.priceConfig)) {
        this.setData({ priceConfig: app.globalData.priceConfig })
        console.log('[Book] 价格配置从缓存加载:', app.globalData.priceConfig)
        return true
      }

      // 缓存没有，请求云函数（业务失败会 reject，由 catch 兜底提示）
      const priceConfig = await PriceConfigAPI.getConfig(dept_id)
      app.globalData.priceConfig = priceConfig
      setCache(getPriceCacheKey(dept_id), priceConfig)
      this.setData({ priceConfig })
      console.log('[Book] 价格配置加载成功:', priceConfig)
      return true
    } catch (err) {
      console.error('[Book] 加载价格配置失败:', err)
      if (!silent) wx.showToast({ title: err.message || '加载价格配置失败', icon: 'none' })
      return false
    }
  },


  // ─── 月历构建 ────────────────────────────────────────────────

  async _buildCalendar() {
    const date = this._currentDate
    const year = date.getFullYear()
    const month = date.getMonth()
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
    this.setData({ monthText: `${year}年${month + 1}月` })

    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startWeekday = firstDay.getDay()
    const totalDays = lastDay.getDate()

    const today = new Date()
    const todayStr = formatDate(today)

    // 从云数据库加载当月报餐记录
    let monthOrders = {}
    try {
      const orders = (await MealOrderAPI.getMonth({ month: monthStr })) || []
      orders.forEach(item => {
        monthOrders[item.date] = {
          breakfast: item.breakfast || 0,
          lunch: item.lunch || 0,
          dinner: item.dinner || 0,
        }
      })
    } catch (err) {
      console.error('[Book] 加载报餐记录失败:', err)
    }

    const days = []
    for (let i = 0; i < startWeekday; i++) {
      days.push({ key: 'blank' + i, day: '', disabled: true, blank: true })
    }

    for (let d = 1; d <= totalDays; d++) {
      const dayDate = new Date(year, month, d)
      const dateStr = formatDate(dayDate)
      const weekIdx = dayDate.getDay()
      const canBook = isBookable(dateStr)
      const isPast = compareDate(dateStr, todayStr) < 0

      const mealData = monthOrders[dateStr]
      const hasMeal = !!mealData
      const data = mealData || { breakfast: 0, lunch: 0, dinner: 0 }

      days.push({
        key: 'day' + d,
        day: String(d),
        dateStr,
        week: WEEKDAYS[weekIdx],
        weekShort: WEEKDAYS_SHORT[weekIdx],
        dateText: `${month + 1}月${d}日`,
        active: false,
        hasMeal,
        isPast,
        canModify: canBook,           // 截止时间内可修改（含减为0取消）
        disabled: !canBook && !hasMeal, // 截止后且无报餐 → 不可选；截止后有报餐 → 可选但只读
        locked: !canBook,
        isViewing: hasMeal && !canBook, // 已报餐且已过截止时间 → 仅查看
        breakfast: data.breakfast,
        lunch: data.lunch,
        dinner: data.dinner,
      })
    }

    // 默认选中明天
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = formatDate(tomorrow)
    let selectableDay = days.find(d => d.dateStr === tomorrowStr && !d.disabled)
    if (!selectableDay) {
      selectableDay = days.find(d => !d.blank && !d.disabled && !d.hasMeal)
    }
    if (selectableDay) {
      selectableDay.active = true
      this.setData({ selectedDay: selectableDay })
    }

    this.setData({ calendarDays: days })
  },

  // 计费规则说明
  onShowBillingRule() {
    const Dialog = require('@vant/weapp/dialog/dialog').default
    
    // 构建动态价格信息
    const config = this.data.priceConfig
    let message = '【餐费】\n每餐第 1 份按员工餐标准收费，超过 1 份的部分按家属餐标准收费。\n\n'
    
    if (config) {
      const mealLabel = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }
      ;['breakfast', 'lunch', 'dinner'].forEach(meal => {
        const c = config[meal]
        const label = mealLabel[meal]
        message += c
          ? `${label}：员工 ${c.emp_price} 元，家属 ${c.family_price} 元\n`
          : `${label}：未配置价格\n`
      })
      message += '\n'
    } else {
      message += '未读取到有效的价格配置，请联系管理员配置价格。\n\n'
    }
    
    message += '\n\n将数量减为 0 即取消该餐报餐，截止时间前可修改。'
    
    Dialog.alert({
      title: '计费规则',
      messageAlign: 'left',
      message: message,
      confirmButtonText: '知道了',
    })
  },

  prevMonth() {
    const d = new Date(this._currentDate)
    d.setMonth(d.getMonth() - 1)
    this._currentDate = d
    this._buildCalendar()
  },

  nextMonth() {
    const d = new Date(this._currentDate)
    d.setMonth(d.getMonth() + 1)
    this._currentDate = d
    this._buildCalendar()
  },

  selectDay(e) {
    const index = e.currentTarget.dataset.index
    const day = this.data.calendarDays[index]
    if (!day || day.blank || day.disabled) return

    // 仅当「有报餐 + 已过截止时间」时为只读查看模式
    // 截止时间内有报餐的日期也可修改（含减为 0 取消）
    const isViewing = day.hasMeal && !day.canModify

    const updatedDay = {
      ...day,
      isViewing,
    }

    const days = this.data.calendarDays.map((d, i) => {
      d.active = (i === index)
      return d
    })

    this.setData({
      calendarDays: days,
      selectedDay: updatedDay,
    })
  },

  onStepperChange(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail
    const selectedDay = this.data.selectedDay
    if (selectedDay.isViewing) return
    selectedDay[key] = value
    this.setData({ selectedDay })
  },

  async submitDay() {
    const day = this.data.selectedDay
    if (!day || day.isViewing) return

    const total = day.breakfast + day.lunch + day.dinner

    // 新报餐不允许全 0
    if (total === 0 && !day.hasMeal) {
      wx.showToast({ title: '请至少选择一个餐次', icon: 'none' })
      return
    }

    // 判断操作类型：首次报餐 / 修改 / 取消
    const isCancel = total === 0
    const isModify = day.hasMeal && !isCancel
    const isFirstBook = !day.hasMeal && !isCancel

    // 食堂停用（sys_location.status = 0）时禁止新增/修改报餐；
    // 取消报餐（数量全为 0）仍放行，保证停用后员工可撤销既有报餐。
    if (!isCancel && !this.data.locationEnabled) {
      wx.showToast({ title: '当前食堂已停用，暂不支持报餐', icon: 'none' })
      return
    }

    wx.showLoading({ title: isCancel ? '取消中...' : '保存中...' })

    // 保存/修改报餐涉及计费，必须已读取到有效价格配置，否则不允许写入（取消报餐无需价格，不受影响）
    if (!isCancel && !isPriceConfigValid(this.data.priceConfig)) {
      // 兜底：静默重新拉取一次价格配置（失败时不重复弹 toast，由下方统一提示）
      await this._loadPriceConfig({ silent: true })
      if (!isPriceConfigValid(this.data.priceConfig)) {
        console.error('[Book] 价格配置未就绪，拒绝写入报餐:', day.dateStr)
        wx.hideLoading()
        wx.showToast({ title: '价格配置未就绪，报餐失败，请联系管理员配置价格', icon: 'none' })
        return
      }
    }

    try {
      if (isCancel) {
        // 删除报餐记录（业务失败会 reject，抛给外层 catch 统一处理）
        await MealOrderAPI.remove({ date: day.dateStr })
      } else {
        // 保存/更新报餐记录（员工身份/部门/食堂由云函数按 openid 反查，前端不传 emp_id/dept_id/location_id/_openid）
        await MealOrderAPI.save({
          date: day.dateStr,
          breakfast: day.breakfast,
          lunch: day.lunch,
          dinner: day.dinner,
        })
      }

      // 更新本地日历数据
      const days = this.data.calendarDays.map(d => {
        if (d.dateStr === day.dateStr) {
          return {
            ...d,
            hasMeal: total > 0,
            breakfast: isCancel ? 0 : day.breakfast,
            lunch: isCancel ? 0 : day.lunch,
            dinner: isCancel ? 0 : day.dinner,
          }
        }
        return d
      })

      const updatedDay = days.find(d => d.dateStr === day.dateStr)
      this.setData({ calendarDays: days, selectedDay: updatedDay })
      wx.hideLoading()

      // 操作成功提示
      const msg = isCancel ? '已取消报餐'
               : isFirstBook ? '报餐成功'
               : '修改成功'
      wx.showToast({ title: msg, icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      console.error('[Book] 提交报餐失败:', err)
      // 失败后强制重新拉取当月数据刷新日历，保证界面与数据库真实状态一致。
      // （save 内部可能发生"部分成功"，刷新后用户能看到真实数据再决定是否重试）
      await this._buildCalendar()
      wx.showToast({ title: err.message || '操作失败，请重试', icon: 'none' })
    }
  },
})
