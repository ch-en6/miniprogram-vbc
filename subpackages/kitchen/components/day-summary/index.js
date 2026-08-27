// subpackages/kitchen/components/day-summary/index.js — 食堂工作台「今日/明日报餐」公共区块组件
Component({
  properties: {
    day: { type: String, value: '' },            // 日期主文案（如 "8/27"）
    week: { type: String, value: '' },           // 星期（如 "星期四"）
    deadline: { type: String, value: '' },       // 截止状态文案（如 "可报餐"/"已截止"），空则不显示
    deadlineExpired: { type: Boolean, value: false }, // 截止状态是否为「已截止」
    mealSummary: { type: Array, value: [] },     // 三餐汇总 [{ type, label, headCount, totalQty, familyQty }]
    deptCards: { type: Array, value: [] },       // 部门汇总 [{ deptName, breakfast, lunch, dinner, total }]
    emptyText: { type: String, value: '暂无报餐记录' }, // 空状态文案
    detailDate: { type: String, value: '' },     // 明细页跳转日期（YYYY-MM-DD）
  },

  methods: {
    onDetailTap() {
      this.triggerEvent('detail', { date: this.data.detailDate })
    },
  },
})
