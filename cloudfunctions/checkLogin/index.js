// 云函数 - 账号密码登录校验 + code换openid写入sys_emp
const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 小程序 appID（用于 code2Session）
const APPID = 'wxbe7fe7f3f81cb261'

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
        // 方式一：使用 cloud.getOpenId()（云函数内直接获取当前用户 openid）
        // 注意：此方式仅在用户通过 wx.login 后、且云函数在用户上下文中调用时有效
        // 更可靠的方式是用 code2Session 接口
        const res = await cloud.openapi('code2Session', {
          jsCode: loginCode
        })
        openid = res.openid
        console.log('[checkLogin] code2Session success, openid:', openid)
      } catch (codeErr) {
        console.warn('[checkLogin] code2Session 失败，尝试 cloud.getOpenId():', codeErr)
        // 方式二：降级使用 cloud.getOpenId()
        try {
          const wxContext = cloud.getWXContext()
          openid = wxContext.OPENID || null
          if (openid) {
            console.log('[checkLogin] 使用 WXContext OPENID:', openid)
          }
        } catch (e2) {
          console.warn('[checkLogin] cloud.getOpenId() 也失败:', e2)
        }
      }
    }

    // ── 2. 查询 sys_emp 表中该手机号对应的员工 ────────────────────
    const res = await db.collection('sys_emp')
      .where({ phone: phone })
      .limit(1)
      .get()

    if (res.data && res.data.length > 0) {
      const emp = res.data[0]

      // ── 3. 校验密码（SHA-256 + salt 哈希比对） ──────────────────
      if (emp.password) {
        const salt = emp.passwordSalt || ''
        const inputHash = hashPassword(password, salt)
        if (inputHash !== emp.password) {
          return {
            code: 0,
            message: '密码错误',
            data: { allowed: true, emp: null, pwdError: true }
          }
        }
      }

      // 获取角色ID数组（兼容旧字段 role 和新字段 role_id）
      const role_ids = emp.role || []

      // 通过 role_id 查询 sys_role 获取角色 code
      let role_codes = []
      if (role_ids.length > 0) {
        const roleRes = await db.collection('sys_role')
          .where({ _id: _.in(role_ids) })
          .field({ code: true })
          .get()
        role_codes = (roleRes.data || []).map(r => r.code).filter(Boolean)
      }

      // ── 4. 将 openid 写入 sys_emp（若本次获取到了 openid 且与记录不同） ──
      if (openid && emp._openid !== openid) {
        await db.collection('sys_emp').doc(emp._id).update({
          data: { _openid: openid }
        })
        console.log('[checkLogin] openid 已写入 sys_emp:', emp._id)
      }

      return {
        code: 0,
        message: 'success',
        data: {
          allowed: true,
          pwdError: false,
          emp: {
            _id: emp._id,
            name: emp.name || '',
            phone: emp.phone,
            _openid: openid || emp._openid,
            dept_id: emp.dept_id || '',
            role_id: role_ids,
            role_codes: role_codes,
            status: emp.status !== undefined ? emp.status : 1,
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
