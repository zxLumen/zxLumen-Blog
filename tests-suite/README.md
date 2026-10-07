# tests-suite

zxLumen-Blog 的测试套件(方案见 `docs/TESTING.md`)。**与 `apps/`、`packages/` 平级,不污染业务代码,也不进生产镜像**
(Dockerfile 只 `COPY packages/shared` 与 `apps/next-home`)。

## 目录

```
tests-suite/
  data/       数据层测试(L1,node --test,内存库 :memory:)   ✅ 已落地
  api/        接口契约 + 集成点(L2,Vitest + 临时库起服务)   ✅ 已落地
  e2e/        端到端测试(L3,Playwright + 临时库起服务)      ✅ 已落地
  load/       k6 压测场景 S0–S8 + 本地编排 runner          ✅ 已落地
  smoke/      线上**只读**冒烟(main + 子域 + TLS)          ✅ 已落地
  helpers/    夹具(内存库等)
```

## 运行

```bash
# 只需 Node 20+(推荐 22);数据层测试依赖 packages/shared 的编译产物
npm run test:data      # 先 build shared,再跑 tests-suite/data
npm run test:api       # 起 next start(临时库 :3199)+ 跑 tests-suite/api(Vitest)
npm run test:e2e       # build 应用 + Playwright 拉起服务(临时库 :3198)+ 跑 tests-suite/e2e
npm run test:unit      # 跑 packages/shared 既有单元测试
npm test               # 数据层 + 单元(接口/E2E 需起服务,单独跑)

# 压测(仅本地;需 k6:brew install k6)—— 编排器自动起临时库服务
npm run test:load -- quick          # S0 最小冒烟(几秒)
npm run test:load -- steady-read    # S1 稳态读
npm run test:load -- rate-limit     # S8 限流正确性
node tests-suite/load/run.mjs --list

# 线上只读冒烟(仅 GET,不写、不压测)
SMOKE_DOMAIN=zxlumen.cn npm run test:smoke
```

> 线上冒烟另有定时任务 `.github/workflows/smoke.yml`(每 6 小时 + 手动),域名取仓库变量
> `SMOKE_DOMAIN`(缺省 `zxlumen.cn`)。

> `test:api` / `test:e2e` / `test:load` 都用**临时库**启动生产构建,跑完自动关闭,
> **不会碰 `apps/next-home/data/zx.db`**。E2E 浏览器:Playwright 1.63 需 chromium-1243
> (缺失时 `npx playwright install chromium`)。

## 约定

- 数据层测试一律 `openDb(':memory:')`(见 `helpers/memdb.mjs`),用例之间互不共享、无落盘。
- 断言只看**公开接口**(`Db` 的方法),不直接查原始 SQLite,避免与实现细节耦合。
- 外部依赖(LLM / 邮件 / 用量平台)后续在 L2/L5 用 stub server 替代,绝不真实调用。

## 里程碑(见 `docs/TESTING.md` §15.3)

1. **M1 数据层(L1)** ✅
2. **M2 E2E(L3)** ✅(Playwright):首页/健康/404、`/lab/*` 重定向、admin 登录(失败/成功)、发表留言
3. **M3 接口契约(L2)** ✅(Vitest):健康/可观测、管理员鉴权、留言、埋点、集成点(luminari 代理、AI 网关鉴权)
4. **M4 压测(L6)** ✅(k6):S0 quick / S1 稳态读 / S2 突刺 / S3 写并发 / S4 聊天 / S5 网关 / S6 Soak / S7 静态 / S8 限流
5. **M5 CI 门禁** ✅:`.github/workflows/test.yml`(lint → 单测 → 构建 → 接口 → E2E → 压测冒烟);
   `deploy.yml` 通过 `uses` 复用,测试不过不部署
6. **M6 线上只读冒烟 + 集成** ✅:`tests-suite/smoke/online-smoke.mjs`(main/health/metrics 404/TLS/子域)

> 依赖(Playwright / Vitest)在对应里程碑按需加入**根 `package.json` 的 devDependencies**;
> k6 用系统包管理器安装(非 npm)。生产镜像不含它们(`.dockerignore` 已排除 `tests-suite`)。
