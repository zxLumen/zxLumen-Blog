# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- **右侧应用栏(macOS Dock)**:全站右侧常驻一列应用图标,`position: fixed` **不随页面滚动**。桌面竖排、悬停显示名称气泡、图标加载失败回退「名称首字」;**移动端(`≤820px`)自动变成底部横排**的胶囊条。挂 `Shell` 故**所有页面**都有(不再只主页);应用栏为 0 个时整体不渲染、也不占位。10 套布局都适配:右侧栏 / 居中 / 窗口 / 侧边栏等各有对应定位,`window` 布局内缩留边。原有右下角「访客统计 + 服务器状态 + 聊天 FAB」在应用栏存在时自动左移避让,不存在时回到原位。
  - **admin「应用」面板**:新增「应用」Tab,整表管理(**增 / 改名 / 改链接 / 排序 / 删除到垃圾箱 / 清空 / 恢复默认**),存 `meta.apps_config`(整表 JSON 覆盖、无迁移)。删错的进垃圾箱可单独恢复;「恢复默认」= 删掉该 meta 回退出厂列表(GitHub + 简历)。支持**分组**,组间画一条细分隔线。
    - **拖拽排序**:每行左侧有 ⠿ 把手,按住可拖到任意位置,悬停时目标行按指针在上/下半显示插入线(3px 高亮边);松手即改顺序。**鼠标与触屏都能拖**(改用 Pointer Events + `setPointerCapture` 自建,不再是浏览器原生 HTML5 DnD —— 原生在手机上根本不触发),↑↓ 按钮保留作为键盘/无障碍兜底。只重排**可见项**占的槽位,垃圾箱里的条目原地不动,不会被搅乱。**拖到别的分组时不会落进该组成员中间**,而是夹到该组最近的一条边(`snapDropToGroup`,落点提示与实际落点共用同一个结果,所见即所得)—— 保证 admin 排出来的顺序里**同组永远连续**。admin 拖的就是**所有访客的默认顺序**,一旦出现「同组被别的组劈开」的交错,每个访客都会看到多余分隔线,而访客的 ↺ 只重置访客顺序、回到这个交错默认,救不了。拖动中的 id 与落点用 `ref` 而非 state 当真相:`pointerdown → pointermove → pointerup` 是连续几个任务,state 要等重渲染才提交,读 state 会拿到旧值导致整条拖拽静默失效。
  - **访客可以自己拖顺序**(存浏览器、**互不影响**):admin 排的是**默认**顺序,访客**按住任意图标即可拖动改自己的顺序**,刷新后仍在,换台设备/换个浏览器就是另一份。**只能在自己所属的分组内挪**(admin 定的分组访客改不了),跨组拖拽会被直接拒绝。顺序存 `localStorage`(`zx_apps.order`;MOCK 身份各自带后缀,互不干扰),**不写数据库**。admin 之后增删应用,访客那份会自动对账:删掉的剔除、新增的插回 admin 给的相对位置,不用访客手动重排。改乱了栏尾出现 **↺ 恢复默认**,点了就回到 admin 顺序。访客存的顺序每次渲染都会**按分组归拢**一次(`groupContiguous`:组内相对顺序保留、组间按各组首个成员的首次出现顺序),于是即便存档里是「分组之前拖出的交错顺序」(如 `github, rag, resume`),也不会出现同组被拆、凭空多一条分隔线;归拢后画面若恰好等于 admin 默认,↺ 会自动收起(比的是**渲染结果**而非原始存档)。拖到边缘会自动滚动。移动端底部横排同样可拖(落点亮边改到左右两侧,跟着排布方向走)。
  - **图标上传**:面板内逐条上传,**浏览器端先压到长边 256px** 再发(省流量、不给服务器压力),落 `docker/site-content/apps/<id>.<ext>`,由 Caddy 经 `/apps/*` 静态服务,**换图即生效**;可单个删除,换格式时自动清掉旧扩展名。
  - **打开方式**:每条可设 `新标签页` / `当前页`。**站内页面路由**(`/`、`/#vlog`、`?x=1`)强制走 `next/link`(不让访客离开 SPA,保留右键新开);**站外链接**与**站内静态文件**(`/resume.pdf`、`/wechat.png` 这类由 Caddy 直接吐字节、应用内没有对应路由的)则按设置决定 —— 选「新标签页」就真的 `target="_blank"`(修:此前站内地址一律被当成路由,`/resume.pdf` 选新标签页也只在当前页打开)。
  - **输入清洗**(存库前统一规范化):`id` 只允许 `[a-z0-9-]{1,40}`(挡路径穿越,非法项**丢弃**);裸域名自动补 `https://`;**`icon` 只允许站内 `/apps/*` 路径**(挡外链图标注入);未知 `openIn` 退回 `newtab`(为将来的第三种方式留门);无 URL 的条目丢弃。上传接口按**文件魔数**判类型(不信声明的 MIME)、限 2MB / 至少 64px,并**校验 PNG 的 IHDR 块结构与宽高合理性** —— 只看签名会被「签名 + 乱码」骗过(实测被读成 117901063×117901063)并**覆盖掉本来能用的图标**,现已拦下且不覆盖。
  - **「配置成空数组」= 真的零应用**:未配置过才回退出厂默认;一旦保存过就以配置为准(含空),所以能整体撤掉应用栏。
  - 部署:`docker-compose.yml` 加 `./site-content/apps:/srv/site/apps` 可写子挂载;**首次上线**需在服务器 `sudo chown -R 10001:10001 ~/zxLumen-Blog/docker/site-content/apps`(之后换图不需要)。本地点 `apps/next-home/public/apps` 软链以对齐线上。

- **token用量「数据源顺序」可调**:admin「Token用量」新增「数据源顺序」面板,可 ↑/↓ 调整 **DeepSeek / OpenCode / 智谱** 的展示顺序并保存;首页 Token用量 的供应商 tab 按该顺序渲染(未设置时保持出厂默认序 DeepSeek→OpenCode→智谱)。顺序存 `meta.usage_source_order`,保存即生效、无需重建。
- **响应式全面优化(320px 手机 ~ 3440px 大屏)**:大屏原先是「冻结」状态——容器宽度固定 1120px,视口超过约 1136px 后内容完全不动(2560px 屏每侧空 740px、3440px 空 1160px),字号也不再增长。现按布局性质分档(新增 ≥1440 / ≥1920 / ≥2560 三档):阅读型约 1280→1360px,窄栏型 `centered`/`magazine` 900→1040px,密度型 `compact` 1440→1760px,展示型 `showcase`/`bento`/`fullbleed` 1680→2240px,并让 `bento` 栅格在宽屏真正展开为多列;同时修掉三处肉眼可见的宽度错位(窄栏型布局的 hero/顶栏/页脚仍是 1120px,导航与正文错位 130~150px;页脚比正文宽 40px 且左移 20px)。
  - **刘海屏适配**:`viewportFit: "cover"` + 9 处 `env(safe-area-inset-*)`,顶栏不再整排埋进刘海/灵动岛,底部 fixed 悬浮件不再压住 home 指示条。
  - **手机端**:顶栏原本在 375px 下高达 246px(占屏 37%)并压住右上角两个悬浮件——根因是换行规则写在了 `.zx-topbar` 上而真正的 flex 容器是它的唯一子元素 `.zx-topbar-in`,换行从未生效;修正后降到 138px,悬浮件移到空着的左下角,隐藏了只对键盘有意义的快捷键提示。`window` 布局顶栏此前完全不吸顶(`overflow: hidden` 让它变成滚动容器、破坏 sticky),改 `clip` 后恢复。`100vh` → `100dvh`,避免移动端地址栏收缩时底部内容被遮。
  - **admin 窄屏**:9 个 Tab 原先被压到 27px 宽(文字被裁、点不准)且容器越界 94px,现改为横向可滚动、不再被压缩;MOCK 面板宽度改为 `min(300px, 100vw - 2rem)`。
  - **与右侧应用栏协调**:顶栏让位改用 `--zx-gutter` 模型(不再多缩 20px),底部应用栏高度与 `safe-area` **叠加**而非二选一(页脚 / 聊天浮标 / 左下角悬浮件都不被压住);窄屏这三个悬浮件的坐标改由 CSS 决定 —— 它们的位置本是 JS 写成行内 `left/top` 的,桌面存档会在窄屏把悬浮件拽回桌面位置,现窄屏不恢复存档、不写行内样式(聊天浮标每次都用 `defaultPos()`,改在算坐标时扣掉底部横条高度)。
  - 另修:整页补 `overflow-x: clip` 安全网;滚动高亮判定线原写死 130,改为按顶栏实测高度 + 区块 `scroll-margin-top` 计算(并留 1px 余量吸收亚像素误差,否则桌面宽度下高亮整体错一位)。

- **`cover:push`:线上兜底首帧一条命令补齐**:`npm run cover:push` 读线上库算出缺哪些横屏视频,本机 Chrome 现抓抖音首帧(`cover:vlog` 新增 `--vids` 复用生成能力、不依赖本地库),再经 SSH(scp + `sudo install -o 10001`)推到服务器封面目录,末尾抽查线上可访问性;`--dry-run` 只列清单。新增视频后跑这一条即可,不用再手动 `scp`。SSH 目标配在 gitignore 的 `packages/shared/.env.local`(`ZX_SSH`)。

- **admin「机器人 → 灵魂蒸馏」corpus 列表改版**:长列表按状态分组成「出错 / 待处理 / 已入库」三个可折叠区块(+数量角标,已入库默认折叠,看上万个文件不卡屏),新增**文件名筛选**;每组每行**点击即可弹出查看原文**(新接口 `GET /api/admin/chatbot/corpus?name=…`,traversal 安全,弹层内可直接删除);类别下拉/按原文放行/恢复脱敏/删除收进行尾,超长文件名省略号截断 + 悬停看全名。待上传文件也改为**计数 + 前 8 个文件名 chips** + 「清空」按钮,不再把几百个文件名拼成长串
- **蒸馏与上传不再被 15 秒掐断**:admin 面板的上传 / 扫描并蒸馏 / 按原文放行改成**10 分钟长超时**,蒸馏进行中每 5s 自动刷新进度(不用干等一个请求);`classifyText` 对 LLM 只输出思考、没给 JSON 的情况**自动重试一次并放大 maxTokens**,仍失败则**兜底按 knowledge 入库**,不再留「error 死档」文件——下次扫描自动重跑即可消化历史 error
- **公开手机号豁免改为归一化匹配**:语料里的手机号按「去掉空格/+/-/括号、再去掉 86/0086 国号」归一化后与站点公开联系方式比较,`15615636435` 与配置的 `+86 15615636435` 视为同一号码 → 自己的号码不再被脱敏,陌生号码照常脱敏
- **corpus 垃圾内容自动过滤**:蒸馏时按启发式**自动跳过**「备忘录碎屑」——**近空**(去标题/空行/分隔线后无正文)与**无实词**(整篇只有数字/符号、无中英文词)标记为`已忽略`,不入知识库、不算出错;**留盘可恢复**,面板新增「已忽略」分组,行内「恢复入库」即豁免过滤(`chatbot_junk_keep`)并重新摄取,重新过滤时连带清掉其旧知识块避免残留污染检索。超短但含中文词的备忘(如`胃药`/`董师傅`)只在行内加 `⚠ 疑似垃圾:太短` 提示、**不自动跳过**,避免误伤

- **主页 Hero 右侧抖音短视频播放器**:把原主题 ASCII motif 框换成抖音旅行短视频(官方内嵌播放器 `open.douyin.com/player/video`,免权限、无需 API key;右栏 < 730px 自动竖屏),按「系列 Tab + 集数列表点选」浏览;移动端显示、`centered` 布局隐藏;未配置视频时回退显示原主题 ASCII。视频清单在 **admin → 视频** 管理(整表覆盖,存 `meta.vlog_config`,支持新增/重排/软删系列与集数;可直接粘贴 `douyin.com/video/<数字>` 链接,保存时自动提取视频ID),保存即时生效;原「连点 4 次进 admin」彩蛋改为**单击首屏姓名**进 admin
  - **标题自动获取**:标题留空时,保存会用官方免登录接口 `get_iframe_by_video` 按视频ID取抖音标题(实为**作品描述**,自动去掉 `#话题`/`@提及` 并折叠空白)后落库,保存不受抓取失败阻塞;非公开/无效视频回退「第 N 集」。每行另配「↻」单条刷新,亦可手动覆盖
  - **自动横竖屏 + 原生尺寸不裁切**:同一接口返回视频宽高,保存时一并落库;画面方向可设「自动」(按宽>高判断,也可手动锁定)。抖音 iframe 竖屏恒为 324×672、横屏(宽度 ≥730)为 PC 布局,固按其**原生尺寸**渲染再用 `transform: scale()` 缩放到卡片 → 不再裁切/变形;右栏 <730px 也能用横屏(以 740px 宽渲染后缩放)
  - **随机起播 + 重叠轮播 + 左右切换**:每次进入主页由**服务端随机**选一个系列+集数起播(SSR 与 hydration 一致,无闪跳);播放器为多卡重叠轮播,左右**拖动跟手滑动**切换(松手过半自动切换)并有左右箭头;两侧叠相邻集暂停帧预览。**只有当前集可播放**——切换时重挂载旧 iframe 使其立即停止,避免多个视频同时出声
  - **播放统计**:访客**点进播放器**(播放/暂停/进度条/全屏等)才上报 `vlog_play`,进页面/切系列/切集/滑动一律不计;同一访客每天同一集**只计 1 次**(服务端按 `cid+day+target` 原子去重)。站长为 MOCK/登录态不计。admin「统计」新增「视频播放」表(视频ID 解析为「系列 · 集标题」,标注口径;集名过长时省略号截断,悬停看全名,右侧次数列不再被挤出面板)

- **聊天机器人智能问候**:进入页面按 **日期/星期/时段/节日(农历)/节气/北京实时天气** 用当前 chat 模型生成问候语(每时段 10 条,节日主动祝福、早晚贴合语气),admin 的问候语作为「语气样本」喂给模型;缓存键 = 北京日期+时段,结果**落库 `meta.chatbot_greet_cache`** 全站复用(重启/部署不再露兜底)。生成改为**服务端定时任务**(`instrumentation.ts` → `lib/chat/scheduler.ts`:**启动预热** + **每 60s 检查时段切换**,跨时段/跨天自动重生成,失败下次自动重试),**请求路径只读缓存、不再由访客触发**,故问候语恒定毫秒级返回、刷新必弹,顶多是极短兜底窗口。admin 可勾选「智能问候」、填生日/纪念日(`MM-DD`/`YYYY-MM-DD`)。进入页面提示改为:**首访**自动展开聊天窗,之后刷新改为在浮标旁弹**气泡**、7s 淡出(气泡与窗口互斥)

- **OpenCode「今天/昨天」精确小时数据(可选:控制台「推理日志」)**:控制台 Logs → Inference 的接口 `GET /api/request-logs?category=inference&since&until&limit&cursor`(带逐条 `startedAt` + token/cost)可精确出小时;它只认**网页登录态 Cookie**(httpOnly,`oc_sk_` 会 403)。admin「Token用量」新增块:粘贴一次 `Copy as cURL`(兼容 bash/cmd/fetch,自动提取 org id),保存后**自动用 `/api/orgs` 枚举账号下所有 workspace** 分别拉取,并用 `/api/service-accounts` 把每条归属到对应 workspace(按 service account 匹配本地 key)。同步窗口=**北京今天**(首次从 00:00 补齐,稳态只拉当前整点),「昨天」只读已落库存储、不额外打接口(保留 3 天);**对访客完全无感**——`/api/usage` 只后台触发(2 分钟节流)绝不 await,立即返回现有数据,否则秒回退采样。配置后分时提示标注「逐条日志 · 精确」,未配置/失效回退**每小时自动采样**(标注「采样估算」);进程内另有后台定时器(启动补跑 + 每 10 分钟)自动同步,**无需手动点「立即同步」**
- **首页悬浮件交互升级**:①访客统计(PV/UV)悬浮件改为**只显示今日**数值(折叠态与展开格都不再显示总数),展开后点「今日访问(PV)」/「今日访客(UV)」切换近 7 天柱状图(此前固定显示 PV 柱);②服务器状态悬浮件展开后,点 **CPU / 内存 / 磁盘 / 负载** 任一指标即显示该指标**近 24 小时折线**(15 分钟/点,约 96 点,带 hover 时间+数值提示),替换原「近 7 天 CPU 日均」柱状图;新增通用 `Sparkline` 组件;`GET /api/status` 相应把 `trend`(7 天 CPU 日均)改为 `series`(4 指标 24h 序列)
- **AI 问答机器人「Lumen · 子祥的分身」**:右下角漂浮聊天组件,访客可用自己写过的文字向"分身"提问。
  - **人格 / 知识库**:`persona.md`(第一人称人设,每问都注入)+ `faq.json`(引导问答)+ `knowledge/*.md`(站点知识)+ `corpus/`(蒸馏原料);服务端 mtime 热加载,改文件即生效。
  - **多 provider**:DeepSeek / OpenAI / 智谱 GLM / 百炼 / Moonshot / 硅基流动 / OpenRouter / OpenCode Zen / 本地 Ollama / 自定义(OpenAI 兼容),配置存 `meta.chatbot_config`,密钥单独存 meta 且支持环境变量回退。
  - **混合检索(RAG)**:FTS5 关键词 + embedding 余弦(支持 OpenAI 兼容与 Ollama 两类向量模型),未配置向量时自动降级纯关键词。
  - **蒸馏流水线/admin**:`admin → 机器人` tab 可配对话/检索/限流,扫描 corpus 自动分类(人格素材 vs 事实知识)、把知识切块入向量库、调用 LLM 生成 `persona.md + faq.json`;对话日志按日统计 + 明细。
  - **记录与限流**:对话落 `chat_logs`(含 MOCK 身份,口径同访客统计),每人每日提问上限、IP 限流只读接口公开配置 `GET /api/chat/config`(不含密钥)。
  - **corpus 在线传管**:admin「机器人 → 灵魂蒸馏」可直接**上传 `.md/.txt` 素材(可选文件或整个文件夹、保留相对子目录、无大小限制)**,上传成功自动「扫描并蒸馏」(只分类+入库,不自动重生成人格);列表每行可 ✕ 删除并同步移除其知识块。重名/类型不支持返回明确错误。不用再手动往服务器丢文件。**macOS 的 Chrome 选文件夹走原生 `showDirectoryPicker`(避免 webkitdirectory 在 Mac 上退化)、其它浏览器回退隐藏 `input[webkitdirectory]`**。
  - **语料敏感信息过滤**:上传/蒸馏自动检测并脱敏(读时脱敏、不改写磁盘原文件,库与送 LLM 均为脱敏版)——硬格式(身份证/护照/银行卡/手机座机/邮箱(公开联系方式自动豁免)/API密钥·JWT/数据库连接串/SSH私钥/内网IP/GPS/车牌)与词语境(亲属+号码、出生、住址、密码口令)双档;命中文件面板显示「⚠ 已脱敏:…」,误报可「按原文放行」(存 `chatbot_sensitive_allow`),删除时连记录一起清理。
  - 运行目录 `docker/site-content/chatbot/`(`npm run seed:chatbot` 生成骨架,部署随 site-content 挂载);文档见 `docs/CHATBOT.md`。

- **首页服务器状态悬浮件 + 导航「监控」入口**:右上角新增**可拖动**的状态浮件(CPU / 内存 / 磁盘 / 负载 / 运行时长 / 站点在线 + **近 7 天 CPU 日均趋势**),悬停展开、移出收起(与访客统计一致);数据由新接口 `GET /api/status` 只读查询 Grafana Cloud(60s 缓存,失败时显示降级「状态异常」气泡、可展开看错误,不再自动隐藏);**所有悬浮件(访客统计 + 服务器状态)拖动后靠近视口边缘自动吸附**;顶栏导航在「留言板」下新增「监控」外链,直达 Node Exporter Full 面板
- **悬浮件失败态可见**:服务器状态浮件在数据源不可用(token 缺失 / 网络失败等)时**不再整体消失**,改为显示红色降级气泡(「状态异常」,悬停可查看 `error` 文案),每 60s 自动重试;本地 dev 通过 `apps/next-home/.env.local`(已 gitignore)固定 `GRAFANA_READ_TOKEN`,避免裸 `npm run dev` 丢失 token
- **邮件服务器运维文档 `docs/MAIL.md`**:邮件服务(PostE.io)单独跑在服务器 `~/mail/`,配置**不入库**,此前完全没有文档。现记录现状速览、端口与 `nftables` 收窄规则(含"别改成 ufw default deny"的原因:Caddy 回源走 `br-*` 而非 loopback、`xray` 是 host 网络)、compose 的 `entrypoint` 包装(残留 pid 与 DKIM 软链两个故障的来龙去脉)、认证链路真相(**签名由 Haraka 的 `mailauth/dkim_sign` 完成,`rspamd` 的 `enabled=false` 属正常;出站经 Resend 中继,外链看到的是 Resend 那把钥匙**)与 DNS 对照表、重建后必查清单与"别做的事"

### 修复

- **项目卡片「亮点」逐字断行**:卡片底部的亮点(如 `全自动 CI/CD`、`一人一库`)原先是无换行的 flex,中文被压扁后**逐字换行**(320px 下 9 张卡有 4 张断行,`一人一库` 甚至断成 4 行)。现改为**始终保持一行、按卡片可用宽度自动缩放字号**(实测 0.80~1.00),卡片宽度变化(换列数 / 窗口缩放 / 应用栏开关)自动重算,极端窄卡片用省略号兜底。
- **移除右下角快捷键提示**:该面板固定占住右下角且触屏无意义,已整体去掉(主题/布局的键盘快捷键本身不变)。

- **智能问候「时段错配」**:原本 `14:00–22:00` 全算「晚上」—— 下午(如 15:00)被当成晚上,问候里冒出"晚上好/前夜"这类词。现拆出 **「下午」(14:00–18:00)**,`晚` 收窄为 18:00–22:00;并给生成 prompt 加一条通用约束(**时间性表述必须与当前时段一致**,不得引入时段之外的词),生成后再加一道**自审**(第二次 LLM 调用,逐条清掉与时段不符的句子;失败则保留原句、不影响出词)。

- **有图标的图标按不住、拖不动(拖拽被图片吃掉)**:`<img>` 在浏览器里**天生可拖**,在图标上按下会被判成「拖这张图」,浏览器随即给指针序列发 `pointercancel`,自建的拖拽当场断掉 —— 表现是「指针按下去,拖动中状态一点不亮」,图标越多越明显。给 `<a>` 加 `draggable={false}` **管不到它**,必须单独给 `<img>` 关掉;另加 `pointer-events: none`,让命中目标恒为 `<a>`(而不是看运气点到图片还是首字)。**只有真配了图标才触发**,首字兜底的首字是 `<span>`、天生不可拖,所以纯文字测试数据跑 35 项全绿也照样盖住了它 —— 现已把真实图标加进回归数据,并断言「命中目标必须是 `<a>`」。

- **应用栏图标两个只在「真图加载出来」后才暴露的 bug**:①`onLoad` 赶不上 —— `<img>` 是 SSR 出来的,浏览器解析 HTML 时就开始下载,等 hydration 完 React 才挂 `onLoad`,事件早已错过,状态永远停在 `loading`,于是**首字兜底和图标一直叠在一起**;改用回调 ref 补判 `complete` + `naturalWidth`。②叠放位置错了 —— `.zx-appdock-img` 是 `display:grid`,首字与 `<img>` 被自动排成**上下两行**(实测图片被挤到 y=17、溢出 26px 的格子);给子元素补 `grid-area: 1/1` 强制叠在同一格。两者都只有真上传了图标才看得到,单看 SSR 标记发现不了。图标 404 时仍会摘掉破图、回落名称首字(已验证)。

- **手机上有声音但画面被自备封面挡住 / 桌面刷新后第一点只消封面不出声**:根因是抖音播放器**跨域** —— 点进去之后父页面收不到任何事件(实测 `click`/`pointerdown`/`touchstart` 一个都不过来,合成事件才收得到),而且**手机上(WebKit)还不一定把焦点切给那个 iframe**(桌面 Chrome 会切)。于是「封面 `pointer-events:none` 穿透、点一下直接进播放器」虽然**单击就能出声**,却只能靠轮询 `document.activeElement` 判断「用户已点进播放器」来撤封面 —— 手机上永远等不到,封面就一直盖着正在播的视频。现改为**保住单击出声、只给撤封面加兜底**:
  - **就位闸门**(只挡开头那一下):`iframe onLoad` 之后再等一段余量才让封面穿透(`onLoad` 只是播放器页面加载完)。余量**按网速自适应**:快网 1.2s;iframe 冷加载耗时 > 800ms 即判慢网,改用 3.6s,并把「这网慢」记进 `localStorage`(带 30min TTL,供缓存命中后的后续各集复用)—— 实测慢网 `onLoad`→真正可播 1.7~3.4s(极端 25s),固定 1.2s 会让点击穿透进一个还没就绪的播放器(封面退了却不出声,最糟的静默失败)。期间播放键**转圈** + `aria-busy`,点中央播放区(半径 `max(72px, min(边长)×0.26)`)只抖一下提示,**封面绝不消失**;`onLoad` 迟迟不来则以 8s 硬兜底开闸。
  - **单击照旧穿透**:`autoplay=1` 重导航已被证伪(带 `allow="autoplay"` + 放宽 autoplay 策略仍是 `paused=true`),所以**必须**让那一下真手势落进播放器 —— 闸门一开封面即 `pointer-events:none`,单击由抖音播放器自己起播(有声音);竖屏(无自备封面)仍是一拍直进。
  - **封面三级退场**(任一命中即撤,保证「有声音但画面被挡」不可能再出现):① `document.activeElement` 变成那个 iframe(桌面 Chrome,120ms 轮询,实测毫秒级撤);② 事件真的交到了包装层(部分 WebKit 会把 iframe 上的点按交给父文档,`pointerup`/`touchend` 命中播放区即撤);③ **定时兜底**(触摸端实测一个信号都收不到,必然走这条:移动 1.8s / 桌面 8s)。退场是 0.24s 淡出,期间保持穿透,补点一下也能进播放器。
  - 排查用开关:主页加 `?vlogdiag=1`,卡片角标显示「闸门开/关 · 收到的信号 · 封面走哪条路退场」(如 `闸门开·信号无·退场兜底·触摸`),可据此按设备把兜底时间调准。
- **首访自动弹出的聊天窗压住视频播放区**:窗口固定在右下角(`right/bottom 20px`、宽 `min(380px, 100vw-32px)`、高 ≤ `min(560px, 75vh)`),手机上正好盖住 Hero 视频卡的中央,那一下点击全落在聊天框上、视频点不动(还表现为「聊天在一直打字」)。首访自动开窗前先量一次:窗口矩形与视频卡中央播放区**相交就不自动弹**(留给用户点 FAB),桌面端同样生效。**慢设备上卡片会先在中间态(如 350×213)出现、约 1s 后才跳到最终尺寸**,只量一次会判成「没压住」而开窗、等卡片跳大正好被盖住 —— 故改成:① `stableCardRect` **连续两次量到相同尺寸**才算布局稳定;② 量不到尺寸时返回「未知」而非「没压住」,继续等;③ 卡片中心不在视口内(手机上视频区在首屏之下)时**按视口中心判**(浮窗固定在视口上,用户滚到视频时窗口必压住);④ 只要页面有视频区外壳(`.zx-vlog`)就继续等,不按固定上限放弃。**实测 4x CPU 降速 + Fast3G 下单击出声由 0/4 → 4/4**;回访访客的气泡提示不变。
- **线上后台把「兜底封面」全部标成缺失(误报)**:面板徽章原来读库里的 `cover` 字段,但线上库从不写这个字段(前端按 vid 推导 `/vlog/<vid>.jpg`),于是线上所有横屏视频都显示红色「缺兜底封面」——即使图片文件都在。现改为看**缩略图实际能否加载**(`onLoad`/`onError`)判断:文件在 = 「兜底首帧」,真 404 才报缺;上传/恢复后缩略图 URL 变化会自动重判。
- **「生成人格」点完无法确认结果 / 刷新即失联**:改为**后台任务**(`POST` 立即返回,状态写 `meta.chatbot_persona_status` 并随 GET 的 `persona` 返回),面板显示「人格生成中 → 成功 · FAQ n 条 / 失败 + 错误 / 已取消」,刷新或换标签也能看到;并显示 `persona.md` / `faq.json` 的**最后写入时间**(`personaAt`/`faqAt`),据此可确认某次是否真的生成。与蒸馏**共用并发闸门**(一个在跑时另一个被拒),新增「取消」按钮(`action:'cancel'`)。
- **蒸馏「一直显示蒸馏中」/ 误全量重跑 / 并发叠加**:「扫描并蒸馏」改为**后台任务**——`POST` 立即返回,进度写入 `meta.chatbot_distill_progress` 并随 GET 的 `progress` 返回,前端按钮下方实时显示 `done/total · 当前文件`,不再长挂一个请求、也不再有 10 分钟前端超时错乱;**同一时刻只允许一个任务**(重复点击被拒)。行内「改类别 / 放行 / 忽略 / 恢复入库」不再调 `processCorpus(true)` 全量重跑,改为**只重跑该单文件**。另:**批量分类**(每 10 篇合并一次调用,每篇截断 1200 字,解析失败自动加大预算重试→拆半递归→逐篇兜底)+ **并发**(分类 4 路、入库 embedding 4 路)大幅省 token、省时间;「全量重跑」默认不勾、勾选后有二次确认。
- **corpus 列表「只能折叠一个分组」**:出错 / 已忽略 / 待处理 / 已入库 的折叠状态原本是**单个值**,展开一个就会顶掉另一个。改为**用数组记录各自是否折叠**,四组可独立展开/收起(已入库默认折叠)。
- **横屏视频封面被压扁成「竖图硬塞进横框」**:抖音播放器自带的封面层(`xgplayer-poster`)用的是被平台自动裁成 **3:4 竖图**的 `video.cover`,`object-fit: fill` 填进 16:9 视频区 → 横屏视频未播放时看着严重变形。现横屏视频改用**独立的 16:9 封面**,来源两层:
  1. **你自己的封面(优先)** —— 在 `/admin`「视频」面板**逐条上传**:浏览器端保持原比例把长边压到 1280、转 JPEG q0.85(透明区先铺白底),经新接口 `POST /api/admin/vlog/cover` 落盘为 `docker/site-content/vlog/<vid>.user.jpg`(非 JPEG 原样存 `.user.png`/`.user.webp`)并**立即写库**(`coverSrc='user'` + `coverAt`),不必点面板「保存」;「恢复兜底」调同接口的 `DELETE` 删掉 `<vid>.user.*` 回落到兜底图。上传图与视频方向不一致(横图配竖屏 / 竖图配横屏)只提示补哪边黑边,**一律等比缩放 + 纯黑补边、不裁剪**;服务端按文件内容校验 JPEG/PNG/WebP 真实类型与尺寸(≤3MB、≥320×320)。服务器端 `docker-compose.yml` 加了 `./site-content/vlog:/srv/site/vlog` 可写子挂载(首次上线前 `chown -R 10001:10001`),上传即写线上库、不用 scp。
  2. **抖音兜底首帧** —— `npm run cover:vlog` 从官方播放器页自行签名的 `aweme/detail` 响应取 `video.origin_cover`(640×360,平台存储尺寸),落盘 `<vid>.jpg` 并回写 `coverSrc='douyin'` + `coverAt`(= 文件 mtime)。**已实测它就是视频第 0 帧**(SSIM ≈ 0.99 与 t=0 帧逐格一致,非作者另设的封面),所以只当「至少不变形」的保底,不是成品封面。脚本已瘦身为只管兜底图(删掉 `--adopt`/`--include-user` 与 ffmpeg/sips 转码,不再碰 `<vid>.user.*`),新增视频后重跑一次只补缺的,抓到竖图不再判失败(前端补黑边)。

  另:**点击封面才挂 iframe 播放**(autoplay=1),两侧相邻卡也改用封面(省掉 2 个 iframe);点封面即记一次 `vlog_play`。竖屏视频、没配封面、封面 404(自动 `onError` 回退)一律维持原样。前端优先 `v.cover`、缺省按 vid 推 `/vlog/<vid>.jpg`,所以上线只 `scp` 图片、不用改线上库。`Caddyfile` 新增 `/vlog/*` 静态路由,本地由 `apps/next-home/public/vlog` 软链提供,**同一路径两端通用**
- **有封面的视频要点两次才能播**:上一版「点一下才挂 iframe + autoplay=1」在跨域播放器上不可靠(浏览器 autoplay 策略,且播放器只认自己的播放键),所以第一次点击只是把播放器挂出来、还得再点一次播放。现改为**播放器预挂载 + 封面点击穿透**:封面图加载完就把 iframe(`autoplay=0`)挂在封面底下暖机(SSR 图在 hydration 前已 `complete`,故 onLoad 之外另用 ref 自查 `complete`,否则永远挂不上),播放器 `onLoad` 后封面加 `pointer-events:none`,点击直接落进播放器由它自己起播 —— **一次点击 = 封面消失 + 视频真播**。封面何时退场:实测点击落在跨域 iframe 上时父页面收不到 `click`/`pointerdown`/`focusin`/`blur` 中的任何一个,**只有 `document.activeElement` 会变成该 iframe**,故用 120ms 轮询它(仅在「有封面 + 播放器就绪 + 未开始」窗口内轮询),再汇入原有 `startPlayback` 记一次 `vlog_play`。播放器就绪前封面仍可点(行为同旧版),相邻卡仍不预挂;首页因此多 1 个播放器 iframe,已用「封面图加载完再挂」挪到首屏大图之后
- **OpenCode 多天区间「请求数」严重偏小**(7天/30天/本月/上月等天级区间,含 RECENT 明细):合并 v2 天级 CSV 时,每个 `(天 × 模型 × provider × service account)` 分组的**首行把 `requests` 写死成 1**(`opencode.ts` 的 `fetchRows30Raw`),导致请求数被压成"分组条数"(实测 7 天应 5903、却显示 ≈13)。改为取该行真实 `requests`(对旧 v1 逐条数据无影响,其 `requests` 本就是 1);tokens/费用不受影响。今天/昨天走推理日志/自采样路径,`requests` 一直正确,故此前只有多天区间露馅。
- **admin 面板抗网络抖动(「一直加载 / 加载不出来」)**:此前 admin 的 fetch **无超时**,且 `loadPage` 把**任何**错误都当作「未登录」,`loadSettings` 无 try/catch(未捕获拒绝上报 Sentry)。跨境链路偶发「连接建立后卡住」时,表现为后台长时间转圈、且一次抖动就像被登出。现:①新增统一封装 `adminFetch`(同源凭证 + 15s 超时,`packages/shared/src/ui/admin/admin-fetch.ts`),AdminPanel / 项目 / 外观 / 机器人面板全部改用它;②`loadSettings` 改为逐请求容错 + `Promise.all` 并行,单接口失败不影响其余;③仅 **401** 才判「未登录」,网络错误/超时保留登录态并显示「加载失败」+ **重试**按钮;④首屏网络失败不再显示登录框,而是可重试的错误页;⑤`useEffect` 补 `.catch()` 兜底。
- **聊天窗口「卡死」**:`ChatWidget` 发送改为带 `AbortController` 客户端超时(120s),连接中断/超时后重置为可重试,不再永久停在「正在输入…」。
- **Caddy 开启访问日志**:`{$DOMAIN}` 站点写 JSON 访问日志到 `caddy-data` 卷(`/data/access.log`,10MiB×5 轮转),便于下次区分「请求没到 / 到了但上游没回 / 超时」;不外发第三方(访客 IP 不出服务器)。
- **监控文档补充告警规则**:`docs/MONITORING.md` 给出可直接照抄的 Grafana 告警(站点不可达 `probe_success<1`、**实例重启** `changes(node_boot_time_seconds[10m])>0`、app 容器不可用/重启、磁盘/内存)与 `for` 时长。

- **「Token用量」里 OpenCode 整块消失(官方接口 v1→v2 迁移)**:2026-09-26 官方把用量导出从
  `GET /api/v1/usage/export?scope=organization&range=30d` 迁到 **`GET /api/v2/usage/export?range=30d`**;
  旧 v1 对 `scope=organization` 直接返回 `403 {"_tag":"Forbidden"}`(**不是 key/权限问题**:同一 key 打
  `/zen/go/v1/usage`、`/api/v1/budgets/members` 仍 200;v2 一打就 200),而可用性探测只做实时拉取、
  失败即 `false`,于是 OpenCode tab 被过滤掉、用户既看不到用量也看不到报错。现:①改用 **v2 优先 + v1 兜底**,
  并把 401/403 文案区分开(401=key 无效/吊销,403=服务账号无「读取用量」权限);②拉取失败回退**上次成功快照**
  判定可用性,数据源不再整块消失(切进去显示上次数据 + 底部注明更新时间/错误),当前 workspace 无快照时
  **回落到任意 workspace 的上次快照并注明来源**;③tab 上加 `!` 角标(hover 看原因),`/api/usage/sources` 增返回 `errors`,
  失败原因落 `meta.opencode_last_fail` / `meta.zhipu_last_fail`,成功即清并清掉旧 `opencode_last_error`;
  admin 支持一键切换新旧 Console 域名(`opencode.ai/console` / `console.opencode.ai`)
  与 403 报错旁的 Console Usage 直达链接。**首页速度优先**:可用性结果进程内缓存 60s;401 后不再重复请求,
  403 走 10 分钟宽限自动重试 —— 实测 `/api/usage/sources` 数毫秒、首页 SSR 40–110ms
- **OpenCode「今天/昨天」分时(v2 只给天级 → 本站自建小时数据)**:官方 v2 导出是**天级累计**
  (`day,user_type,user_id,user_name,provider,model,requests,input_tokens,output_tokens,cache_read_tokens,cache_write_5m_tokens,cache_write_1h_tokens,cost_micro_cents,last_active_at`),
  没有逐条时间戳、也不再支持 `24h`,因此「今天/昨天按小时」无法直接得到。现由本站**每小时采样**:
  整点前 30 秒拉一次 v2,把每个 `(day × model × provider × user_name)` 的当天累计与上次读数相减,
  得到**本小时增量**写入 `meta.opencode_hourly.<wsId>`(基线读数存 `meta.opencode_cum.<wsId>`);
  进程内定时器 + 启动补抓触发,admin 新增「采样小时数据」手动补采。今天/昨天有小时数据则出 24 根小时柱,
  否则回退天级单柱。**局限**:进程跨过整点未运行会丢那一小时,且无法补历史,只能从现在开始积累
- **邮件服务器 Dovecot 起不来 / 收信断**(服务器 `~/mail/`,配置不入库,见 `docs/MAIL.md`):`restart: unless-stopped` 走的是 `docker restart`、**保留容器文件系统**,上次残留的 `/run/dovecot/master.pid` 让 s6 判定"Dovecot 已在运行"而拒绝启动 —— 不只是没有 IMAP,**收信投递(LMTP)也断**、容器 `unhealthy`、`mail.log` 停止写入,且**每次重启必复发**。现给 compose 加 `entrypoint` 包装:启动前清掉 `dovecot`/`rsyslog` 残留 pid 与 socket 再 `exec /init`;同一包装还会在启动时重建各域 DKIM 软链(`/opt/haraka-*/config/dkim/<域>`,原先由后台页面按需创建,**容器重建即丢,会让出站邮件静默不签名**)
- **邮件服务器公网暴露收窄**:`nftables` 定向拒绝 `110`/`143`/`8080`/`8443` 的公网直连(仅保留本机与 docker 网桥),只放行 `25`/`465`/`587`/`993`;不动 forward 链与 `22`/`2096`,因此不影响 Docker 端口映射、SSH 与 VLESS。踩坑记录:Caddy 上游是 `host.docker.internal:8443`(从 `br-*` 进来而非 loopback),漏放行会让 `mail.<DOMAIN>` 整个 000
- **容器监控失效**:cAdvisor 旧版(v0.49.1)不支持 Docker 29 默认的 **containerd 镜像存储(snapshotter)**,导致容器指标全空(只剩主机总量);且 Alloy 侧还丢弃了容器 `name` 标签。现升级 **cAdvisor v0.60.6**(`ghcr.io/google/cadvisor`,v0.54+ 支持 containerd snapshotter)、**保留 `name`/`service` 标签**、**开启容器磁盘 IO**、**容器日志改为采集全部容器**(mailserver 几乎不写 stdout,无噪声);本地 Grafana 的 cAdvisor 面板(uid `pMEd7m0Mz`)随之可用
- **服务器侧配置同步**:`ci-run.sh` 自动同步清单加入 `docker/observability/`(Alloy 配置 + Grafana provisioning/面板),改完 push 即生效,无需手动 `scp`
- **admin 统计里项目点击显示成 id**:`/admin` 统计页此前用**静态项目列表**解析埋点 `target`(项目 id),导致 admin 里新增/改过的项目(如 RAG)`id → 名称` 解析失败、直接显示原始 id。现改用 **DB 合并后的项目列表(含已删除)**,admin「项目点击」与「访客明细」均正确显示项目名称
- **项目卡片布局**:卡片改为纵向 flex,**亮点以下的内容(技术标签 + 操作按钮)贴卡片底部**,同排卡片底对齐,不再因简介长短参差
- **项目简介换行**:admin 项目简介里手动换行(`\n`)在前端卡片上原样显示(项目简介段落加 `white-space: pre-line`)
- **项目亮点(highlights)丢失**:admin 项目配置接管首页后,卡片亮点不再显示。现全链路补回——`StoredProject`/规范化/渲染均支持 highlights,admin 项目面板新增亮点编辑(标签+数值,最多 6 条,可增删);DB 项目未配亮点时按 id 回退静态内容,**存量无需重存即恢复**;该兜底同时用于 **admin 项目列表**,面板里不再显示为空
- **项目简介输入框**:admin 项目面板简介由单行输入改为**自适应高度文本框**(autosize,2–8 行),长文本不再被截断
- **项目卡片点击数**:「本页 · 个人主页」卡不再把全站 PV 与该链接点击数相加(点一次「试用」曾因跳回首页额外触发一次访问而显示 +2);改为只显示全站访问量(PV),与其它项目口径解耦
- **埋点重复计数**:同一访客对同一「类型+目标」在 2 秒内的重复上报只记一次(防手抖双击 / beacon 重试);`visit`/`leave` 不受影响
- **项目「试用」链接缺协议**:`demoUrl` / `repoUrl` 填裸域名(如 `rag.zxlumen.cn`)时被当成相对路径、拼成 `zxlumen.cn/rag.zxlumen.cn`。现统一补全 `https://`(站内 `/` 路径与已带协议的链接原样保留),覆盖前端渲染与后端存储/读取(存量数据无需重存即修复);admin 输入提示同步更新
- **上线未同步服务器侧配置**:`docker/Caddyfile` / `docker/docker-compose.yml` / `docker/deploy.sh` 此前靠人工 `scp`,易漏(曾致 `rag.<DOMAIN>` 反代未生效)。现由服务器 `docker/ci-run.sh` 在每次部署前从公开仓库自动 `git fetch` 同步这几个文件,并在 `deploy.sh` 末尾 `caddy reload` 使新 Caddyfile 即时生效(部署密钥被 `command=` 绑定到 `ci-run.sh`,scp 通道不可用,故不采用 CI scp)

### 新增

- **联系方式点击统计**:邮件 / 微信 / 电话 / GitHub / 留言 按钮点击上报 `contact_click`,admin「统计」新增「联系点击」面板(按方式计数);访客明细「最近操作」同步显示
- **访客明细「新客 / 回头客」标识**:折叠行昵称旁直接显示徽标(此前仅展开后可见);判定按**访问日去重**——访问过 ≥ 2 个不同日期为「回头客」,仅某一天访问(当天多次也算)为「新客」
- **内联 SVG 图标**:微信 / GitHub / 邮件 / 电话 / 留言改用内联 SVG(单色继承 `currentColor`),微信按钮不再与聊天气泡共用同一 emoji;聊天悬浮按钮改用对话气泡图标;微信图标固定 20×20


- **本地 Grafana 查看面板**:新增 `grafana`(monitoring profile),数据源(Provisioning)指向 **Grafana Cloud 查询接口**(只读 token,不落地数据);由 Caddy 暴露 `grafana.<DOMAIN>`(basic_auth 保护,密码哈希经 `.env` 注入);自动导入 **Node Exporter Full** 与 **cAdvisor** 面板。这样日常看指标/日志在自有域名,存储/告警仍在 Grafana Cloud
- **服务器监控(可观测性)**:本地采集 → Grafana Cloud + Sentry(EU)。`docker compose --profile monitoring`(默认不启)加载 `node-exporter` + **筛选版 cAdvisor** + `grafana/alloy`(抓主机/容器指标、抓应用 `/metrics`、采集 app/caddy 容器日志 → Mimir/Loki);新增应用 `GET /api/health`(供外部合成探测)与 `GET /api/metrics`(Prometheus 文本,`X-Metrics-Token` 保护,Caddy 对公网屏蔽);`onRequestError` 计数并可选上报 Sentry(`dataCollection` 关闭 PII、`tunnelRoute:/monitoring`);文档见 `docs/MONITORING.md`
- **用量饼图交互**:`BY_MODEL` 甜甜圈由 `conic-gradient` 改为 SVG 扇区(每块一个元素);鼠标悬停某块时该块**以圆心为中心放大 1.08**(几何整体缩放),模型名/tokens/占比显示在**甜甜圈下方的固定行**里;悬停图例行同样放大对应扇区(双向联动)。单模型渲染整环,无数据显示占位环
- **OpenCode 用量支持多 workspace**:admin「Token用量」可添加多个 workspace(各填名称 + 该 workspace 的 `oc_sk_` service key,名称留空自动用 key 尾号占位),前端面板新增 workspace 多选行(「全部」= 总用量);多个 workspace 数据按区间合并(provider 加 `ws名 · ` 前缀区分),每个被选 workspace 各显示一组 Go 配额(5h/周/月)。配置存 `meta.opencode_workspaces`(JSON),每个 workspace 的 30 天快照独立存 `opencode_last_data.<id>`;不再读取环境变量 `OPENCODE_SERVICE_KEY` / `OPENCODE_CONSOLE_URL`
- **运行时站点内容 + 热更新**:个人资料(姓名/简介/技能/时间线/项目/联系方式/SEO meta)从
  `content.local.ts` 导出为 `docker/site-content/content.json`,服务端运行时读取、
  mtime 变化即生效(改完刷新即见,**无需重启/重建**)。UI 组件全部改为 props 注入
  (`Hero/Topbar/AboutSection/Footer/Shell/HomePage/AdminPanel`),`layout` 的 `generateMetadata`
  等同步接入;文件缺失时回退占位默认值。见 `docs/CONTENT.md`
- **部署改为 CI → GHCR → 服务器拉取**:`git push main` 触发 GitHub Actions 构建镜像推
  `ghcr.io/zxlumen/zx-home:<sha>+latest`(公开,服务器匿名 pull)并 SSH 跑 `deploy.sh`;
  **服务器不再构建镜像**,消除构建缓存导致的磁盘膨胀。个人内容与简历/二维码
  (`.dockerignore` 排除)由 `/srv/site` 挂载 + Caddy 静态服务。见 `docs/DEPLOY.md`
- **`export:content` 脚本**:`cd packages/shared && npm run export:content` 生成
  `docker/site-content/content.json`(Node 22 原生 TS 读取 `content.local.ts`)

### 变更

- **用量面板 RECENT 明细表支持翻页**:由原来固定显示最新 8 条改为分页(默认 10 条/页,可选 5/10/20/50/100),切换数据源/区间/筛选时自动回到第 1 页
- **用量面板 OpenCode RECENT 明细列**:由「提供方(provider)」改为「**服务账号**」(`service account`)——彻底替换该列;多工作区时显示 `工作区 · 服务账号`,无服务账号的记录显示 `—`;该列仅在区间内存在服务账号时出现;列名 `service account`(英文)
- **用量面板 OpenCode 新增「服务账号」筛选**:官方导出新增解析 `service_account_name`(如 `bak_coding` / `bak_todo`),面板新增「全部服务账号」多选筛选(可当作 key 维度);聚合时保留该维度,不影响 provider/model
- **用量面板 OpenCode 去掉「提供方」筛选**:opencode 源不再显示提供方筛选行(旧 cookie 里的选择一并忽略并清空),用量按**全部提供方合计**;DeepSeek / 智谱 的「全部 API Key」筛选保持不变
- **用量面板 OpenCode workspace 改为单选**:点击某 workspace 只选中它,再点一次取消(回到「全部」);「全部 workspace」按钮清除选择;请求仍按所选 workspace 过滤
- **内部解耦(第一阶段)**:统一用量区间类型——`@zx/shared` 新增导出 `RANGES`,`deepseek` 复用共享 `UsageRange` 并 re-export;`ui/admin` 面板改为相对 import(消除 `ui → root` 依赖边);根 barrel 补 `fmtUsd`;删除死代码(styles.css 沙盒段、AdminPanel 恒真的 `showTabs/showOc/showZhipu` 常量及 `!showTabs` 分支)
- **内部解耦(第四阶段)**:`AdminPanel` 抽出 `admin/admin-types.ts`(共享状态类型 + `validTab` + `NotifyMsg`,消除两个已抽面板里重复的 `NotifyMsg`)与 `admin/VisitorDetailRow.tsx`(访客明细行);`UsageSection` 抽出 `usage/constants.ts` 与展示组件 `usage/QuotaPanels.tsx`(Go / 智谱配额)、`usage/UsageCharts.tsx`(趋势/占比图 + RECENT 明细表);`GuestbookSection` 抽出 `guestbook/{types,cookies,api}.ts`
- **内部解耦(第三阶段)**:用量数据源抽出共享层 `lib/usage/{range,types,cache,csv,aggregate,errors,snapshot}.ts`——区间/北京时助手、TTL 缓存、CSV 解析、按 key 合并、错误码统一;`deepseek/opencode/zhipu` 复用共享模块,`opencode/zhipu` 不再从 `deepseek` 反向 import `windowOf/UsageRange`;`api/usage` 用 `granularityOf`/`codeToSource` 收敛重复三元与错误映射
- **内部解耦(第二阶段)**:`server/db.ts` 按域拆为 `server/db/{types,connection,comments,usage,events,stats,meta}.ts`,`openDb` 组合各 store,`Db` 接口与调用方不变;新增 `@zx/shared` 时间助手 `nowIso/bjDay/bjTime/bjTimeSec/tsMs`(`src/time.ts`)
- **项目按「个人 / 历史工作成果」分组展示**:项目加 `kind` 字段(`personal` / `work`),首页拆两行 —— 个人新项目(含本站)在上,历史工作成果在下,中间一条淡分隔线;admin「项目」Tab 可逐个设分类,新增项目默认 `personal`。老数据无需迁移:缺省按 `demoUrl==='/'` 推断个人、其余为工作
- **featured 卡片样式改为顶部强调条**:`.zx-card.is-featured` 由右上角渐变光改为卡片顶边一条 `accent→accent-2` 渐变细线(3px),更克制利落;仍沿用主题变量
- **已归档项目卡片视觉降级**:`status='archived'` 的项目卡片降透明(opacity 0.7)+ 降饱和,取消 hover 上浮,视觉上「归档」;仅影响已标注 archived 的卡片,其余卡片不变
- **「用量」统一更名为「Token用量」**:Hero 首屏按钮「用量面板」→「Token用量」,并调整顺序为「查看项目 → / Token用量 / 关于·简历」;顶栏/侧栏导航「用量」→「Token用量」;区块标题、admin Tab、相关提示文案同步去空格统一

### 修复

- **柱状图 hover 提示遮挡/看不清**:提示由「蓝字(`accent`)固定压柱顶」改为**跟随鼠标的深色气泡**(新增 `useBarTooltip`,portal 固定定位、白字 0.72rem),并**自动收敛到视口内**(靠近右/下边缘会翻到鼠标左上,不出屏);全站柱状图(用量趋势 / 访客统计 / 服务器状态)统一生效;移除旧的 `.zx-bar[data-label]::after`(并顺带消除其导致的横向溢出)
- **用量面板饼图/图例颜色不可区分**:未收录进 `PRICING` 的模型(OpenCode Go / 智谱等)全部回落 `accent` 蓝色;改为按模型名哈希取确定性调色板颜色
- **用量面板柱状图下方空白**:两列网格 `align-items: start` 时,左列柱状图面板被右侧甜甜圈面板撑高的网格行留下空白;改为 `stretch`,并让柱区填满面板高度
- **`layoutMeta` 可能返回未放行布局**:`theme-context` 取布局元数据时用了全量 `LAYOUTS` 查找、未受 admin 放行集合约束;改为基于已过滤的 `layouts`,与 `themeMeta` 行为一致
- **OpenCode workspace 切换不刷新数据**:用量面板的拉取 effect 依赖缺 workspace 选择,点 workspace chip 后不发新请求。改为依赖稳定的选择 key(选中 id 拼接字符串),切换即重新拉取
- **OpenCode 多 workspace 配额布局**:配额网格固定 3 列(`.zx-quota.is-fixed3`),每个 workspace 占一行(行内 5 小时/周/月 三项均匀分布),任意页面宽度下都不换行/不堆叠;去掉冗余的单 workspace 兼容分支
- **OpenCode 点选某 workspace 后其它 workspace chip 消失**:接口成功分支只返回**被选中**的 workspace 列表,前端直接覆盖筛选栏列表导致其余 chip 被抹掉;改为始终返回**全量** workspace 列表(用量/配额仍按选择过滤),点击 chip 只切换筛选、再点一次即回到「全部」
- **admin OpenCode 面板刷新后显示「已配置 0 个 workspace」**:初始 `load()` 只更新了状态(`oc`)却漏了 workspace 列表(`ocWs`),导致配置已存库但表单/列表为空(实为前端未回填)。抽出 `applyOc()` 统一「状态 + 列表」同时更新,两处加载路径共用
- **admin 输入框/勾选框夜间变黑**:`MantineBridge` 由 `defaultColorScheme="auto"`(跟随系统深色)改为 `forceColorScheme=当前 zx 主题 mode`,admin 控件明暗与站点主题一致,不再因系统夜间模式错配

### 新增

- **区块浏览统计**:用 `IntersectionObserver` 观察各区块(projects/usage/about/guestbook),访客**看到**区块时上报 `section_view`(target=`/#usage` 等,dwell=可见秒数,<1s 不计)。`section_view` 不影响 PV/UV
  - 修复:`TrackBeacon` 的 `fired` 守卫导致 React StrictMode「挂载→清理→再挂载」后监听器/observer 被清除且不再注册,`section_view`/`leave` 曾全部丢失;改为模块级 `visit` 去重、effect 每次正常注册/清理
  - 区块判定由「可见比例 ≥50%」(高区块永不可达)改为「可见高度 ≥160px」

- **访客真实停留时长**:新增埋点事件 `leave`,`TrackBeacon` 统计页面**前台可见**时长(切后台暂停、回来累加),离开时上报 `dwell` 秒数(`events` 表加 `dwell` 列)。admin「访客明细」的「平均」改为优先取真实停留;无 `dwell` 的老数据回退原「首末事件间隔」估算。`leave` 不计入 PV/UV

- **项目管理支持增删/排序**:`/admin` → 「项目」Tab 可**新增**(自动生成 id)、**编辑**、**上移/下移排序**、**软删除**(移入垃圾箱,可恢复或彻底删除);第一次未配置时以静态 `PROJECTS` 为初始列表。存储改为 `meta` 键 `projects_config`(完整有序 JSON),`page.tsx` 用 `getVisibleProjects()` 下发;旧 `project_overrides` 表与 `applyProjectOverrides` 已移除

- **外观配置(admin 可配)**:`/admin` 新增「外观」Tab,可勾选对访客开放的主题/布局(默认全部),并设定默认项;配置存 `meta` 键 `appearance_config`,接口 `GET/POST /api/admin/theme-config`,首帧注入随配置变化。约束:至少保留 1 个主题 + 1 个布局,默认项必须处于放行集合内(取消会自动切换)

### 变更

- **访客明细可读性**:展开后改为「看过区块」(按区块聚合计数,中文名,如 `Token 用量 ×2`)+「最近操作」两栏;操作流水逐行对齐(时间到秒 / 类型 / 目标),保留全部事件(访问/点击/下载/区块浏览/离开-带停留秒数),**连续同路径去重**,不再是一长串平铺;`recent` 上限 8→30
- **导航文案中文化**:顶栏/侧栏导航由 `home/projects/...` 改为 主页 / 项目 / 用量 / 关于 / 留言板;新增 `SECTION_LABELS`(区块 id → 中文名)供访客明细复用

- **收敛为单环境、单数据库**:移除整站 TEST/LIVE 双模式 —— 删除 `EnvSwitch`、`GET/POST /api/env`、`zx_env` cookie、`isTestMode()`/`testModeAvailable()`、`ALLOW_TEST_MODE`、`DB_TEST_PATH` 与 `seed:test`;`getActiveDb()` 整体删除,所有数据读写统一走 `getDb()`(唯一库 `DB_PATH`)。本地原测试库数据已迁移覆盖为唯一库(旧库备份)。见 `AGENTS.md`
- **放开全部主题/布局/功能**:删除白名单门控 `LIVE_THEME_IDS`/`LIVE_LAYOUT_IDS`/`LIVE_FEATURES`/`isFeatureAllowed`/`featureOn`/`useFeature` 及 `allowedFeatures` 传递链路;18 套主题、10 套布局、全部功能一律放行
- **保留 MOCK 访客调试**:`MOCK` 切换器与 `POST /api/admin/mock` 去掉「仅测试模式」门控,改为**仅站长**可用(A/B/C 三身份),埋点与身份分键逻辑不变

### 新增

- **统计**(功能门控 `visitor-stats`,已放行):**访客统计**做成首页右上角**悬浮组件**(PV/UV/今日/在线/近30天趋势,公开);**项目点击**常驻显示在每个项目卡上;**留言/简历/项目点击**汇总移到 admin 新增的「统计」Tab。采集用客户端 beacon(`POST /api/track`,始终匿名采集;排除站长/MOCK/爬虫);数据存 `events` 表。见 `docs/STATS.md`
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
