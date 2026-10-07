// 一次性脚本:把 DeepSeek / OpenCode Go 的历史用量,按供应商侧的 key 名
// 模糊匹配到 AI 网关应用,累加进 `ai_usage`,让「Token用量 → AI 网关」看到历史。
//
// 设计:
//  - 用量来源:读本应用自己的 /api/usage?source=deepseek|opencode(30 天),复用其凭据与解析;
//  - 匹配:归一化(去 `Default · `/`拓展包 · `/`legacy:`/`bak_`/邮箱/符号、小写)后
//    完全相等 → 互相包含 → 编辑距离 ≤2;应用命中不了时原样作为应用名;
//  - 写入:只 INSERT/UPSERT `ai_usage`,幂等(读完 `--force` 才能重跑)。
//
// 本机运行(对本地 dev 库):
//   cd apps/next-home && node scripts/backfill-ai-usage.mjs
// 服务器容器内运行:
//   scp apps/next-home/scripts/backfill-ai-usage.mjs zx@host:/tmp/
//   ssh zx@host 'cd ~/zxLumen-Blog/docker && \
//     docker compose cp /tmp/backfill-ai-usage.mjs app:/app/backfill-ai-usage.mjs && \
//     docker compose exec -T app node /app/backfill-ai-usage.mjs --fallback=coding'
//
// 参数:--range=30d(默认)  --force(忽略已导入标记重跑)
//       --fallback=<app 名或 id>(匹配不到的 key 一律归到该应用,如 coding)

import Database from 'better-sqlite3'

const DB = process.env.DB_PATH || '/data/zx.db'
const BASE = process.env.ZX_SELF_URL || 'http://127.0.0.1:3000'
const args = process.argv.slice(2)
const range = (args.find((a) => a.startsWith('--range=')) || '--range=30d').split('=')[1]
const force = args.includes('--force')
const fallback = (args.find((a) => a.startsWith('--fallback=')) || '--fallback=').split('=')[1]
const GUARD = 'ai_usage_backfill_v1'

function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/^[^·]*·\s*/, '') // 去 "Default · " / "拓展包 · "
    .replace(/^legacy:\s*/, '')
    .replace(/^bak_/, '')
    .replace(/[^a-z0-9]/g, '') // 去邮箱/@/空格等
}
function lev(a, b) {
  const m = a.length
  const n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m][n]
}
function candidatesFor(nk, cands) {
  if (!nk) return []
  const exact = cands.filter((c) => c.norm.has(nk))
  if (exact.length) return exact
  const cont = cands.filter((c) => [...c.norm].some((k) => k && (k.includes(nk) || nk.includes(k))))
  if (cont.length) return cont
  let best = []
  let bd = 3
  for (const c of cands)
    for (const k of c.norm) {
      if (!k) continue
      const d = lev(nk, k)
      if (d < bd) {
        bd = d
        best = [c]
      } else if (d === bd && bd <= 2 && !best.includes(c)) best.push(c)
    }
  return bd <= 2 ? best : []
}

const db = new Database(DB)
const metaGet = (k) => {
  const r = db.prepare('SELECT value FROM meta WHERE key=?').get(k)
  return r ? r.value : null
}
const metaSet = (k, v) =>
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v)

if (metaGet(GUARD) && !force) {
  console.log(`已导入过(${GUARD} = ${metaGet(GUARD)});如需重跑请加 --force`)
  process.exit(0)
}

const cfg = JSON.parse(metaGet('ai_gateway_config') || '{}')
const apps = (cfg.apps || []).map((a) => ({
  id: a.id,
  name: a.name,
  providerId: a.providerId || '',
  norm: new Set([norm(a.name), norm(a.id)]),
}))
const provs = (cfg.providers || []).map((p) => ({ id: p.id, name: p.name, norm: new Set([norm(p.name), norm(p.id)]) }))

async function fetchRows(src) {
  const r = await fetch(`${BASE}/api/usage?source=${src}&range=${range}`)
  if (!r.ok) throw new Error(`拉取 ${src} 用量失败 HTTP ${r.status}`)
  return (await r.json()).rows || []
}

const ds = await fetchRows('deepseek')
const oc = await fetchRows('opencode')
const src = [
  ...ds.map((r) => ({ r, key: r.apiKey })),
  ...oc.map((r) => ({ r, key: r.serviceAccount })),
]

const ins = db.prepare(`INSERT INTO ai_usage (day,hour,app_id,provider_id,model,requests,input_tokens,output_tokens,cache_hit_tokens)
  VALUES (@day,@hour,@app,@prov,@model,@req,@in,@out,@cache)
  ON CONFLICT(day,hour,app_id,provider_id,model) DO UPDATE SET
    requests=requests+excluded.requests, input_tokens=input_tokens+excluded.input_tokens,
    output_tokens=output_tokens+excluded.output_tokens, cache_hit_tokens=cache_hit_tokens+excluded.cache_hit_tokens`)

const matched = new Map()
const unmatched = new Set()
let n = 0
db.transaction(() => {
  for (const { r, key } of src) {
    const nk = norm(key)
    const prov = candidatesFor(nk, provs)[0] || null
    const cs = candidatesFor(nk, apps)
    let app = cs.find((a) => prov && a.providerId === prov.id) || cs[0] || null
    if (!app && fallback) app = apps.find((a) => a.id === fallback || a.name === fallback) || null
    if (app) matched.set(key, app.name)
    else unmatched.add(key)
    const ts = String(r.ts || '')
    const day = ts.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    ins.run({
      day,
      hour: Number(ts.slice(11, 13)) || 0,
      app: app ? app.id : String(key || '(未知)'),
      prov: prov ? prov.id : '',
      model: String(r.model || ''),
      req: r.requests ?? 0,
      in: r.inputTokens ?? 0,
      out: r.outputTokens ?? 0,
      cache: r.cacheHitTokens ?? 0,
    })
    n++
  }
  metaSet(GUARD, new Date().toISOString())
})()

console.log(`来源行:${src.length} → 写入:${n}`)
console.log('匹配:')
for (const [k, v] of matched) console.log('  ', JSON.stringify(k), '→', v)
console.log('未匹配(原样作为应用名):', [...unmatched])
db.close()
