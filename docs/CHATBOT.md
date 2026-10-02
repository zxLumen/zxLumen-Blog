# 问答机器人(Lumen · 子祥的分身)

访客在右下角与"刘子祥的 AI 分身"对话:人格 + 站点知识 + 检索块 → 调托管 LLM API → 流式返回。
服务器**不部署模型**,只负责拼上下文、检索知识库、转发流、记日志。

## 目录与文件

运行时目录 `docker/site-content/chatbot/`(**不入库**,部署时随 site-content 挂载上传):

```
chatbot/
  persona.md       人格(第一人称人设,蒸馏产物,可手改;改完即时生效)
  faq.json         引导问答(蒸馏产物,可手改)
  knowledge/*.md   站点知识(每次问答按需注入,宜小而准)
  corpus/*.md|txt  蒸馏原料(丢这里,admin「机器人 → 扫描并蒸馏」)
```

首先生成骨架:

```bash
cd packages/shared && npm run seed:chatbot
```

> 目录解析优先级:`CHATBOT_DIR` 环境变量 > `<仓库>/docker/site-content/chatbot`。改动无需重启:
> `persona.md`/`faq.json` 与 `knowledge/*.md` 按 mtime 热加载。

## 启用步骤

1. `seed:chatbot` 生成运行目录;往 `corpus/` 丢自己的文字(随笔/经历/干货)。
2. `apps/next-home` 的 `.env` 加 `CHATBOT_API_KEY`(聊天)与 `CHATBOT_EMBED_API_KEY`(向量,可选);
   key 也可在 admin「机器人」里填,两者可并存。
3. docker compose 里把 `docker/site-content/chatbot` 挂进 `/srv/site/chatbot`(见下方「生产部署」)。
4. `admin → 机器人`:选聊天 provider + 模型、`embedding`(可选)→ 保存。
5. 「扫描并蒸馏」:自动分类 corpus(人格素材 vs 事实知识),知识类切块(500/75)入库,
    人格类汇总 → 点「生成人格」产出 `persona.md + faq.json`。
   - **两者都在后台跑**:点「扫描并蒸馏」/「生成人格」立即返回,面板显示 `done/total`(蒸馏)或「生成中→成功·FAQ n 条 / 失败」,并显示 `persona.md`/`faq.json` 最后写入时间,**刷新页面也能看到结果**;同一时刻只允许一个任务,可点「取消」。
   - **也可直接在 admin「机器人 → 灵魂蒸馏」上传** `.md/.txt`(**可多选文件或整个文件夹**;单文件 ≤2MB):
     上传成功即在**后台**执行「扫描并蒸馏」(分类+入库;人格仍只会「待生成」,由你单独点「生成人格」)。
     重名/类型不支持会返回错误;corpus 列表可一键 ✕ 删除(同步移除其知识块)。
     需服务器 `chatbot/` 目录可写(appuser 10001,见「生产部署」)。
   - **敏感信息过滤**(上传/蒸馏自动执行):`lib/chat/sanitize.ts` 两档检测——
     - **硬检测**(格式命中即脱敏,替换为 `×××`):身份证(18/15)、护照/通行证、银行卡(Luhn)、连续≥16 位数字、手机/座机/400、邮箱(本站公开联系方式自动豁免)、API 密钥( `sk-`/`ghp_`/`AKIA`/`AIza`/JWT 等)、数据库/带密码 URL、SSH 私钥块、内网 IP、GPS 坐标(需 经纬/坐标 语境)、车牌。
     - **语境检测**(亲属称谓 + 号码、出生/生日、家庭住址、密码口令 等关键词+跟随值)脱敏并标注「(语境)」。
     - 脱敏在**读取时生效,不改写磁盘原文件**;库存与送 LLM 的均为脱敏版(人格/知识出站另有 `sanitize` 兜底)。文件被命中时列表显示「⚠ 已脱敏:…」,**示例写法误报**(如 `138-0000-0000`、`192.168.1.1` 教程)可点「按原文放行」(存 `meta.chatbot_sensitive_allow`),恢复脱敏随时可切回;记录见 `meta.chatbot_sanitized`。
     - 能力边界:纯中文**姓名**无可靠格式,不单独拦截;但「父母/家属+姓名+生日/住址/号码」的语境组合会命中。上传时若探测到敏感内容会一并提示。删除 corpus 会顺带清掉其放行/脱敏记录。
   - **垃圾内容自动过滤**(蒸馏时自动执行,类比脱敏):`lib/chat/junk.ts` 判定备忘录碎屑——
     - **自动跳过**(标记 `已忽略`,不入库、不算出错,留盘可恢复):**近空**(去掉 markdown 标题行/空行/分隔线后正文为空)、**无实词**(正文所有非空行都不含中/英文词,即纯数字/符号/乱码)。
     - **仅提示**(不自动跳过,避免误伤简短备忘):正文 <10 字符但含中文词,如 `胃药`/`董师傅`;列表行内显示 `⚠ 疑似垃圾:太短`。
     - 面板「已忽略」组内点「恢复入库」即豁免(存 meta `chatbot_junk_keep`)并重新摄取;已恢复的文件行尾有「恢复过滤」按钮可重新忽略。重新过滤时连带清掉其旧知识块,避免残留污染检索。删除 corpus 会顺带清掉其豁免记录。
    - **类别判定优先级**:手动覆盖 > 文件头指令 > 文件名/目录规则 > LLM 自动分类。
      - 文件头指令:前 500 字内 `<!-- kind: knowledge -->` 或独占一行 `kind: persona|knowledge`。
      - 文件名规则:`site-content/content/knowledge/api/docs/faq/技术` → 知识;`about-me/resume/persona/self-intro/自述/随笔` → 人格;`corpus/knowledge/`→知识、`corpus/persona/`→人格。
      - 蒸馏表「类别」列可下拉手动设为 人格/知识/自动(存 meta `chatbot_kind_overrides`)。
    - **后台跑批 + 进度**(`processCorpus`):「扫描并蒸馏」现在是**后台任务**——`POST /api/admin/chatbot/distill` `{action:'process'}` **立即返回** `{started}`,服务端继续跑;进度写入 `meta.chatbot_distill_progress` 并随 `GET` 的 `progress` 返回(`running/done/total/ok/ignored/error/current`),前端每 1.5s 轮询显示 `done/total · 当前文件`,可安全离开页面。**同一时刻只允许一个任务**(并发启动会被拒 `{started:false,reason}`)。
      - **批量分类**:需要 LLM 的素材**每 10 篇合并成一次调用**(每篇截断 1200 字)返回 JSON 数组,省去重复指令开销;解析失败自动加大预算重试,仍失败则**拆半递归**,最终退化为逐篇 `classifyText`(仍失败按 knowledge 兜底),不会留 error 死档。
      - **并发**:多批分类(`4` 路)+ 多文件入库/embedding(`4` 路)并行,时间大幅缩短。
      - **行内操作只重跑单文件**:改类别/放行/忽略/恢复入库走 `processFile(source)`,不再触发整库重跑。
      - 「全量重跑」(`force`)会重分类并重建全部知识块,前端默认不勾、勾选后有二次确认。
    - **模型建议**:分类/抽取 JSON 用**非推理**轻量模型(如 `glm-5.3-flash`)更省更稳;推理模型(如 `deepseek-v4.1-flash`)会把思维链计入输出预算,预算不足会导致答案被截断(报「LLM 未返回 JSON」)。单篇分类预算 1000、批量 2048/4096、人格 3000、FAQ 1200。
6. 前台勾「启用机器人」保存,右下角出现 💬。<br>
   - 浮标默认在**右下角**(置于「// 快捷键」浮块上方),可**拖动**(位置记忆在 `localStorage:zx.chat.fab.v2`);点开后对话窗口**跟随浮标**就近展开。
   - 浮标**常驻**:点击开/合切换(图标不变,始终显示聊天图标);窗口为 **D1 清爽全宽**风(实色底、整行消息 + 头像「刘」/「你」、常驻输入条);**整窗统一等宽字体 `--font-mono`,正文 15px**。
   - **八向缩放**:四边 + 四角把手皆可拖拽(窗口几何独立,记忆在 `localStorage:zx.chat.rect`,最小 320×360);拖浮标时窗口一起走。
   - **Markdown 渲染**:助手回复用 `react-markdown` + `remark-gfm`(加粗/列表/代码/引用/表格/链接;链接新窗口打开;不渲染原始 HTML)。
   - **头部状态动态**:空闲「AI 分身」、生成中「正在输入…」(圆点脉冲)、未配置「未就绪」。
   - **进入页面提示**(`autoOpen`):**首访**自动展开聊天窗(写 `localStorage:zx.chat.autoOpened`);**之后每次刷新**不再开窗,改为 1.2s 后在浮标旁弹**气泡**、停 7s 淡出。**气泡与窗口互斥**(先开窗则不弹;气泡在时开窗则气泡立即消失);点气泡或浮标即开窗且首句=气泡那句。
   - **智能问候**(`smartGreeting`,默认开):服务端 `lib/chat/greeting.ts` 按 日期/星期/4 档时段(早/午/晚/深夜)/节日(`lunar-typescript`)/节气/北京天气(Open-Meteo,免 key) 用**当前 chat 模型**生成问候语(每桶 **10 条**,节日会主动祝福,早晨偏"早安"、晚上偏"晚安";温度统一写成「19°C」形式,避免 ℃ 单字形在等宽字体下字形怪异)。**缓存键 = 北京日期+时段**,生成结果**落库 `meta.chatbot_greet_cache`**并全站复用。**生成由定时任务负责,不再由访客触发**:`instrumentation.ts` → `lib/chat/scheduler.ts` 在**服务启动时预热**当前时段,并**每 60s 检查一次**,跨时段(05/11/14/22 北京)/跨天自动重生成(失败下次 tick 自愈)。请求路径(`composeGreeting`)**只读缓存**:命中随机取一句,未命中回**随机语气样本**兜底、绝不触发 LLM,故 config 接口恒定毫秒级返回。admin 的 `greetings[]` 作为**语气样本**喂给模型(不直接展示)。生成会把日期/天气/样本发给模型服务商(非密钥)。
   - **问候语 / 语气样本**:`greetings: string[]`(admin 多行输入,每行一条)。`smartGreeting` 开时仅作 AI 生成问候的语气参考;关时作为静态问候语随机展示。
   - **生日/纪念日**(`greetBirthday`):`YYYY-MM-DD` 或 `MM-DD`,留空忽略;当天问候会含生日祝福。

### 生产部署(容器)

docker compose 已为 `app` 服务配置:
- 环境变量 `CHATBOT_DIR: /srv/site/chatbot`(不设的话应用会去找 `/app/.../chatbot`,读不到 corpus/persona/knowledge,蒸馏也扫不到文件);
- 挂载 `./site-content:/srv/site:ro`(父,只读)+ **`./site-content/chatbot:/srv/site/chatbot`(子,可写)**——后者覆盖前者,供蒸馏写 `persona.md`/`faq.json`。

**上线必须手动同步(不进 git / 镜像)**:
1. `scp -r docker/site-content/chatbot 服务器:~/zxLumen-Blog/docker/site-content/`(至少含 `corpus/`;
   `persona.md`/`faq.json`/`knowledge/` 视需要)。`docker/site-content/` 被 `.dockerignore` 排除,不会进镜像。
2. **权限**:容器内以 `appuser`(uid **10001**)运行,写入宿主目录需其可写:
   `sudo chown -R 10001:10001 ~/zxLumen-Blog/docker/site-content/chatbot`
   (否则「生成人格」写盘报 `EACCES`/`permission denied`)。
3. 线上 DB 的机器人配置(provider/模型/key/启用)与本地**互相独立**,需在线上 `/admin → 机器人` 重新配置。

> 说明:compose/Caddyfile 等由 `ci-run.sh` 在部署时从公开仓库自动同步;`docker/.env` 与 `site-content/` 属服务器本地,不入库。

## provider

预设:DeepSeek / OpenAI / 智谱 / 百炼 / Moonshot / 硅基流动 / OpenRouter / OpenCode Go / 本地 Ollama / 自定义(OpenAI 兼容)。
协议两种:`openai`(chat/completions + embeddings)与 `ollama`(/api/chat + /api/embed)。
- 聊天必须配置 model + key(Ollama 本地免 key)。
- **OpenCode Go**:除 `Authorization` 外还要求稳定的 `x-opencode-session` 头(否则 `400 MissingSessionID`)与自定义 `User-Agent`;
  `llm.ts` 已自动带上(会话 id 来自前台 `zx.chat.session`,蒸馏用固定 id)。
- **模型下拉选择**:面板的「模型」不再是手填,而是按 provider 调 `GET {baseUrl}/models`(Ollama 为 `/api/tags`)拉取可用模型,(`↻` 刷新);拉不到时保留「自定义…」手填兜底。
  模型列表按**已保存的** baseUrl/key 拉取;换了 provider/key 后需先「保存配置」再点 `↻`。
- **推理模型与「最大输出」**:`deepseek-v4.1-flash` 等推理模型会把思维链计入输出预算(`reasoning_content`);
  `max_tokens` 太小会先被思维链吃满 → 空回答。默认 `maxTokens=4096`;推理模型建议 ≥4096,非推理模型(如 `glm-5.3-flash`)1024 即可。
  空回答/被截断时前台会显示明确报错(不再静默空白),并写入 `chatbot_last_error`;成功一次会自动清空该错误。
- embedding 未配置时检索退化为 FTS5 关键词,不影响问答。
- embedding 维度按已知模型表自动填(如 bge-m3=1024、text-embedding-3-small=1536),未知模型手填维数。

## 接口

- `POST /api/chat`:`{ message, history?, session_id? }` → `text/plain` 流;按 IP 限流 + 每人每日上限(`meta.chatbot_config.dailyCap`),记录进 `chat_logs`(cid 含 MOCK 身份)。
- `GET /api/chat/config`:公开,仅返回 `{ enabled, name, greeting, suggestions, ready }`,不含密钥。
- `GET/POST /api/admin/chatbot`:完整配置 + 掩码密钥 + provider 列表(仅站长)。
- `GET/POST/DELETE /api/admin/chatbot/logs`:对话日志(**按 `session_id` 归并成「一次对话」**)/ 日统计 / 三种粒度清理。

  - `GET`:`?days=&limit=&offset=&q=&cid=&day=` → `{ sessions, total, offset, limit, hasMore, dayCounts }`。
    每条 session 带 `turns/msg_count/in_tokens/out_tokens/latency_ms/models/first_question` 与内嵌的
    `messages`。`q` 先圈出命中会话再聚合该会话**全部**消息(否则搜到一个词时轮数/token 只统计到
    命中的那几条);数字参数一律 clamp 兜底(`NaN` 会静默废掉分页)。`dayCounts` 按 `role='user'`
    统计每天**提问条数**,不受 `q/cid/day` 影响。
  - `POST`:`{action:'delete-session', session_id}` / `{action:'prune', keep_days}`。
    `prune` 保留**最近 N 个北京日(含今天)**,`day` 为空的历史行一并清掉。
  - `DELETE`:**不带 `confirm=1` 只回报 `{needConfirm,total,messages}`**,面板据此弹确认并说明影响
    范围;带 `confirm=1` 才真删。`total`/`sessions` 是会话数,`messages`/`deleted` 是消息行数,
    两者不是一个量,别混用。
  - 访客昵称走 `GET /api/admin/visitor-alias` 单独取,本接口不与之耦合。
- `GET/POST /api/admin/chatbot/distill`:`process`(后台扫描蒸馏,`force` 全量;立即返回 `{started}`)、`persona`(后台生成人格;立即返回 `{started}`)、`cancel`(请求取消正在跑的蒸馏/人格)、`clear`(清库)、`set-kind`、`set-sensitive-allow`(按文件放行/恢复脱敏)、`set-ignored`(按文件恢复入库/恢复自动过滤);后三者**只重跑该单文件**。GET 返回 `sensitiveAllowed`/`sanitized`、每文件的 `junk`/`nokeep`、`progress`(蒸馏进度)、`persona`(人格生成状态)与 `personaAt`/`faqAt`(产物最后写入时间)。
- `GET/POST/DELETE /api/admin/chatbot/corpus`:上传(返回每文件命中敏感类别)/删除(顺带清知识块与放行记录)。

## 关键实现

- 组装:`packages/../apps/next-home/src/lib/chat/{providers,config,llm,soul,prompt,rag,distill}.ts`
- 数据层:`chat_logs / kb_docs / kb_chunks / kb_chunks_fts`(见 `packages/shared/src/schema.ts`),
  向量存 `kb_chunks.vector`(float32 LE BLOB),JS 内余弦;关键词用 SQLite FTS5。
- 前端:`packages/shared/src/ui/ChatWidget.tsx`(挂在 `Shell`),流式读取渲染。
- admin 面板:`packages/shared/src/ui/admin/AdminChatbotPanel.tsx`(后台「机器人」Tab)。
  「对话日志」区块的行为:
  - **一次对话一张卡**:折叠时显示时间/访客昵称/轮数/模型/token/耗时 + 首问摘要,默认只展开最新一条。
  - **日统计柱状图**:近 14 天提问条数,悬停看数值,**点某天即筛选那天,再点取消**。
  - **筛选**:搜索(350ms 防抖,问题/回答/会话 id)、访客下拉、日期,可叠加;**加载更多**逐页追加
    (偏移量存在 ref 里 —— 若让加载函数依赖 `sessions.length`,追加会改变它的身份并触发重载,
    把第一页拉回来盖掉追加结果,表现为「点了没反应」)。
  - **长回答**默认截断 400 字,可展开/收起,Markdown 渲染(`react-markdown` + `remark-gfm`,
    **不开 `rehype-raw`**)。
  - **清理三档**:删本次对话 / 只保留最近 N 天 / 清空全部(先探询条数再确认)。
    清空与删会话会同步归零柱状图计数。**不做自动保留策略**,清理全靠手动。

## 上线注意

`docker/site-content/chatbot/` 不入库:本地改了 `corpus/`/`persona.md` 等,上线时要同步到服务器挂载目录(与 `content.json` 同一批 `scp`)。机器人配置/密钥在**数据库 meta**,与源码无关,上线不覆盖。