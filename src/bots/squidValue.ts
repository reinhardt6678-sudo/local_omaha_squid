/**
 * 鱿鱼压力：把「赢下这手牌」在鱿鱼上的额外价值折算成筹码。
 *
 * 基准策略只会算底池，可是这个游戏里赢一手牌拿到的不只是底池 ——
 * 本轮结算时手上有没有鱿鱼，决定了你是收钱的还是买单的。
 * 这个模块算出那笔额外价值，policy.ts 再把它并进底池赔率里。
 *
 * 算法本身很直白，没有另起一套鱿鱼估值公式：
 *   · 用真正的结算函数算「此刻收摊我拿多少」，
 *   · 再算「这手牌我赢了鱿鱼之后收摊我拿多少」，
 *   · 两者之差就是这手牌在鱿鱼上的边际价值。
 * 结算规则以后怎么改，这里都跟着自动变。
 *
 * 之后再乘一个「紧迫度」：本轮才刚开始的话，这手不赢下手还能赢，
 * 这笔钱不该现在就全额计入；鱿鱼快发完了就没有下次了。
 */

import {
  playersWithoutSquid,
  settleSquidRound,
  type SquidConfig,
  type SquidState,
} from '../engine/squid';

export interface SquidPressureInput {
  squid: SquidState;
  config: SquidConfig;
  /** 正在决策的玩家。 */
  playerId: string;
  bigBlindChips: number;
  /** 对鱿鱼规则的重视程度，0 = 完全无视（退化成纯扑克机器人）。 */
  awareness: number;
}

export interface SquidPressure {
  /** 赢下这手牌额外值多少筹码（已按紧迫度和 awareness 折算）。 */
  bonusChips: number;
  /** 同上，单位 BB。 */
  bonusBB: number;
  /** 未经折算的边际价值（BB）。 */
  marginalBB: number;
  /** 0~1，本轮离结算有多近。 */
  urgency: number;
  /** 中文说明，界面上显示机器人为什么突然打得凶。 */
  note: string;
}

const ZERO_PRESSURE: SquidPressure = {
  bonusChips: 0,
  bonusBB: 0,
  marginalBB: 0,
  urgency: 0,
  note: '',
};

/**
 * 如果本轮此刻结算，某人的净收支（BB）。
 *
 * 这既是「不赢这手」的基准，也顺带处理了各种边角情况
 * （全员 0 条、翻倍档位、付款方平摊），因为它就是结算本身。
 */
function netIfSettledNow(state: SquidState, config: SquidConfig, playerId: string): number {
  return settleSquidRound(state, 'exhausted', config).netBB[playerId] ?? 0;
}

export function squidPressure(input: SquidPressureInput): SquidPressure {
  const { squid, config, playerId, bigBlindChips, awareness } = input;

  if (awareness <= 0) return ZERO_PRESSURE;
  if (!(playerId in squid.holdings)) return ZERO_PRESSURE;

  // 这手牌赢了能拿几条（平分底池累积过就不止一条）
  const award = Math.min(squid.pending, squid.remaining);
  if (award <= 0) return ZERO_PRESSURE;

  const mine = squid.holdings[playerId] ?? 0;

  const baseline = netIfSettledNow(squid, config, playerId);
  const afterWin: SquidState = {
    ...squid,
    holdings: { ...squid.holdings, [playerId]: mine + award },
    remaining: squid.remaining - award,
  };
  const marginalBB = Math.max(0, netIfSettledNow(afterWin, config, playerId) - baseline);

  /* --- 紧迫度 --- */
  // 本轮进度：鱿鱼发得越多，能翻身的手数就越少
  const progress = squid.total > 0 ? (squid.total - squid.remaining) / squid.total : 0;
  let urgency = 0.15 + 0.85 * progress;

  const zeroHolders = playersWithoutSquid(squid).length;
  // 只剩两个人没鱿鱼时，谁先拿到，另一个就要独自买单 —— 这手牌几乎就是决胜局
  if (config.endWhenOnePlayerLeft && mine === 0 && zeroHolders <= 2) {
    urgency = Math.max(urgency, 0.9);
  }
  // 这手就能把鱿鱼发完，没有下一次了
  if (squid.remaining <= award) urgency = 1;
  urgency = Math.min(1, urgency);

  const bonusBB = marginalBB * urgency * awareness;

  return {
    bonusChips: bonusBB * bigBlindChips,
    bonusBB,
    marginalBB,
    urgency,
    note:
      bonusBB > 0.05
        ? `🦑 本轮剩 ${squid.remaining}/${squid.total} 条，我 ${mine} 条：` +
          `赢下这手在鱿鱼上值 ${marginalBB.toFixed(1)}BB × 紧迫度 ${(urgency * 100).toFixed(0)}%` +
          ` = ${bonusBB.toFixed(1)}BB`
        : '',
  };
}
