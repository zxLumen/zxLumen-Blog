import type {
  ChatDayCount,
  ChatLogRow,
  ChatSessionPage,
  NewChatLogInput,
} from '../../schema.js'
import type { ChatStore, SqliteDb } from './types.js'

/** 北京时 YYYY-MM-DD(与 events.day 同口径) */
function bjDay(d: Date = new Date()): string {
  return new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10)
}

export function chatStore(db: SqliteDb): ChatStore {
  return {
    addChatLog(input: NewChatLogInput): ChatLogRow {
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
      const day = bjDay()
      const info = db
        .prepare(
          `INSERT INTO chat_logs(session_id, cid, day, role, content, provider, model, in_tokens, out_tokens, latency_ms, created_at)
           VALUES(@session_id, @cid, @day, @role, @content, @provider, @model, @in_tokens, @out_tokens, @latency_ms, @created_at)`,
        )
        .run({
          session_id: input.session_id ?? '',
          cid: input.cid ?? '',
          day,
          role: input.role,
          content: input.content,
          provider: input.provider ?? '',
          model: input.model ?? '',
          in_tokens: input.in_tokens ?? 0,
          out_tokens: input.out_tokens ?? 0,
          latency_ms: input.latency_ms ?? 0,
          created_at: now,
        })
      return {
        id: Number(info.lastInsertRowid),
        session_id: input.session_id ?? '',
        cid: input.cid ?? '',
        role: input.role,
        content: input.content,
        provider: input.provider ?? '',
        model: input.model ?? '',
        in_tokens: input.in_tokens ?? 0,
        out_tokens: input.out_tokens ?? 0,
        latency_ms: input.latency_ms ?? 0,
        created_at: now,
      }
    },

    listChatLogs(opts): ChatLogRow[] {
      const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500)
      const params: unknown[] = []
      let where = ''
      if (opts?.session_id) {
        where = 'WHERE session_id = ?'
        params.push(opts.session_id)
      }
      params.push(limit)
      return db
        .prepare(`SELECT * FROM chat_logs ${where} ORDER BY id DESC LIMIT ?`)
        .all(...params) as ChatLogRow[]
    },

    countChatByCidDay(cid: string, day: string): number {
      if (!cid) return 0
      const r = db
        .prepare(`SELECT COUNT(*) AS c FROM chat_logs WHERE cid = ? AND day = ? AND role = 'user'`)
        .get(cid, day) as { c: number }
      return Number(r?.c ?? 0)
    },

    chatDayCounts(days: number = 30): ChatDayCount[] {
      const cols: Array<{ d: string }> = []
      for (let i = days - 1; i >= 0; i--) {
        const d = bjDay(new Date(Date.now() - i * 86400000))
        cols.push({ d })
      }
      return cols.map((c) => {
        const r = db
          .prepare(`SELECT COUNT(*) AS c FROM chat_logs WHERE day = ? AND role = 'user'`)
          .get(c.d) as { c: number }
        return { day: c.d, count: Number(r?.c ?? 0) }
      })
    },

    /**
     * 会话列表:按 `session_id` 归并 + offset 分页。
     *
     * 关键点:先用 `hit` 子查询圈出**命中的 session_id**,再对这些会话的**全部**消息
     * 做聚合。若直接 `WHERE content LIKE ?` 后 GROUP BY,搜到一个词时该会话的轮数 /
     * token 只会统计到命中的那几条,数字是错的。
     */
    listChatSessions(opts): ChatSessionPage {
      const limit = Math.min(Math.max(opts?.limit ?? 12, 1), 50)
      const offset = Math.max(opts?.offset ?? 0, 0)
      const q = (opts?.q ?? '').trim()
      const cid = (opts?.cid ?? '').trim()
      const day = (opts?.day ?? '').trim()

      const where: string[] = []
      const params: Record<string, unknown> = {}
      if (q) {
        // LIKE 里的 %/_ 是通配符,转义掉,否则搜「a_b」会意外命中「axb」
        where.push(`(content LIKE @like ESCAPE '\\' OR session_id = @q)`)
        params.like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
        params.q = q
      }
      if (cid) {
        where.push('cid = @cid')
        params.cid = cid
      }
      if (day) {
        where.push('day = @day')
        params.day = day
      }
      const hitWhere = where.length ? `WHERE ${where.join(' AND ')}` : ''

      const total = Number(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM (SELECT session_id FROM chat_logs ${hitWhere} GROUP BY session_id)`,
            )
            .get(params) as { c: number }
        )?.c ?? 0,
      )

      // models / first_question 用子查询取(同一条里聚合 DISTINCT 不好写),其余就地聚合
      const rows = db
        .prepare(
          `SELECT l.session_id AS session_id,
                  MIN(l.cid) AS cid,
                  MIN(l.day) AS day,
                  MIN(l.created_at) AS started_at,
                  MAX(l.created_at) AS last_at,
                  SUM(CASE WHEN l.role = 'user' THEN 1 ELSE 0 END) AS turns,
                  COUNT(*) AS msg_count,
                  SUM(l.in_tokens) AS in_tokens,
                  SUM(l.out_tokens) AS out_tokens,
                  SUM(l.latency_ms) AS latency_ms,
                  (SELECT GROUP_CONCAT(DISTINCT m.model) FROM chat_logs m
                     WHERE m.session_id = l.session_id AND m.model != '') AS models,
                  (SELECT u.content FROM chat_logs u
                     WHERE u.session_id = l.session_id AND u.role = 'user'
                     ORDER BY u.id LIMIT 1) AS first_question
             FROM chat_logs l
             WHERE l.session_id IN (SELECT session_id FROM chat_logs ${hitWhere})
             GROUP BY l.session_id
             ORDER BY MAX(l.id) DESC
             LIMIT @limit OFFSET @offset`,
        )
        .all({ ...params, limit, offset }) as Array<{
        session_id: string
        cid: string
        day: string
        started_at: string
        last_at: string
        turns: number
        msg_count: number
        in_tokens: number
        out_tokens: number
        latency_ms: number
        models: string | null
        first_question: string | null
      }>

      return {
        total,
        sessions: rows.map((r) => ({
          session_id: r.session_id,
          cid: r.cid ?? '',
          day: r.day ?? '',
          started_at: r.started_at,
          last_at: r.last_at,
          turns: Number(r.turns ?? 0),
          msg_count: Number(r.msg_count ?? 0),
          in_tokens: Number(r.in_tokens ?? 0),
          out_tokens: Number(r.out_tokens ?? 0),
          latency_ms: Number(r.latency_ms ?? 0),
          models: r.models ?? '',
          first_question: (r.first_question ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
        })),
      }
    },

    /** 批量取这些会话的完整消息(一次查询,避免 N+1);按 id 升序 */
    listChatLogsBySessions(sessionIds): ChatLogRow[] {
      if (!sessionIds.length) return []
      // 参数个数有上限,分批 IN;去重防重复占位
      const uniq = [...new Set(sessionIds)]
      const out: ChatLogRow[] = []
      for (let i = 0; i < uniq.length; i += 200) {
        const chunk = uniq.slice(i, i + 200)
        out.push(
          ...(db
            .prepare(
              `SELECT * FROM chat_logs WHERE session_id IN (${chunk.map(() => '?').join(',')}) ORDER BY id ASC`,
            )
            .all(...chunk) as ChatLogRow[]),
        )
      }
      return out.sort((a, b) => a.id - b.id)
    },

    deleteChatSession(sessionId): number {
      if (!sessionId) return 0
      return Number(db.prepare(`DELETE FROM chat_logs WHERE session_id = ?`).run(sessionId).changes)
    },

    /** 只保留最近 `keepDays` 个北京日(含今天);day 为空的行视为过期 */
    pruneChatLogs(keepDays): number {
      const days = Math.min(Math.max(Math.trunc(keepDays) || 0, 0), 3650)
      /**
       * 保留「最近 N 个北京日(含今天)」= 今天往前数 N-1 天。写成 `days * 86400000`
       * 会多留一天(选「保留 7 天」实际留下 8 天),所以这里要减 1。
       */
      const keepFrom = bjDay(new Date(Date.now() - Math.max(days - 1, 0) * 86400000))
      return Number(
        db.prepare(`DELETE FROM chat_logs WHERE day = '' OR day < ?`).run(keepFrom).changes,
      )
    },

    /** 返回真正删掉的消息行数(接口要如实报「删了几条」,别拿会话数糊弄) */
    deleteAllChatLogs(): number {
      return Number(db.prepare(`DELETE FROM chat_logs`).run().changes)
    },

    /** 日志总行数(与上面配套,清空前先探一次给用户看影响范围) */
    countChatLogs(): number {
      return Number((db.prepare(`SELECT COUNT(*) AS c FROM chat_logs`).get() as { c: number })?.c ?? 0)
    },
  }
}