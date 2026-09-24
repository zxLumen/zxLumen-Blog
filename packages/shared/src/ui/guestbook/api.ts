import type { CommentRow } from '../../schema.js'
import type { NewComment } from './types.js'

export async function defaultSubmit(apiBase: string, input: NewComment): Promise<CommentRow> {
  const res = await fetch(`${apiBase}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || `提交失败 (${res.status})`)
  }
  const data = (await res.json()) as { comment: CommentRow }
  return data.comment
}
