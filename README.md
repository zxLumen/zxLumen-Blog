# zxLumen-Blog

刘子祥的个人主页 —— **Next.js 16 + SQLite,自托管部署**。

## 结构

```
apps/
  next-home/        Next.js 16 应用(端口 3000)
  start-home/       (空的遗留目录,未使用,可忽略)
packages/
  shared/           设计系统(主题/布局)+ 共享 React 组件 + 类型/导航
                    + DeepSeek 计价 + SQLite 数据层(@zx/shared)
  shared/src/content.local.example.ts   个人资料示例(占位,入库)
  shared/src/content.local.ts           你的真实资料(不入库,见下)
docker/
  Dockerfile         多阶段构建
  docker-compose.yml app + Caddy
  Caddyfile          自动 HTTPS / 子域名路由
  init-server.sh     服务器初始化(Docker/swap/ufw/fail2ban)
  update.sh          拉代码 + 重建重启
  backup.sh          SQLite 备份脚本
docs/
  PROVISIONING.md    采购与上线手册(域名/VPS/DNS)
  DEPLOY.md          部署手册
  REPORTING.md       DeepSeek 用量上报接口
```

## 本地开发

```bash
# 1. 编译共享库(首次及每次改 shared 后)
cd packages/shared && npm install && npm run build   # 会自动生成缺失的 content.local.ts(占位)

# 2. 启动
cd apps/next-home && npm install && npm run dev      # http://localhost:3000
```

> 需要 Node 20+(推荐 22 LTS)。

### 横屏视频封面(可选)

抖音播放器自带的封面层用的是被裁成 3:4 的竖图,塞进 16:9 视频区会变形。所以封面来源分两层:

- **你自己的封面(优先)** —— 在 `/admin`「视频」面板逐条**上传**,浏览器端会保持比例把
  长边压到 1280 再转 JPEG(q0.85),存成 `docker/site-content/vlog/<vid>.user.jpg`
  (非 JPEG 会原样存 `.user.png`/`.user.webp`)。上传**立即写库**(`coverSrc='user'`),
  不用点面板的「保存」;新加的视频要先保存进列表才能上传。
- **抖音兜底首帧** —— 本地跑 `npm run cover:push` 补齐:它读线上配置算出缺哪些,用本机
  Chrome 打开官方播放器页、读页面**自己签名**的 `aweme/detail` 响应取 `video.origin_cover`
  (640×360),存成 `<vid>.jpg`,再经 SSH 推到服务器封面目录。**它就是视频第 0 帧**,不是
  作者另设的封面(已实测 SSIM ≈ 0.99 与 t=0 帧一致),只是「至少不变形」的保底。

两者互不覆盖:面板可随时「恢复兜底」删掉 `<vid>.user.*` 回落到 `<vid>.jpg`。

```bash
cd packages/shared
npm run cover:push                  # 线上缺哪张就抓哪张并推上去(推荐;需本机 Chrome)
npm run cover:push -- --dry-run     # 只看线上缺哪些,不生成/不推送
npm run cover:vlog -- --list        # 本地清单:来源/尺寸/大小(不联网)
npm run cover:vlog                  # 只生成本地兜底图(不推线上)
npm run cover:vlog -- --force       # 连已存在的兜底图也重抓
npm run cover:vlog -- --only <vid>  # 只处理指定视频(--only 可重复,也可裸写 vid)
```

`cover:push` 需要 SSH 到服务器,配置放 `packages/shared/.env.local`(已 gitignore):
`ZX_SSH=ubuntu@<服务器IP>`,可选 `ZX_SITE` / `ZX_VLOG_DIR` / `ZX_DB_VOLUME`。

- 兜底图必须由**真实浏览器**生成:抖音的封面在 `aweme/v1/web/aweme/detail/` 响应里,
  该接口要 `a_bogus` 签名(JSVMP 混淆),普通 HTTP 直连一律空响应 —— 所以只能在有
  Chrome 的机器上跑,服务器不装浏览器。
- 封面 URL 带签名约 14 天过期 → **必须落本地**,不能长期外链。
- 封面与视频方向不一致(横图配竖屏 / 竖图配横屏)一律**等比缩放 + 纯黑补边**,
  不裁剪(`object-fit: contain; background: #000`),上传时会提示补哪边。
- 竖屏视频没有兜底图(不需要,竖封面塞进竖框不变形);缺图 / 404 时前端回退播放器封面。
- 路径两端通用:本地由 `apps/next-home/public/vlog` 软链到 `docker/site-content/vlog/`,
  生产由 Caddy 的 `/vlog/*` 静态服务。
- 前端优先用 `v.cover`,没有就按 vid 推 `/vlog/<vid>.jpg`,所以生产库没写 `cover`
  字段也能正常显示;`coverAt` 会作为 `?v=` 破缓存。面板徽章按**图片实际能否加载**判断,
  不看库字段。

## ⚠️ 隐私:以下文件不入库(部署时需单独提供)

| 文件 | 内容 | 说明 |
|---|---|---|
| `packages/shared/src/content.local.ts` | 你的真实资料(姓名/邮箱/经历) | 由 `content.local.example.ts` 复制后填写 |
| `apps/next-home/public/resume.pdf` | 简历(含手机号) | 「下载简历」用 |
| `apps/next-home/public/wechat.png` | 微信二维码 | 未在后台上传时的静态兜底 |
| `docker/site-content/vlog/*` | 视频封面(`<vid>.jpg` 兜底首帧 / `<vid>.user.*` 面板上传) | `npm run cover:vlog` 生成兜底图、面板上传生成你的封面;不入库,部署时 `scp -r` |
| `apps/next-home/resume/resume.md` 等 | 简历源文件/产物 | 仅保留 `resume.py`+`resume.css` 脚本 |

> `content.local.ts` 缺失时,`npm run build`(shared)会用示例自动生成占位,保证可构建。

## 功能

- **主题**:**18 套**全部放行(GITHUB · NORD · SYNTHWAVE · DRACULA · ROSE PINE · MINIMAL · TERMINAL · NEON · AMBER · CYBERPUNK · TOKYO NIGHT · GRUVBOX · SOLARIZED · MONOKAI · CATPPUCCIN · PAPER · SOLARIZED LT · NORD LIGHT)。右上角 `THEME ▾` 选择器,`[`/`]` 循环,偏好存 localStorage,无闪烁
- **布局**:**10 套**全部放行(选择器「布局」Tab 或 `Shift+数字`)
- **Hero**:终端打字机 + 随主题变化的 ASCII;隐藏入口(单击姓名进 admin)
- **项目展示**:卡片 + 状态/时间区间 + 技术栈 + 跳转 demo
- **DeepSeek 用量面板**:总览 / 日趋势 / 模型占比 / 最近调用;无真实数据时显示 demo 曲线
- **关于 / 简历**:bio、技能、时间线;**下载简历**
- **联系我**(关于页与页脚):**邮件**(mailto)、**微信**(复制微信号 + 点击处弹出二维码浮窗)、**电话**(移动端 `tel:` 拨号 / 桌面端复制;**号码不下发页面**)
- **留言板**:公开 / 仅站长可见;**回复**(单层缩进 + `回复 @昵称`);**页码分页**(每页 5/10/20/50/100);昵称 cookie 记忆;`/admin` 可删除(递归整棵回复)
- **admin** `/admin`:会话登录、站长昵称、修改密码、联系方式(邮箱/微信/电话/二维码上传)、留言管理
- **模拟访客(仅站长)**:右上角 `MOCK` 可切换多个匿名身份 A/B/C(每身份 = 一台独立设备:身份 + 昵称 + 主题各自独立),以不同访客视角浏览/留言(验证私密可见性、自删等)

## 开发流程:本地开发 → 打包 → 部署线上

全站**只有一个环境、一套数据**;在**本地**自测,验证通过后打包部署到线上。

1. 本地 `npm run dev` 自测
2. 验证通过后并入主线 → **打包** → 部署到线上

功能、主题、布局全部放行,无白名单门控。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/comments?page=&pageSize=` | 留言分页(线程级);登录站长则含私密 |
| POST | `/api/comments` | 新增留言 / 回复(`parent_id`、`visibility`) |
| POST | `/api/comments/delete` | 删除自己的留言(按匿名 ID 校验) |
| GET | `/api/usage?range=30d` | 用量记录(`range`=`24h`/`7d`/`30d`/`90d`;回退链:DeepSeek 平台 → 上次成功数据 → 本地表) |
| GET | `/api/usage?source=opencode` | OpenCode 用量(官方 Console) |
| GET | `/api/usage?source=zhipu` | 智谱用量(monitor API) |
| POST | `/api/track` | 埋点上报(访问/项目点击/简历下载;排除站长/MOCK/爬虫) |
| POST | `/api/usage` | 上报用量,需头 `X-Report-Token` |
| GET | `/api/contact/phone` | 获取电话(限流;号码不预置页面) |
| GET | `/api/contact/wechat-qr` | 微信二维码图片(长缓存,带版本) |
| POST | `/api/admin/login` / `logout` | 管理员会话(签名 cookie) |
| GET | `/api/admin/comments?page=&pageSize=` | 全部留言(含私密) |
| POST | `/api/admin/delete` | 删除留言(递归子树) |
| GET/POST | `/api/admin/settings` | 站长昵称 + 联系方式 |
| GET | `/api/admin/stats` | 统计聚合(留言/简历/项目点击/访客;仅站长) |
| POST | `/api/admin/password` | 修改密码 |
| GET/POST | `/api/admin/wechat-qr` | 查询/上传微信二维码 |
| POST | `/api/admin/mock` | 设置/清除"模拟访客"身份(仅站长) |

上报细节见 `docs/REPORTING.md`。

## 环境变量

见各 `.env.example`:`DB_PATH`(唯一库)/ `ADMIN_PASSWORD` / `SESSION_SECRET` / `REPORT_TOKEN`。
默认值可直接跑 demo(`admin` / `dev-report-token`),**上线前务必修改**。

## 部署

见 `docs/DEPLOY.md`(Docker + Caddy 自动 HTTPS,单 VPS)。**注意**:上文「不入库」的个人文件需单独上传到服务器。

## 里程碑

- [x] M0 环境 + monorepo + 共享设计系统/组件库
- [x] M1 双 demo(Next.js / TanStack)+ 主题 + hero + 全板块
- [x] M2 真实 SQLite 留言 / 用量上报 / admin
- [x] M3 定版 **Next.js**(移除 TanStack Start)
- [x] M4 真实内容:依简历更新资料/技能/项目/时间线;联系方式 + 二维码;admin 设置项(动画打磨为可选项)
- [x] M5a 部署工程:Dockerfile / compose / Caddyfile / 备份脚本 / 部署与上报文档
- [ ] M5b 服务器上线:购买 VPS + 域名 → 上传私有文件 → 验证构建 → 配备份 cron

## 待办(TODO)

- [ ] 到 `/admin → 联系方式` 填写**真实微信号**(现为占位)
- [ ] (可选)填写 GitHub 链接;决定哪些主题/布局进入正式集
- [ ] **接入 DeepSeek 用量上报**:你的 DeepSeek 服务每次调用后 `POST /api/usage`(读取与聚合展示已完成,接口见 `docs/REPORTING.md`);面板在无平台数据时会回退本地表,否则显示 demo 曲线
- [ ] **上线**(M5b):买 VPS/域名,按 `docs/DEPLOY.md` 部署
- [ ] (可选)挂载项目子域名 demo 并填 `PROJECTS[].demoUrl`
