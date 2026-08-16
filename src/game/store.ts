/**
 * 界面用的状态容器。
 *
 * 牌局逻辑本身是可变对象（改起来快、也方便一步步驱动机器人），
 * 这里用一个版本号 + 订阅机制把它接到 React 的 useSyncExternalStore 上。
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { Rng } from '../engine/cards';
import type { Action } from '../engine/table';
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
  type SessionState,
} from './session';

export class GameStore {
  state: SessionState;
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

  /* --- 对局操作 --- */

  startHand(): void {
    beginHand(this.state, this.rng);
    this.notify();
  }

  humanAction(action: Action): void {
    if (!isHumanTurn(this.state)) return;
    submitAction(this.state, action);
    this.notify();
  }

  /** 让当前机器人走一步；返回是否真的行动了。 */
  stepBot(): boolean {
    const decision = stepBot(this.state, this.rng);
    if (decision) this.notify();
    return decision !== null;
  }

  confirmSettlement(): void {
    applySettlement(this.state);
    this.notify();
  }

  nextHand(): void {
    advanceButton(this.state);
    beginHand(this.state, this.rng);
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
