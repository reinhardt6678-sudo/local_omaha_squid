import { RANKS, SUIT_SYMBOLS, rankOf, suitOf, type Card } from '../engine/cards';

interface Props {
  card?: Card;
  /** 盖着的牌背。 */
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** 高亮显示（例如构成最终牌型的五张）。 */
  highlight?: boolean;
  /** 变暗（例如没有用上的牌）。 */
  dimmed?: boolean;
}

export function PlayingCard({ card, faceDown, size = 'md', highlight, dimmed }: Props) {
  // 已发出但不该看到的牌显示牌背；还没发出来的牌位显示成空槽
  if (faceDown) {
    return <div className={`card card-${size} card-back`} aria-label="盖住的牌" />;
  }
  if (card === undefined) {
    return <div className={`card card-${size} card-slot`} aria-hidden="true" />;
  }

  const rank = RANKS[rankOf(card)];
  const suitIndex = suitOf(card);
  const suit = SUIT_SYMBOLS[suitIndex];
  // ♠♣ 黑色，♥♦ 红色
  const red = suitIndex === 1 || suitIndex === 2;

  const classes = [
    'card',
    `card-${size}`,
    red ? 'card-red' : 'card-black',
    highlight ? 'card-highlight' : '',
    dimmed ? 'card-dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} aria-label={`${rank}${suit}`}>
      <span className="card-rank">{rank}</span>
      <span className="card-suit">{suit}</span>
    </div>
  );
}
