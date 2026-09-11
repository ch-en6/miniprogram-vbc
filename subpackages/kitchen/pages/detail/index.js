// subpackages/kitchen/pages/detail/index.js
const { KitchenAPI } = require('../../../../services/api')
const { MEAL_TYPE_LABEL, PAGE_SIZE } = require('../../../../utils/const')
const { formatDate, formatDateCN } = require('../../../../utils/time')
const { verifyMeal } = require('../../../../utils/verify')

// 每人内部按 早餐→午餐→晚餐 排序
const MEAL_ORDER = { breakfast: 0, lunch: 1, dinner: 2 }

Page({
  data: {
    date: '',
    isToday: false, // 只有今日明细才允许核销
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
    // 只有今日的明细才显示/允许核销
    const isToday = date === formatDate(new Date())
    this.setData({ date, isToday })
    this._load(true)
  },

  onMealTabChange(e) {
    this.setData({ activeMeal: e.detail.name, mergedList: [] })
    this._load(true)
  },

  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value })
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
      page_size: PAGE_SIZE,
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
        phone: r.phone ? r.phone.slice(0, 3) + '****' + r.phone.slice(-4) : '',
        deptName: r.dept_name || '',
        mealType: r.meal_type,
        mealLabel: MEAL_TYPE_LABEL[r.meal_type] || r.meal_type,
        qty: r.qty || 0,
        familyQty: Math.max((r.qty || 0) - 1, 0),
        verified: r.verified === 1 ? 1 : 0,
      }))

      // 合并后的列表只算一次（避免 refresh 与非 refresh 分支各 merge 一次）
      const combinedList = refresh ? newList : [...this.data.list, ...newList]
      const mergedList = this._mergeByPerson(combinedList)

      this.setData({
        list: combinedList,
        mergedList,
        total: res?.total_people || res?.total || newList.length,
        totalQty: res?.total_qty || 0,
        hasMore: newList.length >= PAGE_SIZE,
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
          verifyingMeal: '', // 正在核销的餐次（防重复点击）
        }
        order.push(map[item.userId])
      }
      map[item.userId].meals.push({
        mealType: item.mealType,
        mealLabel: item.mealLabel,
        qty: item.qty,
        familyQty: item.familyQty,
        verified: item.verified,
      })
      map[item.userId].totalQty += item.qty
    })
    // 每人内部按早餐→午餐→晚餐排序
    order.forEach(person => {
      person.meals.sort((a, b) => (MEAL_ORDER[a.mealType] ?? 9) - (MEAL_ORDER[b.mealType] ?? 9))
    })
    return order
  },

  loadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this._load(false)
  },

  // ─── 核销 / 撤销核销 ───────────────────────────────────────

  /**
   * 点击核销按钮：未核销 -> 直接核销；已核销 -> 弹确认后撤销
   */
  onVerifyMeal(e) {
    // 非今日明细不允许核销
    if (!this.data.isToday) return
    const { userId, meal, verified } = e.currentTarget.dataset
    const mergedList = this.data.mergedList || []
    const pIdx = mergedList.findIndex(p => String(p.id) === String(userId))
    if (pIdx === -1) return
    const person = mergedList[pIdx]
    const mIdx = person.meals.findIndex(m => m.mealType === meal)
    if (mIdx === -1) return

    verifyMeal(this, {
      empId: userId,
      date: this.data.date,
      meal,
      verified,
      name: person.name,
      isBusy: () => !!person.verifyingMeal,
      setBusy: (m) => this.setData({ [`mergedList[${pIdx}].verifyingMeal`]: m }),
      clearBusy: () => this.setData({ [`mergedList[${pIdx}].verifyingMeal`]: '' }),
      onSuccess: (nv) => this.setData({ [`mergedList[${pIdx}].meals[${mIdx}].verified`]: nv }),
    })
  },
})
