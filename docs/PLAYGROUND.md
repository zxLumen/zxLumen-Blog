# 访客沙盒(code-sandbox.${DOMAIN})

给访客一个**公开可玩**的 opencode 沙盒:匿名即可进来写代码、对话、安装依赖、
联网检索,所有操作都在一个共享的 `/workspace` 目录里,看不到目录外任何东西。

- 入口:应用栏「代码沙盒」(`openIn: newtab`),子域 `code-sandbox.${DOMAIN}`。
- **进站即落在唯一一条固定会话里**(`PLAYGROUND_SESSION_ID`,默认 `ses_guest`):
  主页被隐藏、不能选会话、不能建会话/加项目/改设置,也没有任何"离开"入口;
  写入只放行这条会话下的对话操作(见「访客锁定」)。
- 无密码开放;预算由**网关令牌的每日 token 上限 + 固定便宜模型**兜底(见
  `docs/AI-GATEWAY.md`);安全由**容器隔离**兜底。
- 与私有的 `pocket.${DOMAIN}`(你 Mac 上的 opencode,Basic 认证)互不相干。

## 架构

```
访客浏览器
   │ https://code-sandbox.${DOMAIN}
   │   Caddy「code-sandbox」段:① 文档请求只放固定会话,其余 302 跳回;
   │   ② 写入白名单(仅该会话下的对话操作);③ 封禁 pty/shell/tui;④ SSE 关缓冲
   ▼
Caddy ── play 内网 ──► opencode-play 容器(opencode web :4096)
                         ▲
   opencode-play-init ───┘  (一次性:就绪后确保固定会话存在;卷清空时自动补建)
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
| 种子 | `docker/opencode-play/seed/{AGENTS.md,README.md}` 烤进镜像:`AGENTS.md` 每次
  覆盖到 `~/.config/opencode/`(全局人设),并在 `/workspace/AGENTS.md` 缺失时补一份;
  `README.md` 仅在 `/workspace/README.md` 缺失时播种(都不覆盖访客内容)。 |
| 锁定 | 访客侧由 Caddy 的「code-sandbox」段实现(重定向 + 写入白名单 + 自建外壳),
  见下「访客锁定」。固定会话 id 由 `docker/.env` 的 `PLAYGROUND_SESSION_ID` 指定。 |
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

## 访客锁定(唯一会话,`docker/Caddyfile` 的 code-sandbox 段)

目标:**访客进站直接就在唯一一条会话内部,看不到主页,不能选/建会话、加项目、
改设置,也出不去。** 都做在 Caddy 层(配置里没有对应开关):

1. **文档请求只认固定会话**:`Accept: text/html` 的请求,路径是
   `/global/session/<PLAYGROUND_SESSION_ID>` 才返回**自建外壳**;其它一律
   `302` 跳回该路径(`/` 永远看不到主页)。
2. **自建外壳**(Caddyfile 内联 heredoc):`fetch('/__shell')` 取回二进制里的
   真 `index.html`(资源是绝对路径,**不硬编码哈希**,换 opencode 版本不坏),
   注入 `<style>header{display:none}</style>` 与守卫脚本后再 `document.write`。
   守卫:隐藏整条 `<header>`(桌面/手机的 logo、会话 tab、新建 `+` 全在其中);
   若侧栏/弹层冒出来(文案含 Add project/Settings/New session)一并隐藏;路由守卫
   在被切回 `/`、`/global` 时立即跳回会话;拦截 `Cmd/Ctrl+K/N/,/P` 快捷键。
   手机端右侧 `Session | Changes` 面板**保留**(它不是离站入口)。
3. **写入白名单**:非 `GET/HEAD/OPTIONS` 只放行 `/session/<固定 id>/…` 下的子路径
   (即对话:`prompt_async` / `abort` / `permissions/{id}` 等),其余一律 `403`
   —— 建会话 `POST /session`、改配置 `PATCH /config`、加项目 `POST /project/*`、
   BFF `POST /api/session` 全被挡。
4. **全阶段封禁**:`^/(api/)?(pty|shell|tui)(/|$)` 与
   `^/session/<id>/(shell|fork)(/|$)`(含 GET)一律 `403`。

> Caddy 标准镜像**没有**正文替换模块(只有 `subroute`/`templates`),而
> `ci-run.sh` 只同步 `Caddyfile`/`docker-compose.yml` 等少数文件、**不同步**
> `docker/opencode-play/`,所以外壳 HTML 只能内联在 Caddyfile 的 heredoc 里。
> 改 Caddyfile 后本地需 `caddy validate`;`docker compose up -d` 不会因挂载文件
> 变化而重启 caddy,deploy.sh 末尾会 `caddy reload`。

## 上线前准备(一次性)

1. admin「AI 密钥」页为沙盒签发专用令牌:**每日上限 + 固定便宜模型**;
   把令牌填进服务器 `docker/.env` 的 `PLAYGROUND_AI_TOKEN`;并设
   `PLAYGROUND_SESSION_ID`(默认 `ses_guest`)——Caddy 与 init 容器都读它。
   **它不在 CI 同步范围内,必须手动改服务器那份 `docker/.env`。**
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
  或只清 `/workspace` 内容。**会话卷被清掉后,下次 `up -d` 时
  `opencode-play-init` 会自动补建固定会话**(`GET /session/<id>` 404 →
  `POST /api/session` 建、`PATCH` 设标题)。想手动补:
  `docker compose up -d --force-recreate opencode-play-init` 看日志。
- **改固定会话 id**:改服务器 `docker/.env` 的 `PLAYGROUND_SESSION_ID` 后
  `docker compose up -d`(再 `caddy reload` 让新值生效),init 会建新会话;
  旧会话可经容器直接 `DELETE /session/<旧 id>` 清掉。
- **改权限/模型**:改 `docker/opencode-play/*`,重建镜像生效(配置烤进镜像)。
- **看消耗**:admin「AI 密钥」页看该令牌的用量/上限;429 即当日预算耗尽,
  沙盒对话会失败直到重置。
- **私有 pocket 不可从沙盒访问**:两套容器/网络完全分开。

## 已知取舍

- 匿名 + 共用同一条会话 = 有人会拿它当免费推理/安装资源;靠网关每日上限 + 资源限额控制。
- **全体访客共用一条会话**:互相看得到彼此的对话,上下文会持续增长(长会话更费
  token、更慢);这是"公共白板"模式的延伸,刻意的取舍。
- 访客共享目录:互相能看到文件(可留纸条、可互相删).这是刻意的"公共白板"模式。
- 镜像体积 / 冷启动:官方镜像较大,首次 pull 稍慢。