/**
 * 見た目の類似度・集団の多様性・親子の似ているところの説明。
 *
 * similarity は「子が完全ランダムに見えないこと」を数値で保証するための道具でもある。
 * （親子の平均類似度が、無関係な 2 個体の平均類似度より明確に高くなること）
 */

import type { CatLocus, Genotype, PartExpression, Phenotype } from '../core/types.ts';
import { CAT_LOCI, alleleLabel } from './loci.ts';

// ─────────────────────────────────────────────────────────
//  外見類似度
// ─────────────────────────────────────────────────────────

/** カテゴリ器官の重み。見た目の印象を強く決めるものほど重い。 */
const PART_WEIGHTS: readonly (readonly [keyof PartExpression, number])[] = [
  ['silhouette', 1.0],
  ['eyeShape', 1.0],
  ['pupil', 0.9],
  ['mouth', 0.9],
  ['ears', 1.0],
  ['earTip', 0.35],
  ['antennae', 0.8],
  ['horns', 0.9],
  ['plant', 1.0],
  ['wings', 0.9],
  ['tail', 1.0],
  ['crystal', 0.8],
  ['collar', 0.6],
  ['feet', 0.7],
  ['floaters', 0.6],
  ['pattern', 1.2],
  ['texture', 1.0],
  ['coat', 1.0],
];

/** 数値形質の重みと正規化幅（Phenotype 上の実レンジ）。 */
const NUM_FIELDS: readonly (readonly [keyof Phenotype, number, number])[] = [
  ['size', 1.0, 0.45],
  ['ratio', 1.0, 0.5],
  ['plump', 0.9, 1],
  ['translucency', 0.9, 1],
  ['glow', 0.8, 1],
  ['asymmetry', 0.7, 1],
  ['eyeSize', 1.0, 1],
  ['eyeSpacing', 0.7, 1],
  ['patDensity', 0.9, 1],
  ['patScale', 0.7, 1],
  ['decorAmount', 0.6, 1],
];

/** 距離 → 類似度。指数減衰にすると「近い／遠い」の差がはっきり出る。 */
function kernel(d: number): number {
  return Math.exp(-Math.abs(d) / 0.2);
}

export interface SimilarityParts {
  /** 器官・配色ファミリーなどカテゴリ形質の一致率。 */
  cat: number;
  /** 大きさ・色味など数値形質の近さ。 */
  num: number;
  /** 総合。 */
  total: number;
}

/** カテゴリ一致率と数値近さの内訳（Visual Lab のデバッグ表示にも使う）。 */
export function similarityParts(a: Phenotype, b: Phenotype): SimilarityParts {
  // ---- カテゴリ ----
  let catW = 0;
  let catS = 0;

  // 素体と配色ファミリーは見た目の印象の柱なので重い。
  catW += 3;
  if (a.base === b.base) catS += 3;

  catW += 3;
  if (a.palette.family === b.palette.family) catS += 3;

  catW += 1;
  if (a.parts.eyeCount === b.parts.eyeCount) catS += 1;

  for (const [key, w] of PART_WEIGHTS) {
    catW += w;
    if (a.parts[key] === b.parts[key]) catS += w;
  }
  const catSim = catW > 0 ? catS / catW : 0;

  // ---- 数値 ----
  let numW = 0;
  let numS = 0;
  for (const [key, w, span] of NUM_FIELDS) {
    const av = a[key] as number;
    const bv = b[key] as number;
    numW += w;
    numS += w * kernel((av - bv) / span);
  }

  // 色そのものの近さ（色相は円環距離）。
  const dh = Math.abs(a.palette.hsl.h - b.palette.hsl.h);
  const hueDist = Math.min(dh, 360 - dh) / 180;
  numW += 2;
  numS += 2 * kernel(hueDist);
  numW += 1;
  numS += 1 * kernel((a.palette.hsl.s - b.palette.hsl.s) / 100);
  numW += 1;
  numS += 1 * kernel((a.palette.hsl.l - b.palette.hsl.l) / 100);

  const numSim = numW > 0 ? numS / numW : 0;

  return {
    cat: catSim,
    num: numSim,
    total: Math.max(0, Math.min(1, CAT_MIX * catSim + (1 - CAT_MIX) * numSim)),
  };
}

/**
 * カテゴリ形質と数値形質の混合比。
 * 「どの器官が生えているか・どの配色ファミリーか」のほうが
 * 大きさや色味の細かい差より見た目の印象を決めるので、カテゴリ側を重くする。
 */
const CAT_MIX = 0.65;

/**
 * 2 個体の外見類似度（0..1）。同一個体なら 1。
 * 親子・兄弟が他人より明確に高い値になるように重み付けしてある。
 */
export function similarity(a: Phenotype, b: Phenotype): number {
  return similarityParts(a, b).total;
}

// ─────────────────────────────────────────────────────────
//  多様性
// ─────────────────────────────────────────────────────────

/**
 * 集団の多様性（0..1）。
 * 各遺伝子座の対立遺伝子頻度からシャノンエントロピーを求め、
 * その遺伝子座の対立遺伝子数の対数で正規化して平均する。
 * 全個体が同じ対立遺伝子だけを持つと 0、全対立遺伝子が均等だと 1。
 */
export function diversityIndex(genotypes: Genotype[]): number {
  if (!genotypes || genotypes.length === 0) return 0;

  let sum = 0;
  let count = 0;

  for (const def of CAT_LOCI) {
    if (def.alleles.length <= 1) continue;
    const counts = new Map<string, number>();
    let total = 0;
    for (const g of genotypes) {
      const pair = g.cat[def.locus];
      if (!pair) continue;
      for (const id of pair) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        total++;
      }
    }
    if (total === 0) continue;

    let h = 0;
    for (const c of counts.values()) {
      const p = c / total;
      if (p > 0) h -= p * Math.log(p);
    }
    sum += h / Math.log(def.alleles.length);
    count++;
  }

  return count > 0 ? Math.max(0, Math.min(1, sum / count)) : 0;
}

// ─────────────────────────────────────────────────────────
//  親子の似ているところの説明
// ─────────────────────────────────────────────────────────

interface Aspect {
  /** 表示名。 */
  name: string;
  /** 表現値を取り出す。 */
  get: (p: Phenotype) => string;
}

const ASPECTS: readonly Aspect[] = [
  { name: '配色', get: (p) => p.palette.family },
  { name: '素体', get: (p) => p.base },
  { name: '模様', get: (p) => p.parts.pattern },
  { name: '目の形', get: (p) => p.parts.eyeShape },
  { name: '目の数', get: (p) => String(p.parts.eyeCount) },
  { name: '瞳', get: (p) => p.parts.pupil },
  { name: '質感', get: (p) => p.parts.texture },
  { name: '輪郭', get: (p) => p.parts.silhouette },
  { name: '角', get: (p) => p.parts.horns },
  { name: '耳', get: (p) => p.parts.ears },
  { name: '耳先', get: (p) => p.parts.earTip },
  { name: '羽', get: (p) => p.parts.wings },
  { name: '尾', get: (p) => p.parts.tail },
  { name: '植物器官', get: (p) => p.parts.plant },
  { name: '結晶', get: (p) => p.parts.crystal },
  { name: '口', get: (p) => p.parts.mouth },
  { name: '足', get: (p) => p.parts.feet },
];

/** 表示用ラベル。locus 名がわかるものは日本語ラベルに変換する。 */
function aspectValueLabel(name: string, p: Phenotype): string {
  const map: Readonly<Record<string, CatLocus>> = {
    模様: 'pattern',
    目の形: 'eyeShape',
    瞳: 'pupil',
    質感: 'texture',
    輪郭: 'silhouette',
    角: 'horns',
    耳: 'ears',
    耳先: 'earTip',
    羽: 'wings',
    尾: 'tail',
    植物器官: 'plant',
    結晶: 'crystal',
    口: 'mouth',
    足: 'feet',
  };
  if (name === '配色') {
    const t = p.traits.find((x) => x.locus === 'palette');
    return t?.value ?? p.palette.family;
  }
  if (name === '素体') return p.baseLabel;
  if (name === '目の数') return `${p.parts.eyeCount}つ`;
  const locus = map[name];
  if (!locus) return '';
  const key = ASPECTS.find((a) => a.name === name)?.get(p) ?? '';
  return alleleLabel(locus, key);
}

const NUM_ASPECTS: readonly { name: string; get: (p: Phenotype) => number; span: number }[] = [
  { name: '大きさ', get: (p) => p.size, span: 0.45 },
  { name: 'ふくらみ', get: (p) => p.plump, span: 1 },
  { name: '透明感', get: (p) => p.translucency, span: 1 },
  { name: '目の大きさ', get: (p) => p.eyeSize, span: 1 },
  { name: '模様の濃さ', get: (p) => p.patDensity, span: 1 },
];

/**
 * 「この色は親Aゆずり」のような日本語の説明を作る。
 * カテゴリ形質の一致 → 数値形質の近さ → 性格 の順に拾い、最低 5 項目を返す。
 */
export function explainInheritance(child: Phenotype, pa: Phenotype, pb: Phenotype): string[] {
  const lines: string[] = [];

  for (const asp of ASPECTS) {
    const c = asp.get(child);
    const a = asp.get(pa);
    const b = asp.get(pb);
    const label = aspectValueLabel(asp.name, child);
    const shown = label ? `『${label}』` : '';

    if (c === a && c === b) {
      lines.push(`${asp.name}${shown}は 両親そろって同じ。まちがいなくこの家系のしるし。`);
    } else if (c === a) {
      lines.push(`${asp.name}${shown}は 親A ゆずり。`);
    } else if (c === b) {
      lines.push(`${asp.name}${shown}は 親B ゆずり。`);
    } else {
      lines.push(`${asp.name}${shown}は どちらの親とも ちがう。かくれていた形質が出たのかも。`);
    }
  }

  for (const asp of NUM_ASPECTS) {
    const c = asp.get(child);
    const da = Math.abs(c - asp.get(pa)) / asp.span;
    const db = Math.abs(c - asp.get(pb)) / asp.span;
    if (Math.abs(da - db) < 0.04) {
      lines.push(`${asp.name}は ちょうど 両親の あいだくらい。`);
    } else if (da < db) {
      lines.push(`${asp.name}は 親A に近い。`);
    } else {
      lines.push(`${asp.name}は 親B に近い。`);
    }
  }

  // 性格は数値の平均に寄るので、必ず 1 行足せる。
  const cp = child.personality;
  lines.push(
    `性格は「${cp.label}」。親A は「${pa.personality.label}」、親B は「${pb.personality.label}」。`,
  );

  return lines;
}

/**
 * 説明のうち、UI に出すぶんだけ抜き出す（似ている点を優先して最大 max 件）。
 */
export function inheritanceHighlights(
  child: Phenotype,
  pa: Phenotype,
  pb: Phenotype,
  max = 6,
): string[] {
  const all = explainInheritance(child, pa, pb);
  const inherited = all.filter((l) => l.includes('ゆずり') || l.includes('両親そろって'));
  const rest = all.filter((l) => !inherited.includes(l));
  return [...inherited, ...rest].slice(0, Math.max(5, max));
}
