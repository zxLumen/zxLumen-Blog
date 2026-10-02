# 站内 AI 状态灯 · 语音提示音频

本站导航栏的 AI 状态灯在 `success` / `error` / `blocked` 三次跳变时会念一句中文。
音频是**预录的 mp3**(不是浏览器 TTS),音色来自本机 opencode 的 TTS 缓存
(`opencode-smart-voice-notify` 的语料),已人工挑掉带「代码」「Agent」口吻的文案。

- 文件名 `<事件>-<序号>.mp3`,每个事件 3 条,同事件内**随机**取一条,避免每次一样。
- mono / 24kHz / 64kbps,单个约 25K,共 9 个、约 255K。
- **默认静音**,访客自己在状态灯的明细弹层里打开;音频 `preload="none"`,
  首次真正要播时才加载,所以这些体积不进首屏。

## 来源(可追溯)

语料索引 `~/.config/opencode/voice-cache-index/corpus.json`(在仓库外),
每个 take 都带 MOS(Mean Opinion Score)与 A/B 打分;下面是**每条按 MOS 最高**挑中的那个
(相同则取时长较短的):

| 文件 | 事件 | 文案 | 语料组 | take | MOS | 时长 |
|---|---|---|---|---|---|---|
| `success-1.mp3` | success | 全部搞定啦！任务已经完成，请过目。 | idleTTSMessages | `t0000_10` | 4.479 | 4.9s |
| `success-2.mp3` | success | 我这边已经忙完了，随时等你查看结果。 | idleTTSMessages | `t0001_04` | 4.199 | 3.3s |
| `success-3.mp3` | success | 报告，活干完了！还需要我做什么随时说。 | idleTTSMessages | `t0003_05` | 4.492 | 3.7s |
| `error-1.mp3` | error | 注意！有个错误需要你处理。 | errorTTSMessages | `t0034_04` | 4.33 | 3.0s |
| `error-2.mp3` | error | 检测到错误！有空请查看一下。 | errorTTSMessages | `t0032_10` | 4.182 | 3.8s |
| `error-3.mp3` | error | 哎呀，出了点问题，帮忙看看报错。 | errorTTSMessages | `t0030_08` | 4.188 | 3.5s |
| `blocked-1.mp3` | blocked | 我要卡在权限这步啦，麻烦批准一下。 | permissionTTSMessages | `t0007_01` | 4.646 | 3.2s |
| `blocked-2.mp3` | blocked | 嘿，有个操作需要你点头同意。 | permissionTTSMessages | `t0006_04` | 4.334 | 3.3s |
| `blocked-3.mp3` | blocked | 权限请求来啦，麻烦你看一眼。 | permissionTTSMessages | `t0009_07` | 4.167 | 3.1s |

## 重新生成

```bash
cd packages/shared
npm run ai-voice:prep            # 需要本机装有 ffmpeg 与上述语料
npm run ai-voice:prep -- --list # 只看会挑哪些,不写文件
```

换文案:改 `scripts/ai-voice-prep.mjs` 里的 `PICKS` 后重跑本脚本。

生成于 2026-10-02。
