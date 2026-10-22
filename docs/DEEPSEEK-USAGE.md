# DeepSeek 用量(平台真实数据)

主页的「Token 用量」面板可直接展示你 **DeepSeek 账号的真实用量**(按模型 / 按天 / 按 API Key,含缓存命中/未命中与真实费用)。

## 为什么需要"同步令牌"

DeepSeek **官方公开 API 没有用量查询**:
- `GET https://api.deepseek.com/user/balance` 只有**余额**,没有 token 用量;
- 用量只存在于**网页控制台私有接口** `platform.deepseek.com/api/v0/usage/by_api_key/{amount,cost}`,它认的是**网页登录态的 `userToken`**(`sk-` API key 会被拒:`40003`)。

因此,主页无法"替你登录 DeepSeek",只能**复用你官网已登录的会话令牌**。

## 如何同步(三选一,任选其一)

1. 用浏览器登录 https://platform.deepseek.com/usage
2. 打开主页 `/admin` → 「Token 用量」标签
3. 任选一种方式:

### 方式 A:拖拽书签(推荐)
- 把「**⇢ 拖到书签栏**」链接**拖到浏览器书签栏**(不要点击;点击会在当前页运行)。
- 回到已登录的 `platform.deepseek.com/usage`,点这个书签 → 页面右上角出现「✅ 已同步」。

> 之前的「复制同步书签」文本方式容易在新建书签时被浏览器剥掉 `javascript:` 前缀导致「点了没反应」;
> 拖拽可完整保留协议,是书签方式里最可靠的。

### 方式 B:控制台命令(最稳,不依赖书签)
- 点「**复制控制台命令**」→ 在已登录的 `platform.deepseek.com` 页面按 **F12 → Console** 粘贴回车
  (Chrome 首次粘贴需先输入 `allow pasting`)。
- 命令会自动读取 `localStorage.userToken` 并同步,右侧出现结果提示。

### 方式 C:手动粘贴(兜底)
- 点「**复制取令牌命令**」→ 在官网 Console 执行,令牌已复制到剪贴板;
- 回到 `/admin` → 「Token 用量」输入框**粘贴保存**。

> 若拿到的是 `sk-` 开头的内容,那是 **API Key**,不是网页令牌 —— 请确认已登录网页控制台再试。
> 令牌 `userToken` 仅存服务器数据库(`meta`),**绝不下发前端**。

## 有效期与失效

- `userToken` 是登录会话令牌,通常**有效期数天到数周**(若可解析出有效期,admin 会显示"有效期至";解析不出的新格式也照常用——校验仅要求非空、非 `sk-`,是否有效以"验证 / 刷新"为准);
- **不需要每天同步**;只有在**登出官网 / 清缓存 / 过期**后,平台返回 `40002/40003` 时,再点一次书签重同步即可;
- 面板若显示"令牌失效",去 admin 重新同步。

## 数据与口径

- 接口:
  - 按月粒度:`GET platform.deepseek.com/api/v0/usage/amount?month=&year=`(取**全量模型清单**,含零用量模型,用于模型置灰)
  - 每月导出:`GET platform.deepseek.com/api/v0/usage/export?month=&year=`(返回 ZIP,解析 `amount-YYYY-M.csv`,还原按 **天 × 模型 × API Key** 的 tokens/请求/费用;费用 = `price × amount`,与平台账单精确一致)
  - 两个都需浏览器特征头绕 WAF;`export` 数据与 `by_api_key` 实时一致(无滞后)
- 区间由请求侧换算为**月份集合**再按天过滤:
  `今天 / 昨天 / 近7天 / 近30天 / 本月 / 上月 / 自定义`(自定义为日期区间,上限 12 个月)
- 时间口径:平台接口以**平台日**为准(与官网「本月」一致);"今天/昨天"用**北京时间**计算边界,当天数据可能有延迟
- 平台无小时级数据,因此没有"24h";"今天/昨天"即对应自然日
- 面板模型 chips 来自接口返回的**全量模型清单**,零用量模型**置灰但仍可点击**;
  **API Key** 维度(`coding`/`yijing64` 等)可选组合(多选),只显示 `api_key_name`,不下发掩码 key / user_id
- 主页会**缓存 5 分钟**(按月缓存);失败时按 **上次成功数据 → 本地 `usage` 表 → demo** 依次回退
  (`GET /api/usage` 返回 `source` 分别为 `deepseek` / `stale` / `local` / `error`),面板注明数据来源与更新时间
- 本地表来自自建服务的 `POST /api/usage` 上报(见 `docs/REPORTING.md`),按 `range` 聚合展示

> 曾用 `by_api_key/amount|cost` 接口拉取(北京整日窗口),仅支持尾部 5~32 天窗口、无小时数据;
> 2026-09 起改为**按月粒度 + 每月导出**接口,统一支持历史任意区间、保留零用量模型,并带 API Key 维度。

## 安全与风险

- `userToken` 属**账号级敏感凭证**:仅存服务器数据库(`meta`),**绝不下发前端**、不写日志;书签同步用一次性"同步密钥"鉴权(可在 admin 轮换);
- 走的是 **DeepSeek 网页私有接口**,可能因风控/改版失效;届时重同步或等待适配即可;
- 请在了解上述风险的前提下使用。

## 平台改版与自愈(2026-10 踩过的坑)

**2026-10-17**(V4.1-Flash-1017 上线)平台把导出的 `amount-*.csv` 从

```
user_id,utc_date,model,api_key_name,api_key,type,price,amount
```

改成

```
user_id,utc_date,model,name,api_key_name,api_key,type,price,amount   ← 多了一列 name
```

旧解析**按位置**解构 → `type/price/amount` 全部右移一格 → 所有指标算成 0 → 被过滤成空行;
而拉取本身"成功"(不报错、还清空了 `lastError`)→ 可用性判定"没数据"→ 面板整块消失、
没有任何提示。**教训:这种"静默 0 行"比报错更难查。**

现在的防线(三条,互相兜底):

1. **按表头名解析**(`parseAmountCsv`,`@zx/shared`):忽略新增/多余列(如 `name`、`wallet_type`)、
   兼容旧表头;ZIP 内文件名只要求 `amount-*.csv`。
2. **不再静默**:找不到 CSV / 缺必需列 / 有数据行却解析出 0 行 → **抛错并写 `deepseek_last_error`**,
   admin 页出红色「平台明细异常」;`/api/usage/sources` 在"已配置但失败"时也保留 tab。
3. **官方余额哨兵**:每 6h 用 `GET https://api.deepseek.com/user/balance`(API Key 鉴权,
   与网页令牌无关)采样余额;若**余额在下降但平台明细 0 行** → 直接判定接口又改版并写 lastError。
   admin「Token 用量」页会显示:`余额 ¥xx · 较昨日花费 ¥yy · 校验时间`。

> 平台改版后**不需要补数据**:导出是按整月给的,修好解析重拉一次,历史区间自动回来。

## 官方 API 有没有用量接口?(2026-10 现状)

**没有。** 官方 API Reference 只有:`chat/completions`、`responses`、`completions`(FIM)、
`models`、`user/balance`、`files`、`search`/`fetch`。跟账户有关的只有 `GET /user/balance`
(余额),**没有 usage/billing/consumption 端点** —— 所以"按天×模型×Key + 真实费用"的明细,
目前只能走网页控制台的私有接口(即本文档上面那套 `userToken` 方案)。
