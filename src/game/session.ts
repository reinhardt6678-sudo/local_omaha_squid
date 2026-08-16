/**
 * 对局会话：把牌桌状态机、鱿鱼规则和机器人接在一起。
 *
 * 界面和批量模拟脚本都通过这一层驱动牌局，保证「你看到的」
 * 和「跑几万手统计出来的」是同一套逻辑。
 */

import { createRng, type Rng } from '../engine/cards';
import {
  applyAction,
  createSeat,
  legalActions,
  startHand,
  type Action,
  type HandState,
  type LogEntry,
  type Seat,
  type TableConfig,
  DEFAULT_TABLE_CONFIG,
} from '../engine/table';
import {
  awardSquids,
  checkRoundEnd,
  createSquidRound,
  DEFAULT_SQUID_CONFIG,
  settlementToChips,
  settleSquidRound,
  type SquidConfig,
  type SquidSettlement,
  type SquidState,
} from '../engine/squid';
import { decide, type BotDecision } from '../bots/policy';
import { getProfile } from '../bots/profiles';

export interface SessionConfig {
  table: TableConfig;
  squid: SquidConfig;
  /** 是否启用鱿鱼玩法。 */
  squidEnabled: boolean;
  /** 筹码低于 10BB 时自动补码到起始筹码。 */
  autoRebuy: boolean;
  /** 机器人蒙特卡洛迭代次数。 */
  botIterations: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  table: DEFAULT_TABLE_CONFIG,
  squid: DEFAULT_SQUID_CONFIG,
  squidEnabled: true,
  autoRebuy: true,
  botIterations: 260,
};

export interface PlayerStats {
  handsPlayed: number;
  /** 主动投钱进池的手数（不含盲注）。 */
  vpipHands: number;
  /** 翻前加注的手数。 */
  pfrHands: number;
  handsWon: number;
  squidsWon: number;
  /** 累计买入筹码。 */
  buyIn: number;
  /** 鱿鱼结算累计净额（筹码）。 */
  squidNet: number;
}

export type SessionPhase =
  /** 等待开始下一手 */
  | 'idle'
  /** 牌局进行中，等待某位玩家行动 */
  | 'playing'
  /** 一手牌结束，等待确认 */
  | 'handComplete'
  /** 鱿鱼结算弹窗 */
  | 'settlement';

export interface SessionState {
  seats: Seat[];
  button: number;
  handNumber: number;
  hand: HandState | null;
  squid: SquidState;
  config: SessionConfig;
  phase: SessionPhase;
  log: LogEntry[];
  stats: Record<string, PlayerStats>;
  /** 待展示的鱿鱼结算结果。 */
  pendingSettlement: SquidSettlement | null;
  /** 最近一次机器人决策，供界面显示思考过程。 */
  lastBotDecision: { seatId: string; decision: BotDecision } | null;
  /** 本手牌各玩家是否主动投过钱（用于统计 VPIP）。 */
  voluntaryThisHand: Set<string>;
  raisedThisHand: Set<string>;
  /** 当前这手牌的日志已经同步到会话日志的条数。 */
  copiedHandLogCount: number;
}

export interface SeatSetup {
  id: string;
  name: string;
  isHuman: boolean;
  profileId: string;
}

export function defaultSeatSetup(): SeatSetup[] {
  return [
    { id: 'hero', name: '你', isHuman: true, profileId: 'gto' },
    { id: 'bot1', name: '阿泰', isHuman: false, profileId: 'tag' },
    { id: 'bot2', name: '老鹰', isHuman: false, profileId: 'lag' },
    { id: 'bot3', name: '石头', isHuman: false, profileId: 'nit' },
    { id: 'bot4', name: '大鱼', isHuman: false, profileId: 'station' },
    { id: 'bot5', name: '疯狗', isHuman: false, profileId: 'maniac' },
  ];
}

/* ------------------------------------------------------------------ */

export function createSession(
  setups: SeatSetup[],
  config: SessionConfig = DEFAULT_SESSION_CONFIG,
  seed?: number,
): { state: SessionState; rng: Rng } {
  const rng = createRng(seed);
  const seats = setups.map((s) =>
    createSeat(s.id, s.name, config.table.startingStack, {
      isHuman: s.isHuman,
      profileId: s.profileId,
    }),
  );

  const stats: Record<string, PlayerStats> = {};
  for (const seat of seats) {
    stats[seat.id] = {
      handsPlayed: 0,
      vpipHands: 0,
      pfrHands: 0,
      handsWon: 0,
      squidsWon: 0,
      buyIn: config.table.startingStack,
      squidNet: 0,
    };
  }

  const state: SessionState = {
    seats,
    button: 0,
    handNumber: 0,
    hand: null,
    squid: createSquidRound(seats.map((s) => s.id), config.squid, 1),
    config,
    phase: 'idle',
    log: [],
    stats,
    pendingSettlement: null,
    lastBotDecision: null,
    voluntaryThisHand: new Set(),
    raisedThisHand: new Set(),
    copiedHandLogCount: 0,
  };

  return { state, rng };
}

/* ------------------------------------------------------------------ */

/** 开始新的一手牌。 */
export function beginHand(state: SessionState, rng: Rng): void {
  // 自动补码
  if (state.config.autoRebuy) {
    for (const seat of state.seats) {
      if (seat.stack < state.config.table.bigBlind * 10) {
        const topUp = state.config.table.startingStack - seat.stack;
        if (topUp > 0) {
          seat.stack += topUp;
          state.stats[seat.id].buyIn += topUp;
          state.log.push({
            handNumber: state.handNumber + 1,
            street: 'preflop',
            text: `${seat.name} 补码 ${(topUp / state.config.table.bigBlind).toFixed(0)}BB`,
            kind: 'info',
          });
        }
      }
    }
  }

  const playable = state.seats.filter((s) => s.stack > 0);
  if (playable.length < 2) {
    state.phase = 'idle';
    return;
  }

  state.handNumber += 1;
  state.voluntaryThisHand = new Set();
  state.raisedThisHand = new Set();
  state.lastBotDecision = null;
  state.copiedHandLogCount = 0;

  // 庄位移到下一个有筹码的玩家
  state.hand = startHand({
    seats: state.seats,
    button: state.button,
    config: state.config.table,
    rng,
    handNumber: state.handNumber,
  });

  for (const seat of state.hand.seats) {
    if (seat.inHand) state.stats[seat.id].handsPlayed += 1;
  }

  state.phase = 'playing';
  syncLog(state);
}

/** 当前该谁行动；没有人需要行动时返回 null。 */
export function currentActor(state: SessionState): Seat | null {
  if (!state.hand || state.phase !== 'playing') return null;
  if (state.hand.actor < 0) return null;
  return state.hand.seats[state.hand.actor];
}

export function isHumanTurn(state: SessionState): boolean {
  const actor = currentActor(state);
  return actor !== null && actor.isHuman;
}

/** 执行一个动作（人或机器人都走这里）。 */
export function submitAction(state: SessionState, action: Action): void {
  if (!state.hand || state.phase !== 'playing') return;

  const seat = state.hand.seats[state.hand.actor];
  const preflop = state.hand.street === 'preflop';

  // 统计 VPIP / PFR
  if (preflop) {
    if (action.type === 'call' || action.type === 'bet' || action.type === 'raise') {
      state.voluntaryThisHand.add(seat.id);
    }
    if (action.type === 'raise' || action.type === 'bet') {
      state.raisedThisHand.add(seat.id);
    }
  }

  state.hand = applyAction(state.hand, action);
  syncLog(state);

  if (state.hand.street === 'complete') {
    completeHand(state);
  }
}

/** 让当前的机器人行动一次。返回它的决策，若当前是人类则返回 null。 */
export function stepBot(state: SessionState, rng: Rng): BotDecision | null {
  if (!state.hand || state.phase !== 'playing') return null;
  const actor = currentActor(state);
  if (!actor || actor.isHuman) return null;

  const legal = legalActions(state.hand);
  if (!legal) return null;

  const decision = decide({
    state: state.hand,
    legal,
    profile: getProfile(actor.profileId),
    rng,
    iterations: state.config.botIterations,
  });

  state.lastBotDecision = { seatId: actor.id, decision };
  submitAction(state, decision.action);
  return decision;
}

/* ------------------------------------------------------------------ */
/* 一手牌结束                                                          */
/* ------------------------------------------------------------------ */

function completeHand(state: SessionState): void {
  const hand = state.hand!;
  const result = hand.result!;

  // 把本手结束后的筹码写回持久座位
  for (const seat of state.seats) {
    const handSeat = hand.seats.find((s) => s.id === seat.id);
    if (handSeat) seat.stack = handSeat.stack;
  }

  for (const id of state.voluntaryThisHand) state.stats[id].vpipHands += 1;
  for (const id of state.raisedThisHand) state.stats[id].pfrHands += 1;
  for (const id of result.mainPotWinners) state.stats[id].handsWon += 1;

  const bb = state.config.table.bigBlind;
  const winnerNames = result.mainPotWinners
    .map((id) => state.seats.find((s) => s.id === id)?.name ?? id)
    .join('、');
  const potSize = result.pots.reduce((sum, p) => sum + p.amount, 0);
  state.log.push({
    handNumber: hand.handNumber,
    street: 'complete',
    text:
      result.mainPotWinners.length > 1
        ? `${winnerNames} 平分底池 ${(potSize / bb).toFixed(1)}BB`
        : `${winnerNames} 赢下底池 ${(potSize / bb).toFixed(1)}BB`,
    kind: 'result',
  });

  // 发鱿鱼
  if (state.config.squidEnabled) {
    const award = awardSquids(state.squid, result.mainPotWinners);
    state.squid = award.state;

    if (award.chopped) {
      state.log.push({
        handNumber: hand.handNumber,
        street: 'complete',
        text: `平分底池，本手不发鱿鱼，下一手赢家可拿 ${state.squid.pending} 条`,
        kind: 'squid',
      });
    } else if (award.winnerId && award.awarded > 0) {
      const name = state.seats.find((s) => s.id === award.winnerId)?.name ?? award.winnerId;
      state.stats[award.winnerId].squidsWon += award.awarded;
      state.log.push({
        handNumber: hand.handNumber,
        street: 'complete',
        text: `${name} 拿走 ${award.awarded} 条鱿鱼（剩余 ${state.squid.remaining} 条）`,
        kind: 'squid',
      });
    }

    const endReason = checkRoundEnd(state.squid, state.config.squid);
    if (endReason) {
      const settlement = settleSquidRound(state.squid, endReason, state.config.squid);
      state.pendingSettlement = settlement;
      state.phase = 'settlement';
      return;
    }
  }

  state.phase = 'handComplete';
}

/** 确认鱿鱼结算：转移筹码并开始新一轮。 */
export function applySettlement(state: SessionState): void {
  const settlement = state.pendingSettlement;
  if (!settlement) return;

  const bb = state.config.table.bigBlind;
  const chips = settlementToChips(settlement, bb);

  // 支付能力有限时按比例缩减（家庭局里几乎不会发生，但要保证筹码守恒）
  let shortfall = 0;
  for (const seat of state.seats) {
    const delta = chips[seat.id] ?? 0;
    if (delta < 0 && seat.stack < -delta) {
      shortfall += -delta - seat.stack;
      chips[seat.id] = -seat.stack;
    }
  }
  if (shortfall > 0) {
    const receivers = Object.keys(chips).filter((id) => chips[id] > 0);
    const totalPositive = receivers.reduce((sum, id) => sum + chips[id], 0);
    let removed = 0;
    for (const id of receivers) {
      const cut = Math.floor((chips[id] / totalPositive) * shortfall);
      chips[id] -= cut;
      removed += cut;
    }
    // 余数从最大受益者身上扣
    let rest = shortfall - removed;
    for (const id of receivers.sort((a, b) => chips[b] - chips[a])) {
      if (rest <= 0) break;
      const cut = Math.min(rest, chips[id]);
      chips[id] -= cut;
      rest -= cut;
    }
  }

  for (const seat of state.seats) {
    const delta = chips[seat.id] ?? 0;
    seat.stack += delta;
    state.stats[seat.id].squidNet += delta;
  }

  const describe = (id: string) => state.seats.find((s) => s.id === id)?.name ?? id;
  state.log.push({
    handNumber: state.handNumber,
    street: 'complete',
    text:
      `第 ${settlement.roundNumber} 轮鱿鱼结算（${settlement.reason === 'lastPlayerStanding' ? '最后一人提前结束' : '鱿鱼发完'}）：` +
      settlement.receivers.map((r) => `${describe(r.playerId)} +${r.amountBB}BB`).join('，') +
      (settlement.payers.length > 0
        ? `；${settlement.payers.map((p) => `${describe(p.playerId)} -${p.amountBB.toFixed(1)}BB`).join('，')}`
        : ''),
    kind: 'squid',
  });

  state.squid = createSquidRound(
    state.seats.map((s) => s.id),
    state.config.squid,
    settlement.roundNumber + 1,
  );
  state.pendingSettlement = null;
  state.phase = 'handComplete';
}

/** 结束当前手，准备下一手（移动庄位）。 */
export function advanceButton(state: SessionState): void {
  const n = state.seats.length;
  for (let step = 1; step <= n; step++) {
    const index = (state.button + step) % n;
    if (state.seats[index].stack > 0) {
      state.button = index;
      break;
    }
  }
  state.hand = null;
  state.phase = 'idle';
}

function syncLog(state: SessionState): void {
  if (!state.hand) return;
  // hand.log 是本手牌的完整日志，只把还没搬运过的部分追加到会话日志
  const handLog = state.hand.log;
  for (let i = state.copiedHandLogCount; i < handLog.length; i++) {
    state.log.push(handLog[i]);
  }
  state.copiedHandLogCount = handLog.length;
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

/** 盈亏（筹码），含鱿鱼结算。 */
export function playerProfit(state: SessionState, seatId: string): number {
  const seat = state.seats.find((s) => s.id === seatId);
  if (!seat) return 0;
  return seat.stack - state.stats[seatId].buyIn;
}
