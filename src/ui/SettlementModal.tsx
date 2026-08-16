import { squidMultiplier, type SquidConfig, type SquidSettlement } from '../engine/squid';
import type { Seat } from '../engine/table';

interface Props {
  settlement: SquidSettlement;
  seats: Seat[];
  config: SquidConfig;
  onConfirm: () => void;
}

export function SettlementModal({ settlement, seats, config, onConfirm }: Props) {
  const nameOf = (id: string) => seats.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="modal-backdrop">
      <div className="modal settlement-modal">
        <h2 className="modal-title">
          🦑 第 {settlement.roundNumber} 轮鱿鱼结算
        </h2>

        <p className="settlement-reason">
          {settlement.reason === 'lastPlayerStanding'
            ? `只剩 ${settlement.payers.map((p) => nameOf(p.playerId)).join('、')} 一人没有鱿鱼，本轮提前结束。`
            : '本轮鱿鱼已全部发完。'}
        </p>

        <div className="settlement-section">
          <h3>收钱</h3>
          <table className="settlement-table">
            <thead>
              <tr>
                <th>玩家</th>
                <th>鱿鱼</th>
                <th>倍数</th>
                <th>金额</th>
              </tr>
            </thead>
            <tbody>
              {settlement.receivers.map((r) => (
                <tr key={r.playerId}>
                  <td>{nameOf(r.playerId)}</td>
                  <td className="cell-squids">{'🦑'.repeat(Math.min(r.squids, 8))} {r.squids}</td>
                  <td>×{squidMultiplier(r.squids, config)}</td>
                  <td className="cell-amount positive">+{r.amountBB}BB</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="settlement-formula">
            计算方式：条数 × {config.baseValueBB}BB × 倍数（{config.doubleThresholds.join(' / ')} 条依次翻倍）
          </div>
        </div>

        <div className="settlement-section">
          <h3>买单</h3>
          <table className="settlement-table">
            <tbody>
              {settlement.payers.map((p) => (
                <tr key={p.playerId}>
                  <td>{nameOf(p.playerId)}</td>
                  <td className="cell-nosquid">没有鱿鱼</td>
                  <td />
                  <td className="cell-amount negative">−{p.amountBB.toFixed(1)}BB</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="settlement-formula">
            总计 {settlement.totalBB}BB
            {settlement.payers.length > 1 &&
              `，由 ${settlement.payers.length} 人平摊，每人 ${(settlement.totalBB / settlement.payers.length).toFixed(1)}BB`}
          </div>
        </div>

        <button className="act-btn act-raise modal-confirm" onClick={onConfirm}>
          确认结算并开始新一轮
        </button>
      </div>
    </div>
  );
}
