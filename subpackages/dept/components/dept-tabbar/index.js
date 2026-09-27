// subpackages/dept/components/dept-tabbar/index.js — 部门工作台底部导航
// 工作台仅部门管理员 / 系统管理员可进入，四个 Tab 对其均可见，无需按角色过滤。

/** Tab 列表：统计 / 收费 / 配置 / 我的 */
const ITEMS = [
  { key: 'stats', label: '统计', icon: 'chart-trending-o', url: '/subpackages/dept/pages/stats/index' },
  { key: 'billing', label: '收费', icon: 'bill-o', url: '/subpackages/dept/pages/billing/index' },
  { key: 'workbench', label: '配置', icon: 'apps-o', url: '/subpackages/dept/pages/workbench/index' },
  { key: 'profile', label: '我的', icon: 'user-o', url: '/subpackages/dept/pages/profile/index' },
]

Component({
  properties: {
    active: {
      type: String,
      value: '',
    },
  },

  data: {
    items: ITEMS,
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