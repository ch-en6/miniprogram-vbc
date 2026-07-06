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
  wx.removeStorageSync(STORAGE_KEYS.LAST_LOGIN)
}

// ─── 用户信息缓存 ────────────────────────────────────────────

function getCachedUserInfo() {
  return wx.getStorageSync(STORAGE_KEYS.USER_INFO) || null
}

function setCachedUserInfo(info) {
  wx.setStorageSync(STORAGE_KEYS.USER_INFO, info)
}

// ─── 登录检测 ────────────────────────────────────────────────

/**
 * 检测本地登录状态
 * - 有 access_token → 尝试用缓存 userInfo，返回 userInfo
 * - 无 token → 返回 null（需要重新登录）
 *
 * @returns {Promise<object|null>}
 */
async function checkLogin() {
  const token = getAccessToken()
  if (!token) return null

  // 先返回缓存，页面加载后再静默刷新
  const cached = getCachedUserInfo()
  if (cached) return cached

  // 无缓存但有 token → 拉取用户信息
  try {
    const { request } = require('./request')
    const userInfo = await request({ url: '/auth/me', method: 'GET' })
    setCachedUserInfo(userInfo)
    return userInfo
  } catch (e) {
    console.warn('[Auth] checkLogin failed', e)
    // token 失效
    clearAuth()
    return null
  }
}

/**
 * 执行微信登录授权流程
 * 1. wx.login 获取 code
 * 2. 后端换取 tokens + userInfo
 *
 * @param {{ code: string }} options
 * @returns {Promise<object>} userInfo
 */
async function wxLogin(code) {
  const { request } = require('./request')
  const result = await request({
    url: '/auth/wechat-login',
    method: 'POST',
    data: { code },
    skipAuth: true, // 登录接口不带 token
  })
  saveTokens({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  })
  setCachedUserInfo(result.user)
  return result.user
}

/**
 * 刷新 access_token
 * @returns {Promise<string>} 新 access_token
 */
async function refreshAccessToken() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) throw new Error('No refresh token')

  const { request } = require('./request')
  const result = await request({
    url: '/auth/refresh',
    method: 'POST',
    data: { refresh_token: refreshToken },
    skipAuth: true,
  })
  saveTokens({
    access_token: result.access_token,
    refresh_token: result.refresh_token || refreshToken,
  })
  return result.access_token
}

// ─── 角色工具 ────────────────────────────────────────────────

/**
 * 判断当前用户是否具有指定角色
 * @param {string|string[]} role - ROLE 常量中的值
 * @returns {boolean}
 */
function hasRole(role) {
  const app = getApp()
  const roles = (app && app.globalData && app.globalData.roles) || []
  if (Array.isArray(role)) {
    return role.some((r) => roles.includes(r))
  }
  return roles.includes(role)
}

/**
 * 获取当前用户最高权限角色
 * 优先级: sys_admin > dept_admin > kitchen > employee
 */
function getPrimaryRole() {
  const app = getApp()
  const roles = (app && app.globalData && app.globalData.roles) || []
  const priority = [ROLE.SYS_ADMIN, ROLE.DEPT_ADMIN, ROLE.KITCHEN, ROLE.EMPLOYEE]
  return priority.find((r) => roles.includes(r)) || ROLE.EMPLOYEE
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
  /** 别名：getStoredUserInfo（供页面使用） */
  getStoredUserInfo: getCachedUserInfo,
  checkLogin,
  wxLogin,
  refreshAccessToken,
  hasRole,
  getPrimaryRole,
}
