// subpackages/kitchen/pages/detail/index.js
const { KitchenAPI } = require('../../../../services/api')
const { MEAL_TYPE_LABEL } = require('../../../../utils/const')
const { formatDateCN } = require('../../../../utils/time')
const M = require('../../../../utils/mock')

Page({
  data: {
    date: '',
    searchKey: '',
    activeMeal: '',
    list: [],
    total: 0,
    totalQty: 0,
    page: 1,
    hasMore: false,
    loading: true,
    loadingMore: false,
  },

  onLoad(options) {
    const date = options.date || ''
    wx.setNavigationBarTitle({
      title: date ? `报餐明细 · ${formatDateCN(date)}` : '报餐明细',
    })
    this.setData({ date })
    this._load(true)
  },

  onMealTabChange(e) {
    this.setData({ activeMeal: e.detail.name })
    this._load(true)
  },

  onSearchInput(e) {
    this.setData({ searchKey: e.detail })
  },

  onSearch() {
    this._load(true)
  },

  onSearchClear() {
    this.setData({ searchKey: '' })
    this._load(true)
  },

  async _load(refresh) {
    const app = getApp()
    if (app.globalData.devMock) {
      this._loadMock(refresh)
      return
    }

    if (refresh) {
      this.setData({ loading: true, page: 1, list: [] })
    } else {
      this.setData({ loadingMore: true })
    }

    const { date, searchKey, activeMeal, page } = this.data
    const params = {
      date,
      page: refresh ? 1 : page,
      page_size: 20,
    }
    if (searchKey) params.keyword = searchKey
    if (activeMeal) params.meal_type = activeMeal

    try {
      const res = await KitchenAPI.getTodayDetail(params)
      const rawList = res?.list || res || []
      const newList = rawList.map((r) => ({
        id: `${r.user_id}-${r.meal_type}`,
        name: r.name || '',
        phone: r.phone ? r.phone.slice(0, 3) + '****' + r.phone.slice(7) : '',
        deptName: r.dept_name || '',
        mealType: r.meal_type,
        mealLabel: MEAL_TYPE_LABEL[r.meal_type] || r.meal_type,
        qty: r.qty || 0,
        familyQty: Math.max((r.qty || 0) - 1, 0),
      }))

      this.setData({
        list: refresh ? newList : [...this.data.list, ...newList],
        total: res?.total || newList.length,
        totalQty: res?.total_qty || 0,
        hasMore: newList.length >= 20,
        page: refresh ? 2 : page + 1,
        loading: false,
        loadingMore: false,
      })
    } catch (e) {
      console.error('[Kitchen Detail]', e)
      this.setData({ loading: false, loadingMore: false })
    }
  },

  // Mock 数据
  _loadMock(refresh) {
    const mockList = M.mockKitchenDetail || []
    let filtered = [...mockList]

    const { searchKey, activeMeal } = this.data
    if (searchKey) {
      const key = searchKey.toLowerCase()
      filtered = filtered.filter(
        r => (r.name || '').includes(key) || (r.deptName || '').includes(key)
      )
    }
    if (activeMeal) {
      filtered = filtered.filter(r => r.mealType === activeMeal)
    }

    const totalQty = filtered.reduce((s, r) => s + (r.qty || 0), 0)

    this.setData({
      list: filtered,
      total: filtered.length,
      totalQty,
      hasMore: false,
      loading: false,
      loadingMore: false,
    })
  },

  loadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this._load(false)
  },
})
