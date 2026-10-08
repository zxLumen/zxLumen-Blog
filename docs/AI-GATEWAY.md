# AI 网关与统一密钥

主站(zxLumen-Blog)作为**唯一的大模型密钥持有方**,对外暴露一个 **OpenAI 兼容代理网关**。
旗下所有应用(聊天机器人、luminari、Opentodo、yijing64、StockApp、RAG-Knowledge-QA…)
都经该网关调用大模型,**真实 provider key 只存主站数据库**,不下发到子应用。

> 「Token用量」里的智谱 / DeepSeek / OpenCode 凭据是**用量监控**专用,与本网关无关,仍各自独立管理。

## 网关接口

OpenAI 兼容,透传到上游:

| 路径 | 用途 |
| --- | --- |
| `POST /api/ai/v1/chat/completions` | 对话补全(支持流式 SSE) |
| `POST /api/ai/v1/embeddings` | 向量 |
| `GET /api/ai/v1/models` | 模型列表 |
| `POST /api/ai/v1/audio/transcriptions` | 语音转写(可含说话人分离;`multipart/form-data`) |

地址:
- 公网:`https://${DOMAIN}/api/ai/v1`
- 容器内网(推荐,子应用同处 `web` 网络):`http://app:3000/api/ai/v1`

## 鉴权

请求头二选一,值为**应用令牌**(admin「AI 密钥」页为每个应用签发):

```
Authorization: Bearer zxai_xxxxxxxx...
# 或
x-zx-app-token: zxai_xxxxxxxx...
```

无令牌 / 令牌无效 → `401`;超额 → `429`;上游不可达 → `502`。
令牌可随时在面板禁用或「重新生成」。

## 路由与模型

网关按如下顺序选上游密钥:
1. 该令牌**绑定的密钥**(`providerId`);
2. 否则按请求体 `model` 在密钥池里匹配(`models` 字段);
3. 否则用**默认对话 / 默认向量**密钥。

**模型选择优先级**(高 → 低):
1. 应用令牌的「固定模型」;
2. 该密钥的「默认模型」;
3. 子应用请求体里的 `model`。

密钥池提供常见供应商预设(OpenCode Go/Zen、DeepSeek、智谱、OpenAI、百炼、Moonshot、
硅基流动、OpenRouter、Ollama),选中即自动填 baseUrl;密钥池与令牌都支持「拉取模型」
(读上游 `GET /models`)后下拉选择;不选则自动回退下一级。
上游 `baseUrl` 由密钥决定,子应用只发 `model`(或完全不发)。
OpenCode Go 端点(`opencode.ai/zen/go`)要求 `x-opencode-session` 头,网关会自动补上,子应用无需处理。

## 音频转写与说话人分离

`POST /api/ai/v1/audio/transcriptions`(`multipart/form-data`,鉴权同上):

| 字段 | 说明 |
| --- | --- |
| `file` | 音频文件(建议先压成 16k 单声道 opus/mp3;上限 25MB) |
| `language` | 可选,如 `zh` |
| `diarize` | 可选,`true`/`1` 时做**说话人分离**(需音频密钥形状支持) |
| `model` | 可选,覆盖密钥默认模型 |

网关按**音频密钥**的「接口形状」分派并**归一化**返回:

```json
{ "text": "…", "language": "zh",
  "segments": [ { "start": 0, "end": 2.4, "speaker": "S1", "text": "…" } ],
  "seconds": 123.4 }
```

- `speaker=null` 表示未做分离(单人转写)。
- 形状(在 admin「AI 密钥」页的音频密钥上选择):
  - **OpenAI 兼容**:普通转写用 `{baseUrl}/audio/transcriptions`(`response_format=verbose_json`);
    当 `diarize=true` 时改用专用分离模型 **`gpt-4o-transcribe-diarize`** + `response_format=diarized_json`
    (+ `chunking_strategy=auto` 以支持 >30s),返回 `segments[].speaker`(A/B/C → S1/S2…)。
    硅基流动 SenseVoice 等也走此形状(但无分离,`diarize=true` 时无 speaker)。
  - **Deepgram**:`{baseUrl}/v1/listen` + `diarize_model=latest`,一次请求即含分离。
  - **AssemblyAI**:上传 → 建任务(`speaker_labels:true`)→ 轮询,返回 utterances。
    模型用 `universal-3-5-pro`(分离更准)或 `universal-2`(更便宜);可传 `speakers_expected`
    (预计人数,1–20,能提升准确度)。**无公开模型列表接口**,面板「拉取模型」返回内置清单
    (`universal-3-5-pro` / `universal-2`)。
- 说话人仅在 `diarize=true` 且上游形状支持时出现。
- 音频密钥与对话/向量密钥**分开**管理,并各有「默认音频」密钥。

## 额度限流

每个令牌可设 **每日 token 上限** 与 **总量 token 上限**(0 = 不限)。
网关按上游返回的 `usage` 累计(prompt/completion/cached),北京时间日切;
流式请求网关会自动补 `stream_options.include_usage` 以拿到 usage。超限直接 `429`。
音频请求另设 **音频分钟上限**(0 = 不限),按音频时长累计;超限同样 `429`。
面板可查看今日 / 累计用量(含音频分钟)并「重置用量」。

## 用量统计

每次请求按 **北京日 × 北京时 × 应用令牌 × 密钥池(provider) × 模型** 累加进 SQLite 表 `ai_usage`
(`requests` / `input_tokens` / `output_tokens` / `cache_hit_tokens` / `audio_seconds`)。
首页「Token用量」新增 **AI 网关** 数据源(供应商 tab),按所选区间展示:

- 总览(请求数 / 总 token / 输入 / 输出 / 缓存);
- 趋势(**今天/昨天按小时,24 格**;其余按天)+ 按模型分布;
- **按应用令牌** 与 **按密钥池(上游)** 两个维度的用量排行(可点击筛选);
- 明细表(**今天/昨天按小时**记,其余按天;key 列 = 应用)。

不显示成本(上游 baseUrl/模型任意,无统一价目)。


## 子应用接入

子应用的 AI 配置(provider + baseURL + key)改为指向网关:

| 项 | 值 |
| --- | --- |
| provider | 博客 AI 网关(OpenAI 兼容) |
| baseURL | `http://app:3000/api/ai/v1`(内网)或 `https://${DOMAIN}/api/ai/v1` |
| apiKey | 该应用的接入令牌(面板复制) |
| model | 照常填写(网关按它路由;或由令牌固定) |

- luminari / Opentodo / yijing64 / StockApp:`web/lib/providers.js` + `settings.js`
- RAG-Knowledge-QA:`src/qa/providers.py` + `src/qa/llm_config.py`
- 各应用均保留「直连」选项,便于本地开发(默认走网关)。

部署时经 `docker-compose.yml` 注入(见主仓 compose 各服务):

```
ZX_AI_GATEWAY_URL=http://app:3000/api/ai/v1
ZX_AI_APP_TOKEN=<面板复制的令牌>
```

## 与聊天机器人的关系

主站聊天机器人的 Chat / Embedding 密钥也取自本网关的「默认对话 / 默认向量」密钥
(环境变量 `CHATBOT_API_KEY` / `CHATBOT_EMBED_API_KEY` 仍优先)。
旧键 `chatbot_chat_key` / `chatbot_embed_key` 会在首次打开面板时**自动迁移**进密钥池。

## 安全

- 真实 key 只存服务器 SQLite(`meta.ai_gateway_config`),面板只回掩码。
- 令牌明文存库以便复制,不进镜像 / 不进 git。
- 网关仅接受已签发令牌,未授权请求一律拒绝。
