// 把 content.local.ts(不入库,真实资料)导出为运行时 JSON:
//   docker/site-content/content.json
// 用法:cd packages/shared && npm run export:content
// 依赖 Node 22+ 原生 TS(type-stripping)。刷新页面即可看到新内容(无需重启)。
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..', '..')
const srcDir = path.join(repo, 'packages', 'shared', 'src')
const local = path.join(srcDir, 'content.local.ts')
const example = path.join(srcDir, 'content.local.example.ts')
const outDir = path.join(repo, 'docker', 'site-content')
const out = path.join(outDir, 'content.json')

if (!existsSync(local)) {
  copyFileSync(example, local)
  console.log('[export-content] content.local.ts 不存在,已由示例生成占位(请先填写真实资料再导出)')
}

const m = await import(`${pathToFileURL(local).href}?t=${Date.now()}`)
const { PROFILE, LINKS, TECH, TIMELINE, PROJECTS, SITE_META, CONTACTS } = m
const content = { PROFILE, LINKS, TECH, TIMELINE, PROJECTS, SITE_META, CONTACTS }

mkdirSync(outDir, { recursive: true })
await writeFile(out, JSON.stringify(content, null, 2) + '\n', 'utf8')

console.log(`[export-content] 已导出 ${Object.keys(content).length} 组内容 → ${out}`)
console.log(
  `  名字:${PROFILE.name} · 项目:${PROJECTS.length} · 技能:${TECH.length} · 时间线:${TIMELINE.length}`,
)