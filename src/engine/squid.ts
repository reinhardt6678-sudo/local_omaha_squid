/**
 * 鱿鱼游戏（Squid Game）规则。
 *
 * 规则要点：
 *  1. 每轮发 N + 3 条鱿鱼，N 为桌上玩家人数。
 *  2. 每手牌结束后，赢家拿走 1 条鱿鱼。
 *  3. 若出现平分底池，本手不发鱿鱼，下一手赢家拿 2 条；再平分则拿 3 条，以此类推。
 *  4. 鱿鱼发完时结算奖金，然后重置鱿鱼数量开始新一轮。
 *  5. 「最后一人」提前结束：一旦场上只剩一名玩家还没有鱿鱼，本轮立即结束，
 *     由这名玩家独自支付当前所有鱿鱼的价值。（可在设置中关闭）
 *  6. 鱿鱼价值：基础每条 2BB；持有 3 条起翻倍、5 条起再翻倍、7 条起再翻倍。
 *     即 1~2 条 ×1，3~4 条 ×2，5~6 条 ×4，7 条及以上 ×8。
 *     某人的收入 = 条数 × 基础价值 × 倍数。
 *  7. 没有拿到鱿鱼的人平摊支付所有收入。
 */

export interface SquidConfig {
  /** 每条鱿鱼的基础价值（BB）。 */
  baseValueBB: number;
  /** 达到这些条数时价值翻倍（累计）。 */
  doubleThresholds: number[];
  /** 每轮鱿鱼数量 = 玩家人数 + 该值。 */
  squidsPerPlayerOffset: number;
  /** 只剩最后一人没有鱿鱼时立即结束本轮。 */
  endWhenOnePlayerLeft: boolean;
}

export const DEFAULT_SQUID_CONFIG: SquidConfig = {
  baseValueBB: 2,
  doubleThresholds: [3, 5, 7],
  squidsPerPlayerOffset: 3,
  endWhenOnePlayerLeft: true,
};

export interface SquidState {
  /** 本轮鱿鱼总数。 */
  total: number;
  /** 尚未发出的鱿鱼数。 */
  remaining: number;
  /** 每位玩家当前持有的鱿鱼数。 */
  holdings: Record<string, number>;
  /** 下一手赢家应拿走的鱿鱼数（平分底池会让它累加）。 */
  pending: number;
  /** 本轮已经打了多少手牌。 */
  handsPlayed: number;
  /** 这是第几轮（从 1 开始）。 */
  roundNumber: number;
}

/** 持有 n 条鱿鱼时的倍数。 */
export function squidMultiplier(count: number, config: SquidConfig = DEFAULT_SQUID_CONFIG): number {
  let multiplier = 1;
  for (const threshold of config.doubleThresholds) {
    if (count >= threshold) multiplier *= 2;
  }
  return multiplier;
}

/** 持有 n 条鱿鱼的总价值（BB）。 */
export function squidValueBB(count: number, config: SquidConfig = DEFAULT_SQUID_CONFIG): number {
  if (count <= 0) return 0;
  return count * config.baseValueBB * squidMultiplier(count, config);
}

export function createSquidRound(
  playerIds: readonly string[],
  config: SquidConfig = DEFAULT_SQUID_CONFIG,
  roundNumber = 1,
): SquidState {
  const holdings: Record<string, number> = {};
  for (const id of playerIds) holdings[id] = 0;
  const total = playerIds.length + config.squidsPerPlayerOffset;
  return { total, remaining: total, holdings, pending: 1, handsPlayed: 0, roundNumber };
}

export interface SquidAwardResult {
  state: SquidState;
  /** 本手实际发出的鱿鱼数（平分底池时为 0）。 */
  awarded: number;
  /** 拿到鱿鱼的玩家；平分底池时为 null。 */
  winnerId: string | null;
  /** 是否因为平分底池而累积到下一手。 */
  chopped: boolean;
}

/**
 * 一手牌结束后发鱿鱼。
 * winnerIds 是主池赢家；长度大于 1 表示平分底池。
 */
export function awardSquids(state: SquidState, winnerIds: readonly string[]): SquidAwardResult {
  const next: SquidState = {
    ...state,
    holdings: { ...state.holdings },
    handsPlayed: state.handsPlayed + 1,
  };

  if (winnerIds.length === 0) {
    return { state: next, awarded: 0, winnerId: null, chopped: false };
  }

  // 平分底池：本手不发鱿鱼，累积到下一手
  if (winnerIds.length > 1) {
    next.pending = state.pending + 1;
    return { state: next, awarded: 0, winnerId: null, chopped: true };
  }

  const winnerId = winnerIds[0];
  const awarded = Math.min(state.pending, state.remaining);
  next.holdings[winnerId] = (next.holdings[winnerId] ?? 0) + awarded;
  next.remaining = state.remaining - awarded;
  next.pending = 1;

  return { state: next, awarded, winnerId, chopped: false };
}

/** 本轮还没拿到鱿鱼的玩家。 */
export function playersWithoutSquid(state: SquidState): string[] {
  return Object.keys(state.holdings).filter((id) => state.holdings[id] === 0);
}

export type SquidEndReason =
  /** 鱿鱼发完了 */
  | 'exhausted'
  /** 只剩最后一人没有鱿鱼，提前结束 */
  | 'lastPlayerStanding';

/** 判断本轮是否应该结算；返回结算原因，或 null 表示继续。 */
export function checkRoundEnd(
  state: SquidState,
  config: SquidConfig = DEFAULT_SQUID_CONFIG,
): SquidEndReason | null {
  const withoutSquid = playersWithoutSquid(state);

  // 「最后一人」提前结束优先判断：此时鱿鱼可能还没发完
  if (config.endWhenOnePlayerLeft && withoutSquid.length === 1 && state.remaining < state.total) {
    return 'lastPlayerStanding';
  }
  if (state.remaining === 0) return 'exhausted';
  return null;
}

export interface SquidReceiver {
  playerId: string;
  squids: number;
  multiplier: number;
  /** 应收金额（BB）。 */
  amountBB: number;
}

export interface SquidPayer {
  playerId: string;
  squids: number;
  /** 应付金额（BB）。 */
  amountBB: number;
}

export interface SquidSettlement {
  reason: SquidEndReason;
  roundNumber: number;
  receivers: SquidReceiver[];
  payers: SquidPayer[];
  /** 总流转金额（BB）。 */
  totalBB: number;
  /** 各玩家净变化（BB），正数为收入。 */
  netBB: Record<string, number>;
}

/**
 * 计算结算结果。
 *
 * 付款方 = 持有 0 条鱿鱼的玩家，平摊全部支出。
 * 若所有人都拿到了鱿鱼（关闭提前结束时可能发生），
 * 则由持有数最少的那一档玩家平摊。
 */
export function settleSquidRound(
  state: SquidState,
  reason: SquidEndReason,
  config: SquidConfig = DEFAULT_SQUID_CONFIG,
): SquidSettlement {
  const playerIds = Object.keys(state.holdings);
  let payerIds = playerIds.filter((id) => state.holdings[id] === 0);

  // 兜底：没有人是 0 条时，由最少的那一档买单
  if (payerIds.length === 0) {
    const min = Math.min(...playerIds.map((id) => state.holdings[id]));
    payerIds = playerIds.filter((id) => state.holdings[id] === min);
  }

  const payerSet = new Set(payerIds);
  const receivers: SquidReceiver[] = playerIds
    .filter((id) => !payerSet.has(id) && state.holdings[id] > 0)
    .map((id) => ({
      playerId: id,
      squids: state.holdings[id],
      multiplier: squidMultiplier(state.holdings[id], config),
      amountBB: squidValueBB(state.holdings[id], config),
    }))
    .sort((a, b) => b.squids - a.squids);

  const totalBB = receivers.reduce((sum, r) => sum + r.amountBB, 0);
  const shareBB = payerIds.length > 0 ? totalBB / payerIds.length : 0;

  const payers: SquidPayer[] = payerIds.map((id) => ({
    playerId: id,
    squids: state.holdings[id],
    amountBB: shareBB,
  }));

  const netBB: Record<string, number> = {};
  for (const playerId of playerIds) netBB[playerId] = 0;
  for (const r of receivers) netBB[r.playerId] = r.amountBB;
  for (const p of payers) netBB[p.playerId] = -p.amountBB;

  return { reason, roundNumber: state.roundNumber, receivers, payers, totalBB, netBB };
}

/**
 * 把 BB 净额换算成筹码整数，并保证总和为零（余数用最大余额法分配）。
 * 返回每位玩家的筹码变化。
 */
export function settlementToChips(
  settlement: SquidSettlement,
  bigBlindChips: number,
): Record<string, number> {
  const ids = Object.keys(settlement.netBB);
  const exact = ids.map((id) => settlement.netBB[id] * bigBlindChips);
  const floored = exact.map((v) => Math.floor(v));
  let drift = floored.reduce((a, b) => a + b, 0);

  // 由于取整，总和可能为负；把差额补给小数部分最大的几位
  const order = ids
    .map((_, index) => ({ index, frac: exact[index] - floored[index] }))
    .sort((a, b) => b.frac - a.frac);

  let cursor = 0;
  while (drift < 0 && cursor < order.length * 2) {
    floored[order[cursor % order.length].index] += 1;
    drift += 1;
    cursor += 1;
  }

  const result: Record<string, number> = {};
  ids.forEach((id, index) => {
    result[id] = floored[index];
  });
  return result;
}

/** 供界面显示：本轮鱿鱼进度描述。 */
export function describeSquidState(state: SquidState): string {
  const parts = [`第 ${state.roundNumber} 轮`, `剩余 ${state.remaining}/${state.total} 条`];
  if (state.pending > 1) parts.push(`下手可拿 ${state.pending} 条`);
  return parts.join(' · ');
}
