# 应用栏链接审计（2026-11-09）

## 范围与方法

- 数据源：生产库 `meta.apps_config`（共 17 项，读写均为线上唯一库）。
- 方法：相对路径按 `https://zxlumen.cn` 解析；`localhost` / `127.0.0.1` 跳过；
  逐项 `curl -s -o /dev/null --max-time 20 -w '%{http_code} %{time_total}'`（**不跟随重定向**，
  2xx/3xx 视为可用）。
- 排除误报：用不存在的子域 `no-such-app-zz9.zxlumen.cn` 探测返回 DNS `000`，
  确认线上无泛解析兜底；并抽样核对各站 `<title>` 互不相同，结果非"全站同一页"造成。
- 本次未对任何站点做写操作或压测，仅只读 GET。

## 结果（17/17 可用，死链 0）

| # | id | name | url | code | 耗时(s) | 备注 |
|---|----|------|-----|------|---------|------|
| 0 | github | GitHub | https://github.com/zxlumen | 200 | 0.720 | 外部站 |
| 1 | csdn | CSDN | https://blog.csdn.net/ChallengerRumble | 200 | 1.855 | 外部站，最慢（跨网 + 跳转链路） |
| 2 | resume | 简历 | /resume.pdf → https://zxlumen.cn/resume.pdf | 200 | 0.159 | 相对路径，已按主站解析 |
| 3 | brain | Agent Brain | https://brain.zxlumen.cn | 200 | 0.137 | |
| 4 | code-sandbox | 代码沙盒 | https://code-sandbox.zxlumen.cn | 200 | 0.189 | 已迁至 Opencode-Pocket，仍在线 |
| 5 | opentodo | Opentodo | https://todo.zxlumen.cn/ | 200 | 0.116 | |
| 6 | company | 一人公司 | https://company.zxlumen.cn | 200 | 0.074 | **本次修复项**（原 `ompany.` 少一个 c） |
| 7 | stock | 股票速览 | https://stock.zxlumen.cn/ | 200 | 0.117 | |
| 8 | app-4ib9vf8fp | 易经64 | https://yijing.zxlumen.cn/ | 200 | 0.119 | |
| 9 | luminari | 生灵 | https://luminari.zxlumen.cn/ | 200 | 0.127 | 独立仓库/容器 |
| 10 | zuiti | 嘴替 | https://zuiti.zxlumen.cn | 200 | 0.156 | |
| 11 | mbti | 心语 | https://mbti.zxlumen.cn/ | 200 | 0.391 | |
| 12 | attune | 无恙 | https://attune.zxlumen.cn/ | 200 | 0.134 | |
| 13 | photo | 光圈 | https://photo.zxlumen.cn/ | 200 | 0.134 | |
| 14 | app-tath3kcvk | RAG | https://rag.zxlumen.cn/ | 200 | 0.124 | |
| 15 | game | 酒桌 | https://game.zxlumen.cn/ | 200 | 0.136 | |
| 16 | curling | 冰壶 | https://curling.zxlumen.cn/ | 200 | 0.499 | |

- **死链数：0**
- 跳过项：0（17 项中无 `localhost` / `127.0.0.1`）

## company 修复与验证

- 改动：`apps_config[6].url` `https://ompany.zxlumen.cn` → `https://company.zxlumen.cn`；
  其余 16 项顺序、字段、值经逐项比对完全未变（事务写回，未重启容器）。
- 验证：
  - 主站 HTML 中断链模式 `//ompany.zxlumen.cn` 出现 **0** 次；
  - `https://company.zxlumen.cn/` 返回 **200**。
  - 说明：`grep -c ompany` 会命中 `company`（"company" 内含 "ompany"），
    故改用 `//ompany.` 精确计数，避免把正确地址算成残留。
