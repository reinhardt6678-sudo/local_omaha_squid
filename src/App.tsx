import { useEffect, useRef, useState } from 'react';
import { legalActions, type Action } from './engine/table';
import { GameStore, useGameStore } from './game/store';
import type { SeatSetup, SessionConfig } from './game/session';
import { ActionBar } from './ui/ActionBar';
import { PokerTable } from './ui/PokerTable';
import { SettlementModal } from './ui/SettlementModal';
import { SetupScreen } from './ui/SetupScreen';
import { SquidPanel } from './ui/SquidPanel';
import { BotThinking, HandLog, StatsPanel } from './ui/SidePanels';
import './styles.css';

/** 机器人每步之间的停顿，让牌局节奏看得清。 */
const BOT_DELAYS = [
  { label: '快', ms: 250 },
  { label: '中', ms: 650 },
  { label: '慢', ms: 1200 },
];

export default function App() {
  const [store, setStore] = useState<GameStore | null>(null);

  if (!store) {
    return (
      <SetupScreen
        onStart={(setups: SeatSetup[], config: SessionConfig) => {
          const created = new GameStore(setups, config);
          created.startHand();
          setStore(created);
        }}
      />
    );
  }

  return <Table store={store} onQuit={() => setStore(null)} />;
}

function Table({ store, onQuit }: { store: GameStore; onQuit: () => void }) {
  useGameStore(store);
  const state = store.state;

  const [delayIndex, setDelayIndex] = useState(1);
  const [showThinking, setShowThinking] = useState(true);
  const [autoNext, setAutoNext] = useState(true);
  const timerRef = useRef<number | null>(null);

  const botDelay = BOT_DELAYS[delayIndex].ms;
  const hand = state.hand;
  const humanTurn = store.isHumanTurn;

  /* --- 机器人按节奏依次行动 --- */
  useEffect(() => {
    if (state.phase !== 'playing' || humanTurn) return;
    const actor = store.actor;
    if (!actor) return;

    timerRef.current = window.setTimeout(() => {
      store.stepBot();
    }, botDelay);

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  });

  /* --- 一手牌结束后自动开始下一手 --- */
  useEffect(() => {
    if (state.phase !== 'handComplete' || !autoNext) return;
    const timer = window.setTimeout(() => store.nextHand(), 2400);
    return () => window.clearTimeout(timer);
  });

  // useGameStore 已经保证每次状态变化都会重渲染，这里直接算即可
  const legal = hand && humanTurn ? legalActions(hand) : null;

  const heroIndex = state.seats.findIndex((s) => s.isHuman);
  const handleAction = (action: Action) => store.humanAction(action);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand">
            🦑 奥马哈 · 鱿鱼局
          </span>
          <span className="topbar-meta">
            第 {state.handNumber} 手 · 盲注 {state.config.table.smallBlind / state.config.table.bigBlind}/1 BB
          </span>
        </div>

        <div className="topbar-right">
          <label className="toggle">
            <input
              type="checkbox"
              checked={showThinking}
              onChange={(e) => setShowThinking(e.target.checked)}
            />
            显示机器人思考
          </label>
          <label className="toggle">
            <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} />
            自动下一手
          </label>
          <div className="segmented segmented-sm">
            {BOT_DELAYS.map((d, i) => (
              <button key={d.label} className={delayIndex === i ? 'active' : ''} onClick={() => setDelayIndex(i)}>
                {d.label}
              </button>
            ))}
          </div>
          <button className="quit-button" onClick={onQuit}>
            退出
          </button>
        </div>
      </header>

      <div className="layout">
        <main className="main-column">
          {hand ? (
            <PokerTable
              hand={hand}
              seats={state.seats}
              heroIndex={heroIndex}
              squid={state.squid}
              squidEnabled={state.config.squidEnabled}
            />
          ) : (
            <div className="table-area table-idle">
              <button className="start-button" onClick={() => store.nextHand()}>
                开始下一手
              </button>
            </div>
          )}

          <div className="control-area">
            {legal && hand ? (
              <ActionBar legal={legal} hand={hand} onAction={handleAction} />
            ) : state.phase === 'handComplete' ? (
              <div className="waiting-bar">
                <span>本手结束</span>
                <button className="act-btn act-raise" onClick={() => store.nextHand()}>
                  下一手
                </button>
              </div>
            ) : (
              <div className="waiting-bar">
                <span className="thinking-dots">
                  {store.actor ? `${store.actor.name} 思考中` : '等待中'}
                </span>
              </div>
            )}
          </div>
        </main>

        <aside className="side-column">
          <SquidPanel
            squid={state.squid}
            seats={state.seats}
            config={state.config.squid}
            enabled={state.config.squidEnabled}
          />

          {showThinking && state.lastBotDecision && (
            <BotThinking
              seatName={
                state.seats.find((s) => s.id === state.lastBotDecision!.seatId)?.name ?? ''
              }
              decision={state.lastBotDecision.decision}
            />
          )}

          <StatsPanel
            seats={state.seats}
            stats={state.stats}
            bigBlind={state.config.table.bigBlind}
          />

          <HandLog log={state.log} />
        </aside>
      </div>

      {state.phase === 'settlement' && state.pendingSettlement && (
        <SettlementModal
          settlement={state.pendingSettlement}
          seats={state.seats}
          config={state.config.squid}
          onConfirm={() => store.confirmSettlement()}
        />
      )}
    </div>
  );
}
