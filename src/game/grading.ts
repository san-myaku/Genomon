/**
 * 個体鑑定。
 *
 * 普段の飼育では「見えているもの」だけを観察し、鑑定して初めて
 * Genotype の全遺伝子・保因・接合状態・正確な希少度を開示する。
 * 鑑定によって遺伝子そのものは変化しない。情報の解禁だけが起きる。
 *
 * `appraisedAt` は後方互換な追加フィールドとして Creature に載せる。
 * 現行 save validator は未知の追加キーを拒否せず、正常な保存/読込ではそのまま
 * 保持される。破損セーブを coerce で救出した場合だけ失われ得るため、将来
 * セーブ形式を整理する際には正式フィールドへ昇格させる。
 */

import type { CatLocus, Creature, GameState, Genotype, NumLocus, Phenotype, RarityTier } from '../core/types.ts';
import { Rng } from '../core/rng.ts';
import { phenotypeOf } from '../genetics/phenotype.ts';
import { CAT_LOCI, NUM_LOCI, alleleDef, alleleLabel } from '../genetics/loci.ts';
import { deriveFlavorText, type FlavorText } from './flavor.ts';

/** 最初の展示会報酬より少し高く、2回目の展示会が自然な目安になる価格。 */
export const APPRAISAL_COST = 160;

/** Creature の後方互換な追加フィールド。 */
type AppraisedCreature = Creature & { appraisedAt?: number };

export function appraisedAtOf(creature: Creature): number {
  const v = (creature as AppraisedCreature).appraisedAt;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

export function isAppraised(creature: Creature): boolean {
  return appraisedAtOf(creature) > 0;
}

export interface AppraisalAvailability {
  ok: boolean;
  reason?: string;
  cost: number;
}

export function canAppraise(state: GameState, creature: Creature): AppraisalAvailability {
  if (creature.life.stage !== 'adult') {
    return { ok: false, reason: '鑑定できるのは 成体になってからです。', cost: APPRAISAL_COST };
  }
  if (isAppraised(creature)) {
    return { ok: false, reason: 'この子は すでに鑑定済みです。', cost: APPRAISAL_COST };
  }
  if (state.coins < APPRAISAL_COST) {
    return {
      ok: false,
      reason: `鑑定には ${APPRAISAL_COST} コイン必要です。（いま ${Math.floor(state.coins)} コイン）`,
      cost: APPRAISAL_COST,
    };
  }
  return { ok: true, cost: APPRAISAL_COST };
}

export interface AppraisalResult {
  ok: boolean;
  reason?: string;
  charged?: number;
  report?: GeneticReport;
}

/**
 * 鑑定を確定する。二重課金を防ぐため、状態確認→課金→時刻記録を1関数で行う。
 */
export function appraiseCreature(
  state: GameState,
  creatureId: string,
  now = Date.now(),
): AppraisalResult {
  const creature = state.creatures.find((c) => c.id === creatureId);
  if (!creature) return { ok: false, reason: 'その子は 見つかりませんでした。' };

  const available = canAppraise(state, creature);
  if (!available.ok) {
    return {
      ok: false,
      reason: available.reason,
      ...(isAppraised(creature) ? { report: deriveGeneticReport(creature) } : {}),
    };
  }

  state.coins -= APPRAISAL_COST;
  (creature as AppraisedCreature).appraisedAt = Math.max(1, now);
  state.updatedAt = now;
  return { ok: true, charged: APPRAISAL_COST, report: deriveGeneticReport(creature) };
}

// ─────────────────────────────────────────────────────────
//  鑑定前の「見た感じ」
// ─────────────────────────────────────────────────────────

export interface ObservedRarity {
  label: string;
  note: string;
}

/**
 * 「外から見て、目を引く点がいくつあるか」。0 以上の整数。
 *
 * 【`rarity.score` を一切見ない】
 *   あちらは保因・接合状態・数値形質のふるまいまで含んだ、鑑定して初めて
 *   分かる値。ここは **姿だけ** から数える。だから見た目は普通なのに
 *   鑑定すると希少な保因個体だった、が起こり得る（それが鑑定の意味）。
 *
 * 【`traits` ではなく `parts`（実際に描かれた対立遺伝子）を数える】
 *   遺伝的に発現していても、素体の都合で描かれない形質がある
 *   （スライムの羽、耳の無い個体の耳先色、まる素体に吸収される足）。
 *   `traits` の notable を数えると **画面に無いものを数えてしまう**。
 *   1500 体で測ったところ 18% の個体で数が変わる ── 無視できない差。
 *   `parts` に無い座（素体・配色・目の数）はそのまま姿に出ているので
 *   `traits` 側から数える。
 *
 * 見積もり（`game/market.ts`）にも使うので、ここは観察できる情報だけで
 * 閉じていること。
 */
export function observedSignal(pheno: Phenotype): number {
  const parts = pheno.parts as unknown as Record<string, unknown>;
  let notable = 0;
  for (const def of CAT_LOCI) {
    const drawn = parts[def.locus];
    if (typeof drawn === 'string') {
      if (alleleDef(def.locus, drawn)?.notable) notable += 1;
      continue;
    }
    if (pheno.traits.find((t) => t.locus === def.locus)?.notable) notable += 1;
  }
  const unusualMaterial = Number(pheno.parts.texture === 'mineral' || pheno.parts.texture === 'glassy');
  const unusualLight = Number(pheno.parts.lumin !== 'none' && pheno.glow > 0.45);
  return notable + unusualMaterial + unusualLight;
}

/**
 * 鑑定前に出してよい、姿だけの印象。
 * 正確な希少度（`rarity.score` / `tier`）は決して混ぜない。
 */
export function observedRarity(pheno: Phenotype): ObservedRarity {
  const signal = observedSignal(pheno);

  if (signal >= 4) return { label: 'かなり珍しそう', note: '見た目だけでも、珍しい特徴がいくつも確認できます。' };
  if (signal >= 2) return { label: '珍しそう', note: '目につく特徴があります。正確な希少度は鑑定しないと分かりません。' };
  if (signal >= 1) return { label: '少し珍しそう', note: '少し気になる特徴があります。見た目だけでは判断しきれません。' };
  return { label: 'まだ分からない', note: '見た目はおだやかです。隠れた遺伝情報までは観察だけでは分かりません。' };
}

// ─────────────────────────────────────────────────────────
//  全遺伝子レポート
// ─────────────────────────────────────────────────────────

export type Zygosity = 'homozygous' | 'heterozygous';

export interface GeneticAlleleView {
  id: string;
  label: string;
  dominance: number | null;
  notable: boolean;
}

export interface CategoricalGeneReport {
  locus: CatLocus;
  label: string;
  alleles: readonly [GeneticAlleleView, GeneticAlleleView];
  zygosity: Zygosity;
  /** 実際に表へ出るID。共優性なら合成ID。 */
  expressedId: string;
  expressedLabel: string;
  /** 発現しなかった側。ホモ/共優性なら null。 */
  hiddenAllele: GeneticAlleleView | null;
  coExpressed: boolean;
  /**
   * 遺伝的には発現しているのに、**見た目には出ていない** 場合の実際の姿。
   * 出ているとき（＝食い違いが無いとき）は null。
   *
   * 【なぜ要るか — 実際に食い違っていた】
   *   `耳先色` は耳が無ければ描かれない（`phenotype.ts`:
   *   `earTip: expr.ears.id === 'none' ? 'none' : expr.earTip.id`）。
   *   同じ remap は `足`（素体依存）・`羽`（素体依存）にもある。
   *   これを黙って「発現：みみさき色」とだけ出すと、すぐ上の
   *   「見えている特徴：耳先色 なし」と矛盾して読める。
   *   育種家にとっては「持っているが出ていない」こと自体が重要な情報なので、
   *   隠さずに **出ていない理由** を添えて見せる。
   */
  suppressed: { label: string; note: string } | null;
}

export interface NumericGeneReport {
  locus: NumLocus;
  label: string;
  alleles: readonly [number, number];
  mean: number;
  zygosity: Zygosity;
}

export interface GeneticReportSummary {
  categoricalLoci: number;
  numericLoci: number;
  homozygous: number;
  heterozygous: number;
  hiddenAlleles: number;
  notableAlleles: number;
}

export interface GeneticReport {
  seed: string;
  exactRarity: {
    score: number;
    tier: RarityTier;
    reasons: readonly string[];
  };
  categorical: readonly CategoricalGeneReport[];
  numeric: readonly NumericGeneReport[];
  summary: GeneticReportSummary;
  flavor: FlavorText;
}

function catPair(genotype: Genotype, locus: CatLocus): readonly [string, string] {
  const pair = genotype.cat[locus];
  if (pair) return pair;
  const fallback = CAT_LOCI.find((x) => x.locus === locus)?.alleles[0]?.id ?? 'none';
  return [fallback, fallback];
}

function numPair(genotype: Genotype, locus: NumLocus, fallback: number): readonly [number, number] {
  const pair = genotype.num[locus];
  return pair ? [pair[0], pair[1]] : [fallback, fallback];
}

function alleleView(locus: CatLocus, id: string): GeneticAlleleView {
  const def = alleleDef(locus, id);
  return {
    id,
    label: alleleLabel(locus, id),
    dominance: def?.dominance ?? null,
    notable: Boolean(def?.notable),
  };
}

/**
 * phenotype.ts の発現規則と同じ判断を、鑑定表示用に再現する。
 *
 * 【ここが二重実装であることの注意】
 *   本来の発現は `genetics/phenotype.ts` の `expressCat` が決めている。
 *   あちらが公開されていないので同じ規則をここに写しているが、**片方だけ直すと
 *   レポートが嘘をつく**（画面には「発現：A」と出るのに、絵は B で描かれる）。
 *   `tests/grading.test.ts` の「レポートの発現が実際の表現型と一致する」が
 *   全カテゴリ座 × 多数の個体で突き合わせているので、ずれた瞬間に落ちる。
 *   `expressCat` を変えるときは、必ずここも一緒に直すこと。
 *
 * 【seed は必ず genotype.seed を使う】
 *   `expressCat` は `new Rng(genotype.seed)` を根に持つ。`creature.seed` は
 *   通常は同じ値だが、壊れたセーブの復旧（`coerceCreature`）では
 *   別の文字列になり得る。そこで食い違うと、同値ヘテロの座だけ
 *   「発現している方」が入れ替わって表示される。
 */
function expressionFor(
  seed: string,
  locus: CatLocus,
  pair: readonly [string, string],
): { expressedId: string; expressedLabel: string; hidden: string | null; coExpressed: boolean } {
  const raw0 = pair[0];
  const raw1 = pair[1];
  const x = raw0 <= raw1 ? raw0 : raw1;
  const y = raw0 <= raw1 ? raw1 : raw0;
  const dx = alleleDef(locus, x);
  const dy = alleleDef(locus, y);

  if (x === y) return { expressedId: x, expressedLabel: alleleLabel(locus, x), hidden: null, coExpressed: false };
  if (!dx || !dy) {
    const id = dx ? x : dy ? y : x;
    return { expressedId: id, expressedLabel: alleleLabel(locus, id), hidden: null, coExpressed: false };
  }

  if (dx.dominance !== dy.dominance) {
    const win = dx.dominance > dy.dominance ? x : y;
    const hidden = win === x ? y : x;
    return { expressedId: win, expressedLabel: alleleLabel(locus, win), hidden, coExpressed: false };
  }

  const def = CAT_LOCI.find((d) => d.locus === locus);
  if (locus !== 'base' && dx.coDominant && dy.coDominant) {
    const co = def?.coExpress?.[`${x}+${y}`] ?? def?.coExpress?.[`${y}+${x}`];
    if (co) {
      return {
        expressedId: co,
        expressedLabel: `${alleleLabel(locus, x)}＋${alleleLabel(locus, y)}`,
        hidden: null,
        coExpressed: true,
      };
    }
  }

  const pickFirst = new Rng(seed).stream(`express:${locus}`).bool();
  const win = pickFirst ? x : y;
  return {
    expressedId: win,
    expressedLabel: alleleLabel(locus, win),
    hidden: win === x ? y : x,
    coExpressed: false,
  };
}

/**
 * 遺伝的な発現と、実際に描かれる姿が食い違いうる座。
 *
 * `phenotype.ts` が `parts` を作るとき、素体や他の器官の有無で差し替える:
 *   - `earTip` … 耳が無ければ色の出る場所が無い
 *   - `wings`  … スライム型では羽が浮いて見えるので出さない
 *   - `feet`   … 幽霊型は足なし／スライム型は『ねっこ』だけ／
 *                まる型は「足あり」優先で、`none` なら **隠れていた側**が出る
 * 育種家にとっては「持っているのに出ていない」「隠れていた方が出ている」の
 * どちらも重要な情報なので、伏せずに理由を添えて見せる。
 */
const REMAPPED_LOCI: readonly CatLocus[] = ['earTip', 'wings', 'feet'];

function suppressionNote(locus: CatLocus, expressedId: string, shownId: string): string {
  if (shownId === 'none') {
    return locus === 'earTip'
      ? '耳が無いので、色の出る場所がありません。'
      : 'この素体の形には合わないので、姿には出ていません。';
  }
  if (expressedId === 'none') {
    return 'この素体では「なし」がそのまま出ないため、隠れていた側が姿に出ています。';
  }
  return 'この素体の姿では、別のかたちになって出ています。';
}

export function deriveGeneticReport(creature: Creature): GeneticReport {
  const pheno = phenotypeOf(creature.genotype, 'adult');
  const parts = pheno.parts as unknown as Record<string, unknown>;

  const categorical: CategoricalGeneReport[] = CAT_LOCI.map((def) => {
    const pair = catPair(creature.genotype, def.locus);
    const expression = expressionFor(creature.genotype.seed, def.locus, pair);
    // 実際に描かれた姿と食い違っていたら、その事実を添える。
    const shown = typeof parts[def.locus] === 'string' ? (parts[def.locus] as string) : null;
    const suppressed =
      REMAPPED_LOCI.includes(def.locus) && shown !== null && shown !== expression.expressedId
        ? {
            label: alleleLabel(def.locus, shown),
            note: suppressionNote(def.locus, expression.expressedId, shown),
          }
        : null;
    return {
      locus: def.locus,
      label: def.label,
      alleles: [alleleView(def.locus, pair[0]), alleleView(def.locus, pair[1])],
      zygosity: pair[0] === pair[1] ? 'homozygous' : 'heterozygous',
      expressedId: expression.expressedId,
      expressedLabel: expression.expressedLabel,
      hiddenAllele: expression.hidden ? alleleView(def.locus, expression.hidden) : null,
      coExpressed: expression.coExpressed,
      suppressed,
    };
  });

  const numeric: NumericGeneReport[] = NUM_LOCI.map((def) => {
    const pair = numPair(creature.genotype, def.locus, def.mean);
    return {
      locus: def.locus,
      label: def.label,
      alleles: pair,
      mean: (pair[0] + pair[1]) / 2,
      zygosity: Math.abs(pair[0] - pair[1]) < 1e-9 ? 'homozygous' : 'heterozygous',
    };
  });

  const allAlleles = categorical.flatMap((g) => g.alleles);
  return {
    seed: creature.seed,
    exactRarity: {
      score: pheno.rarity.score,
      tier: pheno.rarity.tier,
      reasons: [...pheno.rarity.reasons],
    },
    categorical,
    numeric,
    summary: {
      categoricalLoci: categorical.length,
      numericLoci: numeric.length,
      homozygous: categorical.filter((g) => g.zygosity === 'homozygous').length,
      heterozygous: categorical.filter((g) => g.zygosity === 'heterozygous').length,
      hiddenAlleles: categorical.filter((g) => g.hiddenAllele !== null).length,
      notableAlleles: allAlleles.filter((a) => a.notable).length,
    },
    flavor: deriveFlavorText(pheno),
  };
}
