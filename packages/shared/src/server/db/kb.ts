import type { KbChunkRow, KbDocRow } from '../../schema.js'
import type { KbStore, SqliteDb } from './types.js'

export function kbStore(db: SqliteDb): KbStore {
  return {
    upsertKbDoc(input): number {
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
      const ex = db
        .prepare(`SELECT id FROM kb_docs WHERE source = ?`)
        .get(input.source) as { id: number } | undefined
      if (ex) {
        db.prepare(
          `UPDATE kb_docs SET kind=@kind, title=@title, size=@size, sha=@sha, status=@status, error=@error, updated_at=@now WHERE id=@id`,
        ).run({
          kind: input.kind,
          title: input.title ?? '',
          size: input.size ?? 0,
          sha: input.sha ?? '',
          status: input.status ?? 'pending',
          error: input.error ?? '',
          now,
          id: ex.id,
        })
        return ex.id
      }
      const info = db
        .prepare(
          `INSERT INTO kb_docs(source, kind, title, size, sha, status, error, created_at, updated_at)
           VALUES(@source, @kind, @title, @size, @sha, @status, @error, @now, @now)`,
        )
        .run({
          source: input.source,
          kind: input.kind,
          title: input.title ?? '',
          size: input.size ?? 0,
          sha: input.sha ?? '',
          status: input.status ?? 'pending',
          error: input.error ?? '',
          now,
        })
      return Number(info.lastInsertRowid)
    },

    listKbDocs(): KbDocRow[] {
      return db.prepare(`SELECT * FROM kb_docs ORDER BY id DESC`).all() as KbDocRow[]
    },

    getKbDoc(source): KbDocRow | null {
      const r = db.prepare(`SELECT * FROM kb_docs WHERE source = ?`).get(source) as KbDocRow | undefined
      return r ?? null
    },

    clearKbChunks(docId): void {
      const ids = (db.prepare(`SELECT id FROM kb_chunks WHERE doc_id = ?`).all(docId) as { id: number }[])?.map(
        (x) => x.id,
      )
      db.prepare(`DELETE FROM kb_chunks WHERE doc_id = ?`).run(docId)
      for (const id of ids ?? []) {
        db.prepare(`DELETE FROM kb_chunks_fts WHERE rowid = ?`).run(id)
      }
    },

    deleteKbDoc(id): void {
      this.clearKbChunks(id)
      db.prepare(`DELETE FROM kb_docs WHERE id = ?`).run(id)
    },

    addKbChunk(input): void {
      const info = db
        .prepare(
          `INSERT INTO kb_chunks(doc_id, idx, content, vector, source, token_len, created_at)
           VALUES(@doc_id, @idx, @content, @vector, @source, @token_len, @created_at)`,
        )
        .run({
          doc_id: input.doc_id,
          idx: input.idx,
          content: input.content,
          vector: input.vector ?? null,
          source: input.source,
          token_len: input.token_len ?? 0,
          created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        })
      db.prepare(`INSERT INTO kb_chunks_fts(rowid, content, source) VALUES(?, ?, ?)`).run(
        Number(info.lastInsertRowid),
        input.content,
        input.source,
      )
    },

    listKbChunksWithVector(): KbChunkRow[] {
      return db
        .prepare(
          `SELECT id, doc_id, idx, content, vector, source, token_len, created_at FROM kb_chunks WHERE vector IS NOT NULL`,
        )
        .all() as KbChunkRow[]
    },

    ftsSearch(query, limit = 8): Array<{ id: number; content: string; source: string }> {
      const terms = query
        .replace(/[^\w\u4e00-\u9fff]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((t) => t.length >= 2)
      if (terms.length === 0) return []
      const q = terms.map((t) => `"${t}"`).join(' OR ')
      const rows = db
        .prepare(
          `SELECT rowid AS id, content, source FROM kb_chunks_fts WHERE kb_chunks_fts MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(q, limit) as Array<{ id: number; content: string; source: string }>
      return rows
    },

    hasKbChunks(): boolean {
      return !!db.prepare(`SELECT 1 FROM kb_chunks LIMIT 1`).get()
    },

    countKbChunks(): number {
      const r = db.prepare(`SELECT COUNT(*) AS c FROM kb_chunks`).get() as { c: number }
      return Number(r.c)
    },

    clearKb(): void {
      db.exec(`DELETE FROM kb_chunks_fts; DELETE FROM kb_chunks; DELETE FROM kb_docs;`)
    },
  }
}