// 云函数 - 读取价格配置（从云 MySQL price_config 表读取）
// 读取逻辑：
//   1. 必传 dept_id（部门ID，来自登录用户）
//   2. 在 price_config 中查询该部门 status = 1（启用）的价格记录
//   3. 有效期校验：当前日期在 [start_date, end_date] 区间内
//   4. 按餐次（breakfast/lunch/dinner）组装返回
//      { emp_price, family_price, start_date, end_date }
//
const cloud = require('wx-server-sdk')
const cloudbaseSDK = require('@cloudbase/node-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const cloudbase = cloudbaseSDK.init({
  env: cloudbaseSDK.SYMBOL_CURRENT_ENV
})
const models = cloudbase.models

/**
 * meal_type 数值 -> 前端餐次字符串映射
 * price_config.meal_type 为 TINYINT，约定：0=早餐、1=午餐、2=晚餐
 */
const MEAL_TYPE_MAP = {
  0: 'breakfast',
  1: 'lunch',
  2: 'dinner',
}

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
 * 格式化日期为 YYYY-MM-DD
 * @param {any} dateVal - Date / 时间戳 / 'YYYY-MM-DD' 字符串等
 * @returns {string}
 */
function formatDate(dateVal) {
  if (!dateVal) return ''
  const d = new Date(dateVal)
  if (isNaN(d.getTime())) return String(dateVal)
  const pad = (n) => (n < 10 ? '0' + n : n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

exports.main = async (event, context) => {
  try {
    const { dept_id } = event

    if (!dept_id) {
      return { code: -1, message: '缺少部门ID参数(dept_id)', data: null }
    }

    // 查询该部门启用的价格配置（含有效期校验，规则见文件头注释）
    const rows = await query(
      'SELECT * FROM `price_config` ' +
      'WHERE `dept_id` = {{dept_id}} AND `status` = 1 ' +
      'AND `start_date` <= CURDATE() AND `end_date` >= CURDATE()',
      { dept_id }
    )

    // 按餐次组装，未配置的餐次置为 null（前端有默认价兜底）
    const config = {}
    ;['breakfast', 'lunch', 'dinner'].forEach(meal => {
      const row = rows.find(r => MEAL_TYPE_MAP[r.meal_type] === meal)
      config[meal] = row
        ? {
            emp_price: Number(row.emp_price) || 100,
            family_price: Number(row.family_price) || 1000,
            start_date: formatDate(row.start_date),
            end_date: formatDate(row.end_date),
          }
        : null
    })

    return {
      code: 0,
      message: 'success',
      data: config
    }
  } catch (err) {
    console.error('[getPriceConfig] 读取价格配置失败:', err)
    return {
      code: -1,
      message: '读取价格配置失败: ' + (err.message || err),
      data: null
    }
  }
}
