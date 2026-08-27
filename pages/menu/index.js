// pages/menu/index.js — 菜单页（对齐原型 EmployeeMenu）
const { MenuAPI } = require('../../services/api')

Page({
  data: {
    menuDays: [],
    loading: false,
  },

  onLoad() {
    this._loadMenu()
  },

  onShow() {
    this._loadMenu()
  },

  async _loadMenu() {
    try {
      this.setData({ loading: true })

      // 当前用户的部门，菜单必须与用户 location_id 一致
      const app = getApp()
      const userInfo = app.globalData.userInfo || {}
      const location_id = userInfo.location_id

      if (location_id == null || location_id === '') {
        console.warn('[Menu] 用户没有部门ID，无法加载菜单')
        wx.showToast({ title: '未找到部门信息', icon: 'none' })
        this.setData({ loading: false })
        return
      }

      // 调用云函数获取当前轮换菜单（业务失败会 reject，由 catch 兜底）
      const menuData = await MenuAPI.getCurrentMenu(location_id)

      if (menuData && menuData.meals) {
        // 将meals数组转换为页面需要的格式
        const menuDays = this._formatMenuData(menuData.meals)

        this.setData({ menuDays, loading: false })
      } else {
        console.error('获取菜单失败: 返回数据为空')
        wx.showToast({
          title: '未找到有效菜单',
          icon: 'none'
        })
        this.setData({ loading: false })
      }
    } catch (err) {
      console.error('加载菜单异常:', err)
      wx.showToast({
        title: err.message || '加载失败',
        icon: 'none'
      })
      this.setData({ loading: false })
    }
  },

  /**
   * 格式化菜单数据
   * @param {Array} meals - 菜单数组，每个元素包含bf(早餐)、lunch(午餐)、dinner(晚餐)
   * @returns {Array} 格式化后的菜单数据
   */
  _formatMenuData(meals) {
    if (!meals || !Array.isArray(meals)) {
      return []
    }
    
    const weekDays = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']
    
    // 根据meals长度生成对应天数的菜单
    return meals.map((meal, index) => {
      return {
        day: weekDays[index % 7], // 循环使用星期
        breakfast: meal.bf || '',
        lunch: meal.lunch || '',
        dinner: meal.dinner || ''
      }
    })
  },
})
