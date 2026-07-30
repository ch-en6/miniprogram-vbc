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
    return value || null
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
 * 清除所有应用缓存
 */
function clearAllCache() {
  try {
    wx.removeStorageSync(STORAGE_KEYS.CACHE_DEPT_NAME)
    wx.removeStorageSync(STORAGE_KEYS.CACHE_PRICE_CONFIG)
    wx.removeStorageSync(STORAGE_KEYS.CACHE_TIMESTAMP)
  } catch (e) {
    console.warn('[Cache] clearAllCache error:', e)
  }
}

// ─── 部门名称缓存 ──────────────────────────────────────────

/**
 * 获取缓存的部门名称（24h 有效）
 * @returns {string|null}
 */
function getCachedDeptName() {
  return getCache(STORAGE_KEYS.CACHE_DEPT_NAME)
}

/**
 * 从云函数加载部门名称并缓存
 * @param {string} dept_id
 * @returns {Promise<string>} 部门名称
 */
async function loadAndCacheDeptName(dept_id) {
  if (!dept_id) return null

  // 先检查缓存
  const cached = getCachedDeptName()
  if (cached) return cached

  // 缓存过期或不存在，从云函数拉取
  try {
    const res = await wx.cloud.callFunction({
      name: 'getDeptName',
      data: { dept_id }
    })
    const result = res.result
    if (result && result.code === 0 && result.data) {
      const deptName = result.data.dept_name || ''
      setCache(STORAGE_KEYS.CACHE_DEPT_NAME, deptName)
      return deptName
    }
  } catch (err) {
    console.error('[Cache] loadDeptName error:', err)
  }
  return null
}

// ─── 价格配置缓存 ──────────────────────────────────────────

/**
 * 获取缓存的价格配置（24h 有效）
 * @returns {object|null}
 */
function getCachedPriceConfig() {
  return getCache(STORAGE_KEYS.CACHE_PRICE_CONFIG)
}

/**
 * 从云函数加载价格配置并缓存
 * @param {string} dept_id
 * @returns {Promise<object|null>}
 */
async function loadAndCachePriceConfig(dept_id) {
  if (!dept_id) return null

  // 先检查缓存
  const cached = getCachedPriceConfig()
  if (cached) return cached

  // 缓存过期或不存在，从云函数拉取
  try {
    const res = await wx.cloud.callFunction({
      name: 'mealOrder',
      data: { action: 'getPriceConfig', dept_id }
    })
    if (res.result && res.result.code === 0 && res.result.data) {
      setCache(STORAGE_KEYS.CACHE_PRICE_CONFIG, res.result.data)
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
  getCachedDeptName,
  loadAndCacheDeptName,
  getCachedPriceConfig,
  loadAndCachePriceConfig,
}
