import test from 'node:test'
import assert from 'node:assert/strict'

import { freshDb } from '../helpers/memdb.mjs'

test('addEvent 正常计数;resume_download 进 stats', () => {
  const db = freshDb()
  db.addEvent({ type: 'resume_download', cid: 'c1' })
  db.addEvent({ type: 'visit', cid: 'c1' })
  assert.equal(db.stats().events.resumeDownloads, 1)
  db.close()
})

test('addEventOnce:按 (cid, day, type, target) 去重', () => {
  const db = freshDb()

  // 同一人同一天同一集:只记一次
  assert.equal(db.addEventOnce({ type: 'vlog_play', cid: 'c1', target: 'v1' }), true)
  assert.equal(db.addEventOnce({ type: 'vlog_play', cid: 'c1', target: 'v1' }), false)

  // 换人 / 换集:各记一次
  assert.equal(db.addEventOnce({ type: 'vlog_play', cid: 'c2', target: 'v1' }), true)
  assert.equal(db.addEventOnce({ type: 'vlog_play', cid: 'c1', target: 'v2' }), true)

  const s = db.stats()
  assert.equal(s.events.vlogPlays, 3)
  assert.equal(s.events.playsByVid['v1'], 2)
  assert.equal(s.events.playsByVid['v2'], 1)

  db.close()
})

test('appFunnel:曝光/点击/ctr/s3 按 target 聚合,r7 只认 7 天内的二次点击', () => {
  const db = freshDb()
  // 卡片 A:4 次曝光,其中 2 次 3 秒后仍可见;c1/c2 各点 1 次
  for (const cid of ['c1', 'c2', 'c3', 'c4']) {
    db.addEvent({ type: 'app_impression', cid, target: 'a', dwell: 0, pos: 0 })
  }
  db.addEvent({ type: 'app_impression', cid: 'c1', target: 'a', dwell: 3, pos: 0 })
  db.addEvent({ type: 'app_impression', cid: 'c2', target: 'a', dwell: 3, pos: 0 })
  db.addEvent({ type: 'app_click', cid: 'c1', target: 'a' })
  db.addEvent({ type: 'app_click', cid: 'c2', target: 'a' })
  // 卡片 B:只有曝光没有点击 → ctr=0
  db.addEvent({ type: 'app_impression', cid: 'c1', target: 'b', dwell: 0 })

  const rows = db.appFunnel(7)
  const a = rows.find((r) => r.target === 'a')
  const b = rows.find((r) => r.target === 'b')
  assert.equal(a.impressions, 4)
  assert.equal(a.s3, 2)
  assert.equal(a.s3Rate, 0.5)
  assert.equal(a.clicks, 2)
  assert.equal(a.ctr, 0.5)
  assert.equal(a.r7, 0) // 同一天点两次不算复访
  assert.equal(b.ctr, 0)

  db.close()
})

test('viewerAppHistory:按访客聚合打开次数与最后一次日期', () => {
  const db = freshDb()
  db.addEvent({ type: 'app_click', cid: 'c1', target: 'a' })
  db.addEvent({ type: 'app_click', cid: 'c1', target: 'a' })
  db.addEvent({ type: 'contact_click', cid: 'c1', target: 'b' })
  db.addEvent({ type: 'app_click', cid: 'c2', target: 'a' })

  const mine = db.viewerAppHistory('c1', 30)
  assert.equal(mine.find((r) => r.target === 'a').opens, 2)
  assert.equal(mine.find((r) => r.target === 'b').opens, 1)
  assert.equal(mine.length, 2)
  assert.equal(db.viewerAppHistory('', 30).length, 0)

  db.close()
})

test('addEvent dwell 被规整为非负整数(负数归 0 不下发,小数取整)', () => {
  const db = freshDb()
  db.addEvent({ type: 'visit', cid: 'c1' })
  db.addEvent({ type: 'visit', cid: 'c2' })
  db.addEvent({ type: 'visit', cid: 'c3' })
  // 负数 / 小数 / 非数 → 归 0 或取整,不应抛错
  db.addEvent({ type: 'leave', cid: 'c1', dwell: -5 })
  db.addEvent({ type: 'leave', cid: 'c2', dwell: 3.7 })
  db.addEvent({ type: 'leave', cid: 'c3', dwell: NaN })

  const s = db.stats({ visitors: true })
  assert.equal(s.visits.pv, 3)
  assert.equal(s.visits.uv, 3)

  const leaveOf = (cid) =>
    s.visitors.find((v) => v.cid === cid).recent.find((e) => e.type === 'leave')
  assert.equal(leaveOf('c1').dwell, undefined) // 负数归 0 → 不下发
  assert.equal(leaveOf('c2').dwell, 4) // 3.7 取整

  db.close()
})
