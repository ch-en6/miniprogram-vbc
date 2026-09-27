// subpackages/admin/pages/location-manage/index.js
// 食堂管理：食堂的新增 / 编辑 / 启停 / 删除。
// 删除由云函数兜底校验（存在部门或已被角色绑定时拒绝）。
const { SysAdminAPI } = require('../../../../services/api')
const { ROLE } = require('../../../../utils/const')
const auth = require('../../../../utils/auth')

const EMPTY_FORM = { id: 0, name: '', status: 1 }

Page({
  data: {
    loading: true,
    list: [],            // 食堂全量数据（getLocationList 返回）
    searchKey: '',       // 搜索关键字
    displayList: [],     // 经搜索过滤后真正渲染的列表
    showForm: false,
    form: { ...EMPTY_FORM },
    submitting: false,
  },

  onShow() {
    if (!this._checkRole()) return
    this.loadList()
  },

  /** 仅系统管理员可访问 */
  _checkRole() {
    if (auth.hasRole(ROLE.SYS_ADMIN)) return true
    wx.showToast({ title: '无系统管理员权限', icon: 'none' })
    setTimeout(() => wx.navigateBack({ delta: 1 }), 800)
    return false
  },

  async loadList() {
    this.setData({ loading: true })
    try {
      const res = await SysAdminAPI.getLocationList()
      const list = (res && res.list) || []
      this.setData({
        list,
        displayList: this._computeDisplayList(list, this.data.searchKey),
      })
    } catch (err) {
      console.error('[location-manage] loadList error:', err)
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 根据搜索关键字计算展示列表（无关键字时展示全部食堂） */
  _computeDisplayList(list, searchKey) {
    if (!Array.isArray(list) || !list.length) return []
    const keyword = (searchKey || '').trim().toLowerCase()
    if (!keyword) return list
    return list.filter(l => (l.name || '').toLowerCase().includes(keyword))
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

  onLocSearch() {
    this._refreshDisplayList()
  },

  onLocClear() {
    if (!this.data.searchKey) return
    this.setData({ searchKey: '' }, () => this._refreshDisplayList())
  },

  onAdd() {
    this.setData({ showForm: true, form: { ...EMPTY_FORM } })
  },

  onEdit(e) {
    const item = e.currentTarget.dataset.item || {}
    this.setData({
      showForm: true,
      form: {
        id: Number(item.id) || 0,
        name: item.name || '',
        status: Number(item.status) === 0 ? 0 : 1,
      },
    })
  },

  closeForm() {
    if (this.data.submitting) return
    this.setData({ showForm: false })
  },

  /** 阻止点击弹层内容时冒泡关闭 */
  noop() {},

  onNameInput(e) {
    this.setData({ 'form.name': e.detail })
  },

  /** van-switch：e.detail 为布尔值 */
  onStatusChange(e) {
    this.setData({ 'form.status': e.detail ? 1 : 0 })
  },

  async onSubmit() {
    const form = this.data.form
    const name = (form.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写食堂名称', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      await SysAdminAPI.saveLocation({ id: form.id, name, status: form.status })
      wx.showToast({ title: form.id ? '已保存' : '已新增', icon: 'success' })
      this.setData({ showForm: false })
      await this.loadList()
    } catch (err) {
      console.error('[location-manage] save error:', err)
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onDelete(e) {
    const item = e.currentTarget.dataset.item || {}
    const id = Number(item.id) || 0
    if (!id) return

    wx.showModal({
      title: '删除食堂',
      content: `确认删除「${item.name || ''}」？删除后不可恢复。`,
      confirmColor: '#ee0a24',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        try {
          await SysAdminAPI.deleteLocation({ id })
          wx.hideLoading()
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.loadList()
        } catch (err) {
          wx.hideLoading()
          console.error('[location-manage] delete error:', err)
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      },
    })
  },
})
