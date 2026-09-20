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
  Dockerfile            多阶段构建
  docker-compose.yml    app + Caddy
  Caddyfile             自动 HTTPS / 子域名路由
  backup.sh             SQLite 备份脚本
docs/
  DEPLOY.md             部署手册
  REPORTING.md          DeepSeek 用量上报接口
```

## 本地开发

```bash
# 1. 编译共享库(首次及每次改 shared 后)
cd packages/shared && npm install && npm run build   # 会自动生成缺失的 content.local.ts(占位)

# 2. 启动
cd apps/next-home && npm install && npm run dev      # http://localhost:3000
```

> 需要 Node 20+(推荐 22 LTS)。

## ⚠️ 隐私:以下文件不入库(部署时需单独提供)

| 文件 | 内容 | 说明 |
|---|---|---|
| `packages/shared/src/content.local.ts` | 你的真实资料(姓名/邮箱/经历) | 由 `content.local.example.ts` 复制后填写 |
| `apps/next-home/public/resume.pdf` | 简历(含手机号) | 「下载简历」用 |
| `apps/next-home/public/wechat.png` | 微信二维码 | 未在后台上传时的静态兜底 |
| `apps/next-home/resume/resume.md` 等 | 简历源文件/产物 | 仅保留 `resume.py`+`resume.css` 脚本 |

> `content.local.ts` 缺失时,`npm run build`(shared)会用示例自动生成占位,保证可构建。

## 功能

- **主题**:正式环境 **6 套**(GITHUB · NORD · SYNTHWAVE · DRACULA · ROSE PINE · MINIMAL,键 `1`–`6`);**测试模式放行全部 18 套**(其余用字母键)。右上角 `THEME ▾` 选择器,`[`/`]` 循环,偏好存 localStorage,无闪烁
- **布局**:正式固定 **SIDEBAR**;**测试模式放行全部 10 套**(选择器「布局」Tab 或 `Shift+数字`)
- **Hero**:终端打字机 + 随主题变化的 ASCII;隐藏彩蛋(连点 ASCII 四次进 admin)
- **项目展示**:卡片 + 状态/时间区间 + 技术栈 + 跳转 demo
- **DeepSeek 用量面板**:总览 / 日趋势 / 模型占比 / 最近调用;无真实数据时显示 demo 曲线
- **关于 / 简历**:bio、技能、时间线;**下载简历**
- **联系我**(关于页与页脚):**邮件**(mailto)、**微信**(复制微信号 + 点击处弹出二维码浮窗)、**电话**(移动端 `tel:` 拨号 / 桌面端复制;**号码不下发页面**)
- **留言板**:公开 / 仅站长可见;**回复**(单层缩进 + `回复 @昵称`);**页码分页**(每页 5/10/20/50/100);昵称 cookie 记忆;`/admin` 可删除(递归整棵回复)
- **admin** `/admin`:会话登录、站长昵称、修改密码、联系方式(邮箱/微信/电话/二维码上传)、留言管理
- **测试模式**:整站 LIVE / TEST 切换(独立测试库 + 全部主题/布局),仅站长可见

### 主题 / 布局的"正式集"
在 `packages/shared/src/theme.ts` 里维护:
- `LIVE_THEME_IDS` / `LIVE_LAYOUT_IDS`:正式环境放行的集合(测试模式自动放行全部)
- 新增主题:在 `THEMES` 注册 + 在 `styles.css` 加一段 token 块

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/comments?page=&pageSize=` | 留言分页(线程级);登录站长则含私密 |
| POST | `/api/comments` | 新增留言 / 回复(`parent_id`、`visibility`) |
| GET | `/api/usage?days=30` | 用量记录 |
| POST | `/api/usage` | 上报用量,需头 `X-Report-Token` |
| GET | `/api/contact/phone` | 获取电话(限流;号码不预置页面) |
| GET | `/api/contact/wechat-qr` | 微信二维码图片(长缓存,带版本) |
| POST | `/api/admin/login` / `logout` | 管理员会话(签名 cookie) |
| GET | `/api/admin/comments?page=&pageSize=` | 全部留言(含私密) |
| POST | `/api/admin/delete` | 删除留言(递归子树) |
| GET/POST | `/api/admin/settings` | 站长昵称 + 联系方式 |
| POST | `/api/admin/password` | 修改密码 |
| GET/POST | `/api/admin/wechat-qr` | 查询/上传微信二维码 |
| POST | `/api/env` | 切换 LIVE / TEST(仅站长);`{reset:true}` 清空测试库 |

上报细节见 `docs/REPORTING.md`。

## 环境变量

见各 `.env.example`:`DB_PATH` / `DB_TEST_PATH` / `ADMIN_PASSWORD` / `SESSION_SECRET` / `REPORT_TOKEN`。
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
- [ ] **接入 DeepSeek 用量上报**(现有服务调用后 `POST /api/usage`),否则面板显示 demo 曲线
- [ ] **上线**(M5b):买 VPS/域名,按 `docs/DEPLOY.md` 部署
- [ ] (可选)挂载项目子域名 demo 并填 `PROJECTS[].demoUrl`
