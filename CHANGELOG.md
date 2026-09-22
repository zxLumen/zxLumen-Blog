# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- **用量面板按源隐藏空数据源**:各数据源(含 DeepSeek)只有「已配置 且 近 30 天有数据」时才显示切换按钮;SSR 即算好可用性(避免隐藏源闪现),无数据的源(如按量智谱账号,monitor 接口仅 Coding Plan 可用)自动隐藏
- **智谱用量数据源**:新增「智谱」源(功能门控 `usage-zhipu`),读 monitor API 给出**区间内按模型 token 总量** + **配额条**(5 小时/每周 token、MCP 月度、套餐等级);admin 可配 API Key(裸 key)与 baseURL(国内/国际)。局限:智谱无逐日/逐小时明细与费用,故无日趋势、无输入/输出/缓存拆分(总 tokens 准确)。见 `docs/ZHIPU-USAGE.md`
- **OpenCode Go 费用折算 + 配额展示**:官方导出的 `cost_micro_cents` 对 Go 订阅恒为 0;面板改用 **token × Go 价目表**折算美元(与 Console 同口径,含 Peak/Off-Peak),价目内置 `go-pricing.ts`(全量模型、促销截止标注);并在数据源为 OpenCode 时展示 **Go 5 小时 / 周 / 月 配额**(真实百分比 + 重置时间,来自 `/zen/go/v1/usage`)
- **DeepSeek 今天/昨天分时**:接平台 `by_api_key/amount(+cost)` 小时级接口(北京时窗口、bucket=3600),与 OpenCode 共用同一套模板——今天/昨天在天级图里直接画 24 根小时柱,其余区间按天;移除两平台在文案/粒度上的差异(HOURLY 面板、平台特殊提示均删除)
- **OpenCode 用量数据源改为官方 Console**(读取组织内完整数据):可用未用的 `sk-` BYOK key 官方拒收,需在 Console 创建 service-account key(`oc_sk_…`,admin 或 `OPENCODE_SERVICE_KEY` 配置);官方只提供最近 30 天(UTC 零点对齐)导出,拉取后按每请求精确时间戳本地聚合;今天/昨天**在天级图里直接画 24 根小时柱(北京时)**(移除独立的 HOURLY 面板,全平台共用),其余区间按天;越界区间返回 `platformLimit`；成本 USD(microcents/1e8)
- **模型选单按使用频率排序**:按区间内 tokens 总量从高到低排,零用量模型(DeepSeek 置灰)排最后
- **DeepSeek 令牌同步改为三种可靠入口**:拖拽书签(`javascript:` 协议不再被浏览器删除)、复制控制台命令(自动读取 `userToken` 直接同步)、复制取令牌命令(手动粘贴兜底);书签/命令兼容 `{value}` 与纯字符串、拒绝 `sk-` API Key、结果用告警 + 页面角标双重提示
- 服务端 `/api/deepseek/token` 增加 `Access-Control-Allow-Private-Network`,兼容从公网 https 页面同步到本地服务(Chrome PNA 预检)
- **用量时间区间重构**:去掉 24h / 90d,新增 **今天 / 昨天 / 本月 / 上月 / 自定义**(自定义日期区间的选择器);「今天/昨天」替代 24h(平台无小时级数据),按月粒度统一支持任意历史区间(上限 12 个月),修复此前「24h 显示成 30d」「90d 无内容」的问题
- **零用量模型置灰保留**:面板模型 chips 基于平台返回的全量模型清单,当前区间无用量的模型**置灰但仍可点击**;自定义区间用「应用」按钮确认后拉取
- **MOCK 每个身份 = 一台独立设备**:模拟访客身份除匿名 ID 外,昵称与主题也按身份分键(`zx_nick.<id>` / `zx-theme.<id>`),切 A/B/C 各自独立、互不影响;昵称默认留空、填后各自记住;首帧主题脚本按身份注入
- **归档记录并展示访客删除者**:comments 新增 `archived_by_cid`,访客自删时记录其匿名 ID;admin 归档页对齐留言板(根留言 + 嵌套子回复,按删除时间倒序),显示作者 cid;访客只能删自己的留言,故不再单独展示删除者
- **用量筛选按数据源各自保存**:时间区间 / 自定义日期 / 模型筛选 / Key(提供方)筛选均按 DeepSeek 与 OpenCode 各存一份,切换数据源时整套按钮自动切到该源的记忆状态;存档经 cookie 下发,SSR 首帧即正确、刷新无闪跳(首次切到某源用默认「近30天」)
- **API Key 维度**:新增「全部 API Key / 各 key」多选 chips,与模型筛选**组合过滤**指标/柱状/占比/明细;RECENT 明细新增「key」列;只显示 `api_key_name`,不下发掩码 key 与 user_id
- 管理后台 Tab 状态持久化改为 `localStorage`(首帧同步初始化),刷新/新开标签页都停留在当前 Tab 而非跳回留言页

### 修复

- **修复 admin 登录校验被绕过**(严重):`/api/admin/login` 漏写 `await`(校验函数改为 async 后未同步),Promise 恒为真导致**任意非空密码都能登录**;补上 `await`,错误密码恢复 401
- **admin 认证加固**:去掉 `ADMIN_PASSWORD` 的 `'admin'` 默认与 `SESSION_SECRET` 的兜底密钥——未配置且库无哈希时**禁用登录**;生产环境未设 `SESSION_SECRET` 时**拒绝签发/校验会话**(返回 503),避免弱默认值被利用
- 修复 DeepSeek 今天/昨天分时费用全为 0:cost 接口的分时 series 在 `data[0].series`(amount 接口在顶层),原先只读顶层导致 costMap 为空;按小时费用现与平台导出对账一致
- 修复拖拽书签项被 React 重置 `href` 为空导致「点击跳回 admin」:书签链接不再声明 `href` 属性,改为 `onDragStart` 时写入完整脚本地址
- 放宽同步令牌校验:`userToken` 可能不再是三段式 JWT,改为仅要求非空、非 `sk-`(是否有效以「验证 / 刷新」实测为准),修复「同步失败 invalid token」
- **适配平台 2026-07 改版用量接口**:`start/end` 改为北京零点对齐整日窗口、`series[].buckets[].time` 按 epoch 秒换算日、cost 字符串、`api_key` 对象归一为名称标签,真实用量拉取恢复(此前返回 `INVALID_PARAM`);admin「最近同步」时间改为本地时区显示
- **修复区间回退错位**:区间切换后以实时结果为准,「今天/昨天」等空区间不再回退到 30d 的 SSR 数据或 demo,而是如实显示"该区间暂无真实数据"
- **修复日趋势柱状图只有单柱**:柱状图按区间(SSR 窗口 + 实时接口返回的 start/end)补齐到每一天,无用量天显示灰色占位条,不再只画有数据的那天

### 变更

- **环境模型收敛为「本地 TEST → 打包 → 线上生产」**:线上只有一个生产环境,`NODE_ENV=production` 时整站 TEST 模式禁用(`isTestMode()` 恒 false、`EnvSwitch` 不渲染、`POST /api/env` 403);确需线上临时开通才设 `ALLOW_TEST_MODE=1`
- **TEST 数据全面隔离**:`settings` / `deepseek` / `opencode` / `usage` 等所有元数据读写从直连主库改为 `getActiveDb()`,TEST 模式下与 `comments` 一样读写独立测试库(此前仅 comments 隔离,配置/密钥等仍会写到线上库)
- 生产容器补充 `DB_TEST_PATH=/data/zx.test.db`(随 `zx-data` 卷持久化),测试库不再随容器重建丢失
- **用量数据源改为按月接口 + 每月导出**:`amount` JSON 取全量模型清单;`export` ZIP(解析 amount CSV)还原按 (天 × 模型 × API Key) 的 tokens/请求/费用(费用=price×amount),数据与 `by_api_key` 实时一致;`GET /api/usage` 新增 `models`/`apiKeys` 字段;移除 `cost` 按月接口与 `by_api_key` 窗口口径
- **用量失败回退真实数据**:平台拉取失败时先回退「上次成功数据」(按 range 持久化到库),再回退本地 `usage` 表(按 range 聚合);`GET /api/usage` 返回 `source` = `deepseek` / `stale` / `local` / `error` 并携带更新时间
- **面板数据源标注如实**:区分实时 / 上次数据 / 本地表 / demo 四态并显示「更新于」,修复「0 行仍标注实时数据」的错位提示
- admin「Token 用量」状态栏显示「上次成功 N 行」与时间

### 文档

- `AGENTS.md` / `README.md` / `docs/DEPLOY.md`:工作流由「TEST 先行 → 同步 LIVE」改为「本地开发 → 打包 → 线上生产」;说明生产禁用 TEST、`ALLOW_TEST_MODE` 与全库隔离
- `GET /api/env` 增加 `available` 字段(当前环境是否允许 TEST)
- 修正 README API 表 `?days=30` → `?range=30d`;`docs/DEEPSEEK-USAGE.md` 同步三种用法与回退链说明
- 重写 `docs/OPENCODE-USAGE.md`:官方 Console 数据源、service-account key 创建步骤、分时/平台覆盖与部署说明

## [0.5.0] - 2026-09-20

### 新增

- **Token 用量面板接入 DeepSeek 账号真实数据**:`/admin` 提供**书签一键同步** `userToken`(存主库、仅服务器),显示状态与有效期、可轮换同步密钥、支持手动粘贴兜底
- 面板支持 **24h / 7d / 30d / 90d** 与 **整体 / 多模型**切换;展示真实**成本**与**请求数**(按天 × 模型,数据来自 DeepSeek 平台)
- 新增文档 `docs/DEEPSEEK-USAGE.md`(原理、同步步骤、风险)

### 变更

- 用量页标题 `DeepSeek 用量` → **`Token 用量`**
- 数据源优先级:DeepSeek 平台 → 本地 `usage` 表 → demo 曲线;平台数据**缓存 5 分钟**、失败自动回退

[0.5.0]: https://github.com/zxLumen/zxLumen-Blog/releases/tag/v0.5.0

## [0.4.3] - 2026-09-20

### 新增

- **`/admin` 支持上传/更新微信二维码**:PNG/JPEG/WebP、≤800KB,存数据库,前台 URL 带版本号**即时生效**(URL 走 `/api/contact/wechat-qr`,长缓存);不再需要手动上传 `wechat.png`

### 变更

- 微信二维码浮窗尺寸放大到原来的 **1.5 倍**

[0.4.3]: https://github.com/zxLumen/zxLumen-Blog/releases/tag/v0.4.3

## [0.4.2] - 2026-09-20

### 变更

- 点击「微信」按钮:复制微信号的同时,在**点击处右上角弹出微信二维码浮窗**;点击其它位置 / `Esc` / 滚动即关闭
- 新增 `Contacts.wechatQr`;二维码 `public/wechat.png` **不入库**,部署时需手动上传(见 `docs/DEPLOY.md`)

[0.4.2]: https://github.com/zxLumen/zxLumen-Blog/releases/tag/v0.4.2

## [0.4.1] - 2026-09-20

### 修复

- **修复主题/布局下拉在 SIDEBAR 下显示不全**:改回 **portal + fixed** 定位,自动选择「右侧 / 下方」展开,不再被容器 `overflow` 裁剪;跟随滚动/resize 重定位,支持 `Esc` 关闭

[0.4.1]: https://github.com/zxLumen/zxLumen-Blog/releases/tag/v0.4.1

## [0.4.0] - 2026-09-20

### 新增

- **测试模式放行全部 18 主题 + 10 布局**进行预览;正式环境仍为精简集(**6 主题 + SIDEBAR**)
- 测试模式恢复「布局」切换:选择器「布局」Tab 与 `Shift+1`–`0` 快捷键;正式环境隐藏布局入口

### 变更

- 首帧脚本按模式注入**可用集合**:非放行主题/布局(localStorage)自动回退默认;切换模式后自动收敛
- 主题快捷键:正式 6 个用 `1`–`6`;测试模式其余 12 个用字母

[0.4.0]: https://github.com/zxLumen/zxLumen-Blog/releases/tag/v0.4.0

## [0.3.1] - 2026-09-20

### 新增

- **`/admin` 支持设置联系方式**(邮箱 / 微信 / 电话),前台「关于」与页脚**即时生效**(存主库 `meta`)

### 变更

- 电话**不再随页面下发**:点击「☎ 电话」时向后端 `/api/contact/phone` 获取(带限流),确保号码不出现在 HTML / RSC 数据 / 打包产物中(移动端 `tel:` 拨号,桌面端复制)

[0.3.1]: https://github.com/zxLumen/zxLumen-Blog/releases/tag/v0.3.1

## [0.3.0] - 2026-09-20

### 新增

- **「联系我」支持三种方式**:邮件(`mailto`)、**微信**(点击复制微信号,便于添加好友)、**电话**(移动端点击直接拨号 `tel:`,桌面端复制到剪贴板)
- 电话**不在页面显示号码**:以倒序存储、运行时还原,仅用于拨号/复制(不进 HTML)
- 联系方式同时出现在「关于」与**页脚**

[0.3.0]: https://github.com/zxLumen/zxLumen-Blog/releases/tag/v0.3.0

## [0.2.2] - 2026-09-20

### 安全 / 隐私

- **个人资料移出仓库**:真实内容改放不入库的 `packages/shared/src/content.local.ts`;仓库仅保留占位 `content.local.example.ts`,构建前自动生成缺失的本地文件
- **从 git 历史中清除** `public/resume.pdf`(含手机号);简历 md/html/pdf 与 `public/resume.pdf` 均加入 `.gitignore`
- 部署说明补充:需单独提供 `public/resume.pdf` 与 `content.local.ts`

> 注:公开仓库的旧对象可能被 GitHub 缓存一段时间;如需彻底清除缓存视图,可联系 GitHub 支持。

[0.2.2]: https://github.com/zxLumen/zxLumen-Blog/releases/tag/v0.2.2

## [0.2.1] - 2026-09-20

### 变更

- 履历时间修正:腾讯任职与「音频管线」项目结束时间更新为 `2025.10`
- 项目卡新增**时间区间**展示(按简历补齐各项目起止)
- 简历 PDF 更新(腾讯 `2025.04 – 2025.10`)

### 说明

- **个人信息相关文件不再纳入版本库**:`resume/resume.md`、生成的 `resume.html` / `resume.pdf`、`public/resume.pdf` 已加入 `.gitignore`;仅保留生成脚本 `resume.py` 与样式 `resume.css`
- 部署时 `public/resume.pdf` 需**单独提供**(不随仓库分发)

[0.2.1]: https://github.com/zxLumen/zxLumen-Blog/releases/tag/v0.2.1

## [0.2.0] - 2026-09-20

自 `v0.1.0` 以来:留言体验、后台与导航大幅完善;填入真实简历内容。

### 新增

- **留言分页改版**:页码 + 每页下拉(5/10/20/50/100,默认 5)+ 「共 N 条」+「前往 X 页」;按**顶层留言线程级**分页,回复不拆分
- **网页改密码**:`/admin` 可修改站长密码,scrypt 加盐哈希存库,**优先于环境变量** `ADMIN_PASSWORD`
- **测试库 mock 脚本**:`npm run seed:test`(仅写测试库)
- **地址栏跟随**:首页滚动时 `#hash` 实时同步当前区块(`replaceState`)
- **内容更新**:依据简历更新资料、技能、时间线与重点项目;关于页新增「**下载简历**」

### 修复

- 修复留言板左侧表单被右侧内容拉伸变形(网格改 CSS 类 + 反拉伸)
- 禁止非管理员冒用站长昵称(去空白/大小写归一化校验)
- 管理员会话改为 **HMAC 签名 cookie**,重启/清库后保持登录
- 侧栏导航改为 **scroll-spy** 高亮,并新增首帧 `html[data-nav]`(消除刷新/跳转先闪 home)
- 同路由与跨路由导航改**客户端处理/客户端路由**,消除点 `home` 的白屏刷新
- 关闭锚点平滑滚动(点击导航瞬时跳转);修复刷新带 hash 页面掉回 home

[0.2.0]: https://github.com/zxLumen/zxLumen-Blog/releases/tag/v0.2.0

## [0.1.0] - 2026-09-20

首个可运行版本:个人主页(Next.js + SQLite,自托管)。

### 新增

- **主题系统**:6 套主题(GITHUB / NORD / SYNTHWAVE / DRACULA / ROSE PINE / MINIMAL),token 驱动,支持纹理与明暗;顶栏下拉选择器、快捷键 `1`–`6`、`[`/`]` 循环,无闪烁(localStorage + 内联脚本)
- **布局**:固定 SIDEBAR(左侧竖排导航)
- **首屏**:终端打字机 + 随主题变化的 ASCII;隐藏彩蛋(连点 ASCII 四次进入 admin)
- **项目展示**:卡片 + 状态徽章 + 技术栈 + 跳转 demo
- **DeepSeek 用量面板**:总览 / 日趋势 / 模型占比 / 最近调用;无真实数据时展示 demo 曲线;`POST /api/usage` 上报(共享密钥)
- **关于 / 简历**:bio、技能、时间线
- **留言板**:公开 / 仅站长可见;支持**回复**(单层缩进 + `回复 @昵称`);**昵称 cookie 记忆**与 SSR 预填;**递归删除**整棵回复子树
- **Admin**:cookie 会话鉴权(随机 token 存库,登出即失效);私密留言查看与删除;可设置**站长昵称**(留言自动署名)
- **测试模式**:整站 LIVE / TEST 切换(独立测试库),仅站长可用;一键清空测试库
- **部署**:多阶段 Dockerfile、docker-compose(app + Caddy 自动 HTTPS)、Caddyfile(含子域名模板)、SQLite 备份脚本、部署与上报文档

[0.1.0]: https://github.com/zxLumen/zxLumen-Blog/releases/tag/v0.1.0
