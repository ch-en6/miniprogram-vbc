// subpackages/dept/pages/notice/index.js — 部门工作台 · 公告管理
// 数据源：sys_notice（title / content / status / publish_time / location_id）
//   status: 1=已发布（员工端可见），0=草稿（员工端不可见）
const { KitchenAPI, NoticeAPI } = require('../../../../services/api')
const T = require('../../../../utils/time')
const Dialog = require('@vant/weapp/dialog/dialog').default

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 新增公告时预填的发布时间：当前日期 + 当前时刻（HH:mm） */
function defaultPublish() {
  const now = new Date()
  return {
    date: T.formatDate(now),
    hm: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
  }
}

/**
 * 发布时间是否早于当前时刻（精确到分钟）
 * - 日期只可选今天及未来（start 限制），时刻在选今天时不早于当前时刻
 * - 未来时间 = 定时发布：员工端 getLatestNotice 有 publish_time <= NOW() 过滤，到点自动展示
 * - original：打开弹窗时的原发布时间；未修改的原值（可能是过去补录的既有数据）放行
 */
function isPastPublish(dateStr, hmStr, original) {
  if (!dateStr) return false
  const picked = `${dateStr} ${hmStr}`
  if (original && picked === original) return false
  const now = new Date()
  const cur = `${T.formatDate(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  return picked < cur
}

Page({
  data: {
    // ── 食堂 + 公告列表 ──
    locations: [],            // 当前角色管辖的食堂 [{ id, name }]
    currentLocationIndex: 0,  // 列表筛选用
    hasPermission: true,      // 角色范围内是否有任何食堂
    canAddNotice: true,       // 当前所选食堂是否启用（status=1），停用时禁用「新增公告」
    noticeList: [],           // 当前食堂的公告（含草稿，按发布时间倒序）
    loading: false,
    expandedId: 0,            // 正文展开的公告 id；0 = 全部折叠
    today: '',                // 发布时间日期选择下限（不允许选过去，今天起可选；未来 = 定时发布）
    timeMin: '00:00',         // 时刻选择下限：选的日期是今天时收紧为当前时刻

    // ── 搜索 / 筛选（与列表强绑定，切食堂时一并清空） ──
    searchKey: '',            // 标题 / 正文模糊匹配关键词
    statusFilter: 'all',      // 状态筛选：'all' | 1 | 0

    // ── 新增 / 编辑弹窗 ──
    showForm: false,
    formMode: 'add',          // 'add' | 'edit'
    formTitle: '新增公告',
    timeMin: '00:00',         // 时刻选择下限：选的日期是今天时收紧为当前时刻，防止选到过去
    form: {
      id: 0,
      title: '',
      content: '',
      publish_date: '',       // 'YYYY-MM-DD'（留空 = 草稿）
      publish_time_hm: '',    // 'HH:mm'
      location_id: 0,
    },
    formLocations: [],        // 表单内可选食堂（仅启用中 status=1 的食堂）
    formLocationIndex: 0,
    formLocationLocked: false, // 编辑时原食堂已停用 → 锁定为原食堂不可改，防保存时被静默挪走
    formLocationName: '',
    saving: false,
  },

  onShow() {
    if (wx.hideHomeButton) wx.hideHomeButton()
    this._loadLocationsAndNotices()
  },

  async _loadLocationsAndNotices() {
    let locations = []
    try {
      const res = await KitchenAPI.getMyDepts()
      locations = ((res && res.locations) || []).filter(l => l && l.id)
    } catch (err) {
      console.error('[dept notice] loadLocations error:', err)
    }
    const hasPermission = locations.length > 0

    const idx = this._defaultLocationIndex(locations)

    this.setData({
      locations,
      hasPermission,
      currentLocationIndex: idx,
      canAddNotice: this._isLocationEnabled(locations[idx]),
      searchKey: '',
      statusFilter: 'all',
      today: T.formatDate(new Date()),
    })
    if (!hasPermission) {
      this.setData({ noticeList: [] })
      return
    }
    this._loadNoticeList()
  },

  _defaultLocationIndex(locations) {
    const list = locations || []
    if (!list.length) return 0
    const app = getApp()
    const locationId = ((app && app.globalData && app.globalData.userInfo) || {}).location_id
    const idx = list.findIndex(l => Number(l.id) === Number(locationId))
    return idx > -1 ? idx : 0
  },

  // 拉取当前食堂的公告列表
  // silent=true 时不切换页内 loading（供下拉刷新使用，避免与原生刷新指示器重复）
  async _loadNoticeList(silent = false) {
    if (!this.data.hasPermission) {
      this.setData({ noticeList: [] })
      return
    }
    const location = this.data.locations[this.data.currentLocationIndex] || {}
    const locationId = Number(location.id) || 0
    if (!silent) this.setData({ loading: true })
    const keyword = (this.data.searchKey || '').trim()
    // 注意：statusFilter 为 0（草稿）时是合法值，不能用 || 'all' 兜底（0 是 falsy 会被吞掉）
    const status = (this.data.statusFilter === 1 || this.data.statusFilter === 0)
      ? this.data.statusFilter
      : 'all'
    try {
      const data = await NoticeAPI.getNoticeList({ locationId, keyword, status })
      const list = (data && data.list) || []
      this.setData({ noticeList: list, expandedId: 0 })
      this._lastSearchedKey = keyword
      this._lastSearchedStatus = status
    } catch (err) {
      this.setData({ noticeList: [] })
      wx.showToast({ title: (err && err.message) || '加载公告失败', icon: 'none' })
    } finally {
      if (!silent) this.setData({ loading: false })
    }
  },

  // ── 食堂选择 ────────────────────────────────────────
  onLocationChange(e) {
    const index = Number(e.detail.value) || 0
    if (index === this.data.currentLocationIndex) return
    // 切食堂时一并清空搜索/状态，避免用上家的关键词+新食堂查询出意料外结果
    this._lastSearchedKey = ''
    this._lastSearchedStatus = 'all'
    this.setData({ currentLocationIndex: index, searchKey: '', statusFilter: 'all', canAddNotice: this._isLocationEnabled(this.data.locations[index]) })
    this._loadNoticeList()
  },

  // ── 下拉刷新 ──────────────
  async onPullDownRefresh() {
    if (!this.data.hasPermission) {
      wx.stopPullDownRefresh()
      return
    }
    this._lastSearchedKey = ''
    this._lastSearchedStatus = this.data.statusFilter
    await this._loadLocationsAndNotices()
    wx.stopPullDownRefresh()
  },

  // ── 搜索 / 状态筛选 ──────────────────────────────────
  // 输入实时同步到 data.searchKey（与员工页一致），实际查询由「查询」按钮 / 回车触发，
  // 避免每次键入都打一次云函数。
  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value || '' })
  },

  onNoticeSearch() {
    const keyword = (this.data.searchKey || '').trim()
    // 没改关键词时直接复用，避免无谓请求（status 为 0 时是合法值，不能 || 'all' 兜底）
    if (keyword === (this._lastSearchedKey || '')
      && this.data.statusFilter === (this._lastSearchedStatus == null ? 'all' : this._lastSearchedStatus)) return
    this._lastSearchedKey = keyword
    this._lastSearchedStatus = this.data.statusFilter
    this._loadNoticeList()
  },

  onNoticeClear() {
    this.setData({ searchKey: '' })
    this.onNoticeSearch()
  },

  onStatusFilterChange(e) {
    const raw = e.currentTarget.dataset.status
    // 'all' | '1' | '0'，其它值退回 'all'
    const next = (raw === '1' || raw === '0' || raw === 'all') ? raw : 'all'
    const normalized = (raw === '1' || raw === '0') ? Number(raw) : raw
    if (normalized === this.data.statusFilter) return
    this.setData({ statusFilter: normalized })
    this._loadNoticeList()
  },

  // ── 正文展开 / 折叠 ──────────────────────────────────
  onToggleContent(e) {
    const id = Number(e.currentTarget.dataset.id) || 0
    this.setData({ expandedId: this.data.expandedId === id ? 0 : id })
  },

  // ── 新增公告 ────────────────────────────────────────
  _buildFormLocations() {
    return (this.data.locations || []).filter(
      l => l && Number(l.status) === 1
    )
  },

  // 当前食堂是否启用（status=1）：停用时「新增公告」按钮置灰禁用
  _isLocationEnabled(loc) {
    return Number(loc && loc.status) === 1
  },

  onAddNotice() {
    if (!this.data.hasPermission) return wx.showToast({ title: '当前账号暂无可管理的食堂', icon: 'none' })
    // 当前食堂已停用时不允许新增（需先在顶部切换到启用中的食堂）
    if (!this.data.canAddNotice) return wx.showToast({ title: '当前食堂已停用，无法新增公告', icon: 'none' })
    const formLocations = this._buildFormLocations()
    if (!formLocations.length) return wx.showToast({ title: '当前没有启用中的食堂，无法新增', icon: 'none' })
    const current = this.data.locations[this.data.currentLocationIndex] || {}
    const curIdx = formLocations.findIndex(l => Number(l.id) === Number(current.id))
    const publish = defaultPublish()
    this.setData({
      showForm: true,
      formMode: 'add',
      formTitle: '新增公告',
      formLocations,
      formLocationIndex: curIdx >= 0 ? curIdx : 0,
      formLocationLocked: false,
      formLocationName: '',
      form: {
        id: 0,
        title: '',
        content: '',
        publish_date: publish.date,
        publish_time_hm: publish.hm,
        location_id: 0,
      },
    })
    this._openPublishTime = `${publish.date} ${publish.hm}` // 新增：预填值视为原值（停留弹窗后保存不误拦）
    this._publishTouched = false // 未手动改过发布时间 → 提交时交给云函数按保存时刻发布
    this._originPublishTime = '' // 新增无原发布时间
    this._refreshTimeLimit() // 默认日期是今天，收紧时刻下限为当前时刻
  },

  // ── 编辑公告（列表已带全文，无需再查详情） ───────────
  onEditNotice(e) {
    const id = Number(e.currentTarget.dataset.id) || 0
    const item = this.data.noticeList.find(n => Number(n.id) === id)
    if (!item) return wx.showToast({ title: '未找到该公告', icon: 'none' })

    const formLocations = this._buildFormLocations()
    const locIdx = formLocations.findIndex(l => Number(l.id) === Number(item.location_id))
    // publish_time 形如 'YYYY-MM-DD HH:mm:ss'，拆成日期与时刻两段供 picker 使用
    const publishTime = item.publish_time || ''
    this.setData({
      showForm: true,
      formMode: 'edit',
      formTitle: '编辑公告',
      formLocations,
      formLocationIndex: locIdx >= 0 ? locIdx : 0,
      // 原食堂已停用（不在启用列表）时锁定为原食堂，避免保存时被静默挪到别的食堂
      formLocationLocked: locIdx < 0,
      formLocationName: locIdx >= 0
        ? ''
        : ((this.data.locations.find(l => Number(l.id) === Number(item.location_id)) || {}).name || '原食堂'),
      form: {
        id: item.id,
        title: item.title || '',
        content: item.content || '',
        publish_date: publishTime ? publishTime.slice(0, 10) : '',
        publish_time_hm: publishTime ? publishTime.slice(11, 16) : '',
        location_id: Number(item.location_id) || 0,
      },
    })
    // 记录原发布时间（截到分钟，与 isPastPublish 比较格式一致）：未修改时提交放行（可能是过去的既有数据）
    this._openPublishTime = publishTime ? publishTime.slice(0, 16) : ''
    this._publishTouched = false // 编辑：未手动改时间时保留原发布时间，不走"保存时刻"
    this._originPublishTime = publishTime // 原发布时间原样保留（含原秒位）
    this._refreshTimeLimit() // 原日期若是今天，时刻下限也要收紧
  },

  // ── 删除公告 ────────────────────────────────────────
  onDeleteNotice(e) {
    const id = Number(e.currentTarget.dataset.id) || 0
    const item = this.data.noticeList.find(n => Number(n.id) === id)
    if (!item) return wx.showToast({ title: '未找到该公告', icon: 'none' })
    Dialog.confirm({
      title: '删除公告',
      message: `确认删除「${item.title}」吗？删除后无法恢复，员工端也将不再展示。`,
      confirmButtonText: '删除',
      confirmButtonColor: '#ee0a24',
    }).then(async () => {
      try {
        await NoticeAPI.deleteNotice({ id })
        wx.showToast({ title: '已删除', icon: 'success' })
        this._loadNoticeList()
      } catch (err) {
        wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
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

  onPublishDateChange(e) {
    this._publishTouched = true 
    this.setData({ 'form.publish_date': e.detail.value })
    // 日期变了（今天 / 未来之间切换）要重算时刻下限
    this._refreshTimeLimit()
  },

  onPublishTimeChange(e) {
    this._publishTouched = true 
    this.setData({ 'form.publish_time_hm': e.detail.value })
  },

  onClearPublishTime() {
    this._publishTouched = true 
    this.setData({ 'form.publish_date': '', 'form.publish_time_hm': '', timeMin: '00:00' })
  },

  // 刷新时刻选择下限：选的日期是今天时收紧为当前时刻（防止选到过去；未来日期不限）。
  // 若已选时刻早于下限（如先选 08:00 再把日期改成今天）一并清掉，避免残留非法值；
  // 但编辑回显的原发布时间（可能早于此刻）除外——原值未修改时提交放行，不能清空。
  _refreshTimeLimit() {
    const now = new Date()
    const curHm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
    const d = this.data.form.publish_date
    const timeMin = (d && d === this.data.today) ? curHm : '00:00'
    const patch = { timeMin }
    const hm = this.data.form.publish_time_hm
    const isOriginal = hm && d && this._openPublishTime === `${d} ${hm}`
    if (hm && hm < timeMin && !isOriginal) patch['form.publish_time_hm'] = ''
    this.setData(patch)
  },

  async onFormSubmit() {
    const {
      form, formLocations, formLocationIndex,
      formLocationLocked, formLocationName, formMode,
    } = this.data
    const title = (form.title || '').trim()
    const content = (form.content || '').trim()
    // 锁定态（原食堂已停用）按原食堂提交；否则取表单内所选食堂
    const location = formLocationLocked
      ? { id: form.location_id, name: formLocationName }
      : (formLocations[formLocationIndex] || {})
    const locationId = Number(location.id) || 0

    if (!title) return wx.showToast({ title: '请填写公告标题', icon: 'none' })
    if (!content) return wx.showToast({ title: '请填写公告内容', icon: 'none' })
    if (locationId <= 0) return wx.showToast({ title: '请选择食堂', icon: 'none' })

    // 发布时间：日期必填才有时刻；留空整体清空
    const datePart = form.publish_date || ''
    const hmPart = form.publish_time_hm || ''
    if (!datePart && hmPart) return wx.showToast({ title: '请选择发布时间', icon: 'none' })
    if (datePart && !hmPart) return wx.showToast({ title: '请选择发布时刻', icon: 'none' })
    if (isPastPublish(datePart, hmPart, this._openPublishTime)) return wx.showToast({ title: '发布时间不能早于当前时间', icon: 'none' })
    // 秒位取「点保存那一刻」的秒（picker 只到分钟），不补固定 00，保证发布时间精确到秒
    const nowSec = pad2(new Date().getSeconds())
    let publishTime = datePart ? `${datePart} ${hmPart}:${nowSec}` : ''
    // 状态由发布时间推导：填了 = 已发布（未来时间 = 定时发布，员工端到点展示），留空 = 草稿
    const status = publishTime ? 1 : 0
    // 新增且从未手动改过发布时间：传空，由云函数按保存时刻（NOW()）发布，
    if (formMode === 'add' && !this._publishTouched && status === 1) publishTime = ''
    if (formMode === 'edit' && !this._publishTouched && this._originPublishTime) {
      publishTime = this._originPublishTime
    }

    this.setData({ saving: true })
    try {
      await NoticeAPI.saveNotice({
        id: form.id,
        title,
        content,
        status,
        locationId,
        publishTime,
      })
      this.setData({ showForm: false })
      wx.showToast({ title: formMode === 'edit' ? '已保存' : (status === 1 ? '已发布' : '草稿已保存'), icon: 'success' })
      // 归属食堂与顶部所选不一致时，顶部切到该食堂，让用户立刻看到新公告
      const idx = this.data.locations.findIndex(l => Number(l.id) === locationId)
      if (idx > -1 && idx !== this.data.currentLocationIndex) {
        this.setData({ currentLocationIndex: idx, canAddNotice: this._isLocationEnabled(this.data.locations[idx]) })
      }
      this._loadNoticeList()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
