import { describe, expect, it } from 'vitest';

import type { Creature, GameState, Genotype } from '../src/core/types.ts';
import {
  APPRAISAL_COST,
  appraiseCreature,
  canAppraise,
  deriveFlavorText,
  deriveGeneticReport,
  isAppraised,
  newGame,
  observedRarity,
  observedSignal,
  saleQuote,
} from '../src/game/index.ts';
import { createCreature } from '../src/game/state.ts';
import { CAT_LOCUS_IDS, NUM_LOCUS_IDS, randomGenotype, phenotypeOf } from '../src/genetics/index.ts';
import { visibleTraits as uiVisibleTraits } from '../src/ui/traits.ts';
import { clearSave, load, resetStorageCache, save } from '../src/save/index.ts';
import { coerceState } from '../src/save/schema.ts';
import { CAT_LOCI } from '../src/genetics/loci.ts';

const T0 = 1_800_000_000_000;

function pushAdult(state: GameState, genotype: Genotype, now = T0): Creature {
  const c = createCreature(state, genotype, now, {
    parents: null,
    parentNames: null,
    generation: 1,
    fromBreeding: false,
  });
  c.life.stage = 'adult';
  c.life.growth = 100;
  c.life.hatchProgress = 100;
  state.creatures.push(c);
  return c;
}

describe('個体鑑定', () => {
  it('成体だけ鑑定でき、160コインを一度だけ支払う', () => {
    const state = newGame('grading-pay');
    state.coins = APPRAISAL_COST + 90;
    const c = pushAdult(state, randomGenotype('grading-pay-g'), T0);

    expect(canAppraise(state, c).ok).toBe(true);
    const before = state.coins;
    const first = appraiseCreature(state, c.id, T0 + 10);
    expect(first.ok).toBe(true);
    expect(first.charged).toBe(APPRAISAL_COST);
    expect(state.coins).toBe(before - APPRAISAL_COST);
    expect(isAppraised(c)).toBe(true);

    const afterFirst = state.coins;
    const second = appraiseCreature(state, c.id, T0 + 20);
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('鑑定済み');
    expect(state.coins).toBe(afterFirst);
  });

  it('卵・幼体は鑑定できず、コインも減らない', () => {
    const state = newGame('grading-stage');
    state.coins = 999;
    const c = createCreature(state, randomGenotype('grading-stage-g'), T0, {
      parents: null,
      parentNames: null,
      generation: 1,
      fromBreeding: false,
    });
    state.creatures.push(c);

    const before = state.coins;
    const egg = appraiseCreature(state, c.id, T0 + 1);
    expect(egg.ok).toBe(false);
    expect(state.coins).toBe(before);

    c.life.stage = 'juvenile';
    const juv = appraiseCreature(state, c.id, T0 + 2);
    expect(juv.ok).toBe(false);
    expect(state.coins).toBe(before);
  });

  it('実際の save/load を通しても鑑定済み状態が残る', () => {
    resetStorageCache();
    clearSave();

    const state = newGame('grading-persist');
    state.coins = 999;
    const c = pushAdult(state, randomGenotype('grading-persist-g'));
    expect(appraiseCreature(state, c.id, T0 + 123).ok).toBe(true);
    expect(save(state).ok).toBe(true);

    const restored = load();
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error('save/load failed');
    expect(isAppraised(restored.state.creatures.find((x) => x.id === c.id)!)).toBe(true);

    clearSave();
    resetStorageCache();
  });
});

describe('全遺伝子レポート', () => {
  it('すべてのカテゴリ座・数値座を開示し、元Genotypeと一致する', () => {
    const state = newGame('grading-report');
    const c = pushAdult(state, randomGenotype('grading-report-g'));
    const report = deriveGeneticReport(c);

    expect(report.categorical).toHaveLength(CAT_LOCUS_IDS.length);
    expect(report.numeric).toHaveLength(NUM_LOCUS_IDS.length);

    for (const row of report.categorical) {
      const pair = c.genotype.cat[row.locus];
      expect(row.alleles.map((a) => a.id)).toEqual([pair[0], pair[1]]);
      expect(row.zygosity).toBe(pair[0] === pair[1] ? 'homozygous' : 'heterozygous');
    }
    for (const row of report.numeric) {
      const pair = c.genotype.num[row.locus];
      expect(row.alleles).toEqual([pair[0], pair[1]]);
      expect(row.mean).toBeCloseTo((pair[0] + pair[1]) / 2, 12);
    }
  });

  it('正確な希少度はPhenotypeと一致し、レポートは決定論的', () => {
    const state = newGame('grading-rarity');
    const g = randomGenotype('grading-rarity-g');
    const c = pushAdult(state, g);
    const pheno = phenotypeOf(g, 'adult');
    const a = deriveGeneticReport(c);
    const b = deriveGeneticReport(c);

    expect(b).toEqual(a);
    expect(a.exactRarity.score).toBe(pheno.rarity.score);
    expect(a.exactRarity.tier).toBe(pheno.rarity.tier);
    expect(a.exactRarity.reasons).toEqual(pheno.rarity.reasons);
  });
});

describe('鑑定前の観察とフレーバー', () => {
  it('観察上の希少度は数値を返さない', () => {
    const p = phenotypeOf(randomGenotype('observed-only'), 'adult');
    const rough = observedRarity(p);
    expect(typeof rough.label).toBe('string');
    expect(typeof rough.note).toBe('string');
    expect((rough as unknown as Record<string, unknown>)['score']).toBeUndefined();
  });

  it('同じ個体は同じフレーバーになる', () => {
    const p = phenotypeOf(randomGenotype('flavor-same'), 'adult');
    expect(deriveFlavorText(p)).toEqual(deriveFlavorText(p));
  });

  /**
   * 【なぜ「種類が 8 より多い」では足りなかったか — 実測】
   *   最初の版はこの検査を通っていたが、600 個体で数えると
   *   **39 種類しか出ず、最頻の 1 文が 11%**、半数の個体が 11 種類に
   *   集中していた（「毛がある」だけで 36% の個体が同じ文になっていた）。
   *   集めて眺めるゲームでは、すぐ「また同じ文」に気づく。
   *   種類の数ではなく **偏り** を見る。
   */
  it('600 個体で、同じ文に偏らない', () => {
    const counts = new Map<string, number>();
    const N = 600;
    for (let i = 0; i < N; i++) {
      const q = phenotypeOf(randomGenotype(`flavor-dist-${i}`), 'adult');
      const t = deriveFlavorText(q).text;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const sorted = [...counts.values()].sort((a, b) => b - a);

    // 種類そのもの
    expect(counts.size, '文の種類が少なすぎる').toBeGreaterThanOrEqual(90);
    // 最頻の 1 文が全体を占めていないこと
    expect(sorted[0]! / N, '同じ文が出すぎる').toBeLessThan(0.06);
    // 半数の個体が、ごく少数の文に集中していないこと
    let acc = 0;
    let half = 0;
    for (const n of sorted) {
      acc += n;
      half++;
      if (acc >= N / 2) break;
    }
    expect(half, '半数の個体が少数の文に集中している').toBeGreaterThanOrEqual(20);
  });

  it('カード用の要約にも、本編と同じフレーバーが載る', () => {
    const state = newGame('flavor-report');
    const c = pushAdult(state, randomGenotype('flavor-report-g'));
    const report = deriveGeneticReport(c);
    expect(report.flavor).toEqual(deriveFlavorText(phenotypeOf(c.genotype, 'adult')));
  });
});

describe('レポートが実際の表現型と食い違わないこと', () => {
  /**
   * 【なぜこの検査が要るか】
   *   `grading.ts` の `expressionFor` は `genetics/phenotype.ts` の `expressCat` を
   *   **写した二重実装**。片方だけ直すと、レポートには「発現：A」と出るのに
   *   絵は B で描かれる、という嘘のレポートになる。型もテストも通ってしまうので、
   *   ここで実際の Phenotype と突き合わせて機械的に捕まえる。
   *
   *   `Phenotype.traits` は発現している値（value）と保因（carrier）を持つので、
   *   それをレポートの expressedLabel / hiddenAllele と 1 対 1 で比べればよい。
   */
  it('全カテゴリ座で、発現アレルと保因アレルが Phenotype と一致する', () => {
    const state = newGame('report-agree');
    const mismatched: string[] = [];

    for (let i = 0; i < 120; i++) {
      const g = randomGenotype(`agree-${i}`);
      const c = pushAdult(state, g, T0 + i);
      const report = deriveGeneticReport(c);
      const pheno = phenotypeOf(g, 'adult');

      const parts = pheno.parts as unknown as Record<string, unknown>;
      for (const row of report.categorical) {
        const trait = pheno.traits.find((t) => t.locus === row.locus);
        if (!trait) continue; // traits に載らない座（発光・2色ほか）は比較対象外

        // 【`traits` は「描かれた値」、レポートは「遺伝的な発現」】
        //   `buildTraits` は姿に出ている値を出す。素体の都合で発現が
        //   描かれない座（耳先色・羽・足）では、そこがレポートの
        //   `expressedLabel` とわざと食い違う。食い違う場合の正解は
        //   レポート側が添えている `suppressed.label`（＝描かれた値）。
        //   以前は耳先色だけを特別扱いしていたが、`buildTraits` が
        //   座ごとの if をやめて 1 つの規則になったので、こちらも
        //   **全座で同じ突き合わせ** にする（見る範囲は広がっている）。
        const expected = row.suppressed ? row.suppressed.label : row.expressedLabel;
        if (trait.value !== expected) {
          mismatched.push(`${row.locus} 発現 ${expected} ≠ ${trait.value}`);
        }
        const carrier = trait.carrier ?? null;
        const hidden = row.hiddenAllele?.label ?? null;
        if (carrier !== hidden) {
          mismatched.push(`${row.locus} 保因 ${String(hidden)} ≠ ${String(carrier)}`);
        }

        // 姿と食い違うなら、必ず理由が添えられていること。
        const shownId = parts[row.locus];
        if (typeof shownId === 'string' && shownId !== row.expressedId && !row.suppressed) {
          mismatched.push(`${row.locus} 姿(${shownId})と発現(${row.expressedId})の食い違いに説明が無い`);
        }
      }
    }
    expect(mismatched.slice(0, 8)).toEqual([]);
  });

  it('カテゴリ座はカタログの全座をもれなく出す', () => {
    const state = newGame('report-cover');
    const c = pushAdult(state, randomGenotype('report-cover-g'));
    const report = deriveGeneticReport(c);
    expect(report.categorical.map((g) => g.locus)).toEqual(CAT_LOCI.map((d) => d.locus));
  });
});

describe('鑑定状態の保存', () => {
  /**
   * 【壊れたセーブの救出でも鑑定を落とさない】
   *   `appraisedAt` は Creature の正式フィールドではないので、1 フィールドずつ
   *   組み直す `coerceState` では拾わないと消える。プレイヤーから見れば
   *   「壊れたセーブを直したら、お金を払った鑑定だけ無かったことになった」。
   */
  it('coerceState（破損セーブの救出）でも鑑定済みが残る', () => {
    const state = newGame('grading-coerce');
    state.coins = 999;
    const c = pushAdult(state, randomGenotype('grading-coerce-g'));
    expect(appraiseCreature(state, c.id, T0 + 5).ok).toBe(true);

    // JSON を一往復させてから、壊れたセーブとして救出させる。
    const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    (raw as { version?: unknown }).version = 'broken';
    const rescued = coerceState(raw);
    expect(rescued).not.toBeNull();
    const revived = rescued!.creatures.find((x) => x.id === c.id);
    expect(revived, '救出で個体ごと消えている').toBeTruthy();
    expect(isAppraised(revived!)).toBe(true);
  });

  it('未鑑定の個体は救出後も未鑑定のまま', () => {
    const state = newGame('grading-coerce2');
    const c = pushAdult(state, randomGenotype('grading-coerce2-g'));
    const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    const rescued = coerceState(raw);
    expect(isAppraised(rescued!.creatures.find((x) => x.id === c.id)!)).toBe(false);
  });
});

describe('見た目に出ない発現の扱い', () => {
  /**
   * 【実際に食い違っていた】
   *   耳が無い個体は、耳先色が遺伝的に発現していても描かれない
   *   （`phenotype.ts`: `earTip: expr.ears.id === 'none' ? 'none' : expr.earTip.id`）。
   *   レポートが「発現：みみさき色」とだけ出すと、すぐ上の
   *   「見えている特徴：耳先色 なし」と矛盾して読める。
   *   持っていることと出ていることを **両方** 書けているかを見る。
   */
  it('耳が無い個体の耳先色は、発現と「出ていない理由」の両方を持つ', () => {
    const state = newGame('suppressed');
    let found = 0;

    for (let i = 0; i < 400 && found < 3; i++) {
      const g = randomGenotype(`suppressed-${i}`);
      const pheno = phenotypeOf(g, 'adult');
      if (pheno.parts.ears !== 'none' || pheno.parts.earTip !== 'none') continue;
      const c = pushAdult(state, g, T0 + i);
      const row = deriveGeneticReport(c).categorical.find((x) => x.locus === 'earTip');
      if (!row || row.expressedId === 'none') continue;

      found++;
      expect(row.suppressed, '出ていない理由が書かれていない').not.toBeNull();
      expect(row.suppressed!.label).toBe('なし');
      expect(row.suppressed!.note.length).toBeGreaterThan(4);
    }
    expect(found, '検査対象の個体が見つからなかった（検査が空回りしている）').toBeGreaterThan(0);
  });

  it('食い違いが無い座には理由を付けない', () => {
    const state = newGame('suppressed-none');
    const c = pushAdult(state, randomGenotype('suppressed-none-g'));
    const report = deriveGeneticReport(c);
    const pheno = phenotypeOf(c.genotype, 'adult');
    for (const row of report.categorical) {
      const parts = pheno.parts as unknown as Record<string, unknown>;
      if (parts[row.locus] === row.expressedId) expect(row.suppressed).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────
//  市場の値づけ（D-041）
// ─────────────────────────────────────────────────────────

/**
 * 「姿はまったく同じなのに、かくれて持っているものだけが違う」2 体を探す。
 *
 * これが作れないと、下の検査は「価格が rarity から決まっていない」ことを
 * 何も示せない（姿ごと違えば価格が違って当たり前）。見つからなければ
 * その場で落ちるようにしてあるので、検査が空回りすることはない。
 */
function twinsDifferingOnlyInHiddenAlleles(minScoreGap = 0): {
  visible: Genotype;
  carrier: Genotype;
  locus: string;
} {
  for (let i = 0; i < 1200; i++) {
    const g = randomGenotype(`hidden-twin-${i}`);
    const pa = phenotypeOf(g, 'adult');
    for (const def of CAT_LOCI) {
      const pair = g.cat[def.locus];
      if (!pair) continue;
      for (const alt of def.alleles) {
        if (alt.id === pair[0] || alt.id === pair[1]) continue;
        const b: Genotype = { ...g, cat: { ...g.cat, [def.locus]: [pair[0], alt.id] } };
        const pb = phenotypeOf(b, 'adult');
        if (
          JSON.stringify(pa.parts) === JSON.stringify(pb.parts) &&
          observedSignal(pa) === observedSignal(pb) &&
          Math.abs(pa.rarity.score - pb.rarity.score) > minScoreGap
        ) {
          return { visible: g, carrier: b, locus: def.locus };
        }
      }
    }
  }
  throw new Error('姿が同じで隠れた遺伝子だけ違う 2 体を作れなかった');
}

function marketReady(seed: string): GameState {
  const state = newGame(seed);
  state.unlocks.breeder = true;
  state.breeder.licensed = true;
  return state;
}

function priceOf(state: GameState, c: Creature): number {
  const q = saleQuote(state, c.id);
  if (!q.ok) throw new Error(q.reason);
  return q.quote.price;
}

describe('市場の値づけ', () => {
  /**
   * 【この検査が守るもの】
   *   以前は `rarity.score` を常に価格へ入れ、**表示上の内訳だけ** 1 本に
   *   まとめて隠していた。価格は rarity の単調増加関数で、他の項（段階・
   *   体調ゲージ・最高得点・世代）はすべて画面に出ているので、
   *   引き算すれば希少度が復元できた。表示ではなく計算を分けたことを、
   *   実際に「姿が同じで中身だけ違う 2 体」で確かめる。
   */
  it('未鑑定の見積もりは、姿が同じなら隠れた遺伝子が違っても同じ額', () => {
    // 【差の大きさを要求する理由】
    //   価格は 10 コイン単位に丸める。希少度の差が小さい 2 体を選ぶと、
    //   たとえ希少度が価格に混ざっていても丸めが吸収してしまい、
    //   **漏れがあっても通ってしまう検査** になる（実際に一度そうなった）。
    //   丸めを越える差を持つ組を選んで、混ざっていれば必ず落ちるようにする。
    const { visible, carrier } = twinsDifferingOnlyInHiddenAlleles(12);
    const state = marketReady('market-hidden');
    const a = pushAdult(state, visible, T0);
    const b = pushAdult(state, carrier, T0);
    pushAdult(state, randomGenotype('market-hidden-spare'), T0);
    // 体調・実績・世代をそろえる（価格の他の項が動かないように）。
    b.life = { ...a.life };
    b.bestScore = a.bestScore;
    b.exhibitionCount = a.exhibitionCount;
    b.generation = a.generation;

    expect(phenotypeOf(a.genotype, 'adult').rarity.score).not.toBe(
      phenotypeOf(b.genotype, 'adult').rarity.score,
    );
    expect(priceOf(state, a)).toBe(priceOf(state, b));
  });

  /**
   * 最終価格は 10 コイン単位に丸めるので、希少度の差が小さいと同額に
   * 収まることがある（それは丸めの仕様であって漏れではない）。ここで見たいのは
   * 「鑑定書があると遺伝的な差が価格に効く」ことなので、丸めに吸収されない
   * 大きさの差を持つ 2 体を選ぶ。
   */
  it('鑑定すると、その隠れた違いが価格に現れる', () => {
    const { visible, carrier } = twinsDifferingOnlyInHiddenAlleles(12);
    const state = marketReady('market-hidden-appraised');
    state.coins = APPRAISAL_COST * 4;
    const a = pushAdult(state, visible, T0);
    const b = pushAdult(state, carrier, T0);
    pushAdult(state, randomGenotype('market-hidden-appraised-spare'), T0);
    b.life = { ...a.life };
    b.bestScore = a.bestScore;
    b.exhibitionCount = a.exhibitionCount;
    b.generation = a.generation;

    // 鑑定前は同額であること（この 2 体が「姿が同じ」であることの確認）。
    expect(priceOf(state, a)).toBe(priceOf(state, b));

    expect(appraiseCreature(state, a.id, T0 + 1).ok).toBe(true);
    expect(appraiseCreature(state, b.id, T0 + 2).ok).toBe(true);

    const qa = saleQuote(state, a.id);
    const qb = saleQuote(state, b.id);
    expect(qa.ok && qb.ok).toBe(true);
    if (!qa.ok || !qb.ok) return;
    expect(qa.quote.rarityBonus).not.toBe(qb.quote.rarityBonus);
    expect(priceOf(state, a)).not.toBe(priceOf(state, b));
  });

  it('希少度の上乗せは未鑑定では 0、鑑定後だけ付く', () => {
    const state = marketReady('market-rarity-row');
    state.coins = APPRAISAL_COST * 2;
    const c = pushAdult(state, randomGenotype('market-rarity-row-g'), T0);
    pushAdult(state, randomGenotype('market-rarity-row-2'), T0);
    pushAdult(state, randomGenotype('market-rarity-row-3'), T0);

    const before = saleQuote(state, c.id);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.quote.appraised).toBe(false);
    expect(before.quote.rarityBonus).toBe(0);
    // 「見た目の評価」は鑑定と関係なく付く（未鑑定でも 0 に潰さない）。
    expect(before.quote.observedBonus).toBeGreaterThanOrEqual(0);

    expect(appraiseCreature(state, c.id, T0 + 5).ok).toBe(true);
    const after = saleQuote(state, c.id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.quote.appraised).toBe(true);
    expect(after.quote.rarityBonus).toBeGreaterThan(0);
    // 鑑定書は価値を足すだけ。他の項は 1 コインも動かない。
    expect(after.quote.base).toBe(before.quote.base);
    expect(after.quote.observedBonus).toBe(before.quote.observedBonus);
    expect(after.quote.conditionBonus).toBe(before.quote.conditionBonus);
    expect(after.quote.exhibitionBonus).toBe(before.quote.exhibitionBonus);
    expect(after.quote.generationBonus).toBe(before.quote.generationBonus);
    expect(after.quote.price).toBeGreaterThan(before.quote.price);
  });

  it('内訳の合計が価格と一致する（UI がどの行を出しても額がずれない）', () => {
    const state = marketReady('market-sum');
    state.coins = APPRAISAL_COST * 2;
    const c = pushAdult(state, randomGenotype('market-sum-g'), T0);
    pushAdult(state, randomGenotype('market-sum-2'), T0);
    pushAdult(state, randomGenotype('market-sum-3'), T0);

    for (const step of ['before', 'after'] as const) {
      if (step === 'after') expect(appraiseCreature(state, c.id, T0 + 7).ok).toBe(true);
      const q = saleQuote(state, c.id);
      expect(q.ok).toBe(true);
      if (!q.ok) return;
      const { base, observedBonus, conditionBonus, rarityBonus, exhibitionBonus, generationBonus, price } = q.quote;
      const sum = base + observedBonus + conditionBonus + rarityBonus + exhibitionBonus + generationBonus;
      expect(price, step).toBe(Math.max(40, Math.round(sum / 10) * 10));
    }
  });

  /**
   * 見た目の評価は「姿」だけから決まること。姿が同じなら必ず同じ値になる
   * ── これが崩れると、未鑑定の価格から隠れた情報が漏れる経路が復活する。
   */
  it('見た目の評価は、姿が同じなら必ず同じ値', () => {
    const { visible, carrier } = twinsDifferingOnlyInHiddenAlleles();
    expect(observedSignal(phenotypeOf(visible, 'adult'))).toBe(
      observedSignal(phenotypeOf(carrier, 'adult')),
    );
  });
});

// ─────────────────────────────────────────────────────────
//  「見えている特徴」と「全遺伝子レポート」の役割分担（D-041）
// ─────────────────────────────────────────────────────────

describe('観察情報と遺伝情報の分離', () => {
  /**
   * 詳細画面の「見えている 特徴」欄は、UI 層の `visibleTraits` から作る。
   * ここに保因が残っていると、画面側の書き方ひとつで
   * 「観察したこと」と「鑑定書を読んで分かったこと」が混ざる。
   * 混ざらないことを、画面ではなくデータの形で保証する。
   */
  it('UI 層の visibleTraits は、鑑定済みでも保因を渡さない', () => {
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      const pheno = phenotypeOf(randomGenotype(`ui-traits-${i}`), 'adult');
      // genetics 側の正本には保因が載っていること（検査が空回りしていない確認）。
      if (pheno.traits.some((t) => t.carrier)) checked += 1;
      for (const t of uiVisibleTraits(pheno, 'adult')) {
        expect(t.carrier, `${String(t.locus)} に保因が残っている`).toBeUndefined();
      }
    }
    expect(checked, '保因を持つ個体が 1 体も無かった（検査が空回りしている）').toBeGreaterThan(0);
  });

  /** 落とすのは保因だけ。見えている値・ラベル・めずらしさの印は残す。 */
  it('保因以外は落とさない', () => {
    const pheno = phenotypeOf(randomGenotype('ui-traits-keep'), 'adult');
    const src = pheno.traits;
    const out = uiVisibleTraits(pheno, 'adult');
    expect(out).toHaveLength(src.length);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]!.locus).toBe(src[i]!.locus);
      expect(out[i]!.label).toBe(src[i]!.label);
      expect(out[i]!.value).toBe(src[i]!.value);
      expect(out[i]!.notable).toBe(src[i]!.notable);
    }
  });
});
