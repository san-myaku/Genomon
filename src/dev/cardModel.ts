/**
 * カード 1 枚ぶんの「事実」を、個体（Phenotype）から決定論的に導く層。
 *
 * 【この層に DOM を持ち込まない】
 *   ここは純粋関数だけで構成する。ブラウザが無くても動くので、
 *   `tests/cards.test.ts` から直接呼んで決定論性を検証できる。
 *   DOM 組み立ては cardDesign.ts / cardBack.ts、画面は cardLab.ts の責務。
 *
 * 【決定論（AGENTS.md §1）】
 *   `Math.random()` は使わない。カードに出る値はすべて
 *   `new Rng(seed).stream('card:...')` の名前付きサブストリームから作る。
 *   foil のテクスチャ seed も `hashString(seed)` 由来なので、
 *   同じ個体の Prism カードはいつ開いても同じ粒子配置になる。
 *   ストリーム名を変えるとその項目だけが変わるので、既存の名前は変えないこと。
 *
 * ─────────────────────────────────────────────────────────
 * 【本物と作りものを型で分ける（§15）】
 *
 *   CardFacts       … Phenotype / Genotype から出る **本物**
 *                     （模様・配色・希少度・発現した形質・フレーバー）
 *   LabCardHistory  … まだ本編に無い情報の **仮の値**（cardHistory.ts）
 *                     （親・子・展示成績・鑑定日・発行番号）
 *
 *   以前は 1 つの型に混ぜていたので、本番へ移すときにどれが嘘なのか
 *   分からなくなる状態だった。混ぜないこと。
 * ─────────────────────────────────────────────────────────
 */

import type { CatLocus, Phenotype, RarityTier } from '../core/types.ts';
import { hashString } from '../core/rng.ts';
import { PALETTE_BY_ID } from '../core/color.ts';
import { deriveFlavorText, type FlavorText } from '../game/flavor.ts';
import { CAT_LOCI, alleleDef, alleleLabel } from '../genetics/loci.ts';
import { makeName } from '../genetics/naming.ts';
// 型式番号の語幹は cardHistory.ts と同じ表を使う
// （親と本個体で語彙が違うと、同じ登録簿に見えない）。
import { CODE_STEMS as CODE_STEM_LIST } from './cardHistory.ts';
import { CARD_RANK_BY_ID, type CardRank } from './cardRarity.ts';

export { toRoman } from './cardHistory.ts';

// ─────────────────────────────────────────────────────────
//  カードの種類
// ─────────────────────────────────────────────────────────

/**
 * 版面。
 *
 * 【既存 3 案を消していない理由（§17）】
 *   Certified / Natural History / 旧 Collector は比較研究の対照として残す。
 *   「なぜ Collector v2 がいいのか」は、並べて初めて言葉にできる。
 *   旧 Collector は `legacy` として畳んであるが、コードは無傷。
 */
export type CardDesign = 'collectorV2' | 'certified' | 'natural' | 'collector';

export interface CardDesignDef {
  id: CardDesign;
  /** UI に出す名前。 */
  label: string;
  /** カード表面に刷る英字の副題。 */
  subtitle: string;
  /** 一言でどんな方向か。 */
  note: string;
  /** 比較研究用に残しているだけの旧案か。 */
  legacy: boolean;
}

/** 並び順がそのまま UI と Design 比較の並び。先頭が既定。 */
export const CARD_DESIGNS: readonly CardDesignDef[] = [
  {
    id: 'collectorV2',
    label: 'Collector v2',
    subtitle: 'CERTIFIED COLLECTOR SERIES',
    note: '黒の Collector に、格・認証印・少しの文字情報を足した本命。表＝見るカード／裏＝読むカード。',
    legacy: false,
  },
  {
    id: 'certified',
    label: 'Certified',
    subtitle: 'CERTIFIED SPECIMEN',
    note: '鑑定証・グレーディングカード。整ったグリッドと大きな Grade。箔は控えめ。',
    legacy: false,
  },
  {
    id: 'natural',
    label: 'Natural History',
    subtitle: 'LIVING SPECIMEN RECORD',
    note: '自然史標本・血統証明書。情報量は 3 案でいちばん多い。箔は罫線と紋章だけ。',
    legacy: false,
  },
  {
    id: 'collector',
    label: 'Legacy Collector',
    subtitle: 'COLLECTOR SERIES',
    note: '第 1 世代の Collector。文字は最小限で格の表現が無い。v2 との比較用に残してある。',
    legacy: true,
  },
];

export const CARD_DESIGN_BY_ID: Readonly<Record<CardDesign, CardDesignDef>> = Object.fromEntries(
  CARD_DESIGNS.map((d) => [d.id, d]),
) as Record<CardDesign, CardDesignDef>;

/** 既定の版面。**Collector v2**（§4）。 */
export const DEFAULT_DESIGN: CardDesign = 'collectorV2';

/**
 * 仕上げ（foil）。`effect` は `@kongyo2/cards-css` の `HoloEffect` に対応する。
 *
 * 型は素の文字列で持つ（ライブラリの型をこの純粋な層へ持ち込まないため）。
 * 実際に有効な値かどうかは cardDesign.ts が `HOLO_EFFECTS` と突き合わせる。
 */
export type CardFinish =
  | 'standard' | 'silver' | 'holo' | 'prism' | 'gold' | 'aurora' | 'crystal' | 'cosmos'
  | 'reverse' | 'glitter' | 'rainbow' | 'radiant' | 'oilslick' | 'sunburst' | 'mosaic';

/** 操作パネルで選べる値。'auto' は「段が決める」。 */
export type CardFinishChoice = CardFinish | 'auto';

export interface CardFinishDef {
  id: CardFinish;
  label: string;
  /** ライブラリの effect 名。 */
  effect: string;
  /** カード表面に刷る呼び名。 */
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

/** 'auto' なら段の既定の仕上げを使う。 */
export function resolveFinish(choice: CardFinishChoice, rank: CardRank): CardFinish {
  return choice === 'auto' ? CARD_RANK_BY_ID[rank].finish : choice;
}

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
//  語彙
// ─────────────────────────────────────────────────────────

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

const RARITY_TIER_LABEL: Readonly<Record<RarityTier, string>> = {
  common: 'COMMON',
  uncommon: 'UNCOMMON',
  rare: 'RARE',
  precious: 'PRECIOUS',
};

// ─────────────────────────────────────────────────────────
//  カードの事実（すべて実データ）
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
  /** 配色から決まる血統名（実データ）。 */
  lineage: string;
  /** 主要形質（実データ）。 */
  lines: readonly CardTraitLine[];
  /**
   * 表面に出す「目を引く特徴」。
   *
   * 【`traits` ではなく `parts`（実際に描かれた対立遺伝子）から作る】
   *   遺伝的に発現していても素体の都合で描かれない形質がある
   *   （スライムの羽、耳の無い個体の耳先色）。`traits` の notable を並べると
   *   **カードに描かれていないものを「見えている特徴」として刷ってしまう**。
   *   AGENTS.md §2.9 / §2.10 と同じ判断。
   */
  headlineTraits: readonly string[];
  /** 珍しい形質の日本語（実データ・旧デザイン用）。 */
  notableTraits: readonly string[];
  /** 保因している形質（実データ）。最大 3 件。裏面と旧デザインでだけ使う。 */
  carriers: readonly string[];
  /** 素体の日本語。 */
  baseLabel: string;
  /** 配色ファミリーの日本語。 */
  paletteLabel: string;
  /** QR プレースホルダに書く将来の URL。 */
  qrPayload: string;
  /**
   * カードに刷るフレーバー。
   *
   * 【本番と同じ生成を使う】
   *   ここは版面（文字量・行数・余白）を判断するための場所なので、
   *   Cards Lab 専用の仮テキストを置くと **本番と違う長さで判断してしまう**。
   *   Cards Lab には実際の Phenotype があるので、本編と同じ
   *   `game/flavor.ts` の deriveFlavorText をそのまま通す。
   */
  flavor: FlavorText;
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
 * 「実際に描かれていて、かつ珍しい」形質を、表に出す順に並べる。
 * `parts` に無い座（素体・配色・目の数）はそのまま姿に出ているので
 * `traits` 側から拾う（`game/grading.ts` の `observedSignal` と同じ判断）。
 */
function headlineTraitsOf(pheno: Phenotype): string[] {
  const parts = pheno.parts as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const def of CAT_LOCI) {
    const drawn = parts[def.locus];
    if (typeof drawn === 'string') {
      if (drawn !== 'none' && alleleDef(def.locus, drawn)?.notable) {
        out.push(`${def.label}：${alleleLabel(def.locus, drawn)}`);
      }
      continue;
    }
    const hit = pheno.traits.find((t) => t.locus === def.locus);
    if (hit?.notable) out.push(`${hit.label}：${hit.value}`);
  }
  return out;
}

/**
 * 個体からカードの事実一式を作る。
 *
 * `grade` だけは外から渡す（Cards Lab では人が手で切り替えるため）。
 * それ以外は seed と Phenotype だけで決まるので、同じ個体からは常に同じ結果になる。
 */
export function deriveCardFacts(pheno: Phenotype, grade: CardGrade): CardFacts {
  const seed = pheno.seed;

  // 型式番号は「その個体のもの」なので、経歴（Lab のダミー）ではなく
  // ここで作る。seed のハッシュから直接引くので Rng の消費順に依存しない。
  const stemIndex = hashString(`${seed}#card:code:stem`);
  const stems = CODE_STEM_LIST;
  const code = `${stems[stemIndex % stems.length]}-${String((hashString(`${seed}#card:code:no`) % 99) + 1).padStart(2, '0')}`;
  const certId = `GM-${String(hashString(`${seed}#card:cert`) % 100_000_000).padStart(8, '0')}`;

  const p = pheno.parts;
  const family = PALETTE_BY_ID[pheno.palette.family];
  const lines: CardTraitLine[] = [
    { key: 'PATTERN', value: latin(p.pattern), valueJa: jaOf(pheno, 'pattern', p.pattern), notable: isNotable(pheno, 'pattern', p.pattern) },
    { key: 'TEXTURE', value: latin(p.texture), valueJa: jaOf(pheno, 'texture', p.texture), notable: isNotable(pheno, 'texture', p.texture) },
    { key: 'PALETTE', value: latin(pheno.palette.family), valueJa: family?.label ?? pheno.palette.family, notable: family?.rare ?? false },
    { key: 'LUMIN', value: latin(p.lumin), valueJa: jaOf(pheno, 'lumin', p.lumin), notable: isNotable(pheno, 'lumin', p.lumin) },
  ];

  return {
    seed,
    name: makeName(seed),
    code,
    certId,
    textureSeed: hashString(`${seed}#card:texture`),
    grade,
    gradeWord: GRADE_WORD[grade],
    rarityScore: pheno.rarity.score,
    rarityTier: pheno.rarity.tier,
    rarityLabel: RARITY_TIER_LABEL[pheno.rarity.tier],
    rarityReasons: pheno.rarity.reasons,
    lineage: LINEAGE_BY_PALETTE[pheno.palette.family] ?? 'IGNOTA',
    lines,
    headlineTraits: headlineTraitsOf(pheno),
    notableTraits: pheno.traits.filter((t) => t.notable).map((t) => `${t.label}：${t.value}`),
    carriers: pheno.traits
      .filter((t) => t.carrier)
      .slice(0, 3)
      .map((t) => `${t.label}：${t.carrier ?? ''}`),
    baseLabel: pheno.baseLabel,
    paletteLabel: family?.label ?? pheno.palette.family,
    qrPayload: `genomon.app/g/${certId}`,
    flavor: deriveFlavorText(pheno),
  };
}
