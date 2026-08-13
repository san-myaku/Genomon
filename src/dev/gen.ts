/**
 * Visual Lab の生成ヘルパ。
 *
 * seed → Genotype → Phenotype → RenderModel → SVG の一本道をまとめ、
 * 「素体を強制する」「配色ファミリーを強制する」という開発専用の細工を足す。
 *
 * 【なぜ強制が要るか】
 *   palette の 'pearl'（しんじゅ）と 'mineral'（こうせき）は dominance 1 の潜性で、
 *   自然な出現率は 2 つ合わせて約 2.5%。100 体シートに 2〜3 体しか出ないため、
 *   その配色の美術品質をまとめて確認する手段が無かった。
 *   対立遺伝子をホモ接合に固定すれば、任意の配色で 100 体を並べられる。
 *
 * 【強制と絞り込みの違い】
 *   強制（force）: cat[locus] = [id, id] にする。速いが「自然な遺伝子構成」ではない。
 *   絞り込み（filter）: seed を回して条件に合う個体だけ拾う。自然な出方をそのまま見られる。
 *   配色の美術確認には強制、出現率や自然な組み合わせの確認には絞り込みを使う。
 */

import type {
  BodyBase,
  CatLocus,
  CatPair,
  Genotype,
  Phenotype,
  RenderDetail,
  RenderModel,
  Stage,
} from '../core/types.ts';
import { makeSeed } from '../core/rng.ts';
import { randomGenotype } from '../genetics/genotype.ts';
import { phenotypeOf } from '../genetics/phenotype.ts';
import { buildRenderModel } from '../render/model.ts';
import { renderCreatureSvg, renderDebugOverlay } from '../render/creature.ts';
import { inspectModel } from '../render/inspect.ts';
import { makeUid } from '../render/svg.ts';

/** 生成条件。UI のフォームがそのままこの形になる。 */
export interface GenSpec {
  stage: Stage;
  /** null なら指定なし。 */
  base: BodyBase | null;
  /** 配色ファミリー ID。null なら指定なし。 */
  palette: string | null;
  /** true: ホモ接合で強制 / false: 自然出現から絞り込み。 */
  force: boolean;
  detail: RenderDetail;
  /**
   * base/palette 以外の遺伝子座を、`force` の値に関わらず**常に**ホモ接合で
   * 強制する（sheet.html の `?force=locus:allele` と同じ発想・同じ挙動）。
   * 「絞り込み」UI（部位→種類のピックロー）はこれ経由で実装する。
   * base/palette の force/filter 切り替えとは独立に効かせたいので、
   * `applySpec` では `spec.force` の判定を通さず無条件で適用する。
   */
  extraForce?: Partial<Record<CatLocus, string>>;
}

export interface Specimen {
  seed: string;
  genotype: Genotype;
  pheno: Phenotype;
  model: RenderModel;
  issues: string[];
}

/**
 * 一覧で表示した個体を、同じ Genotype のまま別の表示条件で組み直す。
 *
 * Visual Lab の一覧は `extraForce` で対立遺伝子を固定できるため、
 * クリック後に seed だけから `randomGenotype()` をやり直すと、その固定が
 * 消えてしまう。拡大表示や段階変更では、一覧が実際に使った Genotype を
 * 入口にして Phenotype → RenderModel を再構成する。
 */
export function rebuildSpecimen(source: Specimen, stage: Stage, detail: RenderDetail): Specimen {
  const pheno = phenotypeOf(source.genotype, stage);
  const model = buildRenderModel(pheno, null, {
    detail,
    uid: makeUid(source.seed, `${stage}:${detail}:lab`),
    genotype: source.genotype,
  });
  return {
    seed: source.seed,
    genotype: source.genotype,
    pheno,
    model,
    issues: inspectModel(model).issues,
  };
}

/** 指定した遺伝子座をホモ接合に固定した Genotype を作る（元は変更しない）。 */
export function withForcedCat(
  g: Genotype,
  force: Partial<Record<CatLocus, string>>,
): Genotype {
  const cat = { ...g.cat } as Record<CatLocus, CatPair>;
  for (const key of Object.keys(force) as CatLocus[]) {
    const id = force[key];
    if (id) cat[key] = [id, id] as CatPair;
  }
  return { seed: g.seed, cat, num: g.num };
}

/** GenSpec の強制指定を Genotype へ適用する。 */
function applySpec(g: Genotype, spec: GenSpec): Genotype {
  const force: Partial<Record<CatLocus, string>> = { ...spec.extraForce };
  if (spec.force) {
    if (spec.base) force.base = spec.base;
    if (spec.palette) force.palette = spec.palette;
  }
  return Object.keys(force).length ? withForcedCat(g, force) : g;
}

/** 絞り込みモードのとき、この個体を採用してよいか。 */
function matchesSpec(pheno: Phenotype, spec: GenSpec): boolean {
  if (spec.force) return true;
  if (spec.base && pheno.base !== spec.base) return false;
  if (spec.palette && pheno.palette.family !== spec.palette) return false;
  return true;
}

/** 1 体ぶんを作る（条件に合わなければ null）。 */
export function makeSpecimen(seed: string, spec: GenSpec): Specimen | null {
  const genotype = applySpec(randomGenotype(seed), spec);
  const pheno = phenotypeOf(genotype, spec.stage);
  if (!matchesSpec(pheno, spec)) return null;

  const model = buildRenderModel(pheno, null, {
    detail: spec.detail,
    // uid は SVG 内 id の衝突回避用。同じ条件なら同じ値になる必要がある。
    uid: makeUid(seed, `${spec.stage}:${spec.detail}:lab`),
    genotype,
  });
  return { seed, genotype, pheno, model, issues: inspectModel(model).issues };
}

/** 条件を満たすまで seed を進めて 1 体作る（絞り込みモード用）。 */
export function makeSpecimenNear(seed: string, spec: GenSpec, maxTries = 400): Specimen | null {
  const first = makeSpecimen(seed, spec);
  if (first) return first;
  for (let i = 1; i < maxTries; i++) {
    const s = makeSpecimen(makeSeed(seed, i), spec);
    if (s) return s;
  }
  return null;
}

/**
 * 連番 seed から n 体ぶんの seed を作る。
 * 絞り込みモードでは条件に合わない個体が出るので、
 * 「何番目の試行か」を呼び出し側が回して makeSpecimen する形にしてある。
 */
export function seedAt(baseSeed: string, index: number): string {
  return makeSeed(baseSeed, index);
}

/** 絞り込みでどれくらい試行が要るかの目安（配色の潜性は 40 倍以上要る）。 */
export function triesFor(n: number, spec: GenSpec): number {
  if (spec.force) return n + 8;
  const rare = spec.palette === 'pearl' || spec.palette === 'mineral';
  const mul = rare ? 140 : spec.palette ? 24 : spec.base ? 6 : 1;
  return n * mul + 200;
}

// ─────────────────────────────────────────────────────────
//  SVG 化
// ─────────────────────────────────────────────────────────

export interface DrawOpts {
  background: string | null;
  /** bodyBox / faceBox / パーツ bbox / アンカーを重ねる。 */
  debug: boolean;
  /** 手前から何枚目まで描くか（null なら全部）。描画順の確認用。 */
  partLimit?: number | null;
  width?: number | string;
  height?: number | string;
}

/** RenderModel を SVG 文字列にする。partLimit で描画順を段階的に確認できる。 */
export function drawSpecimen(model: RenderModel, opts: DrawOpts): string {
  const limited =
    opts.partLimit == null || opts.partLimit >= model.parts.length
      ? model
      : { ...model, parts: model.parts.slice(0, Math.max(0, opts.partLimit)) };

  const svg = renderCreatureSvg(limited, {
    background: opts.background,
    animatable: false,
    width: opts.width ?? '100%',
    height: opts.height ?? '100%',
  });
  return opts.debug ? svg.replace('</svg>', `${renderDebugOverlay(model)}</svg>`) : svg;
}
