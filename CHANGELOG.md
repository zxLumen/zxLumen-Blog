# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

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

[0.1.0]: https://github.com/ALeiQ/zxLumen-Blog/releases/tag/v0.1.0
