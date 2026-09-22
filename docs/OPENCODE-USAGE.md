# OpenCode 用量(官方 Console)

「Token 用量」面板的 **OpenCode 数据源**读取 **OpenCode 官方 Console** 的组织用量
(organization scope = 你账号下的完整数据),按每个请求的精确时间戳在本地聚合:
**今天 / 昨天按小时(北京时间)分时显示**,其余区间按天。
已进 `LIVE_FEATURES`(测试/正常模式均可见);如需回退,从 `LIVE_FEATURES` 移除 `usage-opencode` 即可。

## 数据从哪来

接口:`GET {consoleUrl}/api/v1/usage/export?scope=organization&range=30d`
(OpenCode Console 官方 `Usage API`,返回逐条记录的 CSV;每条含 `provider` / `model` /
`input_tokens` / `output_tokens` / `cache_read_tokens` / `cost_micro_cents` / `created_at(UTC)`)。

- 一次拉取近 30 天(官方仅提供 24h / 7d / 30d,UTC 零点对齐),存成小时级聚合快照,
  面板任意区间(今天/昨天/近7/近30/本月/上月/自定义)由该快照**本地二次聚合**;
  早于官方覆盖(约 30 天)的区间返回 `platformLimit: true`,前端注明「超出官方覆盖」;
- 计入管理推理(如 `opencode` 提供方,`big-pickle` 等)的 tokens 与费用;**BYOK / 免费 / 未分类计费为 0 费用**但也统计 tokens 与请求数;
- **费用折算**:官方导出的 `cost_micro_cents` 对 Go 订阅(`billing_source=go`)恒为 0。
  面板据此改用 **token × Go 价目表**折算美元(与 Console 网页 Cost 同口径);
  价目见 `packages/shared/src/go-pricing.ts`(含 Peak/Off-Peak,DeepSeek 系列;
  Peak = 周一至周五 01:00–04:00、06:00–10:00 UTC)。官方无公开价目接口,故为**内置常量**,
  促销/调价后需更新(表内 `promoUntil` 标注截止日,DeepSeek V4.1 Flash 现为 4x 至 2026-09-27);
  未收录模型费用记 0。官方实际扣费(`cost_micro_cents>0`,如 fallback 到 Zen 余额)时以实际为准。
- **Go 配额(5 小时 / 周 / 月)**:面板在有 Go 订阅时额外展示三档使用率(真实百分比 + 重置时间),
  数据来自 `GET https://opencode.ai/zen/go/v1/usage`(service-account key);未订阅则自动隐藏;
- Web Search(`service=web-search`,无 provider/model)行忽略;
- 与 DeepSeek 数据源的区别:DeepSeek 平台导出只有天级,OpenCode 每条记录带精确时间戳,故能分时。

## 鉴权(必须用 service-account Key)

官方**只接受 Console 创建的服务账号 key**(`oc_sk_…`);网页登录态、BYOK 的 `sk-` key 一律被拒(401/403)。

配置位置:admin →「Token 用量」→ OpenCode 用量 区块,粘贴 key 保存(`${consoleUrl}` 可改,
默认 `https://opencode.ai/console`)。或环境变量 `OPENCODE_SERVICE_KEY` / `OPENCODE_CONSOLE_URL`(优先级更高)。

创建步骤:登录 [opencode.ai/console](https://opencode.ai/console)(或 dev 环境
[dev.opencode.ai/console](https://dev.opencode.ai/console))→ API keys → 新建
**Service account** key(需用量读取权限)→ 复制到 admin。

## 接口

`GET /api/usage?source=opencode&range=<range>`(功能门控 `usage-opencode`,已进 `LIVE_FEATURES`)

- 响应与 deepseek 同形状,新增 `granularity`:今天/昨天为 `"hour"`(北京整点桶),其余 `"day"`;
  `platformLimit` 标记超出官方覆盖;`currency` 恒为 `"USD"`(`cost_micro_cents / 1e8`);
  `rows[].apiKey` 即 provider 目录键(opencode / deepseek / zhipuai …);
- `source`: `opencode`(实时) / `stale`(上次成功快照,官方故障时回退) /
  `unconfigured`(未配置 key) / `invalid`(key 无效) / `error`。

## 展示

- 面板顶部 **DeepSeek / OpenCode** 数据源切换;
- **模型选单按使用频率排序**(区间内 tokens 总量从高到低;零用量模型排最后);
- 今天/昨天:**天级图直接变为 24 根小时柱**(北京时,替换独立的 HOURLY 面板),所有平台共用同一套图表
  (DeepSeek 平台导出只有天级,故其今天/昨天仍是单日柱);RECENT 明细同步显示「天/小时/模型」;
- 其余区间照常按天;成本显示 USD。

## 安全

- `oc_sk_` key 属账号级敏感凭证:仅存服务器数据库(`meta`),**绝不下发前端**、不写日志;
- 原始记录(含请求明细)不下发,面板只展示聚合数字;官方侧 key 若泄露可在 Console 撤销重建;
- 该功能供站长自用,TEST 验证通过后再决定是否晋升 LIVE。