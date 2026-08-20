// utils/cache.js — 应用级集中缓存管理（24 小时有效期）
const { STORAGE_KEYS } = require('./const')

/** 缓存有效期：24 小时（毫秒） */
const CACHE_TTL = 24 * 60 * 60 * 1000

// ─── 通用缓存读写 ──────────────────────────────────────────

/**
 * 读取缓存（自动判断是否过期）
 * @param {string} key - STORAGE_KEYS 中的键名
 * @returns {*|null} 缓存值，过期或不存在返回 null
 */
function getCache(key) {
  try {
    const timestamps = wx.getStorageSync(STORAGE_KEYS.CACHE_TIMESTAMP) || {}
    const savedAt = timestamps[key] || 0
    if (Date.now() - savedAt > CACHE_TTL) return null

    const value = wx.getStorageSync(key)
    return value === '' ? null : value
  } catch (e) {
    console.warn('[Cache] getCache error:', key, e)
    return null
  }
}

/**
 * 写入缓存（同时记录时间戳）
 * @param {string} key - STORAGE_KEYS 中的键名
 * @param {*} value - 要缓存的值
 */
function setCache(key, value) {
  try {
    wx.setStorageSync(key, value)
    const timestamps = wx.getStorageSync(STORAGE_KEYS.CACHE_TIMESTAMP) || {}
    timestamps[key] = Date.now()
    wx.setStorageSync(STORAGE_KEYS.CACHE_TIMESTAMP, timestamps)
  } catch (e) {
    console.warn('[Cache] setCache error:', key, e)
  }
}

/**
 * 清除所有应用缓存（含按部门拆分的价格缓存）
 */
function clearAllCache() {
  try {
    const allKeys = wx.getStorageInfoSync().keys || []
    allKeys.forEach(key => {
      if (key === STORAGE_KEYS.CACHE_TIMESTAMP || key.indexOf(STORAGE_KEYS.CACHE_PRICE_CONFIG) === 0) {
        wx.removeStorageSync(key)
      }
    })
  } catch (e) {
    console.warn('[Cache] clearAllCache error:', e)
  }
}

// ─── 价格配置缓存 ──────────────────────────────────────────

/**
 * 价格缓存 key：按部门隔离，避免多部门串数据
 * @param {string} dept_id
 * @returns {string}
 */
function getPriceCacheKey(dept_id) {
  return dept_id
    ? `${STORAGE_KEYS.CACHE_PRICE_CONFIG}_${dept_id}`
    : STORAGE_KEYS.CACHE_PRICE_CONFIG
}

/**
 * 校验价格配置当前是否仍有效
 * 规则：每餐若带 start_date/end_date，则要求当前日期在区间内；
 * 任一餐次已过期（或日期字段缺失）即视为整体失效，需重新拉取。
 * @param {object} config - getPriceConfig 返回的价格配置
 * @returns {boolean}
 */
function isPriceConfigValid(config) {
  if (!config || typeof config !== 'object') return false

  const today = getToday()
  const meals = ['breakfast', 'lunch', 'dinner']
  return meals.every(meal => {
    const item = config[meal]
    if (!item || typeof item !== 'object') return true
    const { start_date, end_date } = item
    // 无日期字段（默认价兜底）→ 视为长期有效
    if (!start_date && !end_date) return true
    // 有日期字段但缺失其一 → 数据不完整，视为失效
    if (!start_date || !end_date) return false
    // YYYY-MM-DD 字符串可直接比较
    return start_date <= today && today <= end_date
  })
}

/**
 * 获取当前日期 YYYY-MM-DD（本地时区）
 * @returns {string}
 */
function getToday() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * 获取缓存的价格配置（24h 有效 + 有效期二次校验）
 * @param {string} [dept_id]
 * @returns {object|null}
 */
function getCachedPriceConfig(dept_id) {
  const cached = getCache(getPriceCacheKey(dept_id))
  return isPriceConfigValid(cached) ? cached : null
}

/**
 * 从云函数加载价格配置并缓存
 * @param {string} dept_id
 * @returns {Promise<object|null>}
 */
async function loadAndCachePriceConfig(dept_id) {
  if (!dept_id) return null

  // 先检查缓存（含有效期校验）
  const cached = getCachedPriceConfig(dept_id)
  if (cached) return cached

  // 缓存过期、失效或不存在，从云函数拉取
  try {
    const res = await wx.cloud.callFunction({
      name: 'getPriceConfig',
      data: { dept_id }
    })
    if (res.result && res.result.code === 0 && res.result.data) {
      setCache(getPriceCacheKey(dept_id), res.result.data)
      return res.result.data
    }
  } catch (err) {
    console.error('[Cache] loadPriceConfig error:', err)
  }
  return null
}

module.exports = {
  CACHE_TTL,
  getCache,
  setCache,
  clearAllCache,
  getPriceCacheKey,
  getCachedPriceConfig,
  loadAndCachePriceConfig,
  isPriceConfigValid,
}
