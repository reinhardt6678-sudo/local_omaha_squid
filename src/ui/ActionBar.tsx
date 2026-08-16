import { useEffect, useState } from 'react';
import type { Action, HandState, LegalActions } from '../engine/table';

interface Props {
  legal: LegalActions;
  hand: HandState;
  onAction: (action: Action) => void;
}

/** 常用的底池比例快捷键。 */
const POT_FRACTIONS: { label: string; fraction: number }[] = [
  { label: '1/3 池', fraction: 1 / 3 },
  { label: '1/2 池', fraction: 0.5 },
  { label: '2/3 池', fraction: 2 / 3 },
  { label: '满池', fraction: 1 },
];

export function ActionBar({ legal, hand, onAction }: Props) {
  const bb = hand.config.bigBlind;
  const seat = hand.seats[legal.seatIndex];
  const canSize = legal.canBet || legal.canRaise;

  const [amount, setAmount] = useState(legal.minRaiseTo);

  // 每次轮到自己行动时重置滑块
  useEffect(() => {
    setAmount(legal.minRaiseTo);
  }, [legal.minRaiseTo, legal.seatIndex, hand.street, hand.currentBet]);

  const toBB = (chips: number) => (chips / bb).toFixed(chips % bb === 0 ? 0 : 1);

  /** 把「底池的几分之几」换算成加注到的总额。 */
  const fractionToAmount = (fraction: number): number => {
    const toCall = Math.max(0, hand.currentBet - seat.bet);
    const potAfterCall = legal.potTotal + toCall;
    const target = hand.currentBet + Math.round(potAfterCall * fraction);
    return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, target));
  };

  const isAllIn = amount >= legal.maxRaiseTo && legal.maxRaiseTo === seat.bet + seat.stack;

  return (
    <div className="action-bar">
      {canSize && (
        <div className="sizing">
          <div className="sizing-row">
            <input
              type="range"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={bb / 10}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="sizing-slider"
              aria-label="下注金额"
            />
            <div className="sizing-value">
              <strong>{toBB(amount)}</strong>
              <span>BB</span>
            </div>
          </div>

          <div className="sizing-presets">
            {POT_FRACTIONS.map(({ label, fraction }) => {
              const value = fractionToAmount(fraction);
              const disabled = value > legal.maxRaiseTo;
              return (
                <button
                  key={label}
                  className="preset-btn"
                  disabled={disabled}
                  onClick={() => setAmount(value)}
                >
                  {label}
                </button>
              );
            })}
            <button className="preset-btn" onClick={() => setAmount(legal.minRaiseTo)}>
              最小
            </button>
            <button className="preset-btn preset-allin" onClick={() => setAmount(legal.maxRaiseTo)}>
              最大 {toBB(legal.maxRaiseTo)}
            </button>
          </div>
        </div>
      )}

      <div className="action-buttons">
        {legal.canFold && (
          <button className="act-btn act-fold" onClick={() => onAction({ type: 'fold' })}>
            弃牌
          </button>
        )}

        {legal.canCheck && (
          <button className="act-btn act-check" onClick={() => onAction({ type: 'check' })}>
            过牌
          </button>
        )}

        {legal.canCall && (
          <button className="act-btn act-call" onClick={() => onAction({ type: 'call' })}>
            跟注 {toBB(legal.callAmount)}BB
          </button>
        )}

        {canSize && (
          <button
            className="act-btn act-raise"
            onClick={() =>
              onAction({ type: legal.canBet ? 'bet' : 'raise', amount })
            }
          >
            {isAllIn ? '全下' : legal.canBet ? '下注' : '加注到'} {toBB(amount)}BB
          </button>
        )}
      </div>

      <div className="action-hint">
        底池 {toBB(legal.potTotal)}BB
        {legal.callAmount > 0 && ` · 需跟 ${toBB(legal.callAmount)}BB`}
        {legal.callAmount > 0 &&
          ` · 底池赔率 ${((legal.callAmount / (legal.potTotal + legal.callAmount)) * 100).toFixed(0)}%`}
        {canSize && ` · 上限 ${toBB(legal.maxRaiseTo)}BB（底池限注）`}
      </div>
    </div>
  );
}
