import type { AppItem, EventType } from '../schema.js'

/**
 * 联系方式按钮的 target 取值(与 ContactActions / AboutSection 里 trackEvent 用的完全一致)。
 * 应用配置 `bind` 命中这些值时,点击与页面上对应按钮**合并计数**。
 */
export const CONTACT_BIND_KEYS = ['github', 'wechat', 'email', 'phone', 'guestbook'] as const

/**
 * 解析「点击一个应用」该上报成哪种事件(纯函数,好测)。
 *
 * 取值规则见 schema.ts 里 `StoredApp.bind` 的注释:
 *  - 空 → `app_click`(target = 应用 id)
 *  - `resume` → `resume_download`
 *  - `github`/`wechat`/`email`/`phone`/`guestbook` → `contact_click`
 *  - 其它(项目 id,如 `proj-8f58rlh81`)→ `project_click`
 */
export function resolveAppTrack(app: Pick<AppItem, 'id' | 'bind'>): { type: EventType; target: string } {
  const bind = (app.bind ?? '').trim()
  if (!bind) return { type: 'app_click', target: app.id }
  if (bind === 'resume') return { type: 'resume_download', target: '' }
  if ((CONTACT_BIND_KEYS as readonly string[]).includes(bind)) return { type: 'contact_click', target: bind }
  return { type: 'project_click', target: bind }
}
