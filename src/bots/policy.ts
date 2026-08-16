/**
 * 机器人决策核心。
 *
 * 基准策略（gto 档案）遵循几条博弈论原则：
 *   · 翻前按位置划分范围百分位 —— 越靠后位置越宽
 *   · 面对下注时用底池赔率算出「需要多少胜率才值得跟注」
 *   · 主动下注时按 b/(p+2b) 的价值/诈唬配比来决定诈唬频率，
 *     这正是让对手用抓诈牌跟或弃都无所谓的平衡点
 *   · 所有阈值都用平滑过渡而不是硬边界，天然产生混合策略，
 *     所以同样一手牌在同样场景下不一定每次都打得一样
 *
 * 风格档案只是在这些阈值上乘系数，不另写一套逻辑。
 */

import type { Rng } from '../engine/cards';
import {
  type Action,
  type HandState,
  type LegalActions,
  type Seat,
} from '../engine/table';
import { assessHand } from './equity';
import { percentileForScore, preflopScore } from './preflop';
import type { BotProfile } from './profiles';
import type { SquidPressure } from './squidValue';

export interface BotDecisionContext {
  state: HandState;
  legal: LegalActions;
  profile: BotProfile;
  rng: Rng;
  /** 蒙特卡洛迭代次数；调低可以加快机器人思考速度。 */
  iterations?: number;
  /**
   * 鱿鱼压力。不传就是纯扑克机器人 —— 关掉鱿鱼玩法、
   * 或者把机器人的鱿鱼意识调成 0 时就是这种情况。
   */
  squid?: SquidPressure;
}

export interface PolicyOption {
  label: string;
  probability: number;
}

export interface BotDecision {
  action: Action;
  /** 中文说明，界面上可以展开查看机器人为什么这么打。 */
  reason: string;
  equity?: number;
  percentile?: number;
  potOdds?: number;
  /** 鱿鱼压力对这次决策的影响；没有影响时为空。 */
  squidNote?: string;
  policy: PolicyOption[];
}

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

/**
 * 平滑阈值：值越小越「合格」（百分位就是越小越强）。
 * 在阈值处返回 0.5，两侧平滑过渡 —— 这就是混合策略的来源。
 */
function softGate(value: number, threshold: number, width: number): number {
  if (width <= 0) return value <= threshold ? 1 : 0;
  return 1 / (1 + Math.exp((value - threshold) / width));
}

interface Candidate {
  label: string;
  weight: number;
  action: Action;
}

function choose(rng: Rng, candidates: Candidate[]): { chosen: Candidate; policy: PolicyOption[] } {
  const positive = candidates.filter((c) => c.weight > 0);
  const pool = positive.length > 0 ? positive : [candidates[candidates.length - 1]];
  const total = pool.reduce((sum, c) => sum + c.weight, 0);

  const policy = pool.map((c) => ({ label: c.label, probability: c.weight / total }));

  let roll = rng.next() * total;
  for (const candidate of pool) {
    roll -= candidate.weight;
    if (roll <= 0) return { chosen: candidate, policy };
  }
  return { chosen: pool[pool.length - 1], policy };
}

/** 本街还有多少人在我之后行动。 */
function playersBehind(state: HandState): number {
  return state.seats.filter(
    (s, index) =>
      index !== state.actor && s.inHand && !s.folded && !s.allIn && !s.actedThisStreet,
  ).length;
}

/** 本手牌还没弃牌的对手数量。 */
function opponentCount(state: HandState): number {
  return state.seats.filter((s, index) => index !== state.actor && s.inHand && !s.folded).length;
}

/** 把「下注到底池的几分之几」换算成合法的加注金额。 */
function sizeToAmount(
  legal: LegalActions,
  seat: Seat,
  state: HandState,
  fractionOfPot: number,
): number {
  const toCall = Math.max(0, state.currentBet - seat.bet);
  const potAfterCall = legal.potTotal + toCall;
  const target = state.currentBet + Math.round(potAfterCall * fractionOfPot);
  return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, target));
}

/* ------------------------------------------------------------------ */
/* 鱿鱼压力                                                            */
/* ------------------------------------------------------------------ */

/**
 * 翻前算压力时的参照金额（BB）。
 *
 * 翻后可以直接拿鱿鱼奖励和底池比 —— 「我抢的这个底池里有多少是鱿鱼」。
 * 翻前底池只有几个盲注，拿它当分母会把压力放大到离谱，
 * 所以改用「打完一手大致要投入多少」当参照。
 */
const PREFLOP_REFERENCE_BB = 6;

/** 赢下这个底池在鱿鱼上额外值多少筹码。 */
function squidBonus(context: BotDecisionContext): number {
  return Math.max(0, context.squid?.bonusChips ?? 0);
}

/** 把鱿鱼奖励折算成 0~1 的压力值：赢下来的东西里有多大比例是鱿鱼。 */
function pressureFrom(bonus: number, reference: number): number {
  if (bonus <= 0) return 0;
  return bonus / (bonus + Math.max(1, reference));
}

/* ------------------------------------------------------------------ */
/* 翻前                                                                */
/* ------------------------------------------------------------------ */

/** 无人加注时的开池范围（打前百分之几），按身后还有多少人决定。 */
const OPEN_BY_PLAYERS_BEHIND: Record<number, number> = {
  0: 55,
  1: 34, // 小盲对大盲
  2: 40, // 庄位
  3: 28, // CO
  4: 21, // HJ
  5: 16, // UTG（6 人桌）
  6: 14,
  7: 13,
  8: 12,
};

function openThreshold(behind: number, activePlayers: number): number {
  if (activePlayers === 2) return 78; // 单挑要打得极宽
  const key = Math.min(8, behind);
  return OPEN_BY_PLAYERS_BEHIND[key] ?? 12;
}

function decidePreflop(context: BotDecisionContext): BotDecision {
  const { state, legal, profile, rng } = context;
  const seat = state.seats[state.actor];

  const score = preflopScore(seat.hole);
  const percentile = percentileForScore(score);

  const behind = playersBehind(state);
  const active = state.seats.filter((s) => s.inHand && !s.folded).length;
  const toCall = legal.callAmount;
  const potOdds = toCall > 0 ? toCall / (legal.potTotal + toCall) : 0;

  const candidates: Candidate[] = [];
  let reason: string;

  const faced = state.raisesThisStreet;
  const inPosition = behind === 0;

  // 鱿鱼压力：本轮还没拿到鱿鱼、又快发完了，就必须多进池去抢一手
  const pressure = pressureFrom(squidBonus(context), PREFLOP_REFERENCE_BB * state.config.bigBlind);
  const loosen = 1 + 0.9 * pressure;

  if (faced === 0) {
    /* --- 无人加注：开池 / 跛入 / 弃牌 --- */
    const threshold = openThreshold(behind, active) * profile.openRange * loosen;
    const raiseProb = softGate(percentile, threshold, threshold * 0.22 + 2);

    const raiseTo = sizeToAmount(legal, seat, state, 0.85 * profile.sizing);
    if (legal.canRaise || legal.canBet) {
      candidates.push({
        label: `加注到 ${(raiseTo / state.config.bigBlind).toFixed(1)}BB`,
        weight: raiseProb * profile.aggression,
        action: { type: legal.canBet ? 'bet' : 'raise', amount: raiseTo },
      });
    }

    if (legal.canCheck) {
      candidates.push({ label: '过牌', weight: 1 - raiseProb, action: { type: 'check' } });
      reason = `翻前无人加注，起手牌排名前 ${percentile.toFixed(0)}%，开池门槛前 ${threshold.toFixed(0)}%`;
    } else {
      // 面对大盲（或有人跛入），可以跟注进池。
      // 基准策略里跛入很少 —— 现代 PLO 理论认为有牌就该加注，
      // 跛入主要留给「跛入鱼」「跟注站」这类档案（limpiness 高）。
      const limpThreshold = threshold * 1.15 * profile.limpiness;
      const callProb = softGate(percentile, limpThreshold, limpThreshold * 0.25 + 3);
      candidates.push({
        label: '跟注',
        weight: Math.max(0, callProb - raiseProb) * 0.75,
        action: { type: 'call' },
      });
      candidates.push({ label: '弃牌', weight: 1 - Math.max(raiseProb, callProb), action: { type: 'fold' } });
      reason = `翻前无人加注，起手牌前 ${percentile.toFixed(0)}%，开池门槛前 ${threshold.toFixed(0)}%`;
    }
  } else {
    /* --- 面对加注：3bet / 跟注 / 弃牌 --- */
    const reraiseBase = faced === 1 ? 7 : faced === 2 ? 3 : 1.8;
    // 抢鱿鱼主要靠多进池，不靠拿垃圾牌去 3bet，所以再加注只放宽一半
    const reraiseThreshold = reraiseBase * profile.threeBet * (1 + 0.45 * pressure);

    const baseCall = faced === 1 ? (inPosition ? 24 : 17) : inPosition ? 11 : 8;
    // 大盲已经投入了盲注，可以防守得更宽
    const isBigBlind = seat.bet >= state.config.bigBlind && faced === 1;
    const callThreshold = (baseCall + (isBigBlind ? 11 : 0)) * profile.callRange * loosen;

    const reraiseProb = softGate(percentile, reraiseThreshold, reraiseThreshold * 0.3 + 1.2);
    const callProb = softGate(percentile, callThreshold, callThreshold * 0.25 + 2);

    if (legal.canRaise) {
      const raiseTo = sizeToAmount(legal, seat, state, 0.8 * profile.sizing);
      candidates.push({
        label: `${faced === 1 ? '3bet' : '再加注'}到 ${(raiseTo / state.config.bigBlind).toFixed(1)}BB`,
        weight: reraiseProb * profile.aggression,
        action: { type: 'raise', amount: raiseTo },
      });
    }

    if (legal.canCall) {
      candidates.push({
        label: '跟注',
        weight: Math.max(0, callProb - reraiseProb * 0.8),
        action: { type: 'call' },
      });
    }
    if (legal.canCheck) {
      candidates.push({ label: '过牌', weight: 1 - reraiseProb, action: { type: 'check' } });
    } else {
      candidates.push({ label: '弃牌', weight: Math.max(0, 1 - callProb), action: { type: 'fold' } });
    }

    reason =
      `面对${faced === 1 ? '开池加注' : `${faced} 次加注`}，起手牌前 ${percentile.toFixed(0)}%，` +
      `跟注门槛前 ${callThreshold.toFixed(0)}%，再加注门槛前 ${reraiseThreshold.toFixed(0)}%`;
  }

  addNoise(candidates, profile.randomness, rng);
  const { chosen, policy } = choose(rng, candidates);
  return { action: chosen.action, reason, percentile, potOdds, policy };
}

/* ------------------------------------------------------------------ */
/* 翻后                                                                */
/* ------------------------------------------------------------------ */

function decidePostflop(context: BotDecisionContext): BotDecision {
  const { state, legal, profile, rng } = context;
  const seat = state.seats[state.actor];
  const opponents = opponentCount(state);
  const iterations = context.iterations ?? 260;

  const strength = assessHand(seat.hole, state.board, Math.max(1, opponents), rng, iterations);
  const equity = strength.equity;

  const toCall = legal.callAmount;
  const potOdds = toCall > 0 ? toCall / (legal.potTotal + toCall) : 0;
  const behind = playersBehind(state);

  /* --- 鱿鱼压力 --- */
  // 这个底池除了筹码，还附带鱿鱼的边际价值。既然「赢下底池」本身更值钱了，
  // 那跟注该更松（赔率里多一块奖励）、把底池直接抢下来也更划算（诈唬更值）。
  const bonus = squidBonus(context);
  const pressure = pressureFrom(bonus, legal.potTotal);
  const bluffBoost = 1 + 0.8 * pressure;

  // 人越多，想赢下底池需要的牌力就越高
  const multiwayShift = 0.085 * (opponents - 1);
  const valueThreshold = Math.min(0.9, 0.55 + multiwayShift) * (1 - 0.12 * pressure);
  const raiseThreshold = Math.min(0.93, 0.63 + multiwayShift) * (1 - 0.12 * pressure);

  const candidates: Candidate[] = [];
  let reason: string;

  if (toCall > 0) {
    /* --- 面对下注 --- */
    // 需要的胜率就是底池赔率；鱿鱼奖励算作底池的一部分，跟注门槛因此降低。
    // 跟注站会用比这更差的牌跟
    const effectivePotOdds = toCall / (legal.potTotal + toCall + bonus);
    const requiredEquity = (effectivePotOdds * 1.04) / profile.callDown;

    const raiseProb = softGate(-equity, -raiseThreshold, 0.07) * profile.aggression;
    const callProb = softGate(-equity, -requiredEquity, 0.045);

    // 半诈唬加注：胜率不够但有听牌潜力，靠弃牌率盈利
    const drawish = equity > requiredEquity * 0.72 && equity < raiseThreshold;
    const bluffRaiseProb = drawish
      ? 0.16 * profile.bluff * bluffBoost * (behind === 0 ? 1.25 : 0.7)
      : 0;

    if (legal.canRaise) {
      const raiseTo = sizeToAmount(legal, seat, state, 0.75 * profile.sizing);
      candidates.push({
        label: `加注到 ${(raiseTo / state.config.bigBlind).toFixed(1)}BB`,
        weight: raiseProb + bluffRaiseProb,
        action: { type: 'raise', amount: raiseTo },
      });
    }
    if (legal.canCall) {
      candidates.push({ label: '跟注', weight: callProb, action: { type: 'call' } });
    }
    candidates.push({ label: '弃牌', weight: Math.max(0, 1 - callProb), action: { type: 'fold' } });

    reason =
      `胜率约 ${(equity * 100).toFixed(0)}%，底池赔率要求 ${(potOdds * 100).toFixed(0)}%` +
      (bonus > 0 ? `（算进鱿鱼后只要 ${(effectivePotOdds * 100).toFixed(0)}%）` : '') +
      `，${equity >= requiredEquity ? '值得跟注' : '不够跟注'}`;
  } else {
    /* --- 无人下注：下注 / 过牌 --- */
    const betFraction = (equity > valueThreshold ? 0.72 : 0.6) * profile.sizing;
    const betTo = sizeToAmount(legal, seat, state, betFraction);
    const betSize = betTo - seat.bet;

    // 平衡诈唬比例：对手用抓诈牌跟注恰好不赚不亏的点
    const balancedBluffRatio = betSize / (legal.potTotal + 2 * betSize);
    const valueProb = softGate(-equity, -valueThreshold, 0.06) * profile.aggression;

    // 诈唬优先选有潜力的牌（半诈唬），纯没戏的牌少诈唬
    const bluffCandidate = equity < valueThreshold && equity > 0.16;
    const bluffProb = bluffCandidate
      ? balancedBluffRatio *
        profile.bluff *
        bluffBoost *
        (behind === 0 ? 1.15 : 0.75) *
        (opponents > 1 ? 0.5 : 1)
      : 0;

    if (legal.canBet || legal.canRaise) {
      candidates.push({
        label: `下注 ${(betSize / state.config.bigBlind).toFixed(1)}BB`,
        weight: valueProb + bluffProb,
        action: { type: legal.canBet ? 'bet' : 'raise', amount: betTo },
      });
    }
    if (legal.canCheck) {
      candidates.push({
        label: '过牌',
        weight: Math.max(0.05, 1 - valueProb - bluffProb),
        action: { type: 'check' },
      });
    }

    reason =
      `胜率约 ${(equity * 100).toFixed(0)}%，价值下注门槛 ${(valueThreshold * 100).toFixed(0)}%，` +
      `平衡诈唬比例 ${(balancedBluffRatio * 100).toFixed(0)}%`;
  }

  addNoise(candidates, profile.randomness, rng);
  const { chosen, policy } = choose(rng, candidates);
  return { action: chosen.action, reason, equity, potOdds, policy };
}

/** 给各选项加一点噪声，模拟真人的不一致性。 */
function addNoise(candidates: Candidate[], randomness: number, rng: Rng): void {
  if (randomness <= 0) return;
  for (const candidate of candidates) {
    candidate.weight = Math.max(0, candidate.weight + (rng.next() - 0.5) * randomness);
  }
}

/* ------------------------------------------------------------------ */

export function decide(context: BotDecisionContext): BotDecision {
  const base =
    context.state.street === 'preflop' ? decidePreflop(context) : decidePostflop(context);
  const note = context.squid?.note;
  const decision: BotDecision = note ? { ...base, squidNote: note } : base;

  // 兜底：万一权重全被噪声清零，退回一个必定合法的动作
  const legal = context.legal;
  const action = decision.action;
  if (action.type === 'check' && !legal.canCheck) {
    return { ...decision, action: { type: legal.canCall ? 'call' : 'fold' } };
  }
  if (action.type === 'call' && !legal.canCall) {
    return { ...decision, action: { type: legal.canCheck ? 'check' : 'fold' } };
  }
  if ((action.type === 'bet' || action.type === 'raise') && !legal.canBet && !legal.canRaise) {
    return { ...decision, action: { type: legal.canCheck ? 'check' : legal.canCall ? 'call' : 'fold' } };
  }
  return decision;
}
