# Graphite 试点 · 主站 + StockApp

> 基调文档：`docs/design/DESIGN-SYSTEM.md`
> 试点状态：已部署到独立预发，生产未改动。
> 2026-11-14 调整：按老板反馈改为**浅色**（纯黑底太暗），并恢复**四周生灵层**与 Hero **视频展览模块**；桌面端生灵可见，移动端仍按 <820px 既有规则不渲染。

## 访问

| 端 | 预发（试点） | 生产（对照） |
|---|---|---|
| 主站 | https://pilot.zxlumen.cn/ | https://zxlumen.cn/ |
| StockApp | https://pilot-stock.zxlumen.cn/ | https://stock.zxlumen.cn/ |

预发是独立容器 + 独立数据副本，DNS 为 `pilot` / `pilot-stock`，Caddy 单独 site 文件；不参与生产 compose 的滚动更新。

## 截图

| 页面 | 改动前 | 改动后（2026-11-14 浅色版） |
|---|---|---|
| 主站 · 桌面 | `before-home-desktop.png` | `after-home-desktop.png` |
| 主站 · Hero（生灵 + 视频） | — | `after-home-hero.png` |
| 主站 · 项目区 | `before-home-projects.png` | `after-home-projects.png` |
| 主站 · 手机 | `before-home-mobile.png` | `after-home-mobile.png` |
| Stock · 桌面 | `before-stock-desktop.png` | `after-stock-desktop.png` |
| Stock · 手机 | `before-stock-mobile.png` | `after-stock-mobile.png` |

## 试点范围

- 主站：新增 `graphite` 主题（`packages/shared/src/theme.ts`），样式在 `packages/shared/src/pilot.css`；覆盖顶栏、Hero、区块头、项目卡片、用量面板、表格、表单、页脚、右侧应用栏；`graphite` 默认收起装饰性生灵层，保证内容优先。
- StockApp：`StockApp/web/src/pilot.css`，规则全部挂在 `html[data-pilot='1']` 下；构建参数 `VITE_PILOT=1` 才启用，生产构建视觉零变化。
- 不改：业务逻辑、数据口径、admin、SSO、行情/AI 网关。
- 预发库：`graphite` 为默认主题、`classic` 为默认布局；2026-11-14 起重新启用 vlog（从本地库同步 `vlog_config`），Hero 视频展览模块可见；已移除密钥/会话/私聊等敏感 meta，禁用 chatbot。

## 预发实现

- 容器：`pilot-home`（`zx-home:pilot-20261114`，2026-11-14 浅色版）、`pilot-stock`（`stock-web:pilot-20261112`），均在 `docker_web` 网络。
- 数据：`/home/ubuntu/design-pilot/home-data`（生产 DB 副本，已脱敏）、`home-site`（站点内容副本）、`stock-data`（Stock 数据副本，已移除 keys/owner.token）。
- 路由：`/home/ubuntu/zxLumen-Blog/docker/caddy/sites/pilot.caddy`、`pilot-stock.caddy`；Caddy reload 生效。
  - 2026-11-14 注意：Caddy 的 `/etc/caddy/sites` 是**只读挂载**，且容器内可能仍是旧目录 inode，直接 reload `/etc/caddy/Caddyfile` 看不到新补的 pilot 文件。本次用 `/tmp/caddy/Caddyfile`（`import /tmp/caddy/sites/*.caddy`）热加载；重启 Caddy 后会按常规挂载重新读到宿主文件。
- 代码：主站 `graphite` 主题 + `pilot.css`；Stock `pilot.css` + `VITE_PILOT` 构建开关。均为未提交改动，生产镜像未重建。

### 重建预发镜像

```bash
# 主站（本机 Turbopack 构建会 SIGSEGV，预发用 webpack；自定义 Dockerfile 在 design-pilot/）
docker build -f /home/ubuntu/design-pilot/Dockerfile.home \
  -t zx-home:pilot-20261114 /home/ubuntu/Projects/zxLumen-Blog

# StockApp（只有带 VITE_PILOT=1 的镜像才启用试点样式）
docker build -f web/Dockerfile --build-arg VITE_PILOT=1 \
  -t stock-web:pilot-20261112 /home/ubuntu/Projects/StockApp
```

> `apps/next-home/next.config.ts` 增加了 webpack 的 `better-sqlite3` external：
> 预发镜像用 webpack 构建时，原生 `.node` 才不会被打进 chunk。生产 Dockerfile 仍走 Turbopack，
> 不受这个分支影响。

## 回滚

1. 停预发容器：`docker rm -f pilot-home pilot-stock`
2. 删 Caddy 路由：`sudo rm /home/ubuntu/zxLumen-Blog/docker/caddy/sites/pilot.caddy /home/ubuntu/zxLumen-Blog/docker/caddy/sites/pilot-stock.caddy && docker exec docker-caddy-1 caddy reload --config /etc/caddy/Caddyfile`
   - 预发库改动：`vlog_config` 从本地库同步（用于恢复视频模块）；回滚用 `sudo cp /home/ubuntu/design-pilot/home-data/zx.db.bak-20261114 /home/ubuntu/design-pilot/home-data/zx.db`（先停 `pilot-home`）。
3. 删 DNS（可选）：DNSPod 删除 `pilot`、`pilot-stock` 两条 A 记录（TTL 600）。
4. 代码回滚（如需要）：只回退本次文件，不要动 `apps/next-home/src/lib/app-config.ts` 等既有未提交改动：
   - 主站：`packages/shared/src/theme.ts`、`packages/shared/src/pilot.css`、`apps/next-home/src/app/luminari-floats.css`、`packages/shared/package.json`、`apps/next-home/src/app/layout.tsx`、`apps/next-home/next.config.ts`
   - Stock：`StockApp/web/src/pilot.css`、`StockApp/web/src/main.tsx`、`StockApp/web/Dockerfile`
5. 生产无需操作（`zxlumen.cn` / `stock.zxlumen.cn` 未重建、未切流）。

## 验收记录

- 预发主站/Stock：HTTP 200；主站 HTML 含 `graphite`、`zx-vlog`；Stock `document.documentElement.dataset.pilot === '1'`。
- 浅色版实测：`data-mode=light`、`--bg=#FAFAF9`、`--accent=#4F6BED`；桌面端 `.cf-layer` 渲染 5 只生灵且 `display:block`；移动端生灵按 <820px 既有规则不渲染。
- 生产主站/Stock：HTTP 200，主题/标记与改动前一致（未部署）。
- 桌面 1440×1000 + 手机 390×844 截图见上表；Hero 单独截图 `after-home-hero.png`。
