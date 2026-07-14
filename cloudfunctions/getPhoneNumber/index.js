// 云函数 - 通过微信 phone_code 获取用户手机号
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

exports.main = async (event, context) => {
  const { phone_code } = event

  if (!phone_code) {
    return { code: -1, message: '缺少 phone_code 参数', data: null }
  }

  try {
    // 调用微信接口获取手机号
    // 文档: https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-info/phone-number/getPhoneNumber.html
    const phoneRes = await cloud.openapi.phonenumber.getPhoneNumber({
      code: phone_code
    })

    if (phoneRes && phoneRes.phoneInfo) {
      const { phoneNumber, purePhoneNumber, countryCode } = phoneRes.phoneInfo
      return {
        code: 0,
        message: 'success',
        data: {
          phoneNumber: phoneNumber,         // 完整手机号（含国家码）
          purePhoneNumber: purePhoneNumber, // 纯手机号
          countryCode: countryCode          // 国家码
        }
      }
    }

    return {
      code: -1,
      message: '获取手机号失败',
      data: null
    }
  } catch (err) {
    console.error('获取手机号失败:', err)
    return {
      code: -1,
      message: '获取手机号失败: ' + (err.errMsg || err.message),
      data: null
    }
  }
}
