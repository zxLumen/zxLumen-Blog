import type { ChatDayCount, ChatLogRow, NewChatLogInput } from '../../schema.js'
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

    deleteAllChatLogs(): void {
      db.prepare(`DELETE FROM chat_logs`).run()
    },
  }
}