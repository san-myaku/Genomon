/**
 * 効果音の定義（指示書 §18）。
 *
 * すべて Synth による合成音。外部素材は一切使わない。
 *
 * 【鳴き声の個体差】
 *   voice() は seed と性格から「基本周波数・倍音構成・長さ・ビブラート」を決める。
 *   同じ個体は常に同じ声で鳴き、別の個体は必ず違う声になる。
 *     基本周波数  ← seed ハッシュ + 体の大きさ傾向（小さいほど高い）
 *     長さ        ← 活発さ（活発なほど短く弾む）
 *     倍音の数    ← 好奇心（高いほど倍音が増えて明るい）
 *     ビブラート  ← 人懐こさ
 *   反応（happy / dislike / sleepy …）で音程の輪郭を変える。
 */

import type { CareResult, Personality } from '../core/types.ts';
import { hashString } from '../core/rng.ts';
import { NOTE, Synth } from './synth.ts';

export type SfxName =
  | 'tap'          // ボタン操作
  | 'back'         // 戻る・閉じる
  | 'deny'         // 押せない操作
  | 'eggPick'      // 卵の選択
  | 'eggWobble'    // 卵の揺れ
  | 'eggConfirm'   // 卵の確定
  | 'hatch'        // 孵化
  | 'feed'         // 餌を食べる
  | 'drink'        // 水を飲む
  | 'clean'        // きれいにする
  | 'pet'          // なでる
  | 'play'         // あそぶ
  | 'rest'         // やすませる
  | 'grow'         // 成長（成体化）
  | 'judge'        // 展示会の評価
  | 'fanfare'      // 展示会の結果発表
  | 'coin'         // コイン獲得
  | 'unlock'       // 機能・ショップ解放
  | 'buy'          // 購入
  | 'breed'        // 交配
  | 'rare'         // 珍しい形質の発現
  | 'save';        // 保存

/** 声の設計図。個体ごとに 1 度だけ計算してキャッシュする。 */
interface VoiceSpec {
  base: number;
  partials: number[];
  dur: number;
  vibDepth: number;
  vibRate: number;
  wave: 'sine' | 'triangle';
}

export class Sfx {
  readonly synth = new Synth();
  private voiceCache = new Map<string, VoiceSpec>();
  /** 最初のユーザー操作で unlock 済みか。 */
  private unlocked = false;

  /** 最初のユーザー操作から呼ぶ（自動再生制限への対応）。 */
  unlock(): void {
    this.synth.unlock();
    this.unlocked = true;
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  setVolume(v: number): void { this.synth.setVolume(v); }
  setMuted(m: boolean): void { this.synth.setMuted(m); }

  /** 名前付き効果音。 */
  play(name: SfxName): void {
    const s = this.synth;
    if (!s.ready) return;
    if (!s.throttle(name === 'tap' ? 40 : 20)) return;

    switch (name) {
      // ── UI ────────────────────────────────────────────
      case 'tap':
        // 木の器具を軽く置いたような、短くやわらかい音。
        s.tone({ freq: NOTE.E5, wave: 'sine', dur: 0.075, gain: 0.16, lowpass: 2600 });
        s.tone({ freq: NOTE.B5, wave: 'sine', dur: 0.05, gain: 0.06, delay: 0.012 });
        break;
      case 'back':
        s.tone({ freq: NOTE.B4, toFreq: NOTE.E4, wave: 'sine', dur: 0.13, gain: 0.14 });
        break;
      case 'deny':
        // 拒否は不快にしない。低めの短い 2 連打だけ。
        s.tone({ freq: 190, wave: 'triangle', dur: 0.07, gain: 0.13, lowpass: 900 });
        s.tone({ freq: 158, wave: 'triangle', dur: 0.09, gain: 0.12, delay: 0.085, lowpass: 900 });
        break;

      // ── 卵 ────────────────────────────────────────────
      case 'eggPick':
        s.tone({ freq: NOTE.G5, toFreq: NOTE.D6, wave: 'sine', dur: 0.16, gain: 0.16 });
        s.tone({ freq: NOTE.D6, wave: 'sine', dur: 0.24, gain: 0.07, delay: 0.06 });
        s.noise({ band: 5200, bandTo: 8200, q: 2, dur: 0.16, gain: 0.05, delay: 0.02 });
        break;
      case 'eggWobble':
        // 殻がころりと揺れる。低い胴鳴り + かすかな摩擦。
        s.tone({ freq: 132, toFreq: 108, wave: 'sine', dur: 0.2, gain: 0.17, lowpass: 500 });
        s.noise({ band: 900, bandTo: 420, q: 1.4, dur: 0.18, gain: 0.05, delay: 0.02 });
        break;
      case 'eggConfirm':
        s.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], { wave: 'sine', dur: 0.3, gain: 0.14, step: 0.085 });
        break;
      case 'hatch':
        // 殻のひび（ノイズの粒） → 光が差す上昇アルペジオ。
        s.noise({ band: 2600, q: 3, dur: 0.05, gain: 0.16 });
        s.noise({ band: 3400, q: 3, dur: 0.05, gain: 0.14, delay: 0.11 });
        s.noise({ band: 1800, q: 2, dur: 0.09, gain: 0.17, delay: 0.22 });
        s.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6], {
          wave: 'triangle', dur: 0.4, gain: 0.15, step: 0.075, delay: 0.34, lowpass: 4200,
        });
        break;

      // ── 世話 ──────────────────────────────────────────
      case 'feed':
        // 「もぐもぐ」。低い矩形波を 2 回、ピッチを落としながら。
        s.tone({ freq: 300, toFreq: 205, wave: 'square', dur: 0.1, gain: 0.1, lowpass: 760 });
        s.tone({ freq: 265, toFreq: 178, wave: 'square', dur: 0.11, gain: 0.09, delay: 0.14, lowpass: 700 });
        break;
      case 'drink':
        s.tone({ freq: 620, toFreq: 1180, wave: 'sine', dur: 0.11, gain: 0.11, lowpass: 2400 });
        s.tone({ freq: 520, toFreq: 980, wave: 'sine', dur: 0.1, gain: 0.09, delay: 0.13 });
        break;
      case 'clean':
        // 布でこするブラシ音。帯域を上下に掃引して 2 往復。
        s.noise({ band: 1900, bandTo: 3400, q: .9, dur: 0.17, gain: 0.09 });
        s.noise({ band: 3200, bandTo: 1700, q: .9, dur: 0.17, gain: 0.08, delay: 0.18 });
        break;
      case 'pet':
        // やわらかい撫で。ノイズの緩やかな掃引 + 小さな倍音。
        s.noise({ band: 720, bandTo: 1500, q: .7, dur: 0.32, gain: 0.07, attack: 0.09 });
        s.tone({ freq: NOTE.A4, toFreq: NOTE.E5, wave: 'sine', dur: 0.3, gain: 0.07, attack: 0.08 });
        break;
      case 'play':
        s.arp([NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5], { wave: 'triangle', dur: 0.14, gain: 0.12, step: 0.06 });
        break;
      case 'rest':
        s.tone({ freq: NOTE.E4, toFreq: NOTE.C4, wave: 'sine', dur: 0.6, gain: 0.11, attack: 0.1, lowpass: 1400 });
        break;

      // ── 進行 ──────────────────────────────────────────
      case 'grow':
        s.arp([NOTE.C4, NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], {
          wave: 'triangle', dur: 0.46, gain: 0.14, step: 0.085, lowpass: 4600,
        });
        s.noise({ band: 6200, bandTo: 9000, q: 1.6, dur: 0.5, gain: 0.05, delay: 0.2 });
        break;
      case 'judge':
        // 真鍮のベル。倍音を非整数比にして金属らしさを出す。
        s.tone({ freq: 880, wave: 'sine', dur: 0.9, gain: 0.13, attack: 0.004 });
        s.tone({ freq: 880 * 2.76, wave: 'sine', dur: 0.5, gain: 0.05, attack: 0.003 });
        s.tone({ freq: 880 * 5.4, wave: 'sine', dur: 0.28, gain: 0.025, attack: 0.003 });
        break;
      case 'fanfare':
        s.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], { wave: 'triangle', dur: 0.26, gain: 0.13, step: 0.1 });
        s.arp([NOTE.G5, NOTE.C6, NOTE.E6], { wave: 'sine', dur: 0.55, gain: 0.1, step: 0.09, delay: 0.42 });
        break;
      case 'coin':
        s.tone({ freq: NOTE.B5, wave: 'sine', dur: 0.09, gain: 0.13 });
        s.tone({ freq: NOTE.E6, wave: 'sine', dur: 0.32, gain: 0.11, delay: 0.06 });
        s.noise({ band: 7600, q: 3, dur: 0.2, gain: 0.04, delay: 0.06 });
        break;
      case 'unlock':
        s.arp([NOTE.F4, NOTE.A4, NOTE.C5, NOTE.F5], { wave: 'sine', dur: 0.55, gain: 0.12, step: 0.1 });
        break;
      case 'buy':
        s.tone({ freq: NOTE.C5, wave: 'sine', dur: 0.1, gain: 0.13 });
        s.tone({ freq: NOTE.G5, wave: 'sine', dur: 0.22, gain: 0.11, delay: 0.08 });
        break;
      case 'breed':
        // 2 つの声が寄り添って 1 つになる、という形の音。
        s.tone({ freq: NOTE.E4, toFreq: NOTE.A4, wave: 'sine', dur: 0.55, gain: 0.1, attack: 0.06, pan: -0.5 });
        s.tone({ freq: NOTE.C5, toFreq: NOTE.A4, wave: 'sine', dur: 0.55, gain: 0.1, attack: 0.06, pan: 0.5 });
        s.tone({ freq: NOTE.A5, wave: 'sine', dur: 0.5, gain: 0.08, delay: 0.5 });
        break;
      case 'rare':
        // 珍しい形質。きらめく高音のアルペジオ。
        s.arp([NOTE.E5, NOTE.G5, NOTE.B5, NOTE.E6, NOTE.G6], {
          wave: 'sine', dur: 0.5, gain: 0.11, step: 0.06,
        });
        s.noise({ band: 8600, bandTo: 12000, q: 4, dur: 0.6, gain: 0.04, delay: 0.1 });
        break;
      case 'save':
        s.tone({ freq: NOTE.C5, wave: 'sine', dur: 0.06, gain: 0.06, lowpass: 2000 });
        break;
    }
  }

  /**
   * ゲノモンの短い鳴き声。個体の seed と性格で必ず変わる。
   * reaction を渡すと音程の輪郭が変わる（喜び＝上昇、いや＝下降 …）。
   */
  voice(seed: string, personality: Personality | null | undefined, reaction: CareResult['reaction'] = 'neutral'): void {
    const s = this.synth;
    if (!s.ready) return;
    if (!s.throttle(60)) return;

    const spec = this.voiceSpec(seed, personality);

    // 反応ごとの音程の輪郭（半音比）。
    const contour: Record<CareResult['reaction'], { a: number; b: number; g: number; d: number }> = {
      delighted: { a: 1.0, b: 1.55, g: 1.15, d: 1.1 },
      happy: { a: 1.0, b: 1.28, g: 1.0, d: 1.0 },
      neutral: { a: 1.0, b: 1.06, g: 0.85, d: 0.95 },
      full: { a: 1.0, b: 0.9, g: 0.85, d: 1.05 },
      dislike: { a: 1.0, b: 0.72, g: 0.9, d: 0.9 },
      sleepy: { a: 0.86, b: 0.7, g: 0.7, d: 1.7 },
    };
    const c = contour[reaction] ?? contour.neutral;

    const dur = spec.dur * c.d;
    const f0 = spec.base * c.a;
    const f1 = spec.base * c.b;

    spec.partials.forEach((mult, i) => {
      s.tone({
        freq: f0 * mult,
        toFreq: f1 * mult,
        wave: i === 0 ? spec.wave : 'sine',
        dur: dur * (i === 0 ? 1 : 0.78),
        gain: (0.16 * c.g) / (i + 1.35),
        attack: reaction === 'sleepy' ? 0.09 : 0.014,
        lowpass: 5200,
        vibrato: i === 0 && spec.vibDepth > 0
          ? { depth: spec.vibDepth * mult, rate: spec.vibRate }
          : undefined,
      });
    });

    // 甘えん坊・人懐こい個体は 2 声目を足して「もう一回鳴く」。
    if (reaction === 'delighted' || reaction === 'happy') {
      s.tone({
        freq: f1,
        toFreq: f1 * 1.18,
        wave: spec.wave,
        dur: dur * 0.7,
        gain: 0.1 * c.g,
        delay: dur * 1.1,
        lowpass: 5200,
      });
    }
  }

  /** 個体ごとの声の設計図（決定論的・キャッシュ付き）。 */
  private voiceSpec(seed: string, p: Personality | null | undefined): VoiceSpec {
    const cached = this.voiceCache.get(seed);
    if (cached) return cached;

    const h = hashString(`voice:${seed}`);
    const r1 = ((h >>> 0) % 1000) / 1000;
    const r2 = ((h >>> 10) % 1000) / 1000;
    const r3 = ((h >>> 20) % 1000) / 1000;

    const energy = p?.energy ?? 0.5;
    const curiosity = p?.curiosity ?? 0.5;
    const affection = p?.affection ?? 0.5;
    const dependence = p?.dependence ?? 0.5;

    // 基本周波数 250〜700Hz。活発な子ほど少し高く、seed で大きくばらす。
    const base = 250 + r1 * 380 + energy * 70;

    // 倍音。好奇心が高いほど倍音が増えて明るい音色になる。
    const count = 1 + Math.round(curiosity * 2 + r2 * 1.4);
    const partials: number[] = [1];
    const ratios = [2, 3, 1.5, 4];
    for (let i = 0; i < count && i < ratios.length; i++) partials.push(ratios[i]!);

    const spec: VoiceSpec = {
      base,
      partials,
      // 活発な子は短く弾み、おとなしい子は長く伸ばす。
      dur: 0.18 + (1 - energy) * 0.16 + r3 * 0.06,
      // 人懐こく甘えん坊な子ほど声が揺れる。
      vibDepth: (affection * 0.6 + dependence * 0.4) * 18,
      vibRate: 5 + r2 * 4 + energy * 3,
      wave: r3 > 0.55 ? 'triangle' : 'sine',
    };
    this.voiceCache.set(seed, spec);
    return spec;
  }
}

/** アプリ全体で 1 つだけ使う効果音インスタンス。 */
export const sfx = new Sfx();
