// 云函数 - 获取轮换菜单（@cloudbase/node-sdk 访问云 MySQL menu_plan + menu_daily 表）
//
// 数据模型：
//   menu_plan       一行 = 一份菜单计划（含生效日期范围 status=1 + start_date/end_date）
//   menu_daily      一行 = (plan_id, day_of_week 1-7, meal_type 0/1/2) 的菜品串
//                   meal_type: 0=早餐(bf)  1=午餐(lunch)  2=晚餐(dinner)
//                   dish 字段是该餐的全部菜品（已用"、"分隔）
//
// 前端契约（沿用 pages/menu/index.js 的 getCurrentMenu）：
//   res.result.data = {
//     plan: { id, name, start_date, end_date, location_id },
//     meals: [{ bf, lunch, dinner }, ...]   // 7 天，index 0 对应 day_of_week=1（周一）
//   }
//
// 轮换策略：当前日期落在多张 plan 的区间内时，按"年内周数 % plan 数"轮换取一张。
const cloud = require('wx-server-sdk')
const cloudbaseSDK = require('@cloudbase/node-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const cloudbase = cloudbaseSDK.init({
  env: cloudbaseSDK.SYMBOL_CURRENT_ENV
})
const models = cloudbase.models

// day_of_week 1~7 -> 索引 0~6
const DAYS_PER_PLAN = 7

// meal_type -> 前端 meals[].{字段}
const MEAL_FIELD = {
  0: 'bf',
  1: 'lunch',
  2: 'dinner',
}

/**
 * 执行 SQL（参数用 {{key}} 绑定，依赖 CloudBase $runSQL 语法）
 * 返回 executeResultList（行对象数组）
 */
async function runSQL(sql, params = {}) {
  console.log('[getMenuList][DEBUG] $runSQL ->', sql)
  console.log('[getMenuList][DEBUG] params ->', JSON.stringify(params))
  try {
    const result = await models.$runSQL(sql, params)
    return (result && result.data && result.data.executeResultList) || []
  } catch (err) {
    console.error(
      '[getMenuList][DEBUG] SQL FAILED:',
      err.message || err,
      '\nSQL:', sql,
      '\nPARAMS:', JSON.stringify(params)
    )
    throw err
  }
}

/**
 * 自然周序号：以周一为一周开始（周一~周日），
 * 从 1970-01-05（周一）起算经过的完整周数。
 * 同一自然周内恒定不变，跨周 +1，无跨年跳变。
 */
function naturalWeekIndex(date) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const MONDAY_EPOCH = new Date(1970, 0, 5).getTime() // 1970-01-05 是周一
  return Math.floor((day.getTime() - MONDAY_EPOCH) / (7 * 86400000))
}

/**
 * 输入 2026-08-11、2026-08-11T17:02:45、Date 等，输出 YYYY-MM-DD；异常时原样返回。
 */
function ymd(val) {
  if (val == null || val === '') return ''
  if (typeof val === 'string') {
    const m = val.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) {
      return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
    }
  }
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val)
  const pad = n => (n < 10 ? '0' + n : n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

exports.main = async (event, context) => {
  try {
    // 0. 校验用户部门（菜单必须与当前用户的 location_id 一致）
    const location_id = event.location_id
    if (location_id == null || location_id === '') {
      return { code: -1, message: '缺少部门参数(location_id)', data: null }
    }

    // 1. 取当前生效的所有菜单计划（status=1、location 匹配、今天落在 start_date~end_date 内）
    const plans = await runSQL(
      'SELECT `id`, `name`, `status`, `start_date`, `end_date`, `location_id` ' +
      'FROM `menu_plan` ' +
      'WHERE `status` = 1 ' +
      '  AND `location_id` = {{location_id}} ' +
      '  AND `start_date` <= CURDATE() ' +
      '  AND `end_date`   >= CURDATE()',
      { location_id }
    )

    if (!plans || plans.length === 0) {
      return { code: -1, message: '暂无菜单', data: null }
    }

    // 2. 兼容 name 存的是字符串 "1""2"——按数字大小稳定排序
    plans.sort((a, b) => {
      const na = parseInt(a.name) || 0
      const nb = parseInt(b.name) || 0
      return na - nb
    })

    // 3. 多 plan 时按自然周轮换：以最早 start_date 所在自然周为第 1 周
    //    例：start_date = 9月1日(周二) →
    //       9/1~9/6（该自然周）     第 1 周 → 菜单1
    //       9/7~9/13（下一自然周）   第 2 周 → 菜单2
    //    同一自然周内恒定，跨周 +1，超过 plan 数回到第 1 张
    const now = new Date()
    let picked
    if (plans.length > 1) {
      const anchor = new Date(
        Math.min(...plans.map(p => new Date(ymd(p.start_date) + 'T00:00:00').getTime()))
      )
      const weekDiff = naturalWeekIndex(now) - naturalWeekIndex(anchor)
      picked = plans[weekDiff % plans.length]
    } else {
      picked = plans[0]
    }
    const planId = Number(picked.id)

    // 4. 拉取该 plan 的所有每日菜品（7 天 × 3 餐 = 至多 21 行）
    const dailies = await runSQL(
      'SELECT `day_of_week`, `meal_type`, `dish` ' +
      'FROM `menu_daily` ' +
      'WHERE `plan_id` = {{plan_id}} ' +
      'ORDER BY `day_of_week` ASC, `meal_type` ASC',
      { plan_id: planId }
    )

    // 5. 按 day_of_week 聚合为 7 天的 meals 数组（前端契约不变）
    const meals = []
    for (let i = 0; i < DAYS_PER_PLAN; i++) {
      meals.push({ bf: '', lunch: '', dinner: '' })
    }
    dailies.forEach(r => {
      const dow = Number(r.day_of_week)
      const mt = Number(r.meal_type)
      const field = MEAL_FIELD[mt]
      if (field && dow >= 1 && dow <= DAYS_PER_PLAN) {
        meals[dow - 1][field] = r.dish || ''
      }
    })

    return {
      code: 0,
      message: 'success',
      data: {
        plan: {
          id: picked.id,
          name: picked.name,
          status: picked.status,
          start_date: ymd(picked.start_date),
          end_date: ymd(picked.end_date),
          location_id: picked.location_id,
        },
        meals,
      },
    }
  } catch (err) {
    console.error('[getMenuList] 获取菜单失败:', err)
    return {
      code: -1,
      message: '获取菜单失败: ' + (err.message || err),
      data: null
    }
  }
}
