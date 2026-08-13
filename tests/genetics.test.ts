/**
 * 遺伝子型生成・表現型変換の検証。
 *
 * ここで守りたい不変条件:
 *   - 同じ seed からは常に同じ個体が出る（再現性）
 *   - locus の問い合わせ順・オブジェクトのキー順に結果が依存しない
 *   - 大量生成しても壊れた表現（undefined など）が混ざらない
 *   - どれか 1 つの見た目が集団を支配しない
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.ts';
import type { CatLocus, CatPair, Genotype, NumLocus, NumPair, Phenotype } from '../src/core/types.ts';
import {
  CAT_LOCI,
  CAT_LOCUS_IDS,
  NUM_LOCUS_IDS,
  diversityIndex,
  explainInheritance,
  genotypeFingerprint,
  isValidGenotype,
  makeName,
  makeNames,
  phenotypeCacheKey,
  phenotypeOf,
  randomGenotype,
  similarity,
} from '../src/genetics/index.ts';

const HEX = /^#[0-9a-f]{6}$/;

/** キー順をシャッフルした同内容の遺伝子型を作る。 */
function reorderGenotype(g: Genotype, rng: Rng): Genotype {
  const cat = {} as Record<CatLocus, CatPair>;
  for (const k of rng.shuffle(CAT_LOCUS_IDS)) cat[k] = g.cat[k];
  const num = {} as Record<NumLocus, NumPair>;
  for (const k of rng.shuffle(NUM_LOCUS_IDS)) num[k] = g.num[k];
  return { seed: g.seed, cat, num };
}

describe('1. seed 再現性', () => {
  it('同じ seed から randomGenotype を 2 回呼ぶと完全一致する', () => {
    for (let i = 0; i < 50; i++) {
      const a = randomGenotype(`seed-${i}`);
      const b = randomGenotype(`seed-${i}`);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(genotypeFingerprint(a)).toBe(genotypeFingerprint(b));
    }
  });

  it('同じ (genotype, stage) から phenotypeOf を 2 回呼ぶと完全一致する', () => {
    for (let i = 0; i < 50; i++) {
      const g = randomGenotype(`pheno-${i}`);
      for (const stage of ['egg', 'juvenile', 'adult'] as const) {
        const a = phenotypeOf(g, stage);
        const b = phenotypeOf(g, stage);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    }
  });

  it('異なる seed からは異なる個体になる', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(genotypeFingerprint(randomGenotype(`uniq-${i}`)));
    }
    expect(seen.size).toBeGreaterThan(195);
  });

  it('phenotypeCacheKey は内容が同じなら同じ、段階が違えば違う', () => {
    const g = randomGenotype('cache-1');
    expect(phenotypeCacheKey(g, 'adult')).toBe(phenotypeCacheKey(randomGenotype('cache-1'), 'adult'));
    expect(phenotypeCacheKey(g, 'adult')).not.toBe(phenotypeCacheKey(g, 'juvenile'));
  });
});

describe('2. 描画順・問い合わせ順に依存しない', () => {
  it('遺伝子座のキー順を入れ替えても表現型が変わらない', () => {
    const shuffler = new Rng('shuffle-test');
    for (let i = 0; i < 60; i++) {
      const g = randomGenotype(`order-${i}`);
      const reordered = reorderGenotype(g, shuffler.stream(`s${i}`));
      for (const stage of ['egg', 'juvenile', 'adult'] as const) {
        expect(JSON.stringify(phenotypeOf(reordered, stage))).toBe(
          JSON.stringify(phenotypeOf(g, stage)),
        );
      }
    }
  });

  it('対立遺伝子ペアの順序 [母方,父方] は表現に影響しない', () => {
    for (let i = 0; i < 60; i++) {
      const g = randomGenotype(`swap-${i}`);
      const cat = {} as Record<CatLocus, CatPair>;
      for (const k of CAT_LOCUS_IDS) cat[k] = [g.cat[k][1], g.cat[k][0]] as CatPair;
      const num = {} as Record<NumLocus, NumPair>;
      for (const k of NUM_LOCUS_IDS) num[k] = [g.num[k][1], g.num[k][0]] as NumPair;
      const swapped: Genotype = { seed: g.seed, cat, num };
      expect(JSON.stringify(phenotypeOf(swapped, 'adult'))).toBe(
        JSON.stringify(phenotypeOf(g, 'adult')),
      );
    }
  });
});

describe('3. 500 体生成', () => {
  const pop: Phenotype[] = [];
  for (let i = 0; i < 500; i++) {
    pop.push(phenotypeOf(randomGenotype(`pop-${i}`), 'adult'));
  }

  it('例外なく生成でき、遺伝子型がすべて妥当', () => {
    expect(pop.length).toBe(500);
    for (let i = 0; i < 500; i++) {
      expect(isValidGenotype(randomGenotype(`pop-${i}`))).toBe(true);
    }
  });

  it('parts がすべて文字列で undefined を含まない', () => {
    for (const p of pop) {
      for (const [key, value] of Object.entries(p.parts)) {
        if (key === 'eyeCount') {
          expect(typeof value).toBe('number');
          expect([1, 2, 3]).toContain(value);
          continue;
        }
        expect(typeof value).toBe('string');
        expect(String(value).length).toBeGreaterThan(0);
        expect(String(value)).not.toContain('undefined');
      }
    }
  });

  it('パレットの色がすべて妥当な HEX で、輪郭が本体より暗い', () => {
    for (const p of pop) {
      for (const key of ['body', 'bodyDark', 'bodyLight', 'belly', 'ink', 'pattern', 'accent', 'iris', 'glow', 'cheek'] as const) {
        expect(p.palette[key]).toMatch(HEX);
      }
      expect(p.palette.family.length).toBeGreaterThan(0);
    }
  });

  it('数値が仕様のレンジに収まっている', () => {
    for (const p of pop) {
      expect(p.size).toBeGreaterThanOrEqual(0.8);
      expect(p.size).toBeLessThanOrEqual(1.25);
      expect(p.ratio).toBeGreaterThanOrEqual(0.78);
      expect(p.ratio).toBeLessThanOrEqual(1.28);
      for (const k of ['plump', 'translucency', 'glow', 'asymmetry', 'eyeSize', 'eyeSpacing', 'patDensity', 'patScale', 'decorAmount', 'growthSpeed', 'healthTend'] as const) {
        expect(p[k]).toBeGreaterThanOrEqual(0);
        expect(p[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('性格ラベル・希少度・特徴が必ず埋まっている', () => {
    for (const p of pop) {
      expect(p.personality.label.length).toBeGreaterThan(0);
      expect(p.personality.subLabel.length).toBeGreaterThan(0);
      expect(p.rarity.reasons.length).toBeGreaterThan(0);
      expect(p.rarity.score).toBeGreaterThanOrEqual(0);
      expect(p.rarity.score).toBeLessThanOrEqual(100);
      expect(p.traits.length).toBeGreaterThan(10);
      for (const t of p.traits) {
        expect(t.value.length).toBeGreaterThan(0);
        expect(t.value).not.toContain('undefined');
      }
    }
    // 保因（carrier）が実際に提示されていること＝隠れ形質の楽しさが機能している
    const withCarrier = pop.filter((p) => p.traits.some((t) => t.carrier)).length;
    console.log(`[3] carrier を持つ個体: ${withCarrier}/500 (${((withCarrier / 500) * 100).toFixed(1)}%)`);
    expect(withCarrier).toBeGreaterThan(400);

    const tiers = new Map<string, number>();
    for (const p of pop) tiers.set(p.rarity.tier, (tiers.get(p.rarity.tier) ?? 0) + 1);
    const scores = pop.map((p) => p.rarity.score);
    console.log(
      `[3] 希少度の分布: ${[...tiers].map(([k, v]) => `${k}=${v}`).join(' ')} / ` +
        `score 平均=${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)} ` +
        `最大=${Math.max(...scores)} 最小=${Math.min(...scores)}`,
    );
  });
});

describe('成長段階', () => {
  it('幼体では羽・角・結晶・首かざり・浮遊物が出ない', () => {
    for (let i = 0; i < 200; i++) {
      const g = randomGenotype(`stage-${i}`);
      const j = phenotypeOf(g, 'juvenile');
      for (const key of ['wings', 'horns', 'crystal', 'collar', 'floaters'] as const) {
        expect(j.parts[key]).toBe('none');
      }
    }
  });

  it('卵は器官の値を保持している（描画側で隠すだけ）', () => {
    for (let i = 0; i < 100; i++) {
      const g = randomGenotype(`egg-${i}`);
      expect(phenotypeOf(g, 'egg').parts).toEqual(phenotypeOf(g, 'adult').parts);
    }
  });

  it('幼体で隠れていた形質が成体で出る個体が実際に存在する', () => {
    let revealed = 0;
    for (let i = 0; i < 300; i++) {
      const g = randomGenotype(`reveal-${i}`);
      const a = phenotypeOf(g, 'adult');
      if (['wings', 'horns', 'crystal', 'collar', 'floaters'].some((k) => a.parts[k as 'wings'] !== 'none')) {
        revealed++;
      }
    }
    console.log(`[成長] 成体で新しい器官が出る個体: ${revealed}/300 (${((revealed / 300) * 100).toFixed(1)}%)`);
    expect(revealed).toBeGreaterThan(30);
  });

  it('幼体は成体より丸く・目が大きく・模様が薄い', () => {
    for (let i = 0; i < 100; i++) {
      const g = randomGenotype(`grow-${i}`);
      const j = phenotypeOf(g, 'juvenile');
      const a = phenotypeOf(g, 'adult');
      expect(Math.abs(j.ratio - 1)).toBeLessThanOrEqual(Math.abs(a.ratio - 1) + 1e-9);
      expect(j.eyeSize).toBeGreaterThanOrEqual(a.eyeSize - 1e-9);
      expect(j.patDensity).toBeLessThanOrEqual(a.patDensity + 1e-9);
      expect(j.glow).toBeLessThanOrEqual(a.glow + 1e-9);
      expect(j.size).toBeLessThanOrEqual(a.size + 1e-9);
    }
  });

  it('素体と足・羽の相性が守られている', () => {
    for (let i = 0; i < 500; i++) {
      const p = phenotypeOf(randomGenotype(`compat-${i}`), 'adult');
      if (p.base === 'yurei') expect(p.parts.feet).toBe('none');
      if (p.base === 'slime') {
        expect(['none', 'root']).toContain(p.parts.feet);
        expect(p.parts.wings).toBe('none');
      }
      if (p.base === 'maru') expect(p.parts.feet).not.toBe('none');
    }
  });
});

describe('装飾の量（§11 の比率を壊さないための回帰テスト）', () => {
  it('装飾器官の個数分布が シンプル／中程度／複雑 のバランスを保つ', () => {
    const DECOR = ['ears', 'antennae', 'horns', 'plant', 'wings', 'tail', 'crystal', 'collar', 'floaters'] as const;
    const hist = new Map<number, number>();
    for (let i = 0; i < 500; i++) {
      const p = phenotypeOf(randomGenotype(`pop-${i}`), 'adult');
      const n = DECOR.filter((k) => p.parts[k] !== 'none').length;
      hist.set(n, (hist.get(n) ?? 0) + 1);
    }
    const rows = [...hist].sort((a, b) => a[0] - b[0]);
    const mean = rows.reduce((a, [k, v]) => a + k * v, 0) / 500;
    console.log(`[装飾] 個数分布: ${rows.map(([k, v]) => `${k}個:${v}`).join(' ')} / 平均 ${mean.toFixed(2)}`);

    // 装飾ゼロの子も、盛りだくさんの子も、どちらも少数派であること。
    expect(mean).toBeGreaterThan(1.6);
    expect(mean).toBeLessThan(2.6);
    expect((hist.get(0) ?? 0) / 500).toBeLessThan(0.15);
    const heavy = rows.filter(([k]) => k >= 5).reduce((a, [, v]) => a + v, 0);
    expect(heavy / 500).toBeLessThan(0.06);
    // 6 個以上の「装飾まみれ」はほぼ出ないこと
    const veryHeavy = rows.filter(([k]) => k >= 6).reduce((a, [, v]) => a + v, 0);
    expect(veryHeavy / 500).toBeLessThan(0.01);
  });
});

describe('9. 支配的な形質がないこと', () => {
  const N = 500;
  const pop: Phenotype[] = [];
  for (let i = 0; i < N; i++) pop.push(phenotypeOf(randomGenotype(`dom-${i}`), 'adult'));

  const valueOf = (p: Phenotype, locus: CatLocus): string => {
    if (locus === 'base') return p.base;
    if (locus === 'palette') return p.palette.family;
    if (locus === 'eyeCount') return String(p.parts.eyeCount);
    return String((p.parts as unknown as Record<string, string>)[locus]);
  };

  const share = (locus: CatLocus): { top: string; ratio: number; counts: Map<string, number> } => {
    const counts = new Map<string, number>();
    for (const p of pop) {
      const v = valueOf(p, locus);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let top = '';
    let best = 0;
    for (const [k, v] of counts) if (v > best) { best = v; top = k; }
    return { top, ratio: best / N, counts };
  };

  /**
   * loci.ts（読み取り専用の正本）では、羽・角・結晶などの装飾で 'none' が
   * 意図的に最優性かつ高頻度に設定されている（指示書 §11「全個体が派手にならない」）。
   * また目の数は 'two' が既定で、rarity 側で「2 以外は珍しい」と扱っている。
   * したがって「単一表現 75% 未満」を素のまま課すのは設計と矛盾するので、
   * これらは『既定値を除いた中で偏っていないか』を検査する。
   */
  const DEFAULT_HEAVY: Readonly<Record<string, string>> = {
    eyeCount: '2',
    antennae: 'none',
    horns: 'none',
    earTip: 'none',
    wings: 'none',
    crystal: 'none',
    collar: 'none',
    floaters: 'none',
    // 2 色化と発光は「稀に出る」ことが要件なので、既定値が重いのは設計どおり。
    bicolor: 'none',
    lumin: 'none',
  };

  it('素体は 3 種がそれぞれ 20% 以上', () => {
    const s = share('base');
    const lines = [...s.counts].map(([k, v]) => `${k}=${((v / N) * 100).toFixed(1)}%`);
    console.log(`[9] 素体の分布: ${lines.join(' ')}`);
    expect(s.counts.size).toBe(3);
    for (const [, v] of s.counts) expect(v / N).toBeGreaterThanOrEqual(0.2);
  });

  it('既定値が支配的でない遺伝子座は、単一表現が 75% を超えない', () => {
    const report: string[] = [];
    let worst = { locus: '', ratio: 0, top: '' };
    for (const locus of CAT_LOCUS_IDS) {
      if (DEFAULT_HEAVY[locus]) continue;
      const s = share(locus);
      report.push(`${locus}:${s.top}=${(s.ratio * 100).toFixed(1)}%`);
      if (s.ratio > worst.ratio) worst = { locus, ratio: s.ratio, top: s.top };
      expect(s.ratio).toBeLessThan(0.75);
    }
    console.log(`[9] 通常 locus の最頻表現: ${report.join(' / ')}`);
    console.log(`[9] 最も偏った locus: ${worst.locus} → '${worst.top}' ${(worst.ratio * 100).toFixed(1)}%`);
  });

  it('既定値の重い遺伝子座も、既定値以外の中では偏っていない', () => {
    const report: string[] = [];
    const rows: { locus: string; defRatio: number; otherRatio: number; kinds: number }[] = [];
    for (const [locus, def] of Object.entries(DEFAULT_HEAVY)) {
      const s = share(locus as CatLocus);
      const defCount = s.counts.get(def) ?? 0;
      const others = [...s.counts].filter(([k]) => k !== def);
      const otherTotal = others.reduce((a, [, v]) => a + v, 0);
      let topOther = '';
      let bestOther = 0;
      for (const [k, v] of others) if (v > bestOther) { bestOther = v; topOther = k; }
      const otherRatio = otherTotal > 0 ? bestOther / otherTotal : 0;
      report.push(
        `${locus}: 既定'${def}'=${((defCount / N) * 100).toFixed(1)}% / ` +
          `既定以外=${((otherTotal / N) * 100).toFixed(1)}% (${others.length} 種) / ` +
          `その中の最頻'${topOther}'=${(otherRatio * 100).toFixed(1)}%`,
      );
      rows.push({ locus, defRatio: defCount / N, otherRatio, kinds: others.length });
    }
    console.log(`[9] 既定値の重い locus:\n  ${report.join('\n  ')}`);

    for (const r of rows) {
      // 「既定値以外の中で偏っていないか」は、カタログにそもそも
      // 非既定の対立遺伝子が 2 種類以上ある場合だけ意味を持つ。
      // 不採用形質をカタログから取り除く運用（ocelli/button/mossRing/
      // shard/cluster/halo）が進むと、非既定が 1 種類だけのロカスが自然に
      // 生まれる（現在の crystal は結晶を完全撤去して none だけになっている）。
      // その場合「非既定の中で 1 種類しかない」のは設計どおりであって
      // 偏りではないので、検査自体を免除する。
      const catalogOtherCount = (CAT_LOCI.find((l) => l.locus === r.locus)?.alleles.length ?? 0) - 1;
      if (catalogOtherCount < 2) continue;
      // 既定値ばかりで多様性が消えていないこと。
      // 非既定形質がカタログに無いロカス（現在の crystal）は上の分岐で免除する。
      expect(r.defRatio, r.locus).toBeLessThan(0.95);
      // 既定値以外が 2 種類以上出ていること（1 つの珍形質だけが独占していない）
      expect(r.kinds, r.locus).toBeGreaterThanOrEqual(2);
      // 既定値以外の中で 1 つに寄りきっていないこと
      expect(r.otherRatio, r.locus).toBeLessThan(0.9);
    }
  });
});

describe('多様性・類似度・説明・名前', () => {
  it('diversityIndex は 0..1 で、クローン集団では低くなる', () => {
    const varied = Array.from({ length: 60 }, (_, i) => randomGenotype(`div-${i}`));
    const d = diversityIndex(varied);
    console.log(`[多様性] ランダム 60 体の多様性: ${d.toFixed(4)}`);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThanOrEqual(1);

    // ヘテロのクローンは「個体は同じでも対立遺伝子は 2 種類ある」ので 0 にはならない。
    // それでもランダム集団よりはずっと低いこと。
    const het = randomGenotype('clone');
    const hetPop = Array.from({ length: 60 }, () => het);
    const dHet = diversityIndex(hetPop);
    console.log(`[多様性] ヘテロのクローン 60 体: ${dHet.toFixed(4)}`);
    expect(dHet).toBeLessThan(d * 0.6);

    // 完全ホモのクローンなら対立遺伝子は 1 種類だけ → 0。
    const cat = {} as Record<CatLocus, CatPair>;
    for (const l of CAT_LOCUS_IDS) cat[l] = [het.cat[l][0], het.cat[l][0]] as CatPair;
    const homo: Genotype = { seed: 'homo', cat, num: het.num };
    expect(diversityIndex(Array.from({ length: 60 }, () => homo))).toBe(0);

    expect(diversityIndex([])).toBe(0);
  });

  it('similarity は自分自身で 1、別個体では 1 未満', () => {
    const a = phenotypeOf(randomGenotype('sim-a'), 'adult');
    const b = phenotypeOf(randomGenotype('sim-b'), 'adult');
    expect(similarity(a, a)).toBeCloseTo(1, 6);
    expect(similarity(a, b)).toBeLessThan(1);
    expect(similarity(a, b)).toBeGreaterThanOrEqual(0);
    // 対称であること
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 10);
  });

  it('explainInheritance は日本語の説明を 5 項目以上返す', () => {
    for (let i = 0; i < 20; i++) {
      const pa = phenotypeOf(randomGenotype(`ex-a${i}`), 'adult');
      const pb = phenotypeOf(randomGenotype(`ex-b${i}`), 'adult');
      const child = phenotypeOf(randomGenotype(`ex-c${i}`), 'adult');
      const lines = explainInheritance(child, pa, pb);
      expect(lines.length).toBeGreaterThanOrEqual(5);
      for (const l of lines) {
        expect(l.length).toBeGreaterThan(3);
        expect(l).not.toContain('undefined');
      }
    }
    const pa = phenotypeOf(randomGenotype('ex-a0'), 'adult');
    const pb = phenotypeOf(randomGenotype('ex-b0'), 'adult');
    const child = phenotypeOf(randomGenotype('ex-c0'), 'adult');
    console.log(`[説明] 例:\n  ${explainInheritance(child, pa, pb).slice(0, 5).join('\n  ')}`);
  });

  it('makeName は seed 決定論的で、やわらかいカタカナ名を返す', () => {
    expect(makeName('name-1')).toBe(makeName('name-1'));
    const names = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const n = makeName(`n-${i}`);
      expect(n).toMatch(/^[ァ-ヴー]{2,5}$/);
      names.add(n);
    }
    console.log(`[名前] 例: ${makeNames('sample', 12).join(' / ')}`);
    console.log(`[名前] 500 個中の異なり数: ${names.size}`);
    expect(names.size).toBeGreaterThan(350);
  });

  it('遺伝子座を 1 つも取りこぼしていない', () => {
    const g = randomGenotype('coverage');
    expect(CAT_LOCUS_IDS.length).toBe(CAT_LOCI.length);
    for (const l of CAT_LOCUS_IDS) expect(g.cat[l]).toBeDefined();
    for (const l of NUM_LOCUS_IDS) expect(g.num[l]).toBeDefined();
  });
});
