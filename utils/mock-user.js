/**
 * DEV_MOCK 模式统一 mock 用户配置
 * 修改 roles 即可切换测试角色
 * 所有需要 mock 用户的文件均从此模块导入，避免角色不一致
 */

const ROLE_LABELS = {
  employee: '普通员工',
  kitchen: '食堂员工',
  dept_admin: '部门管理员',
  sys_admin: '系统管理员',
}

module.exports = {
  id: 1,
  name: '部门管理员（测试）',
  phone: '13800138000',
  dept: '食堂部',
  /**
   * 修改 roles 切换测试角色：
   *   ['employee']    普通员工
   *   ['kitchen']     食堂员工
   *   ['dept_admin']  部门管理员
   *   ['sys_admin']   系统管理员
   */
  roles: ['dept_admin'],
  avatar: '',

  /** 根据 roles 生成角色显示名 */
  getRoleName() {
    const primary = this.roles.find(r => r !== 'employee') || 'employee'
    return ROLE_LABELS[primary] || '普通员工'
  },
}
