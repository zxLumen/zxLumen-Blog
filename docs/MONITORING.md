# 监控(可观测性)手册

单环境下的可观测性方案:**本地轻量采集 → Grafana Cloud(托管)**,错误追踪用 **Sentry(EU)**。
目标:在不挤占 2GB VPS 内存的前提下,提供主机/容器指标、应用指标、容器日志、外部可用性探测与告警。

## 架构

```
VPS(仅出站;UFW 仍只有 22/80/443)
├─ node-exporter   主机指标(CPU/内存/磁盘/网络)
├─ cadvisor        容器指标(需 v0.54+;按容器 name/service)
├─ alloy           抓取上述 + app /api/metrics,采集 app/caddy 日志
│                     │ remote_write(metrics)/ push(logs)
│                     ▼
└─ app(Next)      Grafana Cloud(Singapore,免费层)
   ├ /api/health     ├ Mimir(指标)→ Grafana 面板
   └ /api/metrics    ├ Loki(日志)
                     ├ Alerting → 邮件
                     └ Synthetic Monitoring(外部探测)
Sentry(EU):前端/SSR/服务端错误追踪
```

- 采集组件在 docker `monitoring` **profile** 下,**默认不启动**;仅容器内网互通,不发布端口到公网。
- Grafana Cloud 免费层:指标 ~10k active series、日志 ~50GB/月、14 天保留;含告警邮件与合成探测。
- 本地新增内存 ≈ 120–250MB。

## 一、Grafana Cloud(一次性)
1. 注册 <https://grafana.com/auth/sign-up/create-user>,建 stack 时选 **Singapore**。
2. 取写入凭据(Connections / 或 Stack → Prometheus/Loki → Details):
   - 指标:`URL`(…`/api/prom/push`)、`User`(数字实例 ID)、`Token`
   - 日志:`URL`(…`/loki/api/v1/push`)、`User`(Loki 实例 ID)、`Token`
   - 同一个 `glc_…` token 通常同时具备 metrics/logs 写权限。
3. **Synthetic Monitoring**:建 API check `https://<域名>` 与 `https://<域名>/api/health`(外部探测,整机宕机兜底)。
4. **Alerting → Contact points**:确认 `email` 可用;在 Rules 配置告警(建议见下)。

## 二、服务器启用

### 1) 填 `.env`(不入库)
在 `docker/.env` 追加:
```
METRICS_TOKEN=<随机长串,openssl rand -hex 24>
GRAFANA_METRICS_URL=...
GRAFANA_METRICS_USER=...
GRAFANA_METRICS_TOKEN=glc_...
GRAFANA_LOGS_URL=...
GRAFANA_LOGS_USER=...
GRAFANA_LOGS_TOKEN=glc_...
SENTRY_DSN=            # 可选
```

### 2) 上传监控相关文件
`docker/docker-compose.yml` 与 `docker/observability/`(`alloy.alloy` + Grafana provisioning/面板)由服务器
`ci-run.sh` 在**每次 CI 部署前自动从公开仓库 `git fetch` 同步**,无需手动 `scp`。
仅当不走 CI 时才需手动上传:
```bash
scp docker/docker-compose.yml zx@SERVER:~/zxLumen-Blog/docker/
scp -r docker/observability    zx@SERVER:~/zxLumen-Blog/docker/
```

### 3) 启动(不影响主站)
```bash
ssh zx@SERVER 'cd ~/zxLumen-Blog/docker && docker compose --profile monitoring up -d'
# 查看:
ssh zx@SERVER 'cd ~/zxLumen-Blog/docker && docker compose --profile monitoring ps'
ssh zx@SERVER 'docker logs --tail 50 docker-alloy-1'
```
> 普通 `docker compose up -d`(CI 部署)不会启动监控,因为它们在 `monitoring` profile 下。

### 4) 校验
```bash
# 主机网络内 /api/metrics 需 token
ssh zx@SERVER 'docker exec docker-alloy-1 wget -qO- --header="X-Metrics-Token: $METRICS_TOKEN" http://app:3000/api/metrics | head'
# 公网 /api/health 应 200;/api/metrics 应被 Caddy 404
curl -s -o /dev/null -w '%{http_code}\n' https://<域名>/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://<域名>/api/metrics   # 期望 404
```
Grafana Cloud → Explore / Metrics / Logs 应能看到数据。

## 本地 Grafana(`grafana.<域名>`)
在服务器上跑一个 Grafana(monitoring profile),**数据源指向 Grafana Cloud 的查询接口**(只读,不落地数据),自动导入 Node Exporter Full / cAdvisor 面板。日常看指标/日志就用自有域名,存储与告警仍在 Grafana Cloud。

前提与步骤:
1. **DNS**:加一条 A 记录 `grafana` → 服务器 IP(Caddy 自动签证书)。
2. **只读 token**:Grafana Cloud → Access Policies → `metrics:read` + `logs:read`;填入 `.env` 的 `GRAFANA_READ_TOKEN`。
3. **入口口令**:`.env` 里
   - `GRAFANA_ADMIN_PASSWORD`(Grafana 内 admin 登录)
   - `GRAFANA_BASIC_HASH`(Caddy basic_auth 的 bcrypt;用 `docker exec docker-caddy-1 caddy hash-password --plaintext '你的密码'` 生成)。
     ⚠️ bcrypt 含 `$`,在 `.env` 中**必须用单引号**包裹(`GRAFANA_BASIC_HASH='$2a$14$…'`),否则 Compose 会把它当变量插值而损坏。
4. 启动:`docker compose --profile monitoring up -d`。
5. 访问 `https://grafana.<域名>`(先过 basic_auth,再用 admin 登录)。

面板/数据源升级或排错:数据源见 `docker/observability/grafana/provisioning/datasources/cloud.yml`;面板 JSON 在 `docker/observability/grafana/dashboards/`(随容器热加载)。

## 三、应用端点- `GET /api/health`:进程 + 数据库可读 → 200/503(公开,给合成探测)。
- `GET /api/metrics`:Prometheus 文本;**需 `X-Metrics-Token`**(或 `?token=`),否则 403;
  Caddy 另对公网 `/api/metrics*` 返回 404(纵深防御)。
  暴露:进程(rss/heap/uptime)、`zx_app_errors_total{route}`(来自 `onRequestError`)、业务 gauges(`zx_visits_*` / `zx_comments_*` / `zx_project_clicks` / `zx_resume_downloads`)。

## 四、Sentry(EU)
1. 建组织时选 **EU**,项目平台选 **Next.js**。
2. 取 **DSN**(Settings → Client Keys)。
3. 服务器 `.env` 填 `SENTRY_DSN=(…)`(服务端/SSR 生效)。
   前端上报需构建期注入 `NEXT_PUBLIC_SENTRY_DSN`(可选;否则仅服务端上报)。
4. CI 上传 source map:GitHub → Settings → Secrets → Actions 增加 `SENTRY_AUTH_TOKEN`
   (scope `project:releases`、`org:read`、`project:read`);`SENTRY_ORG`/`SENTRY_PROJECT` 可选。
5. 隐私:v11 用 `dataCollection` 关闭 `userInfo`/`cookies`/请求体,并对敏感头脱敏;客户端事件经 `tunnelRoute:/monitoring` 走自身域名。

## 五、建议告警规则(Grafana Cloud → Alerting)
- 站点 Down(合成探测失败)
- 5xx 比例升高 / P95 延迟
- 磁盘使用 > 85%、内存 > 90%
- 容器反复重启
- 证书剩余 < 14 天
全部通知到 **邮件**。

## 六、资源 / 安全
- `cadvisor` 需 `privileged` + 宿主挂载;**必须用 v0.54+**(如 `ghcr.io/google/cadvisor:v0.60.6`):
  Docker 29 默认启用 **containerd 镜像存储(snapshotter)**,旧版(v0.49.x)会 `failed to identify the read-write layer ID` → 容器指标全空。新镜像发布在 `ghcr.io/google/cadvisor`(不再是 `gcr.io/cadvisor/cadvisor`)。
- **容器指标**:由 `alloy` 侧白名单保留(CPU / 内存 working_set·usage·rss·cache / 网络 / 启动时间 / OOM / 磁盘读写与用量),
  **保留 `name`(容器名)与 `service`(compose 服务)** 标签,去掉 `id` / `image` 与全部 `container_label_*`(降基数)。
  可按容器名 / 服务筛选;开源版 cAdvisor 面板(uid `pMEd7m0Mz`)依赖 `name` 标签。
- **容器日志**:`loki.source.docker` 采集**全部容器**的 stdout/stderr(不再只限 app/caddy)。
  注意:容器日志只看 **stdout**;`mailserver`(poste.io)几乎不写 stdout(24h 0 行),其真正邮件日志在容器内
  `data/log/*.log`,如需采集要另行处理(非本方案默认)。
- `alloy` 挂 `docker.sock:ro`(读取容器日志),不发布端口。
- `.env` 含机密:`chmod 600`,不入库、不进 CI。

## 七、排障 / 回滚
- Alloy 配置错误:`docker logs docker-alloy-1`。
- cAdvisor 无数据:
  - 确认 `--profile monitoring` 已启动;
  - 确认镜像是 **v0.54+**(Docker 29 containerd-snapshotter 兼容);
  - `docker exec docker-cadvisor-1 wget -qO- http://localhost:8080/metrics | grep -c 'name="'` 应 > 0;
  - 若仍为 0,尝试去掉 `--docker_only=true` 再 `up -d cadvisor`。
- 指标基数超限:Grafana Cloud 会限流;检查是否有高基数标签(勿把容器 id、完整 URL 作标签)。
- **回滚/停用**:`docker compose --profile monitoring down`(主站不受影响)。
- 轮换 token:Grafana Cloud → Access Policies 新建 → 更新 `.env` → 重启 `app` 与 `alloy`。
