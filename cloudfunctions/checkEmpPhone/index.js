// 云函数 - 校验手机号是否在 sys_emp 表中
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  const { phone } = event

  if (!phone) {
    return { code: -1, message: '缺少手机号参数', data: null }
  }

  try {
    // 查询 sys_emp 表中该手机号对应的员工
    const res = await db.collection('sys_emp')
      .where({ phone: phone })
      .limit(1)
      .get()

    if (res.data && res.data.length > 0) {
      const emp = res.data[0]
      return {
        code: 0,
        message: 'success',
        data: {
          allowed: true,
          emp: {
            _id: emp._id,
            name: emp.name || '',
            phone: emp.phone,
            _openid: emp._openid,
            dept_id: emp.dept_id || '',
            role: emp.role || ['employee'],
            status: emp.status || 'active', // active=正常, disabled=停用
          }
        }
      }
    } else {
      // 手机号不在 sys_emp 表中，不允许登录
      return {
        code: 0,
        message: '该手机号未注册，请联系管理员',
        data: {
          allowed: false,
          emp: null
        }
      }
    }
  } catch (err) {
    console.error('校验员工手机号失败:', err)
    return {
      code: -1,
      message: '查询失败: ' + err.message,
      data: null
    }
  }
}
