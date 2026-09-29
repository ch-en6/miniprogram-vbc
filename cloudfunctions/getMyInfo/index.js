// 云函数 - 获取当前登录用户信息（按 openid 反查，通过 @cloudbase/node-sdk 访问云 MySQL）
// 用途：小程序冷启动时本地 user_info 缓存过期后的静默刷新，
//       保证后台修改的角色/部门/停用状态能及时同步到客户端。
const cloud = require('wx-server-sdk')
const cloudbaseSDK = require('@cloudbase/node-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const cloudbase = cloudbaseSDK.init({
  env: cloudbaseSDK.SYMBOL_CURRENT_ENV
})
const models = cloudbase.models

async function query(sql, params = {}) {
  const result = await models.$runSQL(sql, params)
  return (result && result.data && result.data.executeResultList) || []
}

exports.main = async (event, context) => {
  try {
    // ── 1. 取调用者 openid（云函数免鉴权自动注入） ──────────────
    const wxContext = cloud.getWXContext()
    const openid = (wxContext && wxContext.OPENID) || null

    if (!openid) {
      return { code: 0, message: '无法获取用户身份', data: { allowed: false, emp: null, message: '无法获取用户身份' } }
    }

    const maskOpenid = oid => (oid.length > 8 ? oid.slice(0, 8) + '****' : '****')

    // ── 2. 按 openid 反查 sys_emp（一人一微信一账号） ───────────
    const emps = await query(
      'SELECT * FROM `sys_emp` WHERE `_openid` = {{openid}} LIMIT 1',
      { openid }
    )

    if (emps.length === 0) {
      console.log('[getMyInfo] 未找到绑定账号, openid:', maskOpenid(openid))
      return {
        code: 0,
        message: '登录已失效，请重新登录',
        data: { allowed: false, emp: null, message: '登录已失效，请重新登录' }
      }
    }

    const emp = emps[0]

    // ── 3. 员工已被停用 → 不允许恢复登录态 ─────────────────────
    if (emp.status !== undefined && emp.status !== null && Number(emp.status) === 0) {
      return {
        code: 0,
        message: '该账号已被停用，请联系管理员',
        data: { allowed: false, emp: null, message: '该账号已被停用，请联系管理员' }
      }
    }

    // ── 4. 反查角色 code ───────────────────────────────────────
    const role_id = emp.role_id || null
    let role_code = null
    if (role_id) {
      const role = await query(
        'SELECT `code` FROM `sys_role` WHERE `id` = {{role_id}}',
        { role_id }
      )
      role_code = role.length ? role[0].code : null
    }

    // ── 5. 联查部门名称与 location_id（与 checkLogin 保持一致） ─
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
        console.warn('[getMyInfo] 查询部门信息失败:', deptErr)
      }
    }

    return {
      code: 0,
      message: 'success',
      data: {
        allowed: true,
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
  } catch (err) {
    console.error('[getMyInfo] error:', err)
    return { code: -1, message: '查询失败: ' + err.message, data: null }
  }
}
