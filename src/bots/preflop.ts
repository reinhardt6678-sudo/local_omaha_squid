/**
 * PLO 翻前手牌强度评估。
 *
 * 奥马哈翻前的全下胜率彼此非常接近（好牌对烂牌常常也只有 60/40），
 * 因此真正决定价值的是「可玩性」：能否做出坚果、四张牌是否协同。
 * 这里按四个维度打分：
 *   1. 对子价值（三条/四条要大幅折价，因为自己堵死了自己的出路）
 *   2. 同花价值（双同花加成，A 高同花是坚果潜力）
 *   3. 顺子覆盖（这手牌总共能参与多少种顺子，越高越好，且高顺权重更大）
 *   4. 孤张惩罚（完全不参与任何组合的牌）
 *
 * 输出 0~100 的分数，配合 rangeThresholds 里的百分位表使用。
 */

import { rankOf, suitOf, type Card } from '../engine/cards';

/** 10 种顺子各自的 5 个 rank 集合。 */
const STRAIGHT_SETS: number[][] = (() => {
  const sets: number[][] = [[12, 0, 1, 2, 3]]; // A2345
  for (let high = 4; high <= 12; high++) {
    sets.push([high - 4, high - 3, high - 2, high - 1, high]);
  }
  return sets;
})();

const STRAIGHT_HIGH_RANK: number[] = [3, ...Array.from({ length: 9 }, (_, i) => i + 4)];

/**
 * 对子的基础价值，rank 0..12 对应 22..AA。
 *
 * 刻意压低了对子相对于顺子结构的权重：PLO 里 JT98 双同花的实战价值
 * 与 AAxx 处于同一档次，把 AA 定得太高会让机器人过度偏爱空 AA。
 */
function pairValue(rank: number): number {
  const table = [4, 4.5, 5, 5.5, 6, 6.5, 7.5, 8.5, 9.5, 11, 13.5, 17, 24];
  return table[rank];
}

/** 同花组合的价值，取决于该花色的最大牌。 */
function suitTopValue(topRank: number): number {
  if (topRank === 12) return 12; // A 高 —— 坚果同花
  if (topRank === 11) return 8;
  if (topRank === 10) return 6;
  if (topRank === 9) return 4.5;
  if (topRank === 8) return 3.5;
  return 2.5;
}

export interface PreflopBreakdown {
  score: number;
  pairPart: number;
  suitPart: number;
  straightPart: number;
  danglerPenalty: number;
  /** 能参与的顺子种类数（0~10）。 */
  straightCoverage: number;
  /** 是否双同花。 */
  doubleSuited: boolean;
  /** 是否含 A 高同花。 */
  hasNutFlushDraw: boolean;
  /** 最大的对子 rank，没有对子为 -1。 */
  topPair: number;
}

export function evaluatePreflop(hole: readonly Card[]): PreflopBreakdown {
  const ranks = hole.map(rankOf);
  const suits = hole.map(suitOf);

  /* --- 1. 对子 --- */
  const rankCounts = new Map<number, number>();
  for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);

  let pairPart = 0;
  let pairCount = 0;
  let topPair = -1;
  for (const [rank, count] of rankCounts) {
    if (count === 2) {
      pairPart += pairValue(rank);
      pairCount += 1;
      topPair = Math.max(topPair, rank);
    } else if (count === 3) {
      // 三条：第三张几乎是废牌，还堵死了自己的葫芦出路
      pairPart += pairValue(rank) * 0.35;
      topPair = Math.max(topPair, rank);
    } else if (count === 4) {
      pairPart += pairValue(rank) * 0.15;
      topPair = Math.max(topPair, rank);
    }
  }
  if (pairCount === 2) pairPart += 2; // 两对结构额外加成

  /* --- 2. 同花 --- */
  const suitGroups = new Map<number, number[]>();
  suits.forEach((s, i) => {
    const group = suitGroups.get(s) ?? [];
    group.push(ranks[i]);
    suitGroups.set(s, group);
  });

  let suitPart = 0;
  let twoCardSuits = 0;
  let hasNutFlushDraw = false;
  for (const [, group] of suitGroups) {
    if (group.length < 2) continue;
    const top = Math.max(...group);
    const base = suitTopValue(top);
    if (top === 12) hasNutFlushDraw = true;
    if (group.length === 2) {
      suitPart += base;
      twoCardSuits += 1;
    } else if (group.length === 3) {
      suitPart += base * 0.45; // 三张同花 —— 自己挡住了自己的同花牌
    } else {
      suitPart += base * 0.25;
    }
  }
  const doubleSuited = twoCardSuits === 2;
  if (doubleSuited) suitPart += 7;

  /* --- 3. 顺子覆盖 --- */
  const distinctRanks = new Set(ranks);
  let straightPart = 0;
  let straightCoverage = 0;
  STRAIGHT_SETS.forEach((set, index) => {
    let hits = 0;
    for (const r of set) if (distinctRanks.has(r)) hits += 1;
    if (hits >= 2) {
      straightCoverage += 1;
      // 高顺子权重更大（做成的是坚果的概率更高）
      const highRank = STRAIGHT_HIGH_RANK[index];
      const heightWeight = 0.55 + 0.45 * (highRank / 12);
      // 只命中 2 张的顺子必须靠 3 张精确的公共牌，实战价值远低于顺连结构；
      // 命中 3~4 张才是有冗余、能反复做成坚果的「包顺」。
      const densityWeight = hits >= 4 ? 1.9 : hits === 3 ? 1.45 : 0.5;
      straightPart += 4.6 * heightWeight * densityWeight;
    }
  });

  /* --- 4. 孤张惩罚 --- */
  let danglerPenalty = 0;
  for (let i = 0; i < hole.length; i++) {
    const pairs = (rankCounts.get(ranks[i]) ?? 0) > 1;
    const suited = (suitGroups.get(suits[i])?.length ?? 0) > 1;
    let connects = false;
    for (let j = 0; j < hole.length && !connects; j++) {
      if (i === j || ranks[i] === ranks[j]) continue;
      for (const set of STRAIGHT_SETS) {
        if (set.includes(ranks[i]) && set.includes(ranks[j])) {
          connects = true;
          break;
        }
      }
    }
    if (!pairs && !suited && !connects) danglerPenalty += 5;
    else if (!pairs && !suited && ranks[i] < 8) {
      // 参与顺子但是低张、没有其他用途 —— 轻微折价
      danglerPenalty += 1;
    }
  }

  // 手握大对子时，两张废牌的伤害没有那么大：牌力主要来自「翻出顶三条」
  if (topPair >= 8) danglerPenalty *= 0.5;

  const raw = pairPart + suitPart + straightPart - danglerPenalty;
  const score = Math.max(0, Math.min(100, raw));

  return {
    score,
    pairPart,
    suitPart,
    straightPart,
    danglerPenalty,
    straightCoverage,
    doubleSuited,
    hasNutFlushDraw,
    topPair,
  };
}

export function preflopScore(hole: readonly Card[]): number {
  return evaluatePreflop(hole).score;
}

/**
 * 随机 PLO 手牌分数的百分位表（由 scripts/calibrate.ts 采样 30 万手生成）。
 * PERCENTILE_SCORES[p] = 分数高于该值的手牌恰好占前 p%。
 */
export const PERCENTILE_SCORES: Record<number, number> = {
  1: 45.4,
  2: 41.9,
  3: 39.5,
  5: 36.8,
  8: 33.8,
  10: 32.4,
  12: 31.1,
  15: 29.5,
  18: 28.0,
  20: 27.1,
  25: 25.3,
  30: 23.6,
  35: 22.1,
  40: 20.9,
  45: 19.5,
  50: 18.5,
  60: 16.4,
  70: 14.5,
  80: 12.5,
  90: 9.9,
  100: 0,
};

/** 把「打前 N%」换算成分数门槛。 */
export function thresholdForPercentile(percentile: number): number {
  const keys = Object.keys(PERCENTILE_SCORES)
    .map(Number)
    .sort((a, b) => a - b);

  if (percentile <= keys[0]) return PERCENTILE_SCORES[keys[0]];
  const last = keys[keys.length - 1];
  if (percentile >= last) return PERCENTILE_SCORES[last];

  for (let i = 1; i < keys.length; i++) {
    if (percentile <= keys[i]) {
      const lo = keys[i - 1];
      const hi = keys[i];
      const t = (percentile - lo) / (hi - lo);
      return PERCENTILE_SCORES[lo] + t * (PERCENTILE_SCORES[hi] - PERCENTILE_SCORES[lo]);
    }
  }
  return 0;
}

/** 反查：这手牌大约排在前百分之几。 */
export function percentileForScore(score: number): number {
  const keys = Object.keys(PERCENTILE_SCORES)
    .map(Number)
    .sort((a, b) => a - b);

  for (let i = 0; i < keys.length; i++) {
    if (score >= PERCENTILE_SCORES[keys[i]]) {
      if (i === 0) return keys[0];
      const hi = keys[i];
      const lo = keys[i - 1];
      const scoreHi = PERCENTILE_SCORES[lo];
      const scoreLo = PERCENTILE_SCORES[hi];
      const t = (scoreHi - score) / (scoreHi - scoreLo || 1);
      return lo + t * (hi - lo);
    }
  }
  return 100;
}
