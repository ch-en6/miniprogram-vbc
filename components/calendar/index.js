// components/calendar/index.js — 月历报餐状态组件
const {
  formatDate,
  formatMonth,
  getDatesInMonth,
  getMonthRange,
  prevMonth,
  nextMonth,
  isBookable,
  toDate,
} = require('../../utils/time')

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']

Component({
  properties: {
    /** 当前月份 "YYYY-MM" */
    month: {
      type: String,
      value: '',
      observer: '_onMonthChange',
    },
    /** 报餐状态 Map: { "YYYY-MM-DD": { breakfast:1, lunch:0, dinner:2 } } */
    bookMap: {
      type: Object,
      value: {},
      observer: '_rebuild',
    },
    /** 当前选中日期 "YYYY-MM-DD" */
    selectedDate: {
      type: String,
      value: '',
      observer: '_rebuild',
    },
    /** 最大可预订月份偏移（0=本月，1=下月，默认2） */
    maxMonthOffset: {
      type: Number,
      value: 2,
    },
  },

  data: {
    displayMonth: '',
    weekdays: WEEKDAYS,
    leadingBlanks: [],  // 首行空格数组（length = 首日星期几）
    days: [],           // { date, day, cellClass, hasMeal, allMeal, partialMeal }
    isNextDisabled: false,
  },

  lifetimes: {
    attached() {
      if (!this.properties.month) {
        this.setData({ month: formatMonth(new Date()) })
      }
    },
  },

  methods: {
    _onMonthChange(month) {
      if (!month) return
      this._rebuild()
    },

    _rebuild() {
      const month = this.data.month
      if (!month) return

      const [y, m] = month.split('-').map(Number)
      const firstDay = new Date(y, m - 1, 1)
      const startWeekday = firstDay.getDay() // 0=日 ... 6=六

      const dates = getDatesInMonth(month)
      const todayStr = formatDate(new Date())
      const bookMap = this.data.bookMap || {}
      const selectedDate = this.data.selectedDate

      const days = dates.map((dateStr) => {
        const dayNum = parseInt(dateStr.slice(8), 10)
        const mealData = bookMap[dateStr]
        const bookedCount = mealData
          ? MEAL_TYPES.filter((t) => mealData[t] > 0).length
          : 0
        const hasMeal = bookedCount > 0
        const allMeal = bookedCount === 3
        const partialMeal = hasMeal && !allMeal

        const closed = !isBookable(dateStr)
        const isToday = dateStr === todayStr
        const isSelected = dateStr === selectedDate

        let cellClass = ''
        if (isSelected) {
          cellClass = 'cal-cell--selected'
        } else if (closed && dateStr < todayStr) {
          cellClass = 'cal-cell--closed'
        } else if (hasMeal) {
          cellClass = 'cal-cell--booked'
        } else if (isToday) {
          cellClass = 'cal-cell--today'
        }

        return { date: dateStr, day: dayNum, cellClass, hasMeal, allMeal, partialMeal }
      })

      // 首行空白格（占位，使日期与星期对齐）
      const leadingBlanks = Array.from({ length: startWeekday })

      // 判断是否禁用"下一月"
      const today = new Date()
      const maxYear = today.getFullYear()
      const maxMonth = today.getMonth() + 1 + this.data.maxMonthOffset
      const maxMonthNorm = maxMonth > 12
        ? { y: maxYear + Math.floor(maxMonth / 12), m: maxMonth % 12 || 12 }
        : { y: maxYear, m: maxMonth }
      const isNextDisabled =
        y > maxMonthNorm.y || (y === maxMonthNorm.y && m >= maxMonthNorm.m)

      // 显示标题
      const displayMonth = `${y} 年 ${String(m).padStart(2, '0')} 月`

      this.setData({ displayMonth, leadingBlanks, days, isNextDisabled })
    },

    onPrevMonth() {
      const newMonth = prevMonth(this.data.month)
      this.setData({ month: newMonth })
      this.triggerEvent('monthchange', { month: newMonth })
    },

    onNextMonth() {
      if (this.data.isNextDisabled) return
      const newMonth = nextMonth(this.data.month)
      this.setData({ month: newMonth })
      this.triggerEvent('monthchange', { month: newMonth })
    },

    onDayTap(e) {
      const { date } = e.currentTarget.dataset
      // 已截止 + 不是今天及以后 → 不可点（已截止的过去日期还是可以查看记录）
      this.triggerEvent('dayselect', { date })
    },
  },
})
