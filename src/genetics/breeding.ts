/**
 * 交配（メンデル分離 ＋ 突然変異）。
 *
 * 【設計方針】
 *   - 各遺伝子座について、親 A から 1 つ、親 B から 1 つを独立に選ぶ。
 *     locus ごとに名前付きサブストリームを使うので、locus を増やしても
 *     既存の childSeed から生まれる子の他形質は変わらない。
 *   - 突然変異は「完全ランダムな別の対立遺伝子」ではなく、
 *     カタログ配列上で近い対立遺伝子へ寄せる（指示書 §14 親の系統を残す）。
 *     こうすると子が突然まったくの別物にならず、系統の面影が残る。
 */

import { Rng, clamp01 } from '../core/rng.ts';
import type { CatLocus, CatPair, Genotype, NumLocus, NumPair } from '../core/types.ts';
import { CAT_LOCI, CAT_LOCUS_BY_ID, MUTATION, NUM_LOCI, NUM_LOCUS_BY_ID } from './loci.ts';

export interface BreedOptions {
  /** 突然変異率の倍率（Visual Lab から一時的に変更する用）。既定 1。 */
  mutationScale?: number;
  /** 特定のカテゴリ形質を強制する（開発者モード用）。ホモ接合で固定される。 */
  force?: Partial<Record<CatLocus, string>>;
}

/**
 * カタログ配列上で「隣の対立遺伝子」へ寄せた突然変異。
 * 距離 d が離れるほど選ばれにくくする（1/d^1.8）。
 * 必ず元と異なる対立遺伝子を返す。
 */
function mutateCatAllele(locus: CatLocus, current: string, rng: Rng): string {
  const def = CAT_LOCUS_BY_ID[locus];
  const n = def.alleles.length;
  if (n <= 1) return current;

  let i = def.alleles.findIndex((a) => a.id === current);
  if (i < 0) i = 0;

  const cand: string[] = [];
  const weights: number[] = [];
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const d = Math.abs(j - i);
    cand.push(def.alleles[j].id);
    weights.push(1 / Math.pow(d, 1.8));
  }
  return rng.pickWeighted(cand, weights);
}

/**
 * 親の遺伝子型から対立遺伝子ペアを取り出す。無ければカタログ先頭で補う。
 *
 * 【素で `parent.cat[locus]` を読んではいけない理由】
 *   遺伝子座を新設すると、それ以前に保存された個体の `cat` にはその座が
 *   無い。`pa[0]` と書くと undefined の添字参照で落ちる ＝ **旧セーブの
 *   個体が交配できなくなる**。表現型側（phenotype.ts の
 *   `catPairOrDefault`）は既にカタログ先頭の対立遺伝子で補っているので、
 *   交配も同じ規則に揃える。カタログ先頭は各ロカスとも既定形質
 *   （多くは 'none'）なので、旧個体に新形質が勝手に生えることはない。
 */
function pairOrDefault(g: Genotype, locus: CatLocus): CatPair {
  const pair = g.cat[locus];
  if (pair) return pair;
  const id = CAT_LOCUS_BY_ID[locus].alleles[0]?.id ?? 'none';
  return [id, id] as CatPair;
}

/** 数値形質版。無ければカタログの平均値で補う（理由は pairOrDefault と同じ）。 */
function numPairOrDefault(g: Genotype, locus: NumLocus): NumPair {
  const pair = g.num[locus];
  if (pair) return pair;
  const mean = NUM_LOCUS_BY_ID[locus].mean;
  return [mean, mean] as NumPair;
}

/** 数値形質のゆらぎ。低確率で大きく飛ぶ。 */
function jitterNum(v: number, rng: Rng, scale: number): number {
  let out = v + rng.gauss() * MUTATION.numJitter * scale;
  if (rng.bool(Math.min(1, MUTATION.numRate * scale))) {
    out += (rng.bool() ? 1 : -1) * MUTATION.numLeap;
  }
  return clamp01(out);
}

/**
 * 2 個体を交配して子の遺伝子型を作る。
 * 同じ (parentA, parentB, childSeed, opts) からは常に同じ子が生まれる。
 */
export function breed(
  parentA: Genotype,
  parentB: Genotype,
  childSeed: string,
  opts?: BreedOptions,
): Genotype {
  const scale = opts?.mutationScale ?? 1;
  const force = opts?.force;
  const root = new Rng(childSeed);

  const cat = {} as Record<CatLocus, CatPair>;
  for (const def of CAT_LOCI) {
    const locus = def.locus;

    // 開発者モードの強制指定。確実に発現させるためホモ接合にする。
    const forced = force?.[locus];
    if (forced) {
      cat[locus] = [forced, forced] as CatPair;
      continue;
    }

    // ── 減数分裂：各親から独立に 1 つずつ ──
    const meio = root.stream(`meiosis:${locus}`);
    const pa = pairOrDefault(parentA, locus);
    const pb = pairOrDefault(parentB, locus);
    let a = meio.bool() ? pa[0] : pa[1];
    let b = meio.bool() ? pb[0] : pb[1];

    // ── 突然変異（減数分裂とは別系列にして、率を変えても分離が変わらないようにする）──
    const mut = root.stream(`mut:${locus}`);
    const rate = (locus === 'base' ? MUTATION.baseRate : MUTATION.catRate) * scale;
    if (mut.bool(Math.min(1, rate))) a = mutateCatAllele(locus, a, mut);
    if (mut.bool(Math.min(1, rate))) b = mutateCatAllele(locus, b, mut);

    cat[locus] = [a, b] as CatPair;
  }

  const num = {} as Record<NumLocus, NumPair>;
  for (const def of NUM_LOCI) {
    const locus = def.locus;
    const meio = root.stream(`meiosis:${locus}`);
    const pa = numPairOrDefault(parentA, locus);
    const pb = numPairOrDefault(parentB, locus);
    const a = meio.bool() ? pa[0] : pa[1];
    const b = meio.bool() ? pb[0] : pb[1];

    const mut = root.stream(`mut:${locus}`);
    num[locus] = [jitterNum(a, mut, scale), jitterNum(b, mut, scale)] as NumPair;
  }

  return { seed: childSeed, cat, num };
}

/** 同じ親から兄弟をまとめて作る。それぞれ異なる seed を持つ。 */
export function breedMany(
  parentA: Genotype,
  parentB: Genotype,
  baseSeed: string,
  n: number,
  opts?: BreedOptions,
): Genotype[] {
  const out: Genotype[] = [];
  for (let i = 0; i < n; i++) {
    out.push(breed(parentA, parentB, `${baseSeed}#kid${i}`, opts));
  }
  return out;
}

/**
 * 子の各対立遺伝子が、どちらの親由来として説明できるか。
 * どちらの親にも無い対立遺伝子は突然変異とみなす。UI・テストで使う。
 */
export function inheritanceReport(
  child: Genotype,
  parentA: Genotype,
  parentB: Genotype,
): Record<CatLocus, { fromA: boolean; fromB: boolean; mutated: boolean }> {
  const out = {} as Record<CatLocus, { fromA: boolean; fromB: boolean; mutated: boolean }>;
  for (const def of CAT_LOCI) {
    const locus = def.locus;
    const c = pairOrDefault(child, locus);
    const a = pairOrDefault(parentA, locus);
    const b = pairOrDefault(parentB, locus);
    const inA = (id: string): boolean => a[0] === id || a[1] === id;
    const inB = (id: string): boolean => b[0] === id || b[1] === id;
    out[locus] = {
      fromA: inA(c[0]) || inA(c[1]),
      fromB: inB(c[0]) || inB(c[1]),
      mutated: (!inA(c[0]) && !inB(c[0])) || (!inA(c[1]) && !inB(c[1])),
    };
  }
  return out;
}
