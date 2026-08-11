/**
 * 「幼体にネタバレさせない」ための表示フィルタ（UI 側の薄い層）。
 *
 * 【背景（遺伝担当からの申し送り）】
 *   Phenotype.rarity と Phenotype.traits は **成体基準** で計算される。
 *   そのまま出すと、幼体の段階で「この子は成体になると羽が生える」と分かってしまい、
 *   成長の驚き（指示書 §11）が消える。
 *
 * 【役割分担】
 *   - 特徴一覧の伏せ方は genetics 側の `visibleTraits(pheno, stage)` が正本。
 *     UI で stage を見て自前に伏せると必ず漏れるので、**必ずこれを通す**。
 *   - 希少度（rarity）の伏せ方は genetics 側に無いので、ここで面倒を見る。
 *     `rarity.reasons` は「目が 3 つある」「羽がある」のように
 *     成体で生える器官を名指しするため、幼体・卵では理由を出してはならない。
 */

import type { Phenotype, Rarity, Stage, TraitSummary } from '../core/types.ts';
import { visibleTraits as geneticsVisibleTraits } from '../genetics/phenotype.ts';

/** その成長段階で見せてよい特徴一覧（genetics 側の正本をそのまま使う）。 */
export function visibleTraits(pheno: Phenotype, stage: Stage = pheno.stage): TraitSummary[] {
  return geneticsVisibleTraits(pheno, stage);
}

/**
 * その成長段階で見せてよい希少度。
 *
 *   成体 … そのまま（score / tier / reasons すべて）。
 *   幼体 … tier と score だけ。reasons は成体の器官を名指しするので伏せる。
 *   卵   … 何も見せない（null）。
 */
export function visibleRarity(pheno: Phenotype, stage: Stage = pheno.stage): Rarity | null {
  if (stage === 'adult') return pheno.rarity;
  if (stage === 'juvenile') return { ...pheno.rarity, reasons: [] };
  return null;
}

/** 希少度を伏せているときに UI へ出す一行説明。 */
export function rarityMaskNote(stage: Stage): string {
  if (stage === 'egg') return 'たまごのうちは、めずらしさは まだ 分かりません。';
  if (stage === 'juvenile') return 'くわしい理由は、成体に なると 分かります。';
  return '';
}

/** その段階で「まだ見せていないものがある」ことを伝える一行。 */
export function traitMaskNote(stage: Stage): string {
  if (stage === 'egg') return '殻から うかがえるのは、色あいと 大きさ くらいです。';
  if (stage === 'juvenile') return '成体になって はじめて 出てくる 器官は、まだ 伏せられています。';
  return '';
}
