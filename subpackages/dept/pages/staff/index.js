// subpackages/dept/pages/staff/index.js — 员工管理页
const M = require('../../../../utils/mock')

Page({
  data: {
    // 部门选择
    departments: [],
    departmentNames: [],
    currentDeptIndex: 0,

    // 搜索
    searchKey: '',

    // 员工列表
    staffList: [],
    loading: false,
    hasMore: true,
    page: 1,

    // 弹窗
    showStaffModal: false,
    editMode: false,  // false=新增, true=编辑
    formData: {
      id: '',
      name: '',
      phone: '',
      department: '',
      role: 'employee',
    },

    // 批量导入
    showImportModal: false,
    importList: [],
    importLoading: false,
    importErrorCount: 0,    // Phase 4.5: 错误行数
    importValidCount: 0,    // Phase 4.5: 可导入行数
  },

  onLoad() {
    this._loadDepartments()
  },

  onShow() {
    this._loadStaffList(true)
  },

  // 加载部门列表
  _loadDepartments() {
    const app = getApp()
    if (app.globalData.devMock) {
      const departments = M.mockDepartments || [
        { id: 1, name: '研发部' },
        { id: 2, name: '行政部' },
        { id: 3, name: '财务部' },
      ]
      const departmentNames = departments.map(d => d.name)
      this.setData({ departments, departmentNames })
      return
    }
    // TODO: 接入真实 API
  },

  // 部门切换
  onDeptChange(e) {
    this.setData({ currentDeptIndex: e.detail.value })
    this._loadStaffList(true)
  },

  // 搜索
  onSearch(e) {
    this.setData({ searchKey: e.detail })
    this._loadStaffList(true)
  },

  onClearSearch() {
    this.setData({ searchKey: '' })
    this._loadStaffList(true)
  },

  // 加载员工列表
  _loadStaffList(reset = false) {
    const app = getApp()
    if (app.globalData.devMock) {
      const mockStaff = M.mockStaffList || [
        { id: 1, name: '张三', phone: '13800138001', department: '研发部', role: 'employee', status: 'active', wechatBound: true },
        { id: 2, name: '李四', phone: '13800138002', department: '研发部', role: 'employee', status: 'active', wechatBound: true },
        { id: 3, name: '王五', phone: '13800138003', department: '行政部', role: 'dept_admin', status: 'active', wechatBound: false },
        { id: 4, name: '赵六', phone: '13800138004', department: '研发部', role: 'employee', status: 'disabled', wechatBound: true },
      ]
      this.setData({ staffList: mockStaff })
      return
    }
    // TODO: 接入真实 API
  },

  // 新增员工
  onAddStaff() {
    this.setData({
      showStaffModal: true,
      editMode: false,
      formData: { id: '', name: '', phone: '', department: '', role: 'employee' },
    })
  },

  // 编辑员工
  onEditStaff(e) {
    const id = e.currentTarget.dataset.id
    const staff = this.data.staffList.find(s => s.id === id)
    if (staff) {
      this.setData({
        showStaffModal: true,
        editMode: true,
        formData: { ...staff },
      })
    }
  },

  // 保存员工
  onSaveStaff() {
    const { formData, editMode } = this.data
    if (!formData.name || !formData.phone) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' })
      return
    }
    // TODO: 调用 API 保存
    wx.showToast({ title: editMode ? '修改成功' : '新增成功', icon: 'success' })
    this.setData({ showStaffModal: false })
    this._loadStaffList(true)
  },

  // 关闭弹窗
  onCloseStaffModal() {
    this.setData({ showStaffModal: false })
  },

  // 表单输入
  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`formData.${field}`]: e.detail })
  },

  // 选择部门
  onSelectDept() {
    // TODO: 弹出部门选择
  },

  // 选择角色
  onSelectRole() {
    // TODO: 弹出角色选择
  },

  // 禁用/启用员工
  onToggleStatus(e) {
    const id = e.currentTarget.dataset.id
    const status = e.currentTarget.dataset.status
    const action = status === 'active' ? '禁用' : '启用'
    wx.showModal({
      title: `确认${action}`,
      content: `确定要${action}该员工吗？`,
      success: (res) => {
        if (res.confirm) {
          // TODO: 调用 API
          wx.showToast({ title: `${action}成功`, icon: 'success' })
          this._loadStaffList(true)
        }
      },
    })
  },

  // 修改手机号
  onChangePhone(e) {
    // TODO: 弹出修改手机号弹窗
    wx.showToast({ title: '功能开发中', icon: 'none' })
  },

  // 解绑微信
  onUnbindWechat(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认解绑',
      content: '解绑后员工需重新绑定微信',
      success: (res) => {
        if (res.confirm) {
          // TODO: 调用 API
          wx.showToast({ title: '解绑成功', icon: 'success' })
          this._loadStaffList(true)
        }
      },
    })
  },

  // 批量导入
  onBatchImport() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'xls'],
      success: (res) => {
        const file = res.tempFiles[0]
        this._uploadAndParseExcel(file)
      },
      fail: () => {
        wx.showToast({ title: '请选择 Excel 文件', icon: 'none' })
      },
    })
  },

  // 上传并解析 Excel
  _uploadAndParseExcel(file) {
    wx.showLoading({ title: '解析中...' })

    const app = getApp()
    if (app.globalData.devMock) {
      // Mock 模式：模拟解析结果（含错误行）
      setTimeout(() => {
        wx.hideLoading()
        const mockImportList = [
          { rowNum: 2, name: '测试员工1', phone: '13800138010', department: '研发部', error: '' },
          { rowNum: 3, name: '测试员工2', phone: '13800138011', department: '研发部', error: '' },
          { rowNum: 4, name: '测试员工3', phone: '13800138012', department: '行政部', error: '' },
          { rowNum: 5, name: '测试员工4', phone: '13800138013', department: '不存在的部门', error: '部门不存在' },
          { rowNum: 6, name: '', phone: '13800138014', department: '研发部', error: '姓名为空' },
          { rowNum: 7, name: '测试员工5', phone: '123', department: '研发部', error: '手机号格式不正确' },
          { rowNum: 8, name: '测试员工6', phone: '13800138015', department: '研发部', error: '' },
        ]

        // 计算错误和可导入行数
        const errorCount = mockImportList.filter(item => item.error).length
        const validCount = mockImportList.length - errorCount

        this.setData({
          showImportModal: true,
          importList: mockImportList,
          importLoading: false,
          importErrorCount: errorCount,
          importValidCount: validCount,
        })
      }, 1000)
      return
    }

    // 真实模式：上传到后端解析
    wx.uploadFile({
      url: 'https://api.example.com/miniapp/v1/staff/import-preview',
      filePath: file.path,
      name: 'file',
      header: {
        'Authorization': `Bearer ${wx.getStorageSync('access_token')}`,
      },
      success: (res) => {
        wx.hideLoading()
        const data = JSON.parse(res.data)
        if (data.code === 0) {
          const list = data.data.list || []
          const errorCount = list.filter(item => item.error).length
          const validCount = list.length - errorCount

          this.setData({
            showImportModal: true,
            importList: list,
            importLoading: false,
            importErrorCount: errorCount,
            importValidCount: validCount,
          })
        } else {
          wx.showToast({ title: data.message || '解析失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        wx.showToast({ title: '上传失败', icon: 'none' })
        console.error('Upload failed:', err)
      },
    })
  },

  // 关闭导入弹窗
  onCloseImportModal() {
    this.setData({ showImportModal: false, importList: [] })
  },

  // 确认导入
  onConfirmImport() {
    const { importList } = this.data
    const validList = importList.filter(item => !item.error)

    if (validList.length === 0) {
      wx.showToast({ title: '没有可导入的数据', icon: 'none' })
      return
    }

    this.setData({ importLoading: true })

    const app = getApp()
    if (app.globalData.devMock) {
      // Mock 模式：模拟导入
      setTimeout(() => {
        this.setData({ importLoading: false, showImportModal: false })
        wx.showToast({ title: `成功导入 ${validList.length} 条数据`, icon: 'success' })
        this._loadStaffList(true)
      }, 1000)
      return
    }

    // 真实模式：调用导入 API
    const { request } = require('../../../../utils/request')
    request({
      url: '/staff/import-confirm',
      method: 'POST',
      data: { list: validList },
    }).then(() => {
      this.setData({ importLoading: false, showImportModal: false })
      wx.showToast({ title: `成功导入 ${validList.length} 条数据`, icon: 'success' })
      this._loadStaffList(true)
    }).catch((err) => {
      this.setData({ importLoading: false })
      wx.showToast({ title: err.message || '导入失败', icon: 'none' })
    })
  },
})
