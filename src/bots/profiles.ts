/**
 * 机器人风格档案。
 *
 * 所有档案共用同一套基准策略（policy.ts），只是在几个关键旋钮上做偏移：
 * 基准档案（gto）所有系数都是 1.0，其余档案相对它加减。
 * 这样「紧凶」和「松弱」打的是同一套逻辑，区别只在范围宽窄和攻击性，
 * 而不是各写一套互不相干的 if-else。
 */

export interface BotProfile {
  id: string;
  name: string;
  shortName: string;
  description: string;
  /** 界面上的强调色。 */
  color: string;

  /* --- 翻前旋钮 --- */
  /** 开池范围倍数，>1 更松。 */
  openRange: number;
  /** 3bet / 加注范围倍数。 */
  threeBet: number;
  /** 跟注范围倍数。 */
  callRange: number;
  /** 有人跛入时跟着跛入的倾向。 */
  limpiness: number;

  /* --- 翻后旋钮 --- */
  /** 主动下注 / 加注的频率倍数。 */
  aggression: number;
  /** 诈唬频率倍数。 */
  bluff: number;
  /** 跟注意愿倍数，>1 更难弃牌。 */
  callDown: number;
  /** 下注尺度倍数。 */
  sizing: number;
  /** 决策噪声，0 = 完全按策略，越大越不可预测。 */
  randomness: number;

  /* --- 鱿鱼旋钮 --- */
  /**
   * 对鱿鱼彩头的重视程度，0 = 完全当成纯扑克在打。
   *
   * 鱿鱼规则结构性地惩罚紧手（决定你买不买单的不是赢了多少条，
   * 而是「本轮有没有至少赢下一手」），所以这个系数本身就是一种风格：
   * 岩石之所以是岩石，正是因为它算不清这笔账。
   */
  squidAwareness: number;
}

export const BOT_PROFILES: BotProfile[] = [
  {
    id: 'gto',
    name: 'GTO 基准',
    shortName: 'GTO',
    description:
      '按底池赔率、MDF（最小防守频率）和平衡的价值/诈唬比例行动。范围均衡，难以被剥削，是其他所有风格的偏移原点。',
    color: '#5b8def',
    openRange: 1,
    threeBet: 1,
    callRange: 1,
    limpiness: 1,
    aggression: 1,
    bluff: 1,
    callDown: 1,
    sizing: 1,
    randomness: 0.06,
    squidAwareness: 1,
  },
  {
    id: 'tag',
    name: '紧凶',
    shortName: 'TAG',
    description:
      '入池牌少但打得凶。只玩强起手牌，进池后频繁下注施压，很少软弱跟注。对付它要多偷盲、少给他好牌下大注的机会。',
    color: '#3fb27f',
    openRange: 0.68,
    threeBet: 1.2,
    callRange: 0.7,
    limpiness: 0.3,
    aggression: 1.25,
    bluff: 1.05,
    callDown: 0.85,
    sizing: 1.08,
    randomness: 0.05,
    squidAwareness: 0.95,
  },
  {
    id: 'lag',
    name: '松凶',
    shortName: 'LAG',
    description:
      '范围很宽而且极具攻击性，常用中等牌力施压、频繁 3bet。难缠但会过度诈唬，对付它要敢用中等牌抓诈。',
    color: '#e0913a',
    openRange: 1.65,
    threeBet: 1.55,
    callRange: 1.25,
    limpiness: 0.5,
    aggression: 1.4,
    bluff: 1.55,
    callDown: 1.0,
    sizing: 1.12,
    randomness: 0.1,
    squidAwareness: 1.15,
  },
  {
    id: 'nit',
    name: '紧弱岩石',
    shortName: '岩石',
    description:
      '极度保守，只玩顶级起手牌，没有坚果几乎不下大注。他一旦加注基本就是真牌，但可以放心偷他的盲注和底池。',
    color: '#8b93a7',
    openRange: 0.45,
    threeBet: 0.55,
    callRange: 0.55,
    limpiness: 0.6,
    aggression: 0.6,
    bluff: 0.25,
    callDown: 0.7,
    sizing: 0.85,
    randomness: 0.04,
    // 岩石看不懂鱿鱼这笔账 —— 它也是被这个规则罚得最惨的那个
    squidAwareness: 0.45,
  },
  {
    id: 'station',
    name: '松弱跟注站',
    shortName: '跟注站',
    description:
      '什么牌都想看翻牌，进池后极难弃牌，但很少主动加注。对付它的正确方式是放弃诈唬，用好牌反复下大注榨取价值。',
    color: '#d95f7a',
    openRange: 1.85,
    threeBet: 0.45,
    callRange: 2.3,
    limpiness: 2.2,
    aggression: 0.5,
    bluff: 0.2,
    callDown: 2.0,
    sizing: 0.8,
    randomness: 0.12,
    // 本来就什么都跟，鱿鱼再急也没有更松的空间了
    squidAwareness: 0.5,
  },
  {
    id: 'maniac',
    name: '疯子',
    shortName: '疯子',
    description:
      '超高频率的加注和诈唬，几乎不看牌力。短期波动巨大，长期漏洞百出。对付它要收紧范围、耐心等好牌然后让他自己送。',
    color: '#c2453f',
    openRange: 2.4,
    threeBet: 2.3,
    callRange: 1.5,
    limpiness: 0.4,
    aggression: 1.95,
    bluff: 2.7,
    callDown: 1.15,
    sizing: 1.28,
    randomness: 0.2,
    squidAwareness: 1.25,
  },
  {
    id: 'limper',
    name: '跛入鱼',
    shortName: '跛入',
    description:
      '喜欢用各种边缘牌跛入看翻牌，翻后被动，只在真的打中时才下注。让他便宜看牌就是在给他机会，应该多加注隔离。',
    color: '#7f6bd6',
    openRange: 1.5,
    threeBet: 0.4,
    callRange: 1.8,
    limpiness: 3.0,
    aggression: 0.55,
    bluff: 0.35,
    callDown: 1.5,
    sizing: 0.78,
    randomness: 0.14,
    squidAwareness: 0.6,
  },
];

export const DEFAULT_PROFILE_ID = 'gto';

const PROFILE_MAP = new Map(BOT_PROFILES.map((p) => [p.id, p]));

export function getProfile(id: string): BotProfile {
  return PROFILE_MAP.get(id) ?? PROFILE_MAP.get(DEFAULT_PROFILE_ID)!;
}
