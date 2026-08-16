import { describe, expect, it } from 'vitest';
import { createRng } from './cards';
import { buildPots, uncalledBet } from './pots';
import {
  applyAction,
  createSeat,
  DEFAULT_TABLE_CONFIG,
  legalActions,
  playOut,
  startHand,
  type HandState,
  type Seat,
} from './table';

function makeSeats(count: number, stack = 10000): Seat[] {
  return Array.from({ length: count }, (_, i) =>
    createSeat(`p${i}`, `玩家${i}`, stack, { isHuman: i === 0 }),
  );
}

function newHand(count = 6, stack = 10000, button = 0): HandState {
  return startHand({
    seats: makeSeats(count, stack),
    button,
    config: DEFAULT_TABLE_CONFIG,
    rng: createRng(42),
    handNumber: 1,
  });
}

describe('发牌与盲注', () => {
  it('每人 4 张底牌且互不重复', () => {
    const state = newHand(6);
    const all = state.seats.flatMap((s) => s.hole);
    expect(all).toHaveLength(24);
    expect(new Set(all).size).toBe(24);
    for (const seat of state.seats) expect(seat.hole).toHaveLength(4);
  });

  it('6 人桌小盲大盲在庄位左手两位', () => {
    const state = newHand(6, 10000, 0);
    expect(state.seats[1].bet).toBe(50);
    expect(state.seats[2].bet).toBe(100);
    expect(state.currentBet).toBe(100);
    expect(state.actor).toBe(3); // UTG
  });

  it('单挑时庄家下小盲并且翻前先行动', () => {
    const state = newHand(2, 10000, 0);
    expect(state.seats[0].bet).toBe(50); // 庄家 = 小盲
    expect(state.seats[1].bet).toBe(100);
    expect(state.actor).toBe(0);
  });
});

describe('底池限注下注规则', () => {
  it('翻前最大开池为 3.5BB', () => {
    const state = newHand(6);
    const legal = legalActions(state)!;
    expect(legal.callAmount).toBe(100);
    expect(legal.minRaiseTo).toBe(200);
    // 底池 150 + 跟注 100 = 250，加在当前下注 100 上 → 350
    expect(legal.maxRaiseTo).toBe(350);
  });

  it('翻后满池下注等于底池大小', () => {
    let state = newHand(6);
    // 所有人弃牌到大盲，小盲跟注，大盲过牌
    state = applyAction(state, { type: 'fold' }); // UTG
    state = applyAction(state, { type: 'fold' });
    state = applyAction(state, { type: 'fold' });
    state = applyAction(state, { type: 'fold' }); // BTN
    state = applyAction(state, { type: 'call' }); // SB 补齐
    state = applyAction(state, { type: 'check' }); // BB

    expect(state.street).toBe('flop');
    expect(state.pot).toBe(200);
    const legal = legalActions(state)!;
    expect(legal.canBet).toBe(true);
    expect(legal.maxRaiseTo).toBe(200); // 满池
    expect(legal.minRaiseTo).toBe(100); // 最小一个大盲
  });

  it('加注不能超过底池上限', () => {
    let state = newHand(6);
    state = applyAction(state, { type: 'raise', amount: 999999 });
    expect(state.seats[3].bet).toBe(350); // 被限制到底池上限
  });

  it('筹码不足时上限为全下', () => {
    const state = newHand(6, 200); // 每人只有 2BB
    const legal = legalActions(state)!;
    expect(legal.maxRaiseTo).toBe(200);
  });
});

describe('下注轮推进', () => {
  it('大盲在无人加注时仍有行动权', () => {
    let state = newHand(6);
    state = applyAction(state, { type: 'call' }); // UTG
    state = applyAction(state, { type: 'fold' });
    state = applyAction(state, { type: 'fold' });
    state = applyAction(state, { type: 'fold' }); // BTN
    state = applyAction(state, { type: 'fold' }); // SB
    // 轮到大盲，且可以过牌
    expect(state.actor).toBe(2);
    const legal = legalActions(state)!;
    expect(legal.canCheck).toBe(true);
    expect(legal.canRaise).toBe(true);
  });

  it('大盲过牌后进入翻牌', () => {
    let state = newHand(6);
    state = applyAction(state, { type: 'call' });
    state = applyAction(state, { type: 'fold' });
    state = applyAction(state, { type: 'fold' });
    state = applyAction(state, { type: 'fold' });
    state = applyAction(state, { type: 'fold' });
    state = applyAction(state, { type: 'check' });
    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);
    expect(state.pot).toBe(250);
  });

  it('加注会重新开放其他人的行动权', () => {
    let state = newHand(6);
    state = applyAction(state, { type: 'call' }); // 座位3 UTG 跟注
    state = applyAction(state, { type: 'call' }); // 座位4 跟注
    state = applyAction(state, { type: 'raise', amount: 400 }); // 座位5 加注到 400

    expect(state.actor).toBe(0); // 轮到庄位
    state = applyAction(state, { type: 'fold' }); // 座位0 BTN
    state = applyAction(state, { type: 'fold' }); // 座位1 SB
    state = applyAction(state, { type: 'fold' }); // 座位2 BB

    // 已经跟过注的 UTG 因为面对加注而重新获得行动权
    expect(state.actor).toBe(3);
    expect(legalActions(state)!.callAmount).toBe(300);
  });

  it('全部弃牌时最后一人直接获胜且退还多余下注', () => {
    let state = newHand(6);
    state = applyAction(state, { type: 'raise', amount: 350 });
    for (let i = 0; i < 5; i++) {
      if (state.street === 'complete') break;
      state = applyAction(state, { type: 'fold' });
    }
    expect(state.street).toBe('complete');
    const winner = state.seats[3];
    expect(state.result!.mainPotWinners).toEqual([winner.id]);
    // 赢下 SB 50 + BB 100
    expect(state.result!.netChips[winner.id]).toBe(150);
  });
});

describe('全下与边池', () => {
  it('短码全下形成边池', () => {
    const seats = [
      createSeat('a', 'A', 10000),
      createSeat('b', 'B', 10000),
      createSeat('c', 'C', 300), // 短码
      createSeat('d', 'D', 10000),
    ];
    let state = startHand({ seats, button: 0, config: DEFAULT_TABLE_CONFIG, rng: createRng(7), handNumber: 1 });

    // d(UTG) 加注，a 跟注，b(SB) 弃牌，c(BB) 全下跟注
    state = applyAction(state, { type: 'raise', amount: 350 });
    state = applyAction(state, { type: 'call' }); // a
    state = applyAction(state, { type: 'fold' }); // b (SB)
    state = applyAction(state, { type: 'call' }); // c 全下 300

    const c = state.seats.find((s) => s.id === 'c')!;
    expect(c.allIn).toBe(true);
    expect(c.committed).toBe(300);
  });

  it('buildPots 正确切分主池和边池', () => {
    const pots = buildPots([
      { id: 'a', committed: 1000, folded: false },
      { id: 'b', committed: 300, folded: false },
      { id: 'c', committed: 1000, folded: false },
      { id: 'd', committed: 100, folded: true },
    ]);

    expect(pots).toHaveLength(2);
    // 主池：100×1(d) + 300×... 按层计算 → 100*4 = 400? 逐层：
    // level 100: a,b,c,d 各 100 → 400，资格 a,b,c
    // level 300: a,b,c 各 200 → 600，资格 a,b,c → 与上层资格相同，合并 = 1000
    // level 1000: a,c 各 700 → 1400，资格 a,c
    expect(pots[0].amount).toBe(1000);
    expect(pots[0].eligible.sort()).toEqual(['a', 'b', 'c']);
    expect(pots[1].amount).toBe(1400);
    expect(pots[1].eligible.sort()).toEqual(['a', 'c']);
  });

  it('uncalledBet 找出应退还的部分', () => {
    const refund = uncalledBet([
      { id: 'a', committed: 1000, folded: false },
      { id: 'b', committed: 300, folded: true },
    ]);
    expect(refund).toEqual({ playerId: 'a', amount: 700 });
  });

  it('两人投入相同时无需退还', () => {
    const refund = uncalledBet([
      { id: 'a', committed: 500, folded: false },
      { id: 'b', committed: 500, folded: false },
    ]);
    expect(refund.amount).toBe(0);
  });
});

describe('完整对局不变量', () => {
  it('随机跑 300 手，筹码总量守恒且无异常', () => {
    const rng = createRng(20240815);
    let seats = makeSeats(6, 10000);
    const totalBefore = seats.reduce((sum, s) => sum + s.stack, 0);

    for (let hand = 0; hand < 300; hand++) {
      const playable = seats.filter((s) => s.stack > 0);
      if (playable.length < 2) break;

      let state = startHand({
        seats,
        button: hand % seats.length,
        config: DEFAULT_TABLE_CONFIG,
        rng,
        handNumber: hand + 1,
      });

      state = playOut(state, (_s, legal) => {
        const roll = rng.next();
        if (roll < 0.12 && legal.canFold && legal.callAmount > 0) return { type: 'fold' };
        if (roll < 0.24 && (legal.canBet || legal.canRaise)) {
          const span = legal.maxRaiseTo - legal.minRaiseTo;
          return {
            type: legal.canBet ? 'bet' : 'raise',
            amount: legal.minRaiseTo + Math.floor(rng.next() * (span + 1)),
          };
        }
        if (legal.canCheck) return { type: 'check' };
        if (legal.canCall) return { type: 'call' };
        return { type: 'fold' };
      });

      expect(state.street).toBe('complete');
      expect(state.result).not.toBeNull();

      // 每手结束后筹码总量不变
      const total = state.seats.reduce((sum, s) => sum + s.stack, 0);
      expect(total).toBe(totalBefore);

      // 没有负筹码
      for (const seat of state.seats) expect(seat.stack).toBeGreaterThanOrEqual(0);

      seats = state.seats.map((s) => ({ ...s }));
    }
  });

  it('摊牌时赢家确实是最强牌', () => {
    const rng = createRng(999);
    let seats = makeSeats(4, 10000);

    for (let hand = 0; hand < 100; hand++) {
      let state = startHand({
        seats,
        button: hand % 4,
        config: DEFAULT_TABLE_CONFIG,
        rng,
        handNumber: hand + 1,
      });
      state = playOut(state, (_s, legal) => {
        if (legal.canCheck) return { type: 'check' };
        return { type: 'call' };
      });

      const result = state.result!;
      if (result.showdown) {
        const best = Math.max(...Object.values(result.scores));
        for (const winner of result.mainPotWinners) {
          expect(result.scores[winner]).toBe(best);
        }
      }
      seats = state.seats.map((s) => ({ ...s, stack: 10000 }));
    }
  });
});
