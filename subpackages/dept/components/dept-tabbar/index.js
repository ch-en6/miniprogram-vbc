// subpackages/dept/components/dept-tabbar/index.js — 部门工作台底部导航
// 员工 / 统计 / 收费 / 菜单 / 公告 / 我的 是六个独立页面，点击 Tab 用 redirectTo 互斥切换
Component({
  properties: {
    active: {
      type: String,
      value: '',
    },
  },

  data: {
    items: [
      { key: 'staff', label: '员工', icon: 'friends-o', url: '/subpackages/dept/pages/staff/index' },
      { key: 'stats', label: '统计', icon: 'chart-trending-o', url: '/subpackages/dept/pages/stats/index' },
      { key: 'billing', label: '收费', icon: 'bill-o', url: '/subpackages/dept/pages/billing/index' },
      { key: 'menu', label: '菜单', icon: 'orders-o', url: '/subpackages/dept/pages/menu/index' },
      { key: 'notice', label: '公告', icon: 'bullhorn-o', url: '/subpackages/dept/pages/notice/index' },
      { key: 'profile', label: '我的', icon: 'user-o', url: '/subpackages/dept/pages/profile/index' },
    ],
  },

  methods: {
    onSwitch(e) {
      const key = e.detail
      if (key === this.data.active) return
      const item = this.data.items.find(i => i.key === key)
      if (!item) return
      wx.redirectTo({
        url: item.url,
        fail: err => console.error('[dept-tabbar] switch fail:', err),
      })
    },
  },
})
