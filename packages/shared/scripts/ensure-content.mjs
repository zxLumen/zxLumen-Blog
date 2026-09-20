import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(here, '..', 'src')
const local = path.join(srcDir, 'content.local.ts')
const example = path.join(srcDir, 'content.local.example.ts')

if (!fs.existsSync(local)) {
  fs.copyFileSync(example, local)
  console.log('[ensure-content] content.local.ts 不存在,已用示例生成(可自行编辑,不会提交)')
}
