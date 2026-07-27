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
      
      // 调用云函数获取当前轮换菜单
      const res = await MenuAPI.getCurrentMenu()
      
      if (res.result && res.result.code === 0) {
        const menuData = res.result.data
        
        // 将meals数组转换为页面需要的格式
        const menuDays = this._formatMenuData(menuData.meals)
        
        this.setData({ menuDays, loading: false })
      } else {
        console.error('获取菜单失败:', res.result?.message)
        wx.showToast({
          title: '未找到有效菜单',
          icon: 'none'
        })
        this.setData({ loading: false })
      }
    } catch (err) {
      console.error('加载菜单异常:', err)
      wx.showToast({
        title: '加载失败',
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
