import type { UsageRow } from '../../schema.js'
import { nowIso } from '../../time.js'
import type { NewUsageInput, SqliteDb, UsageStore } from './types.js'

const mapUsage = (r: Record<string, unknown>): UsageRow => ({
  id: r.id as number,
  ts: r.ts as string,
  model: r.model as string,
  inputTokens: (r.input_tokens as number) ?? 0,
  outputTokens: (r.output_tokens as number) ?? 0,
  cacheHitTokens: (r.cache_hit_tokens as number) ?? 0,
  source: (r.source as string) ?? undefined,
})

export function usageStore(db: SqliteDb): UsageStore {
  return {
    listUsage(days = 30) {
      const rows = db
        .prepare(`SELECT * FROM usage WHERE ts >= datetime('now', ?) ORDER BY ts DESC`)
        .all(`-${Math.max(1, days)} days`) as Record<string, unknown>[]
      return rows.map(mapUsage)
    },

    allUsage() {
      const rows = db.prepare(`SELECT * FROM usage ORDER BY ts DESC`).all() as Record<string, unknown>[]
      return rows.map(mapUsage)
    },

    addUsage(input: NewUsageInput) {
      const ts = input.ts ?? nowIso()
      const info = db
        .prepare(
          `INSERT INTO usage (ts, model, input_tokens, output_tokens, cache_hit_tokens, source)
           VALUES (@ts, @model, @input_tokens, @output_tokens, @cache_hit_tokens, @source)`,
        )
        .run({
          ts,
          model: input.model,
          input_tokens: input.inputTokens ?? 0,
          output_tokens: input.outputTokens ?? 0,
          cache_hit_tokens: input.cacheHitTokens ?? 0,
          source: input.source ?? 'report',
        })
      return {
        id: Number(info.lastInsertRowid),
        ts,
        model: input.model,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        cacheHitTokens: input.cacheHitTokens ?? 0,
        source: input.source ?? 'report',
      }
    },
  }
}
