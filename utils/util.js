// utils/util.js — 通用工具函数

/**
 * 防抖函数
 * @param {Function} fn
 * @param {number} delay 毫秒
 */
function debounce(fn, delay = 300) {
  let timer = null
  return function (...args) {
    clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
}

/**
 * 节流函数
 * @param {Function} fn
 * @param {number} interval 毫秒
 */
function throttle(fn, interval = 500) {
  let last = 0
  return function (...args) {
    const now = Date.now()
    if (now - last >= interval) {
      last = now
      return fn.apply(this, args)
    }
  }
}

/**
 * 深拷贝（仅支持 JSON 可序列化的数据）
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

/**
 * 金额格式化（分 → 元，保留两位小数）
 * @param {number} fen
 * @returns {string} e.g. "10.00"
 */
function fenToYuan(fen) {
  return (fen / 100).toFixed(2)
}

/**
 * 金额格式化（元，保留两位小数）
 * @param {number|string} yuan
 * @returns {string}
 */
function formatMoney(yuan) {
  const num = parseFloat(yuan) || 0
  return num.toFixed(2)
}

/**
 * 手机号脱敏 138****8888
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  if (!phone || phone.length < 11) return phone
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

/**
 * 安全调用 wx.showToast
 */
function toast(title, icon = 'none', duration = 2000) {
  wx.showToast({ title, icon, duration })
}

/**
 * 安全调用 wx.showLoading
 */
function showLoading(title = '加载中...') {
  wx.showLoading({ title, mask: true })
}

function hideLoading() {
  wx.hideLoading()
}

/**
 * 跳转并传参（将 object 转为 query string）
 * @param {string} url
 * @param {object} params
 */
function navigateTo(url, params = {}) {
  const query = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&')
  wx.navigateTo({ url: query ? `${url}?${query}` : url })
}

/**
 * 解析页面 options 中的 Number 类型参数
 * @param {string|number} val
 * @param {number} defaultVal
 */
function parseIntParam(val, defaultVal = 0) {
  const n = parseInt(val, 10)
  return isNaN(n) ? defaultVal : n
}

module.exports = {
  debounce,
  throttle,
  deepClone,
  fenToYuan,
  formatMoney,
  maskPhone,
  toast,
  showLoading,
  hideLoading,
  navigateTo,
  parseIntParam,
}
