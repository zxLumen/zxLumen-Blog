# 首页统计(访客 / 留言 / 事件)

统计分三处展示,均为聚合数字,不含任何 cid/ip 明细:

## 展示位置

- **访客统计(悬浮)**:首页**右上角悬浮按钮**(如「访问 12 · 访客 5」),**可拖动**(位置记入 `localStorage`),
  **鼠标悬停展开**浮层(移走自动折叠),显示 **访问量(PV)**、**访客(UV)**、近 7 天 PV 趋势。**公开可见**,功能门控 `visitor-stats`。
- **项目点击**:每个**项目卡**上常驻显示「N 次点击」。
  - `demoUrl === '/'`(**指向本站,即「本页 · 个人主页」**)的项目:显示**全站访问量(PV)**,不显示链接点击;
  - 其余(外部 demo/repo)项目:N = **链接点击次数**(点「试用/repo」按钮 `project_click` 累计)。
- **admin「统计」Tab**:`/admin` → 统计,展示 **留言**(总/今日/公开/仅站长可见/留言者)、
  **简历下载**、**项目点击**(按项目列出)、**联系点击**(按方式列出:邮件/微信/电话/GitHub/留言)、
  **访客**(PV/UV/今日/在线)、
  **访客明细**(最近活跃的 30 位访客:昵称/匿名 ID、访问/留言/简历/项目点击、最近活跃;
  **新客/回头客**徽标直接显示在折叠行昵称旁;
  点击行展开:首访时间、新客/回头客、会话次数与平均时长、设备(系统·浏览器·终端)、
  来源(referrer)、项目点击明细、最近事件流)。仅站长可见。
  - **新客 / 回头客判定**:按**访问日(北京时间自然日)去重**——访问过 **≥ 2 个不同日期**为「回头客」,
    仅在某一天访问(即使当天访问多次)为「新客」。

## 采集方式(客户端 beacon)

- 页面加载时,`TrackBeacon` 向 `POST /api/track` 上报 `{type:'visit', target: pathname}`。
- 项目「试用/repo」链接、简历「下载」按钮点击时上报 `project_click`(target=项目 id)/ `resume_download`。
- **联系方式**点击上报 `contact_click`(target=`email` / `wechat` / `phone` / `github` / `guestbook`):
  邮件、微信、电话(页脚 compact 与关于页 full 两处)、GitHub、留言按钮。
- **防抖**:同一访客对同一 `type+target` 在 **2 秒内**重复上报只记一次(防手抖双击 / beacon 重试);
  `visit` / `leave` 不防抖。
- **停留时长**:页面**前台可见**时计时(切后台/隐藏暂停,回来继续累加),在离开
  (`pagehide` / `visibilitychange→hidden`)时上报 `{type:'leave', dwell: 秒数}`。
  仅前台计时,后台挂机不计入 → 更接近真实阅读时长。
- **区块浏览**:用 `IntersectionObserver` 观察 `section[id]`(projects/usage/about/guestbook),
  区块可见(≥50%)时计时,离开视口/卸载时上报 `{type:'section_view', target:'/#<id>', dwell: 秒数}`
  (可见 < 1s 不计)。`section_view` **不计入 PV/UV**。
- 服务端 `POST /api/track`:
  - **始终采集**(匿名聚合);
  - **排除**:站长本人(`isAdmin`)、常见爬虫/扫描器 UA;
  - **例外(MOCK)**:站长开启 MOCK(`zx_mock`,即以某匿名访客身份浏览)时**放行**,
    按该 mock cid 写入数据库,便于验收 多身份 PV/UV/点击 等链路;
  - 按 IP 宽松限流(120/分钟),超限静默丢弃;
  - 首次访问下发访客匿名 ID `zx_cid`(httpOnly)。
- 想产生统计数据请用 MOCK 切换身份(每个 mock 身份 = 一台独立设备)。

## 数据模型

`events` 表(`packages/shared/src/schema.ts`):

| 列 | 说明 |
|---|---|
| ts | UTC `YYYY-MM-DD HH:MM:SS` |
| day | 北京时 `YYYY-MM-DD`(UV/PV 按此聚合) |
| cid | 访客匿名 ID(UV 依据) |
| type | `visit` / `project_click` / `resume_download` / `leave` / `section_view` |
| target | 路径 / 项目 id / 文件名 / 区块(`/#usage`) |
| ua | User-Agent(仅用于过滤,不展示) |
| referrer | 落地来源(document.referrer,仅 admin 可见) |
| dwell | 停留秒数(`leave` = 整页前台停留;`section_view` = 该区块可见时长) |

聚合在 `Db.stats()`(`packages/shared/src/server/db.ts`);SSR 由 `page.tsx` 计算后下发。

## 项目(admin 可增删/排序)

`/admin` → **项目** Tab 可**新增 / 编辑 / 排序(上移下移)/ 删除**项目:

- 存储:`meta` 键 `projects_config`(完整有序 JSON 数组;顺序即展示顺序)。首次未配置时以静态 `PROJECTS`(content.local.ts)为初始列表。
- **软删除**:删除 = 移入「垃圾箱」(标记 `deleted`,`/admin` 可恢复或彻底删除);首页不显示垃圾箱项目。
- 接口:`GET/POST/DELETE /api/admin/projects`(仅站长):GET 取全部(含垃圾箱)、POST 整表保存、DELETE 恢复静态默认。
- SSR:`page.tsx` 用 `getVisibleProjects()`(排除垃圾箱)下发给首页,**保存即生效**。

## 口径

- **PV** = `type='visit'` 行数(`leave` 不计入 PV);**UV** = 按 `(day, cid)` 去重;**在线** = 近 N 分钟(默认 5)内出现过的 cid 数(粗略估算)。
- **会话**:同一 cid 相邻事件间隔 > 30 分钟切一次。
- **平均会话时长**:优先用会话内 `leave` 事件的 `dwell` 求和(真实前台停留);若该会话无 `dwell`(老数据 / 未触发离开上报),回退为「会话内首末事件间隔」估算。
- **admin 访客明细**:展开后显示「看过区块」(按区块聚合计数,用中文名)与「最近操作」(访问/点击/下载,`leave`/`section_view` 不重复列流水);区块目标形如 `/#usage`,显示为友好名(见 `SECTION_LABELS`)。
- 访客口径:**排除站长本人与 MOCK**;过滤爬虫;UV 按天去重。

## 隐私

公开区块**只展示聚合数字**,不含 cid / ip / 原始访问明细;cid 为随机匿名 ID,不下发前端。
