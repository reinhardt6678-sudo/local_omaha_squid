/**
 * 五张牌牌力评估 + 奥马哈「必须 2 张底牌 + 3 张公共牌」的最优组合搜索。
 *
 * 评分是一个可直接比较大小的整数，越大越强：
 *   score = (牌型 << 20) | (踢脚1 << 16) | (踢脚2 << 12) | ... | (踢脚5)
 * 每个踢脚占 4 bit（0..12），因此可以安全地用一个数字比较两手牌。
 */

import { rankOf, suitOf, type Card } from './cards';

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;

export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory];

export const CATEGORY_NAMES_CN: Record<number, string> = {
  [HandCategory.HighCard]: '高牌',
  [HandCategory.Pair]: '一对',
  [HandCategory.TwoPair]: '两对',
  [HandCategory.Trips]: '三条',
  [HandCategory.Straight]: '顺子',
  [HandCategory.Flush]: '同花',
  [HandCategory.FullHouse]: '葫芦',
  [HandCategory.Quads]: '四条',
  [HandCategory.StraightFlush]: '同花顺',
};

export function categoryOf(score: number): HandCategory {
  return (score >> 20) as HandCategory;
}

export function categoryName(score: number): string {
  return CATEGORY_NAMES_CN[categoryOf(score)];
}

function packScore(category: HandCategory, k1: number, k2 = 0, k3 = 0, k4 = 0, k5 = 0): number {
  return (category << 20) | (k1 << 16) | (k2 << 12) | (k3 << 8) | (k4 << 4) | k5;
}

/**
 * 顺子查表：把 13 个 rank 压成一个 bitmask，
 * STRAIGHT_HIGH[mask] = 顺子最大牌的 rank（含轮子 A2345，记为 5 即 rank 3），没有顺子则为 -1。
 */
const STRAIGHT_HIGH = new Int8Array(1 << 13).fill(-1);
{
  // 普通顺子：从 2345 6 一直到 TJQKA
  for (let high = 4; high <= 12; high++) {
    let mask = 0;
    for (let i = 0; i < 5; i++) mask |= 1 << (high - i);
    STRAIGHT_HIGH[mask] = high;
  }
  // 轮子 A-2-3-4-5：A(12) 加上 2,3,4,5 (0..3)，最大牌算作 5
  const wheel = (1 << 12) | (1 << 3) | (1 << 2) | (1 << 1) | 1;
  STRAIGHT_HIGH[wheel] = 3;
}

/** 通用顺子判断：mask 里 bit 数不限，返回最大顺子的高牌 rank，没有则 -1。 */
function straightHighFromMask(mask: number): number {
  for (let high = 12; high >= 4; high--) {
    const need = 0b11111 << (high - 4);
    if ((mask & need) === need) return high;
  }
  const wheel = (1 << 12) | (1 << 3) | (1 << 2) | (1 << 1) | 1;
  if ((mask & wheel) === wheel) return 3;
  return -1;
}

/**
 * 评估恰好 5 张牌。返回可比较的整数分值。
 */
export function evaluate5(a: Card, b: Card, c: Card, d: Card, e: Card): number {
  const r0 = a >> 2, r1 = b >> 2, r2 = c >> 2, r3 = d >> 2, r4 = e >> 2;
  const isFlush = ((a & 3) === (b & 3)) && ((a & 3) === (c & 3)) && ((a & 3) === (d & 3)) && ((a & 3) === (e & 3));

  const mask = (1 << r0) | (1 << r1) | (1 << r2) | (1 << r3) | (1 << r4);

  // 五张牌各不相同时，mask 一定有 5 个 bit —— 可以直接查表
  const distinct = mask === 0 ? 0 : popcount(mask);

  if (distinct === 5) {
    const straightHigh = STRAIGHT_HIGH[mask];
    if (straightHigh >= 0) {
      return packScore(isFlush ? HandCategory.StraightFlush : HandCategory.Straight, straightHigh);
    }
    // 高牌或同花：按从大到小排列的 5 个 rank 作为踢脚
    const sorted = sortDescending5(r0, r1, r2, r3, r4);
    return packScore(
      isFlush ? HandCategory.Flush : HandCategory.HighCard,
      sorted[0], sorted[1], sorted[2], sorted[3], sorted[4],
    );
  }

  // 有对子结构：统计每个 rank 的张数
  const counts = new Uint8Array(13);
  counts[r0]++; counts[r1]++; counts[r2]++; counts[r3]++; counts[r4]++;

  let quad = -1, trip = -1, pairHigh = -1, pairLow = -1;
  const kickers: number[] = [];
  for (let r = 12; r >= 0; r--) {
    switch (counts[r]) {
      case 4: quad = r; break;
      case 3: trip = r; break;
      case 2:
        if (pairHigh < 0) pairHigh = r;
        else pairLow = r;
        break;
      case 1: kickers.push(r); break;
    }
  }

  if (quad >= 0) return packScore(HandCategory.Quads, quad, kickers[0]);
  if (trip >= 0 && pairHigh >= 0) return packScore(HandCategory.FullHouse, trip, pairHigh);
  if (trip >= 0) return packScore(HandCategory.Trips, trip, kickers[0], kickers[1]);
  if (pairLow >= 0) return packScore(HandCategory.TwoPair, pairHigh, pairLow, kickers[0]);
  return packScore(HandCategory.Pair, pairHigh, kickers[0], kickers[1], kickers[2]);
}

function popcount(x: number): number {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >> 24;
}

function sortDescending5(a: number, b: number, c: number, d: number, e: number): number[] {
  const arr = [a, b, c, d, e];
  arr.sort((x, y) => y - x);
  return arr;
}

/* ------------------------------------------------------------------ */
/* 奥马哈：2 张底牌 + 3 张公共牌                                        */
/* ------------------------------------------------------------------ */

/** 4 张底牌里取 2 张的所有组合下标。 */
const HOLE_PAIRS_4: readonly (readonly [number, number])[] = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
];

/** 5 张公共牌里取 3 张的所有组合下标。 */
const BOARD_TRIPLES_5: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [0, 1, 3], [0, 1, 4], [0, 2, 3], [0, 2, 4],
  [0, 3, 4], [1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4],
];

/** 从 n 个元素里取 k 个的下标组合（用于底牌数不是 4、公共牌数不是 5 的情况）。 */
function combinations(n: number, k: number): number[][] {
  const result: number[][] = [];
  const current: number[] = [];
  const walk = (start: number) => {
    if (current.length === k) {
      result.push(current.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      current.push(i);
      walk(i + 1);
      current.pop();
    }
  };
  walk(0);
  return result;
}

const comboCache = new Map<string, number[][]>();
function cachedCombinations(n: number, k: number): number[][] {
  const key = `${n}:${k}`;
  let value = comboCache.get(key);
  if (!value) {
    value = combinations(n, k);
    comboCache.set(key, value);
  }
  return value;
}

/**
 * 奥马哈牌力：必须使用恰好 2 张底牌 + 3 张公共牌。
 * 公共牌不足 5 张时会返回 -1（无法成牌）。
 */
export function evaluateOmaha(hole: readonly Card[], board: readonly Card[]): number {
  if (board.length < 5) return -1;

  const holePairs = hole.length === 4 ? HOLE_PAIRS_4 : (cachedCombinations(hole.length, 2) as unknown as readonly (readonly [number, number])[]);
  const boardTriples = board.length === 5 ? BOARD_TRIPLES_5 : (cachedCombinations(board.length, 3) as unknown as readonly (readonly [number, number, number])[]);

  let best = -1;
  for (let i = 0; i < holePairs.length; i++) {
    const h = holePairs[i];
    const h0 = hole[h[0]];
    const h1 = hole[h[1]];
    for (let j = 0; j < boardTriples.length; j++) {
      const t = boardTriples[j];
      const score = evaluate5(h0, h1, board[t[0]], board[t[1]], board[t[2]]);
      if (score > best) best = score;
    }
  }
  return best;
}

/** 返回构成最佳牌型的那 5 张牌，用于摊牌时高亮显示。 */
export function bestOmahaCards(hole: readonly Card[], board: readonly Card[]): { score: number; cards: Card[] } {
  if (board.length < 5) return { score: -1, cards: [] };

  const holePairs = hole.length === 4 ? HOLE_PAIRS_4 : (cachedCombinations(hole.length, 2) as unknown as readonly (readonly [number, number])[]);
  const boardTriples = board.length === 5 ? BOARD_TRIPLES_5 : (cachedCombinations(board.length, 3) as unknown as readonly (readonly [number, number, number])[]);

  let best = -1;
  let bestCards: Card[] = [];
  for (const h of holePairs) {
    for (const t of boardTriples) {
      const cards = [hole[h[0]], hole[h[1]], board[t[0]], board[t[1]], board[t[2]]];
      const score = evaluate5(cards[0], cards[1], cards[2], cards[3], cards[4]);
      if (score > best) {
        best = score;
        bestCards = cards;
      }
    }
  }
  return { score: best, cards: bestCards };
}

/** 中文描述一手牌，例如「葫芦 K 带 7」。 */
export function describeScore(score: number): string {
  if (score < 0) return '';
  const category = categoryOf(score);
  const k1 = (score >> 16) & 0xf;
  const k2 = (score >> 12) & 0xf;
  const names = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  switch (category) {
    case HandCategory.StraightFlush:
      return k1 === 12 ? '皇家同花顺' : `同花顺 ${names[k1]} 高`;
    case HandCategory.Quads:
      return `四条 ${names[k1]}`;
    case HandCategory.FullHouse:
      return `葫芦 ${names[k1]} 带 ${names[k2]}`;
    case HandCategory.Flush:
      return `同花 ${names[k1]} 高`;
    case HandCategory.Straight:
      return `顺子 ${names[k1]} 高`;
    case HandCategory.Trips:
      return `三条 ${names[k1]}`;
    case HandCategory.TwoPair:
      return `两对 ${names[k1]} 和 ${names[k2]}`;
    case HandCategory.Pair:
      return `一对 ${names[k1]}`;
    default:
      return `${names[k1]} 高牌`;
  }
}

/** 供 7 张牌（德州）或通用用途的顺子判断，导出以便测试。 */
export const _internal = { straightHighFromMask, STRAIGHT_HIGH, rankOf, suitOf };
