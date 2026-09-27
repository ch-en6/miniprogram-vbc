// subpackages/admin/pages/permission/index.js
// 角色管理：维护角色名称 / 状态，并配置角色可管辖的食堂。
const { SysAdminAPI } = require('../../../../services/api')
const { ROLE, ROLE_LABEL } = require('../../../../utils/const')
const auth = require('../../../../utils/auth')

const ALL_ROLE_LABEL = Object.assign({}, ROLE_LABEL)

const EMPTY_FORM = { id: 0, code: '', name: '', status: 1 }

Page({
  data: {
    loading: true,
    list: [],            // 角色全量数据（getRoleList 返回）
    searchKey: '',       // 搜索关键字
    displayList: [],     // 经搜索过滤后真正渲染的列表
    locations: [],
    identityLabel: '',   // 编辑态展示当前身份
    ROLE,                // 注入常量给 WXML 使用
    showForm: false,
    form: { ...EMPTY_FORM },
    chips: [],           // 绑定食堂多选标签
    submitting: false,
  },

  onShow() {
    if (!this._checkRole()) return
    this.loadAll()
  },

  /** 仅系统管理员可访问 */
  _checkRole() {
    if (auth.hasRole(ROLE.SYS_ADMIN)) return true
    wx.showToast({ title: '无系统管理员权限', icon: 'none' })
    setTimeout(() => wx.navigateBack({ delta: 1 }), 800)
    return false
  },

  async loadAll() {
    this.setData({ loading: true })
    try {
      const [roleRes, locRes] = await Promise.all([
        SysAdminAPI.getRoleList(),
        SysAdminAPI.getLocationList(),
      ])
      const list = (roleRes && roleRes.list) || []
      this.setData({
        list,
        locations: (locRes && locRes.list) || [],
        displayList: this._computeDisplayList(list, this.data.searchKey),
      })
    } catch (err) {
      console.error('[permission] loadAll error:', err)
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 根据搜索关键字计算展示列表（匹配角色名称或标识，无关键字时展示全部） */
  _computeDisplayList(list, searchKey) {
    if (!Array.isArray(list) || !list.length) return []
    const keyword = (searchKey || '').trim().toLowerCase()
    if (!keyword) return list
    return list.filter(r =>
      (r.name || '').toLowerCase().includes(keyword) ||
      (r.code || '').toLowerCase().includes(keyword)
    )
  },

  /** 重新计算 displayList */
  _refreshDisplayList() {
    this.setData({
      displayList: this._computeDisplayList(this.data.list, this.data.searchKey),
    })
  },

  // ── 搜索 ─────────────────────────
  /** 输入只记录关键字，不触发查询（需点击「查询」按钮或键盘搜索才生效） */
  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value || '' })
  },

  onRoleSearch() {
    this._refreshDisplayList()
  },

  onRoleClear() {
    if (!this.data.searchKey) return
    this.setData({ searchKey: '' }, () => this._refreshDisplayList())
  },

  _buildChips(selectedIds) {
    return this.data.locations
      .filter(l => Number(l.status) === 1)
      .map(l => ({
        id: Number(l.id) || 0,
        name: l.name,
        on: (selectedIds || []).map(n => Number(n) || 0).includes(Number(l.id) || 0),
      }))
  },

  onAdd() {
    this.setData({
      showForm: true,
      form: { ...EMPTY_FORM },
      identityLabel: '',
      chips: this._buildChips([]),
    })
  },

  onEdit(e) {
    const item = e.currentTarget.dataset.item || {}
    const code = item.code || ''
    if (code === ROLE.EMPLOYEE || code === ROLE.SYS_ADMIN) return
    this.setData({
      showForm: true,
      form: {
        id: Number(item.id) || 0,
        code,
        name: item.name || '',
        status: Number(item.status) === 0 ? 0 : 1,
      },
      identityLabel: ALL_ROLE_LABEL[code] || code,
      chips: this._buildChips(item.location_ids),
    })
  },

  closeForm() {
    if (this.data.submitting) return
    this.setData({ showForm: false })
  },

  noop() {},

  onIdentityChange(e) {
    const code = e.currentTarget.dataset.code
    if (!code) return
    this.setData({ 'form.code': code })
  },

  onNameInput(e) {
    this.setData({ 'form.name': e.detail })
  },

  /** van-switch：e.detail 为布尔值 */
  onStatusChange(e) {
    this.setData({ 'form.status': e.detail ? 1 : 0 })
  },

  onToggleLocation(e) {
    const id = Number(e.currentTarget.dataset.id) || 0
    const chips = this.data.chips.map(c => {
      if (c.id !== id || c.disabled) return c
      return { ...c, on: !c.on }
    })
    this.setData({ chips })
  },

  async onSubmit() {
    const { form, chips } = this.data
    const name = (form.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写角色名称', icon: 'none' })
      return
    }

    const code = (form.code || '').trim()
    if (!code) {
      wx.showToast({ title: '请选择身份', icon: 'none' })
      return
    }

    // 绑定食堂：多选，至少一个
    const locationIds = chips.filter(c => c.on).map(c => c.id)
    if (!locationIds.length) {
      wx.showToast({ title: '请至少选择一个绑定的食堂', icon: 'none' })
      return
    }

    // 身份相同且绑定食堂集合完全相同的角色才拒绝（编辑时排除自身）
    const selectedSet = new Set(locationIds)
    const sameLocationSet = ids => {
      const arr = (ids || []).map(n => Number(n) || 0)
      return arr.length === selectedSet.size && arr.every(id => selectedSet.has(id))
    }
    const exists = (this.data.list || []).some(r =>
      Number(r.id) !== Number(form.id) &&
      (r.code || '') === code &&
      sameLocationSet(r.location_ids)
    )
    if (exists) {
      wx.showToast({ title: '系统已存在该身份', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      await SysAdminAPI.saveRole({
        id: form.id,
        code: form.id ? '' : code,
        name,
        status: form.status,
        locationIds,
      })
      wx.showToast({ title: form.id ? '已保存' : '已新增', icon: 'success' })
      this.setData({ showForm: false })
      await this.loadAll()
    } catch (err) {
      console.error('[permission] save error:', err)
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onDelete(e) {
    const item = e.currentTarget.dataset.item || {}
    const id = Number(item.id) || 0
    if (!id) return
    if (item.code === ROLE.EMPLOYEE || item.code === ROLE.SYS_ADMIN) return

    wx.showModal({
      title: '删除角色',
      content: `确认删除角色「${item.name || ''}」？`,
      confirmColor: '#ee0a24',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        try {
          await SysAdminAPI.deleteRole({ id })
          wx.hideLoading()
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.loadAll()
        } catch (err) {
          wx.hideLoading()
          console.error('[permission] delete error:', err)
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      },
    })
  },
})
