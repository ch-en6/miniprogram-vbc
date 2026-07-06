// utils/request.js — 统一网络请求封装

const { getAccessToken, refreshAccessToken, clearAuth } = require('./auth')

// ─── 环境配置 ────────────────────────────────────────────────

/**
 * 根据当前运行环境自动选择 BASE_URL
 * 在微信开发者工具 → 详情 → 本地设置中可切换 "不校验合法域名"
 */
const ENV_CONFIG = {
  development: 'http://localhost:3000/api/v1',
  staging:     'https://staging-api.yourdomain.com/api/v1',
  production:  'https://api.yourdomain.com/api/v1',
}

// TODO: 上线时将此值改为 'production'
const CURRENT_ENV = 'development'
const BASE_URL = ENV_CONFIG[CURRENT_ENV]

/** 请求超时（毫秒） */
const TIMEOUT = 15000

/** 最大自动重试次数（网络错误时） */
const MAX_RETRY = 1

// ─── 核心请求函数 ────────────────────────────────────────────

/**
 * 发起 HTTP 请求
 *
 * @param {object} options
 * @param {string}  options.url        - 接口路径（不含 BASE_URL）
 * @param {'GET'|'POST'|'PUT'|'DELETE'|'PATCH'} [options.method='GET']
 * @param {object}  [options.data]     - 请求体 / Query 参数
 * @param {object}  [options.header]   - 额外请求头
 * @param {boolean} [options.skipAuth] - 是否跳过 Authorization header
 * @param {number}  [options._retry]   - 内部重试计数，勿手动传入
 * @returns {Promise<any>} 后端 data 字段
 */
function request(options) {
  const {
    url,
    method = 'GET',
    data = {},
    header = {},
    skipAuth = false,
    _retry = 0,
  } = options

  return new Promise((resolve, reject) => {
    const token = skipAuth ? '' : getAccessToken()

    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      timeout: TIMEOUT,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...header,
      },
      success(res) {
        // ── 401 Token 过期：尝试刷新后重试一次 ──
        if (res.statusCode === 401 && !skipAuth && _retry < MAX_RETRY) {
          refreshAccessToken()
            .then(() => request({ ...options, _retry: _retry + 1 }))
            .then(resolve)
            .catch(() => {
              clearAuth()
              wx.reLaunch({ url: '/pages/login/index' })
              reject(_buildError(401, '登录已过期，请重新登录'))
            })
          return
        }

        // ── 403 无权限 ──
        if (res.statusCode === 403) {
          showToast('无操作权限')
          reject(_buildError(403, '无操作权限'))
          return
        }

        // ── 2xx 成功 ──
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 支持后端两种响应格式：
          // { code, data, message } 或直接返回数据对象
          const body = res.data
          if (body && typeof body === 'object' && 'code' in body) {
            if (body.code === 0 || body.code === 200) {
              resolve(body.data)
            } else {
              showToast(body.message || '操作失败')
              reject(_buildError(body.code, body.message))
            }
          } else {
            resolve(body)
          }
          return
        }

        // ── 其他 HTTP 错误 ──
        const msg = (res.data && res.data.message) || `请求失败 (${res.statusCode})`
        showToast(msg)
        reject(_buildError(res.statusCode, msg))
      },
      fail(err) {
        // ── 网络错误，重试 ──
        if (_retry < MAX_RETRY) {
          request({ ...options, _retry: _retry + 1 }).then(resolve).catch(reject)
          return
        }
        console.error('[Request] network error', err)
        showToast('网络异常，请检查网络连接')
        reject(_buildError(-1, '网络异常', err))
      },
    })
  })
}

// ─── 便捷方法 ────────────────────────────────────────────────

const get    = (url, data, opts = {}) => request({ ...opts, url, method: 'GET', data })
const post   = (url, data, opts = {}) => request({ ...opts, url, method: 'POST', data })
const put    = (url, data, opts = {}) => request({ ...opts, url, method: 'PUT', data })
const del    = (url, data, opts = {}) => request({ ...opts, url, method: 'DELETE', data })
const patch  = (url, data, opts = {}) => request({ ...opts, url, method: 'PATCH', data })

// ─── 文件下载（Excel 导出等） ────────────────────────────────

/**
 * 下载文件并触发保存
 * @param {string} url - 完整下载地址（含 token 参数 或 Authorization Header）
 * @param {string} [fileName] - 保存文件名
 */
function downloadFile(url, fileName) {
  return new Promise((resolve, reject) => {
    const token = getAccessToken()
    wx.showLoading({ title: '正在导出...' })
    wx.downloadFile({
      url,
      header: { Authorization: token ? `Bearer ${token}` : '' },
      success(res) {
        wx.hideLoading()
        if (res.statusCode === 200) {
          wx.openDocument({
            filePath: res.tempFilePath,
            showMenu: true,
            success: () => resolve(res.tempFilePath),
            fail: reject,
          })
        } else {
          reject(_buildError(res.statusCode, '文件下载失败'))
        }
      },
      fail(err) {
        wx.hideLoading()
        reject(_buildError(-1, '下载失败', err))
      },
    })
  })
}

// ─── 内部工具 ────────────────────────────────────────────────

function _buildError(code, message, detail) {
  return { code, message, detail }
}

function showToast(title) {
  wx.showToast({ title: title || '操作失败', icon: 'none', duration: 2000 })
}

module.exports = {
  request,
  get,
  post,
  put,
  del,
  patch,
  downloadFile,
  BASE_URL,
  CURRENT_ENV,
}
