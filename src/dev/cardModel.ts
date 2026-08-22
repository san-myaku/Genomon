/**
 * カード 1 枚ぶんの「事実」を、個体（Phenotype）から決定論的に導く層。
 *
 * 【この層に DOM を持ち込まない】
 *   ここは純粋関数だけで構成する。ブラウザが無くても動くので、
 *   `tests/cards.test.ts` から直接呼んで決定論性を検証できる。
 *   DOM 組み立ては cardDesign.ts、画面は cardLab.ts の責務。
 *
 * 【決定論（AGENTS.md §1）】
 *   `Math.random()` は使わない。カードに出る値はすべて
 *   `new Rng(seed).stream('card:...')` の名前付きサブストリームから作る。
 *   foil のテクスチャ seed も `hashString(seed)` 由来なので、
 *   同じ個体の Prism カードはいつ開いても同じ粒子配置になる。
 *   ストリーム名を変えるとその項目だけが変わるので、既存の名前は変えないこと。
 *
 * 【ダミー値について】
 *   親・展示実績・通し番号・鑑定日は、まだゲーム本体に無い情報。
 *   「カードにその情報が載ったらどう見えるか」を評価するための仮の値で、
 *   本編とは一切つながっていない。Phenotype から取れる値
 *   （模様・配色・希少度・保因形質）は必ず実データを使う。
 */

import type { CatLocus, Phenotype, RarityTier } from '../core/types.ts';
import { Rng, hashString } from '../core/rng.ts';
import { PALETTE_BY_ID } from '../core/color.ts';
import { alleleDef, alleleLabel } from '../genetics/loci.ts';
import { makeName } from '../genetics/naming.ts';

// ─────────────────────────────────────────────────────────
//  カードの種類
// ─────────────────────────────────────────────────────────

/** 3 つのデザイン方向。 */
export type CardDesign = 'certified' | 'natural' | 'collector';

export interface CardDesignDef {
  id: CardDesign;
  /** UI に出す名前。 */
  label: string;
  /** カード表面に刷る英字の副題。 */
  subtitle: string;
  /** 一言でどんな方向か。 */
  note: string;
}

export const CARD_DESIGNS: readonly CardDesignDef[] = [
  {
    id: 'certified',
    label: 'Certified',
    subtitle: 'CERTIFIED SPECIMEN',
    note: '鑑定証・グレーディングカード。整ったグリッドと大きな Grade。箔は控えめ。',
  },
  {
    id: 'natural',
    label: 'Natural History',
    subtitle: 'LIVING SPECIMEN RECORD',
    note: '自然史標本・血統証明書。情報量は 3 案でいちばん多い。箔は罫線と紋章だけ。',
  },
  {
    id: 'collector',
    label: 'Collector',
    subtitle: 'COLLECTOR SERIES',
    note: '集めたくなる chase card。文字は最小限、ゲノモンを最大化。箔を強めてよい唯一の案。',
  },
];

export const CARD_DESIGN_BY_ID: Readonly<Record<CardDesign, CardDesignDef>> = Object.fromEntries(
  CARD_DESIGNS.map((d) => [d.id, d]),
) as Record<CardDesign, CardDesignDef>;

/**
 * 仕上げ（foil）。`effect` は `@kongyo2/cards-css` の `HoloEffect` に対応する。
 *
 * 型は素の文字列で持つ（ライブラリの型をこの純粋な層へ持ち込まないため）。
 * 実際に有効な値かどうかは cardDesign.ts が `HOLO_EFFECTS` と突き合わせる。
 */
export type CardFinish =
  | 'standard' | 'silver' | 'holo' | 'prism' | 'gold' | 'aurora' | 'crystal' | 'cosmos'
  | 'reverse' | 'glitter' | 'rainbow' | 'radiant' | 'oilslick' | 'sunburst' | 'mosaic';

export interface CardFinishDef {
  id: CardFinish;
  label: string;
  /** ライブラリの effect 名。 */
  effect: string;
  /** カード表面に刷る呼び名（Collector の上部レール）。 */
  stamp: string;
  /**
   * 箔の強さの基準（0..1）。デザイン側の控えめ係数と掛け合わせて使う。
   * 「全面レインボー」を避けるため、既定値は総じて低い。
   */
  strength: number;
  /** 主要 8 種（設定パネルの既定の並び）か。 */
  core: boolean;
}

export const CARD_FINISHES: readonly CardFinishDef[] = [
  { id: 'standard', label: 'Standard', effect: 'none',     stamp: 'STANDARD',   strength: 0.00, core: true },
  { id: 'silver',   label: 'Silver',   effect: 'metal',    stamp: 'SILVER',     strength: 0.55, core: true },
  { id: 'holo',     label: 'Holo',     effect: 'holo',     stamp: 'HOLO',       strength: 0.80, core: true },
  { id: 'prism',    label: 'Prism',    effect: 'prism',    stamp: 'PRISM HOLO', strength: 1.00, core: true },
  { id: 'gold',     label: 'Gold',     effect: 'gold',     stamp: 'GOLD',       strength: 0.75, core: true },
  { id: 'aurora',   label: 'Aurora',   effect: 'aurora',   stamp: 'AURORA',     strength: 0.85, core: true },
  { id: 'crystal',  label: 'Crystal',  effect: 'crystal',  stamp: 'CRYSTAL',    strength: 0.80, core: true },
  { id: 'cosmos',   label: 'Cosmos',   effect: 'cosmos',   stamp: 'COSMOS',     strength: 0.90, core: true },
  { id: 'reverse',  label: 'Reverse',  effect: 'reverse',  stamp: 'REVERSE',    strength: 0.70, core: false },
  { id: 'glitter',  label: 'Glitter',  effect: 'glitter',  stamp: 'GLITTER',    strength: 0.85, core: false },
  { id: 'rainbow',  label: 'Rainbow',  effect: 'rainbow',  stamp: 'RAINBOW',    strength: 0.95, core: false },
  { id: 'radiant',  label: 'Radiant',  effect: 'radiant',  stamp: 'RADIANT',    strength: 0.85, core: false },
  { id: 'oilslick', label: 'Oilslick', effect: 'oilslick', stamp: 'OILSLICK',   strength: 0.80, core: false },
  { id: 'sunburst', label: 'Sunburst', effect: 'sunburst', stamp: 'SUNBURST',   strength: 0.85, core: false },
  { id: 'mosaic',   label: 'Mosaic',   effect: 'mosaic',   stamp: 'MOSAIC',     strength: 0.85, core: false },
];

export const CARD_FINISH_BY_ID: Readonly<Record<CardFinish, CardFinishDef>> = Object.fromEntries(
  CARD_FINISHES.map((f) => [f.id, f]),
) as Record<CardFinish, CardFinishDef>;

/** 手動で切り替えるグレード。ゲーム内の鑑定ロジックとは連動しない。 */
export type CardGrade = 6 | 7 | 8 | 9 | 10;

export const CARD_GRADES: readonly CardGrade[] = [6, 7, 8, 9, 10];

const GRADE_WORD: Readonly<Record<CardGrade, string>> = {
  10: 'GEM MINT',
  9: 'MINT',
  8: 'NEAR MINT',
  7: 'EXCELLENT',
  6: 'VERY GOOD',
};

/** 描画品質。Showcase は full、比較は medium、一覧は lite。 */
export type CardQuality = 'full' | 'medium' | 'lite';

// ─────────────────────────────────────────────────────────
//  ラテン語彙（カードに刷る英字）
// ─────────────────────────────────────────────────────────

/**
 * 個体コード名の語幹。
 * ゲノモンのカタカナ名（naming.ts）とは別に、カード上の「型式番号」として使う。
 * 実在の商標・作品名を連想させない、鉱物・天体・植物の語をもとにした造語で揃える。
 */
const CODE_STEMS: readonly string[] = [
  'NOVA', 'LUNE', 'AURI', 'MOSS', 'VESP', 'IRIS', 'CIRR', 'FERN', 'ONYX', 'OPAL',
  'HALO', 'VIRE', 'LUMA', 'NIMB', 'CALX', 'SILV', 'AMBR', 'TERR', 'GLAU', 'ZEPH',
  'ORYX', 'SOLE', 'MICA', 'PYRE', 'CERU', 'THAL', 'VELU', 'ARBO', 'CRIN', 'NACR',
  'RIME', 'SORA', 'TIDE', 'VEIL', 'DUNE', 'ECHO', 'FLUX', 'GEOD', 'HELI', 'INDI',
];

/** 配色ファミリー → 血統（house）名。カード上の LINEAGE 欄。 */
const LINEAGE_BY_PALETTE: Readonly<Record<string, string>> = {
  meadow: 'VIRIDAE',
  moss: 'MUSCARI',
  frost: 'GELIDAE',
  lagoon: 'NEREIDA',
  dusk: 'VESPERA',
  bloom: 'FLORIANA',
  coral: 'CORALLIA',
  ember: 'EMBERIA',
  pearl: 'LUMINAE',
  mineral: 'MINERALIS',
  ash: 'CINEREA',
};

const SHOW_EVENTS: readonly string[] = [
  'VERDANT SHOW', 'PALE MOON EXPO', 'STRATA CUP', 'AURORA CLASSIC',
  'HOLLOW FAIR', 'TIDEPOOL INVITATIONAL', 'EMBER TRIALS', 'GLASS GARDEN CUP',
];

const SHOW_PLACES: readonly string[] = [
  '1st Place', '2nd Place', '3rd Place', 'Best in Show', 'Judges Choice', 'Finalist',
];

const RARITY_TIER_LABEL: Readonly<Record<RarityTier, string>> = {
  common: 'COMMON',
  uncommon: 'UNCOMMON',
  rare: 'RARE',
  precious: 'PRECIOUS',
};

/** 通し番号の母数。珍しい個体ほど発行枚数が少ない設定にしてある。 */
const PRINT_TOTAL: Readonly<Record<RarityTier, number>> = {
  common: 999,
  uncommon: 555,
  rare: 222,
  precious: 111,
};

const ROMAN_UNITS: readonly (readonly [number, string])[] = [
  [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** 小さな数をローマ数字にする（世代表記用）。 */
export function toRoman(n: number): string {
  let rest = Math.max(1, Math.floor(n));
  let out = '';
  while (rest >= 10) {
    out += 'X';
    rest -= 10;
  }
  for (const pair of ROMAN_UNITS) {
    while (rest >= pair[0]) {
      out += pair[1];
      rest -= pair[0];
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────
//  カードの事実
// ─────────────────────────────────────────────────────────

export interface CardTraitLine {
  /** 欄名（英字）。 */
  key: string;
  /** 値の英字表記（対立遺伝子 ID をそのまま大文字にしたもの）。 */
  value: string;
  /** 値の日本語表記。 */
  valueJa: string;
  notable: boolean;
}

export interface CardShowRecord {
  event: string;
  place: string;
  year: number;
}

export interface CardFacts {
  seed: string;
  /** カタカナ名（本編と同じ makeName）。 */
  name: string;
  /** カード上の型式番号（NOVA-17 など）。 */
  code: string;
  /** 証明書番号（GM-00018472）。 */
  certId: string;
  /** foil テクスチャの seed。個体 seed のハッシュなので毎回同じ。 */
  textureSeed: number;
  grade: CardGrade;
  gradeWord: string;
  /** 0..100。Phenotype の実データ。 */
  rarityScore: number;
  rarityTier: RarityTier;
  rarityLabel: string;
  /** 希少と判定した理由（実データ）。 */
  rarityReasons: readonly string[];
  generation: number;
  generationRoman: string;
  lineage: string;
  parents: readonly [string, string];
  showRecord: CardShowRecord | null;
  print: { index: number; total: number; text: string };
  /** 主要形質（実データ）。 */
  lines: readonly CardTraitLine[];
  /** 珍しい形質の日本語（実データ）。 */
  notableTraits: readonly string[];
  /** 保因している形質（実データ）。最大 3 件。 */
  carriers: readonly string[];
  /** 素体の日本語。 */
  baseLabel: string;
  /** 配色ファミリーの日本語。 */
  paletteLabel: string;
  /** 鑑定日（ダミー・決定論）。 */
  certifiedOn: string;
  /** QR プレースホルダに書く将来の URL。 */
  qrPayload: string;
}

/** 対立遺伝子 ID → カードに刷る英字。'none' は「—」にする。 */
function latin(id: string): string {
  if (!id || id === 'none') return '—';
  // camelCase の ID（dartNet など）は語の切れ目で分けてから大文字にする。
  return id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toUpperCase();
}

/**
 * その遺伝子座の日本語値を拾う。
 *
 * `Phenotype.traits` は UI 表示用に選ばれた遺伝子座だけを持っており、
 * `lumin`（発光の出かた）や `bicolor` は入っていない。traits だけを見ると
 * 「LUMIN — —」のように値が二重のダッシュになってしまうので、
 * 無いものは対立遺伝子カタログから直接引く。
 */
function jaOf(pheno: Phenotype, locus: CatLocus, alleleId: string): string {
  const hit = pheno.traits.find((t) => t.locus === locus);
  if (hit) return hit.value;
  return alleleLabel(locus, alleleId);
}

function isNotable(pheno: Phenotype, locus: CatLocus, alleleId: string): boolean {
  const hit = pheno.traits.find((t) => t.locus === locus);
  if (hit) return hit.notable ?? false;
  return alleleDef(locus, alleleId)?.notable ?? false;
}

/**
 * 個体からカードの事実一式を作る。
 *
 * `grade` だけは外から渡す（Cards Lab では人が手で切り替えるため）。
 * それ以外は seed と Phenotype だけで決まるので、同じ個体からは常に同じ結果になる。
 */
export function deriveCardFacts(pheno: Phenotype, grade: CardGrade): CardFacts {
  const seed = pheno.seed;
  const root = new Rng(seed);

  const codeRng = root.stream('card:code');
  const code = `${codeRng.pick(CODE_STEMS)}-${String(codeRng.int(1, 99)).padStart(2, '0')}`;

  const certId = `GM-${String(hashString(`${seed}#card:cert`) % 100_000_000).padStart(8, '0')}`;

  const genRng = root.stream('card:generation');
  const generation = genRng.pickWeighted(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 12],
    [8, 12, 15, 16, 14, 12, 9, 7, 4, 3],
  );

  const parentRng = root.stream('card:parents');
  const parentCode = (): string =>
    `${parentRng.pick(CODE_STEMS)}-${String(parentRng.int(1, 99)).padStart(2, '0')}`;
  const parents: readonly [string, string] = [parentCode(), parentCode()];

  const showRng = root.stream('card:show');
  const showRecord: CardShowRecord | null = showRng.bool(0.62)
    ? {
        event: showRng.pick(SHOW_EVENTS),
        place: showRng.pick(SHOW_PLACES),
        year: showRng.int(2024, 2026),
      }
    : null;

  const tier = pheno.rarity.tier;
  const total = PRINT_TOTAL[tier];
  const printRng = root.stream('card:print');
  const index = printRng.int(1, total);
  const pad = String(total).length;

  const dateRng = root.stream('card:date');
  const year = dateRng.int(2024, 2026);
  const month = dateRng.int(1, 12);
  const day = dateRng.int(1, 28);

  const p = pheno.parts;
  const family = PALETTE_BY_ID[pheno.palette.family];
  const lines: CardTraitLine[] = [
    { key: 'PATTERN', value: latin(p.pattern), valueJa: jaOf(pheno, 'pattern', p.pattern), notable: isNotable(pheno, 'pattern', p.pattern) },
    { key: 'TEXTURE', value: latin(p.texture), valueJa: jaOf(pheno, 'texture', p.texture), notable: isNotable(pheno, 'texture', p.texture) },
    { key: 'PALETTE', value: latin(pheno.palette.family), valueJa: family?.label ?? pheno.palette.family, notable: family?.rare ?? false },
    { key: 'LUMIN', value: latin(p.lumin), valueJa: jaOf(pheno, 'lumin', p.lumin), notable: isNotable(pheno, 'lumin', p.lumin) },
  ];

  const notableTraits = pheno.traits.filter((t) => t.notable).map((t) => `${t.label}：${t.value}`);

  const carriers = pheno.traits
    .filter((t) => t.carrier)
    .slice(0, 3)
    .map((t) => `${t.label}：${t.carrier ?? ''}`);

  return {
    seed,
    name: makeName(seed),
    code,
    certId,
    textureSeed: hashString(`${seed}#card:texture`),
    grade,
    gradeWord: GRADE_WORD[grade],
    rarityScore: pheno.rarity.score,
    rarityTier: tier,
    rarityLabel: RARITY_TIER_LABEL[tier],
    rarityReasons: pheno.rarity.reasons,
    generation,
    generationRoman: toRoman(generation),
    lineage: LINEAGE_BY_PALETTE[pheno.palette.family] ?? 'IGNOTA',
    parents,
    showRecord,
    print: { index, total, text: `${String(index).padStart(pad, '0')}/${total}` },
    lines,
    notableTraits,
    carriers,
    baseLabel: pheno.baseLabel,
    paletteLabel: family?.label ?? pheno.palette.family,
    certifiedOn: `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`,
    qrPayload: `genomon.app/g/${certId}`,
  };
}
