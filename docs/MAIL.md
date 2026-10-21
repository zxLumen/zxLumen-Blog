# 邮件服务（2026-10-21 起）

> 旧的 poste.io 自建邮件服务器已**下线**（上游封锁 25 端口，入站邮件不可达）。
> 现在拆成两部分：**人的邮箱 → Purelymail**；**应用发信 → Resend**。
> 本文件是唯一说明，旧的 poste 运维内容已作废。

## 0. 现状速览

| 用途 | 服务 | 地址 / 说明 |
|---|---|---|
| 收发邮件（人） | Purelymail | `$10/年`，域名 `zxlumen.cn` 已验证 |
| Webmail | Purelymail | https://inbox.purelymail.com |
| IMAP | Purelymail | `imap.purelymail.com:993`（SSL），用户名=完整邮箱 |
| SMTP（客户端） | Purelymail | `smtp.purelymail.com:465`（SSL）/ `587`（STARTTLS） |
| 应用发信（API） | Resend | 各容器已配 `RESEND_API_KEY` |
| 应用发信（SMTP） | Resend | `smtp.resend.com:465`（SSL）/ `587`，用户名固定 `resend`，密码=API Key |
| 系统发信 | msmtp → Resend | `/etc/msmtprc`，`/usr/sbin/sendmail` 已指向 msmtp |

> 客户端注意：Purelymail 开了 2FA 时，IMAP/SMTP 必须用 **App Password**。
> 苹果自带 iOS 邮件的 IMAP 推送（IDLE）与 Purelymail 不兼容，建议改用轮询或第三方客户端。

## 1. DNS（DNSPod）

| 类型 | 主机 | 值 | 用途 |
|---|---|---|---|
| MX | `@` | `mailserver.purelymail.com`（优先级 10） | 收信 |
| TXT | `@` | `v=spf1 include:_spf.purelymail.com ~all` | Purelymail 发信 SPF |
| TXT | `@` | `purelymail_ownership_proof=...` | 域名所有权 |
| CNAME | `purelymail1/2/3._domainkey` | `keyN.dkimroot.purelymail.com` | DKIM |
| CNAME | `_dmarc` | `dmarcroot.purelymail.com` | DMARC（`p=reject`） |
| CNAME | `autoconfig` | `autoconfig.purelymail.com` | 客户端自动配置 |
| SRV | `_autodiscover._tcp` | `0 0 443 autodiscover.purelymail.com` | Outlook 自动发现 |
| A | `@` / `www` | `103.205.240.62` | 网站（不变） |
| TXT/CNAME/MX | `resend._domainkey`、`send`、`rsend*` | Resend 提供 | **应用发信必须保留** |

> ⚠️ **DMARC 是 `p=reject`**：任何声称来自 `@zxlumen.cn` 的邮件必须 SPF 或 DKIM 通过，
> 否则会被收件方直接拒收。所以 **`resend._domainkey` 与 `send` 子域那组记录不能删**，
> 除非确认所有应用都不再通过 Resend 发信。

## 2. 应用发信

### 2.1 Resend API（推荐）

```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"no-reply@zxlumen.cn","to":"user@example.com","subject":"hi","html":"<p>hello</p>"}'
```

- 发件人必须属于已验证域名（`zxlumen.cn` / `send.zxlumen.cn`）；
- 免费额度约 100 封/天、3000 封/月（以面板为准）；
- 建议按应用拆分 API Key（只给 sending 权限），泄露时可单独吊销；
- 需要收用户回复时，把 `Reply-To` 指向 Purelymail 里的真实邮箱。

### 2.2 Resend SMTP（给只支持 SMTP 的应用）

```env
SMTP_HOST="smtp.resend.com"
SMTP_PORT="465"          # 465=隐式 TLS；587=STARTTLS
SMTP_USER="resend"       # 固定值
SMTP_PASS="<RESEND_API_KEY>"
SMTP_FROM="<应用名> <no-reply@zxlumen.cn>"
```

`zuiti`（嘴替）已按此配置完成，可直接收到验证码。

## 3. 系统发信（cron / 脚本）

已安装 `msmtp-mta`，`/etc/msmtprc` 指向 Resend 465（隐式 TLS，`tls_starttls off`）。

```bash
printf 'Subject: test\n\nbody\n' | msmtp you@zxlumen.cn
# 或沿用 sendmail 接口
printf 'Subject: test\n\nbody\n' | sendmail you@zxlumen.cn
```

- 日志：`/var/log/msmtp.log`；
- cron 需要发信时，在 crontab 顶部加 `MAILTO=you@zxlumen.cn`；
- 配置含 API Key，权限保持 `root:ubuntu 640`，不要 `cat` 到终端或日志。

## 4. 旧 poste.io（已下线，仅留档）

| 项 | 值 |
|---|---|
| 下线原因 | 上游（SUTEIDC / 极点云）**双向封锁 TCP 25**，外部邮件无法投递 |
| 已移除 | `mailserver` 容器、`analogic/poste.io` 镜像、Caddy 的 `mail.<DOMAIN>` 反代、UFW 邮件端口 |
| 数据备份 | `/home/ubuntu/mail-backup-20261021-123828.tar.gz`（19MB，含 users.db、DKIM 私钥、证书、405 封邮件） |
| 本地数据 | `/home/ubuntu/mail`（113MB，确认无用后可删） |
| 恢复方式 | `tar xzf 备份 -C /home/ubuntu && cd ~/mail && docker compose up -d` |

> 备份里含用户密码哈希与 DKIM 私钥，不要外传；确认彻底不用后再删除。
