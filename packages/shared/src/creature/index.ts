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
export { randomBatch, DENSITY_LABEL, type Density, type RandomItem, type RandomBatch } from './random.js'

export { normalizeBlueprint, compileBlueprint, BP_ROLES, MOTION_FAMILIES } from './blueprint.js'
export type {
  CreatureBlueprint,
  BpPart,
  BpRole,
  BpMotion,
  MotionFamily,
  CompiledRig,
  CompiledPart,
  CompiledBlueprint,
} from './blueprint.js'

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

/** 批次级多样性 / 新颖度(不进 ScoreBreakdown.total,理由见 diversity.ts) */
export { diversityOf } from './diversity.js'
export type { DiversityReport, DiversityPerItem, DimSpread } from './diversity.js'

/** 逐维校准:各维与人工评价的秩相关 + 分布 */
export { rhoOf, distOf, calibrate, deadThreshold, DIM_KEYS, MIN_N_FOR_RHO } from './calibrate.js'
export type { Calibration, DimCalib, Dist, RatedRow, DimKey } from './calibrate.js'
