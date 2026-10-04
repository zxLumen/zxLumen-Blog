import type { CreatureRow } from '../../schema.js'
import type { SqliteDb } from './types.js'
import { nowIso } from '../../time.js'

/** 每访客在榜上最多保留的生物数(超出需覆盖)。与预算侧的每日生成次数是两回事 */
export const MAX_CREATURES_PER_CID = 5

export interface NewCreatureInput {
  cid: string
  descr: string
  /** normalizeBlueprint 后的 JSON */
  blueprint: string
  /** compileBlueprint 展开的 DNA JSON */
  dna: string
  craft: number
  appeal: number
  total: number
  score_version: string
  /** 落盘 PNG 文件名;空 = 无图 */
  png_path?: string
}

/**
 * 生物 store。
 *
 * 设计要点:
 *  - **落库的是原始分**(craft/appeal/total),排名读取时按 `total DESC` 排;
 *    改权重只需递增 `score_version` 并重算,不必 ALTER 表。
 *  - **归属靠 cid**:每访客上限 `MAX_CREATURES_PER_CID`,再建需覆盖某只(不占新槽)。
 *    覆盖即"替换"(UPDATE 同一行),因此 id 稳定、PNG 文件名不变。
 */
export function creatureStore(db: SqliteDb) {
  return {
    /** 新增一只生物,返回新行 */
    addCreature(input: NewCreatureInput): CreatureRow {
      const info = db
        .prepare(
          `INSERT INTO creatures (cid, descr, blueprint, dna, craft, appeal, total, score_version, png_path, created_at, updated_at)
           VALUES (@cid, @descr, @blueprint, @dna, @craft, @appeal, @total, @score_version, @png_path, @created_at, @updated_at)`,
        )
        .run({
          cid: input.cid,
          descr: input.descr,
          blueprint: input.blueprint,
          dna: input.dna,
          craft: input.craft,
          appeal: input.appeal,
          total: input.total,
          score_version: input.score_version,
          png_path: input.png_path ?? '',
          created_at: nowIso(),
          updated_at: nowIso(),
        })
      return this.getCreature(Number(info.lastInsertRowid))!
    },

    /**
     * 覆盖一只生物(仅限同 cid),保留原 id 与 PNG 文件名不变。
     * 返回更新后的行;不属于该 cid 或不存在返回 null(调用方据此拒绝)。
     */
    replaceCreature(id: number, cid: string, input: Omit<NewCreatureInput, 'cid'>): CreatureRow | null {
      const info = db
        .prepare(
          `UPDATE creatures
             SET descr = @descr, blueprint = @blueprint, dna = @dna,
                 craft = @craft, appeal = @appeal, total = @total,
                 score_version = @score_version, png_path = @png_path, updated_at = @updated_at
           WHERE id = @id AND cid = @cid`,
        )
        .run({
          id,
          cid,
          descr: input.descr,
          blueprint: input.blueprint,
          dna: input.dna,
          craft: input.craft,
          appeal: input.appeal,
          total: input.total,
          score_version: input.score_version,
          png_path: input.png_path ?? '',
          updated_at: nowIso(),
        })
      if (info.changes === 0) return null
      return this.getCreature(id)
    },

    getCreature(id: number): CreatureRow | null {
      const r = db.prepare(`SELECT * FROM creatures WHERE id = ?`).get(id) as CreatureRow | undefined
      return r ?? null
    },

    /** 某访客的全部生物(最新在前,用于「我的生物 / 选择覆盖」) */
    listByCid(cid: string): CreatureRow[] {
      return db
        .prepare(`SELECT * FROM creatures WHERE cid = ? ORDER BY created_at DESC, id DESC`)
        .all(cid) as CreatureRow[]
    },

    /** 某访客的生物数(配额判定) */
    countByCid(cid: string): number {
      const r = db.prepare(`SELECT COUNT(*) AS n FROM creatures WHERE cid = ?`).get(cid) as
        | { n: number }
        | undefined
      return r?.n ?? 0
    },

    /**
     * 当前版本的全站榜单,按 total 降序。`limit` 给候选池留冗余(精排要多取几只)。
     * 只取 `score_version` 匹配的行 —— 旧算法的分不可比,不进榜。
     */
    topCreatures(scoreVersion: string, limit = 50): CreatureRow[] {
      return db
        .prepare(
          `SELECT * FROM creatures
            WHERE score_version = ?
            ORDER BY total DESC, created_at ASC, id ASC
            LIMIT ?`,
        )
        .all(scoreVersion, Math.max(1, Math.floor(limit))) as CreatureRow[]
    },

    /** 彻底删除一只(仅限同 cid;返回是否删到) */
    deleteCreature(id: number, cid: string): boolean {
      const info = db.prepare(`DELETE FROM creatures WHERE id = ? AND cid = ?`).run(id, cid)
      return info.changes > 0
    },
  }
}

export type CreatureStore = ReturnType<typeof creatureStore>
