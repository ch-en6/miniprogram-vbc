// subpackages/admin/pages/sys-config/index.js
const { SysAdminAPI } = require('../../../../services/api')
const { ROLE } = require('../../../../utils/const')
const auth = require('../../../../utils/auth')

const MEAL_KEYS = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
]

const pad2 = n => (n < 10 ? '0' + n : String(n))

/** 今天的 YYYY-MM-DD */
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 在指定日期上加一年 */
function nextYearStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setFullYear(d.getFullYear() + 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function emptyForm() {
  const start = todayStr()
  return {
    id: 0,
    startDate: start,
    endDate: nextYearStr(start),
    status: 1,
    meals: MEAL_KEYS.map(m => ({ key: m.key, label: m.label, empPrice: '', familyPrice: '' })),
  }
}

function formFromItem(item) {
  const mealMap = {}
  ;(item.meals || []).forEach(m => { mealMap[m.key] = m })
  return {
    id: Number(item.id) || 0,
    startDate: item.start_date || todayStr(),
    endDate: item.end_date || nextYearStr(item.start_date || todayStr()),
    status: Number(item.status) === 0 ? 0 : 1,
    meals: MEAL_KEYS.map(m => {
      const src = mealMap[m.key] || {}
      return {
        key: m.key,
        label: m.label,
        empPrice: src.emp_price === '' || src.emp_price == null ? '' : String(src.emp_price),
        familyPrice: src.family_price === '' || src.family_price == null ? '' : String(src.family_price),
      }
    }),
  }
}

Page({
  data: {
    loading: true,

    // 部门选择
    depts: [],
    deptIndex: -1,
    currentDeptName: '',
    canAdd: false,

    // 当前部门的价格配置
    list: [],
    hasEffective: false,

    // 新增 / 编辑表单
    showForm: false,
    form: emptyForm(),
    submitting: false,

    dateMin: todayStr(),
  },

  onShow() {
    if (!this._checkRole()) return
    this.loadDepts()
  },

  /** 仅系统管理员可访问 */
  _checkRole() {
    if (auth.hasRole(ROLE.SYS_ADMIN)) return true
    wx.showToast({ title: '无系统管理员权限', icon: 'none' })
    setTimeout(() => wx.navigateBack({ delta: 1 }), 800)
    return false
  },

  /** 拉取部门下拉选项，并加载首个部门的价格配置 */
  async loadDepts() {
    this.setData({ loading: true })
    try {
      const res = await SysAdminAPI.getDeptList()
      const depts = (res && res.list) || []
      const deptIndex = depts.length ? 0 : -1
      this.setData({
        depts,
        deptIndex,
        currentDeptName: deptIndex > -1 ? depts[deptIndex].name : '',
        canAdd: deptIndex > -1 && this._isDeptEnabled(depts[deptIndex]),
      })
      if (deptIndex > -1) await this.loadConfig(depts[deptIndex].id)
      else this.setData({ list: [] })
    } catch (err) {
      console.error('[sys-config] loadDepts error:', err)
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 加载指定部门的价格配置 */
  async loadConfig(deptId) {
    try {
      const res = await SysAdminAPI.getPriceConfigList({ deptId })
      const today = todayStr()
      const list = ((res && res.list) || []).map(item => {
        const enabled = Number(item.status) === 1
        return {
          ...item,
          is_effective: enabled && !!item.start_date && !!item.end_date
            && item.start_date <= today && today <= item.end_date,
          not_started: enabled && !!item.start_date && item.start_date > today,
          expired: enabled && !!item.end_date && item.end_date < today,
        }
      })
      this.setData({ list, hasEffective: list.some(item => item.is_effective) })
    } catch (err) {
      console.error('[sys-config] loadConfig error:', err)
      wx.showToast({ title: err.message || '价格加载失败', icon: 'none' })
    }
  },

  onDeptChange(e) {
    const deptIndex = Number(e.detail.value)
    const dept = this.data.depts[deptIndex]
    if (!dept) return
    this.setData({
      deptIndex,
      currentDeptName: dept.name,
      canAdd: this._isDeptEnabled(dept),
    })
    this.loadConfig(dept.id)
  },

  /** 部门是否启用（sys_dept.status=1） */
  _isDeptEnabled(dept) {
    return Number(dept && dept.status) === 1
  },

  /** 新增：默认从今天起生效一年 */
  onAdd() {
    const dept = this.data.depts[this.data.deptIndex]
    if (!dept) {
      wx.showToast({ title: '请先在「部门管理」新增部门', icon: 'none' })
      return
    }
    if (!this._isDeptEnabled(dept)) {
      wx.showToast({ title: '当前部门已停用，无法新增价格配置', icon: 'none' })
      return
    }
    this.setData({ showForm: true, form: emptyForm(), dateMin: todayStr() })
  },

  onEdit(e) {
    const item = e.currentTarget.dataset.item || {}
    const today = todayStr()
    const original = item.start_date || ''
    this.setData({
      showForm: true,
      form: formFromItem(item),
      dateMin: original && original < today ? original : today,
    })
  },

  closeForm() {
    if (this.data.submitting) return
    this.setData({ showForm: false })
  },

  /** 餐次价格输入：dataset.index 为餐次下标，dataset.field 为 emp / family */
  onMealPriceInput(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const field = e.currentTarget.dataset.field === 'family' ? 'familyPrice' : 'empPrice'
    if (isNaN(idx) || idx < 0 || idx >= MEAL_KEYS.length) return
    this.setData({ [`form.meals[${idx}].${field}`]: e.detail.value })
  },

  onStartDateChange(e) {
    const startDate = e.detail.value
    const form = { 'form.startDate': startDate }
    // 生效日期晚于失效日期时自动顺延失效日期
    if (this.data.form.endDate && startDate > this.data.form.endDate) {
      form['form.endDate'] = nextYearStr(startDate)
    }
    this.setData(form)
  },

  onEndDateChange(e) {
    this.setData({ 'form.endDate': e.detail.value })
  },

  onFormStatusChange(e) {
    this.setData({ 'form.status': e.detail ? 1 : 0 })
  },

  async onSubmit() {
    const { form, depts, deptIndex } = this.data
    const dept = depts[deptIndex]

    if (!dept) {
      wx.showToast({ title: '请选择部门', icon: 'none' })
      return
    }

    // 逐餐次校验：员工价 / 家属价均为必填
    const meals = {}
    for (let i = 0; i < form.meals.length; i++) {
      const m = form.meals[i]
      const empRaw = String(m.empPrice).trim()
      const familyRaw = String(m.familyPrice).trim()
      if (!empRaw) {
        wx.showToast({ title: `请填写「${m.label}」员工价`, icon: 'none' })
        return
      }
      if (!familyRaw) {
        wx.showToast({ title: `请填写「${m.label}」家属价`, icon: 'none' })
        return
      }
      const empPrice = Number(empRaw)
      const familyPrice = Number(familyRaw)
      if (isNaN(empPrice) || empPrice < 0) {
        wx.showToast({ title: `「${m.label}」员工价无效`, icon: 'none' })
        return
      }
      if (isNaN(familyPrice) || familyPrice < 0) {
        wx.showToast({ title: `「${m.label}」家属价无效`, icon: 'none' })
        return
      }
      meals[m.key] = { empPrice, familyPrice }
    }

    if (!form.startDate || !form.endDate) {
      wx.showToast({ title: '请选择生效 / 失效日期', icon: 'none' })
      return
    }
    if (form.startDate > form.endDate) {
      wx.showToast({ title: '生效日期不能晚于失效日期', icon: 'none' })
      return
    }

    const today = todayStr()
    const origin = form.id ? (this.data.list.find(item => Number(item.id) === Number(form.id)) || {}) : null
    const startUnchanged = !!origin && form.startDate === origin.start_date
    const endUnchanged = !!origin && form.endDate === origin.end_date
    if (!startUnchanged && form.startDate < today) {
      wx.showToast({ title: '生效日期不能早于今天', icon: 'none' })
      return
    }
    if (!endUnchanged && form.endDate < today) {
      wx.showToast({ title: '失效日期不能早于今天', icon: 'none' })
      return
    }

    if (form.status === 1) {
      const conflict = this.data.list.find(item =>
        Number(item.status) === 1
        && Number(item.id) !== Number(form.id)
        && item.start_date <= form.endDate
        && item.end_date >= form.startDate
      )
      if (conflict) {
        wx.showModal({
          title: '生效区间重叠',
          content: `与已有启用中的价格配置（${conflict.start_date} 至 ${conflict.end_date}）生效时间重复，同一时间只能有一套生效价格。`,
          showCancel: false,
        })
        return
      }
    }

    this.setData({ submitting: true })
    try {
      await SysAdminAPI.savePriceConfig({
        id: form.id,
        deptId: dept.id,
        meals,
        startDate: form.startDate,
        endDate: form.endDate,
        status: form.status,
      })
      wx.showToast({ title: form.id ? '已保存' : '已新增', icon: 'success' })
      this.setData({ showForm: false })
      await this.loadConfig(dept.id)
    } catch (err) {
      console.error('[sys-config] save error:', err)
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onDelete(e) {
    const item = e.currentTarget.dataset.item || {}
    const id = Number(item.id) || 0
    if (!id) return
    const dept = this.data.depts[this.data.deptIndex]

    wx.showModal({
      title: '删除价格配置',
      content: '确认删除该套价格配置？删除后该部门将按剩余生效配置计价。',
      confirmColor: '#ee0a24',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        try {
          await SysAdminAPI.deletePriceConfig({ id })
          wx.hideLoading()
          wx.showToast({ title: '已删除', icon: 'success' })
          if (dept) await this.loadConfig(dept.id)
        } catch (err) {
          wx.hideLoading()
          console.error('[sys-config] delete error:', err)
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      },
    })
  },
})
