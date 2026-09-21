// subpackages/dept/pages/menu/index.js — 部门工作台 · 菜单配置
// 数据源：menu_plan（菜单计划）+ menu_daily（按周循环的菜品明细）
// 权限模型与部门工作台其他页一致：openid -> sys_emp.role_id
//   -> sys_role_location -> location_id[]（食堂），所有读写限定在管辖食堂范围内。
// 「当前食堂」来自 store.state.locations（getMyDepts 返回的角色管辖食堂），
const store = require('../../../../utils/dept-store')
const { MenuAPI } = require('../../../../services/api')
const T = require('../../../../utils/time')
const Toast = require('@vant/weapp/toast/toast').default
const Dialog = require('@vant/weapp/dialog/dialog').default

const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

// 新建菜单计划的默认周期：本月 1 日 ~ 本月最后一天
function defaultPlanRange() {
  return T.getMonthRange(T.formatMonth(new Date()))
}

// 7 天空菜品表（周一~周日 × 早/午/晚），与后端 menu_daily 的 day_of_week(1~7) 对齐
function emptyDays() {
  return WEEK_LABELS.map((label, i) => ({
    day_of_week: i + 1,
    label,
    bf: '',
    lunch: '',
    dinner: '',
  }))
}

Page({
  data: {
    // ── 食堂 + 计划列表 ──
    locations: [],            // 当前角色管辖的食堂 [{ id, name }]
    currentLocationIndex: 0,  // 列表筛选用
    hasPermission: true,      // 角色范围内是否有任何食堂
    canAddPlan: true,         // 当前所选食堂是否启用（status=1），停用时禁用「新增菜单计划」
    planList: [],             // 当前食堂的菜单计划（每项含 is_active / in_range 标记）
    activePlanId: 0,          // 当前正在生效（轮换选中）的计划 id；0 = 无任何计划在生效
    loading: false,

    // ── 新增 / 编辑弹窗 ──
    showForm: false,
    formMode: 'add',          // 'add' | 'edit'
    formTitle: '新增菜单计划',
    form: { id: 0, name: '', status: 1, start_date: '', end_date: '' },
    formLocations: [],        // 表单内可选食堂（仅启用中 status=1 的食堂）
    formLocationIndex: 0,
    formLocationLocked: false, // 编辑时原食堂已停用 → 锁定为原食堂不可改，防保存时被静默挪走
    formLocationName: '',
    days: [],                 // 7 天 × 3 餐菜品网格
    dayTabIndex: 0,           // 菜品 Tab 当前下标（0 = 周一）
    loadingDetail: false,     // 编辑时拉取详情中
    saving: false,
  },

  onShow() {
    if (wx.hideHomeButton) wx.hideHomeButton()
    this._ensureLocationsAndLoad()
  },

  // 食堂列表就绪后，恢复本页所选食堂并拉取菜单计划
  async _ensureLocationsAndLoad() {
    await store.ensureDepts()
    const locations = store.state.locations || []
    const hasPermission = locations.length > 0
    const remembered = (store.state && store.state.menu) || {}
    const fallback = store.defaultLocationIndex ? store.defaultLocationIndex() : 0
    const idx = (typeof remembered.locationIndex === 'number'
      && remembered.locationIndex < locations.length)
      ? remembered.locationIndex
      : (fallback < locations.length ? fallback : 0)

    this.setData({ locations, hasPermission, currentLocationIndex: idx, canAddPlan: this._isLocationEnabled(locations[idx]) })
    if (!hasPermission) {
      this.setData({ planList: [], activePlanId: 0 })
      return
    }
    this._loadPlanList()
  },

  // 拉取当前食堂的菜单计划列表
  // silent=true 时不切换页内 loading（供下拉刷新使用，避免与原生刷新指示器重复）
  async _loadPlanList(silent = false) {
    if (!this.data.hasPermission) {
      this.setData({ planList: [], activePlanId: 0 })
      return
    }
    const location = this.data.locations[this.data.currentLocationIndex] || {}
    const locationId = Number(location.id) || 0
    if (!silent) this.setData({ loading: true })
    const today = T.formatDate(new Date())
    try {
      const data = await MenuAPI.getMenuPlans({ locationId })
      const list = ((data && data.list) || []).map(p => ({
        ...p,
        not_started: Number(p.status) === 1 && p.start_date && p.start_date > today,
        expired: Number(p.status) === 1 && p.end_date && p.end_date < today,
      }))
      this.setData({
        planList: list,
        activePlanId: Number(data && data.active_plan_id) || 0,
      })
      // 记忆最近一次结果，切 Tab 回来时可立即看到上次内容
      store.setMenu({
        planList: list,
        hasQueried: true,
        queriedLocationId: String(locationId),
      })
    } catch (err) {
      this.setData({ planList: [], activePlanId: 0 })
      Toast((err && err.message) || '加载菜单计划失败')
    } finally {
      if (!silent) this.setData({ loading: false })
    }
  },

  // ── 食堂选择 ────────────────────────────────────────
  onLocationChange(e) {
    const index = Number(e.detail.value) || 0
    if (index === this.data.currentLocationIndex) return
    store.setMenu({
      locationIndex: index,
      planList: [],
      hasQueried: false,
      queriedLocationId: '',
    })
    this.setData({ currentLocationIndex: index, canAddPlan: this._isLocationEnabled(this.data.locations[index]) })
    this._loadPlanList()
  },

  // ── 下拉刷新 ──────────────
  async onPullDownRefresh() {
    if (!this.data.hasPermission) {
      wx.stopPullDownRefresh()
      return
    }
    // 强制重拉食堂列表（食堂启用/停用状态可能已被修改），再重新初始化页面
    await store.refreshDepts()
    store.setMenu({ hasQueried: false }) // 下拉刷新要求最新数据，跳过缓存秒显
    await this._ensureLocationsAndLoad()
    wx.stopPullDownRefresh()
  },

  // ── 新增菜单计划 ────────────────────────────────────
  _buildFormLocations() {
    return (this.data.locations || []).filter(
      l => l && Number(l.status) === 1
    )
  },

  // 当前食堂是否启用（status=1）：停用时「新增菜单计划」按钮置灰禁用
  _isLocationEnabled(loc) {
    return Number(loc && loc.status) === 1
  },

  onAddPlan() {
    if (!this.data.hasPermission) return Toast('当前账号暂无可管理的食堂')
    // 当前食堂已停用时不允许新增（需先在顶部切换到启用中的食堂）
    if (!this.data.canAddPlan) return Toast('当前食堂已停用，无法新增菜单计划')
    const formLocations = this._buildFormLocations()
    if (!formLocations.length) return Toast('当前没有启用中的食堂，无法新增')
    const current = this.data.locations[this.data.currentLocationIndex] || {}
    const curIdx = formLocations.findIndex(l => Number(l.id) === Number(current.id))
    const range = defaultPlanRange()
    this.setData({
      showForm: true,
      formMode: 'add',
      formTitle: '新增菜单计划',
      formLocations,
      formLocationIndex: curIdx >= 0 ? curIdx : 0,
      formLocationLocked: false,
      formLocationName: '',
      form: { id: 0, name: '', status: 1, start_date: range.start, end_date: range.end },
      days: emptyDays(),
      dayTabIndex: 0,
      loadingDetail: false,
    })
  },

  // ── 编辑菜单计划（先拉取完整的 7 天菜品明细） ────────
  async onEditPlan(e) {
    const id = Number(e.currentTarget.dataset.id) || 0
    if (id <= 0) return
    this.setData({
      showForm: true,
      formMode: 'edit',
      formTitle: '编辑菜单计划',
      form: { id, name: '', status: 1, start_date: '', end_date: '', location_id: 0 },
      formLocations: this._buildFormLocations(),
      formLocationIndex: 0,
      formLocationLocked: false,
      formLocationName: '',
      days: emptyDays(),
      dayTabIndex: 0,
      loadingDetail: true,
    })
    try {
      const data = await MenuAPI.getMenuPlanDetail({ id })
      const days = (data && Array.isArray(data.days) && data.days.length)
        ? data.days
        : emptyDays()
      const detailLocationId = Number(data && data.location_id) || 0
      const formLocations = this.data.formLocations.length
        ? this.data.formLocations
        : this._buildFormLocations()
      const locIdx = formLocations.findIndex(l => Number(l.id) === detailLocationId)
      this.setData({
        form: {
          id: Number(data && data.id) || id,
          name: (data && data.name) || '',
          status: Number(data && data.status) === 0 ? 0 : 1,
          start_date: (data && data.start_date) || '',
          end_date: (data && data.end_date) || '',
          location_id: detailLocationId,
        },
        days,
        formLocations,
        // 原食堂已停用（不在启用列表）时锁定为原食堂，避免保存时被静默挪到别的食堂
        formLocationLocked: locIdx < 0,
        formLocationIndex: locIdx >= 0 ? locIdx : 0,
        formLocationName: locIdx >= 0
          ? ''
          : ((this.data.locations.find(l => Number(l.id) === detailLocationId) || {}).name || '原食堂'),
      })
    } catch (err) {
      this.setData({ showForm: false })
      Toast((err && err.message) || '加载菜单详情失败')
    } finally {
      this.setData({ loadingDetail: false })
    }
  },

  // ── 删除菜单计划（连带菜品明细） ─────────────────────
  onDeletePlan(e) {
    const id = Number(e.currentTarget.dataset.id) || 0
    const item = this.data.planList.find(p => p.id === id)
    if (!item) return Toast('未找到该菜单计划')
    Dialog.confirm({
      title: '删除菜单计划',
      message: `确认删除「${item.name}」吗？该计划下的全部菜品明细将一并删除。`,
      confirmButtonText: '删除',
      confirmButtonColor: '#ee0a24',
    }).then(async () => {
      try {
        await MenuAPI.deleteMenuPlan({ id })
        Toast('已删除')
        this._loadPlanList()
      } catch (err) {
        Toast((err && err.message) || '删除失败')
      }
    }).catch(() => { /* 取消 */ })
  },

  // ── 表单弹窗 ───────────────────────────────────────
  onFormClose() {
    if (this.data.saving) return
    this.setData({ showForm: false })
  },

  // 阻止冒泡：点击弹窗内容时不要关闭弹窗
  onFormNoop() {},

  onFormFieldChange(e) {
    const { field } = e.currentTarget.dataset
    this.setData({ [`form.${field}`]: e.detail })
  },

  // 表单内切换所属食堂
  onFormLocationChange(e) {
    this.setData({ formLocationIndex: Number(e.detail.value) || 0 })
  },

  onFormStatusChange(e) {
    this.setData({ 'form.status': e.detail ? 1 : 0 })
  },

  onStartDateChange(e) {
    const start_date = e.detail.value
    const end_date = this.data.form.end_date && start_date > this.data.form.end_date
      ? start_date
      : this.data.form.end_date
    this.setData({ 'form.start_date': start_date, 'form.end_date': end_date })
  },

  onEndDateChange(e) {
    const end_date = e.detail.value
    const start_date = this.data.form.start_date && this.data.form.start_date > end_date
      ? end_date
      : this.data.form.start_date
    this.setData({ 'form.start_date': start_date, 'form.end_date': end_date })
  },

  onDayTabChange(e) {
    this.setData({ dayTabIndex: Number(e.detail.index) || 0 })
  },

  // 菜品输入：写入 days[day].{bf|lunch|dinner}
  onDishChange(e) {
    const { day, meal } = e.currentTarget.dataset
    const idx = Number(day)
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.data.days.length) return
    this.setData({ [`days[${idx}].${meal}`]: e.detail })
  },

  async onFormSubmit() {
    const {
      form, days, formLocations, formLocationIndex,
      formLocationLocked, formLocationName, formMode,
    } = this.data
    const name = (form.name || '').trim()
    // 锁定态（原食堂已停用）按原食堂提交；否则取表单内所选食堂
    const location = formLocationLocked
      ? { id: form.location_id, name: formLocationName }
      : (formLocations[formLocationIndex] || {})
    const locationId = Number(location.id) || 0

    if (!name) return Toast('请填写菜单名称')
    if (locationId <= 0) return Toast('请选择食堂')
    if (!form.start_date) return Toast('请选择开始日期')
    if (!form.end_date) return Toast('请选择结束日期')
    if (form.end_date < form.start_date) return Toast('结束日期不能早于开始日期')

    this.setData({ saving: true })
    try {
      await MenuAPI.saveMenuPlan({
        id: form.id,
        name,
        locationId,
        status: Number(form.status) === 0 ? 0 : 1,
        startDate: form.start_date,
        endDate: form.end_date,
        days: (days || []).map(d => ({
          day_of_week: d.day_of_week,
          bf: d.bf,
          lunch: d.lunch,
          dinner: d.dinner,
        })),
      })
      this.setData({ showForm: false })
      Toast(formMode === 'edit' ? '已保存' : '已创建')
      // 归属食堂与顶部所选不一致时，顶部切到该食堂，让用户立刻看到新计划
      const idx = this.data.locations.findIndex(l => Number(l.id) === locationId)
      if (idx > -1 && idx !== this.data.currentLocationIndex) {
        store.setMenu({
          locationIndex: idx,
          planList: [],
          hasQueried: false,
          queriedLocationId: '',
        })
        this.setData({ currentLocationIndex: idx, canAddPlan: this._isLocationEnabled(this.data.locations[idx]) })
      }
      this._loadPlanList()
    } catch (err) {
      Toast((err && err.message) || '保存失败')
    } finally {
      this.setData({ saving: false })
    }
  },
})
