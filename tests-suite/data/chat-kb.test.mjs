import test from 'node:test'
import assert from 'node:assert/strict'

import { freshDb } from '../helpers/memdb.mjs'
import { bjDay } from '../../packages/shared/dist/time.js'

test('chat_logs:写入 / 每日计数 / 按会话归并', () => {
  const db = freshDb()
  const day = bjDay()

  db.addChatLog({ session_id: 's1', cid: 'c1', role: 'user', content: '你好', in_tokens: 3 })
  db.addChatLog({ session_id: 's1', cid: 'c1', role: 'assistant', content: '你好呀', out_tokens: 5 })
  db.addChatLog({ session_id: 's2', cid: 'c2', role: 'user', content: '你是谁' })

  assert.equal(db.countChatLogs(), 3)
  // 每日上限只数 role='user'
  assert.equal(db.countChatByCidDay('c1', day), 1)
  assert.equal(db.countChatByCidDay('c2', day), 1)
  assert.equal(db.countChatByCidDay('nobody', day), 0)

  const { sessions, total } = db.listChatSessions()
  assert.equal(total, 2)
  const s1 = sessions.find((s) => s.session_id === 's1')
  assert.equal(s1.turns, 1) // 1 轮提问
  assert.equal(s1.msg_count, 2)
  assert.equal(s1.first_question, '你好')

  // 删除单会话
  assert.equal(db.deleteChatSession('s1'), 2)
  assert.equal(db.countChatLogs(), 1)
  // 全清
  assert.equal(db.deleteAllChatLogs(), 1)
  assert.equal(db.countChatLogs(), 0)

  db.close()
})

test('知识库:doc / chunk / FTS 检索 / 删除对账', () => {
  const db = freshDb()
  assert.equal(db.hasKbChunks(), false)

  const docId = db.upsertKbDoc({ source: 'a.md', kind: 'knowledge', title: 'A', sha: 'h1' })
  assert.ok(docId > 0)
  assert.equal(db.getKbDoc('a.md').title, 'A')
  assert.equal(db.listKbDocs().length, 1)

  db.addKbChunk({ doc_id: docId, idx: 0, content: '刘子祥的个人主页 zxlumen', source: 'a.md' })
  db.addKbChunk({ doc_id: docId, idx: 1, content: '无关内容', source: 'a.md' })
  assert.equal(db.hasKbChunks(), true)
  assert.equal(db.countKbChunks(), 2)

  const hits = db.ftsSearch('zxlumen')
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].source, 'a.md')

  // 删除 doc 连带清空 chunk
  db.deleteKbDoc(docId)
  assert.equal(db.countKbChunks(), 0)
  assert.equal(db.getKbDoc('a.md'), null)

  db.close()
})
