import path from 'node:path'
import { openDb } from '@zx/shared/server'

// 灌入测试库(默认 data/zx.test.db),不影响线上库
const dbPath = process.env.DB_TEST_PATH || path.join(process.cwd(), 'data', 'zx.test.db')
const db = openDb(dbPath)

const names = ['阿雪', '老K', 'Momo', '张三', 'Neo', '小王', 'Luna', '陈十一', '大熊', '404']
const topics = [
  '这个主页太酷了,主题切换很顺滑',
  'DeepSeek 用量面板做得不错',
  '侧边栏布局有 IDE 的味道',
  '求问用的什么字体?',
  '留言板回复功能很实用',
  'ASCII 彩蛋好玩',
  '准备部署到自己的 VPS 试试',
  '希望能加个 RSS',
  '配色很舒服,收藏了',
  '自托管大法好',
  '排版细节到位',
  '请问用的什么数据库?',
]
const pick = (arr, i) => arr[i % arr.length]

const roots = []
for (let i = 1; i <= 60; i++) {
  const c = db.addComment({
    author: pick(names, i) + (i > names.length ? `_${i}` : ''),
    author_link: '',
    body: `${pick(topics, i)}(#${i})`,
    visibility: i % 13 === 0 ? 'private' : 'public',
  })
  roots.push(c.id)
}

// 回复 + 嵌套回复
let replies = 0
for (let i = 0; i < roots.length; i += 5) {
  const r = db.addComment({
    author: pick(names, i + 3),
    author_link: '',
    body: `回复 @${pick(names, i)}:同感 #${i + 1}`,
    parent_id: roots[i],
  })
  replies++
  if (i % 10 === 0) {
    db.addComment({
      author: pick(names, i + 7),
      author_link: '',
      body: `再回复:这个我也遇到过(#${i + 1})`,
      parent_id: r.id,
    })
    replies++
  }
}

// 站长回复一条
db.addComment({ author: '站长', author_link: '', body: '感谢大家的留言 🙏', parent_id: roots[0], is_admin: 1 })

console.log(`seeded ${dbPath}`)
console.log(`roots=${roots.length} replies(+嵌套)=${replies + 1} total=${db.countComments()}`)
db.close()
