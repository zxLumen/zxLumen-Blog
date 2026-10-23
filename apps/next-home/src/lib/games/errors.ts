/** 可预期的业务错误：API 直接把 message 透给前端，状态码默认 400 */
export class GameError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'GameError'
    this.status = status
  }
}
