// subpackages/dept/pages/staff/index.js — 部门工作台 · 员工管理
// 员工数据源：sys_emp（MySQL）
// 权限模型与部门工作台其他页一致：openid -> sys_emp.role_id
//   -> sys_role_location -> location_id[] -> sys_dept.id[]
//   所有增删改查的目标 dept_id 都限定在角色可管理部门集合内。
// 部门选择 / 搜索词 记忆在 utils/dept-store 的 store.state.staff，
// 不与统计 / 收费页的部门选择联动。
const store = require('../../../../utils/dept-store')
const { KitchenAPI } = require('../../../../services/api')
const Toast = require('@vant/weapp/toast/toast').default
const Dialog = require('@vant/weapp/dialog/dialog').default

// 简单手机号格式校验（11 位、以 1 开头）
const PHONE_RE = /^1\d{10}$/

Page({
  data: {
    // ── 列表 ──
    depts: [],                  // 当前角色可管理的部门（来自 store.state.depts）
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
    operatorCode: '',           // 操作者角色 code：deptAdmin / sysAdmin（决定可分配白名单）
    editRoleCode: '',           // 编辑模式下员工原 role_code（角色对齐 / 锁定判断用）
    roleLocked: false,          // 管理级员工身份当前操作者不可改（隐藏身份区、提交不传 roleId）
    roleTip: '',                // 当前所选身份的提示文案
    saving: false,

    // ── 初始密码 / 重置密码展示弹窗 ──
    showPassword: false,
    passwordInfo: { mode: 'add', name: '', password: '' },
  },

  onShow() {
    if (wx.hideHomeButton) wx.hideHomeButton()
    const st = (store.state && store.state.staff) || {}
    this.setData({ searchKey: st.searchKey || '' })
    this._ensureDeptsAndLoad()
  },

  async _ensureDeptsAndLoad() {
    await store.ensureDepts()
    const depts = store.state.depts || []
    const hasPermission = depts.length > 0
    const remembered = store.state.staff
    const fallback = store.defaultDeptIndex ? store.defaultDeptIndex() : 0
    const idx = (typeof remembered.deptIndex === 'number'
      && remembered.deptIndex < depts.length)
      ? remembered.deptIndex
      : (fallback < depts.length ? fallback : 0)

    this.setData({
      depts,
      hasPermission,
      currentDeptIndex: idx,
      canAddStaff: this._isDeptEnabled(depts[idx]),
    })
    if (!hasPermission) {
      this.setData({ staffList: [] })
      return
    }
    this._loadStaffList()
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
      Toast(err.message || '加载员工失败')
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
    store.setStaff({ searchKey: keyword })
    // 强制重拉部门/食堂列表（启用/停用状态可能已被修改），再重新初始化页面
    await store.refreshDepts()
    await this._ensureDeptsAndLoad()
    wx.stopPullDownRefresh()
  },

  // ── 部门选择 ────────────────────────────────────────
  onDeptChange(e) {
    const index = Number(e.detail.value) || 0
    if (index === this.data.currentDeptIndex) return
    store.setStaff({ deptIndex: index })
    // 切部门时清空搜索（避免跨部门搜到不在结果集的同名/手机号）
    store.setStaff({ searchKey: '' })
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
    store.setStaff({ searchKey: keyword })
    this.setData({ searchKey: keyword })
    this._loadStaffList()
  },

  onStaffClear() {
    store.setStaff({ searchKey: '' })
    this.setData({ searchKey: '' })
    this._loadStaffList()
  },

  // 部门是否启用（sys_dept.status = 1）
  // 与 _formDepts 的可选口径保持一致：停用部门既不进下拉，也不允许新增员工
  _isDeptEnabled(dept) {
    return !!dept && Number(dept.status) === 1
  },

  // 表单可选部门：仅启用部门（sys_dept.status=1）；
  // 编辑停用部门下的员工时，把其原部门置于首位以保证回显（不主动改则归属不变）
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
    if (!this.data.hasPermission) return Toast('当前账号无可管理的部门')
    if (!this.data.canAddStaff) return Toast('当前部门已停用，无法新增员工')
    const formDepts = this._formDepts(0)
    if (!formDepts.length) return Toast('暂无可用的启用部门，无法新增员工')
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
      roleLocked: false,
      roleTip: '',
    })
    // 预取该部门当前操作者可分配的角色（普通员工排首位，默认选中）
    this._loadFormRoles(dept.dept_id || 0)
  },

  // ── 编辑员工（改姓名/手机号/部门/状态/身份 + 重置密码、解绑微信 均在此弹窗内完成） ──
  onEditStaff(e) {
    const id = Number(e.currentTarget.dataset.id) || 0
    const item = this.data.staffList.find(s => s.id === id)
    if (!item) return Toast('未找到员工信息')
    const formDepts = this._formDepts(item.dept_id)
    const deptIdx = formDepts.findIndex(d => Number(d.dept_id) === Number(item.dept_id))
    const roleId = Number(item.role_id) || 0
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
      roleLocked: false,
      roleTip: '',
    })
    // 拉取该部门可分配角色（用于身份回显与切换；roleLocked 在加载后判定）
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
      Toast((err && err.message) || '获取可分配角色失败')
    } finally {
      this.setData({ loadingRoles: false })
    }
  },

  // 角色列表就绪后：判定锁定 + 对齐当前选中项
  _alignRoleSelection(roles) {
    const { formMode, form, editRoleCode, operatorCode } = this.data
    const list = roles || []

    // 锁定判定：编辑态 + 员工原身份非普通/食堂（管理级）+ 当前操作者非 sysAdmin
    let locked = false
    if (formMode === 'edit') {
      const editable = editRoleCode === '' || editRoleCode === 'employee' || editRoleCode === 'kitchen'
      if (!editable && operatorCode !== 'sysAdmin') locked = true
    }
    if (locked) {
      // 管理级员工：隐藏身份选择，提交时不传 roleId（后端保持原身份）
      this.setData({ roleLocked: true, roleTip: '', rolesIndex: 0 })
      return
    }
    this.setData({ roleLocked: false })

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
      Toast(`原身份在当前部门不可用，已切换为「${(pick && pick.role_name) || ''}」`)
    }
  },

  onFormStatusChange(e) {
    this.setData({ 'form.status': e.detail ? 1 : 0 })
  },

  async onFormSubmit() {
    const { form, formMode, depts } = this.data
    const name = (form.name || '').trim()
    const phone = (form.phone || '').trim()
    const dept_id = Number(form.dept_id) || 0

    if (!name) return Toast('请填写姓名')
    if (!phone) return Toast('请填写手机号')
    if (!PHONE_RE.test(phone)) return Toast('手机号格式不正确（11 位数字，1 开头）')
    if (dept_id <= 0) return Toast('请选择部门')
    if (!depts.some(d => d.dept_id === dept_id)) {
      return Toast('所选部门不在当前账号权限范围内')
    }

    const roleLocked = !!this.data.roleLocked
    const roleId = roleLocked ? 0 : (Number(form.role_id) || 0)
    if (!roleLocked && roleId <= 0) return Toast('请选择员工身份')

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
        const payload = {
          id: form.id, name, phone, deptId: dept_id,
          status: Number(form.status) === 0 ? 0 : 1,
        }
        // 管理级身份锁定时不提交 roleId（缺省 = 后端保持原身份）
        if (!roleLocked) payload.roleId = roleId
        await KitchenAPI.updateStaff(payload)
        this.setData({ showForm: false })
        Toast('已保存')
      }
      this._loadStaffList()
    } catch (err) {
      Toast((err && err.message) || '保存失败')
    } finally {
      this.setData({ saving: false })
    }
  },

  // ── 编辑弹窗内：解绑微信（仅在编辑模式下，作用于当前编辑的员工） ──
  onUnbindWechat() {
    const { form, saving } = this.data
    if (saving || !form.id) return
    Dialog.confirm({
      title: '解绑微信',
      message: `确认要解绑「${form.name}」的微信吗？解绑后该员工需要重新登录。`,
      confirmButtonText: '解绑',
      confirmButtonColor: '#ee0a24',
    }).then(async () => {
      try {
        await KitchenAPI.unbindStaffWechat({ id: form.id })
        this.setData({ showForm: false })
        Toast('已解绑')
        this._loadStaffList()
      } catch (err) {
        Toast((err && err.message) || '解绑失败')
      }
    }).catch(() => { /* 取消 */ })
  },

  // ── 编辑弹窗内：重置密码（作用于当前编辑的员工） ──
  onResetPassword() {
    const { form, saving } = this.data
    if (saving || !form.id) return
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
        Toast((err && err.message) || '重置失败')
      }
    }).catch(() => { /* 取消 */ })
  },

  // ── 密码展示弹窗 ───────────────────────────────────
  onPasswordClose() {
    this.setData({ showPassword: false })
  },

  // 复制密码到剪贴板
  // 成功后微信自带「内容已复制」提示，此处不再重复弹自己的成功提示，
  // 避免两个提示接连出现；仅在失败时给出兜底提示
  onCopyPassword() {
    const pwd = this.data.passwordInfo.password
    if (!pwd) return
    wx.setClipboardData({
      data: pwd,
      fail: () => Toast('复制失败，请手动复制'),
    })
  },

  // 批量导入（暂时保留为占位，业务接口就绪后替换）
  onBatchImport() {
    Toast('批量导入功能开发中')
  },
})