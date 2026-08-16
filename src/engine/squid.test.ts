import { describe, expect, it } from 'vitest';
import {
  awardSquids,
  checkRoundEnd,
  createSquidRound,
  DEFAULT_SQUID_CONFIG,
  settlementToChips,
  settleSquidRound,
  squidMultiplier,
  squidValueBB,
  type SquidState,
} from './squid';

const SIX = ['A', 'B', 'C', 'D', 'E', 'F'];

function stateWith(holdings: Record<string, number>, total: number, roundNumber = 1): SquidState {
  const distributed = Object.values(holdings).reduce((a, b) => a + b, 0);
  return {
    total,
    remaining: total - distributed,
    holdings,
    pending: 1,
    handsPlayed: distributed,
    roundNumber,
  };
}

describe('鱿鱼价值计算', () => {
  it('1~2 条不翻倍，3/5/7 条各翻一次', () => {
    expect(squidMultiplier(1)).toBe(1);
    expect(squidMultiplier(2)).toBe(1);
    expect(squidMultiplier(3)).toBe(2);
    expect(squidMultiplier(4)).toBe(2);
    expect(squidMultiplier(5)).toBe(4);
    expect(squidMultiplier(6)).toBe(4);
    expect(squidMultiplier(7)).toBe(8);
    expect(squidMultiplier(9)).toBe(8);
  });

  it('价值 = 条数 × 2BB × 倍数', () => {
    expect(squidValueBB(0)).toBe(0);
    expect(squidValueBB(1)).toBe(2);
    expect(squidValueBB(2)).toBe(4);
    expect(squidValueBB(3)).toBe(12);
    expect(squidValueBB(4)).toBe(16);
    expect(squidValueBB(5)).toBe(40);
    expect(squidValueBB(7)).toBe(112);
  });
});

describe('用户给出的 6 人桌样例', () => {
  // 6 人桌共 9 条鱿鱼：A 拿 4、B 拿 3、C 拿 1、D 拿 1，E 和 F 没拿到
  const state = stateWith({ A: 4, B: 3, C: 1, D: 1, E: 0, F: 0 }, 9);

  it('总鱿鱼数为人数 + 3', () => {
    expect(createSquidRound(SIX).total).toBe(9);
  });

  it('结算金额与样例完全一致', () => {
    const settlement = settleSquidRound(state, 'exhausted');
    const byId = Object.fromEntries(settlement.receivers.map((r) => [r.playerId, r.amountBB]));

    expect(byId.A).toBe(16); // 4 × 2 × 2
    expect(byId.B).toBe(12); // 3 × 2 × 2
    expect(byId.C).toBe(2);
    expect(byId.D).toBe(2);
    expect(settlement.totalBB).toBe(32);

    expect(settlement.payers).toHaveLength(2);
    for (const payer of settlement.payers) {
      expect(payer.amountBB).toBe(16); // 32 / 2
    }
  });

  it('净额之和为零', () => {
    const settlement = settleSquidRound(state, 'exhausted');
    const sum = Object.values(settlement.netBB).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });

  it('换算成筹码后依然精确为零和', () => {
    const settlement = settleSquidRound(state, 'exhausted');
    const chips = settlementToChips(settlement, 100);
    expect(chips.A).toBe(1600);
    expect(chips.E).toBe(-1600);
    expect(Object.values(chips).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('发鱿鱼与平分底池', () => {
  it('普通赢家拿 1 条', () => {
    const start = createSquidRound(SIX);
    const { state, awarded, winnerId } = awardSquids(start, ['A']);
    expect(awarded).toBe(1);
    expect(winnerId).toBe('A');
    expect(state.holdings.A).toBe(1);
    expect(state.remaining).toBe(8);
  });

  it('平分底池时本手不发鱿鱼，下手赢家拿 2 条', () => {
    let state = createSquidRound(SIX);
    const chop = awardSquids(state, ['A', 'B']);
    expect(chop.awarded).toBe(0);
    expect(chop.chopped).toBe(true);
    expect(chop.state.pending).toBe(2);
    expect(chop.state.remaining).toBe(9);

    state = chop.state;
    const next = awardSquids(state, ['C']);
    expect(next.awarded).toBe(2);
    expect(next.state.holdings.C).toBe(2);
    expect(next.state.pending).toBe(1); // 发完后归位
  });

  it('连续两次平分，第三手赢家拿 3 条', () => {
    let state = createSquidRound(SIX);
    state = awardSquids(state, ['A', 'B']).state;
    state = awardSquids(state, ['C', 'D']).state;
    expect(state.pending).toBe(3);
    const result = awardSquids(state, ['E']);
    expect(result.awarded).toBe(3);
    expect(result.state.holdings.E).toBe(3);
  });

  it('剩余鱿鱼不足时只发剩下的', () => {
    const state = stateWith({ A: 8, B: 0, C: 0, D: 0, E: 0, F: 0 }, 9);
    state.pending = 3;
    const result = awardSquids(state, ['B']);
    expect(result.awarded).toBe(1);
    expect(result.state.remaining).toBe(0);
  });
});

describe('本轮结束判定', () => {
  it('鱿鱼发完时结算', () => {
    const state = stateWith({ A: 4, B: 3, C: 1, D: 1, E: 0, F: 0 }, 9);
    expect(checkRoundEnd(state)).toBe('exhausted');
  });

  it('未发完且有 2 人无鱼时继续', () => {
    const state = stateWith({ A: 2, B: 1, C: 1, D: 1, E: 0, F: 0 }, 9);
    expect(checkRoundEnd(state)).toBe(null);
  });

  it('只剩最后一人无鱼时提前结束', () => {
    const state = stateWith({ A: 2, B: 2, C: 1, D: 1, E: 1, F: 0 }, 9);
    expect(checkRoundEnd(state)).toBe('lastPlayerStanding');
  });

  it('开局时全员无鱼不算提前结束', () => {
    const state = createSquidRound(['A', 'B']);
    expect(checkRoundEnd(state)).toBe(null);
  });

  it('关闭提前结束后会一直打到鱿鱼发完', () => {
    const config = { ...DEFAULT_SQUID_CONFIG, endWhenOnePlayerLeft: false };
    const state = stateWith({ A: 2, B: 2, C: 1, D: 1, E: 1, F: 0 }, 9);
    expect(checkRoundEnd(state, config)).toBe(null);
  });
});

describe('提前结束：最后一人独自买单', () => {
  it('由唯一无鱼玩家支付全部', () => {
    const state = stateWith({ A: 3, B: 2, C: 1, D: 1, E: 1, F: 0 }, 9);
    const settlement = settleSquidRound(state, 'lastPlayerStanding');

    // A: 3×2×2=12, B: 2×2=4, C/D/E: 各 2 → 合计 22
    expect(settlement.totalBB).toBe(22);
    expect(settlement.payers).toHaveLength(1);
    expect(settlement.payers[0].playerId).toBe('F');
    expect(settlement.payers[0].amountBB).toBe(22);
    expect(Object.values(settlement.netBB).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('无人为零时的兜底规则', () => {
  it('由持有最少的一档平摊', () => {
    const config = { ...DEFAULT_SQUID_CONFIG, endWhenOnePlayerLeft: false };
    const state = stateWith({ A: 4, B: 2, C: 1, D: 1, E: 1, F: 1 }, 10);
    const settlement = settleSquidRound(state, 'exhausted', config);

    // 持有 1 条的 C/D/E/F 四人买单，A 和 B 收钱
    expect(settlement.payers.map((p) => p.playerId).sort()).toEqual(['C', 'D', 'E', 'F']);
    expect(settlement.totalBB).toBe(16 + 4); // A: 4×2×2, B: 2×2
    expect(settlement.payers[0].amountBB).toBe(5);
    expect(Object.values(settlement.netBB).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('筹码取整', () => {
  it('无法整除时仍保持零和', () => {
    const state = stateWith({ A: 1, B: 1, C: 0, D: 0, E: 0, F: 0 }, 9);
    const settlement = settleSquidRound(state, 'lastPlayerStanding');
    // 总计 4BB，4 人平摊 → 每人 1BB
    const chips = settlementToChips(settlement, 100);
    expect(Object.values(chips).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('三人平摊 2BB 时零和成立', () => {
    const state = stateWith({ A: 1, B: 0, C: 0, D: 0 }, 7);
    const settlement = settleSquidRound(state, 'lastPlayerStanding');
    const chips = settlementToChips(settlement, 100);
    expect(chips.A).toBe(200);
    expect(Object.values(chips).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
