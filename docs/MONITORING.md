# 监控(可观测性)手册

单环境下的可观测性方案:**本地轻量采集 → Grafana Cloud(托管)**,错误追踪用 **Sentry(EU)**。
目标:在不挤占 2GB VPS 内存的前提下,提供主机/容器指标、应用指标、容器日志、外部可用性探测与告警。

## 架构

```
VPS(仅出站;UFW 仍只有 22/80/443)
├─ node-exporter   主机指标(CPU/内存/磁盘/网络)
├─ cadvisor        容器指标(已筛选)
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

### 2) 上传监控相关文件(这些不入库/不经 CI)
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

## 三、应用端点
- `GET /api/health`:进程 + 数据库可读 → 200/503(公开,给合成探测)。
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
- `cadvisor` 需 `privileged` + 宿主挂载;已用 `--disable_metrics` 与 relabel 限制指标基数(去掉容器 id/镜像标签)。
- `alloy` 挂 `docker.sock:ro`(读取容器日志),不发布端口。
- `.env` 含机密:`chmod 600`,不入库、不进 CI。

## 七、排障 / 回滚
- Alloy 配置错误:`docker logs docker-alloy-1`。
- cAdvisor 无数据:确认 `privileged` 与挂载;确认 `--profile monitoring` 已启动。
- 指标基数超限:Grafana Cloud 会限流;检查是否有高基数标签(勿把容器 id、完整 URL 作标签)。
- **回滚/停用**:`docker compose --profile monitoring down`(主站不受影响)。
- 轮换 token:Grafana Cloud → Access Policies 新建 → 更新 `.env` → 重启 `app` 与 `alloy`。
