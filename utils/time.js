// utils/time.js — 日期/时间工具函数

const { BOOK_DEADLINE_HOUR, BOOK_DEADLINE_MINUTE, DATE_FORMAT, MONTH_FORMAT } = require('./const')

// ─── 基础格式化 ──────────────────────────────────────────────

/**
 * 将日期格式化为 YYYY-MM-DD 字符串
 * @param {Date|string|number} date
 * @returns {string} e.g. "2026-06-23"
 */
function formatDate(date) {
  const d = toDate(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 将日期格式化为 YYYY-MM 字符串
 * @param {Date|string|number} date
 * @returns {string} e.g. "2026-06"
 */
function formatMonth(date) {
  const d = toDate(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * 将日期格式化为 MM月DD日 中文形式
 * @param {Date|string|number} date
 * @returns {string} e.g. "06月23日"
 */
function formatDateCN(date) {
  const d = toDate(date)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}月${day}日`
}

/**
 * 格式化为完整时间字符串 YYYY-MM-DD HH:mm
 */
function formatDateTime(date) {
  const d = toDate(date)
  const base = formatDate(d)
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${base} ${h}:${min}`
}

// ─── 报餐截止时间判断 ────────────────────────────────────────

/**
 * 判断某一日期是否仍在报餐截止时间内（可以报餐/修改）
 *
 * 规则：可对 targetDate 当天及未来日期报餐，
 *       截止时间为 targetDate 前一天的 17:00。
 *
 * @param {string|Date} targetDate - 目标报餐日期（YYYY-MM-DD）
 * @param {Date} [now] - 当前时间，默认 new Date()
 * @returns {boolean}
 */
function isBookable(targetDate, now) {
  const current = now || new Date()
  const target = toDate(targetDate)

  // 前一天 17:00 = 截止时间
  const deadline = new Date(target)
  deadline.setDate(deadline.getDate() - 1)
  deadline.setHours(BOOK_DEADLINE_HOUR, BOOK_DEADLINE_MINUTE, 0, 0)

  return current < deadline
}

/**
 * 判断某一日期是否为"今天可报" — 截止时间后不可修改
 * @param {string|Date} targetDate
 * @returns {boolean}
 */
function isBookableToday(targetDate) {
  return isBookable(targetDate)
}

/**
 * 获取今日报餐截止时间描述
 * 例："今日 17:00 截止报餐（明天的餐）"
 * @param {Date} [now]
 * @returns {{ deadlineDate: string, deadlineTime: string, targetDate: string }}
 */
function getBookDeadlineInfo(now) {
  const current = now || new Date()
  // 截止时间是今天 17:00，针对的是明天的报餐
  const todayDeadline = new Date(current)
  todayDeadline.setHours(BOOK_DEADLINE_HOUR, BOOK_DEADLINE_MINUTE, 0, 0)

  const tomorrow = new Date(current)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return {
    deadlineDate: formatDate(todayDeadline),
    deadlineTime: `${String(BOOK_DEADLINE_HOUR).padStart(2, '0')}:${String(BOOK_DEADLINE_MINUTE).padStart(2, '0')}`,
    targetDate: formatDate(tomorrow),
    isPast: current >= todayDeadline,
  }
}

// ─── 月历工具 ────────────────────────────────────────────────

/**
 * 获取某月的起止日期
 * @param {string} month - "YYYY-MM"
 * @returns {{ start: string, end: string }}
 */
function getMonthRange(month) {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 0) // 该月最后一天
  return {
    start: formatDate(start),
    end: formatDate(end),
  }
}

/**
 * 获取上个月字符串
 * @param {string} month - "YYYY-MM"
 * @returns {string}
 */
function prevMonth(month) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return formatMonth(d)
}

/**
 * 获取下个月字符串
 */
function nextMonth(month) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 1)
  return formatMonth(d)
}

/**
 * 比较两个日期字符串大小（YYYY-MM-DD）
 * @returns {number} -1 | 0 | 1
 */
function compareDate(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * 获取某月的所有日期数组
 * @param {string} month - "YYYY-MM"
 * @returns {string[]} ["2026-06-01", "2026-06-02", ...]
 */
function getDatesInMonth(month) {
  const { start, end } = getMonthRange(month)
  const dates = []
  const current = toDate(start)
  const endDate = toDate(end)
  while (current <= endDate) {
    dates.push(formatDate(current))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

// ─── 星期 ────────────────────────────────────────────────────

const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 获取日期对应星期的中文名
 * @param {string|Date} date
 * @returns {string} e.g. "周三"
 */
function getWeekDay(date) {
  const d = toDate(date)
  return '周' + WEEK_DAYS[d.getDay()]
}

// ─── 内部工具 ────────────────────────────────────────────────

function toDate(val) {
  if (val instanceof Date) return new Date(val.getTime())
  if (typeof val === 'string') {
    // "YYYY-MM-DD" → 避免时区问题
    const parts = val.split('-')
    if (parts.length === 3) {
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    }
    return new Date(val)
  }
  return new Date(val)
}

module.exports = {
  formatDate,
  formatMonth,
  formatDateCN,
  formatDateTime,
  isBookable,
  isBookableToday,
  getBookDeadlineInfo,
  getMonthRange,
  prevMonth,
  nextMonth,
  compareDate,
  getDatesInMonth,
  getWeekDay,
  toDate,
}
