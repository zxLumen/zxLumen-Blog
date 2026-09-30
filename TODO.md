# TODO / Roadmap

个人主页(zxLumen-Blog)的待办清单。状态:`未开始` → `进行中` → `已完成`;优先级:`高 / 中 / 低`。

## ai lighting

- [ ] 在 blog 制作漂浮红绿灯组件 — 优先级:中
- [ ] 将红绿灯组件与 blog 的 AI 机器人结合 — 优先级:中

## blog / 机器人

- [x] 用我的数据做问答机器人(人格蒸馏 + 知识库 RAG + 多 provider;见 `docs/CHATBOT.md`) — 优先级:中
- [ ] 增加 admin 管理机器人,直接通过对话对 blog 进行管理 — 优先级:中

## blog / vlog

- [ ] 增加 vlog 页,展示抖音旅行视频,支持点赞评论 — 优先级:中
- [ ] 主页 home 右侧空白位置放 vlog,每次刷新播放的都不同 — 优先级:中
- [ ] **自建播放器(替代官方 iframe)**:已验证可行 —— 官方 `aweme/detail` 响应的 `video.play_addr` 能拿到 3 条 mp4 URL(最高只有 720p,单条约 6.5MB),浏览器可直连 CDN(`Access-Control-Allow-Origin: *`,96 条里仅约 1 条 URL 已失效),服务端 fetch(不带 Referer)也通(`206 video/mp4`)。做法:抓 mp4 存进 `docker/site-content/` 由 Caddy 直供(不过服务器流量),前端换成原生 `<video>`。收益:单击/拖动/进度/统计完全可控、不再被 iframe 吃掉拖动、封面挡画面这类问题从根上消失。代价:占服务器存储、播放量算我们自己的、去掉抖音播放器 UI;需处理播放源过期(加刷新入口 + `onError` 自动回退 iframe)。— 优先级:中

## blog / 迁移

- [ ] 把 CSDN 内容迁移到这个 blog — 优先级:中

## blog / 运维

- [ ] 增加服务器监控 — 优先级:中

## blog / 内容整理

- [ ] 整理项目内容,该归档的归档(考虑折叠起来)— 优先级:中
- [ ] 改标题 — 优先级:中
