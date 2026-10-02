import assert from 'node:assert/strict'
import test from 'node:test'

import Database from 'better-sqlite3'

import { SCHEMA_SQL } from '../dist/schema.js'
import { chatStore } from '../dist/server/db/chat.js'

/**
 * admin 对话日志的数据层测试。
 *
 * 直接用 better-sqlite3 开内存库 + chatStore(不走 openDb),因为要**手写 day 列**:
 * addChatLog 永远盖今天的北京日,而按日筛选/裁剪这些行为只有跨天数据才测得出来。
 */

type Row = {
  session_id: string
  cid: string
  day: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  in_tokens?: number
  out_tokens?: number
  latency_ms?: number
  created_at?: string
}

function setup() {
  const raw = new Database(':memory:')
  raw.exec(SCHEMA_SQL)
  const store = chatStore(raw)
  const insert = raw.prepare(
    `INSERT INTO chat_logs(session_id, cid, day, role, content, provider, model, in_tokens, out_tokens, latency_ms, created_at)
     VALUES(@session_id, @cid, @day, @role, @content, @provider, @model, @in_tokens, @out_tokens, @latency_ms, @created_at)`,
  )
  const add = (r: Row) =>
    insert.run({
      provider: 'test',
      model: '',
      in_tokens: 0,
      out_tokens: 0,
      latency_ms: 0,
      created_at: '2026-10-01 00:00:00',
      ...r,
    })
  return { raw, store, add }
}

/** 今天/前 n 天的北京日(与 chat.ts 的 bjDay 同口径) */
function bjDay(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

test('多轮对话归并成一个会话:轮数/条数/token 累加、首问取最早那条', () => {
  const { store, add } = setup()
  const d = bjDay()
  add({ session_id: 's1', cid: 'c1', day: d, role: 'user', content: '你好' })
  add({ session_id: 's1', cid: 'c1', day: d, role: 'assistant', content: '你好呀', in_tokens: 10, out_tokens: 20, latency_ms: 900 })
  add({ session_id: 's1', cid: 'c1', day: d, role: 'user', content: '你是谁' })
  add({ session_id: 's1', cid: 'c1', day: d, role: 'assistant', content: '我是子祥', model: 'm1', in_tokens: 30, out_tokens: 40, latency_ms: 1500 })
  add({ session_id: 's2', cid: 'c2', day: d, role: 'user', content: '别的问题' })
  add({ session_id: 's2', cid: 'c2', day: d, role: 'assistant', content: '另一个回答' })

  const { sessions, total } = store.listChatSessions({})
  assert.equal(total, 2, '两个会话')
  assert.equal(sessions.length, 2)

  const s1 = sessions.find((s) => s.session_id === 's1')!
  assert.equal(s1.turns, 2, '两轮提问')
  assert.equal(s1.msg_count, 4, '四条消息')
  assert.equal(s1.in_tokens, 40)
  assert.equal(s1.out_tokens, 60)
  assert.equal(s1.latency_ms, 2400)
  assert.equal(s1.first_question, '你好', '首问是最早那条 user 消息')
  assert.equal(s1.models, 'm1', '去重后的模型')
  assert.equal(s1.cid, 'c1')
})

test('排序:按最后一条消息(id)倒序,不是按首条', () => {
  const { store, add } = setup()
  const d = bjDay()
  // s1 先开始但后结束;s2 反之
  add({ session_id: 's1', cid: 'c', day: d, role: 'user', content: 'a' })
  add({ session_id: 's2', cid: 'c', day: d, role: 'user', content: 'b' })
  add({ session_id: 's1', cid: 'c', day: d, role: 'assistant', content: 'a2' })

  const ids = store.listChatSessions({}).sessions.map((s) => s.session_id)
  assert.deepEqual(ids, ['s1', 's2'], '最后说话的会话排最前')
})

test('分页:limit/offset 切片正确,total 不受分页影响', () => {
  const { store, add } = setup()
  const d = bjDay()
  for (let i = 0; i < 7; i++) {
    add({ session_id: `s${i}`, cid: 'c', day: d, role: 'user', content: `问 ${i}` })
  }
  const p1 = store.listChatSessions({ limit: 3, offset: 0 })
  const p2 = store.listChatSessions({ limit: 3, offset: 3 })
  const p3 = store.listChatSessions({ limit: 3, offset: 6 })
  assert.equal(p1.total, 7)
  assert.equal(p2.total, 7)
  assert.equal(p3.total, 7)
  assert.deepEqual(
    [...p1.sessions, ...p2.sessions, ...p3.sessions].map((s) => s.session_id),
    ['s6', 's5', 's4', 's3', 's2', 's1', 's0'],
  )
})

test('筛选 q:命中关键词的会话,且该会话的统计仍是全部消息(不是只算命中的)', () => {
  const { store, add } = setup()
  const d = bjDay()
  add({ session_id: 's1', cid: 'c', day: d, role: 'user', content: '讲讲 MLOps' })
  add({ session_id: 's1', cid: 'c', day: d, role: 'assistant', content: '无关内容', in_tokens: 7, out_tokens: 9 })
  add({ session_id: 's2', cid: 'c', day: d, role: 'user', content: '天气如何' })
  add({ session_id: 's2', cid: 'c', day: d, role: 'assistant', content: '还行' })

  const hit = store.listChatSessions({ q: 'MLOps' })
  assert.equal(hit.total, 1)
  assert.equal(hit.sessions[0].session_id, 's1')
  assert.equal(hit.sessions[0].msg_count, 2, '统计覆盖该会话全部消息,不被关键词截断')
  assert.equal(hit.sessions[0].in_tokens, 7)
  assert.equal(hit.sessions[0].first_question, '讲讲 MLOps')

  assert.equal(store.listChatSessions({ q: '天气' }).sessions[0].session_id, 's2')
  assert.equal(store.listChatSessions({ q: '查无此词' }).total, 0)
})

test('筛选 q:LIKE 通配符被转义,不会把 _ 当成单字符通配', () => {
  const { store, add } = setup()
  const d = bjDay()
  add({ session_id: 's1', cid: 'c', day: d, role: 'user', content: 'a_b 精确' })
  add({ session_id: 's2', cid: 'c', day: d, role: 'user', content: 'axb 不该命中' })
  const hit = store.listChatSessions({ q: 'a_b' })
  assert.equal(hit.total, 1)
  assert.equal(hit.sessions[0].session_id, 's1')
})

test('筛选 q:也能直接粘 session_id 定位', () => {
  const { store, add } = setup()
  const d = bjDay()
  add({ session_id: 'abc-123', cid: 'c', day: d, role: 'user', content: '你好' })
  add({ session_id: 'zzz', cid: 'c', day: d, role: 'user', content: '别的' })
  assert.equal(store.listChatSessions({ q: 'abc-123' }).sessions[0].session_id, 'abc-123')
})

test('筛选 cid / day', () => {
  const { store, add } = setup()
  add({ session_id: 's1', cid: 'c1', day: bjDay(-1), role: 'user', content: '昨天' })
  add({ session_id: 's2', cid: 'c2', day: bjDay(-1), role: 'user', content: '昨天别人' })
  add({ session_id: 's3', cid: 'c1', day: bjDay(-2), role: 'user', content: '前天' })

  assert.deepEqual(store.listChatSessions({ cid: 'c1' }).sessions.map((s) => s.session_id), ['s3', 's1'])
  assert.deepEqual(store.listChatSessions({ day: bjDay(-2) }).sessions.map((s) => s.session_id), ['s3'])
  assert.equal(store.listChatSessions({ cid: 'c1', day: bjDay(-1) }).total, 1)
})

test('listChatLogsBySessions:一次取回多个会话的完整消息并按 id 升序', () => {
  const { store, add } = setup()
  const d = bjDay()
  add({ session_id: 's2', cid: 'c', day: d, role: 'user', content: '2-问' })
  add({ session_id: 's1', cid: 'c', day: d, role: 'user', content: '1-问' })
  add({ session_id: 's1', cid: 'c', day: d, role: 'assistant', content: '1-答' })

  const msgs = store.listChatLogsBySessions(['s1', 's2', 's1'])
  assert.deepEqual(msgs.map((m) => m.content), ['2-问', '1-问', '1-答'], '全局按 id 升序')
  assert.deepEqual(store.listChatLogsBySessions([]), [], '空数组不查库')
})

test('deleteChatSession:只删该次对话,其它会话不动', () => {
  const { store, add } = setup()
  const d = bjDay()
  add({ session_id: 's1', cid: 'c', day: d, role: 'user', content: 'a' })
  add({ session_id: 's1', cid: 'c', day: d, role: 'assistant', content: 'a2' })
  add({ session_id: 's2', cid: 'c', day: d, role: 'user', content: 'b' })

  assert.equal(store.deleteChatSession('s1'), 2)
  assert.equal(store.listChatSessions({}).total, 1)
  assert.equal(store.listChatSessions({}).sessions[0].session_id, 's2')
  assert.equal(store.deleteChatSession('不存在'), 0)
  assert.equal(store.deleteChatSession(''), 0, '空 id 不当通配符')
})

test('pruneChatLogs:只留最近 N 天(含今天),历史与 day 为空的行都清掉', () => {
  const { store, add } = setup()
  add({ session_id: 'a', cid: 'c', day: bjDay(0), role: 'user', content: '今天' })
  add({ session_id: 'b', cid: 'c', day: bjDay(-3), role: 'user', content: '三天前' })
  add({ session_id: 'c', cid: 'c', day: bjDay(-40), role: 'user', content: '四十天前' })
  add({ session_id: 'd', cid: 'c', day: '', role: 'user', content: '没有 day 的历史行' })

  // 窗口 7 天:三天前还在窗口内,四十天前和没有 day 的行要清掉
  assert.equal(store.pruneChatLogs(7), 2)
  assert.deepEqual(store.listChatSessions({}).sessions.map((s) => s.session_id), ['b', 'a'])

  add({ session_id: 'e', cid: 'c', day: bjDay(-2), role: 'user', content: '两天前' })
  assert.equal(store.pruneChatLogs(0), 2, 'keepDays=0 → 只留今天')
  assert.deepEqual(store.listChatSessions({}).sessions.map((s) => s.session_id), ['a'])
})

test('pruneChatLogs:窗口边界正好 N 天(含今天),不多留一天', () => {
  const { store, add } = setup()
  // 选「保留 7 天」应留下 今天..6 天前 共 7 个日期,7 天前那条要被删
  add({ session_id: 'in6', cid: 'c', day: bjDay(-6), role: 'user', content: '六天前' })
  add({ session_id: 'in7', cid: 'c', day: bjDay(-7), role: 'user', content: '七天前' })
  assert.equal(store.pruneChatLogs(7), 1)
  assert.deepEqual(store.listChatSessions({}).sessions.map((s) => s.session_id), ['in6'])

  // keepDays=1 只留今天
  const t = setup()
  t.add({ session_id: 'today', cid: 'c', day: bjDay(0), role: 'user', content: '今天' })
  t.add({ session_id: 'yest', cid: 'c', day: bjDay(-1), role: 'user', content: '昨天' })
  assert.equal(t.store.pruneChatLogs(1), 1)
  assert.deepEqual(t.store.listChatSessions({}).sessions.map((s) => s.session_id), ['today'])
})

test('首问摘要:换行压成空格并截断,避免撑破列表', () => {
  const { store, add } = setup()
  const d = bjDay()
  add({ session_id: 's1', cid: 'c', day: d, role: 'user', content: `多\n行\t长文本${'啊'.repeat(300)}` })
  const s = store.listChatSessions({}).sessions[0]
  assert.equal(s.first_question.length, 120)
  assert.ok(!s.first_question.includes('\n'))
})

test('空库:不报错,total 为 0', () => {
  const { store } = setup()
  const p = store.listChatSessions({ q: 'x', cid: 'y', day: 'z' })
  assert.deepEqual(p, { sessions: [], total: 0 })
  assert.deepEqual(store.listChatLogsBySessions(['s1']), [])
})