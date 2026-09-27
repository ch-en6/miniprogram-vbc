// subpackages/dept/pages/staff/index.js — 部门工作台 · 员工管理
// 员工数据源：sys_emp（MySQL）
const { KitchenAPI } = require('../../../../services/api')
const Dialog = require('@vant/weapp/dialog/dialog').default
const { isValidPassword, PASSWORD_RULE_TIP } = require('../../../../utils/util')

// 简单手机号格式校验（11 位、以 1 开头）
const PHONE_RE = /^1\d{10}$/

Page({
  data: {
    // ── 列表 ──
    depts: [],                  // 当前角色可管理的部门
    currentDeptIndex: 0,        // 列表筛选用
    searchKey: '',              // 搜索关键字
    staffList: [],              // 当前展示的员工列表
    loading: false,             // 加载中
    hasPermission: true,        // 角色范围内是否有任何部门
    canAddStaff: true,          // 当前所选部门是否启用（status=1），停用时禁用「新增员工」

    // ── 表单弹窗（新增 / 编辑共用；编辑内可改手机号、切换状态、重置密码、解绑微信） ──
    showForm: false,
    formMode: 'add',            // 'add' | 'edit'
    formTitle: '新增员工',
    form: { id: 0, name: '', phone: '', dept_id: 0, status: 1, role_id: 0, has_openid: false },
    formDepts: [],              // 表单可选部门：仅启用部门（sys_dept.status=1）
    formDeptIndex: 0,
    roles: [],                  // 表单所选部门可分配的角色 [{ role_id, role_code, role_name }]
    rolesIndex: 0,              // 身份下拉当前选中角色的下标（与 roles 同步）
    loadingRoles: false,        // 是否正在解析可分配角色
    operatorCode: '',           // 操作者角色 code：deptAdmin / sysAdmin（决定可分配白名单与管理级账号可见性）
    editRoleCode: '',           // 编辑模式下员工原 role_code（角色对齐用）
    isSelfAccount: false,       // 编辑对象是否为操作者本人（禁止停用/调部门/重置密码/解绑微信/删除）
    roleTip: '',                // 当前所选身份的提示文案
    saving: false,

    // ── 初始密码 / 重置密码展示弹窗 ──
    showPassword: false,
    passwordInfo: { mode: 'add', name: '', password: '' },

    // ── 批量导入弹窗 ──
    showImport: false,
    importText: '',
    importDepts: [],            // 导入弹窗可选部门：仅启用部门
    importDeptIndex: 0,
    importDeptId: 0,
    importRoles: [],            // 导入弹窗可分配角色
    importRoleIndex: 0,
    importRoleId: 0,
    loadingImportRoles: false,
    importPreview: null,        // 解析预览 { total, validCount, errorCount, errors, errorMore }
    importPassword: '',         // 统一初始密码（必填，8-20 位）
    importing: false,

    // ── 批量导入失败明细弹窗（仅存在失败行时展示；全成功仅 toast） ──
    showImportResult: false,
    importResult: null,         // { successCount, failCount, failRows: [{ line, name, phone, message }] }
  },

  onShow() {
    if (wx.hideHomeButton) wx.hideHomeButton()
    const app = getApp()
    const roleCode = (app && app.globalData && app.globalData.roleCode)
      || ((app && app.globalData && app.globalData.userInfo || {}).role_code) || ''
    if (roleCode && roleCode !== this.data.operatorCode) {
      this.setData({ operatorCode: roleCode })
    }
    this._loadDeptsAndStaff()
  },

  async _loadDeptsAndStaff() {
    let depts = []
    try {
      const res = await KitchenAPI.getMyDepts()
      depts = ((res && res.depts) || []).filter(d => d && d.dept_name)
    } catch (err) {
      console.error('[dept staff] loadDepts error:', err)
    }
    const hasPermission = depts.length > 0

    const idx = this._defaultDeptIndex(depts)

    this.setData({
      depts,
      hasPermission,
      currentDeptIndex: idx,
      searchKey: '',
      canAddStaff: this._isDeptEnabled(depts[idx]),
    })
    if (!hasPermission) {
      this.setData({ staffList: [] })
      return
    }
    this._loadStaffList()
  },

  _defaultDeptIndex(depts) {
    const list = depts || []
    if (!list.length) return 0
    const app = getApp()
    const deptId = ((app && app.globalData && app.globalData.userInfo) || {}).dept_id
    const idx = list.findIndex(d => Number(d.dept_id) === Number(deptId))
    return idx > -1 ? idx : 0
  },

  // 拉取员工列表（按当前选中部门 + 搜索关键字）
  // silent=true 时不切换页内 loading（供下拉刷新使用，避免与原生刷新指示器重复）
  async _loadStaffList(silent = false) {
    if (!this.data.hasPermission) {
      this.setData({ staffList: [] })
      return
    }
    const dept = this.data.depts[this.data.currentDeptIndex] || {}
    if (!silent) this.setData({ loading: true })
    try {
      const { list } = await KitchenAPI.getStaffList({
        deptId: dept.dept_id || 0,
        keyword: this.data.searchKey || '',
      })
      this.setData({ staffList: list || [] })
    } catch (err) {
      this.setData({ staffList: [] })
      wx.showToast({ title: (err && err.message) || '加载员工失败', icon: 'none' })
    } finally {
      if (!silent) this.setData({ loading: false })
    }
  },

  // ── 下拉刷新：按当前部门 + 搜索词重查 ────────────────
  async onPullDownRefresh() {
    if (!this.data.hasPermission) {
      wx.stopPullDownRefresh()
      return
    }
    const keyword = (this.data.searchKey || '').trim()
    if (keyword !== this.data.searchKey) this.setData({ searchKey: keyword })
    await this._loadDeptsAndStaff()
    wx.stopPullDownRefresh()
  },

  // ── 部门选择 ────────────────────────────────────────
  onDeptChange(e) {
    const index = Number(e.detail.value) || 0
    if (index === this.data.currentDeptIndex) return
    // 切部门时清空搜索（避免跨部门搜到不在结果集的同名/手机号）
    this.setData({
      currentDeptIndex: index,
      searchKey: '',
      canAddStaff: this._isDeptEnabled(this.data.depts[index]),
    })
    this._loadStaffList()
  },

  // ── 搜索（键盘搜索键与右侧「查询」按钮共用；输入实时同步 searchKey） ──
  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value || '' })
  },

  onStaffSearch(e) {
    const keyword = e && e.detail && typeof e.detail.value === 'string'
      ? e.detail.value.trim()
      : (this.data.searchKey || '').trim()
    this.setData({ searchKey: keyword })
    this._loadStaffList()
  },

  onStaffClear() {
    this.setData({ searchKey: '' })
    this._loadStaffList()
  },

  // 部门是否启用（sys_dept.status = 1）
  // 与 _formDepts 的可选口径保持一致：停用部门既不进下拉，也不允许新增员工
  _isDeptEnabled(dept) {
    return !!dept && Number(dept.status) === 1
  },

  // 表单可选部门：仅启用部门（sys_dept.status=1）；
  _formDepts(curDeptId) {
    const all = this.data.depts || []
    const enabled = all.filter(d => this._isDeptEnabled(d))
    const curId = Number(curDeptId) || 0
    const cur = all.find(d => Number(d.dept_id) === curId)
    if (cur && !this._isDeptEnabled(cur)) {
      return [cur].concat(enabled.filter(d => Number(d.dept_id) !== curId))
    }
    return enabled
  },

  // ── 新增员工 ────────────────────────────────────────
  onAddStaff() {
    if (!this.data.hasPermission) return wx.showToast({ title: '当前账号无可管理的部门', icon: 'none' })
    if (!this.data.canAddStaff) return wx.showToast({ title: '当前部门已停用，无法新增员工', icon: 'none' })
    const formDepts = this._formDepts(0)
    if (!formDepts.length) return wx.showToast({ title: '暂无可用的启用部门，无法新增员工', icon: 'none' })
    // 默认部门：优先当前列表所选部门（须为启用部门），否则取第一个启用部门
    const cur = this.data.depts[this.data.currentDeptIndex] || {}
    let idx = formDepts.findIndex(d => Number(d.dept_id) === Number(cur.dept_id))
    if (idx < 0) idx = 0
    const dept = formDepts[idx] || {}
    this.setData({
      showForm: true,
      formMode: 'add',
      formTitle: '新增员工',
      form: {
        id: 0,
        name: '',
        phone: '',
        dept_id: dept.dept_id || 0,
        status: 1,
        role_id: 0,
        has_openid: false,
      },
      formDepts,
      formDeptIndex: idx,
      roles: [],
      rolesIndex: 0,
      editRoleCode: '',
      isSelfAccount: false,
      roleTip: '',
    })
    // 预取该部门当前操作者可分配的角色（普通员工排首位，默认选中）
    this._loadFormRoles(dept.dept_id || 0)
  },

  // ── 编辑员工（改姓名/手机号/部门/状态/身份 + 重置密码、解绑微信 均在此弹窗内完成） ──
  onEditStaff(e) {
    const id = Number(e.currentTarget.dataset.id) || 0
    const item = this.data.staffList.find(s => s.id === id)
    if (!item) return wx.showToast({ title: '未找到员工信息', icon: 'none' })
    // deptAdmin 对管理级身份（deptAdmin / sysAdmin）无任何可操作项，不进入编辑弹窗
    const code = (item.role_code && String(item.role_code)) || ''
    if (this.data.operatorCode !== 'sysAdmin' && (code === 'deptAdmin' || code === 'sysAdmin')) {
      return wx.showToast({ title: '无权编辑管理级账号', icon: 'none' })
    }
    const formDepts = this._formDepts(item.dept_id)
    const deptIdx = formDepts.findIndex(d => Number(d.dept_id) === Number(item.dept_id))
    const roleId = Number(item.role_id) || 0
    // 编辑的是否是操作者本人（本人不可停用/调部门/重置密码/解绑微信/删除）
    const selfId = Number(((getApp().globalData.userInfo || {}).id)) || 0
    const isSelfAccount = Number(item.id) === selfId && selfId > 0
    this.setData({
      showForm: true,
      formMode: 'edit',
      formTitle: '编辑员工',
      form: {
        id: item.id,
        name: item.name,
        phone: item.phone,
        dept_id: item.dept_id,
        status: item.status,
        role_id: roleId,
        has_openid: !!item.has_openid,
      },
      formDepts,
      formDeptIndex: deptIdx >= 0 ? deptIdx : 0,
      roles: [],
      rolesIndex: 0,
      editRoleCode: (item.role_code && String(item.role_code)) || '',
      isSelfAccount,
      roleTip: '',
    })
    this._loadFormRoles(item.dept_id)
  },

  // ── 表单弹窗关闭 ───────────────────────────────────
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

  onFormDeptChange(e) {
    if (this.data.isSelfAccount) return wx.showToast({ title: '不能调整自己的部门', icon: 'none' })
    const idx = Number(e.detail.value) || 0
    const dept = this.data.formDepts[idx]
    this.setData({
      formDeptIndex: idx,
      'form.dept_id': dept ? dept.dept_id : 0,
    })
    // 切换部门后重新解析可分配角色并对齐选择
    this._loadFormRoles(dept ? dept.dept_id : 0)
  },

  // 表单身份下拉：切换可分配角色
  onFormRoleChange(e) {
    const idx = Number(e.detail.value) || 0
    const role = (this.data.roles || [])[idx]
    if (!role) return
    this.setData({
      rolesIndex: idx,
      'form.role_id': Number(role.role_id),
      roleTip: this._roleTipOf(role),
    })
  },

  // 生成所选角色的提示文案（普通员工无提示）
  _roleTipOf(role) {
    if (!role) return ''
    if (role.preserved) {
      return '该员工原身份已不在你的可分配范围内，保持不变即可；如需调整请选择其他身份'
    }
    const name = role.role_name || ''
    if (role.role_code === 'kitchen') {
      return `食堂员工将获得「${name}」工作台权限，可在所属食堂核销报餐`
    }
    if (role.role_code === 'deptAdmin') {
      return `部门管理员将获得部门工作台权限，可管理部门内员工与收费`
    }
    if (role.role_code === 'sysAdmin') {
      return `系统管理员拥有全系统管理权限，请谨慎分配`
    }
    return ''
  },

  // 拉取目标部门当前操作者可分配的角色
  async _loadFormRoles(deptId) {
    const target = Number(deptId) || 0
    if (target <= 0) {
      this.setData({ roles: [], rolesIndex: 0, roleTip: '' })
      return
    }
    this.setData({ loadingRoles: true })
    try {
      // roleId：编辑中员工的当前身份，后端回补该项以保证下拉能回显原身份（不被静默改成普通员工）
      const data = await KitchenAPI.getAssignableRoles({
        deptId: target,
        roleId: Number(this.data.form.role_id) || 0,
      })
      const roles = (data && data.list) || []
      this.setData({
        roles,
        operatorCode: (data && data.operator_code) || this.data.operatorCode || '',
      })
      this._alignRoleSelection(roles)
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '获取可分配角色失败', icon: 'none' })
    } finally {
      this.setData({ loadingRoles: false })
    }
  },

  // 角色列表就绪后：对齐当前选中项
  _alignRoleSelection(roles) {
    const { form, editRoleCode } = this.data
    const list = roles || []

    // 选中项对齐：优先保留原 form.role_id → 其次原角色 code 项 → 再次普通员工项
    const curRid = Number(form.role_id) || 0
    let pick = list.find(r => Number(r.role_id) === curRid)
    if (!pick) {
      if (editRoleCode) pick = list.find(r => r.role_code === editRoleCode)
      if (!pick) pick = list.find(r => r.role_code === 'employee') || list[0] || null
    }
    const nextRid = pick ? Number(pick.role_id) : 0
    const changed = curRid > 0 && nextRid > 0 && nextRid !== curRid
    const pickIdx = pick ? list.indexOf(pick) : 0
    this.setData({
      'form.role_id': nextRid,
      rolesIndex: pickIdx >= 0 ? pickIdx : 0,
      roleTip: pick ? this._roleTipOf(pick) : '',
    })
    if (changed) {
      wx.showToast({ title: `原身份在当前部门不可用，已切换为「${(pick && pick.role_name) || ''}」`, icon: 'none' })
    }
  },

  onFormStatusChange(e) {
    if (this.data.isSelfAccount && !e.detail) {
      return wx.showToast({ title: '不能停用自己的账号', icon: 'none' })
    }
    this.setData({ 'form.status': e.detail ? 1 : 0 })
  },

  async onFormSubmit() {
    const { form, formMode, depts } = this.data
    const name = (form.name || '').trim()
    const phone = (form.phone || '').trim()
    const dept_id = Number(form.dept_id) || 0

    if (!name) return wx.showToast({ title: '请填写姓名', icon: 'none' })
    if (!phone) return wx.showToast({ title: '请填写手机号', icon: 'none' })
    if (!PHONE_RE.test(phone)) return wx.showToast({ title: '手机号格式不正确（11 位数字，1 开头）', icon: 'none' })
    if (dept_id <= 0) return wx.showToast({ title: '请选择部门', icon: 'none' })
    if (!depts.some(d => d.dept_id === dept_id)) {
      return wx.showToast({ title: '所选部门不在当前账号权限范围内', icon: 'none' })
    }

    const roleId = Number(form.role_id) || 0
    if (roleId <= 0) return wx.showToast({ title: '请选择员工身份', icon: 'none' })

    this.setData({ saving: true })
    try {
      if (formMode === 'add') {
        const res = await KitchenAPI.addStaff({
          name, phone, deptId: dept_id, status: Number(form.status) === 0 ? 0 : 1, roleId,
        })
        this.setData({
          showForm: false,
          showPassword: true,
          passwordInfo: {
            mode: 'add',
            name,
            password: (res && res.password) || '',
          },
        })
      } else {
        await KitchenAPI.updateStaff({
          id: form.id, name, phone, deptId: dept_id,
          status: Number(form.status) === 0 ? 0 : 1, roleId,
        })
        this.setData({ showForm: false })
        wx.showToast({ title: '已保存', icon: 'success' })
      }
      this._loadStaffList()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  // ── 编辑弹窗内：解绑微信（仅在编辑模式下，作用于当前编辑的员工） ──
  onUnbindWechat() {
    const { form, saving, isSelfAccount } = this.data
    if (saving || !form.id || isSelfAccount) return
    Dialog.confirm({
      title: '解绑微信',
      message: `确认要解绑「${form.name}」的微信吗？解绑后该员工需要重新登录。`,
      confirmButtonText: '解绑',
      confirmButtonColor: '#ee0a24',
    }).then(async () => {
      try {
        await KitchenAPI.unbindStaffWechat({ id: form.id })
        this.setData({ showForm: false })
        wx.showToast({ title: '已解绑', icon: 'success' })
        this._loadStaffList()
      } catch (err) {
        wx.showToast({ title: (err && err.message) || '解绑失败', icon: 'none' })
      }
    }).catch(() => { /* 取消 */ })
  },

  // ── 编辑弹窗内：删除员工（仅限非本人且无报餐记录的员工） ──
  onDeleteStaff() {
    const { form, saving, isSelfAccount } = this.data
    if (saving || !form.id || isSelfAccount) return
    Dialog.confirm({
      title: '删除员工',
      message: `确认要删除「${form.name}」吗？删除后账号立即失效，且仅限无报餐记录的员工。`,
      confirmButtonText: '删除',
      confirmButtonColor: '#ee0a24',
    }).then(async () => {
      try {
        await KitchenAPI.deleteStaff({ id: form.id })
        this.setData({ showForm: false })
        wx.showToast({ title: '已删除', icon: 'success' })
        this._loadStaffList()
      } catch (err) {
        wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
      }
    }).catch(() => { /* 取消 */ })
  },

  // ── 编辑弹窗内：重置密码（作用于当前编辑的员工） ──
  onResetPassword() {
    const { form, saving, isSelfAccount } = this.data
    if (saving || !form.id || isSelfAccount) return
    Dialog.confirm({
      title: '重置密码',
      message: `确认要重置「${form.name}」的密码吗？重置后密码将随机生成。`,
      confirmButtonText: '重置',
    }).then(async () => {
      try {
        const res = await KitchenAPI.resetStaffPassword({ id: form.id })
        this.setData({
          showForm: false,
          showPassword: true,
          passwordInfo: {
            mode: 'reset',
            name: form.name,
            password: (res && res.password) || '',
          },
        })
        this._loadStaffList()
      } catch (err) {
        wx.showToast({ title: (err && err.message) || '重置失败', icon: 'none' })
      }
    }).catch(() => { /* 取消 */ })
  },

  // ── 密码展示弹窗 ───────────────────────────────────
  onPasswordClose() {
    this.setData({ showPassword: false })
  },

  // 复制密码到剪贴板
  onCopyPassword() {
    const pwd = this.data.passwordInfo.password
    if (!pwd) return
    wx.setClipboardData({
      data: pwd,
      fail: () => wx.showToast({ title: '复制失败，请手动复制', icon: 'none' }),
    })
  },

  // ══════════════════════════════════════════════════
  // 批量导入
  // ══════════════════════════════════════════════════
  onBatchImport() {
    if (!this.data.hasPermission) return wx.showToast({ title: '当前账号无可管理的部门', icon: 'none' })
    if (!this.data.canAddStaff) return wx.showToast({ title: '当前部门已停用，无法批量导入', icon: 'none' })
    const importDepts = this._formDepts(0)
    if (!importDepts.length) return wx.showToast({ title: '暂无可用的启用部门，无法导入', icon: 'none' })
    const cur = this.data.depts[this.data.currentDeptIndex] || {}
    let idx = importDepts.findIndex(d => Number(d.dept_id) === Number(cur.dept_id))
    if (idx < 0) idx = 0
    const dept = importDepts[idx] || {}
    this.setData({
      showImport: true,
      importText: '',
      importPreview: null,
      importPassword: '',
      importDepts,
      importDeptIndex: idx,
      importDeptId: dept.dept_id || 0,
      importRoles: [],
      importRoleIndex: 0,
      importRoleId: 0,
    })
    this._loadImportRoles(dept.dept_id || 0)
  },

  onImportClose() {
    if (this.data.importing) return
    this.setData({ showImport: false })
  },

  // 阻止冒泡：点击弹窗内容时不关闭弹窗
  onImportNoop() {},

  onImportDeptChange(e) {
    const idx = Number(e.detail.value) || 0
    const dept = this.data.importDepts[idx]
    this.setData({
      importDeptIndex: idx,
      importDeptId: dept ? dept.dept_id : 0,
      importRoles: [],
      importRoleIndex: 0,
      importRoleId: 0,
    })
    this._loadImportRoles(dept ? dept.dept_id : 0)
  },

  onImportRoleChange(e) {
    const idx = Number(e.detail.value) || 0
    const role = (this.data.importRoles || [])[idx]
    if (!role) return
    this.setData({ importRoleIndex: idx, importRoleId: Number(role.role_id) })
  },

  // 拉取导入部门可分配的角色，默认选中普通员工
  async _loadImportRoles(deptId) {
    const target = Number(deptId) || 0
    if (target <= 0) {
      this.setData({ importRoles: [], importRoleIndex: 0, importRoleId: 0 })
      return
    }
    this.setData({ loadingImportRoles: true })
    try {
      const data = await KitchenAPI.getAssignableRoles({ deptId: target })
      const roles = (data && data.list) || []
      const pick = roles.find(r => r.role_code === 'employee') || roles[0] || null
      this.setData({
        importRoles: roles,
        importRoleIndex: pick ? roles.indexOf(pick) : 0,
        importRoleId: pick ? Number(pick.role_id) : 0,
      })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '获取可分配角色失败', icon: 'none' })
    } finally {
      this.setData({ loadingImportRoles: false })
    }
  },

  // 粘贴内容变化：保存原文并即时解析预览
  onImportTextInput(e) {
    this.setData({ importText: e.detail.value || '' })
    this._refreshImportPreview()
  },

  // 解析导入文本：每行一名员工，格式「姓名,手机号」
  // 分隔符支持中英文逗号、顿号、分号、空格、Tab
  _parseImportText() {
    const lines = (this.data.importText || '').split(/\r?\n/)
    const rows = []
    const seen = new Map()
    lines.forEach((raw, i) => {
      const line = i + 1
      const text = (raw || '').trim()
      if (!text) return
      const parts = text.split(/[,，、;；\t\s]+/).filter(Boolean)
      const phoneParts = parts.filter(p => PHONE_RE.test(p))
      if (phoneParts.length === 0) {
        rows.push({ line, name: text, phone: '', ok: false, message: '未识别到 11 位手机号' })
        return
      }
      if (phoneParts.length > 1) {
        rows.push({ line, name: text, phone: '', ok: false, message: '一行只能包含一个手机号' })
        return
      }
      const phone = phoneParts[0]
      const name = parts.filter(p => p !== phone).join('').slice(0, 20)
      if (!name) {
        rows.push({ line, name: '', phone, ok: false, message: '缺少姓名' })
        return
      }
      if (seen.has(phone)) {
        rows.push({ line, name, phone, ok: false, message: `手机号与第 ${seen.get(phone)} 行重复` })
        return
      }
      seen.set(phone, line)
      rows.push({ line, name, phone, ok: true })
    })
    return rows
  },

  _refreshImportPreview() {
    const rows = this._parseImportText()
    if (!rows.length) {
      this.setData({ importPreview: null })
      return
    }
    const validCount = rows.filter(r => r.ok).length
    const errors = rows
      .filter(r => !r.ok)
      .map(r => ({ line: r.line, message: `第 ${r.line} 行：${r.message}` }))
    this.setData({
      importPreview: {
        total: rows.length,
        validCount,
        errorCount: errors.length,
        errors: errors.slice(0, 5),
        errorMore: Math.max(0, errors.length - 5),
      },
    })
  },

  // 统一初始密码输入（必填，8-20 位）
  onImportPwdInput(e) {
    this.setData({ importPassword: e.detail || '' })
  },

  async onImportSubmit() {
    const { importDeptId, importRoleId, importing, importPreview } = this.data
    if (importing) return
    if (importPreview && importPreview.errorCount > 0) {
      return wx.showToast({ title: '存在格式错误的行，请修正后再导入', icon: 'none' })
    }
    const staff = this._parseImportText()
      .filter(r => r.ok)
      .map(r => ({ name: r.name, phone: r.phone }))
    if (!staff.length) return wx.showToast({ title: '请先粘贴员工数据（每行：姓名,手机号）', icon: 'none' })
    if (!importDeptId) return wx.showToast({ title: '请选择部门', icon: 'none' })
    if (!importRoleId) return wx.showToast({ title: '请选择员工身份', icon: 'none' })
    const password = (this.data.importPassword || '').trim()
    if (!password) return wx.showToast({ title: '请填写统一初始密码', icon: 'none' })
    if (!isValidPassword(password)) {
      return wx.showToast({ title: PASSWORD_RULE_TIP, icon: 'none' })
    }

    this.setData({ importing: true })
    try {
      const res = await KitchenAPI.batchAddStaff({
        deptId: importDeptId,
        roleId: importRoleId,
        staff,
        password,
      })
      const successCount = (res && res.successCount) || 0
      const failCount = (res && res.failCount) || 0
      const failRows = ((res && res.results) || []).filter(r => !r.ok)

      this.setData({ showImport: false })
      if (failCount === 0) {
        // 全部成功：无需弹窗（统一密码由发起人自己填写），仅提示结果
        wx.showToast({ title: `成功导入 ${successCount} 名员工`, icon: 'success' })
      } else if (successCount === 0) {
        // 全部失败：弹窗列出原因
        this.setData({
          showImportResult: true,
          importResult: { successCount, failCount, failRows },
        })
      } else {
        // 部分成功：弹窗只列失败行
        wx.showToast({ title: `成功 ${successCount} 名，失败 ${failCount} 名`, icon: 'none' })
        this.setData({
          showImportResult: true,
          importResult: { successCount, failCount, failRows },
        })
      }
      this._loadStaffList()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '导入失败', icon: 'none' })
    } finally {
      this.setData({ importing: false })
    }
  },

  onImportResultClose() {
    this.setData({ showImportResult: false, importResult: null })
  },

  // 复制失败行（每行：姓名,手机号,失败原因），便于对照修改后重新导入
  onCopyImportResult() {
    const res = this.data.importResult
    if (!res || !res.failRows || !res.failRows.length) return
    const data = res.failRows
      .map(r => `${r.name || '(空)'},${r.phone || '(空)'},失败：${r.message}`)
      .join('\n')
    wx.setClipboardData({
      data,
      fail: () => wx.showToast({ title: '复制失败，请手动复制', icon: 'none' }),
    })
  },
})