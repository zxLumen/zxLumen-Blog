import { getBotStatus } from '@/lib/chat/config'
import { composeGreeting } from '@/lib/chat/greeting'

export const dynamic = 'force-dynamic'

/** 公开路由:仅返回聊天开关与立即可展示的名字/问候语,不含任何密钥 */
export async function GET() {
  const status = getBotStatus()
  const greetings = (status.config.greetings ?? []).filter((s) => s.trim()).slice(0, 20)
  const greeting = await composeGreeting(greetings, {
    smart: status.config.smartGreeting,
    birthday: status.config.greetBirthday,
  })
  return Response.json(
    {
      enabled: status.config.enabled,
      name: status.config.name,
      greetings,
      greeting,
      autoOpen: status.config.autoOpen !== false,
      suggestions: (status.config.suggestions ?? []).slice(0, 6),
      ready: status.chatReady,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}