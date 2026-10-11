# 访客沙盒（已迁出本仓库）

公开访客沙盒 `code-sandbox.<DOMAIN>`（一个公开可玩的 opencode web）的实现**已整体迁移到
[`Opencode-Pocket`](https://github.com/zxLumen/Opencode-Pocket) 仓库**，与博客仓库解耦。

- **真相来源 / 完整文档**：[`Opencode-Pocket/docs/vps-sandbox.md`](https://github.com/zxLumen/Opencode-Pocket/blob/main/docs/vps-sandbox.md)
  （架构、访客锁定、隔离边界、构建与部署、运维）。
- **源码 / CI / 部署**：`Opencode-Pocket` 的 `infra/vps/sandbox/`（Dockerfile、compose、
  边缘 Caddy、`deploy.sh` / `ci-run.sh` / `auto-deploy.sh`）与 `.github/workflows/sandbox.yml`。
- **镜像**：`ghcr.io/zxlumen/opencode-pocket-sandbox:<sha>/latest`，由 `Opencode-Pocket` 的 CI 构建推送；
  服务器用 cron 轮询该仓库 `main` 的 SHA 自动部署。

## 本仓库（zxLumen-Blog）还负责什么

博客侧只剩「入口 stub」这一处（**不要再往这里加沙盒逻辑**）：

- `docker/Caddyfile` 的 `code-sandbox.{$DOMAIN}` 段：只做 TLS + `reverse_proxy sandbox-caddy:80`
  （3 行转发；锁定的全部逻辑在沙盒自带的边缘 Caddy 里）。
- 两处刻意保留的共享资源：网络 `docker_play`（`app` AI 网关 + `caddy` 都挂在上面）与卷
  `docker_playground-data` / `docker_playground-home`（沙盒栈以 `external` 引用，数据不随博客部署清掉）。

## 迁移前记录

迁移前的实现（`docker/opencode-play/`、compose 里的 `opencode-play` / `opencode-play-init`
服务、`docker/deploy.sh` 的拉取行、`.github/workflows/deploy.yml` 的构建步骤）已移除；
历史可查本仓库 git 记录。
