// pages/book/index.js — 月历报餐页（对齐原型 EmployeeBook）
const { formatMonth, getWeekDay, isBookable, formatDate, compareDate } = require('../../utils/time')
const M = require('../../utils/mock')

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAYS_SHORT = ['日', '一', '二', '三', '四', '五', '六']

// Mock 已报餐数据：dateStr → { breakfast, lunch, dinner }
const MOCK_MEALS = {
  '2026-06-15': { breakfast: 1, lunch: 2, dinner: 1 },
  '2026-06-16': { breakfast: 1, lunch: 1, dinner: 0 },
  '2026-06-17': { breakfast: 0, lunch: 2, dinner: 1 },
  '2026-06-18': { breakfast: 1, lunch: 2, dinner: 1 },
  '2026-06-19': { breakfast: 1, lunch: 1, dinner: 1 },
  '2026-06-22': { breakfast: 1, lunch: 2, dinner: 1 },
  '2026-06-23': { breakfast: 1, lunch: 1, dinner: 0 },
  '2026-06-25': { breakfast: 1, lunch: 2, dinner: 1 },
}

Page({
  data: {
    monthText: '',
    calendarDays: [],
    selectedDay: null,
    meals: [
      { key: 'breakfast', label: '早餐', tip: '默认 1 份' },
      { key: 'lunch', label: '午餐', tip: '超过 1 份计家属餐' },
      { key: 'dinner', label: '晚餐', tip: '可填 0 份' },
    ],
  },

  onLoad() {
    this._currentDate = new Date()
    this._buildCalendar()
  },

  onShow() {
    this._buildCalendar()
  },

  // ─── 月历构建 ────────────────────────────────────────────────

  _buildCalendar() {
    const date = this._currentDate
    const year = date.getFullYear()
    const month = date.getMonth()
    this.setData({ monthText: `${year}年${month + 1}月` })

    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startWeekday = firstDay.getDay()
    const totalDays = lastDay.getDate()

    const today = new Date()
    const todayStr = formatDate(today)

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

      const mealData = MOCK_MEALS[dateStr]
      const hasMeal = !!mealData
      const mockData = mealData || { breakfast: 0, lunch: 0, dinner: 0 }

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
        isViewing: false,
        breakfast: mockData.breakfast,
        lunch: mockData.lunch,
        dinner: mockData.dinner,
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
    Dialog.alert({
      title: '计费规则',
      messageAlign: 'left',
      message: '每餐第 1 份按员工餐标准收费，超过 1 份的部分按家属餐标准收费。\n\n早餐：员工 5 元，家属 8 元\n午餐：员工 10 元，家属 15 元\n晚餐：员工 8 元，家属 12 元\n\n将数量减为 0 即取消该餐报餐，截止时间前可修改。',
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

  submitDay() {
    const day = this.data.selectedDay
    if (!day || day.isViewing) return

    const total = day.breakfast + day.lunch + day.dinner

    // 新报餐不允许全 0
    if (total === 0 && !day.hasMeal) {
      wx.showToast({ title: '请至少选择一个餐次', icon: 'none' })
      return
    }

    // total === 0 且已有报餐 → 取消当日报餐（静默保存）
    // total > 0 → 正常保存/修改

    const app = getApp()
    if (app.globalData.devMock) {
      // 更新 mock 数据
      if (total === 0) {
        delete MOCK_MEALS[day.dateStr]
      } else {
        MOCK_MEALS[day.dateStr] = {
          breakfast: day.breakfast,
          lunch: day.lunch,
          dinner: day.dinner,
        }
      }

      const days = this.data.calendarDays.map(d => {
        if (d.dateStr === day.dateStr) {
          d.hasMeal = total > 0
          d.breakfast = day.breakfast
          d.lunch = day.lunch
          d.dinner = day.dinner
        }
        return d
      })

      // 保存后仍保持编辑状态（截止时间内可继续修改）
      // 不弹 Toast — 静默保存
      this.setData({ calendarDays: days, selectedDay: day })
      return
    }

    // TODO: 接入真实 API — POST /meals/save
    // 后端逻辑：qty 全 0 则删除当日记录，否则 upsert
  },
})
