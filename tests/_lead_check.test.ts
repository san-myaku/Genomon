/** リードによる独立検証用の一時ファイル（検証後に削除する）。 */
import { describe, it } from 'vitest';
import { randomGenotype } from '../src/genetics/genotype.ts';
import { phenotypeOf } from '../src/genetics/phenotype.ts';
import { breed } from '../src/genetics/breeding.ts';

describe('リード検証', () => {
  it('precious は交配で到達できるか', () => {
    let pop = Array.from({ length: 24 }, (_, i) => randomGenotype(`L${i}`));
    const tierCount: Record<string, number> = {};
    let maxScore = 0;
    let maxSeed = '';
    let firstPreciousGen = -1;

    for (let gen = 0; gen < 12; gen++) {
      const next = [];
      for (let k = 0; k < 24; k++) {
        const a = pop[(k * 7 + gen) % pop.length]!;
        const b = pop[(k * 13 + gen * 5 + 3) % pop.length]!;
        const seed = `G${gen}-${k}`;
        next.push(breed(a, b, seed));
      }
      pop = next;
      for (const g of pop) {
        const p = phenotypeOf(g, 'adult');
        tierCount[p.rarity.tier] = (tierCount[p.rarity.tier] ?? 0) + 1;
        if (p.rarity.score > maxScore) { maxScore = p.rarity.score; maxSeed = g.seed; }
        if (p.rarity.tier === 'precious' && firstPreciousGen < 0) firstPreciousGen = gen;
      }
    }
    console.log('[rarity] 12世代×24体 tier分布 =', JSON.stringify(tierCount));
    console.log('[rarity] 最高score =', maxScore.toFixed(1), 'seed =', maxSeed);
    console.log('[rarity] precious 初出世代 =', firstPreciousGen);
  });

  it('幼体と成体で表現型が実際に変わるか', () => {
    let changedParts = 0;
    let sameAll = 0;
    const diffs: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      const g = randomGenotype(`S${i}`);
      const j = phenotypeOf(g, 'juvenile');
      const a = phenotypeOf(g, 'adult');
      let anyDiff = false;
      for (const k of Object.keys(a.parts) as (keyof typeof a.parts)[]) {
        if (String(j.parts[k]) !== String(a.parts[k])) {
          diffs[k] = (diffs[k] ?? 0) + 1;
          anyDiff = true;
        }
      }
      if (anyDiff) changedParts++; else sameAll++;
    }
    console.log('[stage] 200体中 幼→成でパーツが変化した個体 =', changedParts, '/ 変化なし =', sameAll);
    console.log('[stage] 変化した部位の内訳 =', JSON.stringify(diffs));
  });

  it('素体ごとの分布と装飾数の分布', () => {
    const baseCount: Record<string, number> = {};
    const decorHist = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const DECOR = ['ears', 'antennae', 'horns', 'plant', 'wings', 'tail', 'crystal', 'collar', 'floaters'] as const;
    for (let i = 0; i < 500; i++) {
      const p = phenotypeOf(randomGenotype(`D${i}`), 'adult');
      baseCount[p.base] = (baseCount[p.base] ?? 0) + 1;
      let n = 0;
      for (const d of DECOR) if (p.parts[d] && p.parts[d] !== 'none') n++;
      decorHist[Math.min(n, 8)]!++;
    }
    console.log('[base] 500体の素体分布 =', JSON.stringify(baseCount));
    console.log('[decor] 装飾器官の個数分布 (0個..8個) =', JSON.stringify(decorHist));
  });
});
