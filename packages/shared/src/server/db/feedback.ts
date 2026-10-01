import type { NewFeedbackInput } from './types.js'
import type { SqliteDb } from './types.js'
import { nowIso } from '../../time.js'

export function feedbackStore(db: SqliteDb) {
  return {
    /** 入库一条访客反馈,返回新行 id(邮件是尽力而为,这里先落盘兜底) */
    addFeedback(input: NewFeedbackInput) {
      const info = db
        .prepare(
          `INSERT INTO feedback (cid, message, contact, path, ua, ip, status, created_at)
           VALUES (@cid, @message, @contact, @path, @ua, @ip, @status, @created_at)`,
        )
        .run({
          cid: input.cid ?? '',
          message: input.message,
          contact: input.contact ?? '',
          path: input.path ?? '',
          ua: input.ua ?? '',
          ip: input.ip ?? '',
          status: input.status ?? 'pending',
          created_at: nowIso(),
        })
      return Number(info.lastInsertRowid)
    },

    setFeedbackStatus(id: number, status: 'pending' | 'sent' | 'failed') {
      db.prepare(`UPDATE feedback SET status = ? WHERE id = ?`).run(status, id)
    },
  }
}