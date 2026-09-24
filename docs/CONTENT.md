# 内容管理(运行时 content.json + 热更新)

站点的个人资料(**姓名 / 简介 / 链接 / 技能 / 时间线 / 项目 / 联系方式 / SEO meta**)
**不进 git、不进 Docker 镜像**,而是从 `docker/site-content/content.json` 在运行时读取,
`mtime` 一变即热更新(**改完刷新页面就生效,无需重启、无需重建**)。

## 一句话流程

```bash
# 1) 编辑真实资料(不入库,只存在于本地)
vim packages/shared/src/content.local.ts

# 2) 导出为运行时 JSON(会写入 docker/site-content/content.json)
cd packages/shared && npm run export:content

# 3) 本地预览(服务器需重启的旧流程已消除;dev 直接热更新)
cd apps/next-home && curl -s localhost:3000/ | grep 你的名字   # 已变

# 4) 上线:把 JSON 传到服务器(内容不经过 git / CI)
scp docker/site-content/content.json zx@服务器:~/zxLumen-Blog/docker/site-content/content.json
```

> 新增字段 / 想提前预览:直接改 `docker/site-content/content.json` 也是一样有效(下次
> `export:content` 会用 `content.local.ts` 覆盖它,所以日常以 `content.local.ts` 为准)。

## 文件分工

| 文件 | 入 git? | 作用 |
|---|---|---|
| `packages/shared/src/content.local.ts` | 否(`.gitignore`) | 真实资料,**唯一的编辑入口** |
| `packages/shared/src/content.local.example.ts` | 是 | 建站模板 / 占位默认值来源 |
| `packages/shared/src/content.default.ts` | 是 | 运行时兜底默认值(取 example) |
| `docker/site-content/content.json` | 否(`.gitignore`) | `export:content` 产物,运行时读取 |
| `docker/site-content/resume.pdf` / `wechat.png` | 否 | 简历 / 二维码(Caddy 静态服务) |

## 为什么

- **隐私**:真实姓名/邮箱/简历从不进 git,CI 构建镜像里也不含这些文件
  (`.dockerignore` 已排除 `content.local.ts` / `content.json` / `resume.pdf` / `wechat.png`)。
- **热更新**:服务端 `getRuntimeContent()`(见 `packages/shared/src/server/content-runtime.ts`)
  每次按 mtime 重读文件,缓存失效即生效。
- **部署简单**:Server 只拉镜像 + 挂载文件;改文案不必重新构建 / 发布。

## 渲染链路

1. 服务端:`@zx/shared/server` 的 `getRuntimeContent()` 读 `CONTENT_FILE`
   (compose 里为 `/srv/site/content.json`;本地缺省自动找仓库 `docker/site-content/content.json`)。
2. UI 组件全部改为 props 注入(`Hero`/`Topbar`/`AboutSection`/`Footer`/`ProjectsSection`/
   `ContactActions`/`AdminPanel`),`layout.tsx` 的 `generateMetadata` 与
   `page.tsx` / `settings.ts` / `projects-config.ts` 都用运行时内容;缺文件时回退占位默认值。
3. `resume.pdf` / `wechat.png` 由 Caddy 从 `/srv/site` 直接静态服务,不进应用。

## 数据库里的覆盖

- admin 后台的「联系方式 / 项目 / 昵称」等**存数据库 `meta`**,是**覆盖值**;
  内容 JSON 只是默认值。改了内容 JSON 但 DB 里有旧覆盖时,以 DB 为准(admin 里可删/改)。
- 邮箱假设「改了 `content.local.ts` → 上线后邮箱没变」,多半是 admin 里存了 `contact_email`。