// 云函数 - 修改密码（SHA-256 + salt 哈希存储，通过 @cloudbase/node-sdk 访问云 MySQL；按 openid 反查身份，防越权）
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const cloudbaseSDK = require('@cloudbase/node-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 初始化 CloudBase 应用（云函数环境自动关联当前环境，用于访问云 MySQL）
const cloudbase = cloudbaseSDK.init({ env: cloudbaseSDK.SYMBOL_CURRENT_ENV })
const models = cloudbase.models

/**
 * 执行 SQL 查询（预编译模式，参数用 {{key}} 绑定，防 SQL 注入）
 * @param {string} sql - SQL 语句
 * @param {object} [params] - 参数对象
 * @returns {Promise<Array>} 查询结果行数组
 */
async function query(sql, params = {}) {
  const result = await models.$runSQL(sql, params)
  return (result && result.data && result.data.executeResultList) || []
}

/**
 * 执行 SQL 更新
 * @param {string} sql - SQL 语句
 * @param {object} [params] - 参数对象
 * @returns {Promise<number>} 受影响行数
 */
async function update(sql, params = {}) {
  const result = await models.$runSQL(sql, params)
  return (result && result.data && result.data.total) || 0
}

/**
 * 生成随机盐值
 * @param {number} len 盐值字节长度（默认 16）
 * @returns {string} hex 格式盐值
 */
function generateSalt(len = 16) {
  return crypto.randomBytes(len).toString('hex')
}

/**
 * 用 SHA-256 + salt 对密码进行哈希
 * @param {string} password 明文密码
 * @param {string} salt 盐值
 * @returns {string} 哈希值
 */
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex')
}

exports.main = async (event, context) => {
  const { oldPassword, newPassword } = event

  if (!oldPassword || !newPassword) {
    return { code: -1, message: '缺少必要参数', data: null }
  }

  if (newPassword.length < 8) {
    return { code: -1, message: '新密码至少8位', data: null }
  }

  try {
    // 通过 openid 反查员工身份（忽略前端传入的 empId，防止越权修改他人密码）
    const wxContext = cloud.getWXContext() || {}
    const openid = wxContext.OPENID || ''
    if (!openid) {
      return { code: -1, message: '登录状态失效，请重新登录', data: null }
    }

    const emps = await query(
      'SELECT `id`, `password`, `password_salt` FROM `sys_emp` WHERE `_openid` = {{openid}} LIMIT 1',
      { openid }
    )
    const emp = emps[0]

    if (!emp) {
      return { code: -1, message: '员工不存在', data: null }
    }

    // 校验旧密码（哈希比对）
    if (emp.password) {
      const salt = emp.password_salt || ''
      const oldHash = hashPassword(oldPassword, salt)
      if (oldHash !== emp.password) {
        return { code: -1, message: '旧密码错误', data: null }
      }
    }

    // 生成新盐值 + 哈希新密码
    const newSalt = generateSalt()
    const newHash = hashPassword(newPassword, newSalt)

    // 更新密码和盐值
    await update(
      'UPDATE `sys_emp` SET `password` = {{newHash}}, `password_salt` = {{newSalt}}, `updated_at` = NOW() WHERE `id` = {{empId}}',
      { newHash, newSalt, empId: emp.id }
    )

    console.log('[changePassword] 密码修改成功, empId:', emp.id)
    return { code: 0, message: '密码修改成功', data: null }
  } catch (err) {
    console.error('修改密码失败:', err)
    return { code: -1, message: '修改失败: ' + err.message, data: null }
  }
}
