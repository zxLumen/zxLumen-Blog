import test from 'node:test'
import assert from 'node:assert/strict'

import { freshDb } from '../helpers/memdb.mjs'

test('addComment:默认公开,private 仅本人 / 站长可见', () => {
  const db = freshDb()
  db.addComment({ author: 'a', body: 'hello', author_cid: 'c1' })
  db.addComment({ author: 'b', body: 'secret', visibility: 'private', author_cid: 'c2' })

  assert.equal(db.listPublicComments().length, 1)
  assert.equal(db.listAllComments().length, 2)

  // 匿名访客:只看公开
  assert.equal(db.listThreadPage({}).rows.length, 1)

  // 本人:额外看到自己那条私密,并被标记 mine
  const mine = db.listThreadPage({ viewerCid: 'c2' })
  assert.equal(mine.rows.length, 2)
  assert.equal(mine.rows.find((r) => r.body === 'secret').mine, true)
  assert.equal(mine.rows.find((r) => r.body === 'hello').mine, false)
  // 访客侧不下发 author_cid
  assert.equal('author_cid' in mine.rows[0], false)

  // 站长:全量 + 带 cid
  const admin = db.listThreadPage({ includePrivate: true, withCid: true })
  assert.equal(admin.rows.length, 2)
  assert.equal(admin.rows.find((r) => r.body === 'hello').author_cid, 'c1')

  db.close()
})

test('listThreadPage:回复随顶层留言分页返回,pageSize 有上下界', () => {
  const db = freshDb()
  const root = db.addComment({ author: 'r', body: 'root' })
  db.addComment({ author: 'c', body: 'reply', parent_id: root.id })

  const p = db.listThreadPage({ pageSize: 20 })
  assert.equal(p.total, 1) // 顶层总数
  assert.equal(p.rows.length, 2) // 根 + 回复
  assert.equal(p.rows[0].parent_id, null)
  assert.equal(p.rows[1].parent_id, root.id)

  // 越界 pageSize 被夹到 [1,100];page 夹到 [1,totalPages]
  assert.equal(db.listThreadPage({ pageSize: 0 }).pageSize, 1)
  assert.equal(db.listThreadPage({ pageSize: 9999 }).pageSize, 100)
  assert.equal(db.listThreadPage({ page: 99 }).page, 1)

  db.close()
})

test('archiveComment / restoreComment / purgeComment:整棵子树递归', () => {
  const db = freshDb()
  const root = db.addComment({ author: 'root', body: 'r' })
  const child = db.addComment({ author: 'c', body: 'c', parent_id: root.id })
  db.addComment({ author: 'g', body: 'g', parent_id: child.id })

  // 删除 = 归档(不物理删)
  assert.equal(db.archiveComment(root.id, 'admin'), true)
  assert.equal(db.listPublicComments().length, 0)
  assert.equal(db.countComments(), 3)

  // 归档箱按「根」分页,子树随根返回
  const arch = db.listArchived()
  assert.equal(arch.total, 1)
  assert.equal(arch.rows.length, 3)
  assert.equal(arch.rows.every((r) => r.archived_by === 'admin'), true)

  // 不存在的 id 返回 false
  assert.equal(db.archiveComment(999999, 'admin'), false)

  // 恢复
  assert.equal(db.restoreComment(root.id), true)
  assert.equal(db.listPublicComments().length, 3)
  assert.equal(db.listArchived().total, 0)

  // 访客删除(记录发起者 cid)→ 彻底删除
  db.archiveComment(root.id, 'visitor', 'c9')
  assert.equal(db.listArchived().rows.every((r) => r.archived_by_cid === 'c9'), true)
  assert.equal(db.purgeComment(root.id), true)
  assert.equal(db.countComments(), 0)

  db.close()
})

test('访客备注:set / get / list / 清除', () => {
  const db = freshDb()
  assert.equal(db.getVisitorAlias('c1'), null)
  db.setVisitorAlias('c1', '张三')
  assert.equal(db.getVisitorAlias('c1').alias, '张三')
  assert.equal(db.listVisitorAliases().length, 1)
  assert.equal(db.setVisitorAlias('c1', ''), null)
  assert.equal(db.getVisitorAlias('c1'), null)
  db.close()
})

test('clearComments 返回删除条数', () => {
  const db = freshDb()
  db.addComment({ author: 'a', body: 'x' })
  db.addComment({ author: 'b', body: 'y' })
  assert.equal(db.clearComments(), 2)
  assert.equal(db.countComments(), 0)
  db.close()
})
