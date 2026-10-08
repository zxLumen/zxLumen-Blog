/**
 * 应用栏「本地 → 线上」的纯合并逻辑(无 I/O,便于单测)。
 *
 * 与 sync-projects 同一条铁律:**只加不减**。线上独有的条目一律原样保留 ——
 * 线上可能被 admin 加过应用(比如 RAG / 易经那种后台建出来的、id 是随机串的),
 * 脚本绝不能因为本地没有就把它们抹掉。
 *
 * 额外一道**localhost 守卫**:本地 dev 的 `apps_config` 里,面板类应用往往填的是
 * `http://localhost:<port>/`(如 stock)。这种地址原样推到线上,线上 iframe 会白屏。
 * 默认拒绝这类条目(不写线上),要同步就先在本地把它改成公网地址,或用
 * `--allow-localhost` 显式放行。
 */

/** 判断一个 url 是否指向本机/回环(推到线上必然打不开) */
export function isLocalhostUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false
  let host
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  // URL 的 hostname 对 IPv6 会带方括号(如 `[::1]`),先剥掉再比
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  return (
    bare === 'localhost' ||
    bare === '::1' ||
    bare === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    /^127\./.test(bare)
  )
}

/**
 * @param {Array<Record<string, unknown>>} remote 线上现有(顺序=展示顺序)
 * @param {Array<Record<string, unknown>>} wanted 本地想同步的(来自本地 dev 库的 apps_config)
 * @param {{ update?: boolean, after?: string, before?: string, allowLocalhost?: boolean }} opts
 *   update=连线上已有的也覆盖;after=新条目插到哪个 id 之后;before=插到哪个 id 之前;
 *   allowLocalhost=放行 localhost 地址
 */
export function mergeApps(remote, wanted, { update = false, after = '', before = '', allowLocalhost = false } = {}) {
  const merged = remote.map((a) => ({ ...a }))
  const added = []
  const changed = []
  const skipped = []
  const blocked = []

  for (const src of wanted) {
    const bad = !allowLocalhost && isLocalhostUrl(src.url)
    const i = merged.findIndex((a) => a.id === src.id)
    if (i < 0) {
      if (bad) {
        blocked.push(src)
        continue
      }
      // 落点:--before 优先(插到某 id 之前,用于置顶),其次 --after,都没有则追加末尾。
      // 两个锚点都找不到就退回「追加末尾 / 置顶」,不因为一个笔误就整体失败。
      let at = merged.length
      if (before) {
        const bi = merged.findIndex((a) => a.id === before)
        at = bi >= 0 ? bi : 0
      } else if (after) {
        const ai = merged.findIndex((a) => a.id === after)
        at = ai >= 0 ? ai + 1 : merged.length
      }
      merged.splice(at, 0, { ...src })
      added.push(src)
    } else if (update) {
      if (bad) {
        blocked.push(src)
        continue
      }
      merged[i] = { ...merged[i], ...src }
      changed.push(src)
    } else {
      skipped.push(src)
    }
  }

  const afterMiss = !!after && !remote.some((a) => a.id === after)
  const beforeMiss = !!before && !remote.some((a) => a.id === before)
  const remoteOnly = remote.filter((a) => !wanted.some((w) => w.id === a.id))

  return { merged, added, changed, skipped, remoteOnly, afterMiss, beforeMiss, blocked }
}
