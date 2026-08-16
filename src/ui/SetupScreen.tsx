import { useState } from 'react';
import { BOT_PROFILES } from '../bots/profiles';
import { DEFAULT_SQUID_CONFIG } from '../engine/squid';
import type { SeatSetup, SessionConfig } from '../game/session';
import { DEFAULT_SESSION_CONFIG } from '../game/session';

interface Props {
  onStart: (setups: SeatSetup[], config: SessionConfig) => void;
}

const BOT_NAMES = ['阿泰', '老鹰', '石头', '大鱼', '疯狗', '小林', '阿杰', '老周'];
const DEFAULT_ASSIGNMENT = ['tag', 'lag', 'nit', 'station', 'maniac', 'gto', 'limper', 'tag'];

export function SetupScreen({ onStart }: Props) {
  const [playerCount, setPlayerCount] = useState(6);
  const [profiles, setProfiles] = useState<string[]>(DEFAULT_ASSIGNMENT);
  const [bigBlind, setBigBlind] = useState(100);
  const [startingStack, setStartingStack] = useState(10000);
  const [squidEnabled, setSquidEnabled] = useState(true);
  const [baseValueBB, setBaseValueBB] = useState(2);
  const [squidOffset, setSquidOffset] = useState(3);
  const [earlyEnd, setEarlyEnd] = useState(true);
  const [botsKnowSquid, setBotsKnowSquid] = useState(true);
  const [autoRebuy, setAutoRebuy] = useState(true);
  const [heroName, setHeroName] = useState('你');

  const botCount = playerCount - 1;

  const setProfileAt = (index: number, value: string) => {
    setProfiles((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleStart = () => {
    const setups: SeatSetup[] = [
      { id: 'hero', name: heroName.trim() || '你', isHuman: true, profileId: 'gto' },
      ...Array.from({ length: botCount }, (_, i) => ({
        id: `bot${i + 1}`,
        name: BOT_NAMES[i],
        isHuman: false,
        profileId: profiles[i] ?? 'gto',
      })),
    ];

    const config: SessionConfig = {
      ...DEFAULT_SESSION_CONFIG,
      table: {
        smallBlind: Math.round(bigBlind / 2),
        bigBlind,
        startingStack,
        holeCards: 4,
      },
      squid: {
        ...DEFAULT_SQUID_CONFIG,
        baseValueBB,
        squidsPerPlayerOffset: squidOffset,
        endWhenOnePlayerLeft: earlyEnd,
      },
      squidEnabled,
      autoRebuy,
      botSquidAwareness: botsKnowSquid ? 1 : 0,
    };

    onStart(setups, config);
  };

  const squidTotal = playerCount + squidOffset;

  return (
    <div className="setup-screen">
      <header className="setup-header">
        <h1>
          <span className="title-squid">🦑</span> 奥马哈 · 鱿鱼局
        </h1>
        <p className="setup-subtitle">
          PLO4 底池限注 · 本地与机器人对战 · 内置 GTO 基准策略与风格偏移
        </p>
      </header>

      <div className="setup-grid">
        <section className="setup-card">
          <h2>牌桌</h2>

          <label className="field">
            <span>你的名字</span>
            <input
              type="text"
              value={heroName}
              maxLength={8}
              onChange={(e) => setHeroName(e.target.value)}
            />
          </label>

          <label className="field">
            <span>人数（含你）</span>
            <div className="segmented">
              {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button
                  key={n}
                  className={playerCount === n ? 'active' : ''}
                  onClick={() => setPlayerCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            <span>大盲（筹码）</span>
            <div className="segmented">
              {[50, 100, 200].map((n) => (
                <button key={n} className={bigBlind === n ? 'active' : ''} onClick={() => setBigBlind(n)}>
                  {n}
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            <span>起始筹码</span>
            <div className="segmented">
              {[50, 100, 200].map((n) => (
                <button
                  key={n}
                  className={startingStack === n * bigBlind ? 'active' : ''}
                  onClick={() => setStartingStack(n * bigBlind)}
                >
                  {n}BB
                </button>
              ))}
            </div>
          </label>

          <label className="checkbox-field">
            <input type="checkbox" checked={autoRebuy} onChange={(e) => setAutoRebuy(e.target.checked)} />
            <span>
              自动补码
              <em>筹码低于 10BB 时自动补回起始筹码，方便长时间练习</em>
            </span>
          </label>
        </section>

        <section className="setup-card">
          <h2>🦑 鱿鱼玩法</h2>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={squidEnabled}
              onChange={(e) => setSquidEnabled(e.target.checked)}
            />
            <span>
              启用鱿鱼游戏
              <em>关闭后就是纯粹的 PLO 现金局</em>
            </span>
          </label>

          <div className={squidEnabled ? '' : 'disabled-block'}>
            <label className="field">
              <span>每轮鱿鱼数</span>
              <div className="segmented">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    className={squidOffset === n ? 'active' : ''}
                    onClick={() => setSquidOffset(n)}
                  >
                    人数 + {n}
                  </button>
                ))}
              </div>
              <em className="field-hint">
                {playerCount} 人桌 → 每轮 <strong>{squidTotal}</strong> 条鱿鱼
              </em>
            </label>

            <label className="field">
              <span>每条基础价值</span>
              <div className="segmented">
                {[1, 2, 5].map((n) => (
                  <button
                    key={n}
                    className={baseValueBB === n ? 'active' : ''}
                    onClick={() => setBaseValueBB(n)}
                  >
                    {n}BB
                  </button>
                ))}
              </div>
              <em className="field-hint">持有 3 / 5 / 7 条时依次翻倍</em>
            </label>

            <label className="checkbox-field">
              <input type="checkbox" checked={earlyEnd} onChange={(e) => setEarlyEnd(e.target.checked)} />
              <span>
                最后一人提前结算
                <em>
                  只剩一人没有鱿鱼时立即结束本轮，由他独自买单。关闭则一直打到鱿鱼发完，
                  由持有最少的人平摊。
                </em>
              </span>
            </label>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={botsKnowSquid}
                onChange={(e) => setBotsKnowSquid(e.target.checked)}
              />
              <span>
                机器人会算鱿鱼
                <em>
                  机器人把「赢下这手能拿到的鱿鱼价值」算进底池赔率：本轮一条没拿、鱿鱼又快发完时，
                  它们会明显打得更松更凶。关掉就是只会算底池的纯扑克机器人。
                </em>
              </span>
            </label>

            {earlyEnd && playerCount === 2 && (
              <p className="setup-warning">
                ⚠️ 单挑桌只有 2 人，第一手牌分出胜负后就只剩 1 人没有鱿鱼，本轮会立刻结算。
                实际效果是每手牌输家固定支付 {baseValueBB}BB，鱿鱼的累积玩法失去意义。
                单挑建议关掉「提前结算」。
              </p>
            )}
          </div>
        </section>

        <section className="setup-card setup-card-wide">
          <h2>机器人风格</h2>
          <p className="setup-note">
            所有机器人共用同一套基准 GTO 策略（按位置划分范围、按底池赔率决策、按 b/(p+2b)
            平衡诈唬比例），风格只是在这些参数上做偏移。
          </p>

          <div className="bot-list">
            {Array.from({ length: botCount }, (_, i) => {
              const current = BOT_PROFILES.find((p) => p.id === (profiles[i] ?? 'gto'))!;
              return (
                <div className="bot-row" key={i}>
                  <div className="bot-name" style={{ borderColor: current.color }}>
                    {BOT_NAMES[i]}
                  </div>
                  <select value={profiles[i] ?? 'gto'} onChange={(e) => setProfileAt(i, e.target.value)}>
                    {BOT_PROFILES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <p className="bot-desc">{current.description}</p>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <button className="start-button" onClick={handleStart}>
        开始牌局
      </button>
    </div>
  );
}
