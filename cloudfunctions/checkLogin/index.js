// 云函数 - 账号密码登录校验（通过 @cloudbase/node-sdk 访问云 MySQL）
// 流程：
//   1. code 换取 openid（code2Session）
//   2. 通过 @cloudbase/node-sdk 的 models.$runSQL 从 MySQL 的 sys_emp 表按手机号查询员工
//   3. 校验密码（SHA-256 + salt 哈希比对）
//   4. 通过 sys_emp.role（bigint 角色ID）关联 sys_role 表查询角色 code
//   5. 将 openid 写回 sys_emp
//
// 前提：云开发环境中已绑定/接入 MySQL 数据源（sys_emp、sys_role 表），
//       云函数无需配置连接串，SDK 自动使用当前环境的数据源。
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
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex')
}

exports.main = async (event, context) => {
  const { phone, password, loginCode } = event

  if (!phone || !password) {
    return { code: -1, message: '缺少账号或密码参数', data: null }
  }

  try {
    // ── 1. 通过 loginCode 换取 openid ──────────────────────────
    let openid = null
    if (loginCode) {
      try {
        const res = await cloud.openapi('code2Session', {
          jsCode: loginCode
        })
        openid = res.openid
        console.log('[checkLogin] code2Session success, openid:', openid)
      } catch (codeErr) {
        console.warn('[checkLogin] code2Session 失败，尝试 cloud.getWXContext():', codeErr)
        try {
          const wxContext = cloud.getWXContext()
          openid = wxContext.OPENID || null
          if (openid) {
            console.log('[checkLogin] 使用 WXContext OPENID:', openid)
          }
        } catch (e2) {
          console.warn('[checkLogin] cloud.getWXContext() 也失败:', e2)
        }
      }
    }

    // ── 2. 通过 @cloudbase/node-sdk 查询 sys_emp 表 ─────────────
    const emps = await query(
      'SELECT * FROM `sys_emp` WHERE `phone` = {{phone}} LIMIT 1',
      { phone }
    )

    if (emps.length > 0) {
      const emp = emps[0]

      // ── 3. 校验密码（SHA-256 + salt 哈希比对） ──────────────────
      if (emp.password) {
        const salt = emp.password_salt || ''
        const inputHash = hashPassword(password, salt)
        if (inputHash !== emp.password) {
          return {
            code: 0,
            message: '密码错误',
            data: { allowed: true, emp: null, pwdError: true }
          }
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

      // ── 5. 将 openid 写入 sys_emp（若本次获取到了 openid 且与记录不同） ──
      if (openid && emp._openid !== openid) {
        await update(
          'UPDATE `sys_emp` SET `_openid` = {{openid}} WHERE `id` = {{id}}',
          { openid, id: emp.id }
        )
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
            _openid: openid || emp._openid,
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
          emp: null
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
