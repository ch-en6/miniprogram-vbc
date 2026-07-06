// utils/const.js — 全局常量定义

// ─── 餐次 ────────────────────────────────────────────────────
/** 餐次类型 */
const MEAL_TYPE = {
  BREAKFAST: 'breakfast',
  LUNCH:     'lunch',
  DINNER:    'dinner',
}

/** 餐次显示名称 */
const MEAL_TYPE_LABEL = {
  [MEAL_TYPE.BREAKFAST]: '早餐',
  [MEAL_TYPE.LUNCH]:     '午餐',
  [MEAL_TYPE.DINNER]:    '晚餐',
}

/** 餐次顺序（用于排序、遍历） */
const MEAL_TYPE_ORDER = [MEAL_TYPE.BREAKFAST, MEAL_TYPE.LUNCH, MEAL_TYPE.DINNER]

// ─── 报餐状态 ────────────────────────────────────────────────
const BOOK_STATUS = {
  BOOKED:    'booked',
  CANCELLED: 'cancelled',
  NOT_BOOKED:'not_booked',
}

const BOOK_STATUS_LABEL = {
  [BOOK_STATUS.BOOKED]:     '已报餐',
  [BOOK_STATUS.CANCELLED]:  '已取消',
  [BOOK_STATUS.NOT_BOOKED]: '未报餐',
}

// ─── 用户角色 ────────────────────────────────────────────────
const ROLE = {
  EMPLOYEE:   'employee',
  KITCHEN:    'kitchen',
  DEPT_ADMIN: 'dept_admin',
  SYS_ADMIN:  'sys_admin',
}

const ROLE_LABEL = {
  [ROLE.EMPLOYEE]:   '员工',
  [ROLE.KITCHEN]:    '食堂管理员',
  [ROLE.DEPT_ADMIN]: '部门管理员',
  [ROLE.SYS_ADMIN]:  '系统管理员',
}

// ─── 截止时间 ────────────────────────────────────────────────
/** 报餐截止时间：前一天 17:00 */
const BOOK_DEADLINE_HOUR   = 17
const BOOK_DEADLINE_MINUTE = 0

// ─── 本地存储 Key ────────────────────────────────────────────
const STORAGE_KEYS = {
  ACCESS_TOKEN:  'access_token',
  REFRESH_TOKEN: 'refresh_token',
  USER_INFO:     'user_info',
  LAST_LOGIN:    'last_login',
}

// ─── 价格 ────────────────────────────────────────────────────
/** 默认餐价（元），实际应从系统配置接口获取 */
const DEFAULT_MEAL_PRICE = {
  [MEAL_TYPE.BREAKFAST]: 5,
  [MEAL_TYPE.LUNCH]:     10,
  [MEAL_TYPE.DINNER]:    8,
}

/** 家属餐加收比例（如 0.5 = 额外 50%） */
const FAMILY_MEAL_SURCHARGE_RATE = 0.5

// ─── 分页 ────────────────────────────────────────────────────
const PAGE_SIZE = 20

// ─── 月份格式 ────────────────────────────────────────────────
const MONTH_FORMAT = 'YYYY-MM'
const DATE_FORMAT  = 'YYYY-MM-DD'

module.exports = {
  MEAL_TYPE,
  MEAL_TYPE_LABEL,
  MEAL_TYPE_ORDER,
  BOOK_STATUS,
  BOOK_STATUS_LABEL,
  ROLE,
  ROLE_LABEL,
  BOOK_DEADLINE_HOUR,
  BOOK_DEADLINE_MINUTE,
  STORAGE_KEYS,
  DEFAULT_MEAL_PRICE,
  FAMILY_MEAL_SURCHARGE_RATE,
  PAGE_SIZE,
  MONTH_FORMAT,
  DATE_FORMAT,
}
