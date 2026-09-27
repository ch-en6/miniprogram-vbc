// subpackages/dept/pages/workbench/index.js — 部门工作台 · 配置
const { ROLE } = require('../../../../utils/const')

/** 允许访问本页的角色 */
const ALLOWED_ROLES = [ROLE.DEPT_ADMIN, ROLE.SYS_ADMIN]

const ENTRIES = [
  {
    key: 'menu',
    icon: '🍽️',
    title: '菜单管理',
    path: '/subpackages/dept/pages/menu/index',
  },
  {
    key: 'notice',
    icon: '📢',
    title: '公告管理',
    path: '/subpackages/dept/pages/notice/index',
  },
  {
    key: 'staff',
    icon: '👥',
    title: '员工管理',
    path: '/subpackages/dept/pages/staff/index',
  },
  {
    key: 'dept',
    icon: '🏢',
    title: '部门管理',
    path: '/subpackages/admin/pages/dept-manage/index',
    sysOnly: true,
  },
  {
    key: 'location',
    icon: '🏬',
    title: '食堂管理',
    path: '/subpackages/admin/pages/location-manage/index',
    sysOnly: true,
  },
  {
    key: 'role',
    icon: '🔑',
    title: '角色管理',
    path: '/subpackages/admin/pages/permission/index',
    sysOnly: true,
  },
  {
    key: 'price',
    icon: '🏷️',
    title: '价格配置',
    path: '/subpackages/admin/pages/sys-config/index',
    sysOnly: true,
  },
]

Page({
  data: {
    entries: [],
  },

  onShow() {
    wx.hideHomeButton()

    const app = getApp()
    const roleCode = (app && app.globalData && app.globalData.roleCode) || ''

    // 安全兜底：非部门管理员 / 系统管理员不可进入。
    if (!ALLOWED_ROLES.includes(roleCode)) {
      wx.showToast({ title: '无管理员权限', icon: 'none' })
      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' })
      }, 800)
      return
    }

    // 部门管理员仅见 员工 / 菜单 / 公告；系统管理员见全部
    const entries = roleCode === ROLE.SYS_ADMIN
      ? ENTRIES
      : ENTRIES.filter(item => !item.sysOnly)
    this.setData({ entries })
  },

  /** 打开功能页 */
  onOpen(e) {
    const path = e.currentTarget.dataset.path
    if (!path) return
    wx.navigateTo({
      url: path,
      fail: (err) => {
        console.error('[dept-workbench] navigate fail:', path, err)
        wx.showToast({ title: '页面打开失败', icon: 'none' })
      },
    })
  },
})