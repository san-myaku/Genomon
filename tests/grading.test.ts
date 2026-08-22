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
} from '../src/game/index.ts';
import { createCreature } from '../src/game/state.ts';
import { CAT_LOCUS_IDS, NUM_LOCUS_IDS, randomGenotype, phenotypeOf } from '../src/genetics/index.ts';
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

        // 【`耳先色` だけ traits の作りが違う】
        //   `buildTraits` は耳先色に限って **描かれた値** を出し、
        //   羽・足は遺伝的な発現をそのまま出す（phenotype.ts の作りがそうなっている）。
        //   ここではレポートが遺伝的な発現を正しく持っているかを見たいので、
        //   耳先色だけ描かれた側と突き合わせる。
        const expected = row.locus === 'earTip' && row.suppressed ? row.suppressed.label : row.expressedLabel;
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
