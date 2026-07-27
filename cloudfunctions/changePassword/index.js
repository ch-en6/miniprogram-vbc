// 云函数 - 修改密码（SHA-256 + salt 哈希存储）
const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

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
  const { empId, oldPassword, newPassword } = event

  if (!empId || !oldPassword || !newPassword) {
    return { code: -1, message: '缺少必要参数', data: null }
  }

  if (newPassword.length < 8) {
    return { code: -1, message: '新密码至少8位', data: null }
  }

  try {
    // 查询员工记录
    const empRes = await db.collection('sys_emp').doc(empId).get()
    const emp = empRes.data

    if (!emp) {
      return { code: -1, message: '员工不存在', data: null }
    }

    // 校验旧密码（哈希比对）
    if (emp.password) {
      const salt = emp.passwordSalt || ''
      const oldHash = hashPassword(oldPassword, salt)
      if (oldHash !== emp.password) {
        return { code: -1, message: '旧密码错误', data: null }
      }
      // if(emp.password !== oldPassword) {
      //   return { code: -1, message: '旧密码错误', data: null }
      // }
    }

    // 生成新盐值 + 哈希新密码
    const newSalt = generateSalt()
    const newHash = hashPassword(newPassword, newSalt)
    const now = new Date()

    // 更新密码和盐值
    await db.collection('sys_emp').doc(empId).update({
      data: {
        password: newHash,
        passwordSalt: newSalt,
        updated_at: now
      }
    })

    console.log('[changePassword] 密码修改成功, empId:', empId)
    return { code: 0, message: '密码修改成功', data: null }
  } catch (err) {
    console.error('修改密码失败:', err)
    return { code: -1, message: '修改失败: ' + err.message, data: null }
  }
}
