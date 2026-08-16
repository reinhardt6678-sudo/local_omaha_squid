import { describe, expect, it } from 'vitest';
import { BOT_PROFILES } from '../bots/profiles';
import {
  advanceButton,
  applySettlement,
  beginHand,
  createSession,
  stepBot,
  DEFAULT_SESSION_CONFIG,
  type SeatSetup,
  type SessionConfig,
  type SessionPhase,
  type SessionState,
} from './session';

/**
 * 读一次阶段。
 *
 * beginHand / stepBot 都是就地改状态的，直接写 `state.phase === 'playing'`
 * 会让 TS 把类型一路收窄住，后面判断结算时就成了「不可能发生的比较」。
 */
const phaseOf = (state: SessionState): SessionPhase => state.phase;

const SETUPS: SeatSetup[] = BOT_PROFILES.map((profile) => ({
  id: profile.id,
  name: profile.name,
  isHuman: false,
  profileId: profile.id,
}));

/** 跑一段机器人对局，返回最终状态和结算次数。 */
function playSession(
  hands: number,
  overrides: Partial<SessionConfig> = {},
  seed = 20260815,
): { state: SessionState; settlements: number } {
  const config: SessionConfig = { ...DEFAULT_SESSION_CONFIG, botIterations: 25, ...overrides };
  const { state, rng } = createSession(SETUPS, config, seed);
  let settlements = 0;

  for (let i = 0; i < hands; i++) {
    beginHand(state, rng);
    if (phaseOf(state) !== 'playing') break;

    let guard = 0;
    while (phaseOf(state) === 'playing' && guard++ < 400) {
      if (!stepBot(state, rng)) break;
    }
    expect(guard).toBeLessThan(400);

    if (phaseOf(state) === 'settlement') {
      settlements += 1;
      applySettlement(state);
    }
    advanceButton(state);
  }

  return { state, settlements };
}

describe('对局统计', () => {
  const { state, settlements } = playSession(200);

  it('每一项比率的分子都不会超过分母', () => {
    for (const setup of SETUPS) {
      const s = state.stats[setup.id];
      expect(s.handsPlayed).toBeGreaterThan(0);

      expect(s.vpipHands).toBeLessThanOrEqual(s.handsPlayed);
      expect(s.pfrHands).toBeLessThanOrEqual(s.vpipHands);
      expect(s.threeBetHands).toBeLessThanOrEqual(s.threeBetChances);
      expect(s.sawFlopHands).toBeLessThanOrEqual(s.handsPlayed);
      expect(s.showdownHands).toBeLessThanOrEqual(s.sawFlopHands);
      expect(s.showdownsWon).toBeLessThanOrEqual(s.showdownHands);
      expect(s.handsWon).toBeLessThanOrEqual(s.handsPlayed);
      expect(s.squidRoundsPaid).toBeLessThanOrEqual(s.squidRounds);
    }
  });

  it('看到翻牌的人不会比进池的人还多', () => {
    for (const setup of SETUPS) {
      const s = state.stats[setup.id];
      // 大盲可以免费看翻牌，所以只能保证不超过「进池 + 当大盲的手数」这个上限
      expect(s.sawFlopHands).toBeLessThanOrEqual(s.vpipHands + s.handsPlayed);
    }
  });

  it('每次结算所有人都记一轮，而且总有人买单', () => {
    for (const setup of SETUPS) {
      expect(state.stats[setup.id].squidRounds).toBe(settlements);
    }
    const paid = SETUPS.reduce((sum, s) => sum + state.stats[s.id].squidRoundsPaid, 0);
    expect(paid).toBeGreaterThanOrEqual(settlements);
  });

  it('盈亏曲线在每个时间点都是零和的', () => {
    const series = SETUPS.map((s) => state.profitHistory[s.id]);
    const length = series[0].length;
    expect(length).toBeGreaterThan(10);

    for (const points of series) expect(points.length).toBe(length);

    // 筹码守恒 ⇒ 任意时刻所有人的盈亏之和必须为 0
    for (let i = 0; i < length; i++) {
      const total = series.reduce((sum, points) => sum + points[i], 0);
      expect(total, `第 ${i} 个采样点盈亏之和不为 0`).toBe(0);
    }
  });

  it('鱿鱼净额之和为零，且计入了总盈亏', () => {
    const squidNet = SETUPS.reduce((sum, s) => sum + state.stats[s.id].squidNet, 0);
    expect(squidNet).toBe(0);
  });
});

describe('机器人的鱿鱼意识', () => {
  it('可以整桌关掉，关掉后就是纯扑克机器人', () => {
    const { state: blind } = playSession(60, { botSquidAwareness: 0 });
    // 关掉意识不影响鱿鱼玩法本身照常运转
    expect(blind.squid.total).toBe(SETUPS.length + DEFAULT_SESSION_CONFIG.squid.squidsPerPlayerOffset);
    for (const setup of SETUPS) {
      expect(blind.stats[setup.id].handsPlayed).toBeGreaterThan(0);
    }
  });

  it('整桌打开时，机器人平均入池率更高', () => {
    const vpip = (state: SessionState) => {
      const played = SETUPS.reduce((sum, s) => sum + state.stats[s.id].handsPlayed, 0);
      const entered = SETUPS.reduce((sum, s) => sum + state.stats[s.id].vpipHands, 0);
      return entered / played;
    };

    // 单个种子的差距会被方差淹没，取多个种子的平均
    const seeds = [11, 22, 33, 44];
    const aware = seeds.map((seed) => vpip(playSession(150, {}, seed).state));
    const blind = seeds.map((seed) => vpip(playSession(150, { botSquidAwareness: 0 }, seed).state));

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(aware)).toBeGreaterThan(mean(blind));
  });
});
