/**
 * 蒙特卡洛胜率估算。
 *
 * 奥马哈无法像德州那样穷举（每人 4 张底牌、60 种组合），
 * 所以用抽样模拟：反复随机补全公共牌和对手底牌，统计胜率。
 */

import { DECK_SIZE, type Card, type Rng } from '../engine/cards';
import { evaluateOmaha } from '../engine/evaluator';
import { preflopScore } from './preflop';

export interface EquityResult {
  /** 综合胜率，平局按人数均分计入。 */
  equity: number;
  win: number;
  tie: number;
  samples: number;
}

export interface EquityOptions {
  hero: readonly Card[];
  board: readonly Card[];
  /** 对手数量。 */
  opponents: number;
  iterations: number;
  rng: Rng;
  /**
   * 对手起手牌门槛（0~100 的翻前分数）。
   * 用来近似「对手不是随机牌，而是有范围的」。
   */
  opponentMinScore?: number;
  holeCards?: number;
}

/**
 * 估算 hero 在给定公共牌下对抗 N 个对手的胜率。
 */
export function monteCarloEquity(options: EquityOptions): EquityResult {
  const { hero, board, opponents, iterations, rng } = options;
  const holeCards = options.holeCards ?? 4;
  const minScore = options.opponentMinScore ?? 0;

  // 构造未知牌池
  const used = new Uint8Array(DECK_SIZE);
  for (const c of hero) used[c] = 1;
  for (const c of board) used[c] = 1;
  const pool: Card[] = [];
  for (let c = 0; c < DECK_SIZE; c++) if (!used[c]) pool.push(c);

  const boardNeeded = 5 - board.length;
  const drawCount = boardNeeded + opponents * holeCards;
  if (drawCount > pool.length) {
    return { equity: 0, win: 0, tie: 0, samples: 0 };
  }

  let win = 0;
  let tie = 0;
  let samples = 0;

  const fullBoard: Card[] = new Array(5);
  for (let i = 0; i < board.length; i++) fullBoard[i] = board[i];

  const opponentHand: Card[] = new Array(holeCards);
  const scratch = pool.slice();

  for (let iter = 0; iter < iterations; iter++) {
    // 部分洗牌：只打乱需要抽取的前 drawCount 张
    const limit = scratch.length;
    for (let i = 0; i < drawCount; i++) {
      const j = i + rng.int(limit - i);
      const tmp = scratch[i];
      scratch[i] = scratch[j];
      scratch[j] = tmp;
    }

    let cursor = 0;
    for (let i = 0; i < boardNeeded; i++) fullBoard[board.length + i] = scratch[cursor++];

    const heroScore = evaluateOmaha(hero, fullBoard);
    let better = 0;
    let equal = 0;
    let valid = true;

    for (let o = 0; o < opponents; o++) {
      for (let k = 0; k < holeCards; k++) opponentHand[k] = scratch[cursor++];

      // 范围过滤：对手太差的牌视为不会打到这里，本次抽样作废
      if (minScore > 0 && preflopScore(opponentHand) < minScore) {
        valid = false;
        break;
      }

      const score = evaluateOmaha(opponentHand, fullBoard);
      if (score > heroScore) {
        better += 1;
        break;
      }
      if (score === heroScore) equal += 1;
    }

    if (!valid) continue;
    samples += 1;
    if (better > 0) continue;
    if (equal > 0) tie += 1 / (equal + 1);
    else win += 1;
  }

  if (samples === 0) return { equity: 0, win: 0, tie: 0, samples: 0 };
  return { equity: (win + tie) / samples, win: win / samples, tie: tie / samples, samples };
}

/**
 * 快速估算「摊牌价值 + 听牌潜力」：
 * 返回当前胜率，以及在最坏情况（对手范围收紧）下的胜率，用于判断牌力的稳健程度。
 */
export interface HandStrength {
  /** 对抗当前对手数量的胜率。 */
  equity: number;
  /** 对抗更强范围时的胜率，反映「这手牌怕不怕打」。 */
  equityVsStrong: number;
  /** 摊牌时能否稳赢，用于区分成手牌和听牌。 */
  showdownValue: number;
}

export function assessHand(
  hero: readonly Card[],
  board: readonly Card[],
  opponents: number,
  rng: Rng,
  iterations = 320,
): HandStrength {
  const loose = monteCarloEquity({ hero, board, opponents, iterations, rng });
  const tight = monteCarloEquity({
    hero,
    board,
    opponents,
    iterations: Math.round(iterations * 0.6),
    rng,
    opponentMinScore: 30,
  });

  return {
    equity: loose.equity,
    equityVsStrong: tight.samples > 0 ? tight.equity : loose.equity,
    showdownValue: loose.win,
  };
}
