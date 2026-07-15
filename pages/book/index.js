// pages/book/index.js — 月历报餐页（对齐原型 EmployeeBook）
const { formatMonth, getWeekDay, isBookable, formatDate, compareDate } = require('../../utils/time')

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
  },

  onLoad() {
    this._currentDate = new Date()
    this._loadPriceConfig()
    this._buildCalendar()
  },

  async onShow() {
    await this._buildCalendar()
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
        console.warn('[Book] 用户没有部门ID，无法加载价格配置')
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
        console.log('[Book] 价格配置加载成功:', res.result.data)
      } else {
        console.error('[Book] 价格配置加载失败:', res.result?.message)
        wx.showToast({ title: res.result?.message || '加载价格失败', icon: 'none' })
      }
    } catch (err) {
      console.error('[Book] 加载价格配置失败:', err)
      wx.showToast({ title: '加载价格配置失败', icon: 'none' })
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
      const app = getApp()
      const userInfo = app.globalData.userInfo || {}
      const res = await wx.cloud.callFunction({
        name: 'mealOrder',
        data: { action: 'getMonth', month: monthStr, emp_id: userInfo._id }
      })
      if (res.result && res.result.code === 0 && res.result.data) {
        res.result.data.forEach(item => {
          monthOrders[item.date] = {
            breakfast: item.breakfast || 0,
            lunch: item.lunch || 0,
            dinner: item.dinner || 0,
          }
        })
      }
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
      message += `早餐：员工 ${config.breakfast?.emp_price || 100} 元，家属 ${config.breakfast?.family_price || 1000} 元\n`
      message += `午餐：员工 ${config.lunch?.emp_price || 1000} 元，家属 ${config.lunch?.family_price || 2000} 元\n`
      message += `晚餐：员工 ${config.dinner?.emp_price || 1000} 元，家属 ${config.dinner?.family_price || 2000} 元\n\n`
    } else {
      message += '早餐：员工 100 元，家属 200 元\n'
      message += '午餐：员工 1000 元，家属 2000 元\n'
      message += '晚餐：员工 1000 元，家属 2000 元\n\n'
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

    wx.showLoading({ title: isCancel ? '取消中...' : '保存中...' })

    try {
      if (isCancel) {
        // 删除报餐记录
        const app = getApp()
        const userInfo = app.globalData.userInfo || {}
        const res = await wx.cloud.callFunction({
          name: 'mealOrder',
          data: { action: 'remove', date: day.dateStr, emp_id: userInfo._id }
        })
        if (res.result && res.result.code !== 0) {
          throw new Error(res.result.message)
        }
      } else {
        // 保存/更新报餐记录
        const app = getApp()
        const userInfo = app.globalData.userInfo || {}
        const res = await wx.cloud.callFunction({
          name: 'mealOrder',
          data: {
            action: 'save',
            date: day.dateStr,
            breakfast: day.breakfast,
            lunch: day.lunch,
            dinner: day.dinner,
            emp_id: userInfo._id,
          }
        })
        if (res.result && res.result.code !== 0) {
          throw new Error(res.result.message)
        }
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
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },
})
