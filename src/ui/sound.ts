/**
 * 音效：全部用 Web Audio 实时合成，不加载任何音频文件，也不加依赖。
 *
 * 牌局逻辑不知道声音的存在 —— GameStore 只往外抛事件（见 game/store.ts 的
 * GameEvent），由这里翻译成声音。所以 scripts/ 里在 Node 跑批量模拟时
 * 完全碰不到这个模块。
 */

export type SoundName =
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'allin'
  | 'deal'
  | 'flop'
  | 'turn'
  | 'river'
  | 'winHero'
  | 'winOther'
  | 'chop'
  | 'squid'
  | 'settleUp'
  | 'settleDown'
  | 'yourTurn';

const STORAGE_KEY = 'omaha-squid-sound';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

let enabled = true;
let volume = 0.7;

/* --- 偏好持久化 --- */

(function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { enabled?: boolean; volume?: number };
    if (typeof saved.enabled === 'boolean') enabled = saved.enabled;
    if (typeof saved.volume === 'number') volume = Math.min(1, Math.max(0, saved.volume));
  } catch {
    // localStorage 不可用（隐私模式等）时就用默认值
  }
})();

function savePrefs(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, volume }));
  } catch {
    // 存不进去不影响播放
  }
}

/* --- 音频上下文 --- */

/**
 * 浏览器要求 AudioContext 必须由用户手势创建/恢复，所以这里是懒初始化：
 * 第一次真正要发声时才建，之后每次都尝试 resume（标签页切回来会被挂起）。
 */
function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 复用同一段白噪声，筹码声和发牌声都从里面随机取一段。 */
function getNoise(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const length = Math.floor(c.sampleRate * 0.5);
    noiseBuffer = c.createBuffer(1, length, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/* --- 合成基元 --- */

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  /** 在时长内把频率扫到这个值，用来做上扬 / 下沉。 */
  sweepTo?: number;
  delay?: number;
}

function tone(freq: number, duration: number, opts: ToneOptions = {}): void {
  const c = ensureContext();
  if (!c || !master) return;
  const { type = 'sine', gain = 0.3, attack = 0.006, sweepTo, delay = 0 } = opts;
  const t = c.currentTime + delay;

  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (sweepTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + duration);
  }

  // 指数包络，起音快、尾巴自然衰减（exponentialRamp 不能碰 0，所以用极小值）
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.03);
}

interface NoiseOptions {
  type?: BiquadFilterType;
  freq: number;
  q?: number;
  gain?: number;
  sweepTo?: number;
  delay?: number;
  attack?: number;
}

function noise(duration: number, opts: NoiseOptions): void {
  const c = ensureContext();
  if (!c || !master) return;
  const { type = 'bandpass', freq, q = 1, gain = 0.2, sweepTo, delay = 0, attack = 0.004 } = opts;
  const t = c.currentTime + delay;

  const src = c.createBufferSource();
  src.buffer = getNoise(c);

  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  if (sweepTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + duration);
  }

  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  src.connect(filter).connect(env).connect(master);
  // 每次从噪声里随机取起点，避免连续几下筹码声听起来一模一样
  src.start(t, Math.random() * 0.3, duration + 0.05);
}

/** 一枚筹码落下：窄带噪声的短脆响 + 一点高频"叮"。 */
function chip(delay: number, pitch: number, gain = 1): void {
  noise(0.045, { type: 'bandpass', freq: 1900 * pitch, q: 6, gain: 0.34 * gain, delay, attack: 0.001 });
  noise(0.018, { type: 'highpass', freq: 4200, gain: 0.1 * gain, delay, attack: 0.001 });
}

/** 一叠筹码推进池子，间隔和音高都带随机抖动。 */
function chips(count: number, spread: number, gain = 1): void {
  let delay = 0;
  for (let i = 0; i < count; i++) {
    chip(delay, 0.85 + Math.random() * 0.35, gain);
    delay += spread * (0.55 + Math.random() * 0.9);
  }
}

/** 一张牌滑过桌面。 */
function swish(delay: number, gain: number): void {
  noise(0.09, { type: 'bandpass', freq: 3000, sweepTo: 900, q: 1.2, gain, delay, attack: 0.005 });
}

/* --- 各个音效 --- */

const VOICES: Record<SoundName, () => void> = {
  // 牌被推回去的闷响，最轻的一个音
  fold: () => {
    noise(0.16, { type: 'lowpass', freq: 1600, sweepTo: 380, gain: 0.15, attack: 0.008 });
    tone(150, 0.1, { gain: 0.08, sweepTo: 90 });
  },

  // 敲两下桌子
  check: () => {
    for (const d of [0, 0.11]) {
      tone(105, 0.07, { type: 'triangle', gain: 0.24, sweepTo: 62, delay: d });
      noise(0.03, { type: 'lowpass', freq: 900, gain: 0.15, delay: d, attack: 0.001 });
    }
  },

  call: () => chips(2, 0.075),

  bet: () => {
    chips(3, 0.07);
    tone(420, 0.16, { type: 'triangle', gain: 0.1, sweepTo: 560, delay: 0.02 });
  },

  raise: () => {
    chips(5, 0.06);
    tone(440, 0.2, { type: 'triangle', gain: 0.13, sweepTo: 700, delay: 0.02 });
  },

  // 全下：一大把筹码 + 低频冲击 + 上扬扫频
  allin: () => {
    chips(9, 0.05, 1.1);
    tone(70, 0.5, { gain: 0.3, sweepTo: 44 });
    tone(330, 0.42, { type: 'sawtooth', gain: 0.09, sweepTo: 990, delay: 0.03 });
    tone(660, 0.5, { type: 'triangle', gain: 0.08, sweepTo: 1320, delay: 0.06 });
  },

  deal: () => {
    for (let i = 0; i < 5; i++) swish(i * 0.07, 0.14);
  },

  flop: () => {
    for (let i = 0; i < 3; i++) swish(i * 0.1, 0.21);
  },

  turn: () => {
    swish(0, 0.23);
    tone(520, 0.1, { gain: 0.07, delay: 0.05 });
  },

  river: () => {
    swish(0, 0.23);
    tone(620, 0.12, { gain: 0.08, delay: 0.05 });
  },

  // 你赢了：C-E-G-C 上行 + 收池
  winHero: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(f, 0.4, { type: 'triangle', gain: 0.19, delay: i * 0.085 }),
    );
    chips(6, 0.05, 0.8);
  },

  // 别人赢：中性的收池声，不带情绪
  winOther: () => {
    noise(0.3, { type: 'lowpass', freq: 2200, sweepTo: 600, gain: 0.12, attack: 0.02 });
    chips(4, 0.06, 0.75);
  },

  // 平分底池：同一个音敲两下
  chop: () => {
    tone(440, 0.22, { type: 'triangle', gain: 0.15 });
    tone(440, 0.22, { type: 'triangle', gain: 0.15, delay: 0.14 });
  },

  // 拿到鱿鱼：俏皮的水泡音
  squid: () => {
    tone(300, 0.13, { gain: 0.25, sweepTo: 1050 });
    tone(900, 0.1, { gain: 0.13, sweepTo: 1600, delay: 0.1 });
    noise(0.05, { type: 'bandpass', freq: 2600, q: 8, gain: 0.07, delay: 0.02 });
  },

  // 结算收钱：上行铃声
  settleUp: () => {
    [659.25, 830.61, 987.77, 1318.5].forEach((f, i) =>
      tone(f, 0.55, { gain: 0.16, delay: i * 0.1 }),
    );
  },

  // 结算买单：下行铃声
  settleDown: () => {
    [493.88, 415.3, 349.23, 261.63].forEach((f, i) =>
      tone(f, 0.5, { gain: 0.16, delay: i * 0.11 }),
    );
  },

  // 轮到你行动
  yourTurn: () => {
    tone(880, 0.14, { gain: 0.15 });
    tone(1318.5, 0.2, { gain: 0.12, delay: 0.1 });
  },
};

/* --- 对外接口 --- */

/** 播放一个音效；delayMs 用来把同时触发的几个音错开，避免糊成一团。 */
export function playSound(name: SoundName, delayMs = 0): void {
  if (!enabled) return;
  if (!ensureContext()) return;
  if (delayMs > 0) {
    window.setTimeout(() => {
      if (enabled) VOICES[name]();
    }, delayMs);
    return;
  }
  VOICES[name]();
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  savePrefs();
  // 开启时顺手建好上下文 —— 这次点击本身就是浏览器要的用户手势
  if (value) ensureContext();
}

export function getSoundVolume(): number {
  return volume;
}

export function setSoundVolume(value: number): void {
  volume = Math.min(1, Math.max(0, value));
  savePrefs();
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.01);
}
