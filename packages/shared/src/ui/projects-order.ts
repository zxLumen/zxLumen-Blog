import type { StoredProject } from '../schema.js'
import { applySavedOrder } from './useDragReorder.js'

/**
 * 把「可见项目」的新顺序套回完整列表(**垃圾箱条目原地不动**)。
 *
 * 首页拖拽只动可见卡片的顺序,而落库是整表覆盖(含垃圾箱)。先从完整列表里按序
 * 取出可见项,按 orderedVisibleIds 套序(复用 applySavedOrder 对账新增/删除),
 * 再按原来的可见槽位写回 —— 垃圾箱的位置因此不受影响。
 */
export function reorderVisible(
  full: StoredProject[],
  orderedVisibleIds: readonly string[],
): StoredProject[] {
  const visible = full.filter((p) => !p.deleted)
  const ordered = applySavedOrder(visible, orderedVisibleIds)
  let vi = 0
  return full.map((p) => (p.deleted ? p : (ordered[vi++] ?? p)))
}

/**
 * admin 面板保存时的「按 id 三方合并」:把面板里的**内容改动**叠到**服务端最新**
 * 的列表上,顺序默认沿用最新(即首页刚拖出来的),只有站长自己在面板里按过 ↑↓
 * (edited 相对 baseline 改过顺序)时才应用面板的顺序。
 *
 * 这样一来:
 *  - 首页拖拽与面板改内容互不覆盖 —— 面板保存不会把前端刚拖的顺序冲回去;
 *  - 面板不再需要「整表覆盖」,409 也就不会因为顺序变了而误报。
 *
 * @param fresh    服务端最新列表(刚 GET 到的)
 * @param baseline 面板加载时的列表(用来判断"有没有改顺序")
 * @param edited   面板当前(含未保存编辑)的列表
 */
export function mergeProjectsForSave(
  fresh: StoredProject[],
  baseline: StoredProject[],
  edited: StoredProject[],
): StoredProject[] {
  const editedById = new Map(edited.map((p) => [p.id, p]))
  const baselineIds = new Set(baseline.map((p) => p.id))

  // 以 fresh 的顺序为骨架:被面板删掉的 id(在 baseline 却不在 edited)剔除;
  // 其余内容用 edited 的版本覆盖;fresh 里 baseline 没见过的新项(别处新增)原样保留。
  const kept = fresh
    .filter((p) => editedById.has(p.id) || !baselineIds.has(p.id))
    .map((p) => editedById.get(p.id) ?? p)

  // 面板里新增的 id(baseline 没有、服务端也还没有)→ 按 edited 顺序追加到末尾
  const freshIds = new Set(fresh.map((p) => p.id))
  const added = edited.filter((p) => !baselineIds.has(p.id) && !freshIds.has(p.id))

  // 顺序:比较「baseline 与 edited 共有、且仍在结果里」的那些 id 的相对顺序,
  // 只有真的不一样才认为站长改过顺序 —— 否则一律沿用 fresh(前端拖拽的最新顺序)。
  const survivor = new Set(kept.map((p) => p.id))
  const baseCommon = baseline.map((p) => p.id).filter((id) => editedById.has(id) && survivor.has(id))
  const editCommon = edited.map((p) => p.id).filter((id) => baselineIds.has(id) && survivor.has(id))
  const adminReordered = baseCommon.join(' ') !== editCommon.join(' ')
  if (!adminReordered) return [...kept, ...added]

  const saved = edited.map((p) => p.id).filter((id) => survivor.has(id))
  return [...applySavedOrder(kept, saved), ...added]
}
