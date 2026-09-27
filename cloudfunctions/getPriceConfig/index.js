// 云函数 - 读取价格配置（从云 MySQL price_config 宽表读取）
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
 * 餐次字段前缀：breakfast -> bf_，lunch -> lunch_，dinner -> dinner_
 */
const MEAL_PREFIX = {
  breakfast: 'bf',
  lunch: 'lunch',
  dinner: 'dinner',
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

/**
 * 从主行取某餐次的价格对象；任一价格为 NULL / 非数值 → 返回 null（该餐未开放）
 */
function pickMeal(row, meal) {
  const prefix = MEAL_PREFIX[meal]
  const empRaw = row[`${prefix}_emp`]
  const famRaw = row[`${prefix}_family`]
  const emp = Number(empRaw)
  const fam = Number(famRaw)
  if (empRaw == null || famRaw == null || isNaN(emp) || isNaN(fam)) {
    return null
  }
  return { emp_price: emp, family_price: fam }
}

exports.main = async (event, context) => {
  try {
    const { dept_id } = event

    if (!dept_id) {
      return { code: -1, message: '缺少部门ID参数(dept_id)', data: null }
    }

    const rows = await query(
      'SELECT * FROM `price_config` ' +
      'WHERE `dept_id` = {{dept_id}} AND `status` = 1 ' +
      'AND `start_date` <= CURDATE() AND `end_date` >= CURDATE() ' +
      'ORDER BY `start_date` DESC, `id` DESC LIMIT 1',
      { dept_id }
    )
    const row = rows.length ? rows[0] : null

    const config = {}
    const startDate = row ? formatDate(row.start_date) : ''
    const endDate = row ? formatDate(row.end_date) : ''
    ;['breakfast', 'lunch', 'dinner'].forEach(meal => {
      const price = row ? pickMeal(row, meal) : null
      config[meal] = price
        ? { ...price, start_date: startDate, end_date: endDate }
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
