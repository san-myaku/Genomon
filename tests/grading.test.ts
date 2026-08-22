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

  it('同じ個体は同じフレーバーになり、集団では複数の文章が出る', () => {
    const p = phenotypeOf(randomGenotype('flavor-same'), 'adult');
    expect(deriveFlavorText(p)).toEqual(deriveFlavorText(p));

    const texts = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const q = phenotypeOf(randomGenotype(`flavor-${i}`), 'adult');
      texts.add(deriveFlavorText(q).text);
    }
    expect(texts.size).toBeGreaterThan(8);
  });
});
