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

## 工作流:本地开发 → 打包 → 部署线上(单人单环境)

线上**只有一个生产环境**(`NODE_ENV=production`)。所有试验都在**本地**完成,线上不做试验。

站内有 **LIVE(正常)/ TEST(测试)** 两种视图(右上角仅站长可见的切换器),但**TEST 仅本地可用**:

- **TEST** 使用独立测试库(`DB_TEST_PATH`),放行**全部**主题/布局/功能;
  `settings/deepseek/opencode/usage/comments` 等**全部数据都读写测试库**。
- **LIVE** 使用线上库(`DB_PATH`),**只放行白名单**内的内容。
- **生产环境禁用 TEST**:`NODE_ENV=production` 时 `isTestMode()` 恒为 false,`EnvSwitch`
  不渲染,`POST /api/env` 返回 403。确需在生产临时开通(不推荐)才设 `ALLOW_TEST_MODE=1`。
  > 本地要测 TEST 模式请用 `npm run dev`(development);`next build && next start` 会以
  > production 运行、同样禁用 TEST。

规则:

1. 新功能 / 改动在**本地 TEST 模式**自测(测试库,与线上完全隔离)。
2. 验证通过后,把改动并入主线 → **打包** → 部署到线上。
3. 需要"只在 TEST 存在"的功能:不要加进 `LIVE_FEATURES`;正式放行/回退 = 增删
   `LIVE_FEATURES` 里的 id,提交 `feat(...): 同步 <特性> 到正常模式`。

### 白名单门控(与主题/布局同款)

| 维度 | 全部集合 | 正式放行集 | 位置 |
|---|---|---|---|
| 主题 | `THEME_IDS` | `LIVE_THEME_IDS` | `packages/shared/src/theme.ts` |
| 布局 | `LAYOUT_IDS` | `LIVE_LAYOUT_IDS` | `packages/shared/src/theme.ts` |
| 功能 | `FEATURE_IDS` | `LIVE_FEATURES` | `packages/shared/src/features.ts` |

模式判定:

- 服务端:`isTestMode()`;功能门控用 `featureOn(id)`
  (`apps/next-home/src/lib/env.ts`)。**所有需要隔离的数据读写统一走 `getActiveDb()`**。
- 客户端:白名单随服务端下发 —— `layout.tsx` 计算 `allowedFeatures`
  (`testMode ? [...FEATURE_IDS] : LIVE_FEATURES`)→ `AppShell` → `Shell` →
  `PreferencesProvider`;组件内用 **`useFeature(id)`** 判断

### 新增一个 TEST-only 功能

1. 在 `packages/shared/src/features.ts` 的 `FEATURE_IDS` 注册 id(如 `'foo'`)
2. 客户端:`const on = useFeature('foo')`,按 `on` 渲染
   (需要服务端/接口层拦截时:在路由里 `await featureOn('foo')`)
3. `cd packages/shared && npm run build`
4. 在本地 TEST 模式验证;`npm run lint && npm run build`
5. **同步**:把 `'foo'` 加进 `LIVE_FEATURES`,提交 `feat(...): 同步 foo 到正常模式`

> `GET /api/env` 返回 `{ test, available }`,也可用于简单的模式判断;但组件内优先用 `useFeature`。

### 在 TEST 模式模拟多个访客
右上角 `MOCK` 切换器(仅测试模式)可设定访客匿名 ID(`zx_mock`),以不同用户视角浏览/留言,
用于验证"私密仅本人与站长可见""访客删除自己的留言"等。模拟时该请求按普通访客处理
(不享受站长特权);`恢复本人` 清除。也可直接调 `POST /api/admin/mock` `{ cid }`。

## 隐私:以下文件不入库(部署需单独提供)

- `packages/shared/src/content.local.ts`(真实资料;有 `content.local.example.ts` 占位)
- `apps/next-home/public/resume.pdf`、`public/wechat.png`
- `apps/next-home/resume/resume.md|html|pdf`(仅 `resume.py`/`resume.css` 入库)

## Git 规范

- 原子提交,Conventional Commits,**中文 subject**(如 `feat(admin): ...`)
- 小改动先攒着,发版时统一打 tag
- 只有明确要求才提交 / 推送

## 环境变量

`DB_PATH`(线上库)/ `DB_TEST_PATH`(测试库,仅本地)/ `ADMIN_PASSWORD` / `SESSION_SECRET` /
`REPORT_TOKEN` / `ALLOW_TEST_MODE`(生产临时开启 TEST,默认关),
见各 `.env.example`。默认值可跑 demo,**上线前务必修改**。

## Next.js 版本

本仓库的 Next.js 与训练数据可能不同,写代码前先读 `apps/next-home/AGENTS.md` 指向的
`node_modules/next/dist/docs/`。注意 `apps/next-home/AGENTS.md` 为 `next dev` 自动生成/维护。
