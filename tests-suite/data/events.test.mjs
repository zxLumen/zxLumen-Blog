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
