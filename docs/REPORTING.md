# DeepSeek 用量上报

主页暴露了一个上报接口,你的 DeepSeek 后端服务每次调用完成后,把 `usage` 推上来即可。

## 接口

```
POST /api/usage
Header: X-Report-Token: <REPORT_TOKEN>
Content-Type: application/json

{
  "model": "deepseek-chat",          // 或 deepseek-reasoner
  "input_tokens": 1234,
  "output_tokens": 567,
  "cache_hit_tokens": 200,           // 可选,命中缓存的输入
  "ts": "2026-09-20T12:00:00Z"       // 可选,默认服务器时间
}
```

响应:`{ "ok": true, "row": { ... } }`

## curl 示例

```bash
curl -X POST https://你的域名/api/usage \
  -H "X-Report-Token: $REPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","input_tokens":1200,"output_tokens":450,"cache_hit_tokens":300}'
```

## Node 示例(调用 DeepSeek 后上报)

DeepSeek 的 Chat Completions 返回体里带有 `usage` 字段,直接转发:

```js
const res = await fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ model: 'deepseek-chat', messages }),
})
const data = await res.json()

// 上报给个人主页(失败不影响主流程)
try {
  await fetch('https://你的域名/api/usage', {
    method: 'POST',
    headers: {
      'X-Report-Token': process.env.REPORT_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: data.model,
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens,
      cache_hit_tokens: data.usage.prompt_cache_hit_tokens ?? 0,
    }),
  })
} catch (e) {
  console.warn('usage report failed', e)
}
```

## 计价与展示

`packages/shared/src/pricing.ts` 里维护 DeepSeek 价目(¥/百万 tokens),
首页用量面板按此估算成本。官方调价时改这一个文件即可。
