import { describe, expect, it } from 'vitest';
import { parseCards } from './cards';
import {
  bestOmahaCards,
  categoryOf,
  describeScore,
  evaluate5,
  evaluateOmaha,
  HandCategory,
} from './evaluator';

function score5(text: string): number {
  const c = parseCards(text);
  return evaluate5(c[0], c[1], c[2], c[3], c[4]);
}

describe('evaluate5 牌型识别', () => {
  const cases: [string, HandCategory][] = [
    ['AsKsQsJsTs', HandCategory.StraightFlush],
    ['5s4s3s2sAs', HandCategory.StraightFlush], // 轮子同花顺
    ['7h7d7c7sKd', HandCategory.Quads],
    ['9h9d9c4s4d', HandCategory.FullHouse],
    ['Ah9h5h3h2h', HandCategory.Flush],
    ['9h8d7c6s5h', HandCategory.Straight],
    ['5h4d3c2sAh', HandCategory.Straight], // 轮子
    ['AhAdAcKs2h', HandCategory.Trips],
    ['AhAdKcKs2h', HandCategory.TwoPair],
    ['AhAdQcJs2h', HandCategory.Pair],
    ['AhKdQcJs9h', HandCategory.HighCard],
  ];

  for (const [text, expected] of cases) {
    it(`${text} → ${describeScore(score5(text))}`, () => {
      expect(categoryOf(score5(text))).toBe(expected);
    });
  }
});

describe('evaluate5 大小比较', () => {
  it('牌型顺序正确', () => {
    const ordered = [
      'AhKdQcJs9h', // 高牌
      'AhAdQcJs2h', // 一对
      'AhAdKcKs2h', // 两对
      'AhAdAcKs2h', // 三条
      '9h8d7c6s5h', // 顺子
      'Ah9h5h3h2h', // 同花
      '9h9d9c4s4d', // 葫芦
      '7h7d7c7sKd', // 四条
      'AsKsQsJsTs', // 同花顺
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(score5(ordered[i])).toBeGreaterThan(score5(ordered[i - 1]));
    }
  });

  it('同牌型比踢脚', () => {
    expect(score5('AhAdKcQs2h')).toBeGreaterThan(score5('AhAdKcJs2h'));
    expect(score5('AhAdKcKs3h')).toBeGreaterThan(score5('AhAdKcKs2h'));
    expect(score5('KhKdKcKs2h')).toBeGreaterThan(score5('QhQdQcQsAh'));
  });

  it('轮子顺子小于 6 高顺子', () => {
    expect(score5('6h5d4c3s2h')).toBeGreaterThan(score5('5h4d3c2sAh'));
  });

  it('轮子同花顺小于 6 高同花顺', () => {
    expect(score5('6s5s4s3s2s')).toBeGreaterThan(score5('5s4s3s2sAs'));
  });

  it('完全相同的牌型分值相等（花色不影响）', () => {
    expect(score5('AhKdQcJsTh')).toBe(score5('AsKcQdJhTd'));
  });
});

describe('奥马哈必须用两张底牌', () => {
  it('公共牌是同花但底牌只有一张该花色时不算同花', () => {
    // 公共牌 4 张红桃 + 底牌 1 张红桃 —— 德州能成同花，奥马哈不能
    const hole = parseCards('AhKs2c3d');
    const board = parseCards('QhJh9h4h8s');
    const score = evaluateOmaha(hole, board);
    expect(categoryOf(score)).not.toBe(HandCategory.Flush);
  });

  it('底牌两张红桃则成同花', () => {
    const hole = parseCards('AhKh2c3d');
    const board = parseCards('QhJh9h4s8s');
    const score = evaluateOmaha(hole, board);
    expect(categoryOf(score)).toBe(HandCategory.Flush);
  });

  it('公共牌成顺但底牌无法组成时不算顺子', () => {
    // 公共牌本身 5678 9，底牌完全不相干
    const hole = parseCards('AhAdKcKs');
    const board = parseCards('5c6d7h8s9c');
    const score = evaluateOmaha(hole, board);
    expect(categoryOf(score)).not.toBe(HandCategory.Straight);
    // 公共牌无对子，只能出两张底牌，因此最好也就是一对 A
    expect(categoryOf(score)).toBe(HandCategory.Pair);
  });

  it('公共牌四条时底牌仍需出两张', () => {
    const hole = parseCards('AhKd5c4s');
    const board = parseCards('7h7d7c7s2d');
    // 只能用 7777 中的 3 张 + 两张底牌 → 三条 7 带 A、K
    const score = evaluateOmaha(hole, board);
    expect(categoryOf(score)).toBe(HandCategory.Trips);
  });

  it('返回的最佳五张牌确实来自 2 底牌 + 3 公共牌', () => {
    const hole = parseCards('AhKh2c3d');
    const board = parseCards('QhJh9h4s8s');
    const { cards } = bestOmahaCards(hole, board);
    const fromHole = cards.filter((c) => hole.includes(c));
    const fromBoard = cards.filter((c) => board.includes(c));
    expect(fromHole).toHaveLength(2);
    expect(fromBoard).toHaveLength(3);
  });
});

describe('奥马哈实战对局比较', () => {
  it('葫芦大于同花', () => {
    const board = parseCards('Kh9h4h9s2d');
    const fullHouse = evaluateOmaha(parseCards('KsKc7d3c'), board); // KK99
    const flush = evaluateOmaha(parseCards('AhQh7d3c'), board); // A 高同花
    expect(fullHouse).toBeGreaterThan(flush);
  });

  it('坚果同花赢次坚果同花', () => {
    const board = parseCards('Kh9h4h2s7d');
    const nut = evaluateOmaha(parseCards('AhQh5s4d'), board);
    const second = evaluateOmaha(parseCards('QhJh5s4d'), board);
    expect(nut).toBeGreaterThan(second);
  });

  it('平局返回相同分值', () => {
    const board = parseCards('AhKhQd7s2c');
    const a = evaluateOmaha(parseCards('AsKs5c4d'), board);
    const b = evaluateOmaha(parseCards('AdKd5h4h'), board);
    expect(a).toBe(b);
  });
});
