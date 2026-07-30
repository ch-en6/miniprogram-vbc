// subpackages/kitchen/pages/detail/index.js
const { KitchenAPI } = require('../../../../services/api')
const { MEAL_TYPE_LABEL } = require('../../../../utils/const')
const { formatDateCN } = require('../../../../utils/time')

Page({
  data: {
    date: '',
    searchKey: '',
    activeMeal: 'all',
    list: [],
    mergedList: [],
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
    this.setData({ activeMeal: e.detail.name, mergedList: [] })
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
    if (refresh) {
      this.setData({ loading: true, page: 1, list: [], mergedList: [] })
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
    if (activeMeal && activeMeal !== 'all') params.meal_type = activeMeal

    try {
      const res = await KitchenAPI.getTodayDetail(params)
      const rawList = res?.list || []
      const newList = rawList.map((r) => ({
        id: `${r.user_id}-${r.meal_type}`,
        userId: r.user_id,
        name: r.name || '',
        phone: r.phone ? r.phone.slice(0, 3) + '****' + r.phone.slice(7) : '',
        deptName: r.dept_name || '',
        mealType: r.meal_type,
        mealLabel: MEAL_TYPE_LABEL[r.meal_type] || r.meal_type,
        qty: r.qty || 0,
        familyQty: Math.max((r.qty || 0) - 1, 0),
      }))

      const mergedList = this._mergeByPerson(newList)

      this.setData({
        list: refresh ? newList : [...this.data.list, ...newList],
        mergedList: refresh ? mergedList : this._mergeByPerson([...this.data.list, ...newList]),
        total: res?.total || newList.length,
        totalQty: res?.total_qty || 0,
        hasMore: newList.length >= 20,
        page: refresh ? 2 : page + 1,
        loading: false,
        loadingMore: false,
      })
    } catch (e) {
      console.error('[Kitchen Detail]', e)
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
      this.setData({ loading: false, loadingMore: false })
    }
  },

  /**
   * 将同一人的多条餐别记录合并为一张卡片
   * 用于"全部" tab 展示
   */
  _mergeByPerson(flatList) {
    const map = {}
    const order = []
    flatList.forEach(item => {
      if (!map[item.userId]) {
        map[item.userId] = {
          id: item.userId,
          name: item.name,
          phone: item.phone,
          deptName: item.deptName,
          meals: [],
          totalQty: 0,
        }
        order.push(map[item.userId])
      }
      map[item.userId].meals.push({
        mealType: item.mealType,
        mealLabel: item.mealLabel,
        qty: item.qty,
        familyQty: item.familyQty,
      })
      map[item.userId].totalQty += item.qty
    })
    // 每人内部按早餐→午餐→晚餐排序
    const mealOrder = { breakfast: 0, lunch: 1, dinner: 2 }
    order.forEach(person => {
      person.meals.sort((a, b) => (mealOrder[a.mealType] ?? 9) - (mealOrder[b.mealType] ?? 9))
    })
    return order
  },

  loadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this._load(false)
  },
})
