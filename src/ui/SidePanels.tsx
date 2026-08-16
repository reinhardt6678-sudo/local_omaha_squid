import { useEffect, useRef } from 'react';
import type { LogEntry, Seat } from '../engine/table';
import { getProfile } from '../bots/profiles';
import type { PlayerStats } from '../game/session';
import type { BotDecision } from '../bots/policy';

/* ------------------------------------------------------------------ */

export function HandLog({ log }: { log: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 直接设置滚动位置，不用 scrollIntoView —— 后者会连带把整个侧栏一起滚动
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log.length]);

  return (
    <div className="panel panel-log">
      <h3 className="panel-title">牌局记录</h3>
      <div className="log-scroll" ref={scrollRef}>
        {log.length === 0 && <p className="panel-empty">还没有记录</p>}
        {log.map((entry, i) => (
          <div key={i} className={`log-entry log-${entry.kind}`}>
            <span className="log-hand">#{entry.handNumber}</span>
            <span className="log-text">{entry.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface StatsProps {
  seats: Seat[];
  stats: Record<string, PlayerStats>;
  bigBlind: number;
}

export function StatsPanel({ seats, stats, bigBlind }: StatsProps) {
  return (
    <div className="panel">
      <h3 className="panel-title">数据统计</h3>
      <table className="stats-table">
        <thead>
          <tr>
            <th>玩家</th>
            <th title="主动投钱进池的比例">入池率</th>
            <th title="翻前加注的比例">加注率</th>
            <th title="含鱿鱼结算的总盈亏">盈亏</th>
          </tr>
        </thead>
        <tbody>
          {seats.map((seat) => {
            const s = stats[seat.id];
            if (!s || s.handsPlayed === 0) {
              return (
                <tr key={seat.id}>
                  <td>{seat.name}</td>
                  <td colSpan={3} className="stats-empty">
                    —
                  </td>
                </tr>
              );
            }
            const profit = (seat.stack - s.buyIn) / bigBlind;
            return (
              <tr key={seat.id} className={seat.isHuman ? 'stats-hero' : ''}>
                <td>
                  {seat.name}
                  {!seat.isHuman && (
                    <em className="stats-profile" style={{ color: getProfile(seat.profileId).color }}>
                      {getProfile(seat.profileId).shortName}
                    </em>
                  )}
                </td>
                <td>{((s.vpipHands / s.handsPlayed) * 100).toFixed(0)}%</td>
                <td>{((s.pfrHands / s.handsPlayed) * 100).toFixed(0)}%</td>
                <td className={profit >= 0 ? 'positive' : 'negative'}>
                  {profit >= 0 ? '+' : ''}
                  {profit.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface ThinkingProps {
  seatName: string;
  decision: BotDecision;
}

/** 展示机器人最近一次决策的推理过程 —— 用来学习和调试都很方便。 */
export function BotThinking({ seatName, decision }: ThinkingProps) {
  return (
    <div className="panel">
      <h3 className="panel-title">机器人思考</h3>
      <div className="thinking-who">{seatName}</div>
      <p className="thinking-reason">{decision.reason}</p>
      <div className="thinking-policy">
        {decision.policy
          .slice()
          .sort((a, b) => b.probability - a.probability)
          .map((option) => (
            <div className="policy-row" key={option.label}>
              <span className="policy-label">{option.label}</span>
              <div className="policy-bar">
                <div className="policy-fill" style={{ width: `${option.probability * 100}%` }} />
              </div>
              <span className="policy-pct">{(option.probability * 100).toFixed(0)}%</span>
            </div>
          ))}
      </div>
    </div>
  );
}
