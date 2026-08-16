/**
 * 边池（side pot）构建与派彩。
 */

export interface PotContributor {
  id: string;
  /** 本手牌总投入筹码。 */
  committed: number;
  /** 是否已弃牌（弃牌的钱留在池里，但没有赢池资格）。 */
  folded: boolean;
}

export interface Pot {
  /** 池内筹码。 */
  amount: number;
  /** 有资格争夺此池的玩家 id。 */
  eligible: string[];
  /** 主池为 0，之后依次递增。 */
  level: number;
}

/**
 * 根据每位玩家的总投入切分主池与边池。
 * 弃牌玩家的筹码计入池中，但不出现在 eligible 里。
 */
export function buildPots(contributors: readonly PotContributor[]): Pot[] {
  const levels = Array.from(
    new Set(contributors.filter((c) => c.committed > 0).map((c) => c.committed)),
  ).sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previous = 0;

  for (const level of levels) {
    let amount = 0;
    for (const c of contributors) {
      amount += Math.max(0, Math.min(c.committed, level) - previous);
    }
    const eligible = contributors
      .filter((c) => !c.folded && c.committed >= level)
      .map((c) => c.id);

    if (amount > 0) {
      // 只有一个人有资格时，与前一个池同源没有意义，直接单独成池（会被退还或直接赢下）
      pots.push({ amount, eligible, level: pots.length });
    }
    previous = level;
  }

  // 合并相邻且资格完全相同的池，让界面显示更干净
  const merged: Pot[] = [];
  for (const pot of pots) {
    const last = merged[merged.length - 1];
    if (last && sameMembers(last.eligible, pot.eligible)) {
      last.amount += pot.amount;
    } else {
      merged.push({ ...pot, level: merged.length });
    }
  }
  return merged;
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * 退还无人跟注的多余下注：
 * 若某位玩家的投入高于所有其他人，超出第二高的部分应退回。
 * 返回 { refundTo, amount }，没有需要退还时 amount 为 0。
 */
export function uncalledBet(
  contributors: readonly PotContributor[],
): { playerId: string | null; amount: number } {
  if (contributors.length === 0) return { playerId: null, amount: 0 };

  let highest = -1;
  let second = -1;
  let highestId: string | null = null;
  let highestCount = 0;

  for (const c of contributors) {
    if (c.committed > highest) {
      second = highest;
      highest = c.committed;
      highestId = c.id;
      highestCount = 1;
    } else if (c.committed === highest) {
      highestCount += 1;
    } else if (c.committed > second) {
      second = c.committed;
    }
  }

  if (highestCount > 1 || second < 0 || highest <= second) {
    return { playerId: null, amount: 0 };
  }
  return { playerId: highestId, amount: highest - second };
}

export interface PotAward {
  potLevel: number;
  amount: number;
  winners: string[];
  /** 每位赢家实际分到的筹码（含奇数筹码分配）。 */
  shares: Record<string, number>;
}

/**
 * 派彩一个池。scores 给出每位有资格玩家的牌力分值（越大越强）。
 * oddChipOrder 决定奇数筹码给谁 —— 传入按「庄位左手第一位」排序的玩家 id。
 */
export function awardPot(
  pot: Pot,
  scores: Record<string, number>,
  oddChipOrder: readonly string[],
): PotAward {
  let best = -Infinity;
  for (const id of pot.eligible) {
    const score = scores[id];
    if (score !== undefined && score > best) best = score;
  }

  const winners = pot.eligible.filter((id) => scores[id] === best);
  const shares: Record<string, number> = {};

  if (winners.length === 0) {
    return { potLevel: pot.level, amount: pot.amount, winners: [], shares };
  }

  const base = Math.floor(pot.amount / winners.length);
  let remainder = pot.amount - base * winners.length;
  for (const id of winners) shares[id] = base;

  // 奇数筹码按庄位左手顺序依次分配
  const ordered = oddChipOrder.filter((id) => winners.includes(id));
  const queue = ordered.length === winners.length ? ordered : winners;
  let index = 0;
  while (remainder > 0) {
    shares[queue[index % queue.length]] += 1;
    remainder -= 1;
    index += 1;
  }

  return { potLevel: pot.level, amount: pot.amount, winners, shares };
}
