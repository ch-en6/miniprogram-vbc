// utils/mock.js — 开发阶段 Mock 数据
// DEV_MOCK=true 时各页面使用此文件中的数据，不调用后端接口

// ─── 今日报餐状态（首页） ──────────────────────────────────────
const mockTodayStatus = {
  breakfast: { status: 'booked', qty: 1 },
  lunch:     { status: 'booked', qty: 2, family: 1 },
  dinner:    { status: 'not_booked', qty: 0 },
}

// ─── 本月统计（首页） ──────────────────────────────────────────
const mockMonthStat = {
  breakfast: 8,
  lunch: 12,
  dinner: 6,
}

// ─── 公告 ──────────────────────────────────────────────────────
const mockAnnouncement = '本周生效菜单：菜单 1。如有临时变更，以公告说明为准。'

// ─── 月历报餐数据 ──────────────────────────────────────────────
const mockMonthBookings = {}

// ─── 本周菜单 ──────────────────────────────────────────────────
const mockMenu = {
  weekName: '菜单 1',
  days: [
    { day: '周一', breakfast: '稀饭\n包子、鸡蛋\n萝卜干、酸菜', lunch: '红烧猪脚\n西红柿炒蛋\n冬瓜海带骨头汤', dinner: '酒糟肉\n四季豆炒肉\n紫菜蛋汤' },
    { day: '周二', breakfast: '瘦肉汤\n包子、鸡蛋', lunch: '炒鸡肉\n蒜苔炒肉\n萝卜瘦肉汤', dinner: '炒饭\n炸鸡排\n平菇瘦肉豆腐汤' },
    { day: '周三', breakfast: '稀饭\n包子、鸡蛋\n榨菜、酸菜', lunch: '牛腩炖萝卜\n椒盐虾\n茶树菇骨头汤', dinner: '咸菜肉\n长豆炒肉\n冬瓜花蛤汤' },
    { day: '周四', breakfast: '米粉\n红糖馒头、鸡蛋', lunch: '水煮肉片\n笋炒肉\n生地花生汤', dinner: '红烧带鱼\n西芹炒肉\n牛肉丸汤' },
    { day: '周五', breakfast: '稀饭\n包子、鸡蛋\n榨菜、酸菜', lunch: '清蒸鱼\n芋子炒肉\n玉米胡萝卜骨头汤', dinner: '红烧肉\n窝笋炒肉\n鱼汤' },
    { day: '周六', breakfast: '稀饭\n包子、鸡蛋\n萝卜干、酸菜', lunch: '啤酒鸭\n蒜苗回锅肉\n山药瘦肉汤', dinner: '炒米粉\n卤鸡腿\n西红柿蛋汤' },
    { day: '周日', breakfast: '稀饭\n馒头、鸡蛋\n萝卜干、酸菜', lunch: '文蛤蒸蛋\n葫芦瓜炒肉\n绿豆瘦肉汤', dinner: '香菇炖肉\n丝瓜炒鸡蛋\n枸杞叶瘦肉汤' },
  ],
}

// ─── 报餐记录 ──────────────────────────────────────────────────
// 仅包含 qty > 0 的记录（qty=0 表示取消报餐，不展示）
// 费用计算：员工餐 = min(qty,1) * empPrice，家属餐 = max(qty-1,0) * famPrice
// 研发部餐价：早餐 emp=5/fam=8，午餐 emp=10/fam=15，晚餐 emp=8/fam=12
const mockRecords = [
  // 06-15
  { id: 1, date: '2026-06-15', mealType: 'breakfast', qty: 1, family: 0, empAmount: 5,  famAmount: 0,  amount: 5,  time: '2026-06-14 15:30' },
  { id: 2, date: '2026-06-15', mealType: 'lunch',     qty: 1, family: 0, empAmount: 10, famAmount: 0,  amount: 10, time: '2026-06-14 15:30' },
  { id: 3, date: '2026-06-15', mealType: 'dinner',    qty: 1, family: 0, empAmount: 8,  famAmount: 0,  amount: 8,  time: '2026-06-14 15:30' },
  // 06-16
  { id: 4, date: '2026-06-16', mealType: 'breakfast', qty: 1, family: 0, empAmount: 5,  famAmount: 0,  amount: 5,  time: '2026-06-15 16:00' },
  { id: 5, date: '2026-06-16', mealType: 'lunch',     qty: 2, family: 1, empAmount: 10, famAmount: 15, amount: 25, time: '2026-06-15 16:00' },
  // 06-17
  { id: 6, date: '2026-06-17', mealType: 'lunch',     qty: 2, family: 1, empAmount: 10, famAmount: 15, amount: 25, time: '2026-06-16 14:20' },
  { id: 7, date: '2026-06-17', mealType: 'dinner',    qty: 1, family: 0, empAmount: 8,  famAmount: 0,  amount: 8,  time: '2026-06-16 14:20' },
  // 06-18
  { id: 8, date: '2026-06-18', mealType: 'breakfast', qty: 1, family: 0, empAmount: 5,  famAmount: 0,  amount: 5,  time: '2026-06-17 09:10' },
  { id: 9, date: '2026-06-18', mealType: 'lunch',     qty: 2, family: 1, empAmount: 10, famAmount: 15, amount: 25, time: '2026-06-17 09:10' },
  { id: 10, date: '2026-06-18', mealType: 'dinner',   qty: 1, family: 0, empAmount: 8,  famAmount: 0,  amount: 8,  time: '2026-06-17 09:10' },
  // 06-19
  { id: 11, date: '2026-06-19', mealType: 'breakfast', qty: 1, family: 0, empAmount: 5,  famAmount: 0,  amount: 5,  time: '2026-06-18 10:00' },
  { id: 12, date: '2026-06-19', mealType: 'lunch',     qty: 1, family: 0, empAmount: 10, famAmount: 0,  amount: 10, time: '2026-06-18 10:00' },
  // 06-22
  { id: 13, date: '2026-06-22', mealType: 'breakfast', qty: 1, family: 0, empAmount: 5,  famAmount: 0,  amount: 5,  time: '2026-06-19 11:30' },
  { id: 14, date: '2026-06-22', mealType: 'lunch',     qty: 2, family: 1, empAmount: 10, famAmount: 15, amount: 25, time: '2026-06-19 11:30' },
  { id: 15, date: '2026-06-22', mealType: 'dinner',    qty: 1, family: 0, empAmount: 8,  famAmount: 0,  amount: 8,  time: '2026-06-19 11:30' },
  // 06-23
  { id: 16, date: '2026-06-23', mealType: 'breakfast', qty: 1, family: 0, empAmount: 5,  famAmount: 0,  amount: 5,  time: '2026-06-22 14:00' },
  { id: 17, date: '2026-06-23', mealType: 'lunch',     qty: 1, family: 0, empAmount: 10, famAmount: 0,  amount: 10, time: '2026-06-22 14:00' },
  // 06-25
  { id: 18, date: '2026-06-25', mealType: 'breakfast', qty: 1, family: 0, empAmount: 5,  famAmount: 0,  amount: 5,  time: '2026-06-24 16:00' },
  { id: 19, date: '2026-06-25', mealType: 'lunch',     qty: 2, family: 1, empAmount: 10, famAmount: 15, amount: 25, time: '2026-06-24 16:00' },
  { id: 20, date: '2026-06-25', mealType: 'dinner',    qty: 1, family: 0, empAmount: 8,  famAmount: 0,  amount: 8,  time: '2026-06-24 16:00' },
  // 06-26
  { id: 21, date: '2026-06-26', mealType: 'breakfast', qty: 1, family: 0, empAmount: 5,  famAmount: 0,  amount: 5,  time: '2026-06-25 15:00' },
  { id: 22, date: '2026-06-26', mealType: 'lunch',     qty: 3, family: 2, empAmount: 10, famAmount: 30, amount: 40, time: '2026-06-25 15:00' },
]

// ─── 食堂今日总览 ──────────────────────────────────────────────
const mockKitchenToday = {
  date: '2026-06-29',
  summary: {
    breakfast: { persons: 38, portions: 41, family: 3 },
    lunch:     { persons: 66, portions: 79, family: 13 },
    dinner:    { persons: 42, portions: 47, family: 5 },
  },
  departments: [
    { name: '研发部',   breakfast: 15, lunch: 25, dinner: 18 },
    { name: '运营部',   breakfast: 8,  lunch: 18, dinner: 12 },
    { name: '行政部',   breakfast: 5,  lunch: 9,  dinner: 4 },
    { name: '财务部',   breakfast: 6,  lunch: 11, dinner: 5 },
    { name: '人事部',   breakfast: 4,  lunch: 7,  dinner: 3 },
  ],
}

// ─── 食堂明细（按日期查询，支持搜索） ──────────────────────────
// 字段名与后端 API 返回一致（snake_case），detail 页面 _loadMock 直接使用
const mockKitchenDetail = [
  { name: '张三',   dept_name: '研发部', meal_type: 'breakfast', qty: 1 },
  { name: '张三',   dept_name: '研发部', meal_type: 'lunch',     qty: 2 },
  { name: '张三',   dept_name: '研发部', meal_type: 'dinner',    qty: 1 },
  { name: '李四',   dept_name: '研发部', meal_type: 'lunch',     qty: 1 },
  { name: '李四',   dept_name: '研发部', meal_type: 'dinner',    qty: 1 },
  { name: '王五',   dept_name: '研发部', meal_type: 'breakfast', qty: 1 },
  { name: '赵六',   dept_name: '研发部', meal_type: 'lunch',     qty: 3 },
  { name: '钱七',   dept_name: '运营部', meal_type: 'lunch',     qty: 1 },
  { name: '钱七',   dept_name: '运营部', meal_type: 'dinner',    qty: 2 },
  { name: '孙八',   dept_name: '运营部', meal_type: 'breakfast', qty: 1 },
  { name: '孙八',   dept_name: '运营部', meal_type: 'lunch',     qty: 1 },
  { name: '周九',   dept_name: '行政部', meal_type: 'lunch',     qty: 1 },
  { name: '周九',   dept_name: '行政部', meal_type: 'dinner',    qty: 1 },
  { name: '吴十',   dept_name: '行政部', meal_type: 'breakfast', qty: 2 },
  { name: '郑十一', dept_name: '财务部', meal_type: 'lunch',     qty: 1 },
  { name: '郑十一', dept_name: '财务部', meal_type: 'dinner',    qty: 1 },
  { name: '冯十二', dept_name: '财务部', meal_type: 'breakfast', qty: 1 },
  { name: '冯十二', dept_name: '财务部', meal_type: 'lunch',     qty: 1 },
  { name: '陈十三', dept_name: '运营部', meal_type: 'breakfast', qty: 1 },
  { name: '陈十三', dept_name: '运营部', meal_type: 'dinner',    qty: 1 },
  { name: '褚十四', dept_name: '研发部', meal_type: 'lunch',     qty: 1 },
  { name: '褚十四', dept_name: '研发部', meal_type: 'dinner',    qty: 2 },
  { name: '卫十五', dept_name: '行政部', meal_type: 'lunch',     qty: 1 },
  { name: '蒋十六', dept_name: '财务部', meal_type: 'dinner',    qty: 1 },
  { name: '沈十七', dept_name: '运营部', meal_type: 'lunch',     qty: 2 },
  { name: '韩十八', dept_name: '研发部', meal_type: 'breakfast', qty: 1 },
  { name: '韩十八', dept_name: '研发部', meal_type: 'dinner',    qty: 1 },
  { name: '杨十九', dept_name: '行政部', meal_type: 'breakfast', qty: 1 },
  { name: '朱二十', dept_name: '财务部', meal_type: 'lunch',     qty: 1 },
]

// ─── 部门列表（部门管理员/系统管理员） ──────────────────────────
const mockDepartments = [
  { id: 1, name: '研发部' },
  { id: 2, name: '行政部' },
  { id: 3, name: '财务部' },
  { id: 4, name: '运营部' },
]

// ─── 员工列表（部门管理员） ──────────────────────────────────────
const mockStaffList = [
  { id: 1, name: '张三', phone: '13800138001', department: '研发部', role: 'employee', status: 'active', wechatBound: true },
  { id: 2, name: '李四', phone: '13800138002', department: '研发部', role: 'employee', status: 'active', wechatBound: true },
  { id: 3, name: '王五', phone: '13800138003', department: '行政部', role: 'dept_admin', status: 'active', wechatBound: false },
  { id: 4, name: '赵六', phone: '13800138004', department: '研发部', role: 'employee', status: 'disabled', wechatBound: true },
  { id: 5, name: '钱七', phone: '13800138005', department: '运营部', role: 'employee', status: 'active', wechatBound: true },
]

// ─── 部门餐价配置 ──────────────────────────────────────────────
// 每个部门可配置员工餐单价和家属餐单价（分早餐/午餐/晚餐）
const mockDeptPrices = {
  1: { name: '研发部', breakfast: { emp: 5, fam: 8 }, lunch: { emp: 10, fam: 15 }, dinner: { emp: 8, fam: 12 } },
  2: { name: '行政部', breakfast: { emp: 4, fam: 7 }, lunch: { emp: 9, fam: 14 }, dinner: { emp: 7, fam: 11 } },
  3: { name: '财务部', breakfast: { emp: 5, fam: 8 }, lunch: { emp: 10, fam: 15 }, dinner: { emp: 8, fam: 12 } },
  4: { name: '运营部', breakfast: { emp: 5, fam: 8 }, lunch: { emp: 10, fam: 15 }, dinner: { emp: 8, fam: 12 } },
}

// ─── 月度收费明细（按部门、按月份快照） ─────────────────────────
// 字段说明：
//   name: 姓名
//   mealLabel: 餐别（早餐/午餐/晚餐）
//   qty: 本月该餐报餐总份数
//   empPrice: 员工餐单价
//   famPrice: 家属餐单价
//   family: 家属餐份数 (= max(qty - 1, 0)，员工本人 1 份不收家属价)
//   empAmount: 员工餐金额 = min(qty, 1) * empPrice（员工本人最多 1 份按员工价）
//   famAmount: 家属餐金额 = family * famPrice
//   amount: 总金额 = empAmount + famAmount
const mockBillingList = [
  // 研发部（单价较高）
  { id: 1, name: '张三', mealLabel: '早餐', qty: 20, empPrice: 5, famPrice: 8, family: 19, empAmount: 5, famAmount: 152, amount: 157 },
  { id: 2, name: '张三', mealLabel: '午餐', qty: 22, empPrice: 10, famPrice: 15, family: 21, empAmount: 10, famAmount: 315, amount: 325 },
  { id: 3, name: '张三', mealLabel: '晚餐', qty: 18, empPrice: 8, famPrice: 12, family: 17, empAmount: 8, famAmount: 204, amount: 212 },
  { id: 4, name: '李四', mealLabel: '早餐', qty: 15, empPrice: 5, famPrice: 8, family: 14, empAmount: 5, famAmount: 112, amount: 117 },
  { id: 5, name: '李四', mealLabel: '午餐', qty: 20, empPrice: 10, famPrice: 15, family: 19, empAmount: 10, famAmount: 285, amount: 295 },
  // 行政部（单价较低）
  { id: 6, name: '王五', mealLabel: '早餐', qty: 10, empPrice: 4, famPrice: 7, family: 9, empAmount: 4, famAmount: 63, amount: 67 },
  { id: 7, name: '王五', mealLabel: '午餐', qty: 12, empPrice: 9, famPrice: 14, family: 11, empAmount: 9, famAmount: 154, amount: 163 },
]

// ─── 月度快照状态 ──────────────────────────────────────────────
const mockBillingSnapshot = {
  isSnapshot: true,
  snapshotTime: '2026-06-20 14:30:00',
  snapshotBy: '管理员老王',
  snapshotMonth: '2026-06',
}

// ─── 系统公告列表 ──────────────────────────────────────────────
const mockAnnouncements = [
  { id: 1, title: '本周菜单通知', content: '本周生效菜单：菜单 1。如有临时变更，以公告说明为准。', status: 'published', createdAt: '2026-06-20 09:00', publisher: '管理员老王' },
  { id: 2, title: '报餐截止时间提醒', content: '请各位员工注意，报餐截止时间为前一天 17:00，逾期无法修改。', status: 'published', createdAt: '2026-06-18 14:30', publisher: '管理员老王' },
  { id: 3, title: '系统维护通知', content: '系统将于本周六晚上 22:00-24:00 进行维护升级，届时可能无法报餐，请提前安排。', status: 'draft', createdAt: '2026-06-25 16:00', publisher: '系统管理员' },
]

module.exports = {
  mockTodayStatus,
  mockMonthStat,
  mockAnnouncement,
  mockMonthBookings,
  mockMenu,
  mockRecords,
  mockKitchenToday,
  mockKitchenDetail,
  mockDepartments,
  mockStaffList,
  mockDeptPrices,
  mockBillingList,
  mockBillingSnapshot,
  mockAnnouncements,
}
