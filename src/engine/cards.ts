/**
 * 牌的表示与牌堆工具。
 *
 * 一张牌用 0..51 的整数表示：card = rank * 4 + suit
 *   rank: 0..12  对应 2,3,4,5,6,7,8,9,T,J,Q,K,A
 *   suit: 0..3   对应 ♠(s) ♥(h) ♦(d) ♣(c)
 */

export type Card = number;

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['s', 'h', 'd', 'c'] as const;
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'] as const;

export const DECK_SIZE = 52;

export function makeCard(rank: number, suit: number): Card {
  return rank * 4 + suit;
}

export function rankOf(card: Card): number {
  return card >> 2;
}

export function suitOf(card: Card): number {
  return card & 3;
}

/** 例如 "As"、"Td"。 */
export function cardToString(card: Card): string {
  return RANKS[rankOf(card)] + SUITS[suitOf(card)];
}

/** 用于界面显示，例如 "A♠"。 */
export function cardToDisplay(card: Card): string {
  return RANKS[rankOf(card)] + SUIT_SYMBOLS[suitOf(card)];
}

export function parseCard(text: string): Card {
  const rankIndex = RANKS.indexOf(text[0].toUpperCase() as (typeof RANKS)[number]);
  const suitIndex = SUITS.indexOf(text[1].toLowerCase() as (typeof SUITS)[number]);
  if (rankIndex < 0 || suitIndex < 0) throw new Error(`无法解析的牌: ${text}`);
  return makeCard(rankIndex, suitIndex);
}

/** 解析 "AsKdQh2c" 这样的连写字符串。 */
export function parseCards(text: string): Card[] {
  const cleaned = text.replace(/[\s,]/g, '');
  const out: Card[] = [];
  for (let i = 0; i < cleaned.length; i += 2) out.push(parseCard(cleaned.slice(i, i + 2)));
  return out;
}

export function cardsToString(cards: readonly Card[]): string {
  return cards.map(cardToString).join('');
}

/* ------------------------------------------------------------------ */
/* 随机数：可指定种子，便于复现和测试                                    */
/* ------------------------------------------------------------------ */

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [0, n) 的整数 */
  int(n: number): number;
}

/** mulberry32 —— 小巧、快速、质量足够好的 32 位 PRNG。 */
export function createRng(seed: number = (Math.random() * 2 ** 32) >>> 0): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
  };
}

export function freshDeck(): Card[] {
  const deck = new Array<Card>(DECK_SIZE);
  for (let i = 0; i < DECK_SIZE; i++) deck[i] = i;
  return deck;
}

/** 原地 Fisher-Yates 洗牌。 */
export function shuffle(deck: Card[], rng: Rng): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

export function shuffledDeck(rng: Rng): Card[] {
  return shuffle(freshDeck(), rng);
}

/**
 * 从牌堆中剔除已知牌，返回剩余牌。用于蒙特卡洛模拟时构造未知牌池。
 */
export function remainingDeck(known: readonly Card[]): Card[] {
  const used = new Uint8Array(DECK_SIZE);
  for (const c of known) used[c] = 1;
  const out: Card[] = [];
  for (let c = 0; c < DECK_SIZE; c++) if (!used[c]) out.push(c);
  return out;
}
