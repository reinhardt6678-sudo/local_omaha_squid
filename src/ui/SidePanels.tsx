import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  /** 每手牌开始时的盈亏快照（筹码）。 */
  profitHistory: Record<string, number[]>;
  squidEnabled: boolean;
}

/** 一行数据的上下文。 */
interface Row {
  seat: Seat;
  stats: PlayerStats;
  /** 盈亏（BB），含鱿鱼结算。 */
  profitBB: number;
  /** 其中鱿鱼结算贡献的部分（BB）。 */
  squidNetBB: number;
}

interface Column {
  label: string;
  /** 表头 tooltip —— 缩写太多，鼠标放上去要能看懂。 */
  title: string;
  render: (row: Row) => ReactNode;
}

/** 比率，分母为 0 时显示破折号而不是 NaN。 */
function ratio(numerator: number, denominator: number): string {
  return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : '—';
}

function signedBB(value: number): ReactNode {
  return (
    <span className={value >= 0 ? 'positive' : 'negative'}>
      {value >= 0 ? '+' : ''}
      {value.toFixed(1)}
    </span>
  );
}

const POKER_COLUMNS: Column[] = [
  {
    label: '入池',
    title: 'VPIP —— 主动投钱进池的手数比例（不含盲注）',
    render: ({ stats }) => ratio(stats.vpipHands, stats.handsPlayed),
  },
  {
    label: '加注',
    title: 'PFR —— 翻前加注的手数比例',
    render: ({ stats }) => ratio(stats.pfrHands, stats.handsPlayed),
  },
  {
    label: '3bet',
    title: '翻前面对加注时，选择再加注的比例',
    render: ({ stats }) => ratio(stats.threeBetHands, stats.threeBetChances),
  },
  {
    label: '激进',
    title: '激进指数 AF —— 翻后（下注 + 加注）÷ 跟注。1.0 左右为均衡，越高越主动',
    render: ({ stats }) => {
      if (stats.callActions === 0) return stats.aggressiveActions > 0 ? '∞' : '—';
      return (stats.aggressiveActions / stats.callActions).toFixed(1);
    },
  },
];

const SHOWDOWN_COLUMNS: Column[] = [
  {
    label: '看翻',
    title: '看到翻牌的手数比例',
    render: ({ stats }) => ratio(stats.sawFlopHands, stats.handsPlayed),
  },
  {
    label: '摊牌',
    title: 'WTSD —— 看到翻牌之后走到摊牌的比例',
    render: ({ stats }) => ratio(stats.showdownHands, stats.sawFlopHands),
  },
  {
    label: '摊牌胜',
    title: 'W$SD —— 摊牌时拿下主池的比例',
    render: ({ stats }) => ratio(stats.showdownsWon, stats.showdownHands),
  },
  {
    label: '赢手',
    title: '赢下主池的手数比例（含没走到摊牌的）',
    render: ({ stats }) => ratio(stats.handsWon, stats.handsPlayed),
  },
];

const SQUID_COLUMNS: Column[] = [
  {
    label: '🦑',
    title: '累计拿到的鱿鱼条数',
    render: ({ stats }) => stats.squidsWon || '—',
  },
  {
    label: '买单',
    title: '当付款方的轮数 / 参与结算的总轮数 —— 这个游戏里真正决定输赢的数字',
    render: ({ stats }) =>
      stats.squidRounds > 0 ? `${stats.squidRoundsPaid}/${stats.squidRounds}` : '—',
  },
  {
    label: '鱿鱼BB',
    title: '鱿鱼结算的累计净额（BB）—— 和「盈亏」一比就知道输赢是牌打出来的还是鱿鱼买单买出来的',
    render: ({ stats, squidNetBB }) => (stats.squidRounds > 0 ? signedBB(squidNetBB) : '—'),
  },
  {
    label: '盈亏',
    title: '总盈亏（BB），含鱿鱼结算',
    render: ({ profitBB }) => signedBB(profitBB),
  },
];

const TABS = [
  { id: 'poker', label: '扑克', columns: POKER_COLUMNS },
  { id: 'showdown', label: '摊牌', columns: SHOWDOWN_COLUMNS },
  { id: 'squid', label: '鱿鱼', columns: SQUID_COLUMNS },
] as const;

export function StatsPanel({ seats, stats, bigBlind, profitHistory, squidEnabled }: StatsProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('poker');
  const tabs = TABS.filter((t) => t.id !== 'squid' || squidEnabled);
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <div className="panel">
      <h3 className="panel-title">
        数据统计
        <span className="segmented segmented-sm stats-tabs">
          {tabs.map((t) => (
            <button key={t.id} className={active.id === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </span>
      </h3>

      <table className="stats-table">
        <thead>
          <tr>
            <th>玩家</th>
            {active.columns.map((column) => (
              <th key={column.label} title={column.title}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {seats.map((seat) => {
            const s = stats[seat.id];
            const profile = getProfile(seat.profileId);

            const name = (
              <td>
                {seat.name}
                {!seat.isHuman && (
                  <em className="stats-profile" style={{ color: profile.color }}>
                    {profile.shortName}
                  </em>
                )}
              </td>
            );

            if (!s || s.handsPlayed === 0) {
              return (
                <tr key={seat.id}>
                  {name}
                  <td colSpan={active.columns.length} className="stats-empty">
                    —
                  </td>
                </tr>
              );
            }

            const row: Row = {
              seat,
              stats: s,
              profitBB: (seat.stack - s.buyIn) / bigBlind,
              squidNetBB: s.squidNet / bigBlind,
            };
            return (
              <tr key={seat.id} className={seat.isHuman ? 'stats-hero' : ''}>
                {name}
                {active.columns.map((column) => (
                  <td key={column.label}>{column.render(row)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      <ProfitChart seats={seats} stats={stats} bigBlind={bigBlind} history={profitHistory} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface ChartProps {
  seats: Seat[];
  stats: Record<string, PlayerStats>;
  bigBlind: number;
  history: Record<string, number[]>;
}

const CHART_WIDTH = 300;
const CHART_HEIGHT = 64;
const CHART_PAD = 5;

/** 盈亏曲线：每人一条，自己那条高亮。 */
function ProfitChart({ seats, stats, bigBlind, history }: ChartProps) {
  const series = seats.map((seat) => {
    const past = history[seat.id] ?? [];
    // 补一个「此刻」的点，曲线才跟得上正在打的这一手
    const live = seat.stack - (stats[seat.id]?.buyIn ?? seat.stack);
    return {
      seat,
      profile: getProfile(seat.profileId),
      points: [...past, live].map((chips) => chips / bigBlind),
    };
  });

  const length = Math.max(0, ...series.map((s) => s.points.length));
  if (length < 3) {
    return <p className="chart-empty">再打几手就会出现盈亏曲线</p>;
  }

  const maxAbs = Math.max(1, ...series.flatMap((s) => s.points.map(Math.abs)));
  const x = (index: number) => (index / (length - 1)) * CHART_WIDTH;
  const y = (value: number) =>
    CHART_HEIGHT / 2 - (value / maxAbs) * (CHART_HEIGHT / 2 - CHART_PAD);

  const last = (points: number[]) => points[points.length - 1];
  // 自己那条最后画，压在最上面；图例按盈亏从高到低排
  const drawOrder = [...series].sort((a, b) => Number(a.seat.isHuman) - Number(b.seat.isHuman));
  const byProfit = [...series].sort((a, b) => last(b.points) - last(a.points));

  return (
    <div className="profit-chart">
      <div className="chart-head">
        <span>盈亏曲线</span>
        <span className="chart-scale">±{maxAbs.toFixed(0)}BB</span>
      </div>

      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="chart-svg" role="img" aria-label="盈亏曲线">
        <line x1={0} y1={y(0)} x2={CHART_WIDTH} y2={y(0)} className="chart-zero" />
        {drawOrder.map(({ seat, profile, points }) => (
          <polyline
            key={seat.id}
            className={seat.isHuman ? 'chart-line chart-line-hero' : 'chart-line'}
            stroke={seat.isHuman ? undefined : profile.color}
            points={points.map((value, index) => `${x(index)},${y(value)}`).join(' ')}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="chart-legend">
        {byProfit.map(({ seat, profile, points }) => {
          const value = last(points);
          return (
            <span key={seat.id} className={seat.isHuman ? 'legend-item legend-hero' : 'legend-item'}>
              <i className="legend-dot" style={{ background: seat.isHuman ? undefined : profile.color }} />
              {seat.name}
              <em className={value >= 0 ? 'positive' : 'negative'}>
                {value >= 0 ? '+' : ''}
                {value.toFixed(1)}
              </em>
            </span>
          );
        })}
      </div>
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
      {decision.squidNote && <p className="thinking-squid">{decision.squidNote}</p>}
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
