import { squidMultiplier, squidValueBB, type SquidConfig, type SquidState } from '../engine/squid';
import type { Seat } from '../engine/table';

interface Props {
  squid: SquidState;
  seats: Seat[];
  config: SquidConfig;
  enabled: boolean;
}

export function SquidPanel({ squid, seats, config, enabled }: Props) {
  if (!enabled) {
    return (
      <div className="panel">
        <h3 className="panel-title">🦑 鱿鱼游戏</h3>
        <p className="panel-empty">本局未启用鱿鱼玩法</p>
      </div>
    );
  }

  const distributed = squid.total - squid.remaining;
  const withoutSquid = seats.filter((s) => (squid.holdings[s.id] ?? 0) === 0);
  const ordered = [...seats].sort(
    (a, b) => (squid.holdings[b.id] ?? 0) - (squid.holdings[a.id] ?? 0),
  );

  return (
    <div className="panel">
      <h3 className="panel-title">
        🦑 鱿鱼游戏
        <span className="panel-badge">第 {squid.roundNumber} 轮</span>
      </h3>

      <div className="squid-progress">
        <div className="squid-progress-bar">
          <div
            className="squid-progress-fill"
            style={{ width: `${(distributed / squid.total) * 100}%` }}
          />
        </div>
        <div className="squid-progress-label">
          已发 {distributed} / {squid.total} 条
        </div>
      </div>

      {squid.pending > 1 && (
        <div className="squid-pending">
          上手平分底池 —— 下一手赢家可拿 <strong>{squid.pending}</strong> 条
        </div>
      )}

      <div className="squid-list">
        {ordered.map((seat) => {
          const count = squid.holdings[seat.id] ?? 0;
          const multiplier = squidMultiplier(count, config);
          return (
            <div key={seat.id} className={`squid-row ${count === 0 ? 'squid-row-zero' : ''}`}>
              <span className="squid-name">{seat.name}</span>
              <span className="squid-icons">
                {count > 0 ? '🦑'.repeat(Math.min(count, 8)) : <span className="squid-none">—</span>}
              </span>
              <span className="squid-value">
                {count > 0 ? (
                  <>
                    {count} 条
                    {multiplier > 1 && <em className="squid-mult"> ×{multiplier}</em>}
                    <strong> {squidValueBB(count, config)}BB</strong>
                  </>
                ) : (
                  <span className="squid-payer">待买单</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="squid-footnote">
        {config.endWhenOnePlayerLeft && withoutSquid.length === 1 ? (
          <span className="squid-warning">
            ⚠️ {withoutSquid[0].name} 是最后一个没有鱿鱼的人，本手结束后立即结算
          </span>
        ) : (
          <>
            每条 {config.baseValueBB}BB，持有 {config.doubleThresholds.join('/')} 条时依次翻倍。
            {config.endWhenOnePlayerLeft
              ? '只剩最后一人没鱿鱼时提前结算。'
              : '发完所有鱿鱼后结算。'}
          </>
        )}
      </div>
    </div>
  );
}
