// utils/auth.js — 登录鉴权 & Token 管理

const { STORAGE_KEYS, ROLE } = require('./const')

// ─── Token 存取 ──────────────────────────────────────────────

function getAccessToken() {
  return wx.getStorageSync(STORAGE_KEYS.ACCESS_TOKEN) || ''
}

function setAccessToken(token) {
  wx.setStorageSync(STORAGE_KEYS.ACCESS_TOKEN, token)
}

function getRefreshToken() {
  return wx.getStorageSync(STORAGE_KEYS.REFRESH_TOKEN) || ''
}

function setRefreshToken(token) {
  wx.setStorageSync(STORAGE_KEYS.REFRESH_TOKEN, token)
}

/**
 * 保存登录凭证
 * @param {{ access_token: string, refresh_token: string }} tokens
 */
function saveTokens(tokens) {
  setAccessToken(tokens.access_token)
  setRefreshToken(tokens.refresh_token)
  wx.setStorageSync(STORAGE_KEYS.LAST_LOGIN, Date.now())
}

/**
 * 清除所有登录凭证（退出登录使用）
 */
function clearAuth() {
  wx.removeStorageSync(STORAGE_KEYS.ACCESS_TOKEN)
  wx.removeStorageSync(STORAGE_KEYS.REFRESH_TOKEN)
  wx.removeStorageSync(STORAGE_KEYS.USER_INFO)
  wx.removeStorageSync(STORAGE_KEYS.USER_INFO_SAVED_AT)
  wx.removeStorageSync(STORAGE_KEYS.LAST_LOGIN)
}

// ─── 用户信息缓存（带 TTL，过期后需经云函数静默刷新重建） ───

/** 用户信息缓存有效期：7 天（毫秒），过期后不再直接信任本地缓存 */
const USER_INFO_TTL = 7 * 24 * 60 * 60 * 1000

/**
 * 读取本地缓存的用户信息
 * - 正常用户：登录成功后写入，正常读取后恢复登录态
 * - 首次启动 / 未登录：返回 null → 走登录页
 */
function getCachedUserInfo() {
  try {
    const savedAt = wx.getStorageSync(STORAGE_KEYS.USER_INFO_SAVED_AT) || 0
    if (Date.now() - savedAt > USER_INFO_TTL) return null // 过期视为无缓存
    return wx.getStorageSync(STORAGE_KEYS.USER_INFO) || null
  } catch (e) {
    console.warn('[Auth] getCachedUserInfo error', e)
    return null
  }
}

function setCachedUserInfo(info) {
  if (!info) return
  wx.setStorageSync(STORAGE_KEYS.USER_INFO, info)
  wx.setStorageSync(STORAGE_KEYS.USER_INFO_SAVED_AT, Date.now())
}

/**
 * 静默刷新用户信息
 * @returns {Promise<object|null>}
 */
async function refreshUserInfo() {
  try {
    const { AuthAPI } = require('../services/api')
    const result = await AuthAPI.getMyInfo()
    const { allowed, emp } = result || {}

    if (allowed && emp && emp.id) {
      setCachedUserInfo(emp)
      return emp
    }

    // 账号已停用 / 微信解绑 / 未找到绑定记录 → 登录态失效
    clearAuth()
    return null
  } catch (e) {
    console.warn('[Auth] refreshUserInfo error', e)
    return null
  }
}

// ─── 角色工具 ────────────────────────────────────────────────

/**
 * 判断当前用户是否具有指定角色
 * @param {string|string[]} role - ROLE 常量中的值
 * @returns {boolean}
 */
function hasRole(role) {
  const app = getApp()
  const roleCode = (app && app.globalData && app.globalData.roleCode) || ''
  if (Array.isArray(role)) {
    return role.some((r) => roleCode === r)
  }
  return roleCode === role
}

/**
 * 获取当前用户最高权限角色
 * 优先级: sys_admin > dept_admin > kitchen > employee
 */
function getPrimaryRole() {
  const app = getApp()
  const roleCode = (app && app.globalData && app.globalData.roleCode) || ''
  const priority = [ROLE.SYS_ADMIN, ROLE.DEPT_ADMIN, ROLE.KITCHEN, ROLE.EMPLOYEE]
  return priority.find((r) => roleCode === r) || ROLE.EMPLOYEE
}

module.exports = {
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  saveTokens,
  clearAuth,
  getCachedUserInfo,
  setCachedUserInfo,
  refreshUserInfo,
  USER_INFO_TTL,
  /** 别名：getStoredUserInfo（供页面使用） */
  getStoredUserInfo: getCachedUserInfo,
  hasRole,
  getPrimaryRole,
}
