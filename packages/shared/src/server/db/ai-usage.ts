import type { AiUsageRow } from '../../schema.js'
import type { AiUsageStore, NewAiUsageInput, SqliteDb } from './types.js'

const mapAiUsage = (r: Record<string, unknown>): AiUsageRow => ({
  day: r.day as string,
  hour: (r.hour as number) ?? 0,
  appId: r.app_id as string,
  providerId: (r.provider_id as string) ?? '',
  model: (r.model as string) ?? '',
  requests: (r.requests as number) ?? 0,
  inputTokens: (r.input_tokens as number) ?? 0,
  outputTokens: (r.output_tokens as number) ?? 0,
  cacheHitTokens: (r.cache_hit_tokens as number) ?? 0,
  audioSeconds: (r.audio_seconds as number) ?? 0,
})

export function aiUsageStore(db: SqliteDb): AiUsageStore {
  return {
    addAiUsage(input: NewAiUsageInput) {
      db.prepare(
        `INSERT INTO ai_usage (day, hour, app_id, provider_id, model, requests, input_tokens, output_tokens, cache_hit_tokens, audio_seconds)
         VALUES (@day, @hour, @app_id, @provider_id, @model, @requests, @input_tokens, @output_tokens, @cache_hit_tokens, @audio_seconds)
         ON CONFLICT(day, hour, app_id, provider_id, model) DO UPDATE SET
           requests = requests + excluded.requests,
           input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           cache_hit_tokens = cache_hit_tokens + excluded.cache_hit_tokens,
           audio_seconds = audio_seconds + excluded.audio_seconds`,
      ).run({
        day: input.day,
        hour: Math.max(0, Math.min(23, Math.round(input.hour ?? 0))),
        app_id: input.appId ?? '',
        provider_id: input.providerId ?? '',
        model: input.model ?? '',
        requests: Math.max(0, Math.round(input.requests ?? 1)),
        input_tokens: Math.max(0, Math.round(input.inputTokens ?? 0)),
        output_tokens: Math.max(0, Math.round(input.outputTokens ?? 0)),
        cache_hit_tokens: Math.max(0, Math.round(input.cacheHitTokens ?? 0)),
        audio_seconds: Math.max(0, Math.round(input.audioSeconds ?? 0)),
      })
    },

    listAiUsage(opts?: { from?: string; to?: string }) {
      const from = opts?.from ?? ''
      const to = opts?.to ?? '9999-12-31'
      const rows = db
        .prepare(`SELECT * FROM ai_usage WHERE day >= ? AND day <= ? ORDER BY day DESC`)
        .all(from, to) as Record<string, unknown>[]
      return rows.map(mapAiUsage)
    },

    resetAiUsage(appId?: string) {
      const info = appId
        ? db.prepare(`DELETE FROM ai_usage WHERE app_id = ?`).run(appId)
        : db.prepare(`DELETE FROM ai_usage`).run()
      return info.changes
    },
  }
}
