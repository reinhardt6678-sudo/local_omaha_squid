/**
 * 采样校准脚本：
 *  1. 生成翻前分数的百分位表（写回 preflop.ts 的 PERCENTILE_SCORES）
 *  2. 检查分数与实际全下胜率的相关性
 *  3. 打印若干经典牌型的排名，做人工合理性检查
 *
 * 运行： node --experimental-strip-types scripts/calibrate.ts
 */

import { createRng, parseCards, shuffledDeck, cardsToString } from '../src/engine/cards.ts';
import { evaluatePreflop, percentileForScore, preflopScore } from '../src/bots/preflop.ts';
import { monteCarloEquity } from '../src/bots/equity.ts';

const rng = createRng(20260815);
const SAMPLES = 300_000;

const scores = new Float64Array(SAMPLES);
for (let i = 0; i < SAMPLES; i++) {
  const deck = shuffledDeck(rng);
  scores[i] = preflopScore([deck[0], deck[1], deck[2], deck[3]]);
}
scores.sort();

function scoreAtTopPercent(p: number): number {
  // 前 p% 最强 → 取 (100-p) 分位数
  const index = Math.floor(((100 - p) / 100) * (SAMPLES - 1));
  return scores[Math.max(0, Math.min(SAMPLES - 1, index))];
}

const percentiles = [1, 2, 3, 5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90];
console.log('=== 百分位表（可直接粘贴回 preflop.ts） ===');
const table: Record<number, number> = {};
for (const p of percentiles) {
  table[p] = Math.round(scoreAtTopPercent(p) * 10) / 10;
  console.log(`  ${p}: ${table[p]},`);
}
console.log('  100: 0,');

console.log('\n=== 分布概况 ===');
console.log('最低分:', scores[0].toFixed(1));
console.log('最高分:', scores[SAMPLES - 1].toFixed(1));
console.log('中位数:', scoreAtTopPercent(50).toFixed(1));
console.log('平均分:', (scores.reduce((a, b) => a + b, 0) / SAMPLES).toFixed(1));

/* --- 经典牌型排名 --- */
const NAMED: [string, string][] = [
  ['AsAhKsKh', 'AAKK 双同花 —— PLO 最强牌'],
  ['AsAhKdKc', 'AAKK 无同花'],
  ['AsAh2d7c', 'AA 带垃圾（典型陷阱牌）'],
  ['JsTs9h8h', 'JT98 双同花顺连'],
  ['JsTd9h8c', 'JT98 彩虹'],
  ['AsKsQhJh', 'AKQJ 双同花'],
  ['AsAdAhKs', 'AAA 带 K（三条堵死自己）'],
  ['2s2d7h9c', '小对子带散牌'],
  ['As7d4h2c', '典型垃圾牌'],
  ['KsQsJhTh', 'KQJT 双同花'],
  ['AsAd5s4d', 'AA 双同花带轮子'],
  ['9s8s7h6h', '9876 双同花'],
  ['AsKdQc2h', 'AKQ2 彩虹'],
  ['7s7d7h2c', '三条 7 带 2'],
];

console.log('\n=== 经典牌型排名 ===');
for (const [text, label] of NAMED) {
  const hole = parseCards(text);
  const breakdown = evaluatePreflop(hole);
  const pct = percentileForScore(breakdown.score);
  console.log(
    `${text}  分数 ${breakdown.score.toFixed(1).padStart(5)}  前 ${pct.toFixed(1).padStart(5)}%  ` +
      `[对子 ${breakdown.pairPart.toFixed(1)} 同花 ${breakdown.suitPart.toFixed(1)} ` +
      `顺子 ${breakdown.straightPart.toFixed(1)} 孤张 -${breakdown.danglerPenalty.toFixed(1)}]  ${label}`,
  );
}

/* --- 分数与实战胜率的相关性 --- */
console.log('\n=== 分数分档 vs 单挑全下胜率（对抗随机牌）===');
const buckets: { lo: number; hi: number; label: string }[] = [
  { lo: 45, hi: 999, label: '前 3%  ' },
  { lo: 37, hi: 45, label: '前 10% ' },
  { lo: 31, hi: 37, label: '前 25% ' },
  { lo: 24, hi: 31, label: '前 50% ' },
  { lo: 17, hi: 24, label: '后 50% ' },
  { lo: 0, hi: 17, label: '后 20% ' },
];

for (const bucket of buckets) {
  let found = 0;
  let totalEquity = 0;
  let guard = 0;
  while (found < 60 && guard++ < 60000) {
    const deck = shuffledDeck(rng);
    const hole = [deck[0], deck[1], deck[2], deck[3]];
    const score = preflopScore(hole);
    if (score < bucket.lo || score >= bucket.hi) continue;
    found += 1;
    totalEquity += monteCarloEquity({
      hero: hole,
      board: [],
      opponents: 1,
      iterations: 600,
      rng,
    }).equity;
  }
  console.log(`${bucket.label} 样本 ${found}  平均胜率 ${((totalEquity / found) * 100).toFixed(1)}%`);
}

/* --- 多人底池胜率 --- */
console.log('\n=== AAKK 双同花在不同人数下的胜率 ===');
for (const opponents of [1, 2, 3, 5]) {
  const equity = monteCarloEquity({
    hero: parseCards('AsAhKsKh'),
    board: [],
    opponents,
    iterations: 4000,
    rng,
  }).equity;
  console.log(`  对抗 ${opponents} 人: ${(equity * 100).toFixed(1)}%`);
}

console.log('\n=== 一致性检查：同一手牌多次评分应完全相同 ===');
const sample = parseCards('JsTs9h8h');
console.log(cardsToString(sample), preflopScore(sample) === preflopScore(sample) ? '通过' : '失败');
