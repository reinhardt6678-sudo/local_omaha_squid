/**
 * 奥马哈（PLO，底池限注）一手牌的状态机。
 *
 * 设计成纯函数：applyAction(state, action) 返回新的 state，
 * 因此机器人、界面和测试可以用完全相同的接口驱动牌局。
 */

import { shuffledDeck, type Card, type Rng } from './cards';
import { bestOmahaCards, evaluateOmaha } from './evaluator';
import { awardPot, buildPots, uncalledBet, type PotAward, type PotContributor } from './pots';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export const STREET_NAMES_CN: Record<Street, string> = {
  preflop: '翻前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  complete: '结束',
};

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export const ACTION_NAMES_CN: Record<ActionType, string> = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  bet: '下注',
  raise: '加注',
};

export interface Action {
  type: ActionType;
  /** bet / raise 时表示「加注到」的本街累计总额。 */
  amount?: number;
}

export interface TableConfig {
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  /** 每张底牌数量，PLO4 为 4。 */
  holeCards: number;
}

export const DEFAULT_TABLE_CONFIG: TableConfig = {
  smallBlind: 50,
  bigBlind: 100,
  startingStack: 10000,
  holeCards: 4,
};

export interface Seat {
  id: string;
  name: string;
  isHuman: boolean;
  profileId: string;
  stack: number;
  hole: Card[];
  /** 本手是否参与发牌。 */
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** 本条街已投入。 */
  bet: number;
  /** 本手牌累计投入。 */
  committed: number;
  /** 本条街是否已行动过。 */
  actedThisStreet: boolean;
  lastAction: { type: ActionType; amount: number } | null;
}

export interface LogEntry {
  handNumber: number;
  street: Street;
  text: string;
  kind: 'action' | 'deal' | 'result' | 'squid' | 'info';
}

export interface HandResult {
  pots: PotAward[];
  /** 主池赢家 —— 决定鱿鱼归谁。 */
  mainPotWinners: string[];
  /** 是否走到摊牌。 */
  showdown: boolean;
  /** 摊牌玩家的牌力分值。 */
  scores: Record<string, number>;
  /** 组成最佳牌型的五张牌。 */
  bestCards: Record<string, Card[]>;
  /** 每位玩家本手净输赢筹码。 */
  netChips: Record<string, number>;
  /** 需要亮牌展示的玩家。 */
  revealed: string[];
}

export interface HandState {
  handNumber: number;
  seats: Seat[];
  button: number;
  street: Street;
  board: Card[];
  deck: Card[];
  deckIndex: number;
  /** 已经收进池子的筹码（不含本街正在下的注）。 */
  pot: number;
  currentBet: number;
  minRaiseIncrement: number;
  /** 最近一次「完整加注」的加注到金额，用于判断是否重新开放加注权。 */
  lastFullRaiseTo: number;
  /** 本条街已经发生过多少次下注/加注（翻前大盲不计）。 */
  raisesThisStreet: number;
  actor: number;
  config: TableConfig;
  log: LogEntry[];
  result: HandResult | null;
  /** 本手投入的初始筹码快照，用于计算净输赢。 */
  startingStacks: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* 座位查询辅助                                                        */
/* ------------------------------------------------------------------ */

export function contenders(state: HandState): Seat[] {
  return state.seats.filter((s) => s.inHand && !s.folded);
}

export function actableSeats(state: HandState): Seat[] {
  return state.seats.filter((s) => s.inHand && !s.folded && !s.allIn);
}

function nextOccupiedIndex(state: HandState, from: number, predicate: (s: Seat) => boolean): number {
  const n = state.seats.length;
  for (let step = 1; step <= n; step++) {
    const index = (from + step) % n;
    if (predicate(state.seats[index])) return index;
  }
  return -1;
}

/** 从庄位左手开始的玩家顺序，用于奇数筹码分配。 */
export function orderFromButton(state: HandState): string[] {
  const n = state.seats.length;
  const out: string[] = [];
  for (let step = 1; step <= n; step++) {
    out.push(state.seats[(state.button + step) % n].id);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 开始一手牌                                                          */
/* ------------------------------------------------------------------ */

export interface StartHandOptions {
  seats: Seat[];
  button: number;
  config: TableConfig;
  rng: Rng;
  handNumber: number;
}

export function startHand({ seats, button, config, rng, handNumber }: StartHandOptions): HandState {
  const deck = shuffledDeck(rng);
  const startingStacks: Record<string, number> = {};

  const prepared: Seat[] = seats.map((seat) => {
    startingStacks[seat.id] = seat.stack;
    return {
      ...seat,
      hole: [],
      inHand: seat.stack > 0,
      folded: false,
      allIn: false,
      bet: 0,
      committed: 0,
      actedThisStreet: false,
      lastAction: null,
    };
  });

  let state: HandState = {
    handNumber,
    seats: prepared,
    button,
    street: 'preflop',
    board: [],
    deck,
    deckIndex: 0,
    pot: 0,
    currentBet: 0,
    minRaiseIncrement: config.bigBlind,
    lastFullRaiseTo: config.bigBlind,
    raisesThisStreet: 0,
    actor: -1,
    config,
    log: [],
    result: null,
    startingStacks,
  };

  // 发底牌
  for (let round = 0; round < config.holeCards; round++) {
    for (let step = 1; step <= state.seats.length; step++) {
      const seat = state.seats[(button + step) % state.seats.length];
      if (seat.inHand) seat.hole.push(state.deck[state.deckIndex++]);
    }
  }

  state = postBlinds(state);
  state = pushLog(state, 'deal', `第 ${handNumber} 手开始，庄位：${state.seats[button].name}`);
  return state;
}

function postBlinds(state: HandState): HandState {
  const playing = state.seats.filter((s) => s.inHand);
  const headsUp = playing.length === 2;

  let sbIndex: number;
  let bbIndex: number;

  if (headsUp) {
    // 单挑：庄家下小盲，翻前先行动
    sbIndex = state.seats[state.button].inHand
      ? state.button
      : nextOccupiedIndex(state, state.button, (s) => s.inHand);
    bbIndex = nextOccupiedIndex(state, sbIndex, (s) => s.inHand);
  } else {
    sbIndex = nextOccupiedIndex(state, state.button, (s) => s.inHand);
    bbIndex = nextOccupiedIndex(state, sbIndex, (s) => s.inHand);
  }

  postBlind(state.seats[sbIndex], state.config.smallBlind);
  postBlind(state.seats[bbIndex], state.config.bigBlind);

  state.currentBet = state.config.bigBlind;
  state.minRaiseIncrement = state.config.bigBlind;
  state.lastFullRaiseTo = state.config.bigBlind;

  // 翻前从大盲左手第一位开始（单挑时是小盲/庄家）
  state.actor = headsUp ? sbIndex : nextOccupiedIndex(state, bbIndex, canActNow);

  return state;
}

function postBlind(seat: Seat, amount: number): void {
  const paid = Math.min(amount, seat.stack);
  seat.stack -= paid;
  seat.bet = paid;
  seat.committed = paid;
  if (seat.stack === 0) seat.allIn = true;
}

function canActNow(seat: Seat): boolean {
  return seat.inHand && !seat.folded && !seat.allIn;
}

/* ------------------------------------------------------------------ */
/* 合法动作                                                            */
/* ------------------------------------------------------------------ */

export interface LegalActions {
  seatIndex: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** 跟注需要补的筹码（可能因筹码不足而小于差额）。 */
  callAmount: number;
  /** 是否可以下注（当前无人下注）。 */
  canBet: boolean;
  /** 是否可以加注。 */
  canRaise: boolean;
  /** 「下注/加注到」的最小值。 */
  minRaiseTo: number;
  /** 「下注/加注到」的最大值（底池限注 + 筹码上限）。 */
  maxRaiseTo: number;
  /** 当前底池总额（含本街已下注），用于界面显示。 */
  potTotal: number;
}

export function legalActions(state: HandState): LegalActions | null {
  if (state.actor < 0 || state.street === 'complete' || state.street === 'showdown') return null;
  const seat = state.seats[state.actor];
  if (!canActNow(seat)) return null;

  const potTotal = state.pot + state.seats.reduce((sum, s) => sum + s.bet, 0);
  const toCall = Math.max(0, state.currentBet - seat.bet);
  const callAmount = Math.min(toCall, seat.stack);

  // 需不需要补钱决定能否过牌；场上有没有下注决定这是「下注」还是「加注」。
  // 大盲的选择权就属于「不用补钱、但只能加注」的情况。
  const facingBet = toCall > 0;
  const betExists = state.currentBet > 0;
  const maxByStack = seat.bet + seat.stack;

  // 底池限注：加注到 = 当前下注额 + （底池 + 需要跟的注）
  const potLimitRaiseTo = state.currentBet + potTotal + toCall;
  const maxRaiseTo = Math.min(potLimitRaiseTo, maxByStack);

  const rawMinRaiseTo = betExists
    ? state.currentBet + state.minRaiseIncrement
    : Math.min(state.config.bigBlind, maxByStack);
  const minRaiseTo = Math.min(rawMinRaiseTo, maxRaiseTo);

  // 完整加注才重新开放加注权
  const raiseRightOpen = !seat.actedThisStreet || seat.bet < state.lastFullRaiseTo;
  const hasChipsToRaise = maxByStack > state.currentBet;

  return {
    seatIndex: state.actor,
    canFold: true,
    canCheck: !facingBet,
    canCall: facingBet && seat.stack > 0,
    callAmount,
    canBet: !betExists && hasChipsToRaise,
    canRaise: betExists && hasChipsToRaise && raiseRightOpen,
    minRaiseTo,
    maxRaiseTo,
    potTotal,
  };
}

/* ------------------------------------------------------------------ */
/* 执行动作                                                            */
/* ------------------------------------------------------------------ */

export function applyAction(state: HandState, action: Action): HandState {
  const legal = legalActions(state);
  if (!legal) throw new Error('当前没有可行动的玩家');

  const next = cloneState(state);
  const seat = next.seats[next.actor];
  const previousCurrentBet = next.currentBet;

  switch (action.type) {
    case 'fold': {
      seat.folded = true;
      seat.actedThisStreet = true;
      seat.lastAction = { type: 'fold', amount: 0 };
      break;
    }
    case 'check': {
      if (!legal.canCheck) throw new Error('不能过牌：面对下注');
      seat.actedThisStreet = true;
      seat.lastAction = { type: 'check', amount: 0 };
      break;
    }
    case 'call': {
      const paid = Math.min(Math.max(0, next.currentBet - seat.bet), seat.stack);
      seat.stack -= paid;
      seat.bet += paid;
      seat.committed += paid;
      if (seat.stack === 0) seat.allIn = true;
      seat.actedThisStreet = true;
      seat.lastAction = { type: 'call', amount: paid };
      break;
    }
    case 'bet':
    case 'raise': {
      const requested = action.amount ?? legal.minRaiseTo;
      const raiseTo = clamp(requested, legal.minRaiseTo, legal.maxRaiseTo);
      const delta = raiseTo - seat.bet;
      if (delta <= 0) throw new Error('加注金额必须高于已下注额');

      const paid = Math.min(delta, seat.stack);
      seat.stack -= paid;
      seat.bet += paid;
      seat.committed += paid;
      if (seat.stack === 0) seat.allIn = true;

      const newLevel = seat.bet;
      const increment = newLevel - previousCurrentBet;
      next.currentBet = Math.max(next.currentBet, newLevel);

      if (increment >= next.minRaiseIncrement) {
        // 完整加注：更新最小加注幅度，并重新开放所有人的加注权
        next.minRaiseIncrement = increment;
        next.lastFullRaiseTo = newLevel;
        for (const other of next.seats) {
          if (other.id !== seat.id && canActNow(other)) other.actedThisStreet = false;
        }
      } else {
        // 筹码不足的短加注：其他人需要补齐，但不能再加注
        for (const other of next.seats) {
          if (other.id !== seat.id && canActNow(other) && other.bet < next.currentBet) {
            other.actedThisStreet = false;
          }
        }
      }

      seat.actedThisStreet = true;
      seat.lastAction = { type: action.type, amount: seat.bet };
      next.raisesThisStreet += 1;
      break;
    }
  }

  logAction(next, seat, action);
  return advance(next);
}

function logAction(state: HandState, seat: Seat, action: Action): void {
  const bb = state.config.bigBlind;
  const fmt = (chips: number) => `${(chips / bb).toFixed(chips % bb === 0 ? 0 : 1)}BB`;
  let text: string;
  switch (action.type) {
    case 'fold':
      text = `${seat.name} 弃牌`;
      break;
    case 'check':
      text = `${seat.name} 过牌`;
      break;
    case 'call':
      text = `${seat.name} 跟注 ${fmt(seat.lastAction?.amount ?? 0)}${seat.allIn ? '（全下）' : ''}`;
      break;
    default:
      text = `${seat.name} ${action.type === 'bet' ? '下注' : '加注'}到 ${fmt(seat.bet)}${seat.allIn ? '（全下）' : ''}`;
  }
  state.log.push({ handNumber: state.handNumber, street: state.street, text, kind: 'action' });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cloneState(state: HandState): HandState {
  return {
    ...state,
    seats: state.seats.map((s) => ({ ...s, hole: [...s.hole], lastAction: s.lastAction ? { ...s.lastAction } : null })),
    board: [...state.board],
    log: [...state.log],
  };
}

/* ------------------------------------------------------------------ */
/* 推进牌局                                                            */
/* ------------------------------------------------------------------ */

function bettingComplete(state: HandState): boolean {
  const live = contenders(state);
  if (live.length <= 1) return true;
  const canAct = live.filter((s) => !s.allIn);
  if (canAct.length === 0) return true;
  return canAct.every((s) => s.actedThisStreet && s.bet === state.currentBet);
}

function advance(state: HandState): HandState {
  // 只剩一人 —— 直接结束
  if (contenders(state).length <= 1) {
    return finishHand(state, false);
  }

  if (!bettingComplete(state)) {
    const next = nextOccupiedIndex(state, state.actor, (s) => canActNow(s) && needsToAct(state, s));
    if (next >= 0) {
      state.actor = next;
      return state;
    }
  }

  return closeStreet(state);
}

function needsToAct(state: HandState, seat: Seat): boolean {
  return !seat.actedThisStreet || seat.bet < state.currentBet;
}

function collectBets(state: HandState): void {
  for (const seat of state.seats) {
    state.pot += seat.bet;
    seat.bet = 0;
    seat.actedThisStreet = false;
  }
  state.currentBet = 0;
  state.minRaiseIncrement = state.config.bigBlind;
  state.lastFullRaiseTo = 0;
  state.raisesThisStreet = 0;
}

function closeStreet(state: HandState): HandState {
  collectBets(state);

  const nextStreet: Record<string, Street> = {
    preflop: 'flop',
    flop: 'turn',
    turn: 'river',
    river: 'showdown',
  };

  const upcoming = nextStreet[state.street];
  if (!upcoming || upcoming === 'showdown') {
    return finishHand(state, true);
  }

  state.street = upcoming;
  dealStreet(state);

  // 所有人都全下了 —— 直接发完剩余公共牌
  const canAct = contenders(state).filter((s) => !s.allIn);
  if (canAct.length <= 1) {
    while (state.street !== 'river') {
      state.street = nextStreet[state.street];
      dealStreet(state);
    }
    return finishHand(state, true);
  }

  // 翻后从庄位左手第一位开始
  state.actor = nextOccupiedIndex(state, state.button, canActNow);
  return state;
}

function dealStreet(state: HandState): void {
  const count = state.street === 'flop' ? 3 : 1;
  for (let i = 0; i < count; i++) state.board.push(state.deck[state.deckIndex++]);
  const shown = state.board.map((c) => c).slice(-count);
  state.log.push({
    handNumber: state.handNumber,
    street: state.street,
    text: `${STREET_NAMES_CN[state.street]}：${shown.length} 张公共牌`,
    kind: 'deal',
  });
}

/* ------------------------------------------------------------------ */
/* 结算                                                                */
/* ------------------------------------------------------------------ */

function finishHand(state: HandState, wentToShowdown: boolean): HandState {
  collectBets(state);

  const live = contenders(state);
  const contributors: PotContributor[] = state.seats
    .filter((s) => s.inHand)
    .map((s) => ({ id: s.id, committed: s.committed, folded: s.folded }));

  // 退还无人跟注的多余下注
  const refund = uncalledBet(contributors);
  if (refund.playerId && refund.amount > 0) {
    const seat = state.seats.find((s) => s.id === refund.playerId)!;
    seat.stack += refund.amount;
    seat.committed -= refund.amount;
    state.pot -= refund.amount;
    const entry = contributors.find((c) => c.id === refund.playerId)!;
    entry.committed -= refund.amount;
    if (refund.amount > 0) {
      state.log.push({
        handNumber: state.handNumber,
        street: state.street,
        text: `退还 ${seat.name} 未被跟注的 ${(refund.amount / state.config.bigBlind).toFixed(1)}BB`,
        kind: 'info',
      });
    }
  }

  const scores: Record<string, number> = {};
  const bestCards: Record<string, Card[]> = {};
  const showdown = wentToShowdown && live.length > 1 && state.board.length === 5;

  if (showdown) {
    for (const seat of live) {
      const best = bestOmahaCards(seat.hole, state.board);
      scores[seat.id] = best.score;
      bestCards[seat.id] = best.cards;
    }
  } else {
    // 未摊牌：唯一剩下的人赢
    for (const seat of live) scores[seat.id] = 1;
  }

  const pots = buildPots(contributors);
  const order = orderFromButton(state);
  const awards = pots.map((pot) => awardPot(pot, scores, order));

  for (const award of awards) {
    for (const [id, amount] of Object.entries(award.shares)) {
      const seat = state.seats.find((s) => s.id === id)!;
      seat.stack += amount;
    }
  }

  const netChips: Record<string, number> = {};
  for (const seat of state.seats) {
    netChips[seat.id] = seat.stack - (state.startingStacks[seat.id] ?? seat.stack);
  }

  const mainPotWinners = awards.length > 0 ? awards[0].winners : live.map((s) => s.id);

  state.result = {
    pots: awards,
    mainPotWinners,
    showdown,
    scores,
    bestCards,
    netChips,
    revealed: showdown ? live.map((s) => s.id) : [],
  };
  state.street = 'complete';
  state.actor = -1;
  state.pot = 0;

  return state;
}

/** 便于测试：直接跑完一手牌，用回调决定每一步动作。 */
export function playOut(state: HandState, decide: (s: HandState, legal: LegalActions) => Action): HandState {
  let current = state;
  let guard = 0;
  while (current.street !== 'complete' && guard++ < 500) {
    const legal = legalActions(current);
    if (!legal) break;
    current = applyAction(current, decide(current, legal));
  }
  return current;
}

function pushLog(state: HandState, kind: LogEntry['kind'], text: string): HandState {
  state.log.push({ handNumber: state.handNumber, street: state.street, text, kind });
  return state;
}

/** 创建一个座位。 */
export function createSeat(
  id: string,
  name: string,
  stack: number,
  options: { isHuman?: boolean; profileId?: string } = {},
): Seat {
  return {
    id,
    name,
    isHuman: options.isHuman ?? false,
    profileId: options.profileId ?? 'gto',
    stack,
    hole: [],
    inHand: false,
    folded: false,
    allIn: false,
    bet: 0,
    committed: 0,
    actedThisStreet: false,
    lastAction: null,
  };
}

/** 牌桌位置名称（相对庄位）。 */
export function positionName(state: HandState, seatIndex: number): string {
  const playing = state.seats.filter((s) => s.inHand).length;
  const distance = (seatIndex - state.button + state.seats.length) % state.seats.length;
  if (playing === 2) return distance === 0 ? 'BTN/SB' : 'BB';
  const names: Record<number, string> = { 0: 'BTN', 1: 'SB', 2: 'BB', 3: 'UTG' };
  if (names[distance]) return names[distance];
  if (distance === playing - 1) return 'CO';
  if (distance === playing - 2) return 'HJ';
  return `MP${distance - 3}`;
}

export { evaluateOmaha };
