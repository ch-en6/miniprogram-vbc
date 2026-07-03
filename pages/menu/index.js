// pages/menu/index.js — 菜单页（对齐原型 EmployeeMenu）
const M = require('../../utils/mock')

Page({
  data: {
    menuDays: [],
  },

  onLoad() {
    this._loadMenu()
  },

  onShow() {
    this._loadMenu()
  },

  _loadMenu() {
    const app = getApp()
    if (app.globalData.devMock) {
      this.setData({ menuDays: M.mockMenu.days })
      return
    }
    // TODO: 接入真实 API
  },
})
