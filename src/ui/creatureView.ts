/**
 * ゲノモンの描画（UI 側の窓口）。
 *
 * render レイヤの契約だけを使う:
 *   buildRenderModel(pheno, life, opts) → RenderModel
 *   renderCreatureSvg(model, opts)      → SVG 文字列
 *   applyIdleMotion / playReaction      → 待機モーションと反応演出
 *
 * 【なぜキャッシュするか】
 *   標本帳は最大 9 体、交配プレビューは 3 体、卵選択は 9 個の SVG を同時に出す。
 *   RenderModel の生成はパーツ組み立てを伴うので、同じ (seed, stage, detail) を
 *   使い回さないと画面遷移のたびに目に見えて詰まる。
 *   RenderModel は (Phenotype, life, detail) から決定論的なので、キャッシュは安全。
 *   ただし life（機嫌・健康）で表情が変わるため、キーに「気分の段階」を含める。
 */

import type { Creature, LifeState, Phenotype, RenderDetail, RenderModel } from '../core/types.ts';
import { buildRenderModel } from '../render/model.ts';
import { renderCreatureSvg } from '../render/creature.ts';
import { applyIdleMotion } from '../render/anim.ts';

const modelCache = new Map<string, RenderModel>();
const CACHE_MAX = 120;

/**
 * 気分をざっくり 4 段階に量子化してキーに混ぜる。
 * 1 ポイント動くたびに再生成すると意味がないので、表情が変わる粒度まで丸める。
 */
function moodBucket(life: LifeState | null): string {
  if (!life) return '-';
  const q = (v: number): number => Math.floor(Math.max(0, Math.min(100, v)) / 25);
  return `${q(life.mood)}${q(life.health)}${q(life.hunger)}`;
}

export interface ViewOpts {
  detail?: RenderDetail;
  /** 待機モーション用のグループを出すか。一覧の小さい絵では false にして負荷を下げる。 */
  animatable?: boolean;
  /** アクセシビリティ用のタイトル。 */
  title?: string;
  /** 卵の描画で保因遺伝子を参照させる。 */
  creature?: Creature | null;
}

/** RenderModel を取得（キャッシュ付き）。 */
export function modelFor(pheno: Phenotype, life: LifeState | null, opts: ViewOpts = {}): RenderModel {
  const detail: RenderDetail = opts.detail ?? 'full';
  const key = `${pheno.seed}|${pheno.stage}|${detail}|${moodBucket(life)}`;
  const hit = modelCache.get(key);
  if (hit) return hit;

  const model = buildRenderModel(pheno, life, {
    detail,
    genotype: opts.creature?.genotype ?? null,
  });

  if (modelCache.size >= CACHE_MAX) {
    // 単純な FIFO で十分。LRU にするほど頻繁な入れ替えは起きない。
    const first = modelCache.keys().next().value;
    if (first !== undefined) modelCache.delete(first);
  }
  modelCache.set(key, model);
  return model;
}

/** SVG 文字列を得る。 */
export function creatureSvg(pheno: Phenotype, life: LifeState | null, opts: ViewOpts = {}): string {
  const model = modelFor(pheno, life, opts);
  return renderCreatureSvg(model, {
    animatable: opts.animatable !== false,
    title: opts.title,
  });
}

/**
 * 小さいサムネイル用（一覧・切り替えタブ・親子比較）。
 * detail を lite に落とし、待機モーションも切って負荷を抑える。
 */
export function thumbSvg(pheno: Phenotype, life: LifeState | null, title?: string): string {
  return creatureSvg(pheno, life, { detail: 'lite', animatable: false, title });
}

/**
 * 主役表示用。SVG を差し込んだうえで待機モーションを掛ける。
 * 戻り値を呼ぶとモーション用の style が片付く。
 */
export function mountCreature(
  host: HTMLElement | null,
  pheno: Phenotype,
  life: LifeState | null,
  opts: ViewOpts & { reducedMotion?: boolean } = {},
): () => void {
  if (!host) return () => {};
  const model = modelFor(pheno, life, opts);
  host.innerHTML = renderCreatureSvg(model, {
    animatable: true,
    title: opts.title,
  });
  return applyIdleMotion(host, model, { reducedMotion: opts.reducedMotion === true });
}

/** キャッシュを捨てる（開発者モードのリロードなどで使う）。 */
export function clearModelCache(): void {
  modelCache.clear();
}
