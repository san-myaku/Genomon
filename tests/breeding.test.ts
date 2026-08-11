/**
 * 交配の検証。
 *
 * ここで守りたい不変条件:
 *   - 1000 回交配しても壊れた遺伝子型が出ない
 *   - 10 世代回しても集団の多様性が崩壊しない
 *   - 潜性形質が「数世代後に突然出る」ことが実際に起きる
 *   - 子が親に似る（完全ランダムに見えない）ことの数値的保証
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.ts';
import type { CatLocus, CatPair, Genotype, Phenotype } from '../src/core/types.ts';
import type { SimilarityParts } from '../src/genetics/similarity.ts';
import {
  CAT_LOCUS_BY_ID,
  CAT_LOCUS_IDS,
  MUTATION,
  breed,
  breedMany,
  diversityIndex,
  explainInheritance,
  isValidGenotype,
  phenotypeOf,
  randomGenotype,
  similarity,
  similarityParts,
  visibleTraits,
} from '../src/genetics/index.ts';

const adult = (g: Genotype): Phenotype => phenotypeOf(g, 'adult');
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe('4. 1000 回交配', () => {
  it('例外なく、すべての子の遺伝子型が妥当', () => {
    const rng = new Rng('cross-1000');
    const parents = Array.from({ length: 40 }, (_, i) => randomGenotype(`p4-${i}`));
    for (let i = 0; i < 1000; i++) {
      const a = rng.pick(parents);
      const b = rng.pick(parents);
      const child = breed(a, b, `c4-${i}`);
      expect(isValidGenotype(child)).toBe(true);
      expect(child.seed).toBe(`c4-${i}`);
      for (const l of CAT_LOCUS_IDS) expect(child.cat[l]).toBeDefined();
      // 表現型変換まで通ること
      const p = adult(child);
      expect(p.parts.eyeCount).toBeGreaterThan(0);
    }
  });

  it('交配は決定論的（同じ親と childSeed からは同じ子）', () => {
    const a = randomGenotype('det-a');
    const b = randomGenotype('det-b');
    expect(JSON.stringify(breed(a, b, 'kid'))).toBe(JSON.stringify(breed(a, b, 'kid')));
    expect(JSON.stringify(breed(a, b, 'kid'))).not.toBe(JSON.stringify(breed(a, b, 'kid2')));
  });

  it('force で形質を強制でき、mutationScale で変異率を変えられる', () => {
    const a = randomGenotype('force-a');
    const b = randomGenotype('force-b');
    const child = breed(a, b, 'force-kid', { force: { base: 'slime', wings: 'moth' } });
    expect(child.cat.base).toEqual(['slime', 'slime']);
    expect(adult(child).base).toBe('slime');
    expect(child.cat.wings).toEqual(['moth', 'moth']);

    // 変異率 0 なら、親の持つ対立遺伝子以外は絶対に出ない
    for (let i = 0; i < 300; i++) {
      const kid = breed(a, b, `nomut-${i}`, { mutationScale: 0 });
      for (const l of CAT_LOCUS_IDS) {
        for (const id of kid.cat[l]) {
          expect([a.cat[l][0], a.cat[l][1], b.cat[l][0], b.cat[l][1]]).toContain(id);
        }
      }
    }
  });
});

describe('5. 10 世代交配しても多様性が保たれる', () => {
  it('10 世代後の多様性が初期の 50% 以上', () => {
    const POP = 20;
    let pop = Array.from({ length: POP }, (_, i) => randomGenotype(`g0-${i}`));
    const d0 = diversityIndex(pop);
    const rng = new Rng('lineage');
    const history: number[] = [d0];

    for (let gen = 1; gen <= 10; gen++) {
      const next: Genotype[] = [];
      for (let i = 0; i < POP; i++) {
        const a = rng.pick(pop);
        let b = rng.pick(pop);
        let guard = 0;
        while (b === a && guard++ < 8) b = rng.pick(pop);
        next.push(breed(a, b, `g${gen}-${i}`));
      }
      pop = next;
      history.push(diversityIndex(pop));
    }

    const d10 = history[history.length - 1];
    console.log(`[5] 多様性の推移: ${history.map((d) => d.toFixed(3)).join(' → ')}`);
    console.log(`[5] 初期=${d0.toFixed(4)} 10世代後=${d10.toFixed(4)} 保持率=${((d10 / d0) * 100).toFixed(1)}%`);
    expect(d10).toBeGreaterThan(d0 * 0.5);
  });
});

describe('6. 潜性形質の発現', () => {
  it('潜性をヘテロで持つ親どうしから、実際に潜性表現が出る', () => {
    const seedGeno = randomGenotype('rec-seed');
    const cat = {} as Record<CatLocus, CatPair>;
    for (const l of CAT_LOCUS_IDS) cat[l] = seedGeno.cat[l];
    // 素体を固定して、素体由来の抑制（スライムは羽なし等）を排除する
    cat.base = ['maru', 'maru'] as CatPair;
    // notable な潜性を優性の対立遺伝子とヘテロで持たせる
    cat.wings = ['gossamer', 'none'] as CatPair; // dominance 2 vs 7 → 通常は 'none'
    cat.crystal = ['halo', 'none'] as CatPair; //  dominance 1 vs 7 → 通常は 'none'
    cat.eyeShape = ['starry', 'round'] as CatPair; // dominance 1 vs 5 → 通常は 'round'
    cat.pupil = ['petalP', 'round'] as CatPair; // dominance 1 vs 5 → 通常は 'round'

    const pa: Genotype = { seed: 'rec-pa', cat, num: seedGeno.num };
    const pb: Genotype = { seed: 'rec-pb', cat, num: seedGeno.num };

    // 親自身には潜性が出ていないこと（隠れていること）を確認
    expect(adult(pa).parts.wings).toBe('none');
    expect(adult(pa).parts.crystal).toBe('none');
    expect(adult(pa).parts.eyeShape).toBe('round');

    const N = 1000;
    const hit = { gossamer: 0, halo: 0, starry: 0, petalP: 0 };
    for (let i = 0; i < N; i++) {
      const p = adult(breed(pa, pb, `rec-kid-${i}`));
      if (p.parts.wings === 'gossamer') hit.gossamer++;
      if (p.parts.crystal === 'halo') hit.halo++;
      if (p.parts.eyeShape === 'starry') hit.starry++;
      if (p.parts.pupil === 'petalP') hit.petalP++;
    }

    console.log(
      `[6] 潜性の発現率 (1000 交配, 理論値 25%): ` +
        `うすばね=${((hit.gossamer / N) * 100).toFixed(1)}% ` +
        `わがさ=${((hit.halo / N) * 100).toFixed(1)}% ` +
        `ほしぞら=${((hit.starry / N) * 100).toFixed(1)}% ` +
        `はなびら瞳=${((hit.petalP / N) * 100).toFixed(1)}%`,
    );

    for (const [key, v] of Object.entries(hit)) {
      expect(v, `潜性 ${key} が一度も出なかった`).toBeGreaterThan(0);
      // メンデル比 1/4 のまわりに収まること
      expect(v / N).toBeGreaterThan(0.15);
      expect(v / N).toBeLessThan(0.36);
    }
  });
});

describe('7. 親子は他人より似ている', () => {
  it('親子の平均類似度 > 無関係な 2 個体の平均類似度 + 0.12', () => {
    const N = 100;
    const kin: number[] = [];
    const kinParts: SimilarityParts[] = [];
    for (let i = 0; i < N; i++) {
      const pa = randomGenotype(`k-pa-${i}`);
      const pb = randomGenotype(`k-pb-${i}`);
      const child = breed(pa, pb, `k-kid-${i}`);
      const cp = adult(child);
      for (const p of [adult(pa), adult(pb)]) {
        kin.push(similarity(cp, p));
        kinParts.push(similarityParts(cp, p));
      }
    }

    const strangers: number[] = [];
    const strParts: SimilarityParts[] = [];
    const rng = new Rng('stranger');
    const pool = Array.from({ length: 120 }, (_, i) => adult(randomGenotype(`s-${i}`)));
    for (let i = 0; i < 400; i++) {
      const a = rng.int(0, pool.length - 1);
      let b = rng.int(0, pool.length - 1);
      if (b === a) b = (b + 1) % pool.length;
      strangers.push(similarity(pool[a], pool[b]));
      strParts.push(similarityParts(pool[a], pool[b]));
    }

    const mKin = mean(kin);
    const mStr = mean(strangers);
    console.log(
      `[7] 親子の平均類似度=${mKin.toFixed(4)} / 無関係の平均類似度=${mStr.toFixed(4)} / 差=${(mKin - mStr).toFixed(4)}`,
    );
    console.log(
      `[7] 内訳: カテゴリ 親子=${mean(kinParts.map((p) => p.cat)).toFixed(4)} 無関係=${mean(strParts.map((p) => p.cat)).toFixed(4)}` +
        ` / 数値 親子=${mean(kinParts.map((p) => p.num)).toFixed(4)} 無関係=${mean(strParts.map((p) => p.num)).toFixed(4)}`,
    );
    expect(mKin - mStr).toBeGreaterThan(0.12);
  });

  it('親子比較の説明が破綻しない', () => {
    const pa = randomGenotype('exp-pa');
    const pb = randomGenotype('exp-pb');
    const child = breed(pa, pb, 'exp-kid');
    const lines = explainInheritance(adult(child), adult(pa), adult(pb));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    console.log(`[7] 親子比較の説明:\n  ${lines.slice(0, 6).join('\n  ')}`);
    // 「どちらの親とも違う」ばかりにならないこと
    const inherited = lines.filter((l) => l.includes('ゆずり') || l.includes('両親そろって'));
    expect(inherited.length).toBeGreaterThan(0);
  });
});

describe('8. 兄弟', () => {
  it('兄弟は他人より似ているが、全員同一ではない', () => {
    const rng = new Rng('sib');
    const sibSims: number[] = [];
    const fingerprints: string[] = [];
    let allSameFamilies = 0;

    for (let f = 0; f < 12; f++) {
      const pa = randomGenotype(`sib-pa-${f}`);
      const pb = randomGenotype(`sib-pb-${f}`);
      const kids = breedMany(pa, pb, `fam-${f}`, 10);
      expect(kids.length).toBe(10);
      const ph = kids.map(adult);
      const uniq = new Set(kids.map((k) => JSON.stringify({ c: k.cat, n: k.num })));
      if (uniq.size === 1) allSameFamilies++;
      for (const k of kids) fingerprints.push(k.seed);
      for (let i = 0; i < ph.length; i++) {
        for (let j = i + 1; j < ph.length; j++) sibSims.push(similarity(ph[i], ph[j]));
      }
    }

    const strangers: number[] = [];
    const pool = Array.from({ length: 120 }, (_, i) => adult(randomGenotype(`s8-${i}`)));
    for (let i = 0; i < 400; i++) {
      const a = rng.int(0, pool.length - 1);
      let b = rng.int(0, pool.length - 1);
      if (b === a) b = (b + 1) % pool.length;
      strangers.push(similarity(pool[a], pool[b]));
    }

    const mSib = mean(sibSims);
    const mStr = mean(strangers);
    console.log(`[8] 兄弟の平均類似度=${mSib.toFixed(4)} / 無関係=${mStr.toFixed(4)} / 差=${(mSib - mStr).toFixed(4)}`);
    expect(mSib).toBeGreaterThan(mStr);
    // 兄弟が全員クローンになっていないこと
    expect(allSameFamilies).toBe(0);
    expect(new Set(fingerprints).size).toBe(120);
    expect(Math.min(...sibSims)).toBeLessThan(0.999);
  });
});

describe('10. 突然変異率', () => {
  it('1000 交配で catRate 相当の突然変異が起きている', () => {
    // 両親を同じホモ接合にすると、子に現れた別の対立遺伝子＝突然変異と断定できる。
    const src = randomGenotype('mut-src');
    const cat = {} as Record<CatLocus, CatPair>;
    for (const l of CAT_LOCUS_IDS) cat[l] = [src.cat[l][0], src.cat[l][0]] as CatPair;
    const pa: Genotype = { seed: 'mut-pa', cat, num: src.num };
    const pb: Genotype = { seed: 'mut-pb', cat, num: src.num };

    const N = 1000;
    let alleles = 0;
    let mutated = 0;
    let baseAlleles = 0;
    let baseMutated = 0;

    for (let i = 0; i < N; i++) {
      const kid = breed(pa, pb, `mut-kid-${i}`);
      for (const l of CAT_LOCUS_IDS) {
        const origin = cat[l][0];
        for (const id of kid.cat[l]) {
          if (l === 'base') {
            baseAlleles++;
            if (id !== origin) baseMutated++;
            continue;
          }
          alleles++;
          if (id !== origin) mutated++;
        }
      }
    }

    const rate = mutated / alleles;
    const baseRate = baseMutated / baseAlleles;
    console.log(
      `[10] カテゴリ突然変異率 = ${(rate * 100).toFixed(3)}% ` +
        `(${mutated}/${alleles}, 設定値 ${(MUTATION.catRate * 100).toFixed(1)}%)`,
    );
    console.log(
      `[10] 素体の突然変異率 = ${(baseRate * 100).toFixed(3)}% ` +
        `(${baseMutated}/${baseAlleles}, 設定値 ${(MUTATION.baseRate * 100).toFixed(1)}%)`,
    );

    expect(rate).toBeGreaterThan(MUTATION.catRate * 0.6);
    expect(rate).toBeLessThan(MUTATION.catRate * 1.6);
    expect(baseRate).toBeLessThan(MUTATION.catRate);
  });

  it('突然変異はカタログ配列上の近い対立遺伝子に寄る（親の系統が残る）', () => {
    const src = randomGenotype('mut2-src');
    const cat = {} as Record<CatLocus, CatPair>;
    for (const l of CAT_LOCUS_IDS) cat[l] = [src.cat[l][0], src.cat[l][0]] as CatPair;
    const pa: Genotype = { seed: 'mut2-pa', cat, num: src.num };
    const pb: Genotype = { seed: 'mut2-pb', cat, num: src.num };

    const dists: number[] = [];
    for (let i = 0; i < 3000; i++) {
      const kid = breed(pa, pb, `mut2-kid-${i}`, { mutationScale: 4 });
      for (const l of CAT_LOCUS_IDS) {
        if (l === 'base') continue;
        const alleles = CAT_LOCUS_BY_ID[l].alleles;
        const from = alleles.findIndex((a) => a.id === cat[l][0]);
        for (const id of kid.cat[l]) {
          const to = alleles.findIndex((a) => a.id === id);
          if (to !== from) dists.push(Math.abs(to - from));
        }
      }
    }
    const near = dists.filter((d) => d === 1).length / dists.length;
    console.log(
      `[10] 変異先の距離: 平均 ${mean(dists).toFixed(2)} / 距離1 の割合 ${(near * 100).toFixed(1)}% (${dists.length} 件)`,
    );
    expect(dists.length).toBeGreaterThan(100);
    expect(near).toBeGreaterThan(0.5);
    expect(mean(dists)).toBeLessThan(1.9);
  });

  it('mutationScale を上げると変異が増える', () => {
    const src = randomGenotype('scale-src');
    const cat = {} as Record<CatLocus, CatPair>;
    for (const l of CAT_LOCUS_IDS) cat[l] = [src.cat[l][0], src.cat[l][0]] as CatPair;
    const pa: Genotype = { seed: 'scale-pa', cat, num: src.num };
    const pb: Genotype = { seed: 'scale-pb', cat, num: src.num };

    const count = (scale: number): number => {
      let m = 0;
      for (let i = 0; i < 400; i++) {
        const kid = breed(pa, pb, `scale-${scale}-${i}`, { mutationScale: scale });
        for (const l of CAT_LOCUS_IDS) {
          for (const id of kid.cat[l]) if (id !== cat[l][0]) m++;
        }
      }
      return m;
    };
    const low = count(1);
    const high = count(8);
    console.log(`[10] mutationScale=1 → ${low} 件 / mutationScale=8 → ${high} 件`);
    expect(high).toBeGreaterThan(low * 3);
  });
});

describe('11. 希少度の分布（precious が到達可能であること）', () => {
  /** 24 個体から 12 世代交配し、途中世代も含めた全個体を返す。 */
  const buildLineage = (tag: string, gens = 12, pop = 24): Genotype[] => {
    let cur = Array.from({ length: pop }, (_, i) => randomGenotype(`${tag}0-${i}`));
    const all: Genotype[] = [];
    const rng = new Rng(`lineage-${tag}`);
    for (let gen = 1; gen <= gens; gen++) {
      const next: Genotype[] = [];
      for (let i = 0; i < pop; i++) {
        const a = rng.pick(cur);
        let b = rng.pick(cur);
        let guard = 0;
        while (b === a && guard++ < 8) b = rng.pick(cur);
        next.push(breed(a, b, `${tag}${gen}-${i}`));
      }
      cur = next;
      all.push(...next);
    }
    return all;
  };

  const tierStats = (gs: Genotype[]): { tiers: Map<string, number>; max: number; mean: number } => {
    const tiers = new Map<string, number>();
    let max = 0;
    let sum = 0;
    for (const g of gs) {
      const p = adult(g);
      tiers.set(p.rarity.tier, (tiers.get(p.rarity.tier) ?? 0) + 1);
      max = Math.max(max, p.rarity.score);
      sum += p.rarity.score;
    }
    return { tiers, max, mean: sum / gs.length };
  };

  const fmt = (label: string, n: number, st: { tiers: Map<string, number>; max: number; mean: number }): string => {
    const order = ['common', 'uncommon', 'rare', 'precious'];
    const parts = order.map((t) => {
      const v = st.tiers.get(t) ?? 0;
      return `${t}=${v}(${((v / n) * 100).toFixed(1)}%)`;
    });
    return `${label} n=${n} / ${parts.join(' ')} / score 平均${st.mean.toFixed(1)} 最大${st.max}`;
  };

  it('初期卵（500体）では precious がほぼ出ない', () => {
    const gs = Array.from({ length: 500 }, (_, i) => randomGenotype(`pop-${i}`));
    const st = tierStats(gs);
    console.log(`[11] ${fmt('初期卵', 500, st)}`);
    const precious = st.tiers.get('precious') ?? 0;
    // 初期からレアが量産されると交配の動機が消える。
    expect(precious / 500).toBeLessThanOrEqual(0.01);
  });

  it('12 世代交配した集団では precious が実際に出る（1 体以上・5% 以下）', () => {
    let totalPrecious = 0;
    let totalRare = 0;
    let totalN = 0;

    for (const tag of ['G', 'H', 'J']) {
      const gs = buildLineage(tag);
      const st = tierStats(gs);
      const n = gs.length;
      console.log(`[11] ${fmt(`交配系統${tag}`, n, st)}`);

      const precious = st.tiers.get('precious') ?? 0;
      const rare = st.tiers.get('rare') ?? 0;
      totalPrecious += precious;
      totalRare += rare;
      totalN += n;

      // 到達不能な tier は死んだ機能。必ず 1 体以上出ること。
      expect(precious, `系統${tag} で precious が 0 体`).toBeGreaterThanOrEqual(1);
      // かといって量産されてはいけない。
      expect(precious / n, `系統${tag} の precious 比率`).toBeLessThanOrEqual(0.05);
      // rare は「がんばれば届く」帯であること。
      expect(rare / n, `系統${tag} の rare 比率`).toBeGreaterThanOrEqual(0.05);
      expect(rare / n, `系統${tag} の rare 比率`).toBeLessThanOrEqual(0.22);
    }

    console.log(
      `[11] 交配 3 系統 合計: n=${totalN} precious=${totalPrecious}(${((totalPrecious / totalN) * 100).toFixed(1)}%) ` +
        `rare=${totalRare}(${((totalRare / totalN) * 100).toFixed(1)}%)`,
    );
    expect(totalPrecious / totalN).toBeGreaterThan(0.005);
    expect(totalPrecious / totalN).toBeLessThan(0.04);
  });

  it('珍しい形質が増えるほど score が伸び続ける（頭打ちにならない）', () => {
    // 旧実装は min(24, n*8) のような固定上限を持っていたため、
    // 珍しい形質が 3 か所を超えても score が 1 点も増えなかった。
    // 交配で珍しさを集める意味がなくなるので、単調に伸びることを保証する。
    const src = randomGenotype('mono-src');
    const steps: [CatLocus, string, string][] = [
      // [locus, ふつうの対立遺伝子, めずらしい対立遺伝子]
      ['eyeShape', 'round', 'starry'],
      ['pupil', 'round', 'petalP'],
      ['silhouette', 'plain', 'lobed'],
      ['texture', 'matte', 'glassy'],
      ['pattern', 'none', 'rings'],
      ['antennae', 'none', 'feather'],
    ];

    const build = (k: number): Genotype => {
      const c = {} as Record<CatLocus, CatPair>;
      for (const l of CAT_LOCUS_IDS) c[l] = src.cat[l];
      c.base = ['maru', 'maru'] as CatPair;
      // すべての段を「ふつうの形」で固定してから、k か所だけ珍しい形に差し替える。
      steps.forEach(([locus, plain], i) => {
        const allele = i < k ? steps[i][2] : plain;
        c[locus] = [allele, allele] as CatPair;
      });
      // seed は固定する。変えると他 locus のゆらぎが動いて比較にならない。
      return { seed: 'mono-fixed', cat: c, num: src.num };
    };

    const scores = steps.map((_, i) => adult(build(i)).rarity.score);
    scores.push(adult(build(steps.length)).rarity.score);
    console.log(`[11] めずらしい形質を 0→${steps.length} か所に増やしたときの score: ${scores.join(' → ')}`);

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i], `${i} 個目で score が伸びていない`).toBeGreaterThan(scores[i - 1]);
    }
    // めずらしい形質を 6 か所そろえるだけでも rare 帯には届く。
    expect(adult(build(steps.length)).rarity.tier === 'rare' || adult(build(steps.length)).rarity.tier === 'precious').toBe(true);

    // さらに「別方向のめずらしさ」（珍しい配色・ふつうと違う目の数）が重なると precious に届く。
    // ＝ precious は装飾の量ではなく、珍しさの方向が重なることで到達する。
    const full = build(steps.length);
    const cat2 = { ...full.cat } as Record<CatLocus, CatPair>;
    cat2.palette = ['pearl', 'pearl'] as CatPair;
    cat2.eyeCount = ['three', 'three'] as CatPair;
    const top = adult({ seed: 'mono-fixed', cat: cat2, num: full.num });
    console.log(`[11] さらに珍しい配色と目3つを重ねたとき: score=${top.rarity.score} tier=${top.rarity.tier}`);
    console.log(`[11]   理由: ${top.rarity.reasons.slice(0, 4).join(' / ')}`);
    expect(top.rarity.tier).toBe('precious');
  });
});

describe('12. visibleTraits（幼体でのネタバレ防止）', () => {
  it('幼体では成体で初めて出る器官の trait を返さない', () => {
    const hiddenLoci = ['wings', 'horns', 'crystal', 'collar', 'floaters'];
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const g = randomGenotype(`vis-${i}`);
      const juv = phenotypeOf(g, 'juvenile');
      const adl = phenotypeOf(g, 'adult');
      const vis = visibleTraits(juv);
      for (const l of hiddenLoci) {
        expect(vis.some((t) => t.locus === l)).toBe(false);
      }
      // 成体では出ること
      for (const l of hiddenLoci) {
        expect(visibleTraits(adl).some((t) => t.locus === l)).toBe(true);
      }
      // 幼体で小さくしか出ていない器官は、いまの見た目で表示されること
      const ears = vis.find((t) => t.locus === 'ears');
      if (ears && juv.parts.ears === 'nub') {
        expect(ears.value).toBe('ちょこん');
        checked++;
      }
    }
    console.log(`[12] 幼体で『ちょこん』に言い換えられた耳: ${checked}/300`);
    expect(checked).toBeGreaterThan(0);
  });

  it('卵では配色と大きさだけを返す', () => {
    const p = phenotypeOf(randomGenotype('vis-egg'), 'egg');
    const vis = visibleTraits(p);
    expect(vis.length).toBe(2);
    expect(vis.map((t) => t.locus).sort()).toEqual(['palette', 'size']);
  });

  it('成体では traits をそのまま返す', () => {
    const p = phenotypeOf(randomGenotype('vis-adult'), 'adult');
    expect(visibleTraits(p)).toBe(p.traits);
  });
});
