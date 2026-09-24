// 站点内容默认值(占位,可入库)。仅在运行时 content.json 缺失 / 读取失败时兜底。
// 真实资料在 ./content.local.ts(不入库),由 scripts/export-content.mjs 导出为
// docker/site-content/content.json(不入库),运行时经 getRuntimeContent() 读取并热更新。
import { PROFILE, LINKS, TECH, TIMELINE, PROJECTS, SITE_META, CONTACTS } from './content.local.example.js'
import type { RuntimeContent } from './content.js'

export const DEFAULT_CONTENT: RuntimeContent = {
  PROFILE,
  LINKS,
  TECH,
  TIMELINE,
  PROJECTS,
  SITE_META,
  CONTACTS,
}