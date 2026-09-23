# 采购与上线手册(腾讯云 / 阿里云 香港轻量)

> 目标:最低成本、免备案、国内可用,单台服务器跑主页 + 多个网页 demo。
> 本手册是"从零到上线"的操作单;部署细节见 [`DEPLOY.md`](./DEPLOY.md)。

## 选型结论

- **服务器**:腾讯云 或 阿里云 **香港轻量应用服务器**,2 vCPU / 2 GB(有预算上 4 GB),Ubuntu 22.04。
- **域名**:同平台注册 `.com`(实名),DNS 用平台自带解析(或 Cloudflare)。
- **HTTPS**:Caddy 自动 Let's Encrypt(免费,无需操作)。
- **备份**:对象存储(腾讯云 COS / 阿里云 OSS,或 Cloudflare R2)。
- **为何香港**:免 ICP 备案、国内访问 30–60ms 可接受、支付宝/微信付款。

## 采购清单

| # | 项目 | 规格 / 说明 | 费用(估) |
|---|---|---|---|
| 1 | 域名 | `.com`,1 年 | ¥60–90/年 |
| 2 | 香港轻量服务器 | 2C2G / 40–60G SSD / Ubuntu 22.04 | 新用户 ~¥288–480/年 |
| 3 | DNS 解析 | 平台自带(免费)或 Cloudflare | ¥0 |
| 4 | TLS 证书 | Caddy 自动 | ¥0 |
| 5 | 对象存储备份 | COS/OSS/R2,存 SQLite 备份 | ¥0–10/月 |
| 6 | 监控(可选) | UptimeRobot 免费版 | ¥0 |

## 第 1 步 · 实名认证

腾讯云/阿里云购买域名与服务器都要求**个人实名认证**:上传身份证 + 人脸核验(几分钟)。域名还需**域名实名**(1–3 工作日)。

## 第 2 步 · 购买域名

1. 控制台搜索「域名注册」→ 输入想要的 `.com` → 加入购物车。
2. 购买 1 年 → 在「域名列表」完成**域名实名认证**。
3. 记住:稍后在「DNS 解析」加 A 记录。

> 想省钱也可在 Cloudflare Registrar 注册(成本价),但若日后可能要备案,建议国内注册商。

## 第 3 步 · 购买香港轻量服务器

**腾讯云**:轻量应用服务器 → 新建 →
- 地域:**中国香港**
- 镜像:**系统镜像 Ubuntu 22.04 LTS**
- 套餐:**2核2G**(带宽按需,30Mbps 左右;个人站 1–3Mbps 足够)
- 时长:1 年 → 购买

**阿里云**:轻量应用服务器 → 地域 **中国香港** → 系统镜像 Ubuntu 22.04 → 2核2G → 购买。

> ⚠️ 香港轻量**不需要** ICP 备案。控制台创建时**设置登录方式**:选「密钥对」最安全(或密码,登录后尽快改密钥)。

## 第 4 步 · 控制台放行端口

轻量服务器有**独立的云防火墙**,必须放行:

| 协议 | 端口 | 用途 |
|---|---|---|
| TCP | 22 | SSH |
| TCP | 80 | HTTP(证书签发 + 跳转) |
| TCP | 443 | HTTPS |
| UDP | 443 | HTTP/3(可选) |

记录服务器**公网 IP**。

## 第 5 步 · 本地 SSH 密钥并登录

```bash
# 本机(若还没有密钥)
ssh-keygen -t ed25519 -C "zx-home"
cat ~/.ssh/id_ed25519.pub    # 复制公钥

# 登录(腾讯云可在控制台重置/绑定密钥;或先密码登录后写入)
ssh root@你的服务器IP
```

## 第 6 步 · DNS 解析

在域名所在平台的「DNS 解析」添加:

| 主机记录 | 类型 | 记录值 |
|---|---|---|
| `@` | A | 你的服务器IP |
| `www` | A | 你的服务器IP |

将来项目 demo 用子域名:`demo1`、`demo2` … 同样加 A 记录。
验证:`dig +short 你的域名` 应返回 IP。

## 第 7 步 · 服务器初始化

把仓库 `docker/init-server.sh` 传上去执行(安装 Docker、2G swap、ufw、fail2ban、建部署用户):

```bash
# 本机上传脚本
scp docker/init-server.sh root@你的服务器IP:/root/

# 服务器上执行
ssh root@你的服务器IP
bash /root/init-server.sh        # 默认创建用户 zx;可传入自定义用户名
```

## 第 8 步 · 部署

```bash
ssh zx@你的服务器IP              # 用刚建的部署用户(或 root)
git clone <你的仓库地址> zxLumen-Blog
cd zxLumen-Blog/docker
cp .env.example .env
vim .env                          # 填 DOMAIN / ACME_EMAIL / ADMIN_PASSWORD / REPORT_TOKEN
docker compose up -d --build
docker compose logs -f app        # 看到 Ready 即可
```

首次启动 Caddy 会自动申请证书(10–30 秒)。打开 `https://你的域名`。

> 详细步骤与隐私文件上传(`resume.pdf` / `content.local.ts` / `wechat.png`)见 [`DEPLOY.md`](./DEPLOY.md) 第 5、5.1 节。

## 上线验收清单

- [ ] `https://你的域名` 正常打开,地址栏有锁
- [ ] `http://` 自动跳 `https://`
- [ ] `/admin` 用 `ADMIN_PASSWORD` 能登录
- [ ] 留言板发一条公开 + 一条私密,均成功
- [ ] 用量上报:`curl -X POST https://你的域名/api/usage -H "X-Report-Token: <REPORT_TOKEN>" -H "Content-Type: application/json" -d '{"model":"deepseek-chat","input_tokens":1000,"output_tokens":500}'` 返回 `ok:true`
- [ ] 顶栏 `MOCK` 可切换访客 A/B/C(仅站长),线上访客不受影响
- [ ] 备份脚本可跑:`cd docker && ./backup.sh`

## 备份 / 监控 / 更新

```bash
# 备份(并加入 cron)
cd docker && chmod +x backup.sh && ./backup.sh
crontab -e
# 0 3 * * * /home/zx/zxLumen-Blog/docker/backup.sh >> /var/log/zx-backup.log 2>&1

# 更新(拉代码 + 重建)
./docker/update.sh

# 监控:UptimeRobot 免费版监控 https://你的域名 即可
```

## 费用估算(首年)

| 项 | 估 |
|---|---|
| 域名 `.com` | ¥60–90 |
| 香港轻量 2C2G | ¥288–480 |
| 其他(TLS/DNS/备份/监控) | ¥0 |
| **合计** | **≈ ¥350–570/年** |

## 备用分支:大陆服务器 + ICP 备案

若日后要国内最快速度且愿意备案:大陆轻量首年更便宜,但需**域名实名 + ICP 备案(7–20 工作日)+ 公安备案**,且**留言板(UGC)可能触发合规审查**。流程:买大陆服务器 → 云厂商「备案系统」提交 → 管局审核 → 通过后域名解析到大陆机。不推荐作为首选。

## 常见问题

- **证书申请失败**:确认 80/443 在云防火墙 + ufw 都放行、DNS 已生效、`.env` 的 `DOMAIN` 正确。
- **打不开但 `docker compose ps` 正常**:多半是云控制台防火墙没放行 80/443。
- **构建 OOM**:2G 机器已由 `init-server.sh` 加 2G swap;仍失败可临时 `SWAP_SIZE_MB=4096` 重跑脚本。
- **换服务器 IP**:更新 DNS A 记录;Caddy 会重新签发证书。
