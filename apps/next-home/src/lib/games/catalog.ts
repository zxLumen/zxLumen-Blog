import type { GameId } from './types'

export interface GameCatalogItem {
  id: GameId
  name: string
  /** 应用卡片上的短标签 */
  short: string
  tagline: string
  description: string
  emoji: string
  players: string
  href: string
  /** 卡片主色（CSS 变量值） */
  accent: string
  /** 规则摘要，入口页与大厅都会展示 */
  rules: string[]
}

export const GAME_CATALOG: GameCatalogItem[] = [
  {
    id: 'liars-dice',
    name: '骰子吹牛',
    short: '大话骰',
    tagline: '各摇各的，人齐开骰',
    description: '每个人自己点一次摇骰，全部摇完再开骰；App 只报总骰数，输赢线下判。',
    emoji: '🎲',
    players: '2–8 人',
    href: '/games/liars-dice',
    accent: '#00ff7a',
    rules: [
      '每人 5 颗骰子，只看得到自己的；每个人都要自己点一次「摇骰」，一个人点不会替全桌摇。',
      '全部人摇完后，任意人都可以点「开骰」；开骰后亮出所有人的骰子。',
      '一局只摇一次，服务端生成，刷新/重进不会重摇；五颗全不同（顺子）自动重摇。',
      '开骰后同时给出斋 / 飞两套各点数总计，App 不判输赢。',
      '豹子多算：含 1 凑成五同 +1，五个完全相同 +2；房主可关。',
    ],
  },
  {
    id: 'number-bomb',
    name: '数字炸弹',
    short: '踩雷',
    tagline: '范围越缩越小，谁踩谁喝',
    description: '房主设一个范围，系统藏一颗炸弹。轮流报数，范围不断缩小，报中炸弹的人喝。',
    emoji: '💣',
    players: '2–8 人',
    href: '/games/number-bomb',
    accent: '#ff7a1a',
    rules: [
      '房主设定数字范围（默认 1–100），系统在范围内随机藏一颗炸弹。',
      '按顺序轮流报一个范围内的整数；没中炸弹就把范围缩到炸弹可能存在的一侧。',
      '报中炸弹的人输；房主可以立刻再来一局。',
    ],
  },
  {
    id: 'dice-789',
    name: '七八九',
    short: '公杯骰',
    tagline: '摇到 7 加酒，8 喝一半，9 喝光',
    description: '两颗骰子轮流传公杯：7 加一口，8 喝一半，9 喝光，对子还有反转和全场喝。',
    emoji: '🍻',
    players: '2–8 人',
    href: '/games/dice-789',
    accent: '#3dfcff',
    rules: [
      '每人轮流摇两颗骰子，公杯初始为空。',
      '点数 7：往公杯加 1 口；8：喝掉公杯一半（向上取整）；9：喝光公杯。',
      '两个 1：全场各喝 1 口；其它对子：方向反转后继续。',
      'App 记录每人的「喝」数，实际喝多少由酒桌自己定。',
    ],
  },
]

export const GAME_BY_ID = new Map<GameId, GameCatalogItem>(
  GAME_CATALOG.map((game) => [game.id, game]),
)

export function isGameId(value: string): value is GameId {
  return GAME_BY_ID.has(value as GameId)
}
