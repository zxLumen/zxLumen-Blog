# AI 状态协议(`zx:ai-status`)

导航栏那盏三色状态灯由 `packages/shared/src/ui/ai-status.ts` 的**站内 AI 状态总线**
统一合并:各 AI 组件把「此刻在干什么」报上来,灯按优先级取最高的那盏显示给访客。
语义(状态枚举 / 优先级 / TTL / 三灯配色与动画)移植自 `AI-Status-Light`。

## 两个边界

- **纯客户端、按访客自己算、不落库**:访客 A 的灯只反映 A 自己的 AI 活动,与他人
  互不影响,刷新即重置。
- **不跨站广播**:跨子域应用只能在**被本站 iframe 嵌入**时上报(见下)。

## 谁来实现

| 源 | id | 实现位置 |
| --- | --- | --- |
| AI 分身 | `avatar` | 本仓库 `ChatWidget.tsx`(`useReportAiState('avatar')`) |
| Opentodo | `opentodo` | Opentodo 仓库 `web/src/App.tsx` |
| 易经六十四卦 | `yijing` | yijing64 仓库 `web/src/lib/aiStatus.ts` |

**加一个新源**:

1. 在 `ai-status.ts` 的 `AI_SOURCES` 登记一行 `{ id, label }`(只为了让灯认识这个名字);
2. 跨子域的应用在自己的前端照下面的协议上报即可,本仓库零改动;
   同仓库的组件则在该组件里加一行 `useReportAiState(id)`。

## 协议

**宿主前提**:应用面板的 iframe 必须 `referrerPolicy="origin"`,**不能是
`no-referrer`** —— 跨源 iframe 要靠 `document.referrer` 反推宿主 origin,才知道
postMessage 该发给谁。设成 `no-referrer` 会让它拿到空串,应用侧随即静默不上报,
表现为「AI 状态灯死活不变」,而且没有任何报错。`origin` 只透出 origin(不含路径与
查询串),够用又不泄漏具体页面。

嵌入页的 iframe 里向 `window.parent` 发:

```js
window.parent.postMessage(
  { type: 'zx:ai-status', app: '<应用 id>', state: '<状态>', detail: '<可选短文本>' },
  '<宿主 origin>',
)
```

| 字段 | 说明 |
| --- | --- |
| `type` | 固定 `'zx:ai-status'` |
| `app` | 应用 id,须与 `AI_SOURCES` 里登记的一致(用应用栏条目的 `id`) |
| `state` | `'idle' \| 'thinking' \| 'working' \| 'busy' \| 'success' \| 'error' \| 'blocked'` |
| `detail` | 可选,给站长看的短文本;宿主会截断到 120 字符 |

**接收端(`AppPanel.tsx`)做的校验**(缺一不可):

1. `e.origin` 必须等于当前应用 URL 的 origin;
2. `d.app` 必须等于当前应用条目的 `id`;
3. `d.state` 必须落在 `AI_STATES` 里。

## 上报方必须遵守的两条

**目标 origin 取自 `document.referrer`,绝不退回 `'*'`。** 跨源时默认 referrer
策略只透出 origin,正好够用;取不到就不报。退化成 `'*'` 等于把状态广播给任意
嵌入页。

```js
const HOST_ORIGIN = (() => {
  try {
    return document.referrer ? new URL(document.referrer).origin : ''
  } catch {
    return ''
  }
})()
```

**不在 iframe 里时静默跳过**(`window.parent === window`),独立打开或本地开发都
不产生任何消息。

## 状态怎么选

| 状态 | 含义 | TTL |
| --- | --- | --- |
| `blocked` | 需要人来处理(如「站长还没配 API Key」) | 5 分钟 |
| `error` | 出错了 | 1 分钟 |
| `success` | 刚答完 | 25 秒 |
| `busy` / `working` | 正在处理请求 | 90 秒 |
| `thinking` | 模型在思考 | 90 秒 |
| `idle` | 空闲(常驻) | — |

成功/出错不立刻熄灭 —— 「刚答完」留一瞬绿光,跟真灯手感一致。中断(`Abort`)
应主动回报 `idle`,别留一盏黄灯空转到 TTL 结束。

## 应用「可用性」由宿主管

面板挂载 = 该应用此刻可用,宿主会 `setAiSourceAvailable(app.id, true)`;关掉浮层
即置 `false`(灯熄灭、退出合并)。**应用自己不需要上报可用性**,也不要重复上报。

## 悬浮展开:访客也能看明细

鼠标移上去(键盘是聚焦)就浮出逐源明细,**访客与站长都能看** —— 灯本来就是按访客
自己算的,明细里也只有他自己的那几个源(`ownerOnly` 的全局源对访客不可见)。旁边
灯旁边那行常驻状态文字**同样人人可见**(字号与顶栏导航项相同),它本来就是导航的注脚。触屏没有悬浮,靠点击。

## 尺寸:按视口宽度分档,横版 / 竖版两套

同一个节点两种形态,两套阶梯(`styles.css` 的「AI 状态灯」段):

| 视口宽 | 横版(顶栏 / 手机) | 竖版(左栏底部) |
| --- | --- | --- |
| <480 | 18px | — |
| <820 | 21px | — |
| <1440 | 25px | 31px |
| <1920 | 29px | 36px |
| <2560 | 34px | 42px |
| ≥2560 | 40px | 50px |

- **横版**(顶栏布局、手机)按 B 档;**竖版**(左栏)按 C 档 —— 左栏只有 208px 宽
  但纵向有整列高度可用,竖着摆反而能比横排更大。CSS 里只写一套阶梯
  (`--zx-lamp-s`)+ 一个摆放系数(`--zx-lamp-scale`,竖版 1.24),避免同一档位在两个
  选择器里各写一遍。
- 顶栏那档是**绝对定位挂在导航栏下沿**,出流不占高度,所以 `--zx-topbar-h` 不变
  (带灯 / 去灯都是 58px)。手机(≤820px)跟随顶栏换行后居中,会遮住首屏一条
  (18px 灯遮 28px、25px 灯遮 39px),这是有意接受的。
- 外壳的 `gap` / `padding` / `border-radius` 全部按灯径**比例**派生。要改尺寸只改
  `--zx-lamp-s`,别单独调那三样 —— 只放大灯而不管外壳,灯一大壳就显挤。
