# 首页统计(访客 / 留言 / 事件)

统计分三处展示,均为聚合数字,不含任何 cid/ip 明细:

## 展示位置

- **访客统计(悬浮)**:首页**右上角悬浮按钮**(如「访问 12 · 访客 5」),**可拖动**(位置记入 `localStorage`),
  **鼠标悬停展开**浮层(移走自动折叠),显示 **访问量(PV)**、**访客(UV)**、近 7 天 PV 趋势。**公开可见**,功能门控 `visitor-stats`。
- **项目点击**:每个**项目卡**上常驻显示「N 次点击」。
  - 仅当该项目 `demoUrl === '/'`(**指向本站,即「本页 · 个人主页」**)时,N = 该项目链接点击次数 + **全站 PV**(站内访问量);
  - 其余(外部 demo/repo)项目,N = **链接点击次数**(点「试用/repo」按钮 `project_click` 累计)。
- **admin「统计」Tab**:`/admin` → 统计,展示 **留言**(总/今日/公开/仅站长可见/留言者)、
  **简历下载**、**项目点击**(按项目列出)、**访客**(PV/UV/今日/在线)、
  **访客明细**(最近活跃的 30 位访客:昵称/匿名 ID、访问/留言/简历/项目点击、最近活跃;
  点击行展开:首访时间、新客/回头客、会话次数与平均时长、设备(系统·浏览器·终端)、
  来源(referrer)、项目点击明细、最近事件流)。仅站长可见。

## 采集方式(客户端 beacon)

- 页面加载时,`TrackBeacon` 向 `POST /api/track` 上报 `{type:'visit', target: pathname}`。
- 项目「试用/repo」链接、简历「下载」按钮点击时上报 `project_click`(target=项目 id)/ `resume_download`。
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
| type | `visit` / `project_click` / `resume_download` |
| target | 路径 / 项目 id / 文件名 |
| ua | User-Agent(仅用于过滤,不展示) |

聚合在 `Db.stats()`(`packages/shared/src/server/db.ts`);SSR 由 `page.tsx` 计算后下发。

## 项目配置(admin 后台覆盖)

`/admin` → **项目** Tab(或单区模式下的「项目管理」面板)可在线覆盖各项目的
名称/描述/周期/状态/featured/demoUrl/repoUrl/tech:

- 存储:`project_overrides` 表(`packages/shared/src/schema.ts`);未覆盖字段跟随静态 `PROJECTS`。
- 接口:`GET/POST/DELETE /api/admin/projects`(仅站长)。
- SSR:`page.tsx` 用 `applyProjectOverrides(PROJECTS, db.getProjectOverrides())` 合并后下发,**保存即生效**。
- 「恢复默认」= 删除该项目的覆盖记录。
- 口径:字段留空表示「跟随默认」,不会把默认值写死;`featured` 用 `-1=默认 / 1=是 / 0=否`。

## 口径

- **PV** = `type='visit'` 行数;**UV** = 按 `(day, cid)` 去重;**在线** = 近 N 分钟(默认 5)内出现过的 cid 数(粗略估算)。
- 访客口径:**排除站长本人与 MOCK**;过滤爬虫;UV 按天去重。

## 隐私

公开区块**只展示聚合数字**,不含 cid / ip / 原始访问明细;cid 为随机匿名 ID,不下发前端。
