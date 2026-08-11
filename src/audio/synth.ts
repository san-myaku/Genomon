/**
 * Web Audio API による合成音の土台。
 *
 * 【方針（指示書 §18）】
 *   - 外部の著作権素材を一切使わない。すべてこの場で合成する。
 *   - 突然大きな音を鳴らさない。マスターゲインは常に控えめな上限（MASTER_CEIL）で頭打ちにする。
 *   - ブラウザの自動再生制限に対応する。AudioContext は「最初のユーザー操作」でだけ作る。
 *     操作前に鳴らそうとした音は、単に鳴らない（例外を投げない）。
 *
 * 【設計】
 *   AudioContext は 1 つだけ持ち、master(GainNode) → destination で終端する。
 *   個々の音は tone()/noise() を組み合わせて作り、必ず ADSR 相当の包絡線で
 *   立ち上がり・減衰を付ける（矩形に切ると「プツッ」というクリックノイズが出る）。
 */

/** マスターゲインの上限。1.0 にすると音割れするうえ耳に痛いので 0.34 で頭打ちにする。 */
const MASTER_CEIL = 0.34;

export type WaveKind = 'sine' | 'triangle' | 'square' | 'sawtooth';

export interface ToneOpts {
  /** 基本周波数（Hz）。 */
  freq: number;
  /** 終端周波数。省略時は freq（グライドなし）。 */
  toFreq?: number;
  /** 波形。 */
  wave?: WaveKind;
  /** 長さ（秒）。 */
  dur?: number;
  /** 音量（0..1、master 前の相対値）。 */
  gain?: number;
  /** 開始遅延（秒）。 */
  delay?: number;
  /** 立ち上がり（秒）。 */
  attack?: number;
  /** ローパスの遮断周波数（Hz）。省略でフィルタなし。 */
  lowpass?: number;
  /** ハイパスの遮断周波数（Hz）。 */
  highpass?: number;
  /** ビブラートの深さ（Hz）と速さ（Hz）。 */
  vibrato?: { depth: number; rate: number };
  /** 左右の定位（-1..1）。 */
  pan?: number;
}

export interface NoiseOpts {
  dur?: number;
  gain?: number;
  delay?: number;
  attack?: number;
  /** バンドパスの中心周波数。 */
  band?: number;
  q?: number;
  lowpass?: number;
  /** 中心周波数の終端（掃引）。 */
  bandTo?: number;
  pan?: number;
}

export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private volume = 0.7;
  private muted = false;
  /** 直近に音を出した時刻（同一フレームでの音の重なりすぎを抑える）。 */
  private lastAt = 0;

  /**
   * ユーザー操作のハンドラから呼ぶ。ここで初めて AudioContext を作る。
   * すでに作られていて suspended なら resume する。
   */
  unlock(): void {
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        this.ctx = null;
        return;
      }
      const g = this.ctx.createGain();
      g.gain.value = this.effectiveGain();
      g.connect(this.ctx.destination);
      this.master = g;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** 音が出せる状態か。 */
  get ready(): boolean {
    return !!this.ctx && !!this.master && this.ctx.state === 'running';
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyGain();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }

  private effectiveGain(): number {
    // volume を二乗するのは、スライダーの見た目と体感音量を合わせるため（人の聴覚は対数的）。
    return this.muted ? 0 : MASTER_CEIL * this.volume * this.volume;
  }

  private applyGain(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.effectiveGain(), t, 0.02);
  }

  /** 現在時刻（秒）。未初期化なら 0。 */
  now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * 短時間に音が殺到したときの間引き。
   * 連打で 10 個以上の音が重なると音圧が跳ね上がって耳に痛いので防ぐ。
   */
  throttle(minGapMs = 28): boolean {
    const t = Date.now();
    if (t - this.lastAt < minGapMs) return false;
    this.lastAt = t;
    return true;
  }

  /** 単音。 */
  tone(o: ToneOpts): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;

    const t0 = ctx.currentTime + (o.delay ?? 0);
    const dur = Math.max(0.02, o.dur ?? 0.18);
    const peak = Math.max(0.0001, o.gain ?? 0.3);
    const atk = Math.min(Math.max(o.attack ?? 0.008, 0.002), dur * 0.5);

    const osc = ctx.createOscillator();
    osc.type = o.wave ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, o.freq), t0);
    if (o.toFreq && o.toFreq !== o.freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.toFreq), t0 + dur);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    let node: AudioNode = osc;
    if (o.highpass) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = o.highpass;
      node.connect(hp);
      node = hp;
    }
    if (o.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.lowpass;
      node.connect(lp);
      node = lp;
    }
    node.connect(gain);

    let tail: AudioNode = gain;
    if (o.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      gain.connect(p);
      tail = p;
    }
    tail.connect(master);

    if (o.vibrato && o.vibrato.depth > 0) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = o.vibrato.rate;
      const lg = ctx.createGain();
      lg.gain.value = o.vibrato.depth;
      lfo.connect(lg);
      lg.connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.02);
    }

    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** ホワイトノイズ（掃除・羽ばたき・殻のひび・紙の音）。 */
  noise(o: NoiseOpts = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;

    if (!this.noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 1.2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      // 決定論性は不要（音は保存対象ではない）。ここだけ Math.random を使ってよい。
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }

    const t0 = ctx.currentTime + (o.delay ?? 0);
    const dur = Math.max(0.03, o.dur ?? 0.22);
    const peak = Math.max(0.0001, o.gain ?? 0.16);
    const atk = Math.min(Math.max(o.attack ?? 0.01, 0.002), dur * 0.5);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;

    let node: AudioNode = src;
    if (o.band) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(o.band, t0);
      if (o.bandTo) bp.frequency.exponentialRampToValueAtTime(Math.max(40, o.bandTo), t0 + dur);
      bp.Q.value = o.q ?? 1.2;
      node.connect(bp);
      node = bp;
    }
    if (o.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.lowpass;
      node.connect(lp);
      node = lp;
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(gain);

    let tail: AudioNode = gain;
    if (o.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      gain.connect(p);
      tail = p;
    }
    tail.connect(master);

    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** 和音・アルペジオ。step 秒ずつずらして鳴らす。 */
  arp(freqs: readonly number[], o: Omit<ToneOpts, 'freq'> & { step?: number } = {}): void {
    const step = o.step ?? 0.075;
    freqs.forEach((f, i) => {
      this.tone({ ...o, freq: f, delay: (o.delay ?? 0) + i * step });
    });
  }
}

/** 音名 → 周波数（A4=440Hz）。旋律を書きやすくするための補助。 */
export const NOTE: Readonly<Record<string, number>> = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98,
};
