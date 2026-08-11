/**
 * 色ユーティリティと配色ファミリー定義。
 *
 * 方針（指示書 §12「彩度と明度の組み合わせが不快にならない」）:
 *   - 完全な自由色相ランダムは使わない。配色ファミリー（palette 遺伝子座）で
 *     色相・彩度・明度のレンジを制約する。
 *   - 輪郭は常に「本体色を暗く濁らせたインク」にして、彩度の暴走を防ぐ。
 *   - アクセント色は本体色と調和する角度（補色 / 三角配色 / 隣接）からのみ選ぶ。
 */

export interface Rgb { r: number; g: number; b: number }

const hex2 = (n: number): string =>
  Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return `#${hex2(f(0))}${hex2(f(8))}${hex2(f(4))}`;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex({
    r: A.r + (B.r - A.r) * t,
    g: A.g + (B.g - A.g) * t,
    b: A.b + (B.b - A.b) * t,
  });
}

export const lighten = (hex: string, t: number): string => mix(hex, '#ffffff', t);
export const darken = (hex: string, t: number): string => mix(hex, '#000000', t);

/** 相対輝度（WCAG）。コントラスト検査に使う。 */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const f = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG コントラスト比（1..21）。 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

// ─────────────────────────────────────────────────────────
//  配色ファミリー
// ─────────────────────────────────────────────────────────

export interface PaletteFamily {
  id: string;
  label: string;
  /** 基本色相のレンジ（度）。360 をまたぐ場合は hi > 360 で表現する。 */
  hue: [number, number];
  /** 彩度レンジ（%）。 */
  sat: [number, number];
  /** 明度レンジ（%）。 */
  light: [number, number];
  /** アクセント色相のオフセット候補（度）。 */
  accentShift: readonly number[];
  /** 出現重み。 */
  weight: number;
  /** 珍しい配色か。 */
  rare?: boolean;
}

/**
 * 10 系統。どれも「淡い紙の上に置いて気持ちよく見える」範囲に収めてある。
 * 蛍光色・極端な高彩度低明度の組み合わせは意図的に排除している。
 */
export const PALETTE_FAMILIES: readonly PaletteFamily[] = [
  { id: 'meadow', label: 'くさはら', hue: [78, 145], sat: [38, 62], light: [58, 74], accentShift: [-140, 40, 165], weight: 12 },
  { id: 'moss',   label: 'こけ',     hue: [95, 165], sat: [22, 44], light: [46, 64], accentShift: [150, -30, 45], weight: 9 },
  { id: 'frost',  label: 'しも',     hue: [178, 218], sat: [30, 54], light: [70, 84], accentShift: [155, -55, 40], weight: 10 },
  { id: 'lagoon', label: 'みずうみ', hue: [186, 232], sat: [42, 66], light: [58, 74], accentShift: [-150, 38, 160], weight: 11 },
  { id: 'dusk',   label: 'たそがれ', hue: [244, 292], sat: [32, 56], light: [56, 72], accentShift: [70, -80, 150], weight: 10 },
  { id: 'bloom',  label: 'はなびら', hue: [312, 355], sat: [40, 66], light: [70, 84], accentShift: [-135, 42, 160], weight: 10 },
  { id: 'coral',  label: 'さんご',   hue: [6, 34],   sat: [46, 72], light: [64, 78], accentShift: [160, -140, 46], weight: 10 },
  { id: 'ember',  label: 'おきび',   hue: [22, 48],  sat: [50, 74], light: [58, 72], accentShift: [165, -120, 42], weight: 8 },
  // しんじゅ: Visual Lab で 36 体を並べて初めて確認できた 2 つの問題を修正した。
  //  1. 明度 88・彩度 14 の個体は紙（#f8efdf, L≈93）とほぼ同値で、
  //     輪郭インクが無ければ消えていた。明度の上限を下げ彩度の下限を上げる。
  //  2. accentShift の 130 は色相 26〜62 から 156〜192（緑〜青緑）へ飛ぶため、
  //     模様や装飾が強い個体が「こけ」と区別できなくなっていた。
  //     真珠の虹色は青と菫が自然なので 210（菫寄り）に置き換える。
  { id: 'pearl',  label: 'しんじゅ', hue: [26, 62],  sat: [18, 34], light: [70, 82], accentShift: [175, -60, 210], weight: 8, rare: true },
  { id: 'mineral',label: 'こうせき', hue: [200, 268], sat: [16, 34], light: [48, 66], accentShift: [150, 62, -70], weight: 7, rare: true },
  // すみ: 無彩色。彩度をほぼ 0 にする。
  //
  // 【設計】完全な sat=0 の純灰にはしない。わずかに色みを残した灰のほうが
  //   紙（#f8efdf）の上で沈まず、印刷物のような品を持つ。色相は寒暖どちらにも
  //   振れるようにして「冷たい灰」「温かい灰」の両方が出るようにした。
  //   accentShift は使わず、目・模様・装飾だけが彩度を持つ設計にする
  //   （無彩色の体に一点だけ色がある絵は強い）。その扱いは phenotype 側の責務。
  { id: 'ash',    label: 'すみ',    hue: [18, 250],  sat: [0, 8],   light: [40, 78], accentShift: [0, 0, 0], weight: 9, rare: true },
];

export const PALETTE_BY_ID: Readonly<Record<string, PaletteFamily>> = Object.fromEntries(
  PALETTE_FAMILIES.map((p) => [p.id, p]),
);

/** 標本帳の紙。ゲノモンの背景として常に使う基準色。 */
export const PAPER = '#f8efdf';
export const PAPER_DARK = '#221d26';

/**
 * 輪郭インク色。本体色の色相を保ちつつ、明度を必ず十分低く落とす。
 * これにより「どんな配色でも輪郭がはっきり読める」ことを保証する。
 */
export function inkFor(bodyHex: string): string {
  const { h, s } = hexToHsl(bodyHex);
  return hslToHex(h, Math.min(46, s * 0.55 + 12), 22);
}
