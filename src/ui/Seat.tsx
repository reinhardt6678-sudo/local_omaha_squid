import type { Card } from '../engine/cards';
import { ACTION_NAMES_CN, type HandState, type Seat as SeatModel } from '../engine/table';
import { getProfile } from '../bots/profiles';
import { PlayingCard } from './PlayingCard';

interface Props {
  seat: SeatModel;
  index: number;
  /** 在椭圆上的位置，百分比。 */
  position: { x: number; y: number };
  isButton: boolean;
  isActing: boolean;
  bigBlind: number;
  /** 是否亮牌。 */
  revealed: boolean;
  /** 构成最终牌型的五张牌，用于高亮。 */
  bestCards?: Card[];
  squids: number;
  positionLabel: string;
  /** 摊牌时的牌型描述。 */
  handLabel?: string;
  /** 本手净输赢，结算时显示。 */
  netChips?: number;
  hand: HandState | null;
}

export function Seat({
  seat,
  position,
  isButton,
  isActing,
  bigBlind,
  revealed,
  bestCards,
  squids,
  positionLabel,
  handLabel,
  netChips,
}: Props) {
  const profile = getProfile(seat.profileId);
  const bb = (chips: number) => chips / bigBlind;

  const classes = [
    'seat',
    isActing ? 'seat-acting' : '',
    seat.folded ? 'seat-folded' : '',
    seat.allIn ? 'seat-allin' : '',
    seat.isHuman ? 'seat-hero' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const showCards = seat.isHuman || revealed;

  return (
    <div className={classes} style={{ left: `${position.x}%`, top: `${position.y}%` }}>
      <div className="seat-cards">
        {seat.inHand && !seat.folded ? (
          seat.hole.map((card, i) => (
            <PlayingCard
              key={i}
              card={showCards ? card : undefined}
              faceDown={!showCards}
              size="sm"
              highlight={revealed && bestCards?.includes(card)}
              dimmed={revealed && bestCards !== undefined && !bestCards.includes(card)}
            />
          ))
        ) : (
          <div className="seat-cards-empty" />
        )}
      </div>

      <div className="seat-body">
        <div className="seat-header">
          <span className="seat-name">{seat.name}</span>
          {!seat.isHuman && (
            <span className="seat-profile" style={{ color: profile.color }} title={profile.description}>
              {profile.shortName}
            </span>
          )}
        </div>

        <div className="seat-meta">
          <span className="seat-stack">{bb(seat.stack).toFixed(1)}BB</span>
          <span className="seat-position">{positionLabel}</span>
        </div>

        {squids > 0 && (
          <div className="seat-squids" title={`本轮持有 ${squids} 条鱿鱼`}>
            {'🦑'.repeat(Math.min(squids, 5))}
            {squids > 5 && <span className="squid-extra">×{squids}</span>}
          </div>
        )}

        {handLabel && <div className="seat-handlabel">{handLabel}</div>}

        {netChips !== undefined && netChips !== 0 && (
          <div className={`seat-net ${netChips > 0 ? 'positive' : 'negative'}`}>
            {netChips > 0 ? '+' : ''}
            {bb(netChips).toFixed(1)}BB
          </div>
        )}
      </div>

      {isButton && <div className="seat-button-chip">D</div>}

      {seat.lastAction && !seat.folded && seat.lastAction.type !== 'fold' && (
        <div className="seat-action">
          {ACTION_NAMES_CN[seat.lastAction.type]}
          {seat.lastAction.amount > 0 && ` ${bb(seat.lastAction.amount).toFixed(1)}`}
        </div>
      )}
      {seat.folded && <div className="seat-action seat-action-fold">弃牌</div>}

      {seat.bet > 0 && (
        <div className="seat-bet">
          <span className="chip-dot" />
          {bb(seat.bet).toFixed(1)}BB
        </div>
      )}
    </div>
  );
}
