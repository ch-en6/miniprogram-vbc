// utils/dept-store.js — 部门工作台（员工 / 统计 / 收费）三页共享状态
// 三页为独立页面，页间通过 wx.redirectTo 互斥切换（原页面会被卸载）。
// 设计约定：
//  - 「部门列表」是静态数据，进程内共享缓存（只拉取一次），避免各页重复请求；
//  - 「当前选中的部门」按页私有（staff / stats / billing 各自记忆，互不影响），
//    字段值 null 表示本页尚未选过，进入时用默认（用户所在部门优先）；
//  - 统计条件 / 收费月份 / 各页最近结果同样只由对应页面读写，天然按页隔离。
const T = require('./time')
const { KitchenAPI } = require('../services/api')

const state = {
  // ── 部门列表（同一会话内成功加载后缓存） ──
  depts: [],
  _deptLoaded: false,
  _deptLoading: false,
  _deptPromise: null,

  // ── 员工页：本页所选部门 + 搜索词（仅员工页读写） ──
  staff: {
    deptIndex: null,   // 本页记忆的部门选择；null=未选过，进入时取默认
    searchKey: '',
  },

  // ── 统计页：本页所选部门 + 筛选条件 + 最近一次结果（仅统计页读写） ──
  stats: {
    deptIndex: null,
    startDate: '',
    endDate: '',
    quickType: '',       // '' / curMonth / prevMonth / curWeek / prevWeek
    pickerStart: '',
    pickerEnd: '',
    statList: [],
    hasQueried: false,
    resultKey: '',       // 统计结果对应的条件键（含部门），防止陈旧结果串页展示
  },

  // ── 收费页：本页所选部门 + 月份 + 最近一次结果（仅收费页读写） ──
  billing: {
    deptIndex: null,
    selectedMonth: '',
    monthPickerEnd: '',
    queriedMonth: '',    // 最近一次成功查询的月份
    queriedDeptId: '',   // 最近一次成功查询的部门，恢复结果时一并校验
    billingList: [],
    totalAmount: 0,
    hasQueried: false,
  },
}

/** 默认部门：优先当前用户所在部门（在权限范围内时），否则第一个 */
function defaultDeptIndex() {
  const depts = state.depts
  if (!depts || depts.length === 0) return 0
  const app = getApp()
  const deptId = (app.globalData.userInfo || {}).dept_id
  const idx = depts.findIndex(d => Number(d.dept_id) === Number(deptId))
  return idx > -1 ? idx : 0
}

/** 拉取当前用户管理的部门列表；同一会话内只成功拉取一次（失败下次重试） */
function ensureDepts() {
  if (state._deptLoaded) return Promise.resolve(state.depts)
  if (state._deptLoading) return state._deptPromise || Promise.resolve(state.depts)

  state._deptLoading = true
  state._deptPromise = KitchenAPI.getMyDepts()
    .then(res => {
      const depts = ((res && res.depts) || []).filter(d => d && d.dept_name)
      state.depts = depts
      state._deptLoaded = true
      return depts
    })
    .catch(err => {
      console.error('[dept-store] loadDepts error:', err)
      state.depts = []
      state._deptLoaded = false
      return state.depts
    })
    .finally(() => {
      state._deptLoading = false
      state._deptPromise = null
    })
  return state._deptPromise
}

function _curMonth() {
  return T.formatMonth(new Date())
}

/** 统计页：首次进入时初始化默认条件（当月），之后沿用上次选择 */
function ensureStatsDefault() {
  const s = state.stats
  if (s.startDate && s.endDate) return
  const range = T.getMonthRange(_curMonth())
  s.startDate = range.start
  s.endDate = range.end
  s.quickType = 'curMonth'
  s.pickerStart = range.start
  s.pickerEnd = range.end
}

/** 收费页：首次进入时初始化默认月份（当前月，禁选未来） */
function ensureBillingDefault() {
  const b = state.billing
  if (b.selectedMonth) return
  b.selectedMonth = _curMonth()
  b.monthPickerEnd = _curMonth()
}

function setStats(patch) {
  Object.assign(state.stats, patch)
}

function setBilling(patch) {
  Object.assign(state.billing, patch)
}

function setStaff(patch) {
  Object.assign(state.staff, patch)
}

module.exports = {
  state,
  defaultDeptIndex,
  ensureDepts,
  ensureStatsDefault,
  ensureBillingDefault,
  setStats,
  setBilling,
  setStaff,
}
