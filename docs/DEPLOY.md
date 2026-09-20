# 部署手册(Docker + Caddy,单 VPS)

目标:一台 VPS 上跑个人主页,自动 HTTPS,SQLite 持久化,可扩展挂其他项目 demo。

## 0. 前置

- 一台 VPS(推荐 2 vCPU / 2–4 GB / Ubuntu 22.04+;Hetzner、Vultr 等均可)
- 一个域名(根域名给主页,子域名留给项目 demo)
- 本地已能 `npm run dev` 跑起来

## 1. 服务器初始化

```bash
# 以 root 登录后
apt update && apt upgrade -y
# 安装 Docker(含 compose 插件)
curl -fsSL https://get.docker.com | sh
# 新建非 root 用户并加入 docker 组(可选但推荐)
adduser zx && usermod -aG docker zx
# 防火墙:只放行 SSH + HTTP(S)
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

## 2. DNS

在你的域名服务商处添加 A 记录:

| 主机 | 类型 | 值 |
|---|---|---|
| `@`(根域名) | A | `你的服务器IP` |
| `www` | A | `你的服务器IP`(可选,主页会由 Caddy 处理) |

等 DNS 生效(`dig +short 你的域名` 能返回 IP)。

## 3. 拉代码并配置

```bash
git clone <你的仓库地址> zxLumen-Blog
cd zxLumen-Blog/docker
cp .env.example .env
vim .env      # 填 DOMAIN / ACME_EMAIL / ADMIN_PASSWORD / REPORT_TOKEN
```

## 4. 启动

```bash
cd zxLumen-Blog/docker
docker compose up -d --build
docker compose logs -f app      # 看到 Ready 即可 Ctrl+C
```

首次启动 Caddy 会自动申请证书(约 10–30 秒)。浏览器打开 `https://你的域名`。

> **架构注意**:若在 Apple Silicon 本地构建、部署到 x86 服务器,请用
> `docker compose build --build-arg BUILDPLATFORM=linux/amd64` 或直接在服务器上构建。
> 最省事:直接 `git clone` 到服务器后 `docker compose up -d --build`。

## 5. 首次使用

- 打开 `/admin`,用 `ADMIN_PASSWORD` 登录验证私密留言功能
- 在留言板发一条公开/私密留言测试
- 测试用量上报:

```bash
curl -X POST https://你的域名/api/usage \
  -H "X-Report-Token: 你的REPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","input_tokens":1000,"output_tokens":500}'
```

## 5.1 提供简历 PDF(不入库,需单独上传)

出于隐私,**个人资料与简历 PDF 均不纳入版本库**,部署前需在服务器上放置:

```bash
# 1) 简历 PDF(否则「下载简历」404)
scp ./resume.pdf root@你的服务器:/root/zxLumen-Blog/apps/next-home/public/resume.pdf

# 2) 个人资料(否则将使用占位示例,站点显示 "Your Name")
scp ./content.local.ts root@你的服务器:/root/zxLumen-Blog/packages/shared/src/content.local.ts
```

> `content.local.ts` 由 `packages/shared/src/content.local.example.ts` 复制而来并填入你的真实资料;
> 构建(shared)前若缺失会自动用示例生成占位。

> 生成方式(可选):仓库内 `apps/next-home/resume/` 提供 `resume.py` + `resume.css`;
> 自备 Markdown 源后运行 `python resume.py resume.md --chrome-path "<Chrome 路径>"` 生成 PDF。

## 6. 备份

```bash
cd zxLumen-Blog/docker
chmod +x backup.sh
./backup.sh
```

加入 cron(每天凌晨 3 点):

```bash
crontab -e
# 追加:
0 3 * * * /root/zxLumen-Blog/docker/backup.sh >> /var/log/zx-backup.log 2>&1
```

数据卷 `zx-data` 挂载在容器的 `/data`,数据库文件 `zx.db`。

## 7. 更新

```bash
cd zxLumen-Blog
git pull
cd docker && docker compose up -d --build
# 清理旧镜像释放磁盘
docker image prune -f
```

## 8. 挂载其他项目 demo

1. 编辑 `docker/docker-compose.yml`,把 demo 服务加入 `web` 网络(取消注释模板)。
2. 编辑 `docker/Caddyfile`,加一条子域名反代(取消注释模板)。
3. DNS 加该子域名的 A 记录 → 服务器 IP。
4. `docker compose up -d` 重启。

主页项目卡片里的 `demoUrl` 填 `https://demo1.你的域名` 即可跳转。

## 常见问题

- **证书申请失败**:确认 80/443 未被占用、DNS 已生效、`DOMAIN` 正确。
- **数据库写入失败**:确认 `/data` 卷权限(Dockerfile 已 chown 给 `appuser`)。
- **中文乱码**:容器 `LANG` 无需设置;页面已 `lang="zh-CN"`。
- **想改绑定端口**:改 `apps/next-home/package.json` 的 `start` 脚本。
