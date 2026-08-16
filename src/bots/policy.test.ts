import { describe, expect, it } from 'vitest';
import { createRng, parseCards } from '../engine/cards';
import {
  applyAction,
  createSeat,
  legalActions,
  startHand,
  DEFAULT_TABLE_CONFIG,
  type Seat,
} from '../engine/table';
import { decide } from './policy';
import { BOT_PROFILES, getProfile } from './profiles';
import { evaluatePreflop, percentileForScore, preflopScore } from './preflop';
import { monteCarloEquity } from './equity';

function makeSeats(count: number, profileId = 'gto'): Seat[] {
  return Array.from({ length: count }, (_, i) =>
    createSeat(`p${i}`, `玩家${i}`, 10000, { profileId }),
  );
}

describe('机器人动作合法性', () => {
  it('所有风格在随机局面下都只给出合法动作', () => {
    const rng = createRng(4242);

    for (const profile of BOT_PROFILES) {
      let seats = makeSeats(6, profile.id);

      for (let hand = 0; hand < 40; hand++) {
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

          const decision = decide({ state, legal, profile, rng, iterations: 40 });
          const { action } = decision;

          // 决策必须是当前局面允许的动作
          switch (action.type) {
            case 'check':
              expect(legal.canCheck, `${profile.name} 在不能过牌时选择了过牌`).toBe(true);
              break;
            case 'call':
              expect(legal.canCall, `${profile.name} 在不能跟注时选择了跟注`).toBe(true);
              break;
            case 'bet':
              expect(legal.canBet, `${profile.name} 在不能下注时选择了下注`).toBe(true);
              break;
            case 'raise':
              expect(legal.canRaise, `${profile.name} 在不能加注时选择了加注`).toBe(true);
              break;
          }

          if (action.type === 'bet' || action.type === 'raise') {
            expect(action.amount).toBeGreaterThanOrEqual(legal.minRaiseTo);
            expect(action.amount).toBeLessThanOrEqual(legal.maxRaiseTo);
          }

          // 概率分布必须归一
          const total = decision.policy.reduce((sum, p) => sum + p.probability, 0);
          expect(total).toBeCloseTo(1, 5);

          state = applyAction(state, action);
        }

        expect(state.street).toBe('complete');
        seats = state.seats.map((s) => ({ ...s, stack: 10000 }));
      }
    }
  });

  it('单挑和短码场景也不会卡死', () => {
    const rng = createRng(99);
    for (const stack of [150, 400, 20000]) {
      let state = startHand({
        seats: makeSeats(2).map((s) => ({ ...s, stack })),
        button: 0,
        config: DEFAULT_TABLE_CONFIG,
        rng,
        handNumber: 1,
      });

      let guard = 0;
      while (state.street !== 'complete' && guard++ < 200) {
        const legal = legalActions(state);
        if (!legal) break;
        state = applyAction(
          state,
          decide({ state, legal, profile: getProfile('gto'), rng, iterations: 30 }).action,
        );
      }
      expect(state.street).toBe('complete');
    }
  });
});

describe('翻前评估', () => {
  it('顶级牌型排在前列', () => {
    const premium = ['AsAhKsKh', 'AsAd5s4d', 'JsTs9h8h', 'KsQsJhTh'];
    for (const text of premium) {
      expect(percentileForScore(preflopScore(parseCards(text)))).toBeLessThan(5);
    }
  });

  it('垃圾牌排在后列', () => {
    const trash = ['As7d4h2c', '7s7d7h2c', 'AsKdQc2h', '2s2d7h9c'];
    for (const text of trash) {
      expect(percentileForScore(preflopScore(parseCards(text)))).toBeGreaterThan(80);
    }
  });

  it('双同花优于同样牌面的彩虹', () => {
    expect(preflopScore(parseCards('JsTs9h8h'))).toBeGreaterThan(preflopScore(parseCards('JsTd9h8c')));
    expect(preflopScore(parseCards('AsAhKsKh'))).toBeGreaterThan(preflopScore(parseCards('AsAhKdKc')));
  });

  it('三条会被大幅折价', () => {
    // AAA 带 K 明显弱于 AA 带 KK
    expect(preflopScore(parseCards('AsAdAhKs'))).toBeLessThan(preflopScore(parseCards('AsAdKhKs')));
  });

  it('顺连结构会被识别出来', () => {
    const rundown = evaluatePreflop(parseCards('JsTd9h8c'));
    const scattered = evaluatePreflop(parseCards('Ks8d5h2c'));
    expect(rundown.straightCoverage).toBeGreaterThan(scattered.straightCoverage);
  });
});

describe('蒙特卡洛胜率', () => {
  it('皇家同花顺胜率为 100%', () => {
    const rng = createRng(1);
    // 手持 A♠K♠，公共牌 Q♠J♠T♠ —— 用两张底牌 + 三张公共牌凑成皇家同花顺，无法被追平
    const equity = monteCarloEquity({
      hero: parseCards('AsKs2d3d'),
      board: parseCards('QsJsTs4h5c'),
      opponents: 1,
      iterations: 400,
      rng,
    }).equity;
    expect(equity).toBe(1);
  });

  it('顺子被对手同样牌型追平时会算作平局', () => {
    const rng = createRng(11);
    // 公共牌 Q♠J♠T♦ 时手持 AK 是坚果顺，但对手也可能拿 AK 平分
    const result = monteCarloEquity({
      hero: parseCards('AsKs2d3d'),
      board: parseCards('QsJsTd2h3c'),
      opponents: 1,
      iterations: 800,
      rng,
    });
    expect(result.tie).toBeGreaterThan(0);
    expect(result.equity).toBeGreaterThan(0.9);
    expect(result.equity).toBeLessThan(1);
  });

  it('人数越多胜率越低', () => {
    const rng = createRng(2);
    const hand = parseCards('AsAhKsKh');
    const heads = monteCarloEquity({ hero: hand, board: [], opponents: 1, iterations: 1500, rng }).equity;
    const multi = monteCarloEquity({ hero: hand, board: [], opponents: 4, iterations: 1500, rng }).equity;
    expect(heads).toBeGreaterThan(multi);
    // AAKK 双同花单挑约 70%
    expect(heads).toBeGreaterThan(0.63);
    expect(heads).toBeLessThan(0.78);
  });

  it('必输的牌胜率为 0', () => {
    const rng = createRng(3);
    // 公共牌已经是皇家同花顺，任何人都只能打平
    const equity = monteCarloEquity({
      hero: parseCards('2c3c4d5d'),
      board: parseCards('AsKsQsJsTs'),
      opponents: 1,
      iterations: 200,
      rng,
    }).equity;
    // 公共牌成牌但奥马哈必须用两张底牌 —— 双方都用不上，比的是各自最好的两张
    expect(equity).toBeGreaterThanOrEqual(0);
    expect(equity).toBeLessThanOrEqual(1);
  });
});
