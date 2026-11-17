# zxLumen 设计基调 · Graphite

> 版本：2026-11-14 · 适用范围：个人主页（zxlumen.cn，主站）及其下挂的全部应用与子域
> 参考气质：Linear 的克制层级、Vercel 的中性底色与低装饰密度
> 状态：**布局沿用 Graphite；默认改为浅色（老板反馈纯黑底太暗），生灵层与视频模块保留**。
> 其余应用等主站浅色版确认后再按本规范铺开。

---

## 1. 设计原则

1. **内容优先**：颜色只用来表达状态和层级，不做装饰。默认界面里 90% 的像素是中性灰。
2. **一个主色就够**：主色只出现在主操作、当前项、关键数字和焦点环上，一屏不超过 2~3 处。
3. **层级靠字号/字重/留白**，不靠发光、渐变、阴影堆叠。
4. **密度可控**：内容页留白大（64~96px 区块间距），数据页密度高（表格行高 40~44px），但圆角、边框、字号同一套。
5. **动效只做反馈**：150~200ms ease-out；hover 位移不超过 2px；尊重 `prefers-reduced-motion`。

---

## 2. 色彩

### 2.1 基础色（light，默认）

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#FAFAF9` | 页面底色 |
| `--bg-2` | `#F4F4F2` | 输入框 / 次级底 |
| `--surface` / `--elev` | `#FFFFFF` | 卡片、面板 |
| `--surface-2` | `#F2F2EF` | hover、表头、代码块 |
| `--line` | `#E7E5E4` | 默认边框 / 分隔线 |
| `--line-strong` | `#D6D3D1` | hover 边框、强调边界 |
| `--fg` | `#18181B` | 主文字 |
| `--fg-dim` | `#52525B` | 次要文字 |
| `--fg-muted` | `#71717A` | 标签、占位、脚注 |

### 2.1.1 深色（可选，非默认）

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#0A0B0D` | 页面底色 |
| `--bg-2` | `#0E1013` | 输入框 / 次级底 |
| `--surface` / `--elev` | `#121417` | 卡片、面板 |
| `--surface-2` | `#171A1F` | hover、表头、代码块 |
| `--line` | `#24272E` | 默认边框 / 分隔线 |
| `--line-strong` | `#343A44` | hover 边框、强调边界 |
| `--fg` | `#F2F4F7` | 主文字 |
| `--fg-dim` | `#A6ADB8` | 次要文字 |
| `--fg-muted` | `#6E7683` | 标签、占位、脚注 |

### 2.2 品牌与语义色

| Token | 值 | 用途 |
|---|---|---|
| `--accent` | `#4F6BED` | 主色：主按钮、当前导航、链接、焦点环 |
| `--accent-strong` | `#3F57D6` | 主色 hover |
| `--accent-soft` | `rgba(79,107,237,.12)` | 选中底 / 轻量强调 |
| `--accent-2` | `#0F766E` | 辅助色：成功、在线、数据正向高亮 |
| `--up` / `--danger` | `#DC2626` | 涨 / 错误 / 危险操作 |
| `--down` / `--success` | `#059669` | 跌 / 成功（与 `--accent-2` 二选一，同一页面不混用） |
| `--warning` | `#B45309` | 等待、超时、待确认 |
| `--selection` | `rgba(79,107,237,.18)` | 文本选区 |

使用约束：

- 主色与辅助色**不同时大面积出现**；辅助色只做小面积状态点/数字。
- 涨跌色是金融语义色，不参与品牌表达；非金融页面不要用红绿做装饰。
- 浅色底上正文对比度 ≥ 7:1，次要文字 ≥ 4.5:1；主按钮文字用 `#FFFFFF`。
- 深色 token 保留为可选变体，不再作为默认；需要深色时另开 `graphite-dark`，不要改回默认。

### 2.3 浅色模式（当前默认）

浅色模式沿用同一套 token 名：`--bg:#FAFAF9`、`--surface:#FFFFFF`、`--line:#E7E5E4`、`--fg:#18181B`、`--fg-dim:#52525B`、`--accent:#4F6BED`。2026-11-14 起主站默认使用浅色，原因是纯黑底长时间阅读太暗；深色保留为可选主题。

---

## 3. 字体与层级

字体栈：

```css
--font-sans: Inter, ui-sans-serif, system-ui, -apple-system, "PingFang SC",
             "Noto Sans SC", "Microsoft YaHei", sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
```

| 角色 | 字号 / 行高 | 字重 | 字距 | 用途 |
|---|---|---|---|---|
| Display | 56 / 1.05 | 600 | -0.04em | 首屏姓名 / 主标题 |
| H1 | 40 / 1.15 | 600 | -0.03em | 页面标题 |
| H2 | 28 / 1.2 | 600 | -0.02em | 区块标题 |
| H3 | 20 / 1.3 | 600 | -0.01em | 卡片标题 / 面板标题 |
| Body | 15 / 1.65 | 400 | 0 | 正文 |
| Body-sm | 14 / 1.6 | 400 | 0 | 卡片正文、表格 |
| Caption | 12 / 1.5 | 400 | 0 | 辅助说明 |
| Label | 11 / 1.4 | 500 | +0.12em | 全大写标签、表头、eyebrow（mono） |
| Data | 13 / 1.4 | 500 | 0 | 数字/代码（mono，`tabular-nums`） |

规则：

- 正文/标题用 sans；**mono 只用于标签、数字、代码、时间戳**，不再整站 mono。
- 标题最多两级同屏；H2 以下用 12px 标签 + 留白分隔，不靠粗体堆叠。
- 数字统一 `font-variant-numeric: tabular-nums`。
- 中文正文不小于 14px；英文全大写标签不小于 11px。

---

## 4. 间距、圆角、边框、阴影

### 4.1 间距（4px 基准）

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`

- 组件内部：8/12/16
- 卡片内边距：20（紧凑）/ 24（标准）
- 区块上下：64（桌面）/ 48（平板）/ 40（手机）
- 内容容器：最大 1120px，左右 gutter 20（手机）/ 32（桌面）

### 4.2 圆角

| Token | 值 | 用途 |
|---|---|---|
| `--r-xs` | 6px | 标签、微型控件 |
| `--r-sm` | 8px | 按钮、输入框、tab |
| `--r-md` | 12px | 卡片、面板、表格容器 |
| `--r-lg` | 16px | 弹窗、抽屉 |
| `--r-full` | 999px | 状态点、pill |

### 4.3 边框与阴影

- 默认边框 1px `--line`；hover/选中 1px `--line-strong` 或 `--accent`（二选一）。
- 卡片默认**无阴影**，只靠底色 + 边框；hover 最多 `0 8px 24px -16px rgba(0,0,0,.8)`。
- 禁止发光/霓虹/大面积渐变；唯一允许的渐变是 1px 分隔线（透明→边框→透明）。

---

## 5. 组件规范

### 5.1 按钮

| 类型 | 底色 | 文字 | 边框 | 用途 |
|---|---|---|---|---|
| Primary | `--accent` | `#0A0B0D` | 同底色 | 每屏 1 个主操作 |
| Secondary | `--surface` | `--fg` | `--line-strong` | 次级操作 |
| Ghost | transparent | `--fg-dim` | transparent | 导航/工具条 |
| Danger | `rgba(248,113,113,.12)` | `--danger` | `rgba(248,113,113,.35)` | 删除/停止 |

- 高度：32（sm）/ 36（md）/ 40（lg）；左右内边距 12/16/20。
- 字号 13px / 500；圆角 `--r-sm`；图标与文字间距 6px。
- hover：Primary 变 `--accent-strong`；Secondary 边框变 `--line-strong`/文字变 `--fg`；不做位移。
- 焦点：`outline: 2px solid var(--accent); outline-offset: 2px`，不要只靠颜色变化。
- disabled：`opacity:.45; cursor:not-allowed`，不改变尺寸。

### 5.2 卡片

- 底色 `--surface`，1px `--line`，圆角 `--r-md`，内边距 24。
- 标题 20px/600；描述 14px `--fg-dim`；底部操作与标题同一左对齐线。
- hover：边框 `--line-strong`，`translateY(-2px)`，阴影可选；**不使用发光**。
- 同一组卡片高度对齐；指标数字用 mono 20px/600，标签用 11px 大写 `--fg-muted`。

### 5.3 表格

- 容器：`--surface` + 1px 边框 + `--r-md`，`overflow:auto`；表格本身无外边框。
- 表头：11px 大写 mono、`--fg-muted`、`--surface-2` 底、行高 36。
- 数据行：14px、行高 44、底部 1px `--line`；hover `--surface-2`。
- 数字列右对齐 + tabular-nums；首列可左对齐并省略号截断。
- 移动端：优先横向滚动，不压缩字号；首列可 sticky。

### 5.4 表单

- 标签 12px/500 `--fg-dim`，与输入框间距 6px；必填用 `--danger` 星号。
- 输入框高 38~40，底色 `--bg-2`，1px `--line`，圆角 `--r-sm`，内边距 10/12。
- focus：边框 `--accent` + `box-shadow: 0 0 0 3px var(--accent-soft)`；不要发光。
- 错误：边框 `--danger` + 12px 错误文案；帮助文案 12px `--fg-muted`。
- 同一表单主按钮在左下或右下，与输入框同宽（移动端）或 auto（桌面）。

### 5.5 导航 / 标签 / 状态

- 顶栏高 56~64，底色 `--bg` 85% + 12px blur，底部 1px `--line`。
- 导航项 13px/500，默认 `--fg-dim`；当前项 `--fg` + `--accent-soft` 底 + 8px 圆角；hover 只变文字。
- Tab：32 高、8px 圆角、active 用 `--surface-2` + `--fg`，不用下划线动画。
- 状态点：8px 圆点 + 12px 文本；在线 `--accent-2`，等待 `--warning`，错误 `--danger`。
- Badge：11px mono、`--surface-2` 底、`--line` 边框、`--r-full`。

### 5.6 空状态 / 加载

- 空状态：虚线 1px `--line`、`--r-md`、上下 40px、12px `--fg-muted`，最多一行操作按钮。
- 加载：骨架块 `--surface-2`，圆角 6，1.2s 呼吸；不用整页 spinner。
- 错误：一行 `--danger` 文案 + 重试 ghost 按钮。

---

## 6. 布局与响应式

- 容器最大 1120px；桌面 gutter 32，平板 24，手机 20。
- 断点：`640 / 900 / 1200`。
- 内容页：单列为主，最大阅读宽度 72ch；卡片网格 3 列（≥1200）/ 2 列（≥640）/ 1 列。
- 数据页：顶栏 + 左侧/顶部导航 + 主区；主区优先表格/图表，筛选器靠右。
- 移动端：底部安全区 `env(safe-area-inset-bottom)`；固定工具条不超过 56px。

---

## 7. 可访问性

- 所有交互元素可键盘到达；焦点环 2px 主色。
- 正文/背景对比度 ≥ 7:1，次要文字 ≥ 4.5:1。
- 不用颜色单独表达状态：涨跌/成败同时带 `+/-` 或文字。
- 动效尊重 `prefers-reduced-motion: reduce`（关闭位移与呼吸）。
- 图片有 alt；纯图标按钮有 `aria-label`。

---

## 8. 试点落地

### 8.1 主站（zxlumen.cn）

- 新增主题 `graphite`：`packages/shared/src/theme.ts` + `packages/shared/src/pilot.css`。
- 覆盖范围：顶栏、Hero、区块头、项目卡片、用量面板、表格、表单、页脚、右侧应用栏。
- 不改：admin 后台、登录/SSO、业务逻辑；主题仍可切换，`graphite` 只在试点环境设为默认。
- 预发默认主题写在预发库的 `kv.appearance_config.defaultTheme=graphite`，生产默认不变。
- 2026-11-14 调整：`graphite` 默认改为浅色（`--bg:#FAFAF9` + `--accent:#4F6BED`），解决纯黑底阅读太暗；**保留四周生灵层**（不再用 CSS 隐藏），**保留 Hero 视频展览模块**（不再在预发库关闭 vlog）。移动端生灵仍按 <820px 既有规则不渲染。

### 8.2 StockApp（stock.zxlumen.cn）

- 新增 `web/src/pilot.css`，全部规则挂在 `html[data-pilot='1']` 下。
- 构建时 `VITE_PILOT=1` 才打开；生产构建不带该变量，视觉零变化。
- 覆盖范围：顶栏、市场 tabs、搜索、首页卡片/榜单、表格、设置表单、弹层。
- 不改：行情抓取、策略、AI 网关、数据口径。

### 8.3 其余应用

等主站 + StockApp 试点确认后，按“token 映射 → 顶栏/按钮/卡片/表格/表单 → 空状态/移动端”的顺序逐个铺开；一次只改一个应用，保留回滚分支。

---

## 9. 代码索引

| 内容 | 路径 |
|---|---|
| 本文档 | `zxLumen-Blog/docs/design/DESIGN-SYSTEM.md` |
| 主站试点样式 | `packages/shared/src/pilot.css` |
| 主站主题注册 | `packages/shared/src/theme.ts`（`graphite`） |
| StockApp 试点样式 | `StockApp/web/src/pilot.css` |
| 预发截图 | `zxLumen-Blog/docs/design/pilot/` |
| 预发入口 | `https://pilot.zxlumen.cn/` · `https://pilot-stock.zxlumen.cn/` |

---

## 10. 验收清单

- [ ] 主站预发默认 `graphite` 浅色，桌面/手机首屏无横向滚动、无文字溢出。
- [ ] 顶栏/按钮/卡片/表格/表单五类组件在预发实际页面可见且符合本文档。
- [ ] 桌面端四周生灵层可见且不拦截点击；Hero 视频展览模块可见、可播放。
- [ ] 主站主题切换仍可用，切回旧主题不破版。
- [ ] StockApp 预发 `data-pilot=1` 生效，生产构建无该属性。
- [ ] 主站/Stock 线上生产地址 200，视觉与改动前一致。
- [ ] 截图覆盖：主站桌面/手机、Stock 桌面/手机，各 before/after。
