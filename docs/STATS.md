# 首页统计(访客 / 留言 / 事件)

首页新增 **STATS** 区块(功能门控 `visitor-stats`),展示聚合统计,不含任何 cid/ip 明细。

## 展示内容

- **访客**:总访问(PV)、独立访客(UV)、今日 PV/UV、在线(近 5 分钟活跃 UV)、近 30 天 PV 趋势
- **留言**:总数、今日新增、公开数、仅站长可见数、留言者数
- **事件**:项目点击总数、简历下载数、热门项目 Top5

## 采集方式(客户端 beacon)

- 页面加载时,`TrackBeacon` 向 `POST /api/track` 上报 `{type:'visit', target: pathname}`。
- 项目「试用/repo」链接、简历「下载」按钮点击时上报 `project_click`(target=项目 id)/ `resume_download`。
- 服务端 `POST /api/track`:
  - **始终采集**(匿名聚合,便于放行前积累历史);
  - **排除**:站长本人(`isAdmin`)、MOCK 模拟访客、常见爬虫/扫描器 UA;
  - 按 IP 宽松限流(120/分钟),超限静默丢弃;
  - 首次访问下发访客匿名 ID `zx_cid`(httpOnly)。
- 是否**对外展示**由功能门控 `visitor-stats` 决定(见 `packages/shared/src/features.ts`)。

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

## 口径

- **PV** = `type='visit'` 行数;**UV** = 按 `(day, cid)` 去重;**在线** = 近 N 分钟(默认 5)内出现过的 cid 数(粗略估算)。
- 访客口径:**排除站长本人与 MOCK**;过滤爬虫;UV 按天去重。

## 隐私

公开区块**只展示聚合数字**,不含 cid / ip / 原始访问明细;cid 为随机匿名 ID,不下发前端。
