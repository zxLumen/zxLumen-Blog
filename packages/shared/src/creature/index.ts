/** 生物 DNA 核心:类型 / 校验 / 成长数学 / 程序兜底 / 确定性打分。零依赖。 */

export {
  ARCHETYPES,
  TRAIT_AXES,
  STAGE_COUNT,
  STAGE_LABELS,
  STAGE_SIZE,
  ARCHETYPE_SHAPE,
  normalizeDna,
  formAt,
  resolveForm,
} from './spec.js'
export type { Archetype, Palette, ShapeHints, Motion, StagePlan, CreatureDna, FormState, TraitAxis } from './spec.js'

export {
  STAGE_XP,
  DAILY_XP,
  MAX_XP,
  INTERACT_XP,
  INTERACT_CAP,
  elapsedDays,
  interactXp,
  totalXp,
  stageFloatOf,
  progressOf,
  growthOf,
  growthAtDay,
  daysToStage,
} from './growth.js'
export type { InteractCounts, GrowthInput, Growth } from './growth.js'

export { fallbackDna, keywordMatch, DEFAULT_DNA, PRESET_DESCRIPTIONS } from './fallback.js'

export {
  WEIGHTS,
  WEIGHT_TOTAL,
  heuristicScore,
  craftScore,
  heatOf,
  rankScore,
  rankOf,
} from './score.js'
export type { ScoreBreakdown, RankedCreature } from './score.js'
