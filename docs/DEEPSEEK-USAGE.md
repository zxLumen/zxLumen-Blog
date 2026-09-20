# DeepSeek 用量(平台真实数据)

主页的「Token 用量」面板可直接展示你 **DeepSeek 账号的真实用量**(按模型 / 按天 / 按 API Key,含缓存命中/未命中与真实费用)。

## 为什么需要"同步令牌"

DeepSeek **官方公开 API 没有用量查询**:
- `GET https://api.deepseek.com/user/balance` 只有**余额**,没有 token 用量;
- 用量只存在于**网页控制台私有接口** `platform.deepseek.com/api/v0/usage/by_api_key/{amount,cost}`,它认的是**网页登录态的 `userToken`**(`sk-` API key 会被拒:`40003`)。

因此,主页无法"替你登录 DeepSeek",只能**复用你官网已登录的会话令牌**。

## 如何同步(推荐:书签脚本)

1. 用浏览器登录 https://platform.deepseek.com/usage
2. 打开主页 `/admin` → 「DeepSeek 用量」→ 点 **复制同步书签**
3. 在浏览器书签栏**新建一个书签**,地址粘贴刚复制的内容(整段 `javascript:...`)
4. 在 **platform.deepseek.com 已登录**的页面上点这个书签 → 提示"✅ 已同步"
5. 回到 `/admin` 会显示**状态 / 有效期至**,前台「Token 用量」面板即显示真实数据

> 备用:在官网 F12 → Application → Local Storage → `https://platform.deepseek.com` → `userToken`,
> 复制其 `value`(或 Console 执行 `localStorage.getItem('userToken')`),粘贴到 admin「手动粘贴 userToken」保存。

## 有效期与失效

- `userToken` 是登录会话 JWT,**有效期通常数天到数周**(admin 里直接显示"有效期至");
- **不需要每天同步**;只有在**登出官网 / 清缓存 / 过期**后,平台返回 `40002/40003` 时,再点一次书签重同步即可;
- 面板若显示"令牌失效",去 admin 重新同步。

## 数据与口径

- 接口:`GET platform.deepseek.com/api/v0/usage/by_api_key/amount|cost?start=&end=&tz=28800`
  (北京时间分桶,需浏览器特征头绕 WAF)
- 返回按 **(天 × 模型 × API Key)** 拆分的用量桶;面板据此展示指标、日趋势、模型占比与明细
- 主页会**缓存 5 分钟**;失败时回退上次数据/本地表/demo

## 安全与风险

- `userToken` 属**账号级敏感凭证**:仅存服务器数据库(`meta`),**绝不下发前端**、不写日志;书签同步用一次性"同步密钥"鉴权(可在 admin 轮换);
- 走的是 **DeepSeek 网页私有接口**,可能因风控/改版失效;届时重同步或等待适配即可;
- 请在了解上述风险的前提下使用。
