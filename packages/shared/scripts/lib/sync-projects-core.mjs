/**
 * 解析命令行。
 *
 * 单独抽出来并测试的原因:解析错了不会报错,而是**静默退化成「同步全部」** ——
 * 那会往线上写预期外的条目。早先的写法 `i !== afterIdx + 1` 在没有 `--after` 时
 * 等于 `i !== 0`,把 argv[0] 也丢了,`-- ai-status-light` 就变成了同步 content.json
 * 里所有项目(线上干跑时抓到)。
 *
 * 位置参数 = 只同步这些 id;不传 = 全部。
 */
export function parseArgs(argv) {
  const afterIdx = argv.indexOf('--after')
  const after = afterIdx >= 0 ? (argv[afterIdx + 1] ?? '') : ''
  // 只跳过「--after 的值」那一个位置,不能一杆子把 argv[0] 也排除掉
  const flagValueIdx = afterIdx >= 0 ? afterIdx + 1 : -1
  return {
    dryRun: argv.includes('--dry-run'),
    update: argv.includes('--update'),
    after,
    onlyIds: argv.filter((a, i) => !a.startsWith('--') && i !== flagValueIdx),
  }
}

/**
 * 项目卡「本地 → 线上」的纯合并逻辑(无 I/O,便于单测)。
 *
 * 铁律:**只加不减**。线上独有的条目一律原样保留 —— 线上可能被 admin 加过卡
 * (比如 RAG 那种后台建出来的),脚本绝不能因为本地没有就把它们抹掉。
 *
 * @param {Array<Record<string, unknown>>} remote 线上现有(顺序=展示顺序)
 * @param {Array<Record<string, unknown>>} wanted 本地想同步的(来自 content.json 的 PROJECTS)
 * @param {{ update?: boolean, after?: string }} opts update=连线上已有的也覆盖;after=新条目插到哪个 id 之后
 */
export function mergeProjects(remote, wanted, { update = false, after = '' } = {}) {
  const merged = remote.map((p) => ({ ...p }))
  const added = []
  const changed = []
  const skipped = []

  for (const src of wanted) {
    const i = merged.findIndex((p) => p.id === src.id)
    if (i < 0) {
      const at = after ? merged.findIndex((p) => p.id === after) : -1
      // --after 找不到就退回追加到末尾,不因为一个笔误就整体失败
      merged.splice(at >= 0 ? at + 1 : merged.length, 0, { ...src })
      added.push(src)
    } else if (update) {
      merged[i] = { ...merged[i], ...src }
      changed.push(src)
    } else {
      skipped.push(src)
    }
  }

  const afterMiss = !!after && !remote.some((p) => p.id === after)
  const remoteOnly = remote.filter((p) => !wanted.some((w) => w.id === p.id))

  return { merged, added, changed, skipped, remoteOnly, afterMiss }
}
