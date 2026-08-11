/**
 * 表現型（Phenotype）のメモ化キャッシュ。
 *
 * 【なぜ必要か】
 *   UI は描画のたびに getPhenotype を呼ぶ（API.md 規約 2）。
 *   phenotypeOf は 19 遺伝子座 × 名前付き RNG を毎回組み立てるので、
 *   100 体一覧を 60fps で回すと計算だけで破綻する。
 *
 * 【なぜ LRU か】
 *   単純な Map だと、標本帳で個体を眺めるほど無限に溜まる。
 *   段階（egg/juvenile/adult）ごとに別エントリになるので、
 *   100 体一覧なら最大 300 エントリ。上限を超えたら
 *   「いちばん長く触られていないもの」から捨てる。
 *
 *   JS の Map は挿入順を保つので、
 *   「取り出したら delete → set し直す」だけで LRU 順が保てる。
 */

import type { Creature, Genotype, Phenotype, Stage } from '../core/types.ts';
import { phenotypeCacheKey, phenotypeOf } from '../genetics/index.ts';

/**
 * キャッシュ上限。
 * 育成室（最大 9 体）＋標本帳の一覧（100 体想定）× 段階違いを見込んで 360。
 * 1 エントリは数 KB なので、上限に達しても数 MB に収まる。
 */
export const PHENOTYPE_CACHE_LIMIT = 360;

const cache = new Map<string, Phenotype>();

/** 内部共通。genotype と stage から取り出す（キャッシュキーは genetics 側の正本を使う）。 */
function lookup(genotype: Genotype, stage: Stage): Phenotype {
  const key = phenotypeCacheKey(genotype, stage);

  const hit = cache.get(key);
  if (hit) {
    // 参照されたものを末尾へ動かす（＝最近使ったものほど後ろ）。
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const value = phenotypeOf(genotype, stage);
  cache.set(key, value);

  // 上限超過ぶんを先頭（＝最も長く触られていない）から捨てる。
  while (cache.size > PHENOTYPE_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }

  return value;
}

/**
 * 個体の表現型。stage 省略時は現在の成長段階。
 * 同じ (遺伝内容, 段階) からは常に同一オブジェクトが返る（＝参照比較が使える）。
 */
export function getPhenotype(creature: Creature, stage?: Stage): Phenotype {
  return lookup(creature.genotype, stage ?? creature.life.stage);
}

/** 個体を持たない遺伝子（卵候補・交配プレビュー）用。 */
export function getPhenotypeOfGenotype(genotype: Genotype, stage: Stage): Phenotype {
  return lookup(genotype, stage);
}

/** 現在のキャッシュ件数（テスト・デバッグ用）。 */
export function phenotypeCacheSize(): number {
  return cache.size;
}

/** キャッシュを空にする（テスト・セーブ切り替え時用）。 */
export function clearPhenotypeCache(): void {
  cache.clear();
}
