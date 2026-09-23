# AGENTS.md

本仓库(zxLumen-Blog)的协作规范。**所有改动必须遵守下面的工作流。**

## 仓库结构

- `apps/next-home`:Next.js 16 应用(端口 3000)
- `packages/shared`:设计系统(主题/布局)+ 共享 React 组件 + 类型 + SQLite 数据层(`@zx/shared`)
- `docker/`:Dockerfile / compose / Caddyfile / 备份脚本
- `docs/`:部署、上报等文档

## 常用命令

```bash
# 改 shared 后必须重新编译(会生成缺失的 content.local.ts 占位)
cd packages/shared && npm run build

# 本地开发
cd apps/next-home && npm run dev      # http://localhost:3000

# 校验(提交前跑)
cd apps/next-home && npm run lint && npm run build
```

> 需要 Node 20+(推荐 22 LTS)。

## 每次改动后的收尾(必须做)

1. 改了 `packages/shared` → 重新编译:`cd packages/shared && npm run build`
2. 校验:`cd apps/next-home && npm run lint && npm run build`
3. **拉起本地服务并确认在跑**:`cd apps/next-home && npm run dev`(端口 3000);
   若已在运行则确认仍在跑,不要留在停止状态
4. 冒烟:`curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` 与 `/admin` 均应为 `200`
5. 更新 `CHANGELOG.md`(有用户可见改动时)
6. 只有明确要求才提交 / 推送

## 工作流:本地开发 → 打包 → 部署线上(单环境)

全站**只有一个环境、一套数据**。没有 TEST/LIVE 之分,也没有主题/布局/功能白名单门控 ——
18 套主题、10 套布局、全部功能一律放行,各 API 只读写唯一数据库(`DB_PATH`)。

规则:

1. 改动在**本地**自测(`npm run dev`)。
2. 验证通过后,把改动并入主线 → **打包** → 部署到线上。

> 上线即更新线上;不做线上试验,也不再需要"先 TEST 验证再晋升 LIVE"的流程。

### 用 MOCK 身份调试(仅站长)

右上角 `MOCK` 切换器(仅站长可见)可把请求伪装成某匿名访客(`${'`zx_mock`'}`),
以不同用户视角浏览/留言,用于验证"私密仅本人与站长可见""访客删除自己的留言"等。
模拟时该请求按普通访客处理(不享受站长特权);`恢复本人` 清除。
也可直接调 `POST /api/admin/mock` `{ cid }`。预设三个身份:访客 A/B/C。

**统计口径**:站长本人的访问不计入;开启 MOCK 后放行埋点,按该 mock cid 写入数据库
(见 `apps/next-home/src/app/api/track/route.ts` 与 `docs/STATS.md`)。

**每个 mock 身份 = 一台独立设备**:除身份(`zx_mock` 覆盖 `zx_cid`)外,**昵称与主题**
也按身份分键(`zx_nick.<id>` / `zx-theme.<id>`,见 `packages/shared/src/ui/identity.ts`),
切 A/B/C 时各自独立、互不影响;昵称默认留空,填后各自记住。首帧主题由
`themeInitScript(..., mockId)` 注入。普通访客无 `zx_mock`,始终用无后缀键。

## 隐私:以下文件不入库(部署需单独提供)

- `packages/shared/src/content.local.ts`(真实资料;有 `content.local.example.ts` 占位)
- `apps/next-home/public/resume.pdf`、`public/wechat.png`
- `apps/next-home/resume/resume.md|html|pdf`(仅 `resume.py`/`resume.css` 入库)

## Git 规范

- 原子提交,Conventional Commits,**中文 subject**(如 `feat(admin): ...`)
- 小改动先攒着,发版时统一打 tag
- 只有明确要求才提交 / 推送

## 环境变量

`DB_PATH`(唯一库)/ `ADMIN_PASSWORD` / `SESSION_SECRET` / `REPORT_TOKEN`,
见各 `.env.example`。默认值可跑 demo,**上线前务必修改**。

## Next.js 版本

本仓库的 Next.js 与训练数据可能不同,写代码前先读 `apps/next-home/AGENTS.md` 指向的
`node_modules/next/dist/docs/`。注意 `apps/next-home/AGENTS.md` 为 `next dev` 自动生成/维护。
