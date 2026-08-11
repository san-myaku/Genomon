/**
 * 遺伝子型（Genotype）の生成とハッシュ。
 *
 * 【設計の要】名前付きサブストリーム
 *   単一の Rng を CAT_LOCI の順に消費すると、将来 locus を 1 つ増やしただけで
 *   それ以降の全 locus の乱数がずれ、既存 seed の個体の見た目が総入れ替えになる。
 *   そのため必ず `new Rng(seed).stream('<用途>:<locus名>')` の独立系列を使う。
 *   これで locus の追加・削除・並べ替えが既存個体に一切影響しない。
 */

import { Rng, hashString } from '../core/rng.ts';
import type { CatLocus, CatPair, Genotype, NumLocus, NumPair } from '../core/types.ts';
import { CAT_LOCI, NUM_LOCI } from './loci.ts';

/**
 * seed から初期個体の遺伝子型を作る。
 * 各遺伝子座について、カタログの weight に従って対立遺伝子を 2 つ独立に引く（二倍体）。
 * feet の `bases` 制限はここでは無視する（表現型変換で素体との整合を取る）。
 */
export function randomGenotype(seed: string): Genotype {
  const root = new Rng(seed);

  const cat = {} as Record<CatLocus, CatPair>;
  for (const def of CAT_LOCI) {
    // locus ごとに独立した系列。他 locus の消費量に影響されない。
    const r = root.stream(`geno:cat:${def.locus}`);
    const ids = def.alleles.map((a) => a.id);
    const weights = def.alleles.map((a) => a.weight);
    const a = r.pickWeighted(ids, weights);
    const b = r.pickWeighted(ids, weights);
    cat[def.locus] = [a, b] as CatPair;
  }

  const num = {} as Record<NumLocus, NumPair>;
  for (const def of NUM_LOCI) {
    const r = root.stream(`geno:num:${def.locus}`);
    const a = r.around(def.mean, def.spread);
    const b = r.around(def.mean, def.spread);
    num[def.locus] = [a, b] as NumPair;
  }

  return { seed, cat, num };
}

/**
 * 遺伝子型の正規化文字列。
 * 対立遺伝子ペアは [母方, 父方] の順序を持つが表現には影響しないため、
 * ソートして順序を消す（＝遺伝的に等価なものは同じ文字列になる）。
 */
function canonicalString(g: Genotype): string {
  const parts: string[] = [`s=${g.seed}`];

  for (const def of CAT_LOCI) {
    const pair = g.cat[def.locus];
    const a = pair?.[0] ?? '';
    const b = pair?.[1] ?? '';
    const [x, y] = a <= b ? [a, b] : [b, a];
    parts.push(`${def.locus}=${x}/${y}`);
  }

  for (const def of NUM_LOCI) {
    const pair = g.num[def.locus];
    const a = Math.round((pair?.[0] ?? 0) * 10000);
    const b = Math.round((pair?.[1] ?? 0) * 10000);
    const [x, y] = a <= b ? [a, b] : [b, a];
    parts.push(`${def.locus}=${x}/${y}`);
  }

  return parts.join('|');
}

/**
 * 遺伝子型の安定した短いハッシュ。
 * 同じ遺伝内容からは常に同じ文字列を返す（テスト・キャッシュキー用）。
 */
export function genotypeFingerprint(g: Genotype): string {
  const s = canonicalString(g);
  const h1 = hashString(s).toString(36).padStart(7, '0');
  const h2 = hashString(`${s}|genomon`).toString(36).padStart(7, '0');
  return `${h1}${h2}`;
}

/** 遺伝子型が構造的に妥当か（全 locus が存在し、num が 0..1 か）。 */
export function isValidGenotype(g: Genotype): boolean {
  if (!g || typeof g.seed !== 'string' || g.seed.length === 0) return false;
  for (const def of CAT_LOCI) {
    const pair = g.cat[def.locus];
    if (!pair || pair.length !== 2) return false;
    for (const id of pair) {
      if (typeof id !== 'string' || id.length === 0) return false;
      if (!def.alleles.some((a) => a.id === id)) return false;
    }
  }
  for (const def of NUM_LOCI) {
    const pair = g.num[def.locus];
    if (!pair || pair.length !== 2) return false;
    for (const v of pair) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return false;
    }
  }
  return true;
}
