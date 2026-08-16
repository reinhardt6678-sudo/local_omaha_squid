import { describe, expect, it } from 'vitest';
import { createRng } from '../engine/cards';
import {
  createSquidRound,
  DEFAULT_SQUID_CONFIG,
  type SquidConfig,
  type SquidState,
} from '../engine/squid';
import {
  applyAction,
  createSeat,
  legalActions,
  startHand,
  DEFAULT_TABLE_CONFIG,
  type Seat,
} from '../engine/table';
import { decide } from './policy';
import { getProfile } from './profiles';
import { squidPressure, type SquidPressure } from './squidValue';

const BB = DEFAULT_TABLE_CONFIG.bigBlind;

/** 造一个指定持有情况的鱿鱼局面。 */
function roundWith(
  holdings: Record<string, number>,
  config: SquidConfig = DEFAULT_SQUID_CONFIG,
): SquidState {
  const ids = Object.keys(holdings);
  const state = createSquidRound(ids, config, 1);
  const distributed = Object.values(holdings).reduce((a, b) => a + b, 0);
  return { ...state, holdings: { ...holdings }, remaining: state.total - distributed };
}

function pressureFor(
  squid: SquidState,
  playerId: string,
  awareness = 1,
  config: SquidConfig = DEFAULT_SQUID_CONFIG,
): SquidPressure {
  return squidPressure({ squid, config, playerId, bigBlindChips: BB, awareness });
}

describe('鱿鱼压力', () => {
  it('意识为 0 时没有任何压力', () => {
    const squid = roundWith({ a: 4, b: 3, c: 1, d: 0, e: 0, f: 0 });
    expect(pressureFor(squid, 'd', 0).bonusChips).toBe(0);
  });

  it('本轮刚开始时压力很小，快发完时压力很大', () => {
    const start = pressureFor(roundWith({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }), 'd');
    const late = pressureFor(roundWith({ a: 4, b: 3, c: 1, d: 0, e: 0, f: 0 }), 'd');

    expect(start.urgency).toBeLessThan(0.3);
    expect(late.urgency).toBe(1); // 剩下的鱿鱼这手就能发完
    expect(late.bonusBB).toBeGreaterThan(start.bonusBB * 10);
  });

  it('一条没拿的人，赢下这手同时省掉买单又变成收钱的', () => {
    // 6 人桌 9 条：A4 B3 C1，剩 1 条，D/E/F 空手
    const squid = roundWith({ a: 4, b: 3, c: 1, d: 0, e: 0, f: 0 });

    // 不赢：和 E、F 平摊 30BB → −10BB；赢下：变成收 2BB
    expect(pressureFor(squid, 'd').marginalBB).toBeCloseTo(12, 5);
  });

  it('跨过翻倍档位时边际价值明显更高', () => {
    // 1 → 2 条不跨档；2 → 3 条跨过 ×2
    const noJump = pressureFor(roundWith({ me: 1, x: 4, y: 0, z: 0 }), 'me');
    const jump = pressureFor(roundWith({ me: 2, x: 4, y: 0, z: 0 }), 'me');

    expect(noJump.marginalBB).toBeCloseTo(2, 5);
    expect(jump.marginalBB).toBeCloseTo(8, 5);
  });

  it('只剩两人没鱿鱼时紧迫度拉满 —— 谁先拿到，另一个就独自买单', () => {
    const squid = roundWith({ me: 0, y: 0, x: 3, z: 2 });
    expect(pressureFor(squid, 'me').urgency).toBeGreaterThanOrEqual(0.9);

    // 关掉提前结束就没有这个「决胜局」效应
    const relaxed: SquidConfig = { ...DEFAULT_SQUID_CONFIG, endWhenOnePlayerLeft: false };
    expect(pressureFor(roundWith({ me: 0, y: 0, x: 3, z: 2 }, relaxed), 'me', 1, relaxed).urgency)
      .toBeLessThan(0.9);
  });

  it('边际价值永远非负，且按意识线性缩放', () => {
    const squid = roundWith({ a: 4, b: 3, c: 1, d: 0, e: 0, f: 0 });
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(pressureFor(squid, id).marginalBB).toBeGreaterThanOrEqual(0);
    }
    expect(pressureFor(squid, 'd', 0.5).bonusBB).toBeCloseTo(pressureFor(squid, 'd').bonusBB / 2, 6);
    expect(pressureFor(squid, 'd').bonusChips).toBeCloseTo(pressureFor(squid, 'd').bonusBB * BB, 6);
  });

  it('平分底池累积时，赢家一次拿走多条，价值更高', () => {
    const base = roundWith({ a: 3, b: 1, me: 0, z: 0 });
    const carried = { ...base, pending: 2 };
    expect(pressureFor(carried, 'me').marginalBB).toBeGreaterThan(
      pressureFor(base, 'me').marginalBB,
    );
  });

  it('不在这一局里的玩家不会算出压力', () => {
    expect(pressureFor(roundWith({ a: 1, b: 0 }), '查无此人').bonusChips).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe('鱿鱼压力对决策的影响', () => {
  function makeSeats(count: number): Seat[] {
    return Array.from({ length: count }, (_, i) =>
      createSeat(`p${i}`, `玩家${i}`, 10000, { profileId: 'gto' }),
    );
  }

  /**
   * 同一批牌、同一个随机种子下的翻前弃牌率。
   *
   * 翻前不跑蒙特卡洛，候选动作数量也和压力无关，
   * 所以两次运行消耗的随机数完全一样 —— 拿到的手牌是同一批，可以直接比。
   */
  function preflopFoldRate(squid?: SquidPressure): number {
    const rng = createRng(777);
    const seats = makeSeats(6);
    let folds = 0;
    let total = 0;

    for (let hand = 0; hand < 150; hand++) {
      const state = startHand({
        seats,
        button: hand % 6,
        config: DEFAULT_TABLE_CONFIG,
        rng,
        handNumber: hand + 1,
      });
      const legal = legalActions(state);
      if (!legal) continue;

      const decision = decide({ state, legal, profile: getProfile('gto'), rng, squid });
      if (decision.action.type === 'fold') folds += 1;
      total += 1;
    }

    return folds / total;
  }

  it('有鱿鱼压力时进池明显更多', () => {
    const squid = pressureFor(roundWith({ a: 4, b: 3, c: 1, d: 0, e: 0, f: 0 }), 'd');
    expect(squid.bonusBB).toBeGreaterThan(0);

    const relaxed = preflopFoldRate();
    const pressured = preflopFoldRate(squid);

    expect(pressured).toBeLessThan(relaxed);
  });

  it('带着鱿鱼压力也只会给出合法动作', () => {
    const rng = createRng(2024);
    const squid = pressureFor(roundWith({ a: 4, b: 3, c: 1, d: 0, e: 0, f: 0 }), 'd');
    let seats = makeSeats(6);

    for (let hand = 0; hand < 30; hand++) {
      let state = startHand({
        seats,
        button: hand % 6,
        config: DEFAULT_TABLE_CONFIG,
        rng,
        handNumber: hand + 1,
      });

      let guard = 0;
      while (state.street !== 'complete' && guard++ < 300) {
        const legal = legalActions(state);
        if (!legal) break;

        const decision = decide({
          state,
          legal,
          profile: getProfile('gto'),
          rng,
          iterations: 30,
          squid,
        });
        const { action } = decision;

        if (action.type === 'check') expect(legal.canCheck).toBe(true);
        if (action.type === 'call') expect(legal.canCall).toBe(true);
        if (action.type === 'bet') expect(legal.canBet).toBe(true);
        if (action.type === 'raise') expect(legal.canRaise).toBe(true);
        if (action.type === 'bet' || action.type === 'raise') {
          expect(action.amount).toBeGreaterThanOrEqual(legal.minRaiseTo);
          expect(action.amount).toBeLessThanOrEqual(legal.maxRaiseTo);
        }
        expect(decision.policy.reduce((sum, p) => sum + p.probability, 0)).toBeCloseTo(1, 5);

        state = applyAction(state, action);
      }

      expect(state.street).toBe('complete');
      seats = state.seats.map((s) => ({ ...s, stack: 10000 }));
    }
  });
});
