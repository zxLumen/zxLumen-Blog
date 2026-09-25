#!/usr/bin/env node
// 生成问答机器人的运行时目录骨架:docker/site-content/chatbot/
//   persona.md        人格(蒸馏产物,也可手写)—— 第一次先放一句占位
//   faq.json          引导问答(蒸馏产物,也可手写)
//   knowledge/site.md 站点知识(先放用户最可能问的事实,如本站 Token 用量入口)
//   corpus/           蒸馏原料位(.md/.txt,丢这里后到 admin→机器人「扫描并蒸馏」)
// 该目录被 .gitignore(等同 site-content 其它运行时文件),部署时随文件挂载同步。
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..', '..', '..')
const dir = process.env.CHATBOT_DIR || path.join(root, 'docker', 'site-content', 'chatbot')

const SITE_MD = `# 站点知识

订阅访问一个简单的 刘子祥 的个人主页(zxLumen.cn),含:
- 主页(含项目 / Token 用量 / 关于 / 留言板)
- 后台 /admin(站长/私密留言管理)
- 本问答机器人「Lumen · 子祥的分身」

## 本站 Token 用量模块
- 「Token用量」区块聚合多个数据源:DeepSeek 用量、OpenCode Console 用量、智谱用量,按天/小时图表展示。
- DeepSeek 数据通过站长浏览器的书签脚本从 platform.deepseek.com 同步(存 meta,含使用明细)。
- 该模块只是聚合展示,与本站其它功能解耦;配置见后台「Token用量」标签。
`

const PERSONA_PLACEHOLDER = `# Lumen · 子祥的分身(人格占位)

(这一份由「扫描并蒸馏 → 生成人格」自动重写,也可以直接手写补全:
你是谁也好,但请始终以 刘子祥 的口吻回答访客。)
`

await mkdir(path.join(dir, 'corpus'), { recursive: true })
await mkdir(path.join(dir, 'knowledge'), { recursive: true })
await writeFile(path.join(dir, 'persona.md'), PERSONA_PLACEHOLDER, 'utf8')
await writeFile(path.join(dir, 'faq.json'), JSON.stringify([{ q: '介绍一下你自己', a: '我是刘子祥的 AI 分身,可以聊聊他的经历、项目和技术。' }], null, 2), 'utf8')
await writeFile(path.join(dir, 'knowledge', 'site.md'), SITE_MD, 'utf8')
await writeFile(
  path.join(dir, 'README.md'),
  `# chatbot 运行时目录(不入库)\n\n- \`corpus/\` 蒸馏原料(.md/.txt):丢文件 → admin「机器人 → 扫描并蒸馏」\n- \`persona.md\` / \`faq.json\`:蒸馏产物,可手改,改完即时生效\n- \`knowledge/*.md\`:站点知识,每次问答按需注入(小文件为宜)\n\n部署时随 docker/site-content/ 挂载上传(MOUNT 覆盖即可,镜像不包含)。\n`,
  'utf8',
)
console.log(`✅ chatbot 目录就绪:${dir}`)
console.log('   部署前记得:rm -rf 后 scp -r docker/site-content/chatbot 服务器 或单独覆盖各文件')