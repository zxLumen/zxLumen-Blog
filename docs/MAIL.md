# 邮件服务器运维手册(Poste.io)

> ⚠️ **邮件服务不在本仓库的 compose 里**,而是单独跑在服务器的 `~/mail/`。本文件记录现状、配置与踩过的坑。
> 服务器上任何改法都会被重建/升级覆盖,**要长期生效必须落到本文件对应的真实文件里**(`~/mail/docker-compose.yml`、`/etc/nftables.conf`)。

## 0. 现状速览

| 项 | 值 |
|---|---|
| 容器 | `mailserver`,镜像 `analogic/poste.io`(官方镜像,**服务器不构建**) |
| compose | `~/mail/docker-compose.yml` |
| 网络 | `network_mode: host`(端口直接落在宿主机;**见 §1 端口**) |
| 数据 | `~/mail/data:/data`(唯一持久化,备份只需它) |
| Web 入口 | Caddy `mail.<DOMAIN>` → `host.docker.internal:8443` |
| 管理后台 | `https://mail.<DOMAIN>/admin` |
| **出站** | **走 Resend 中继**,不经本机 IP(见 §3) |

Caddy 那段必须把外部 Host 原样传给 Poste.io(它按 Host 拼绝对跳转):

```caddyfile
mail.{$DOMAIN} {
	reverse_proxy host.docker.internal:8443 {
		header_up Host {http.request.host}
		header_up X-Forwarded-Host {http.request.host}
		header_up X-Forwarded-Proto {scheme}
	}
}
```

后台里的 **DKIM** 在 `Domains` → 点进域名详情页 → 往下滚到 **DKIM key** 那一行(它不是独立菜单项,很容易找不到);那里同时会显示要求发布的 DNS 记录。

## 1. 端口与防火墙

**只有这四个端口该在公网开放**(其余一律拒绝):

| 端口 | 用途 | 公网 |
|---|---|---|
| 25 | 收信(MX) | ✅ |
| 465 / 587 | 提交(发信) | ✅ |
| 993 | IMAPS(收信客户端) | ✅ |
| 8080 / 8443 | Web 管理 / 后台 | ❌ 仅本机 + docker 网桥 |
| 110 / 143 | POP3 / 明文 IMAP | ❌ 全拒 |

主机层用 **nftables 定向拒绝**(`/etc/nftables.conf`,`systemctl enable nftables` 已开机自启):

```
table inet zxfilter
delete table inet zxfilter
table inet zxfilter {
  chain input {
    type filter hook input priority filter; policy accept;
    iifname "lo" accept
    iifname "br-*" tcp dport { 8080, 8443 } accept
    tcp dport { 110, 143, 8080, 8443 } reject with tcp reset
  }
}
```

设计要点(**别随手改成 ufw `default deny`**):

1. **不动 forward 链** —— app / rag / bark / grafana 等是 bridge 网络 + 端口映射,走 forward 链,不受这条链影响;
2. **不动 22 / 25 / 465 / 587 / 993 / 2096** —— SSH、收发信不受影响;`xray` 是 **host 网络**,`default deny` 会直接切断 2096 的 VLESS;
3. `iifname "br-*"` 是给 Caddy 回源用的 —— Caddy 上游是 `host.docker.internal:8443`,流量从 docker 网桥(`br-*`)进来,**不走 loopback**。踩过的坑:第一版规则没放行 `br-*`,结果 `https://mail.<DOMAIN>/` 直接 000(连接被 RST),本机 `curl https://127.0.0.1:8443/admin` 却正常 —— 定位方向就是「上游没走 loopback」。

腾讯云安全组里也应同步删掉 `8443` / `110` / `143` 的入站规则(双保险,避免误导后来人)。

回滚:`sudo cp /etc/nftables.conf.bak-<时间戳> /etc/nftables.conf && sudo nft -f /etc/nftables.conf`

## 2. 关键修复:compose 的 entrypoint 包装(⚠️ 别删)

镜像原本 `Entrypoint=/init`(s6-overlay)。现在包了一层,干两件事 —— 删掉它就会退回下面两个故障。

### 2.1 Dovecot 根本起不来(残留 pid)

现象:容器 `unhealthy`、**没有 IMAP**、**收信投递(LMTP)也断**、`mail.log` 停止写入。

根因:`restart: unless-stopped` 触发的是 `docker restart`,**保留容器文件系统**。上次运行留下的 `/run/dovecot/master.pid` 还在,s6 启动脚本看到它就判定"Dovecot 已在运行"→ **直接放弃启动**:

```
Fatal: Dovecot is already running with PID 807 (read from /run/dovecot/master.pid)
```

所以这个坑**每次容器重启 / 主机重启都会复发**,必须清残留。`syslog` 同理(残留 `/run/rsyslogd.pid`),它一挂日志就全断。

### 2.2 DKIM 软链丢失 → 出站邮件静默不签名

`/opt/haraka-smtp/config/dkim/<域>` → `/data/domains/<域>` 这个软链是**后台页面按需创建的**(见容器内 `opt/admin/src/Base/Handler/DKIM.php` 的 `createDKIM`),**容器一重建就没了**。缺它 → `mailauth/dkim_sign` 找不到密钥 → 邮件照发,但**没有 DKIM 签名**,静默降级成垃圾邮件候选。

因此 entrypoint 里对每个含 `private` 的域重建软链。

### 完整 compose(可直接照抄)

```yaml
services:
  mailserver:
    image: analogic/poste.io
    container_name: mailserver
    hostname: mail.zxlumen.cn
    network_mode: host
    restart: unless-stopped
    entrypoint:
      - /bin/sh
      - -c
      - |
        # 清掉上次运行残留的 pid/socket,否则 s6 会判定 dovecot 与 syslog 已在运行而拒绝启动
        rm -f /run/dovecot/master.pid /run/dovecot/master /run/dovecot/anvil /run/rsyslogd.pid
        # 重建各域 DKIM 软链(后台按需创建,容器重建即丢,会让出站邮件不签名)
        mkdir -p /opt/haraka-smtp/config/dkim
        for k in /data/domains/*/private; do
          [ -f "$$k" ] || continue
          d=$$(basename "$$(dirname "$$k")")
          ln -sfn "/data/domains/$$d" "/opt/haraka-smtp/config/dkim/$$d"
        done
        exec /init
    environment:
      - TZ=Asia/Shanghai
      - HTTP_PORT=8080
      - HTTPS_PORT=8443
      - DISABLE_CLAMAV=TRUE
    volumes:
      - ./data:/data
      - /etc/localtime:/etc/localtime:ro
```

> ⚠️ **compose 里的 `$` 必须写成 `$$`**,否则被 Compose 当变量插值成空串,循环静默失效(加完记得 `docker compose config` 看有没有插值告警)。

## 3. 邮件认证:别被 rspamd 误导

- **签名是 Haraka 的 `mailauth/dkim_sign` 插件做的,不是 rspamd。** 所以
  `rspamadm configdump dkim_signing` 里 `enabled = false` **是正常的**,不代表没签名;
  该插件在 `haraka-smtp` 与 `haraka-submission` 两侧都要启用,密钥从
  `/opt/haraka-<实例>/config/dkim/<域>/{private,selector}` 读。
- 本服务器自己的选择器是 `s20260923804`,公钥 `/data/domains/<域>/public`。
- **出站实际走 Resend**:haraka-submission 的 `relay` 插件把信交给 `smtp.resend.com:587`,
  配置存在 admin DB 里,**每次容器启动自动生成** `config/routes`(所以重建容器不会丢中继配置,反过来说也别去手改那个文件 —— 改 admin 中继设置即可)。
  Resend 转发时会**重签**,所以外链看到的是 `s=resend; d=<域名>` 与 SES 自己的
  `d=amazonses.com`,我们的 `s=s20260923804` 只在**本机直发 / 退信**时才被看到。
- 这也是为什么**不需要为了发信去动 Poste 的 DKIM**:公网上验得通的是 Resend 那把钥匙。

DNS 现状:

| 记录 | 值 | 用途 |
|---|---|---|
| `MX` | `10 mail.<DOMAIN>` | 收信 |
| `TXT` SPF | `v=spf1 ip4:<服务器IP> ~all` | **退信**(本机 IP 直发) |
| `TXT` `_dmarc` | `v=DMARC1; p=none; rua=mailto:...` | 观测期,稳定后再收紧 |
| `TXT` `send.<DOMAIN>` | `v=spf1 include:amazonses.com ~all` | **中继的信封域**(出站 SPF 实际查这条) |
| `TXT` `resend._domainkey.<DOMAIN>` | Resend 提供 | 出站 DKIM(真正生效的那把) |
| `TXT` `s20260923804._domainkey.<DOMAIN>` | `v=DKIM1; k=rsa; p=...` | 本机直发 / 退信 |

验证签名(**服务器上最快**):

```bash
ssh 服务器 'docker exec mailserver sh -c "grep -hE \"using selector|DKIM signed\" /data/log/s6/haraka-submission/current | tail -4"'
```

看到 `using selector s20260923804 ...` + `DKIM signed!` 即闭环;再确认同一事务有
`delivered ... host=smtp.resend.com ... fails=0`。收件方侧则在「显示原始邮件」里看
`Authentication-Results` 的 `spf` / `dkim` / `dmarc` 三项。

## 4. 日常运维

```bash
cd ~/mail
docker compose ps                     # 状态 / healthy
docker compose logs -f                # stdout 很少,邮件日志不在这里
docker compose pull && docker compose up -d   # 升级(会重建,见下面的必查清单)
```

- **备份**:只需 `~/mail/data`。
- **日志**:邮件日志 `/data/log/mail.log`;haraka 各实例 `/data/log/s6/<服务>/current`。
  这两者都在容器内,**Loki 采不到**(mailserver 几乎不写 stdout,见 [`MONITORING.md`](./MONITORING.md))。
- **重建/升级后必查**:

  ```bash
  docker exec mailserver sh -c "s6-svstat /var/run/s6/services/dovecot /var/run/s6/services/syslog"  # 注:s6-svstat 一次只吃一个路径,要逐个跑
  docker exec mailserver sh -c 'ls -l /opt/haraka-smtp/config/dkim/'
  docker logs mailserver | grep -i "already running"     # 应无输出
  printf 'a001 CAPABILITY\r\na002 LOGOUT\r\n' | nc -w 5 127.0.0.1 143
  ```

## 5. 别做的事

- ❌ 别删 compose 里的 `entrypoint` 包装 —— 会退回 §2.1(stale pid)和 §2.2(丢 DKIM 软链)。
- ❌ 别把 nftables 规则换成 ufw `default deny` —— `xray` 是 host 网络,会切断 2096 的 VLESS;bridge 端口映射走 forward 链也容易踩坑。
- ❌ 别手改容器内 `config/routes` —— 每次启动都会被 DB 里的中继设置覆盖;改 admin 中继设置。
- ❌ 别在后台点「重新生成 DKIM 密钥」,除非同步更新对应 `_domainkey` TXT,否则签名对不上。
- ❌ 别动 `~/mail/data/domains/*/private`。
- ⚠️ 中继用的是 Resend API key(`re_` 开头)。**排查时别把 `config/routes` 整个打印出来** —— 它没有密码脱敏,会连密钥一起进日志/终端回滚记录。
