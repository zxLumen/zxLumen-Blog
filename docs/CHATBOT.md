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
   - **类别判定优先级**:手动覆盖 > 文件头指令 > 文件名/目录规则 > LLM 自动分类。
     - 文件头指令:前 500 字内 `<!-- kind: knowledge -->` 或独占一行 `kind: persona|knowledge`。
     - 文件名规则:`site-content/content/knowledge/api/docs/faq/技术` → 知识;`about-me/resume/persona/self-intro/自述/随笔` → 人格;`corpus/knowledge/`→知识、`corpus/persona/`→人格。
     - 蒸馏表「类别」列可下拉手动设为 人格/知识/自动(存 meta `chatbot_kind_overrides`)。
   - **模型建议**:分类/抽取 JSON 用**非推理**轻量模型(如 `glm-5.3-flash`)更省更稳;推理模型(如 `deepseek-v4.1-flash`)会把思维链计入输出预算,预算不足会导致答案被截断(报「LLM 未返回 JSON」)。分类预算 1000、人格 3000、FAQ 1200。
6. 前台勾「启用机器人」保存,右下角出现 💬。<br>
   - 浮标默认在**右下角**(置于「// 快捷键」浮块上方),可**拖动**(位置记忆在 `localStorage:zx.chat.fab.v2`);点开后对话窗口**跟随浮标**就近展开。
   - 浮标**常驻**:点击开/合切换(图标不变,始终显示聊天图标);窗口为 **D1 清爽全宽**风(实色底、整行消息 + 头像「刘」/「你」、常驻输入条)。
   - **八向缩放**:四边 + 四角把手皆可拖拽(窗口几何独立,记忆在 `localStorage:zx.chat.rect`,最小 320×360);拖浮标时窗口一起走。
   - **Markdown 渲染**:助手回复用 `react-markdown` + `remark-gfm`(加粗/列表/代码/引用/表格/链接;链接新窗口打开;不渲染原始 HTML)。
   - **头部状态动态**:空闲「AI 分身」、生成中「正在输入…」(圆点脉冲)、未配置「未就绪」。
   - **进入页面自动弹出**(配置项 `autoOpen`,默认开)。
   - **问候语多条随机**:配置 `greetings: string[]`,每次进入页面随机取一条(admin 多行输入,每行一条)。

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
- `GET/POST/DELETE /api/admin/chatbot/logs`:对话日志 / 日统计 / 清空。
- `GET/POST /api/admin/chatbot/distill`:`process`(扫描蒸馏,`force` 全量)、`persona`(生成人格)、`clear`(清库)。

## 关键实现

- 组装:`packages/../apps/next-home/src/lib/chat/{providers,config,llm,soul,prompt,rag,distill}.ts`
- 数据层:`chat_logs / kb_docs / kb_chunks / kb_chunks_fts`(见 `packages/shared/src/schema.ts`),
  向量存 `kb_chunks.vector`(float32 LE BLOB),JS 内余弦;关键词用 SQLite FTS5。
- 前端:`packages/shared/src/ui/ChatWidget.tsx`(挂在 `Shell`),流式读取渲染。
- admin 面板:`packages/shared/src/ui/admin/AdminChatbotPanel.tsx`(后台「机器人」Tab)。

## 上线注意

`docker/site-content/chatbot/` 不入库:本地改了 `corpus/`/`persona.md` 等,上线时要同步到服务器挂载目录(与 `content.json` 同一批 `scp`)。机器人配置/密钥在**数据库 meta**,与源码无关,上线不覆盖。