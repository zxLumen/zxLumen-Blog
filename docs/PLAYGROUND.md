# 访客沙盒(code-sandbox.${DOMAIN})

给访客一个**公开可玩**的 opencode 沙盒:匿名即可进来写代码、对话、安装依赖、
联网检索,所有操作都在一个共享的 `/workspace` 目录里,看不到目录外任何东西。

- 入口:应用栏「代码沙盒」(`openIn: newtab`),子域 `code-sandbox.${DOMAIN}`。
- 无密码开放;预算由**网关令牌的每日 token 上限 + 固定便宜模型**兜底(见
  `docs/AI-GATEWAY.md`);安全由**容器隔离**兜底。
- 与私有的 `pocket.${DOMAIN}`(你 Mac 上的 opencode,Basic 认证)互不相干。

## 架构

```
访客浏览器
   │ https://code-sandbox.${DOMAIN}   (Caddy:code-sandbox 段,flush_interval -1 放行 SSE)
   ▼
Caddy ── play 内网 ──► opencode-play 容器(opencode web :4096)
                         │ 只接 play 网络(web 网络上其它子应用一律不可达)
                         │
                         ├─ /workspace        ← named volume,访客共享目录(可写)
                         ├─ /home/opencode    ← named volume(会话/状态)
                         ├─ /tmp              ← tmpfs
                         └─ ZX_AI_APP_TOKEN → app:3000/api/ai/v1(博客 AI 网关)
                                                (app 也接 play 网络;仅此一个入口)
```

| 组件 | 说明 |
| --- | --- |
| 镜像 | `ghcr.io/zxlumen/opencode-play:<sha>/latest`,基于官方
  `ghcr.io/anomalyco/opencode:1.19.0`,由本仓库 CI 构建推送(见
  `.github/workflows/deploy.yml`);服务器只 pull。 |
| 配置 | `docker/opencode-play/opencode.json` 烤进镜像只读区,每次启动由
  `entrypoint.sh` 覆盖回家目录。访客改配置文件只会影响当次进程,重启即还原。 |
| 网络 | 独立 `play` bridge,只挂 `app`(AI 网关)+ `caddy`(反代)。不接 `web`,所以
  其它子应用(opentodo / yijing / stock / luminari / mbti / attune / grafana…)
  对沙盒**不可达**。 |
| 存储 | `playground-data`(/workspace,访客共享)、`playground-home`(会话/状态卷)。
  **两个卷都不在镜像里、不随部署清掉**;要清空沙盒内容需手动删卷。 |

## 隔离边界:容器,不是权限配置

`opencode.json` 里的 `permission`(bash 安装白名单、`external_directory: deny`)是
**软约束**——opencode 同意后才执行,但它是"自首式"的,理论上**拦不住绕过**。
真正的边界是**容器本身**:

- 非 root(uid 10001)、`read_only` 根文件系统、`cap_drop: [ALL]`、
  `no-new-privileges`、`init`(收僵尸进程)、mem/cpu/pids 限额;
- 只挂 `/workspace` 与家目录,宿主其它路径**不存在于容器视角**;
- 只连 `play` 内网,对外唯一能访问的是博客 AI 网关(令牌鉴权);
- 访客之间共享同一进程与目录:没有"每访客一个容器"的隔离,**互相可见**各处文件。

也就是说:**沙盒里的一切行为都出不了容器**;沙盒能看到的全部世界 = workspace +
家目录 + 网关。就算访客想办法拿到任意代码执行,也只在容器里。

## 权限策略(docker/opencode-play/opencode.json)

- **bash 默认全禁**;白名单只放行"装在当前目录"的安装命令:
  `npm install/i/ci *`、`pnpm install/add *`、`pip/pip3 install *`。
  且叠加拦截元字符(`&&` `;` `|` 反引号 `$()` 重定向)与全局安装(`-g`)。
  ⚠️ 这拦不住安装脚本的 postinstall 执行任意代码——**靠容器兜底**。
- `external_directory: deny`:不许读/写工作区之外的路径(软约束,见上)。
- webfetch / websearch 全放行(沙盒需要联网检索)。
- 模型固定指向博客 AI 网关(`zxgw/gateway-default`),由 admin「AI 密钥」页签发的
  令牌决定实际模型与每日预算。

## 上线前准备(一次性)

1. admin「AI 密钥」页为沙盒签发专用令牌:**每日上限 + 固定便宜模型**;
   把令牌填进服务器 `docker/.env` 的 `PLAYGROUND_AI_TOKEN`。
2. 应用栏:线上 `/admin` →「应用」面板加「代码沙盒」条目(或跑
   `npm run sync:apps` 同步本地默认表),图标 `/apps/code-sandbox.png`
   在面板上传(落盘 `docker/site-content/apps/`)。首次需保证该目录对容器内
   uid 10001 可写(同 vlog/apps,见 AGENTS.md「部署」)。
3. DNS:`code-sandbox.${DOMAIN}` 的 A 记录指向服务器。
4. 测试门禁全绿后可 push main 部署(CI 构建 opencode-play 镜像 → 服务器
   `docker compose pull opencode-play` → `up -d` → `caddy reload`)。

## 运维要点

- **清空沙盒**:删卷再重建(`docker compose rm -sf opencode-play` 后
  `docker volume rm docker_playground-data docker_playground-home`),
  或只清 `/workspace` 内容。
- **改权限/模型**:改 `docker/opencode-play/*`,重建镜像生效(配置烤进镜像)。
- **看消耗**:admin「AI 密钥」页看该令牌的用量/上限;429 即当日预算耗尽,
  沙盒对话会失败直到重置。
- **私有 pocket 不可从沙盒访问**:两套容器/网络完全分开。

## 已知取舍

- 匿名 + 无限会话 = 有人会拿它当免费推理/安装资源;靠网关每日上限 + 资源限额控制。
- 访客共享目录:互相能看到文件(可留纸条、可互相删).这是刻意的"公共白板"模式。
- 镜像体积 / 冷启动:官方镜像较大,首次 pull 稍慢。