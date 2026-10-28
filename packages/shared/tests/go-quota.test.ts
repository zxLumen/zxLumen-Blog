import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeGoQuota, GO_MONTHLY_CAP_PCT } from '../dist/go-quota.js'

/**
 * 合并规则:本月已达 100% 的 workspace **不参与** 5 小时 / 本周 / 本月三根配额条
 * (被限流后它自己的 5h/周 会掉到很低,混进平均会把"还剩多少余量"算得过于乐观)。
 */
const q = (rolling: number, weekly: number, monthly: number, extra: object = {}) => ({
  rolling: { percent: rolling, ...extra },
  weekly: { percent: weekly },
  monthly: { percent: monthly },
})

test('全部未满:三个窗口都取平均', () => {
  const r = mergeGoQuota([q(0, 40, 50), q(10, 20, 90)])
  assert.equal(r?.rolling?.percent, 5)
  assert.equal(r?.weekly?.percent, 30)
  assert.equal(r?.monthly?.percent, 70)
})

test('本月 100% 的 workspace 被排除在三个窗口之外', () => {
  // 真实场景:两个已用满的 workspace(5h/周因此很低)+ 一个可用
  const r = mergeGoQuota([q(0, 0, 100), q(3, 40, 100), q(3, 1, 0)])
  assert.equal(r?.rolling?.percent, 3)
  assert.equal(r?.weekly?.percent, 1)
  assert.equal(r?.monthly?.percent, 0)
})

test('超过 100%(脏数据)同样排除', () => {
  const r = mergeGoQuota([q(1, 2, 120), q(9, 8, 30)])
  assert.equal(r?.rolling?.percent, 9)
  assert.equal(r?.monthly?.percent, 30)
})

test('全部本月已满 → null(没有可用余量,面板隐藏配额条)', () => {
  assert.equal(mergeGoQuota([q(0, 0, 100), q(0, 5, 100)]), null)
  assert.equal(GO_MONTHLY_CAP_PCT, 100)
})

test('没给 monthly 视为可用(不误伤只返回部分窗口的接口)', () => {
  const r = mergeGoQuota([{ rolling: { percent: 20 } }, q(0, 0, 50)])
  assert.equal(r?.rolling?.percent, 10)
  assert.equal(r?.monthly?.percent, 50)
})

test('空输入 / 全是 null → null', () => {
  assert.equal(mergeGoQuota([]), null)
  assert.equal(mergeGoQuota([null, undefined]), null)
})

test('重置时间取最早,状态取可用集合里用量最高者', () => {
  const r = mergeGoQuota([
    { rolling: { percent: 10, resetsAt: '2026-10-29T12:00:00Z', status: 'ok' } },
    { rolling: { percent: 40, resetsAt: '2026-10-29T09:00:00Z', status: 'warning' } },
    { rolling: { percent: 99, resetsAt: '2026-10-28T09:00:00Z', status: 'exceeded' }, monthly: { percent: 100 } },
  ])
  assert.equal(r?.rolling?.resetsAt, '2026-10-29T09:00:00Z') // 已满的那个不参与
  assert.equal(r?.rolling?.status, 'warning')
})

test('平均值保留 1 位小数', () => {
  const r = mergeGoQuota([q(0, 0, 0), q(1, 0, 0), q(0, 0, 0)])
  assert.equal(r?.rolling?.percent, 0.3)
})
