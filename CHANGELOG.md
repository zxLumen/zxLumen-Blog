# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

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
