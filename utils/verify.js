// utils/verify.js — 食堂端核销/撤销核销通用逻辑（工作台 today / 报餐明细 detail 共用）
const { MEAL_TYPE_LABEL } = require('./const')
const { KitchenAPI } = require('../services/api')

/**
 * 核销 / 撤销核销
 * - 未核销 -> 直接核销；已核销 -> 弹 Dialog 确认后撤销
 * - 通过 isBusy / setBusy / clearBusy 回调维护页面「处理中」防重复状态
 *
 * @param {Object} context 页面实例（含 data、setData）
 * @param {Object} opts
 * @param {number|string} opts.empId  员工 id
 * @param {string} opts.date   日期 YYYY-MM-DD
 * @param {string} opts.meal   餐次 breakfast/lunch/dinner
 * @param {number|string} opts.verified 当前核销状态（0/1）
 * @param {string} opts.name   员工姓名（撤销确认文案用）
 * @param {Function} opts.isBusy    () => boolean 该员工是否已有餐次处理中
 * @param {Function} opts.setBusy   (meal) => void 标记处理中餐次
 * @param {Function} opts.clearBusy () => void 清除处理中标记
 * @param {Function} opts.onSuccess (newVerified) => void 成功后更新页面数据
 */
function verifyMeal(context, opts) {
  const { empId, date, meal, verified, name } = opts
  if (opts.isBusy()) return

  const isVerified = Number(verified) === 1
  const mealLabel = MEAL_TYPE_LABEL[meal] || meal

  const doVerify = (newVerified) => {
    opts.setBusy(meal)
    KitchenAPI.verifyMeal({ empId, date, mealType: meal, verified: newVerified })
      .then(() => {
        opts.clearBusy()
        opts.onSuccess(newVerified)
        wx.showToast({ title: newVerified ? '核销成功' : '已撤销核销', icon: 'success' })
      })
      .catch((err) => {
        console.error('[Kitchen Verify]', err)
        opts.clearBusy()
        wx.showToast({ title: err.message || '操作失败，请重试', icon: 'none' })
      })
  }

  if (isVerified) {
    const Dialog = require('@vant/weapp/dialog/dialog').default
    Dialog.confirm({
      title: '撤销核销',
      message: `确定撤销「${name}」${mealLabel}的核销吗？`,
      confirmButtonText: '撤销',
      cancelButtonText: '取消',
    }).then(() => doVerify(0)).catch(() => {
      // 用户取消，不做操作
    })
  } else {
    doVerify(1)
  }
}

module.exports = { verifyMeal }
