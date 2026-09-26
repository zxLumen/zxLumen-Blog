# OpenCode 用量(官方 Console)

「Token 用量」面板的 **OpenCode 数据源**读取 **OpenCode 官方 Console** 的用量
(service-account key 所属 workspace/组织的数据),在本地聚合展示:
**7 天 / 30 天 / 本月 / 上月按天**;**今天 / 昨天按小时**(优先用控制台推理日志精确聚合,未配置时由本站自采样,见下)。

## 数据从哪来

接口:`GET {consoleUrl}/api/v2/usage/export?range=30d`(OpenCode Console 官方 `Usage API`)。

> ⚠️ **2026-09-26 官方把接口从 v1 迁到 v2**:旧的
> `GET /api/v1/usage/export?scope=organization&range=30d` 现在对 `scope=organization` 直接返回
> `403 {"_tag":"Forbidden"}`(不是权限问题,是旧版被弃用);新接口是 `/api/v2/usage/export`,
> 只认 `range`(`scope` 被忽略),且**不再支持 `24h`**。代码里 v2 优先,仅当 v2 返回 404/400
> 时才回退 v1(兼容尚未迁移的账号)。

v2 是**天级累计** CSV,列为:
`day,user_type,user_id,user_name,provider,model,requests,input_tokens,output_tokens,cache_read_tokens,cache_write_5m_tokens,cache_write_1h_tokens,cost_micro_cents,last_active_at`
(即每个 `day × model × provider × user_name` 一行累计值;**没有逐条时间戳**)。

- 一次拉取近 30 天(UTC 零点对齐),存成天级快照,任意区间(近7/近30/本月/上月/自定义)由快照**本地二次聚合**;
  早于官方覆盖(约 30 天)的区间返回 `platformLimit: true`,前端注明「超出官方覆盖」;
- 计入管理推理(如 `opencode` 提供方,`big-pickle` 等)的 tokens 与费用;**BYOK / 免费 / 未分类计费为 0 费用**但也统计 tokens 与请求数;
- **费用折算**:官方导出的 `cost_micro_cents` 对 Go 订阅恒为 0。面板据此改用
  **token × Go 价目表**折算美元(与 Console 网页 Cost 同口径);价目见
  `packages/shared/src/go-pricing.ts`(含 Peak/Off-Peak,DeepSeek 系列;Peak = 周一至周五
  01:00–04:00、06:00–10:00 UTC)。官方无公开价目接口,故为**内置常量**,促销/调价后需更新
  (表内 `promoUntil` 标注截止日);未收录模型费用记 0。官方实际扣费(`cost_micro_cents>0`)时以实际为准。
- **Go 配额(5 小时 / 周 / 月)**:面板在有 Go 订阅时额外展示三档使用率(真实百分比 + 重置时间),
  数据来自 `GET https://opencode.ai/zen/go/v1/usage`(service-account key);未订阅则自动隐藏;
- Web Search 等非推理行按 provider/model 为空剔除。

## 自建小时数据(今天 / 昨天分时)

v2 只有天级,**无法**还原每个小时。因此本站自己采样:每个整点前 30 秒调用一次 v2 导出,
把每个 `(day × model × provider × user)` 的**当天累计**与上次读数相减,得到**本小时增量**,
按北京整点写入数据库(`meta.opencode_hourly.<wsId>`):

- 触发:进程内定时器(随首次访问/`/api/usage` 启动)+ 启动时若距上次采样超过 55 分钟则补抓一次;
  访问今天/昨天数据时若距上次 >5 分钟也会**惰性补采样**(不阻塞响应);admin「采样小时数据」按钮可手动补一次;
- 存储:`meta.opencode_cum.<wsId>` 记上次累计读数(按 workspace 分键,保留最近 3 天);
  `meta.opencode_hourly.<wsId>` 记小时行(保留最近 35 天 / 最多 8000 行);跨天自动从 0 起算;
- 首次采样只建立基线(不产出),之后每个整点产生一小时增量;
- **局限**:进程跨过整点未运行会丢那一小时(增量并入下一小时),且**无法补历史**——只能从现在开始积累;
  今天/昨天若还没有小时数据,则回退天级单柱。

## 精确小时数据(可选:控制台「推理日志」)

控制台 **Logs → Inference** 页用的接口
`GET {consoleUrl}/api/request-logs?since=<ms>&until=<ms>&limit=100&category=inference[&cursor=]`
会返回**每条推理请求**(`startedAt`、`inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/
reasoningTokens`、`cost` 美元、`model/provider/serviceAccountID`),据此可精确聚合成小时 —— 比自建采样更准。

要点(实测):

- **必须带 `category=inference`**;不带会拿到控制台自身的 `category:"api"` **API 审计日志**(没有 token 字段)。
- **必须带 `x-org-id: wrk_…`**(workspace id),各 workspace 分开拉;`nextCursor` 是字符串,原样回传翻页。
- 只认**网页登录态 Cookie**(httpOnly;`oc_sk_` 打它会 403),需人工粘贴一次。

配置位置:admin →「Token用量」→ OpenCode 区块 →「控制台推理日志」:

1. 在控制台开 DevTools → Network,筛 `request-logs`,随便点开一条 → **Copy as cURL**(bash/cmd 均可);
2. 粘进输入框(org id 自动从 `x-org-id`/URL 提取,也可手填)→「保存并校验」→ 后台拉取、面板**轮询进度**。

**同步模型(按 workspace 滚动)**

- 保存后自动用 Cookie 调 `/api/orgs` **枚举账号下所有 workspace**,逐个拉取;
- 拉取窗口 = **北京时间今天**:首次/缺小时时从今天 00:00 补齐,稳态只拉当前整点(约 1 页);
- 「昨天」**只读已落库的存储、不额外打接口** —— 它在昨天当时已采到(存储保留 3 天,跨过日界);
  因此首次配置当天看不到更早的"昨天",自然滚到第二天后就有了;
- 用每个 admin Key 调 `/api/service-accounts` 得到 **org ↔ 本地 workspace** 映射与 svcacct 名称,
  据此把日志行归到对应 workspace(面板按选中的 workspace 过滤)。

**对访客完全无感**:`/api/usage` 只在「今天」触发一次**后台**同步(2 分钟节流),**绝不 await**,
立即返回存储里的现有数据(没有则秒回退采样/天级);同步慢(几十页)也只发生在后台。
此外进程内还有一个**后台定时器**(启动补跑一次 + 每 10 分钟一次,未配置 Cookie 时为空操作),
所以即便长时间零访问也不会丢小时,**无需手动点「立即同步」**(admin 里点一次「保存并校验」完成首次配置即可)。

Cookie **仅存服务器** `meta.opencode_console_cookie`,不下发前端;失效(401/403)后重贴即可。
配置后分时提示标注「逐条日志 · 精确」,未配置/失效则回退「采样估算」。

## 鉴权(必须用 service-account Key)

官方**只接受 Console 创建的服务账号 key**(`oc_sk_…`);网页登录态、BYOK 的 `sk-` key 一律被拒(401)。

配置位置:admin →「Token 用量」→ OpenCode 用量 区块,粘贴 key 保存(`${consoleUrl}` 可改,
默认 `https://opencode.ai/console`)。**只读数据库 `meta`,不读环境变量**。

创建步骤:登录 [opencode.ai/console](https://opencode.ai/console)(或 dev 环境
[dev.opencode.ai/console](https://dev.opencode.ai/console))→ API keys → 新建
**Service account** key,**权限选 `All permissions`**(至少含「读取用量」)→ 复制到 admin。

> **权限是 403 的原因之一**:官方 Usage API 文档写明 —— `401` = key 缺失/无效/过期/吊销,
> `403` = 服务账号已认证但**不被允许读用量**。只勾 inference-only 的 key 打 `usage/export`
> 会 403(但它打 `/zen/go/v1/usage` 仍可能 200,所以「能调用推理」不代表能读用量)。
> 注意区分:**v1 的 403 是接口被弃用**(改用 v2),v2 的 403 才是权限问题。

## key 失效 / 无权限了怎么办(401 / 403)

表现与处理:

- 面板**不会整块消失**:可用性探测在拉取失败时回退到上次成功快照,OpenCode tab 仍在,
  tab 上带 `!` 角标(hover 看原因),图上是「上次成功数据」,底部注明更新时间与错误;
  若当前 workspace 一个快照都没有,会**回落到任意 workspace 的上次成功快照**(并在错误里
  注明「显示的是其它 workspace 的上次成功快照」),避免换/删 workspace 后历史整块丢失;
- 排查:`meta.opencode_last_fail`(JSON:`code` / `message` / `at`):
  - `INVALID_KEY` → 401,key 无效/过期/已吊销 → 需在 Console **重建**;
  - `NO_PERMISSION` → 403(v2),服务账号**没有读用量权限** → 把权限改成 `All permissions`,**不用换 key**;
  - `UNCONFIGURED` → 没填 key;
- 修复:改权限或换新 key → admin「Token 用量」→ OpenCode 保存(保存会清掉失效标记并立即重新探测)
  或点「验证/刷新」;拉取成功后也会自动清掉旧的 `meta.opencode_last_error`;
- 速度:401 判定后**不再重复请求官方 API**(重试也还是被拒);403 走 10 分钟宽限后自动重试
  (**Console 侧改完权限约 10 分钟内自愈**,无需手动操作);整体可用性结果进程内缓存 60s,
  实测 `/api/usage/sources` 数毫秒 ~ 数十毫秒。

## 接口

`GET /api/usage?source=opencode&range=<range>`

- 响应与 deepseek 同形状,`granularity`:今天/昨天**有小时数据时为 `"hour"`**,否则(以及其余区间)为 `"day"`;
  `hourlySource`:今天/昨天小时数据的来源 —— `"logs"`(控制台逐条日志,精确) / `"sampled"`(自建采样估算);
  `platformLimit` 标记超出官方覆盖;`currency` 恒为 `"USD"`;
  `rows[].apiKey` 即 provider 目录键(opencode / opencode-go …);
- `source`: `opencode`(实时) / `stale`(上次成功快照,官方故障时回退) /
  `unconfigured`(未配置 key) / `invalid`(key 无效/无权限) / `error`。

## 展示

- 面板顶部 **DeepSeek / OpenCode** 数据源切换;
- **模型选单按使用频率排序**(区间内 tokens 总量从高到低;零用量模型排最后);
- 今天/昨天:有自建小时数据时画 24 根小时柱(北京时),否则天级单柱;RECENT 明细同步显示「天/小时/模型」;
- 其余区间照常按天;成本显示 USD。

## 安全

- `oc_sk_` key 属账号级敏感凭证:仅存服务器数据库(`meta`),**绝不下发前端**、不写日志;
- 原始记录(含请求明细)不下发,面板只展示聚合数字;官方侧 key 若泄露可在 Console 撤销重建。
