/**
 * 遺伝子型 → 表現型（Phenotype）の変換。
 *
 * 【最重要】この変換は純粋関数である。
 *   同じ (Genotype, stage) からは常にビット単位で同じ Phenotype が出る。
 *   Math.random() は使わず、seed 由来の名前付きサブストリームのみを使う。
 *
 * 【表現規則】
 *   1. dominance が高い方が発現する。
 *   2. dominance が同値で両方 coDominant、かつ coExpress に合成表現が定義されていれば合成表現。
 *   3. それ以外の同値ヘテロは seed 由来で片方に決める（混ぜない）。
 *   4. base（素体）は必ず片方に決める。形が破綻するため合成しない。
 *   対立遺伝子ペアの順序 [母方, 父方] は表現に影響してはならないので、
 *   判定前に必ずソートして順序を消す。
 *
 * 【成長段階】
 *   stage の差分はここで解決する。特に幼体では
 *   羽・角・結晶・首かざり・浮遊物を 'none' に落とす。
 *   これが成体になったときの「隠れていた形質が出る」驚きになる。
 */

import { Rng, clamp, clamp01, lerp, mapRange, smooth } from '../core/rng.ts';
import {
  PALETTE_BY_ID,
  PALETTE_FAMILIES,
  contrastRatio,
  darken,
  hslToHex,
  inkFor,
  lighten,
  mix,
} from '../core/color.ts';
import type {
  BodyBase,
  CatLocus,
  CatPair,
  Genotype,
  NumLocus,
  Palette,
  PartExpression,
  Personality,
  Phenotype,
  Rarity,
  RarityTier,
  Stage,
  TraitSummary,
} from '../core/types.ts';
import {
  CAT_LOCUS_BY_ID,
  CAT_LOCUS_IDS,
  NUM_LOCUS_BY_ID,
  NUM_LOCUS_IDS,
  alleleDef,
  alleleLabel,
} from './loci.ts';
import { genotypeFingerprint } from './genotype.ts';

// ─────────────────────────────────────────────────────────
//  カテゴリ形質の発現
// ─────────────────────────────────────────────────────────

export interface ExpressedCat {
  /** 発現した表現 ID（合成表現を含む）。 */
  id: string;
  /** 日本語ラベル。 */
  label: string;
  /** 発現しなかった側の対立遺伝子 ID（保因）。共優性・ホモのときは空文字。 */
  hidden: string;
  /** 珍しい形質として提示すべきか。 */
  notable: boolean;
  /** 保因している側が notable（隠れ形質）か。 */
  hiddenNotable: boolean;
  /** 潜性（dominance <= 2）が表に出たか。 */
  recessive: boolean;
  /** 共優性の合成表現か。 */
  coExpressed: boolean;
}

/**
 * 1 遺伝子座の表現を決める。順序非依存（ペアをソートしてから判定する）。
 */
function expressCat(locus: CatLocus, pair: CatPair, root: Rng): ExpressedCat {
  const def = CAT_LOCUS_BY_ID[locus];
  const raw0 = pair[0];
  const raw1 = pair[1];
  // [母方, 父方] の順序は表現に影響させない。
  const x = raw0 <= raw1 ? raw0 : raw1;
  const y = raw0 <= raw1 ? raw1 : raw0;

  const dx = alleleDef(locus, x);
  const dy = alleleDef(locus, y);

  // カタログ外の ID（開発者モードの force など）は素通しする。
  if (!dx || !dy) {
    const id = dx ? x : dy ? y : x;
    return {
      id,
      label: alleleLabel(locus, id),
      hidden: '',
      notable: false,
      hiddenNotable: false,
      recessive: false,
      coExpressed: false,
    };
  }

  const make = (winner: string, hidden: string, coExpressed = false, coLabel?: string): ExpressedCat => {
    const wd = alleleDef(locus, winner);
    const hd = hidden ? alleleDef(locus, hidden) : undefined;
    return {
      id: winner,
      label: coLabel ?? alleleLabel(locus, winner),
      hidden,
      notable: coExpressed ? Boolean(dx.notable || dy.notable) : Boolean(wd?.notable),
      hiddenNotable: Boolean(hd?.notable),
      recessive: coExpressed ? dx.dominance <= 2 && dy.dominance <= 2 : (wd?.dominance ?? 9) <= 2,
      coExpressed,
    };
  };

  // ホモ接合。
  if (x === y) return make(x, '');

  // 優性度が違えば高い方が発現し、低い方は保因される。
  if (dx.dominance !== dy.dominance) {
    return dx.dominance > dy.dominance ? make(x, y) : make(y, x);
  }

  // ここから同 dominance のヘテロ。
  const pickFirst = root.stream(`express:${locus}`).bool();

  // 素体は絶対に混ぜない（形が破綻する）。seed 由来で片方に決める。
  if (locus === 'base') {
    return pickFirst ? make(x, y) : make(y, x);
  }

  // 両方 coDominant かつ合成表現が定義されていれば合成する。
  if (dx.coDominant && dy.coDominant) {
    const co = def.coExpress?.[`${x}+${y}`] ?? def.coExpress?.[`${y}+${x}`];
    if (co) {
      const label = `${alleleLabel(locus, x)}＋${alleleLabel(locus, y)}`;
      return make(co, '', true, label);
    }
  }

  // 合成表現が定義されていない同値ヘテロは seed 由来で片方に決める。
  return pickFirst ? make(x, y) : make(y, x);
}

/** 新設後の遺伝子座がまだ無い旧セーブを、既定形質として読む。 */
function catPairOrDefault(genotype: Genotype, locus: CatLocus): CatPair {
  const pair = genotype.cat[locus];
  if (pair) return pair;
  const id = CAT_LOCUS_BY_ID[locus].alleles[0]?.id ?? 'none';
  return [id, id];
}

/** 新設後の数値遺伝子座がまだ無い旧セーブを、カタログ平均として読む。 */
function numPairOrDefault(genotype: Genotype, locus: NumLocus): [number, number] {
  const pair = genotype.num[locus];
  if (pair) return [pair[0], pair[1]];
  const mean = NUM_LOCUS_BY_ID[locus].mean;
  return [mean, mean];
}

// ─────────────────────────────────────────────────────────
//  素体との相性（表現型レベルで解決する）
// ─────────────────────────────────────────────────────────

/** 幼体で未発達＝発現しない装飾器官。成体で初めて出る。 */
const JUVENILE_HIDDEN: readonly (keyof PartExpression)[] = [
  'wings',
  'horns',
  'crystal',
  'collar',
  'floaters',
];

/** 幼体では小さい形でだけ発現する器官（成体で本来の形になる）。 */
const JUVENILE_SMALL: Readonly<Record<string, string>> = {
  ears: 'nub',
  plant: 'sprout',
  tail: 'stub',
};

/** 足の発現は素体で決まる。幽霊型は浮いているので必ず足なし。 */
function resolveFeet(expressed: string, hidden: string, base: BodyBase): string {
  if (base === 'yurei') return 'none';
  if (base === 'slime') {
    // スライムは体が流れているので、はっきりした足はできない。
    // ただし『ねっこ』だけは体の裾から伸びて見えるので残す。
    return expressed === 'root' ? 'root' : 'none';
  }
  // まる型は足あり優先（'none' 対立遺伝子は本来まる型では使えない）。
  if (expressed !== 'none') return expressed;
  if (hidden && hidden !== 'none') return hidden;
  return 'stub';
}

/** 羽と素体の相性。確率ではなく素体で決める（同じ遺伝子なら同じ結果）。 */
function resolveWings(expressed: string, base: BodyBase): string {
  if (expressed === 'none') return 'none';
  // 幽霊型は浮いているので羽がよく似合う。まる型もそのまま生える。
  // スライム型は体が流動的で、羽が浮いて見えてしまうので発現しない。
  return base === 'slime' ? 'none' : expressed;
}

// ─────────────────────────────────────────────────────────
//  パレット
// ─────────────────────────────────────────────────────────

function buildPalette(familyId: string, hue: number, sat: number, light: number, hueShift: number): Palette {
  const fam = PALETTE_BY_ID[familyId] ?? PALETTE_FAMILIES[0];

  const h = mapRange(hue, fam.hue[0], fam.hue[1]);
  const s = mapRange(sat, fam.sat[0], fam.sat[1]);
  const l = mapRange(light, fam.light[0], fam.light[1]);

  const body = hslToHex(h, s, l);

  // アクセントはファミリーが許した角度からのみ選ぶ（自由色相にしない）。
  const shifts = fam.accentShift;
  const idx = Math.min(shifts.length - 1, Math.floor(clamp01(hueShift) * shifts.length));
  const accentHue = h + shifts[idx];
  const accent = hslToHex(accentHue, clamp(s * 1.05 + 8, 24, 76), clamp(l - 6, 44, 78));

  // 模様は本体が明るければ暗く、暗ければ明るくして、必ず読めるようにする。
  const patternL = l > 68 ? clamp(l - 26, 26, 60) : clamp(l + 22, 48, 88);
  const pattern = hslToHex(h + shifts[idx] * 0.18, clamp(s * 0.85 + 4, 16, 66), patternL);

  const iris = hslToHex(accentHue, clamp(s * 0.9 + 12, 26, 78), clamp(l - 26, 24, 48));

  return {
    body,
    bodyDark: darken(body, 0.24),
    bodyLight: lighten(body, 0.26),
    belly: hslToHex(h, clamp(s * 0.5, 10, 50), clamp(l + 15, 60, 94)),
    ink: inkFor(body),
    pattern,
    accent,
    iris,
    // 発光色はアクセントを明るくしたもの。
    glow: lighten(accent, 0.45),
    // 頬はほんのり赤み。本体色をわずかに混ぜて浮かないようにする。
    cheek: mix(hslToHex(352, 62, 80), body, 0.18),
    hsl: { h: Math.round(((h % 360) + 360) % 360), s: Math.round(s), l: Math.round(l) },
    family: fam.id,
  };
}

// ─────────────────────────────────────────────────────────
//  性格
// ─────────────────────────────────────────────────────────

interface AxisDef {
  key: keyof Omit<Personality, 'label' | 'subLabel'>;
  num: NumLocus;
  hi: string;
  lo: string;
}

const PERSONALITY_AXES: readonly AxisDef[] = [
  { key: 'energy', num: 'pEnergy', hi: 'げんきいっぱい', lo: 'おっとりや' },
  { key: 'affection', num: 'pAffection', hi: 'ひとなつこい', lo: 'しんちょうは' },
  { key: 'curiosity', num: 'pCuriosity', hi: 'しりたがりや', lo: 'ようじんぶかい' },
  { key: 'dependence', num: 'pDependence', hi: 'あまえんぼう', lo: 'ひとりずき' },
  { key: 'appetite', num: 'pAppetite', hi: 'くいしんぼう', lo: 'こしょくさん' },
  { key: 'tidiness', num: 'pTidiness', hi: 'きれいずき', lo: 'のんびりや' },
];

function buildPersonality(num: Record<NumLocus, number>): Personality {
  const scored = PERSONALITY_AXES.map((ax) => ({
    ax,
    v: num[ax.num],
    strength: Math.abs(num[ax.num] - 0.5),
  }));
  const sorted = scored.slice().sort((a, b) => b.strength - a.strength);

  const top = sorted[0];
  const second = sorted[1];

  const nameOf = (e: { ax: AxisDef; v: number }): string => (e.v >= 0.5 ? e.ax.hi : e.ax.lo);

  // どの軸も真ん中に寄っている子は「マイペース」。
  const label = top.strength < 0.06 ? 'マイペース' : nameOf(top);

  const prefix =
    second.strength > 0.26 ? 'とても' : second.strength > 0.14 ? 'すこし' : 'ほんのり';
  const subLabel = `${prefix}${nameOf(second)}`;

  return {
    energy: num.pEnergy,
    affection: num.pAffection,
    curiosity: num.pCuriosity,
    dependence: num.pDependence,
    appetite: num.pAppetite,
    tidiness: num.pTidiness,
    label,
    subLabel,
  };
}

// ─────────────────────────────────────────────────────────
//  希少度
// ─────────────────────────────────────────────────────────

/**
 * 個数に対する逓減加点。
 * 「n 個目は unit * decay^(n-1) 点」なので伸びは鈍るが、**決して頭打ちにならない**。
 *
 * 旧実装は min(24, n*8) のような固定上限を使っていたが、これが致命的だった:
 *   交配を重ねるとホモ接合が進んで珍しい形質の同時発現数が増える
 *   （実測: 初期集団の notable 平均 0.95 個 → 12 世代後 1.83 個）のに、
 *   3 個で上限に達するため score が 1 点も増えず、'precious' に構造的に到達できなかった。
 */
function decayGain(n: number, unit: number, decay: number): number {
  let g = 0;
  for (let i = 0; i < n; i++) g += unit * Math.pow(decay, i);
  return g;
}

/** lo で 0、hi で 1 になるなめらかな強さ。 */
function ramp(v: number, lo: number, hi: number): number {
  return smooth((v - lo) / (hi - lo));
}

/** 値が [lo, hi] の帯に入っていれば 1、外れるほど 0 に近づく。 */
function band(v: number, lo: number, hi: number, soft: number): number {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - d / soft);
}

/**
 * 配色の「まとまり（調和）」0..1。
 * 派手さではなく、模様とアクセントが本体色に対して
 * 読みやすく・浮きすぎない関係にあるかを見る（指示書 §11「調和した配色」）。
 */
function paletteHarmony(p: Palette): number {
  // 模様は本体から見て読めるが、強すぎてうるさくない帯が心地よい。
  const patc = band(contrastRatio(p.pattern, p.body), 1.55, 3.1, 1.5);
  // アクセントは本体と近すぎず離れすぎず。
  const accc = band(contrastRatio(p.accent, p.body), 1.2, 2.4, 1.2);
  // 腹の淡色が本体と地続きに見えること。
  const belc = band(contrastRatio(p.belly, p.body), 1.15, 2.0, 1.0);
  // 彩度が極端でないこと。
  const satc = band(p.hsl.s, 26, 66, 22);
  return clamp01((patc * 0.32 + accc * 0.26 + belc * 0.2 + satc * 0.22));
}

/** 希少度の加点要素 1 つ。 */
interface RaritySignal {
  points: number;
  reason?: string;
}

/**
 * 希少度。
 *
 * 【設計上の禁止】装飾の数だけで加点してはいけない（指示書 §11）。
 * 珍しさは「珍しい対立遺伝子・潜性の同時発現・珍しい組み合わせ・調和した配色・
 * 左右非対称・特殊な発光・通常と異なる器官配置」で決める。
 *
 * 【多面性ボーナス】
 * 単純加算だけだと、1 つの要素が突出した個体と、複数の珍しさが同時に出た個体を
 * 区別できない。珍しさの「系統」がいくつ立っているかで相乗ボーナスを付ける。
 * 交配で珍しい形質が集まるほど超線形に伸びるので、'precious' が交配の目標になる。
 */
function buildRarity(
  expr: Record<CatLocus, ExpressedCat>,
  parts: PartExpression,
  num: Record<NumLocus, number>,
  palette: Palette,
): Rarity {
  const signals: RaritySignal[] = [];
  const add = (points: number, reason?: string): void => {
    if (points > 0.5) signals.push({ points, reason });
  };

  // ── 1) 珍しい対立遺伝子の発現数（逓減、頭打ちなし）──
  const notableLoci = CAT_LOCUS_IDS.filter(
    (l) => expr[l].notable && (l !== 'earTip' || parts.earTip !== 'none'),
  );
  if (notableLoci.length > 0) {
    const names = notableLoci
      .slice(0, 3)
      .map((l) => {
        const label = l === 'earTip' ? alleleLabel(l, parts.earTip) : expr[l].label;
        return `${CAT_LOCUS_BY_ID[l].label}の『${label}』`;
      });
    add(
      decayGain(notableLoci.length, 9, 0.85),
      `めずらしい形質が ${notableLoci.length} か所（${names.join('、')}）`,
    );
  }

  // ── 2) 地味な潜性の発現 ──
  // notable な対立遺伝子はたいてい潜性なので、両方を満額で数えると
  // 実質ひとつの信号を二重計上してしまう（実測でも notable 数と潜性数はほぼ一致した）。
  // ここでは「notable ではないが潜性」＝カタログ上は地味な隠れ形質だけを数える。
  const recessiveLoci = CAT_LOCUS_IDS.filter(
    (l) => expr[l].recessive && !expr[l].notable && l !== 'base',
  );
  if (recessiveLoci.length > 0) {
    add(
      decayGain(recessiveLoci.length, 3, 0.8),
      `かくれていた形質が ${recessiveLoci.length} か所そろって出ている`,
    );
  }

  // ── 3) 珍しい配色ファミリー ──
  const fam = PALETTE_BY_ID[palette.family];
  const rarePalette = Boolean(fam?.rare);
  if (rarePalette) add(11, `めずらしい『${fam.label}』の配色`);

  // ── 4) 配色の調和（派手さではなく、まとまり）──
  // ほとんどの個体がそこそこ調和しているので、加点は小さく、
  // 「系統」にも数えない。飛び抜けて美しいときだけ理由として出す。
  const harmony = paletteHarmony(palette);
  if (harmony > 0.72) {
    add(5 * ramp(harmony, 0.72, 0.99), harmony > 0.92 ? '色のまとまりが とても美しい' : undefined);
  }

  // ── 5) 左右非対称・透明感・発光 ──
  // 連続量。弱い個体に薄く配ると集団全体の底上げになってしまうので、
  // strength を 2 乗して「はっきり出ている個体だけ」に効かせる。
  const asymS = ramp(num.asymmetry, 0.4, 0.72);
  const transS = ramp(num.translucency, 0.48, 0.78);
  const glowS = ramp(num.glow, 0.44, 0.74);
  add(10 * asymS * asymS, asymS > 0.6 ? '左右のかたちが はっきりちがう' : undefined);
  add(9 * transS * transS, transS > 0.6 ? 'からだが とてもすきとおっている' : undefined);
  add(8 * glowS * glowS, glowS > 0.6 ? '体の内側が ほのかに光っている' : undefined);

  // ── 6) 通常と異なる器官配置 ──
  const eyeOdd = parts.eyeCount !== 2;
  if (eyeOdd) add(9, `目が ${parts.eyeCount} つ ある`);

  // ── 7) 珍しい組み合わせ ──
  // 組み合わせも「たくさん重なれば青天井」にはしない。
  // 2 つ目以降は逓減させ、1 つの派手な個体が独走しないようにする。
  const combos: { points: number; reason: string }[] = [];
  const combo = (ok: boolean, points: number, reason: string): void => {
    if (ok) combos.push({ points, reason });
  };
  combo(
    parts.crystal !== 'none' && parts.plant !== 'none',
    10,
    '結晶と植物が いっしょに育っている めずらしい組み合わせ',
  );
  combo(transS > 0.5 && glowS > 0.5, 10, 'すきとおった体の奥が 光っている');
  combo(eyeOdd && asymS > 0.5, 10, 'ふつうとちがう目のならびと 左右差が 重なっている');
  combo(parts.wings !== 'none' && parts.crystal !== 'none', 8, '羽と結晶が どちらも出ている');
  combo(parts.plant !== 'none' && parts.feet === 'root', 7, '根と植物がつながった 森のような姿');
  combo(parts.floaters !== 'none' && glowS > 0.45, 7, '浮遊物が 光をまとっている');
  combo(rarePalette && harmony > 0.85, 7, 'めずらしい配色が みごとにまとまっている');
  combos.sort((a, b) => b.points - a.points);
  combos.forEach((c, i) => add(c.points * Math.pow(0.62, i), c.reason));
  const comboCount = combos.length;

  // ── 8) 多面性ボーナス ──
  // 「はっきり出ている珍しさ」が何系統あるか。3 系統目から急に価値が上がる。
  // 交配で珍しい形質が集まるほどここが伸びる＝交配の目標になる。
  // 珍しい形質が「たくさん同時に」出ている場合は、それ自体が複数系統ぶんの価値を持つ。
  // （2 か所と 6 か所を同じ 1 系統として数えると、潜性を集めた個体が報われない）
  const tierOf = (n: number): number => (n >= 6 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0);
  const families =
    tierOf(notableLoci.length + recessiveLoci.length) +
    (rarePalette ? 1 : 0) +
    (asymS >= 0.6 ? 1 : 0) +
    (transS >= 0.6 ? 1 : 0) +
    (glowS >= 0.6 ? 1 : 0) +
    (eyeOdd ? 1 : 0) +
    (comboCount >= 1 ? 1 : 0);
  const synergy = families >= 3 ? 3 * Math.pow(families - 2, 1.5) : 0;

  const base = signals.reduce((a, s) => a + s.points, 0);
  const score = Math.round(clamp(base + synergy, 0, 100));

  const reasons = signals
    .filter((s) => s.reason)
    .sort((a, b) => b.points - a.points)
    .map((s) => s.reason as string);
  if (families >= 3) reasons.unshift(`めずらしさが ${families} 方向で重なっている`);
  if (reasons.length === 0) reasons.push('おだやかで ふつうの すがた');

  const tier: RarityTier =
    score >= 66 ? 'precious' : score >= 44 ? 'rare' : score >= 22 ? 'uncommon' : 'common';

  return { score, tier, reasons };
}

// ─────────────────────────────────────────────────────────
//  特徴一覧（UI 表示）
// ─────────────────────────────────────────────────────────

/** traits に出す遺伝子座（順序は UI の表示順）。 */
const TRAIT_ORDER: readonly CatLocus[] = [
  'base',
  'silhouette',
  'palette',
  'pattern',
  'texture',
  'coat',
  'eyeCount',
  'eyeShape',
  'pupil',
  'eyeGlint',
  'irisTone',
  'lashes',
  'mouth',
  'ears',
  'earTip',
  'antennae',
  'horns',
  'plant',
  'wings',
  'tail',
  'crystal',
  'collar',
  'feet',
  'floaters',
];

function levelWord(v: number, lo: string, mid: string, hi: string): string {
  return v < 0.34 ? lo : v < 0.67 ? mid : hi;
}

function buildTraits(
  expr: Record<CatLocus, ExpressedCat>,
  num: Record<NumLocus, number>,
  parts: PartExpression,
): TraitSummary[] {
  const out: TraitSummary[] = [];

  for (const locus of TRAIT_ORDER) {
    const e = expr[locus];
    // 耳先色は耳がないと見た目に発現しないため、表示値も最終 parts に合わせる。
    const valueId = locus === 'earTip' ? parts.earTip : e.id;
    const t: TraitSummary = {
      locus,
      label: CAT_LOCUS_BY_ID[locus].label,
      value: locus === 'earTip' ? alleleLabel(locus, valueId) : e.label,
    };
    // 発現していない側の対立遺伝子＝この子が保因している形質。
    // 「おじいちゃん譲りの形質かも」という楽しさの源になるので必ず入れる。
    if (e.hidden && e.hidden !== e.id) {
      t.carrier = alleleLabel(locus, e.hidden);
    }
    if (e.notable && (locus !== 'earTip' || valueId !== 'none')) t.notable = true;
    out.push(t);
  }

  out.push({
    locus: 'size',
    label: '大きさ',
    value: levelWord(num.size, 'ちいさめ', 'ふつう', 'おおきめ'),
  });
  out.push({
    locus: 'translucency',
    label: '透明感',
    value: levelWord(num.translucency, 'しっかり', 'すこし透ける', 'すきとおり'),
    notable: num.translucency > 0.66,
  });
  out.push({
    locus: 'glow',
    label: '発光',
    value: levelWord(num.glow, 'ひかえめ', 'ほんのり', 'あかるい'),
    notable: num.glow > 0.72,
  });

  return out;
}

// ─────────────────────────────────────────────────────────
//  本体
// ─────────────────────────────────────────────────────────

const EYE_COUNT_MAP: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3 };

/**
 * 遺伝子型と成長段階から表現型を決める（純粋関数）。
 */
export function phenotypeOf(genotype: Genotype, stage: Stage): Phenotype {
  const root = new Rng(genotype.seed);

  // ---- カテゴリ形質の発現 ----
  const expr = {} as Record<CatLocus, ExpressedCat>;
  for (const locus of CAT_LOCUS_IDS) {
    expr[locus] = expressCat(locus, catPairOrDefault(genotype, locus), root);
  }

  // ---- 数値形質の発現（2 つの平均 ＋ ごく小さいゆらぎ）----
  const num = {} as Record<NumLocus, number>;
  for (const locus of NUM_LOCUS_IDS) {
    const pair = numPairOrDefault(genotype, locus);
    const avg = (pair[0] + pair[1]) / 2;
    const jitter = root.stream(`express:num:${locus}`).float(-0.02, 0.02);
    num[locus] = clamp01(avg + jitter);
  }

  // ---- 素体 ----
  const baseId = expr.base.id;
  const base: BodyBase = baseId === 'yurei' || baseId === 'slime' ? baseId : 'maru';

  // ---- 器官の発現（素体との相性を反映）----
  const parts: PartExpression = {
    eyeCount: EYE_COUNT_MAP[expr.eyeCount.id] ?? 2,
    eyeShape: expr.eyeShape.id,
    pupil: expr.pupil.id,
    eyeGlint: expr.eyeGlint.id,
    irisTone: expr.irisTone.id,
    lashes: expr.lashes.id,
    mouth: expr.mouth.id,
    ears: expr.ears.id,
    earTip: expr.ears.id === 'none' ? 'none' : expr.earTip.id,
    antennae: expr.antennae.id,
    horns: expr.horns.id,
    plant: expr.plant.id,
    wings: resolveWings(expr.wings.id, base),
    tail: expr.tail.id,
    crystal: expr.crystal.id,
    collar: expr.collar.id,
    feet: resolveFeet(expr.feet.id, expr.feet.hidden, base),
    floaters: expr.floaters.id,
    pattern: expr.pattern.id,
    texture: expr.texture.id,
    coat: expr.coat.id,
    bicolor: expr.bicolor.id,
    lumin: expr.lumin.id,
    silhouette: expr.silhouette.id,
  };

  // 希少度・特徴は「その個体が最終的に持つ形質」で決めるため、
  // 成長段階の抑制をかける前（＝成体相当）の値で計算する。
  // ＝ rarity / traits は stage に依らず一定になる。
  // 幼体のうちは成体で出る器官を伏せたい場合、UI 側で stage を見て伏せること。
  const palette = buildPalette(expr.palette.id, num.hue, num.sat, num.light, num.hueShift);
  const rarity = buildRarity(expr, parts, num, palette);
  const traits = buildTraits(expr, num, parts);

  // ---- 数値の成長段階による差分 ----
  let size = mapRange(num.size, 0.8, 1.25);
  let ratio = mapRange(num.ratio, 0.78, 1.28);
  let plump = num.plump;
  let eyeSize = num.eyeSize;
  let patDensity = num.patDensity;
  let glow = num.glow;
  let asymmetry = num.asymmetry;
  let decorAmount = num.decorAmount;

  if (stage === 'egg') {
    // 卵はほぼ球。形質の値は保持したまま、見た目だけ丸くまとめる。
    size = lerp(0.8, size, 0.3);
    ratio = lerp(ratio, 1, 0.8);
    plump = lerp(plump, 1, 0.6);
    eyeSize = lerp(eyeSize, 1, 0.15);
    patDensity *= 0.2;
    glow *= 0.35;
    asymmetry *= 0.4;
    decorAmount *= 0.2;
  } else if (stage === 'juvenile') {
    // 幼体は小さく丸く、目が相対的に大きく、模様が薄い。
    size = lerp(0.8, size, 0.55);
    ratio = lerp(ratio, 1, 0.55);
    plump = lerp(plump, 1, 0.35);
    eyeSize = lerp(eyeSize, 1, 0.32);
    patDensity *= 0.45;
    glow *= 0.5;
    asymmetry *= 0.75;
    decorAmount *= 0.5;
  }

  // ---- 器官の成長段階による差分 ----
  // 卵は器官を描かないが、値そのものは保持する（孵化後にそのまま使う）。
  if (stage === 'juvenile') {
    // 装飾器官は未発達。成体になって初めて出てくる（成長の驚き）。
    for (const key of JUVENILE_HIDDEN) {
      (parts as unknown as Record<string, string>)[key] = 'none';
    }
    for (const [key, small] of Object.entries(JUVENILE_SMALL)) {
      const cur = (parts as unknown as Record<string, string>)[key];
      if (cur && cur !== 'none') {
        (parts as unknown as Record<string, string>)[key] = small;
      }
    }
  }

  return {
    seed: genotype.seed,
    stage,
    base,
    baseLabel: alleleLabel('base', base),
    size,
    ratio,
    plump,
    translucency: num.translucency,
    glow,
    asymmetry,
    eyeSize,
    eyeSpacing: num.eyeSpacing,
    wingSize: num.wingSize,
    patDensity,
    patScale: num.patScale,
    decorAmount,
    growthSpeed: num.growthSpeed,
    healthTend: num.healthTend,
    palette,
    parts,
    personality: buildPersonality(num),
    rarity,
    traits,
  };
}

/**
 * その段階で「見えている」特徴だけに絞る。
 *
 * Phenotype.rarity / Phenotype.traits は stage に依らず成体相当の内容を持つ。
 * 幼体の詳細画面でそのまま出すと「成体で羽が生える」ネタバレになるので、
 * UI は必ずこのヘルパを通すこと（stage 判定を各画面で自前実装すると漏れる）。
 *
 * ・egg      … 殻ごしにわかる配色と大きさだけ
 * ・juvenile … 成体で初めて出る器官（羽・角・結晶・首かざり・浮遊物）を除外し、
 *              耳・植物・尾は「いま見えている小さい形」で表示する
 * ・adult    … すべて
 *
 * なお rarity.reasons も同じ理由でネタバレを含みうる。
 * 幼体のうちは tier だけ見せて reasons は伏せることを推奨する。
 */
export function visibleTraits(pheno: Phenotype, stage: Stage = pheno.stage): TraitSummary[] {
  if (stage === 'adult') return pheno.traits;

  if (stage === 'egg') {
    return pheno.traits.filter((t) => t.locus === 'palette' || t.locus === 'size');
  }

  const hidden = new Set<string>(JUVENILE_HIDDEN as readonly string[]);
  const parts = pheno.parts as unknown as Record<string, string>;
  const out: TraitSummary[] = [];

  for (const t of pheno.traits) {
    // 成体で初めて出る器官は、幼体のうちは存在ごと伏せる。
    if (hidden.has(t.locus)) continue;

    // 幼体で小さい形にとどまっている器官は、いまの見た目に合わせて言い換える。
    if (JUVENILE_SMALL[t.locus] && stage === pheno.stage) {
      const id = parts[t.locus];
      const downgraded = id !== undefined && id !== t.value;
      out.push({
        ...t,
        value: id !== undefined ? alleleLabel(t.locus as CatLocus, id) : t.value,
        notable: downgraded ? false : t.notable,
      });
      continue;
    }

    out.push(t);
  }

  return out;
}

/** 表現型キャッシュのキー。遺伝内容と段階だけで決まる。 */
export function phenotypeCacheKey(genotype: Genotype, stage: Stage): string {
  return `${genotypeFingerprint(genotype)}:${stage}`;
}

/** 遺伝子座の表現だけを取り出す（UI の親子比較などで使う）。 */
export function expressedAlleles(genotype: Genotype): Record<CatLocus, ExpressedCat> {
  const root = new Rng(genotype.seed);
  const expr = {} as Record<CatLocus, ExpressedCat>;
  for (const locus of CAT_LOCUS_IDS) {
    expr[locus] = expressCat(locus, catPairOrDefault(genotype, locus), root);
  }
  return expr;
}
