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

## blog / 应用栏

- [x] 右侧应用栏(macOS Dock):桌面右侧竖排常驻 + 移动端底部横排,10 套布局适配,右下角悬浮件避让 — 优先级:中
- [x] admin「应用」面板:整表增删改 / 拖拽排序 / 分组 / 垃圾箱 / 恢复默认,存 `meta.apps_config` — 优先级:中
- [x] 图标上传:浏览器端压到长边 256px,落 `docker/site-content/apps/`,Caddy 经 `/apps/*` 供图 — 优先级:中
- [x] 访客自定义应用顺序:按住图标拖动改自己的顺序,存 `localStorage`(MOCK 身份带后缀隔离),刷新保留、只在自己分组内挪、跨组拒绝,admin 增删自动对账,栏尾 ↺ 恢复默认;admin 与访客共用同一套 Pointer 拖拽 hook — 优先级:中
- [x] **分组连续性两侧强制**:访客存档按分组归拢(`groupContiguous`,修「分组前存的交错顺序」导致同组被拆、多出分隔线);admin 跨组拖拽由 `snapDropToGroup` 夹到组边界(落点提示与提交共用同一结果),从源头保证提交不出交错顺序 — 优先级:中
- [x] **站内静态文件按「打开方式」处理**:`isSpaRoute` 区分「站内页面路由」(走 `next/link`)与「站内静态文件」(`/resume.pdf` 等,按设置决定 `target`)—— 修此前 `/resume.pdf` 选「新标签页」仍只在当前页打开;admin 面板该选项补了说明 — 优先级:中
- [x] 纯函数入库测试:`packages/shared/tests/`(node --test,零新依赖),覆盖 `groupContiguous` / `snapDropToGroup` / `applySavedOrder` / `isSpaRoute`;`npm test` 先 build 再跑 dist — 优先级:中
- [ ] **顺序上云**(当前顺序只在本机浏览器):若想让访客换设备也保留,需加一张表按 `cid` 存顺序,并定「多端冲突以谁为准」;不上云则清缓存即丢 — 优先级:低
- [x] **第三种打开方式 `panel`(页内浮层)**:`openIn` 新增 `panel`,应用在站内以可拖拽/可缩放的悬浮窗打开(iframe,复用 portal + floating 让位逻辑),窄屏全屏;第一个用户是自建 Opentodo 网页版 — 优先级:低
- [ ] 应用栏点击埋点(哪些应用被点、点击率排序),可接进 `docs/STATS.md` 口径 — 优先级:低

## blog / 内容整理

- [ ] 整理项目内容,该归档的归档(考虑折叠起来)— 优先级:中
- [ ] 改标题 — 优先级:中
