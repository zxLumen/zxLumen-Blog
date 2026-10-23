import { GameError } from './errors'

export function gameErrorResponse(error: unknown): Response {
  if (error instanceof GameError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  console.error('[games]', error)
  return Response.json({ error: '服务器开小差了，请稍后再试' }, { status: 500 })
}

export function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store, max-age=0')
  return response
}
