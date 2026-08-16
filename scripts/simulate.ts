/**
 * 机器人对战模拟：验证各风格档案的统计特征是否符合设计预期。
 *
 * 运行： npx vite-node scripts/simulate.ts [手数]
 */

import {
  advanceButton,
  applySettlement,
  beginHand,
  createSession,
  playerProfit,
  stepBot,
  DEFAULT_SESSION_CONFIG,
  type SeatSetup,
} from '../src/game/session.ts';
import { BOT_PROFILES } from '../src/bots/profiles.ts';

const HANDS = Number(process.argv[2] ?? 20000);
const SQUID_ENABLED = !process.argv.includes('--no-squid');
const SEED = Number(process.env.SEED ?? 12345);

const setups: SeatSetup[] = BOT_PROFILES.map((profile) => ({
  id: profile.id,
  name: profile.name,
  isHuman: false,
  profileId: profile.id,
}));

console.log(`模拟 ${HANDS} 手 · ${setups.length} 人桌 · 每人一种风格\n`);

const config = { ...DEFAULT_SESSION_CONFIG, botIterations: 120, squidEnabled: SQUID_ENABLED };
const { state, rng } = createSession(setups, config, SEED);

const startTime = Date.now();
let settlements = 0;
let chops = 0;
/** 每个人当「付款方」的次数，以及支付/收取总额。 */
const payerCount: Record<string, number> = {};
const roundsWithZero: Record<string, number> = {};
let totalSettlementBB = 0;
for (const s of setups) { payerCount[s.id] = 0; roundsWithZero[s.id] = 0; }

for (let i = 0; i < HANDS; i++) {
  beginHand(state, rng);
  if (state.phase !== 'playing') break;

  let guard = 0;
  while (state.phase === 'playing' && guard++ < 400) {
    const acted = stepBot(state, rng);
    if (!acted) break;
  }
  if (guard >= 400) throw new Error(`第 ${i + 1} 手陷入死循环`);

  if (state.hand?.result && state.hand.result.mainPotWinners.length > 1) chops += 1;

  if (state.phase === 'settlement') {
    settlements += 1;
    const pending = state.pendingSettlement!;
    totalSettlementBB += pending.totalBB;
    for (const payer of pending.payers) payerCount[payer.playerId] += 1;
    applySettlement(state);
  }
  advanceButton(state);
}

const elapsed = (Date.now() - startTime) / 1000;
const bb = config.table.bigBlind;

console.log('风格         VPIP    PFR    赢手率   鱿鱼   买单次数   BB/100    总盈亏(BB)');
console.log('─'.repeat(82));

const rows = setups.map((setup) => {
  const stats = state.stats[setup.id];
  const profit = playerProfit(state, setup.id);
  return {
    name: setup.name,
    vpip: (stats.vpipHands / stats.handsPlayed) * 100,
    pfr: (stats.pfrHands / stats.handsPlayed) * 100,
    winRate: (stats.handsWon / stats.handsPlayed) * 100,
    squids: stats.squidsWon,
    payer: payerCount[setup.id],
    squidNetBB: stats.squidNet / bb,
    bb100: (profit / bb / stats.handsPlayed) * 100,
    profitBB: profit / bb,
    hands: stats.handsPlayed,
  };
});

for (const row of rows.sort((a, b) => b.bb100 - a.bb100)) {
  console.log(
    row.name.padEnd(12) +
      `${row.vpip.toFixed(1).padStart(5)}%` +
      `${row.pfr.toFixed(1).padStart(7)}%` +
      `${row.winRate.toFixed(1).padStart(8)}%` +
      `${String(row.squids).padStart(7)}` +
      `${String(row.payer).padStart(9)}` +
      `${row.bb100.toFixed(2).padStart(10)}` +
      `${row.profitBB.toFixed(0).padStart(13)}`,
  );
}

console.log('─'.repeat(82));
console.log(`总手数 ${state.handNumber} · 鱿鱼结算 ${settlements} 次 · 平分底池 ${chops} 次`);
console.log(`耗时 ${elapsed.toFixed(1)}s（每手 ${((elapsed / HANDS) * 1000).toFixed(1)}ms）`);

/* --- 零和检查 --- */
const totalProfit = setups.reduce((sum, s) => sum + playerProfit(state, s.id), 0);
console.log(`\n所有人盈亏之和：${(totalProfit / bb).toFixed(2)}BB（应为 0）`);

const totalSquidNet = setups.reduce((sum, s) => sum + state.stats[s.id].squidNet, 0);
console.log(`鱿鱼结算净额之和：${(totalSquidNet / bb).toFixed(2)}BB（应为 0）`);

if (SQUID_ENABLED) {
  console.log(`\n每次结算平均流转 ${(totalSettlementBB / Math.max(1, settlements)).toFixed(1)}BB`);
  console.log(`平均每 ${(state.handNumber / Math.max(1, settlements)).toFixed(1)} 手结算一次`);
  console.log('\n扑克本身盈亏 vs 鱿鱼结算盈亏（BB）：');
  for (const row of rows.sort((a, b) => b.profitBB - a.profitBB)) {
    const pokerBB = row.profitBB - row.squidNetBB;
    console.log(
      row.name.padEnd(12) +
        `扑克 ${pokerBB.toFixed(0).padStart(8)}   鱿鱼 ${row.squidNetBB.toFixed(0).padStart(8)}`,
    );
  }
}
