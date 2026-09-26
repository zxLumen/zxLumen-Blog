# 智谱用量(BigModel / Z.ai monitor API)

「Token 用量」面板的**智谱数据源**读取智谱开放平台监控接口,给出:

- **区间内「按模型 token 总量」**(今天/近7天/近30天/本月/上月/自定义);
- **配额条**(5 小时 / 每周 token %、MCP 月度次数、套餐等级)——按量用户可能为空。

## 数据从哪来

| 接口 | 用途 |
|---|---|
| `GET {base}/api/monitor/usage/quota/limit` | 5h/周 token 配额 %、MCP 月度、账号等级 |
| `GET {base}/api/monitor/usage/model-usage?startTime&endTime` | 时间窗内**按模型** token 总量 |
| `GET {base}/api/monitor/usage/tool-usage?startTime&endTime` | MCP 工具调用次数(**暂未接入**) |

- `base` 默认 `https://open.bigmodel.cn`(国内);国际站用 `https://api.z.ai`。
- 时间窗格式 `yyyy-MM-dd HH:mm:ss`(本地时区)。

## 鉴权

**裸 API Key**(不加 `Bearer` 前缀):请求头 `Authorization: <apiKey>`。
配置位置:admin →「Token 用量」→ 智谱用量 区块,粘贴 Key 保存;或环境变量
`ZHIPU_API_KEY` / `ZHIPU_BASE_URL`(优先级更高)。Key 仅存服务器(meta),不下发前端。

## 局限(重要)

- 智谱**没有**逐条/逐日/逐小时的用量或费用导出 API:
  - 无**费用**(消费明细只在网页「财务总览/费用账单」,需登录态);
  - **无输入/输出/缓存拆分**(`model-usage` 只给每个模型的总 token);
  - 因此本数据源**没有日趋势**(柱状图为区间单点),「输入/输出/缓存」统计对智谱无意义,**总 tokens** 仍准确。
- 配额接口字段随套餐/官方改版可能变化;解析失败会如实报错并回退上次成功快照。
- 失败原因落 `meta.zhipu_last_fail`(`code`/`message`/`at`;`INVALID_KEY` = key 无效/无权限(401/403),
  `HTTP` / `TIMEOUT` = 接口或网络问题)。
  拉取失败时可用性回退快照(面板不会整块消失,tab 上带 `!` 角标);短时间内不重复请求官方接口
  (凭证类失败一直短路,换 key 后由 admin 保存/成功拉取清除),详见 `docs/OPENCODE-USAGE.md` 同节。

## 接口

`GET /api/usage?source=zhipu&range=<range>`(功能门控 `usage-zhipu`)

- 响应与其它源同形状:`rows`(每模型一条,`ts` 取区间起点)、`models`、`currency: 'CNY'`、
  `granularity: 'day'`;配置了 Key 时附带 `zhipuQuota`。
- `source`:`zhipu`(实时)/ `stale`(上次成功快照)/ `unconfigured`(未配置)/ `error`。

## 管理端

`GET/POST /api/admin/zhipu`:`save`(Key + baseURL)/ `refresh`(拉取 30d 校验)/ `clear`。
