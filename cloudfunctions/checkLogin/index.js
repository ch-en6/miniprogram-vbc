// 云函数 - 账号密码登录校验（通过 @cloudbase/node-sdk 访问云 MySQL）
// 流程：
//   1. code 换取 openid（code2Session）
//   2. 通过 @cloudbase/node-sdk 的 models.$runSQL 从 MySQL 的 sys_emp 表按手机号查询员工
//   3. 校验密码（SHA-256 + salt 哈希比对）
//   4. 通过 sys_emp.role（bigint 角色ID）关联 sys_role 表查询角色 code
//   5. 防换绑双向校验：账号已绑其他微信 / 微信已绑其他账号均拒绝
//
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const cloudbaseSDK = require('@cloudbase/node-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 初始化 CloudBase 应用（云函数环境自动关联当前环境）
const cloudbase = cloudbaseSDK.init({
  env: cloudbaseSDK.SYMBOL_CURRENT_ENV
})
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
 * 执行 SQL 写操作
 * @param {string} sql - SQL 语句
 * @param {object} [params] - 参数对象
 * @returns {Promise<number>} 受影响行数
 */
async function update(sql, params = {}) {
  const result = await models.$runSQL(sql, params)
  return (result && result.data && result.data.total) || 0
}

/**
 * 用 SHA-256 + salt 对密码进行哈希
 * @param {string} password 明文密码
 * @param {string} salt 盐值
 * @returns {string} 哈希值
 */
const PBKDF2_ITERATIONS = 600000

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha256').toString('hex')
}

exports.main = async (event, context) => {
  const { phone, password, loginCode } = event

  if (!phone || !password) {
    return { code: -1, message: '缺少账号或密码参数', data: null }
  }
  if (!loginCode) {
    return { code: -1, message: '缺少登录凭证，请重新登录', data: null }
  }

  try {
    // ── 1. 通过 loginCode 换取 openid ──────────────────────────
    //    云函数必须能拿到真实调用者的 openid 才允许登录（loginCode 已在入口强制必传）
    //    日志只打印脱敏后的 openid，避免完整标识落日志
    const maskOpenid = oid => (oid && oid.length > 8 ? oid.slice(0, 8) + '****' : '****')
    let openid = null
    try {
      const res = await cloud.openapi('code2Session', {
        jsCode: loginCode
      })
      openid = res.openid
      console.log('[checkLogin] code2Session success, openid:', maskOpenid(openid))
    } catch (codeErr) {
      console.warn('[checkLogin] code2Session 失败，尝试 cloud.getWXContext():', codeErr)
      try {
        const wxContext = cloud.getWXContext()
        openid = wxContext.OPENID || null
        if (openid) {
          console.log('[checkLogin] 使用 WXContext OPENID:', maskOpenid(openid))
        }
      } catch (e2) {
        console.warn('[checkLogin] cloud.getWXContext() 也失败:', e2)
      }
    }

    // 拿不到 openid 直接拒绝登录（防绕过绑定关系）
    if (!openid) {
      return { code: -1, message: '获取微信身份失败，请重试', data: null }
    }

    // ── 2. 通过 @cloudbase/node-sdk 查询 sys_emp 表 ─────────────
    const emps = await query(
      'SELECT * FROM `sys_emp` WHERE `phone` = {{phone}} LIMIT 1',
      { phone }
    )

    if (emps.length > 0) {
      const emp = emps[0]

      // ── 3. 校验密码（SHA-256 + salt 哈希比对） ──────────────────
      if (!emp.password) {
        return {
          code: 0,
          message: '请联系管理员重置',
          data: { allowed: false, pwdError: false, emp: null, message: '请联系管理员重置' }
        }
      }

      const salt = emp.password_salt || ''
      const inputHash = hashPassword(password, salt)
      if (inputHash !== emp.password) {
        return {
          code: 0,
          message: '密码错误',
          data: { allowed: true, emp: null, pwdError: true, message: '密码错误' }
        }
      }

      // ── 4. 通过角色ID（bigint）查询 sys_role 获取角色 code ──────
      const role_id = emp.role_id || null
      let role_code = null
      if (role_id) {
        const role = await query(
          'SELECT `code` FROM `sys_role` WHERE `id` = {{role_id}}',
          { role_id }
        )
        role_code = role.length ? role[0].code : null
      }

      // ── 5. 防换绑：双向校验（一人一微信一账号） ──────────────────
      //   a) 账号侧：该账号已绑定其他微信 → 拒绝登录
      //   b) 微信侧：该 openid 已被其他账号占用 → 拒绝登录
      if (emp._openid && emp._openid !== openid) {
        return {
          code: 0,
          message: '该账号已绑定其他微信，如需换绑请联系管理员',
          data: { allowed: false, pwdError: false, emp: null, message: '该账号已绑定其他微信，如需换绑请联系管理员' }
        }
      }
      if (emp._openid !== openid) {
        const bound = await query(
          'SELECT `id` FROM `sys_emp` WHERE `_openid` = {{openid}} AND `id` != {{id}} LIMIT 1',
          { openid, id: emp.id }
        )
        if (bound.length > 0) {
          return {
            code: 0,
            message: '该微信已绑定其他账号，如需换绑请联系管理员',
            data: { allowed: false, pwdError: false, emp: null, message: '该微信已绑定其他账号，如需换绑请联系管理员' }
          }
        }
        // 未被他人占用，则条件写入 openid 完成绑定（防并发抢占：
        // 仅当该账号仍未绑定（NULL/空串）或绑定的是当前 openid 时才允许写入）
        const affected = await update(
          'UPDATE `sys_emp` SET `_openid` = {{openid}}, `updated_at` = NOW() ' +
          "WHERE `id` = {{id}} AND (`_openid` IS NULL OR `_openid` = '' OR `_openid` = {{openid}})",
          { openid, id: emp.id }
        )
        if (!affected) {
          // 并发期间被其他微信抢先绑定
          return {
            code: 0,
            message: '该账号已被其他微信绑定，请重新登录',
            data: { allowed: false, pwdError: false, emp: null, message: '该账号已被其他微信绑定，请重新登录' }
          }
        }
        console.log('[checkLogin] openid 已写入 sys_emp:', emp.id)
      }

      // ── 6. 联查部门名称与 location_id（MySQL sys_dept 表），登录时一并返回 ──
      let dept_name = ''
      let location_id = null
      if (emp.dept_id) {
        try {
          const deptRows = await query(
            'SELECT `name`, `location_id` FROM `sys_dept` WHERE `id` = {{dept_id}} LIMIT 1',
            { dept_id: emp.dept_id }
          )
          if (deptRows.length > 0) {
            dept_name = deptRows[0].name || ''
            location_id = deptRows[0].location_id || null
          }
        } catch (deptErr) {
          console.warn('[checkLogin] 查询部门信息失败:', deptErr)
        }
      }

      return {
        code: 0,
        message: 'success',
        data: {
          allowed: true,
          pwdError: false,
          emp: {
            id: emp.id,
            name: emp.name || '',
            phone: emp.phone,
            dept_id: emp.dept_id,
            dept_name: dept_name,
            location_id: location_id,
            role_id: role_id || null,
            role_code: role_code,
            status: emp.status !== undefined && emp.status !== null ? emp.status : 1,
          }
        }
      }
    } else {
      // 手机号不在 sys_emp 表中，不允许登录
      return {
        code: 0,
        message: '该账号未注册，请联系管理员',
        data: {
          allowed: false,
          pwdError: false,
          emp: null,
          message: '该账号未注册，请联系管理员'
        }
      }
    }
  } catch (err) {
    console.error('登录校验失败:', err)
    return {
      code: -1,
      message: '查询失败: ' + err.message,
      data: null
    }
  }
}
