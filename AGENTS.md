# AGENTS.md

本仓库(zxLumen-Blog)的协作规范。**所有改动必须遵守下面的工作流。**

## 仓库结构

- `apps/next-home`:Next.js 16 应用(端口 3000)
- `packages/shared`:设计系统(主题/布局)+ 共享 React 组件 + 类型 + SQLite 数据层(`@zx/shared`)
- `docker/`:Dockerfile / compose / Caddyfile / 备份脚本
- `docs/`:部署、上报等文档
- `TODO.md`:待办清单 / Roadmap(新需求先记这里)

## 常用命令

```bash
# 改 shared 后必须重新编译(会生成缺失的 content.local.ts 占位)
cd packages/shared && npm run build

# 本地开发
cd apps/next-home && npm run dev      # http://localhost:3000

# 校验(提交前跑)
cd apps/next-home && npm run lint && npm run build
```

> 需要 Node 20+(推荐 22 LTS)。

## 命令调用规范(避免卡死 / 中断)

经验:工具调用「卡死 / 中断」几乎都发生在**调用过重或过多**时。务必遵守:

1. **优先用专用工具**:读文件用 Read、找文件用 Glob、搜内容用 Grep;
   绝不用 `cat` / `find` / `grep` 命令替代它们。
2. **限定范围**:Grep / Glob 必须给 `path`,尽量加 `include`;
   **绝不**全仓扫描或扫 `node_modules`、`.next`、`dist`、`*.mov` / `*.gif`。
3. **一次少发**:一条消息里不要堆多个重型 bash / 检索调用;
   失败就**单独重发那一条**,不要继续往下堆。
4. **控制输出**:命令加 `| tail -n` / `grep -c` / `-o` 收敛输出;
   避免会打印巨量内容的命令(如 `strings` 大二进制、全仓 grep)。
5. **macOS 无 `timeout`**:需要限时用 `perl -e 'alarm N; exec @ARGV' ...`,
   或给 bash 工具设 `timeout` 参数;不要用 GNU `timeout`。
6. **长驻进程**:`npm run dev` 等一律 `nohup ... &` 后台起、立即返回,不要前台运行。
7. **ssh 非交互**:加 `-o BatchMode=yes -o ConnectTimeout=8`,避免卡在登录提示。
8. **失败即重试**:读写某文件 / 路径失败时,单独重试一次,而不是重复堆调用。
9. **工具调用必须用正确的结构化调用,一次只发一个**:不要用文字描述「我要读 X」、
   不要写成 `<parameter>` / `<DSML>` / `</invoke>` 等伪标签;若连续两次调用失败或
   格式错乱,立即停止堆叠,改开新会话(或 `/compact`)再继续。

> 说明:以上能**大幅降低**中断/格式错误概率,但无法 100% 保证;底层偶发丢包或
> 模型输出偶发格式漂移时,单独重试一次或换新会话即可。

## 每次改动后的收尾(必须做)

1. 改了 `packages/shared` → 重新编译:`cd packages/shared && npm run build`
2. 校验:`cd apps/next-home && npm run lint && npm run build`
3. **拉起本地服务并确认在跑**:`cd apps/next-home && npm run dev`(端口 3000);
   若已在运行则确认仍在跑,不要留在停止状态
4. 冒烟:`curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` 与 `/admin` 均应为 `200`
5. 更新 `CHANGELOG.md`(有用户可见改动时)
6. 只有明确要求才提交 / 推送

## 工作流:本地开发 → 打包 → 部署线上(单环境)

全站**只有一个环境、一套数据**。没有 TEST/LIVE 之分,也没有功能白名单门控 ——
全部功能一律放行,各 API 只读写唯一数据库(`DB_PATH`)。

**主题 / 布局的放行由 admin 配置**(`/admin` → 「外观」Tab):可勾选对访客开放哪些
主题/布局,并设定默认项。配置存 `meta` 表键 `appearance_config`(JSON),读取/写入见
`apps/next-home/src/lib/theme-config.ts`,接口 `GET/POST /api/admin/theme-config`。
约束:**至少保留 1 个主题 + 1 个布局;默认项必须处于放行集合内**(取消默认项会自动切到
集合内其它项)。未配置时默认全部放行。首帧注入见 `themeInitScript(...)`,随配置变化。

规则:

1. 改动在**本地**自测(`npm run dev`)。
2. 验证通过后,把改动并入主线 → **打包** → 部署到线上。

> 上线即更新线上;不做线上试验,也不再需要"先 TEST 验证再晋升 LIVE"的流程。

### 用 MOCK 身份调试(仅站长)

右上角 `MOCK` 切换器(仅站长可见)可把请求伪装成某匿名访客(`${'`zx_mock`'}`),
以不同用户视角浏览/留言,用于验证"私密仅本人与站长可见""访客删除自己的留言"等。
模拟时该请求按普通访客处理(不享受站长特权);`恢复本人` 清除。
也可直接调 `POST /api/admin/mock` `{ cid }`。预设三个身份:访客 A/B/C。

**统计口径**:站长本人的访问不计入;开启 MOCK 后放行埋点,按该 mock cid 写入数据库
(见 `apps/next-home/src/app/api/track/route.ts` 与 `docs/STATS.md`)。

**每个 mock 身份 = 一台独立设备**:除身份(`zx_mock` 覆盖 `zx_cid`)外,**昵称与主题**
也按身份分键(`zx_nick.<id>` / `zx-theme.<id>`,见 `packages/shared/src/ui/identity.ts`),
切 A/B/C 时各自独立、互不影响;昵称默认留空,填后各自记住。首帧主题由
`themeInitScript(..., mockId)` 注入。普通访客无 `zx_mock`,始终用无后缀键。

## 隐私:以下文件不入库(部署需单独提供)

- `packages/shared/src/content.local.ts`(真实资料;有 `content.local.example.ts` 占位)
- `apps/next-home/public/resume.pdf`、`public/wechat.png`
- `apps/next-home/resume/resume.md|html|pdf`(仅 `resume.py`/`resume.css` 入库)

## 部署时必须同步的「不入库」内容(**每次上线都要做**)

这些文件被 `.gitignore` 忽略,`git pull` **不会更新**;若只在本地改过,线上仍是旧值:

1. **`packages/shared/src/content.local.ts`** —— 你的真实资料(姓名 / shell / 邮箱 /
   bio / 合作链接 / 技术栈 / 时间线 / 项目卡 / 联系方式)。**改了它就必须上传到线上**
   (`scp` 到 `~/zxLumen-Blog/packages/shared/src/content.local.ts`),然后**重新 build
   + 重建容器**(它编译进 shared dist)。否则线上仍显示旧资料(如左上角 brand)。
2. **`apps/next-home/public/resume.pdf` / `public/wechat.png`** —— 简历 / 微信二维码。
3. **数据库里的联系方式**(`meta.contact_email` 等)是 admin 覆盖值,**与源码无关**;
   改了邮箱/联系方式要**同时更新线上库**(线上 `/admin → 个人信息`,或直接改 `meta`)。

> 一句话:**源码改了 `content.local.ts` / 简历 / 二维码 / 联系方式 → 上线时必须把它们
> 传到线上并重建**。仅 `git push` + 容器重建是不够的。

## 上线授权(**重要**)

**未经用户明确说「上线」,绝不部署线上**:不 push、不 SSH 到服务器、不重建容器。
日常改动只在本地完成(改代码 + 本地自测 + 拉起 dev);是否提交/推送/上线,
一律等用户明确指示。即使用户说「改完再说」,也只是攒着,不代表可以上线。

## Git 规范

- 原子提交,Conventional Commits,**中文 subject**(如 `feat(admin): ...`)
- 小改动先攒着,发版时统一打 tag
- 只有明确要求才提交 / 推送

## 环境变量

`DB_PATH`(唯一库)/ `ADMIN_PASSWORD` / `SESSION_SECRET` / `REPORT_TOKEN`,
见各 `.env.example`。默认值可跑 demo,**上线前务必修改**。

## Next.js 版本

本仓库的 Next.js 与训练数据可能不同,写代码前先读 `apps/next-home/AGENTS.md` 指向的
`node_modules/next/dist/docs/`。注意 `apps/next-home/AGENTS.md` 为 `next dev` 自动生成/维护。
