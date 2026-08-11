/**
 * seed 付き疑似乱数生成器。
 *
 * 【最重要ルール】
 *   描画・遺伝・表現型変換のパスで Math.random() を直接呼んではならない。
 *   必ずこのモジュールの RNG を使い、seed から決定論的に値を得ること。
 *
 * 【描画順に依存しないための設計】
 *   単一の RNG を全パーツで共有すると、描画順や条件分岐が変わるだけで
 *   後続パーツの見た目が変化してしまう（指示書 §13 違反）。
 *   そのため「名前付きサブストリーム」を使う。
 *
 *     const rng = new Rng(seed);
 *     const earRng = rng.stream('ears');   // 'ears' 専用の独立系列
 *
 *   'ears' の系列は他のパーツが何回 next() を呼んでも影響を受けない。
 */

/** 文字列 → 32bit ハッシュ（xmur3）。 */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** sfc32 相当の高速・高品質 PRNG。 */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly _next: () => number;
  readonly seed: string;

  constructor(seed: string | number) {
    this.seed = String(seed);
    const h = hashString(this.seed);
    // 4 つの状態語を seed から派生させ、初期の相関を捨てるため空回しする。
    const s = sfc32(
      h,
      hashString(this.seed + ''),
      hashString(this.seed + ''),
      hashString(this.seed + ''),
    );
    for (let i = 0; i < 12; i++) s();
    this._next = s;
  }

  /** 0 以上 1 未満。 */
  next(): number {
    return this._next();
  }

  /** [lo, hi) の実数。 */
  float(lo: number, hi: number): number {
    return lo + this._next() * (hi - lo);
  }

  /** [lo, hi] の整数。 */
  int(lo: number, hi: number): number {
    return Math.floor(lo + this._next() * (hi - lo + 1));
  }

  /** 確率 p で true。 */
  bool(p = 0.5): boolean {
    return this._next() < p;
  }

  /** 配列から 1 つ選ぶ。空配列は例外。 */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick: empty array');
    return arr[Math.floor(this._next() * arr.length)]!;
  }

  /** 重み付き選択。weights は arr と同じ長さ。 */
  pickWeighted<T>(arr: readonly T[], weights: readonly number[]): T {
    if (arr.length === 0) throw new Error('Rng.pickWeighted: empty array');
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return arr[0]!;
    let r = this._next() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= Math.max(0, weights[i] ?? 0);
      if (r < 0) return arr[i]!;
    }
    return arr[arr.length - 1]!;
  }

  /** 平均 0・標準偏差 1 の正規乱数（Box-Muller）。 */
  gauss(): number {
    const u = Math.max(1e-9, this._next());
    const v = this._next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** mean を中心に spread の広がりを持つ 0..1 のクランプ値。 */
  around(mean: number, spread: number): number {
    return clamp01(mean + this.gauss() * spread);
  }

  /** 配列をシャッフルした新しい配列を返す（Fisher-Yates）。 */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      const t = out[i]!;
      out[i] = out[j]!;
      out[j] = t;
    }
    return out;
  }

  /**
   * 名前付きサブストリームを作る。
   * 同じ (seed, name) からは常に同じ系列が得られ、
   * 親 RNG の消費回数には一切影響されない。
   */
  stream(name: string): Rng {
    return new Rng(`${this.seed}#${name}`);
  }
}

/** 0..1 にクランプ。 */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 任意範囲へクランプ。 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 線形補間。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 0..1 の値を lo..hi へ写す。 */
export function mapRange(t: number, lo: number, hi: number): number {
  return lo + clamp01(t) * (hi - lo);
}

/** なめらかな 0..1（smoothstep）。 */
export function smooth(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * 人間が読み書きしやすい seed 文字列を決定論的に作る。
 * 例: makeSeed('world-abc', 12) → 'KQ7M-3XPA'
 */
export function makeSeed(worldSeed: string, counter: number): string {
  const rng = new Rng(`${worldSeed}/seed/${counter}`);
  let s = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-';
    s += SEED_ALPHABET[rng.int(0, SEED_ALPHABET.length - 1)];
  }
  return s;
}

/** 実時間由来のワールド seed（新規ゲーム開始時のみ使用）。 */
export function makeWorldSeed(): string {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `w-${t}-${r}`;
}

/** 入力文字列を seed として正規化する（Visual Lab の手入力用）。 */
export function normalizeSeed(input: string): string {
  const s = input.trim();
  return s.length === 0 ? 'GENOMON' : s;
}
