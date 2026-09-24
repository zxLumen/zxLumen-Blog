# 部署手册(Docker + Caddy + GHCR,单 VPS)

目标:一台 VPS 上跑个人主页,自动 HTTPS,SQLite 持久化,可扩展挂其他项目 demo。
**服务器不构建镜像** —— 镜像由 GitHub Actions 构建推送到 GHCR,服务器只 `pull`。
**个人内容不进镜像** —— 运行时内容(`content.json`)与简历/二维码由文件挂载提供。

## 0. 前置

- 一台 VPS(推荐 2 vCPU / 2–4 GB / Ubuntu 22.04+)
- 一个域名(根域名给主页,子域名留给项目 demo)
- 一个 GitHub 仓库,**公开**(镜像随之公开,服务器才能匿名 `pull`)
- 本地已能 `npm run dev` 跑起来

## 1. 服务器初始化

```bash
scp docker/init-server.sh root@你的服务器IP:/root/
ssh root@你的服务器IP 'bash /root/init-server.sh'
```

> 采购 / DNS / 云控制台放行端口等前置步骤见 [`PROVISIONING.md`](./PROVISIONING.md)。

手动等价操作:

```bash
apt update && apt upgrade -y
timedatectl set-timezone Asia/Shanghai
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
curl -fsSL https://get.docker.com | sh
adduser zx && usermod -aG docker zx
apt install -y ufw fail2ban
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw allow 443/udp && ufw enable
```

## 2. DNS

添加 A 记录(`@` → 服务器 IP;`www` 可选)。等 `dig +short 你的域名` 生效。

## 3. 配置 GitHub Actions 部署(一次性)

CI(`.github/workflows/deploy.yml`)在 `main` 推送时:构建镜像 → 推 `ghcr.io/zxlumen/zx-home:<sha>` + `latest` → 设为公开 → SSH 上服务器跑 `deploy.sh`。

需要 4 个 GitHub Secrets(仓库 → Settings → Secrets and variables → Actions):

| Secret | 值 |
|---|---|
| `SERVER_HOST` | 服务器 IP(如 `124.156.168.32`) |
| `SERVER_USER` | 部署用户(如 `zx`) |
| `SERVER_PORT` | `22`(默认,可不设) |
| `SERVER_DEPLOY_KEY` | **专用部署密钥的私钥**(见下) |

生成专用部署密钥(私钥只放 GitHub,公钥放服务器,`command=` 只允许跑部署脚本):

```bash
# 本地生成
ssh-keygen -t ed25519 -f zx-deploy -N "" -C "gh-actions-deploy"
# 服务器上追加公钥(注意单引号包 command 限制)
PUB="$(cat zx-deploy.pub)"
ssh zx@你的服务器IP "echo 'command=\"cd ~/zxLumen-Blog/docker && IMAGE_TAG=\$SSH_ORIGINAL_COMMAND ./deploy.sh\",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc ' $PUB >> ~/.ssh/authorized_keys"
# 私钥内容填入 GitHub 的 SERVER_DEPLOY_KEY(zx-deploy)
```

> `\$$SSH_ORIGINAL_COMMAND` 会原样带上 CI 传给 SSH 的命令(即 `<git-sha>`),交给 `deploy.sh`。

## 4. 拉代码并配置

```bash
git clone <你的仓库地址> zxLumen-Blog
cd zxLumen-Blog/docker
cp .env.example .env
vim .env      # 填 DOMAIN / ACME_EMAIL / ADMIN_PASSWORD / SESSION_SECRET / REPORT_TOKEN
```

`.env` 只需这些;镜像 tag 与运行时内容路径由 compose 内联处理。

## 5. 放置个人内容(不入库,每次改动后要单独上传)

个人内容**不进入 git / 不进入镜像**,服务器从本地 `docker/site-content/` 挂载:

| 文件 | 来源 | 作用 |
|---|---|---|
| `docker/site-content/content.json` | `cd packages/shared && npm run export:content` | 站点全部文案/项目/联系方式(热更新) |
| `docker/site-content/resume.pdf` | `scp` 本地简历 PDF | 「下载简历」文件 |
| `docker/site-content/wechat.png` | `scp` 本地二维码 | 微信二维码浮窗图 |

```bash
# 每次改完内容后:
cd packages/shared && npm run export:content   # 重新生成 content.json
# 上传(路径以 ~/zxLumen-Blog/docker 为准):
scp docker/site-content/content.json zx@你的服务器IP:~/zxLumen-Blog/docker/site-content/content.json
scp apps/next-home/public/resume.pdf  zx@你的服务器IP:~/zxLumen-Blog/docker/site-content/resume.pdf
scp apps/next-home/public/wechat.png  zx@你的服务器IP:~/zxLumen-Blog/docker/site-content/wechat.png
```

**热更新**:`content.json` mtime 变化后,刷新页面即生效,**无需重启/重建**(服务端按 mtime 重读)。
简历/二维码由 Caddy 直接静态服务,替换文件即生效。详见 [`docs/CONTENT.md`](./CONTENT.md)。

## 6. 首次启动(迁移;已跑过的服务器见第 8 节)

```bash
# 1) 先把新文件放上去(compose / Caddy / 部署脚本 / 个人内容)
scp docker/docker-compose.yml docker/Caddyfile docker/deploy.sh zx@你的服务器IP:~/zxLumen-Blog/docker/
scp docker/site-content/* zx@你的服务器IP:~/zxLumen-Blog/docker/site-content/

# 2) 触发首次构建部署:push(main)即可,或仓库 → Actions → build & deploy → Run workflow
#    首次它会把镜像推到 GHCR 并设为公开。

# 3) 服务器手动拉一次(等 Actions 显示成功后执行):
ssh zx@你的服务器IP 'cd ~/zxLumen-Blog/docker && IMAGE_TAG=<该次commit-sha> ./deploy.sh'
```

浏览器打开 `https://你的域名`。首次 Caddy 自动申请证书(10–30 秒)。

> 若不走 CI,也可在服务器上手动 `docker compose build && docker compose up -d`(本地镜像演进回退方案),但**会占用服务器构建缓存**,与本流程目标相悖,不建议。

## 7. 首次使用

- 打开 `/admin`,用 `ADMIN_PASSWORD` 登录,验证私密留言 / 统计 / 外观配置
- 发一条留言测试
- 测用量上报:

```bash
curl -X POST https://你的域名/api/usage \
  -H "X-Report-Token: 你的REPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","input_tokens":1000,"output_tokens":500}'
```

## 8. 日常更新

普通代码改动:**git push main 即可** —— CI 构建并自动部署,服务器拉新镜像滚动更新,自动清理旧镜像。
内容改动(文案/简历/二维码):`export:content` + `scp site-content/*`(见第 5 节),无需 push。

> 简历生成(可选):仓库内 `apps/next-home/resume/` 有 `resume.py` + `resume.css`;
> `python resume.py resume.md --chrome-path "<Chrome 路径>"` 生成 PDF 后再上传。

## 9. 备份

```bash
cd zxLumen-Blog/docker
chmod +x backup.sh
./backup.sh
# cron(每天凌晨 3 点):
# 0 3 * * * /root/zxLumen-Blog/docker/backup.sh >> /var/log/zx-backup.log 2>&1
```

数据卷 `zx-data` 挂载容器的 `/data`,数据库 `zx.db`(DB 仍在服务端库里,与内容解耦)。

## 10. 挂载其他项目 demo

1. `docker/docker-compose.yml` 把 demo 服务加入 `web` 网络(取消注释模板)。
2. `docker/Caddyfile` 加一条子域名反代模板。
3. DNS 加子域名 A 记录 → 服务器 IP。
4. `docker compose up -d` 重启。

项目卡 `demoUrl` 填 `https://demo1.你的域名` 即可跳转。

## 常见问题

- **证书申请失败**:确认 80/443 未被占用、DNS 已生效、`DOMAIN` 正确。
- **服务器 pull 失败 / 401**:镜像必须公开 —— GitHub 仓库公开后,在 Packages 页把 `zx-home` 设为 `Public`(CI 会自动尝试设置)。
- **改完页面没变**:确认 `/srv/site/content.json` 已更新(mtime 变化才触发重读),或简历/二维码文件已替换。
- **想回滚**:`docker run` 前先看 GHCR 上哪个 tag;把服务器 `deploy.sh` 的 `IMAGE_TAG` 指到旧 sha 再跑一次。
- **数据库写入失败**:确认 `/data` 卷权限(Dockerfile 已 chown 给 `appuser`)。
- **旧版服务器磁盘爆满**:多为服务器端构建缓存(`/var/lib/containerd`),`docker builder prune -af && docker image prune -af`;新版流程不再在服务器构建,不会再涨。