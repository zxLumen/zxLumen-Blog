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
3. docker compose 里把 `docker/site-content/chatbot` 挂进 `/srv/site/chatbot`(见 DEPLOY)。
4. `admin → 机器人`:选聊天 provider + 模型、`embedding`(可选)→ 保存。
5. 「扫描并蒸馏」:自动分类 corpus(人格素材 vs 事实知识),知识类切块(500/75)入库,
   人格类汇总 → 点「生成人格」产出 `persona.md + faq.json`。
6. 前台勾「启用机器人」保存,右下角出现 💬。

## provider

预设:DeepSeek / OpenAI / 智谱 / 百炼 / Moonshot / 硅基流动 / OpenRouter / OpenCode Go / 本地 Ollama / 自定义(OpenAI 兼容)。
协议两种:`openai`(chat/completions + embeddings)与 `ollama`(/api/chat + /api/embed)。
- 聊天必须配置 model + key(Ollama 本地免 key)。
- **模型下拉选择**:面板的「模型」不再是手填,而是按 provider 调 `GET {baseUrl}/models`(Ollama 为 `/api/tags`)拉取可用模型,(`↻` 刷新);拉不到时保留「自定义…」手填兜底。
  模型列表按**已保存的** baseUrl/key 拉取;换了 provider/key 后需先「保存配置」再点 `↻`。
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