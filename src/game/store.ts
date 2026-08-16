/**
 * 界面用的状态容器。
 *
 * 牌局逻辑本身是可变对象（改起来快、也方便一步步驱动机器人），
 * 这里用一个版本号 + 订阅机制把它接到 React 的 useSyncExternalStore 上。
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { Rng } from '../engine/cards';
import type { Action, ActionType, Street } from '../engine/table';
import {
  advanceButton,
  applySettlement,
  beginHand,
  createSession,
  currentActor,
  isHumanTurn,
  stepBot,
  submitAction,
  type SeatSetup,
  type SessionConfig,
  type SessionPhase,
  type SessionState,
} from './session';

/**
 * 牌局里「值得被听见」的瞬间。
 *
 * store 只负责把这些事件抛出来，怎么变成声音（或者别的反馈）是 ui 层的事，
 * 所以 session/engine 依然是纯逻辑，Node 里跑模拟脚本不受影响。
 */
export type GameEvent =
  | { type: 'action'; actionType: ActionType; allIn: boolean; isHuman: boolean }
  /** 发底牌，新的一手开始。 */
  | { type: 'deal' }
  /** 发公共牌。 */
  | { type: 'street'; street: 'flop' | 'turn' | 'river' }
  | { type: 'handEnd'; heroWon: boolean; chopped: boolean }
  | { type: 'squid'; count: number }
  | { type: 'settlement'; heroReceives: boolean }
  | { type: 'yourTurn' };

/** 用来和动作后的状态比对，推断出发生了什么。 */
interface Snapshot {
  street: Street | null;
  phase: SessionPhase;
  squidRemaining: number;
  humanTurn: boolean;
}

export class GameStore {
  state: SessionState;
  /** 由 ui 层挂上，用来接收牌局事件；不挂就什么都不发生。 */
  onEvent: ((event: GameEvent) => void) | null = null;
  private rng: Rng;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(setups: SeatSetup[], config: SessionConfig, seed?: number) {
    const { state, rng } = createSession(setups, config, seed);
    this.state = state;
    this.rng = rng;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /* --- 事件 --- */

  private emit(event: GameEvent): void {
    this.onEvent?.(event);
  }

  private snapshot(): Snapshot {
    return {
      street: this.state.hand?.street ?? null,
      phase: this.state.phase,
      squidRemaining: this.state.squid.remaining,
      humanTurn: isHumanTurn(this.state),
    };
  }

  /** 对比动作前后的状态，把中间发生的事情依次抛出去。 */
  private emitTransitions(before: Snapshot): void {
    if (!this.onEvent) return;
    const after = this.snapshot();
    const heroId = this.state.seats.find((s) => s.isHuman)?.id;

    // 街道推进 —— 发公共牌
    if (
      after.street !== before.street &&
      (after.street === 'flop' || after.street === 'turn' || after.street === 'river')
    ) {
      this.emit({ type: 'street', street: after.street });
    }

    // 一手牌打完
    if (before.phase === 'playing' && after.phase !== 'playing') {
      const result = this.state.hand?.result;
      if (result) {
        this.emit({
          type: 'handEnd',
          heroWon: heroId !== undefined && result.mainPotWinners.includes(heroId),
          chopped: result.mainPotWinners.length > 1,
        });
      }
    }

    // 有人拿到鱿鱼
    if (after.squidRemaining < before.squidRemaining) {
      this.emit({ type: 'squid', count: before.squidRemaining - after.squidRemaining });
    }

    // 弹出鱿鱼结算
    if (before.phase !== 'settlement' && after.phase === 'settlement') {
      const receivers = this.state.pendingSettlement?.receivers ?? [];
      this.emit({
        type: 'settlement',
        heroReceives: receivers.some((r) => r.playerId === heroId),
      });
    }

    // 轮到你了
    if (!before.humanTurn && after.humanTurn) {
      this.emit({ type: 'yourTurn' });
    }
  }

  /** 动作本身的事件。actorIndex 要在动作发生前取，动作后座位数组会被替换。 */
  private emitAction(action: Action, actorIndex: number, isHuman: boolean): void {
    if (!this.onEvent) return;
    this.emit({
      type: 'action',
      actionType: action.type,
      allIn: this.state.hand?.seats[actorIndex]?.allIn ?? false,
      isHuman,
    });
  }

  /* --- 对局操作 --- */

  startHand(): void {
    const before = this.snapshot();
    beginHand(this.state, this.rng);
    if (this.state.hand) this.emit({ type: 'deal' });
    this.emitTransitions(before);
    this.notify();
  }

  humanAction(action: Action): void {
    if (!isHumanTurn(this.state)) return;
    const before = this.snapshot();
    const actorIndex = this.state.hand!.actor;
    submitAction(this.state, action);
    this.emitAction(action, actorIndex, true);
    this.emitTransitions(before);
    this.notify();
  }

  /** 让当前机器人走一步；返回是否真的行动了。 */
  stepBot(): boolean {
    const before = this.snapshot();
    const actorIndex = this.state.hand?.actor ?? -1;
    const decision = stepBot(this.state, this.rng);
    if (decision) {
      this.emitAction(decision.action, actorIndex, false);
      this.emitTransitions(before);
      this.notify();
    }
    return decision !== null;
  }

  confirmSettlement(): void {
    applySettlement(this.state);
    this.notify();
  }

  nextHand(): void {
    const before = this.snapshot();
    advanceButton(this.state);
    beginHand(this.state, this.rng);
    if (this.state.hand) this.emit({ type: 'deal' });
    this.emitTransitions(before);
    this.notify();
  }

  get isHumanTurn(): boolean {
    return isHumanTurn(this.state);
  }

  get actor() {
    return currentActor(this.state);
  }
}

/** 订阅 store，任何状态变化都会触发重渲染。 */
export function useGameStore(store: GameStore): GameStore {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return store;
}
