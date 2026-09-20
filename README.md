# zxLumen-Blog

个人主页(Next.js 16 + SQLite,自托管部署)。

## 结构

```
apps/
  next-home/        Next.js 16 应用(端口 3000)
packages/
  shared/           三套主题设计系统 + 共享 React 组件 + 内容/简历数据
                    + DeepSeek 计价 + SQLite 数据层(@zx/shared)
docker/
  Dockerfile        多阶段构建
  docker-compose.yml  app + Caddy
  Caddyfile         自动 HTTPS / 子域名路由
  backup.sh          SQLite 备份脚本
docs/
  DEPLOY.md         部署手册
  REPORTING.md      DeepSeek 用量上报接口
```

## 本地开发

```bash
# 1. 编译共享库(首次及每次改 shared 后)
cd packages/shared && npm install && npm run build

# 2. 启动
cd apps/next-home && npm install && npm run dev     # http://localhost:3000
```

> 需要 Node 20+(推荐 22 LTS)。

## 功能

- **6 套主题**:右上角 `THEME ▾` 下拉选择器,或按 `1`–`6` 切换,偏好存 localStorage,无闪烁
- **布局**:固定 **SIDEBAR**(左侧竖排导航)
- **Hero** 终端打字机 + ASCII,motif 随主题变化
- **项目展示**:卡片 + 状态徽章 + 技术栈 + 跳转 demo
- **DeepSeek 用量面板**:总览 / 日趋势 / 模型占比 / 最近调用;无真实数据时显示 demo 曲线
- **关于 / 简历**:bio、技能、时间线
- **留言板**:公开 / 仅站长可见,写入 SQLite
- **admin** `/admin`:密码查看(含私密)与删除

改主题只需在 `packages/shared/src/styles.css` 的 token 块加变量,并在 `theme.ts` 的 `THEMES` 注册。
当前 6 套(快捷键 1–6):GITHUB · NORD · SYNTHWAVE · DRACULA · ROSE PINE · MINIMAL。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/comments` | 公开留言 |
| POST | `/api/comments` | 新增留言(private 可选) |
| GET | `/api/usage?days=30` | 用量记录 |
| POST | `/api/usage` | 上报用量,需头 `X-Report-Token` |
| POST | `/api/admin/comments` | 密码鉴权,返回全部留言 |
| POST | `/api/admin/delete` | 密码鉴权,删除留言 |

上报细节见 `docs/REPORTING.md`。

## 环境变量

`apps/next-home/.env.example`:`DB_PATH` / `ADMIN_PASSWORD` / `REPORT_TOKEN`。
默认值可直接跑 demo(`admin` / `dev-report-token`),**上线前务必修改**。

## 部署

见 `docs/DEPLOY.md`(Docker + Caddy 自动 HTTPS,单 VPS)。

## 里程碑

- [x] M0 环境 + monorepo + 共享设计系统/组件库
- [x] M1 三主题 + hero + 全板块
- [x] M2 真实 SQLite 留言 / 用量上报 / admin
- [x] M3 定版 Next.js(删除 TanStack Start)
- [ ] M4 填入真实项目/简历、打磨动画
- [ ] M5 Docker + Caddy + 备份 + 部署文档
