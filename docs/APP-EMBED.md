# 应用「页内浮层」嵌入约定（保活 / 预热 / 会话状态）

应用栏里 `openIn: 'panel'` 的应用，由博客用**页内浮层 iframe** 打开（见 `AppPanel.tsx`）。
本文约定宿主(博客)与子应用在这套嵌入下如何协作 —— **两件事宿主通用包办，应用零改动；
一件事(跨刷新保状态)由应用按统一约定实现**。新加应用照最后一节的清单接入即可。

## 一、宿主通用能力（应用无需做任何事）

- **保活**：应用一旦打开过就**保持挂载**，切到别的应用/收起时只是隐藏（`visibility:hidden`），
  不销毁 iframe。于是同一页面会话内「收起 → 再打开」是同一个 iframe，子应用临时状态不丢。
- **预热**：宽屏（`!isNarrow()`）且页面空闲（`requestIdleCallback`）时，把**所有** panel
  应用的 iframe **提前隐藏加载**。用户点开时已经加载好 → **不再转圈**。窄屏全屏面板跳过
  预热以省流量。
- **隐藏方式**：非当前面板用 `visibility:hidden + pointer-events:none`（**不是 `display:none`**），
  应用首帧仍能量到布局尺寸，初始化更稳。
- **可用性 / AI 状态灯**：只有当前展开的面板才计入「应用可用」；应用照
  [`AI-STATUS.md`](./AI-STATUS.md) 用 `postMessage({type:'zx:ai-status', …})` 上报即可。

> 结论：**保活 + 预热对任何 `openIn:'panel'` 的应用都自动生效**，包括以后新加的。

## 二、跨「整页刷新」保状态 —— 应用侧约定（`sessionStorage`）

整页刷新（F5、或刷新个人主页）会重建宿主与 iframe，宿主无法跨源保住你的内存状态。
但 `sessionStorage` **能**同时扛过「宿主刷新」和「iframe 重建」（同一标签页、同源），
所以约定：**应用把「本次会话的 UI 状态」写进 `sessionStorage`，刷新后同步恢复**。

规则：

- 键前缀 **`zx-app-state:<appId>:`**（如 `zx-app-state:yijing:cast.result`），值 JSON（建议带 `v` 版本号便于将来兼容）。
- **同步**读取、同步写回（在 `useState` 初始化里读），避免先渲染空白再跳变。
- 只存**本次会话的 UI 状态**（当前视图/选择/输入草稿/未提交的编辑/对话草稿…）。
  **不要**存敏感数据、也别塞超大对象；`sessionStorage` 通常 5MB 上限。
- 高频变化（如流式文本）**防抖写入**，别逐字 `setItem`。
- 关闭标签页即清空（`sessionStorage` 语义）——正好等价「关掉就重来」。

### 参考实现

两处已按此约定实现（可直接抄）：

- 易经：`yijing64/web/src/lib/sessionState.ts`（`useSessionState` / `useDebouncedSessionState`）。
- Opentodo：`Opentodo/web/src/sessionState.ts`（同一份代码，仅前缀不同）。

核心片段：

```ts
const PREFIX = 'zx-app-state:<appId>:'

export function readState<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeState<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* 隐私模式 / 超限:忽略 */
  }
}

/** 像 useState 一样用,但值随会话保存、刷新后恢复。 */
export function useSessionState<T>(key: string, initial: T | (() => T)) {
  const [state, setState] = useState<T>(() =>
    readState(key, typeof initial === 'function' ? (initial as () => T)() : initial),
  )
  useEffect(() => {
    writeState(key, state)
  }, [key, state])
  return [state, setState] as const
}
```

## 三、新应用接入清单

1. 在应用里加一份 `sessionState.ts`（照上面的参考实现，改 `PREFIX` 里的 `<appId>`）。
2. 用 `useSessionState` 包住需要跨刷新保留的 `useState`（当前 Tab、选择、过滤、草稿…）。
   高频状态用防抖版。
3. 不要持久化「瞬时」状态（弹层开关、正在拖拽、正在流式输出的中间帧等）。
4. **无需**改博客：`openIn:'panel'` 的保活与预热自动生效；AI 状态照 `AI-STATUS.md` 上报。
5. 若应用有服务端持久化（如记录），会话状态只补「未落库的界面态」，别重复存服务端已有数据。

## 四、子应用远程控制主页显示（`zx:floats-*`）

部分 `panel` 应用可**远程控制宿主页面的显示**。已实现的一例：luminari「生灵」应用控制
**主页四周的生灵层**显隐（站长可在 `/admin` → 「外观」开关是否放行）。

协议（嵌入时向 `window.parent` 发，`app` 用应用条目 id；宿主/来源校验同 `AI-STATUS.md`）：

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| 子 → 宿主 | `{ type:'zx:floats-hello', app }` | 挂载时握手，请求当前状态 |
| 子 → 宿主 | `{ type:'zx:floats-set', app, hidden:boolean }` | 用户切换时上报新值 |
| 宿主 → 子 | `{ type:'zx:floats-state', hidden:boolean, allowed:boolean }` | 回传当前值 + 是否放行（`allowed=false` 时子应用不显示开关） |

宿主（`AppPanel.tsx`）校验 `e.origin` 与 `d.app` 后，把 `hidden` 写进博客侧 `localStorage`
（`packages/shared/src/ui/floats-pref.ts`），并通知主页的 `LuminariFloats` 实时更新。
参考实现：luminari `web/src/embed.ts` + `FloatsPref.tsx`。
