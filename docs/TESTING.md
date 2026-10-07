# 测试手册(本地 / CI / 线上)

zxLumen-Blog 及其附属应用(opentodo / yijing / stock / luminari)的**完整测试链路与压测方案**。
目标:在**单一环境、单一数据库**的前提下,做到「改动可重复验证、线上不出问题」。

> 本文是**方案与执行规范**。测试代码布局见 `tests-suite/`(待落地),依赖清单与 CI 门禁改造
> 见文末「待实施」。当前仓库已有测试:`packages/shared/tests/*.test.ts`(`node --test`)。

---

## 1. 目标与原则

1. **可重复**:任何测试都能在干净环境一键重跑,结果稳定(不依赖真实外部 API、不依赖网络)。
2. **隔离**:写测试一律指向**临时库**(`DB_PATH=/tmp/zx-test-*.db` 或 `:memory:`),绝不触碰
   `apps/next-home/data/zx.db`;破坏性操作前先 `sqlite3 ....backup`(见 `AGENTS.md`)。
3. **线上只读**:线上(单环境、真实数据)只做**只读冒烟 + 合成监控**,不做写操作、不做压测。
4. **压测离线**:所有压力测试只在本地生产构建(`next start`)或本地 docker compose 全栈执行。
5. **外网可 mock**:DeepSeek / 智谱 / MiniMax / OpenCode / Resend / 上游 LLM 全部用
   stub server 或注入的 baseUrl 替代,测试不产生真实费用、不依赖对方可用性。
6. **分层**:越靠底层越快越稳(单元 > 接口 > E2E > 压测),CI 按层递进,失败即停。

---

## 2. 被测系统清单

### 2.1 应用与进程

| 组件 | 说明 | 端口 |
| --- | --- | --- |
| `apps/next-home` | Next.js 16 应用(唯一面向访客) | 3000 |
| `packages/shared` | 设计系统 + 数据层(`@zx/shared`),SQLite 访问全在此 | — |
| caddy | 反向代理 / HTTPS / 静态资源 | 80/443 |
| opentodo-web | 子应用,iframe 嵌入 | 8787 |
| yijing64-web | 子应用 | 8788 |
| stock-web | 子应用 | 8789 |
| luminari-web | 子应用(主站生灵数据源) | 8790 |

### 2.2 页面路由

| URL | 守卫 |
| --- | --- |
| `/` | 公开 |
| `/admin` | **无服务端守卫**,靠客户端 + 各 API 401(metadata `noindex`) |
| `/lab/score` · `/lab/creature` · `/lab/species` | `src/app/lab/layout.tsx` 服务端 `isAdmin()` 重定向 `/admin` |

### 2.3 API 路由(48 个,按鉴权分组)

**公开 + 限流**

| 方法与路径 | 限流 | 写入 |
| --- | --- | --- |
| `POST /api/track` | 120/min/IP;bot UA 丢弃;站长非 MOCK 不计;2s 防抖 | `events`(vlog_play 按 cid+day 去重) |
| `GET/POST /api/comments` | POST 6/min/IP | `comments` |
| `POST /api/comments/delete` | 按 cid 归属校验 | `comments`(归档) |
| `POST /api/feedback` | 3/min/IP;蜜罐 `website` | `feedback` |
| `GET /api/contact/phone` | 20/min/IP | — |
| `GET /api/chat`(POST) | 12/min/IP + 每人每日上限 | `chat_logs` |
| `GET/POST /api/creature/generate` | 120/min/IP + 每人每日次数 + 队列上限 | `meta.creature_*` |

**公开只读**

`GET /api/health`(200/503)、`GET /api/status`、`GET /api/contact/wechat-qr`、
`GET /api/chat/config`、`GET /api/usage`、`GET /api/usage/sources`、
`GET /api/luminari/field`、`GET /api/luminari/chatter`。

**Token 保护**

| 路径 | 校验 |
| --- | --- |
| `GET /api/metrics` | `X-Metrics-Token` / `Bearer` / `?token=`;Caddy 对公网 `/api/metrics*` 返回 404 |
| `POST /api/usage` | `x-report-token === REPORT_TOKEN` |
| `POST /api/deepseek/token` | `x-sync-key` + CORS 仅 `platform.deepseek.com`;拒绝 `sk-` |
| `GET/POST /api/ai/v1/[...path]` | `Authorization: Bearer` / `x-zx-app-token` → `resolveAppByToken` + 配额 429 |

**管理员(`isAdmin()` 保护,401)**

`/api/admin/{login,logout,password,mock,settings,comments,delete,archive,visitor-alias,
stats,theme-config,projects,chatbot,chatbot/logs,chatbot/models,chatbot/distill,
chatbot/corpus,ai-gateway,ai-gateway/models,usage-source-order,wechat-qr,deepseek,
minimax,opencode,zhipu,vlog,vlog/title,vlog/cover,apps,apps/icon}`。

### 2.4 数据库(SQLite,单文件)

`journal_mode=DELETE`、`synchronous=FULL`、`busy_timeout=30000`(启动回读校验,不符即拒绝启动)。
表:`comments` / `usage` / `ai_usage` / `meta` / `events` / `feedback` / `visitor_aliases` /
`chat_logs` / `kb_docs` / `kb_chunks` / `kb_chunks_fts`。schema 见 `packages/shared/src/schema.ts`。

### 2.5 外部依赖

DeepSeek(平台用量)、智谱、MiniMax、OpenCode(Console)、上游 OpenAI 兼容端点、
Resend(反馈邮件)、Grafana Cloud(指标/日志/告警)、Sentry、Poste.io(邮箱)、Bark(推送)。

### 2.6 环境变量(关键)

`DB_PATH` · `ADMIN_PASSWORD` · `SESSION_SECRET`(生产缺失拒签会话)· `REPORT_TOKEN` ·
`ADMIN_COOKIE_DOMAIN`(SSO 子域)· `CONTENT_FILE` · `APPS_ICON_DIR` · `VLOG_COVER_DIR` ·
`CHATBOT_DIR` · `METRICS_TOKEN` · `RESEND_API_KEY`/`FEEDBACK_TO`/`FEEDBACK_FROM` ·
`LUMINARI_INTERNAL_URL`/`LUMINARI_PUBLIC_URL` · `GRAFANA_*` · `SENTRY_*`。

---

## 3. 测试分层矩阵(L0–L8)

| 层 | 名称 | 覆盖 | 工具 | 环境 | 频率 |
| --- | --- | --- | --- | --- | --- |
| L0 | 静态 / 质量门 | eslint、tsc(shared+next)、`next build` | 现有脚本 | 本地/CI | 每次提交 |
| L1 | 单元 | shared 纯函数 + 数据层(`:memory:`) + `lib/*` 纯逻辑 | node --test(保留)+ Vitest | 本地/CI | 每次提交 |
| L2 | 接口 / 集成 | 全部 48 路由的契约、鉴权、校验、错误码 | Vitest + fetch(临时 DB 起服务) | 本地/CI | 每次提交 |
| L3 | E2E | 访客 / admin / 交互全流程 | Playwright | 本地/CI | 每次提交 |
| L4 | 安全 | 鉴权绕过、注入、穿越、限流、CORS | Vitest + 脚本 | 本地 | 每次提交 |
| L5 | 外部契约 | AI 网关、luminari 代理、Resend、用量回退 | stub server | 本地/CI | 每次提交 |
| L6 | 性能 / 压测 | S1–S8(见 §9) | k6 + autocannon | 本地独立库 | 手动/定时 |
| L7 | 线上只读 | 健康、页面、只读接口、TLS、子域、指标不外泄 | k6 smoke + 定时脚本 | 线上 | 定时 |
| L8 | 混沌 / 故障 | provider 宕机、DB 锁、内容缺失、重启 | 注入脚本 | 本地 | 里程碑 |

---

## 4. 环境与夹具

### 4.1 临时库

```bash
export DB_PATH="/tmp/zx-test-$(date +%s).db"
export ADMIN_PASSWORD="test-admin"
export SESSION_SECRET="test-secret-0123456789"
export REPORT_TOKEN="test-report"
export METRICS_TOKEN="test-metrics"
# 启动生产构建做接口/E2E
cd apps/next-home && npm run build && PORT=3100 npm run start
```

数据层单元测试优先用 `openDb(':memory:')`(schema 已豁免 `delete` 校验)。

### 4.2 外部 mock

- **上游 LLM**:本地 stub(OpenAI 兼容,可返回固定/流式 SSE),通过 `baseUrl` 注入
  密钥池 / 聊天配置,避免真实调用。
- **Resend**:拦截 `https://api.resend.com`(stub 或 `fetch` 注入)。
- **用量平台**:用 `POST /api/usage` 造数,或直接写 `usage` / `ai_usage` 表。
- **luminari**:stub `LUMINARI_INTERNAL_URL` 指向本地假服务。

### 4.3 夹具(seed)

留言树 + 私密留言 + 各状态项目 + 应用栏 + vlog + 访客事件 + 聊天日志;
提供 `seed()` / `reset()` / `snapshot()`(`.backup`)三函数。

---

## 5. 测试链路

```
本地开发
  └─ L0 lint/typecheck/build ─┬─ L1 单元(shared build + node --test/Vitest)
                              ├─ L2 接口契约(临时 DB + next start)
                              ├─ L3 E2E(Playwright,临时 DB)
                              ├─ L4 安全 / L5 外部契约(stub)
                              └─ L6 压测(手动;k6,独立库)
                                   │
GitHub Actions(新增 test.yml,部署前门禁)
  install → build shared → lint → typecheck → test(L1) → next build
          → L2/L3(headless)→ 通过后才允许 build&push 镜像
                                   │
部署(现有 deploy.yml)
  push main → GHCR → SSH ci-run.sh → deploy.sh pull → caddy reload
                                   │
线上(只读)
  /api/health + / + 静态 + 子域可达 + TLS + /api/metrics 应 404
  Grafana Synthetic 持续探测 + 告警邮件
```

---

## 6. API 契约用例清单

> 每行至少断言:状态码、响应结构、副作用(DB 变化)、鉴权与错误分支。

### 6.1 健康与可观测

- [ ] `GET /api/health`:DB 可读 → 200 `{status:'ok'}`;断开/损坏 → 503。
- [ ] `GET /api/metrics`:无 token → 403;错误 token → 403;正确 token(头/`?token=`)→
      200 `text/plain` 含进程与业务指标。公网经 Caddy → 404。
- [ ] `GET /api/status`:无 Grafana 配置时优雅降级(不 5xx)。

### 6.2 留言

- [ ] `GET /api/comments`:分页 `page`/`pageSize` 边界(0、负数、超大);顶层树完整。
- [ ] 私密可见性:匿名看不到;本人 cid 看得到;admin 看得到;MOCK 身份按普通访客。
- [ ] `POST /api/comments`:昵称 1–32、正文 2–500、链接仅 http(s);非 admin 冒用站长昵称被拒;
      6/min 后 429。
- [ ] `POST /api/comments/delete`:无 cid → 403;非本人 → 403;本人 → 归档且子树递归。
- [ ] admin `delete`/`archive`:`restore` / `purge` 语义;purge 物理删除。

### 6.3 埋点与反馈

- [ ] `POST /api/track`:`type` 白名单外忽略;bot UA 丢弃;站长非 MOCK 不计;2s 防抖;
      新访客 Set-Cookie `zx_cid`;`vlog_play` 按 cid+day 去重;120/min 限流。
- [ ] `POST /api/feedback`:蜜罐 `website` 命中假成功且不落库;3/min 限流;
      Resend 缺 key 时入库 `pending`;发信失败入库 `failed`。

### 6.4 管理鉴权

- [ ] 除 `login`/`logout` 外所有 `/api/admin/*` 无 cookie → 401;错误签名 cookie → 401;
      正确会话 → 200。
- [ ] `POST /api/admin/login`:正确密码 Set-Cookie `zx_admin`;错误 → 401;无 `SESSION_SECRET`
      → 503。`logout` 清 cookie。
- [ ] `POST /api/admin/password`:校验 current;长度 4–64;改后旧会话处理符合预期。
- [ ] `POST /api/admin/mock`:空清除;非法 cid 拒绝;仅 admin。

### 6.5 配置类(整表 / 乐观锁)

- [ ] `GET/POST/DELETE /api/admin/projects`:`rev` 不匹配 → 409;软删除;`reset`。
- [ ] `POST /api/admin/apps` + `/api/admin/apps/icon`:URL 规范化;软删除;
      图标 ≤2MB、≥64px、PNG IHDR 校验;错误格式拒绝。
- [ ] `POST /api/admin/vlog` + `/title` + `/cover`:封面 ≤3MB、≥320px;
      `<vid>.user.*` 落盘;`patchVideoCover` 写库。
- [ ] `POST /api/admin/theme-config`:至少 1 主题 + 1 布局;默认项必须在放行集合内。
- [ ] `GET/POST /api/admin/settings` + `/wechat-qr`:联系方式与二维码(≤800KB,仅图片类型)。
- [ ] `GET/POST/DELETE /api/admin/chatbot/logs`:按 session 归并;delete-session / prune /
      全清需 `?confirm=1`。
- [ ] `POST /api/admin/chatbot/distill` + `/corpus`:路径穿越拒绝;≤2MB;仅 .md/.txt;
      删除同步清 `kb_chunks`;`set-sensitive-allow` / `set-ignored` 持久化。
- [ ] `GET/POST /api/admin/chatbot/models` 与 `/api/admin/ai-gateway/models`:15s 超时、
      错误 baseUrl 优雅报错。
- [ ] `POST /api/admin/deepseek` `/opencode` `/zhipu` `/minimax`:各 action(save/refresh/
      rotate/capture/clear)字段与落库键正确。

### 6.6 用量源

- [ ] `GET /api/usage`:各 `source`(deepseek/opencode/zhipu/minimax/self)返回结构一致;
      平台失败 → `stale`(上次成功) → `local`(本地表)回退链。
- [ ] `range=24h/7d/30d/90d` 窗口与北京时间粒度正确。
- [ ] `POST /api/usage`:缺/错 `x-report-token` → 401;合法 → 写 `usage`。
- [ ] `GET /api/usage/sources`:可用性探测 + admin 顺序/默认源。

### 6.7 AI 网关与聊天

- [ ] `POST /api/ai/v1/chat/completions`:合法令牌 → 转发;缺令牌 → 401;超配额 → 429;
      流式补 `include_usage`;`ai_usage` 按 日×时×app×provider×model upsert 累加。
- [ ] `GET /api/ai/v1/models`、`OPTIONS` CORS `*`。
- [ ] `POST /api/chat`:未开放 404;未配置 503;12/min 限流;每日上限;message ≤2000;
      流式输出;写 `chat_logs` 两条(user/assistant)。
- [ ] `POST /api/chat` RAG:关键词 + 向量混合命中;敏感信息被脱敏/拒答。
- [ ] `GET /api/chat/config`:不含任何密钥。

### 6.8 代理与生灵

- [ ] `GET /api/luminari/field`:目标不可达时优雅降级;图片路径改写为绝对地址。
- [ ] `GET /api/luminari/chatter`:结构 `{turns}`;上游错误时不 5xx。
- [ ] `POST /api/creature/generate`:队列满 → 202 `{state:'queued'}`;轮询 `GET` 返回结果;
      每日每人次数与总预算约束。

---

## 7. E2E 用例清单(Playwright)

**访客**
- [ ] 首页加载无控制台错误;主题切换(18 套)+ 布局切换(10 套)持久化、无闪烁。
- [ ] 留言:发表 → 出现在列表;回复(单层缩进 + `回复 @昵称`);分页(5/10/20/50/100);
      昵称 cookie 记忆;访问 `[`/`]` 循环主题。
- [ ] 私密留言:本人可见,切 MOCK 身份后不可见。
- [ ] 联系方式:微信复制 + 二维码浮窗;电话移动端 `tel:` / 桌面复制(号码不预置 DOM)。
- [ ] 应用栏:拖拽改序、分组连续、跨组拒绝、↺ 恢复默认、`panel` 打开浮层。
- [ ] 反馈按钮提交;vlog 播放埋点;简历下载。
- [ ] 聊天机器人:开关/问候语/建议问题/流式回复。
- [ ] 生灵层:显示、`pointer-events:none` 不挡点击、可关闭开关(站长可控)。

**admin**
- [ ] 错误密码拒登;正确登录;修改密码后旧会话行为;退出。
- [ ] 留言管理:查看含私密、删除递归、归档箱恢复/彻底删。
- [ ] 项目/应用/vlog/外观/机器人/Token用量 各面板增删改、上传、排序、垃圾箱、恢复默认。
- [ ] MOCK 切换 A/B/C:身份 + 昵称 + 主题各自独立。
- [ ] `/lab/*` 未登录重定向 `/admin`。

---

## 8. 安全用例清单

- [ ] 未授权访问全部 admin API 与 `/lab/*`。
- [ ] 伪造 / 篡改 `zx_admin` cookie(HMAC 变更)→ 401。
- [ ] `SESSION_SECRET` 缺失时生产拒绝签发。
- [ ] XSS:留言正文 / 昵称注入 `<script>`、`<img onerror>` → 转义。
- [ ] SQL 注入:留言、分页参数、corpus 文件名。
- [ ] 路径穿越:corpus 上传名 `../`、图标 id、封面 vid。
- [ ] SSRF / 代理滥用:`/api/luminari/*`、AI 网关 baseUrl 限制。
- [ ] CORS:`/api/deepseek/token` 仅放行指定 Origin;网关 CORS `*` 但需令牌。
- [ ] 限流:各阈值确定性触发 429;多 IP 不互相影响(内存实现说明)。
- [ ] 敏感数据:联系方式号码不预置于 HTML;`/api/metrics` 公网 404;
      admin 接口不下发密钥明文(掩码)。
- [ ] 上传:错误魔数 / 超大 / 尺寸不足 / 伪造扩展名一律拒绝。

---

## 9. 压测方案(k6)

### 9.1 环境与纪律

- 目标:**本地** `next start`(生产构建,临时 DB),或本地 docker compose 全栈。
- **禁止对线上压测**(单环境、2GB 单机、SQLite 单写者,会直接影响真实访客)。
- 每次压测独立库、独立端口;结束 `kill` 进程并丢弃库。

### 9.2 指标

`http_req_duration` p50/p95/p99、RPS、`http_req_failed`;进程 RSS / heap、event loop lag、
SQLite 文件大小、CPU/内存(容器全栈时经 node-exporter/cadvisor)。

### 9.3 场景

| ID | 场景 | 负载 | 通过阈值 |
| --- | --- | --- | --- |
| S1 | 稳态读(首页 + 静态 + `GET /api/comments`) | 0→100 VU,10min | p95<300ms,failed<1% |
| S2 | 峰值突刺 | 0→300 VU | 记录拐点与首个 5xx 出现点 |
| S3 | 写并发(`/api/track`、`/api/comments`、`/api/feedback`) | 递增并发 | 无 5xx;限流按预期 429;SQLite 无 `SQLITE_BUSY` 溢出 |
| S4 | 聊天流式 `/api/chat` | 并发 20 | SSE 完整;日预算/限流生效 |
| S5 | AI 网关 `/api/ai/v1/...` | 并发 50(stub 上游) | 配额 429 准确;`ai_usage` 计数与请求数一致 |
| S6 | Soak 混合 | 中等负载 1–2h | RSS 无单调增长;event loop lag 稳定 |
| S7 | 静态资源(Caddy `resume.pdf`/`vlog`/`apps`) | 高并发 | 缓存命中、无应用回源 |
| S8 | 限流正确性 | 确定性并发 | 各阈值处恰好 429,阈值内全 200 |

### 9.4 报告模板

每个场景输出:k6 summary(阈值 ✓/✗)+ 环境指纹(commit、build、DB 大小、机器)+
异常样本(首个 5xx 请求/响应)+ 结论与回归建议。

---

## 10. 子应用测试方案

子应用均在本机同级目录(`../Opentodo`、`../StockApp`、`../luminari`、`../yijing64`,
各自 `web/` = Vite 前端 + Node `server.js`,已有 `node --test` 脚本)。

### 10.1 独立仓库

每个子应用跑:`npm run typecheck` → `npm run build` → `npm test`;
补充核心 API 契约测试(公开读数、写操作、鉴权)。

### 10.2 集成点(与博客)

- [ ] **SSO**:博客登录后,子域(iframe/直访)判定为站长(共享 `SESSION_SECRET` +
      `ADMIN_COOKIE_DOMAIN`);退出后失效。
- [ ] **iframe**:Caddy 的 `frame-ancestors 'self' https://<主域>` 生效;主站能嵌入。
- [ ] **AI 网关**:子应用持 `zxai_` 令牌经 `http://app:3000/api/ai/v1` 调用成功、
      计费进 `ai_usage`;令牌禁用/超配额 → 429。
- [ ] **luminari 代理**:`/api/luminari/field` 字段改写正确;主站生灵层与 luminari 数据一致。
- [ ] **postMessage**:生灵可关闭(`zx:floats-*`)跨子域通信生效。

### 10.3 远端只读冒烟

- [ ] `https://todo.<域名>` / `yijing` / `stock` / `luminari` 首页 200、无 5xx。
- [ ] 各子域核心只读接口 200;接入令牌有效(不触发写)。
- [ ] 与主站 `/` 一起纳入 Grafana Synthetic。

---

## 11. 线上只读冒烟 + 监控

- [ ] `GET https://<域名>/api/health` → 200;`/` → 200;关键静态资源 → 200。
- [ ] `GET https://<域名>/api/metrics` → **404**(Caddy 纵深防御)。
- [ ] TLS 证书有效期 > 14 天;`www` → 主域 301。
- [ ] 各子域可达性(见 §10.3)。
- [ ] 备份新鲜度:`docker/site-content` 最近备份时间(只读检查)。
- [ ] Grafana 告警规则在线(站点不可达 / 实例重启 / app up / 重启 / 磁盘 / 内存 / 证书),
      通知到邮件;合成探测覆盖 `/` 与 `/api/health`。

---

## 12. 故障注入与恢复演练(本地)

- [ ] 上游 provider 不可达:用量面板回退 `stale`/`local`;聊天返回友好错误;不留 5xx 堆积。
- [ ] `content.local.ts` 缺失:shared 构建用占位通过;运行时 `CONTENT_FILE` 缺失降级。
- [ ] DB 被锁 / 只读挂载:启动 `journal_mode`/`synchronous` 回读校验失败 → 明确拒绝启动。
- [ ] `SESSION_SECRET` / `REPORT_TOKEN` / `METRICS_TOKEN` 缺失:对应功能明确拒绝,不静默放行。
- [ ] 进程重启:SQLite `DELETE` 模式无旁路文件;验证数据完整(对照 `.backup` 快照)。
- [ ] 磁盘写满:上传/落盘失败返回错误码,不产生半写文件。
- [ ] 备份/恢复:`.backup` → 恢复 → 数据一致(遵循 `AGENTS.md` 流程)。

---

## 13. 测试数据与隐私管理

- 真实隐私文件(`content.local.ts`、`site-content/`、简历、二维码)绝不进测试夹具与镜像。
- 线上任何测试**不写真实数据**;如需验证写路径,只在本地临时库。
- 测试产生的假数据集中命名(如 `__test__` 前缀),便于识别与清理。
- 破坏性测试前先 `sqlite3 apps/next-home/data/zx.db ".backup '/tmp/...'"`(仅本地)。

---

## 14. 执行命令速查

```bash
# 全部一键(数据层 + 单元)
npm test

# 分层
npm run test:data      # L1 数据层(node --test,内存库)
npm run test:api       # L2 接口 + 集成(Vitest;自动起临时库服务 :3199)
npm run test:e2e       # L3 E2E(Playwright;build + 临时库服务 :3198)
npm run test:unit      # packages/shared 既有单元

# 质量门
cd apps/next-home && npm run lint && npm run build

# 压测(仅本地;k6:brew install k6;run.mjs 自动起临时库服务 :3197)
npm run test:load -- quick          # S0 最小冒烟
npm run test:load -- steady-read    # S1
npm run test:load -- rate-limit     # S8
node tests-suite/load/run.mjs --list

# 线上只读冒烟(仅 GET;不写、不压测)
SMOKE_DOMAIN=<域名> npm run test:smoke
```

---

## 15. 落地状态与里程碑

### 15.1 测试代码布局(与业务代码平级)

```
tests-suite/
  helpers/   内存库夹具(memdb.mjs)
  data/      数据层测试(L1,node --test)                 ✅
  api/       Vitest 接口契约 + 集成点(L2)                ✅ http.mjs / run.mjs
  e2e/       Playwright 端到端(L3)                       ✅ playwright.config.ts
  load/      k6 场景 S0–S8(L6)                           ✅ lib.js / run.mjs
  smoke/     线上只读冒烟(L7)                            ✅ online-smoke.mjs
  README.md  用法
```

依赖只加在**根 `package.json` 的 `devDependencies`**:`@playwright/test`、`vitest`
(k6 走 brew,非 npm)。**上线不带**:Dockerfile 只 `COPY packages/shared` 与
`apps/next-home`,根级 `tests-suite/` 天然不入镜像;`.dockerignore` 已排除
`tests-suite` / `test-results` / `playwright-report`,确保不进构建上下文与镜像。

### 15.2 CI 门禁(已落地)

`.github/workflows/test.yml`:`install → build shared → lint → unit/data →
next build → API → E2E → load smoke(S0)`,任一步失败即红。
`deploy.yml` 用 `uses: ./.github/workflows/test.yml` 复用该 workflow,
并将 `build-deploy` 设为 `needs: test` —— **测试不过不部署**;PR 上 `test.yml` 独立运行。

### 15.3 落地顺序(进度)

1. **M1 数据层(L1)** ✅ `tests-suite/data`
2. **M2 E2E(L3)** ✅ Playwright:首页/health/404、`/lab/*` 重定向、admin 登录、发表留言
3. **M3 接口 + 集成(L2)** ✅ Vitest:鉴权、留言、埋点、luminari 代理、AI 网关
4. **M4 压测(L6)** ✅ k6 S0–S8 + `run.mjs`(quick / rate-limit 已实跑通过)
5. **M5 CI 门禁** ✅ `test.yml` + `deploy.yml` 依赖
6. **M6 线上冒烟(L7)** ✅ `online-smoke.mjs`(main / health / metrics 404 / TLS / 子域)

### 15.4 后续可选增强

- 用 `stub 上游` 跑通 S4 聊天 / S5 网关的真实计费与用量断言(当前仅鉴权/优雅降级)。
- Playwright 覆盖主题/布局持久化、应用栏拖拽、MOCK 身份、私密留言可见性。
- 线下压测基线报告归档(commit + 环境指纹 + p95/拐点)。
- 在服务器侧接入 `online-smoke` 定时任务或 Grafana Synthetic(见 §11)。
