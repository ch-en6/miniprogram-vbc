// subpackages/dept/pages/stat/index.js — 报餐统计页
const M = require('../../../../utils/mock')
const T = require('../../../../utils/time')

Page({
  data: {
    // 部门选择
    departments: [],
    departmentNames: [],
    currentDeptIndex: 0,

    // 明日报餐汇总
    tomorrowStat: { breakfast: 0, lunch: 0, dinner: 0 },

    // 筛选条件
    startDate: '',
    endDate: '',

    // 统计列表
    statList: [],
    loading: false,
  },

  onLoad() {
    this._setDefaultDateRange()
    this._loadDepartments()
  },

  onShow() {
    this._loadTomorrowStat()
    this._loadStatList()
  },

  // 设置默认日期范围（本月）
  _setDefaultDateRange() {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`
    this.setData({
      startDate: firstDay,
      endDate: lastDay,
    })
  },

  // 加载部门列表
  _loadDepartments() {
    const app = getApp()
    if (app.globalData.devMock) {
      const departments = M.mockDepartments || [
        { id: 1, name: '研发部' },
        { id: 2, name: '行政部' },
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
    this._loadTomorrowStat()
    this._loadStatList()
  },

  // 日期选择
  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value })
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value })
  },

  // 查询
  onSearch() {
    this._loadStatList()
  },

  // 加载明日报餐汇总
  _loadTomorrowStat() {
    const app = getApp()
    if (app.globalData.devMock) {
      // Mock 数据
      this.setData({
        tomorrowStat: { breakfast: 12, lunch: 15, dinner: 10 },
      })
      return
    }
    // TODO: 接入真实 API
  },

  // 加载统计列表
  _loadStatList() {
    const app = getApp()
    if (app.globalData.devMock) {
      // Mock 数据
      const statList = [
        { date: '2026-06-26', breakfast: 12, breakfastFamily: 3, lunch: 15, lunchFamily: 4, dinner: 10, dinnerFamily: 2 },
        { date: '2026-06-25', breakfast: 10, breakfastFamily: 2, lunch: 14, lunchFamily: 3, dinner: 9, dinnerFamily: 1 },
        { date: '2026-06-24', breakfast: 11, breakfastFamily: 2, lunch: 13, lunchFamily: 3, dinner: 8, dinnerFamily: 1 },
      ]
      this.setData({ statList })
      return
    }
    // TODO: 接入真实 API
  },

  // 导出 Excel
  onExport() {
    const { startDate, endDate, departments, currentDeptIndex } = this.data
    const departmentId = departments[currentDeptIndex]?.id

    if (!startDate || !endDate) {
      wx.showToast({ title: '请选择日期范围', icon: 'none' })
      return
    }

    const app = getApp()
    if (app.globalData.devMock) {
      // Mock 模式：模拟导出
      wx.showLoading({ title: '导出中...' })
      setTimeout(() => {
        wx.hideLoading()
        wx.showModal({
          title: '导出成功',
          content: '报餐统计数据已导出为 Excel 文件',
          showCancel: false,
          success: () => {
            // 在真实环境中，这里会下载并打开文件
            wx.showToast({ title: '导出成功', icon: 'success' })
          },
        })
      }, 1500)
      return
    }

    // 真实模式：调用导出 API
    this._exportExcel({
      url: '/stat/export',
      data: {
        startDate,
        endDate,
        departmentId,
      },
    })
  },

  // 导出 Excel 通用方法
  _exportExcel(options) {
    wx.showLoading({ title: '导出中...' })

    const { request } = require('../../../../utils/request')
    request({
      url: options.url,
      method: 'POST',
      data: options.data,
      responseType: 'arraybuffer',  // 重要：接收二进制数据
    }).then((res) => {
      // 方案一：后端返回文件链接
      if (res.fileUrl) {
        this._downloadAndOpenFile(res.fileUrl)
        return
      }

      // 方案二：后端返回二进制数据，写入临时文件
      const fs = wx.getFileSystemManager()
      const filePath = `${wx.env.USER_DATA_PATH}/export_${Date.now()}.xlsx`
      fs.writeFileSync(filePath, res, 'binary')

      wx.hideLoading()
      wx.openDocument({
        filePath: filePath,
        showMenu: true,  // 显示分享菜单
        success: () => {
          wx.showToast({ title: '导出成功', icon: 'success' })
        },
        fail: (err) => {
          wx.showToast({ title: '打开文件失败', icon: 'none' })
          console.error('Open document failed:', err)
        },
      })
    }).catch((err) => {
      wx.hideLoading()
      wx.showToast({ title: err.message || '导出失败', icon: 'none' })
    })
  },

  // 下载并打开文件
  _downloadAndOpenFile(fileUrl) {
    wx.downloadFile({
      url: fileUrl,
      success: (res) => {
        wx.hideLoading()
        if (res.statusCode === 200) {
          wx.openDocument({
            filePath: res.tempFilePath,
            showMenu: true,  // 显示分享菜单
            success: () => {
              wx.showToast({ title: '导出成功', icon: 'success' })
            },
            fail: (err) => {
              wx.showToast({ title: '打开文件失败', icon: 'none' })
              console.error('Open document failed:', err)
            },
          })
        } else {
          wx.showToast({ title: '下载失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        wx.showToast({ title: '下载失败', icon: 'none' })
        console.error('Download failed:', err)
      },
    })
  },
})
