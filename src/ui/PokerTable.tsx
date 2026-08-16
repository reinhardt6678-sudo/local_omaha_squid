import { describeScore } from '../engine/evaluator';
import {
  STREET_NAMES_CN,
  positionName,
  type HandState,
  type Seat as SeatModel,
} from '../engine/table';
import type { SquidState } from '../engine/squid';
import { PlayingCard } from './PlayingCard';
import { Seat } from './Seat';

interface Props {
  hand: HandState;
  seats: SeatModel[];
  heroIndex: number;
  squid: SquidState;
  squidEnabled: boolean;
}

/** 把座位排布在椭圆上，英雄固定在正下方。 */
function seatPosition(index: number, heroIndex: number, count: number) {
  const step = (Math.PI * 2) / count;
  // 英雄在 90°（正下方），其余按顺时针排开
  const angle = Math.PI / 2 + step * (index - heroIndex);
  return {
    x: 50 + 39 * Math.cos(angle),
    y: 50 + 36 * Math.sin(angle),
  };
}

export function PokerTable({ hand, heroIndex, squid, squidEnabled }: Props) {
  const bb = hand.config.bigBlind;
  const result = hand.result;
  const potTotal = hand.pot + hand.seats.reduce((sum, s) => sum + s.bet, 0);

  return (
    <div className="table-area">
      <div className="felt">
        <div className="table-center">
          <div className="street-label">{STREET_NAMES_CN[hand.street]}</div>

          <div className="board">
            {Array.from({ length: 5 }, (_, i) => (
              <PlayingCard
                key={i}
                card={hand.board[i]}
                faceDown={false}
                size="lg"
                dimmed={hand.board[i] === undefined}
              />
            ))}
          </div>

          <div className="pot-display">
            底池 <strong>{(potTotal / bb).toFixed(1)}</strong> BB
          </div>

          {squidEnabled && (
            <div className="board-squid">
              🦑 剩余 {squid.remaining}/{squid.total}
              {squid.pending > 1 && <span className="board-squid-pending">下手 {squid.pending} 条</span>}
            </div>
          )}
        </div>

        {hand.seats.map((seat, index) => (
          <Seat
            key={seat.id}
            seat={seat}
            index={index}
            hand={hand}
            position={seatPosition(index, heroIndex, hand.seats.length)}
            isButton={index === hand.button}
            isActing={index === hand.actor}
            bigBlind={bb}
            revealed={result?.revealed.includes(seat.id) ?? false}
            bestCards={result?.bestCards[seat.id]}
            squids={squidEnabled ? (squid.holdings[seat.id] ?? 0) : 0}
            positionLabel={positionName(hand, index)}
            handLabel={
              result?.revealed.includes(seat.id)
                ? describeScore(result.scores[seat.id] ?? -1)
                : undefined
            }
            netChips={hand.street === 'complete' ? result?.netChips[seat.id] : undefined}
          />
        ))}
      </div>
    </div>
  );
}
