import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import { getAppearance, setAppearance } from '@/lib/theme-config'
import {
  LAYOUTS,
  THEMES,
  DEFAULT_APPEARANCE,
  type AppearanceConfig,
} from '@zx/shared'

export const dynamic = 'force-dynamic'

// admin 外观配置接口:
//   GET  → { config, themes: 全量可选, layouts: 全量可选, defaults: 出厂默认 }
//   POST → { themes, layouts, defaultTheme, defaultLayout } 保存放行集合与默认项
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json({
    config: getAppearance(),
    themes: THEMES.map((t) => ({ id: t.id, label: t.label, tagline: t.tagline, swatch: t.swatch, mode: t.mode })),
    layouts: LAYOUTS.map((l) => ({ id: l.id, label: l.label, tagline: l.tagline, key: l.key })),
    defaults: DEFAULT_APPEARANCE,
  })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<Partial<AppearanceConfig>>(req).catch(() => null)
  if (!body) return Response.json({ error: '请求体无效' }, { status: 400 })
  const config = setAppearance(body)
  return Response.json({ ok: true, config })
}
