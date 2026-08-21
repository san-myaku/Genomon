import { describe, expect, it } from 'vitest';
import type { CatLocus, CatPair, Genotype } from '../src/core/types.ts';
import { phenotypeOf, randomGenotype } from '../src/genetics/index.ts';
import { buildRenderModel } from '../src/render/model.ts';
import { renderCreatureSvg } from '../src/render/creature.ts';
import { inspectModel } from '../src/render/inspect.ts';
import { makeSpecimen, rebuildSpecimen } from '../src/dev/gen.ts';

const EYE_SHAPES = ['round', 'oval', 'wide', 'sleepy', 'leaf', 'crescent', 'starry', 'smirk'] as const;
const PUPILS = ['round', 'bead'] as const;

function forcedGenotype(seed: string, eyeShape: string, pupil: string, lashes: string): Genotype {
  const base = randomGenotype(seed);
  return {
    ...base,
    cat: {
      ...base.cat,
      eyeCount: ['two', 'two'],
      eyeShape: [eyeShape, eyeShape],
      pupil: [pupil, pupil],
      lashes: [lashes, lashes],
    } as Genotype['cat'],
  };
}

function renderFace(seed: string, eyeShape: string, pupil: string, lashes: string): string {
  const genotype = forcedGenotype(seed, eyeShape, pupil, lashes);
  const pheno = phenotypeOf(genotype, 'adult');
  const model = buildRenderModel(pheno, null, { detail: 'full', uid: `render-test-${seed}` });
  return renderCreatureSvg(model, { animatable: false });
}

function forcedPartGenotype(seed: string, locus: CatLocus, id: string): Genotype {
  const base = randomGenotype(seed);
  return {
    ...base,
    cat: {
      ...base.cat,
      [locus]: [id, id],
    } as Genotype['cat'],
  };
}

function renderForcedPart(seed: string, locus: CatLocus, id: string): string {
  const genotype = forcedPartGenotype(seed, locus, id);
  const pheno = phenotypeOf(genotype, 'adult');
  const model = buildRenderModel(pheno, null, { detail: 'full', uid: `part-test-${seed}` });
  return renderCreatureSvg(model, { animatable: false });
}

it('耳付き 1000 体で描画不良・非決定的 SVG を出さない', () => {
  const ears = ['nub', 'round', 'longEar', 'flopEar', 'tuft', 'catEar', 'bearEar', 'leafEar', 'roundLeafEar', 'gill', 'bodyEar'] as const;
  const integrated = new Set(['nub', 'round', 'longEar', 'flopEar', 'catEar', 'bearEar', 'leafEar', 'roundLeafEar', 'bodyEar']);
  const issues: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const kind = ears[i % ears.length]!;
    const genotype = forcedPartGenotype(`EAR-1000-${i}`, 'ears', kind);
    const model = buildRenderModel(phenotypeOf(genotype, 'adult'), null, { detail: 'full', uid: `ear-1000-${i}` });
    const inspection = inspectModel(model);
    const earIssues = inspection.issues.filter((issue) => issue.includes('ears'));
    if (earIssues.length) issues.push(`${kind}:${earIssues.join(',')}`);
    const earPart = model.parts.find((part) => part.id === 'ears');
    if (integrated.has(kind) && earPart && /transform="[^"]*(?:matrix|scale)\(/.test(earPart.svg)) {
      issues.push(`${kind}:${i}:scaled-outline`);
    }
    const first = renderCreatureSvg(model, { animatable: false });
    const second = renderCreatureSvg(model, { animatable: false });
    if (first !== second || /NaN|undefined/.test(first)) issues.push(`${kind}:non-deterministic-or-invalid-svg`);
  }
  expect(issues).toEqual([]);
});

it('一体化した耳は変形行列で線幅を変えず、体の輪郭より前で描く', () => {
  const integrated = ['nub', 'round', 'longEar', 'flopEar', 'catEar', 'bearEar', 'leafEar', 'roundLeafEar', 'bodyEar'] as const;
  for (const kind of integrated) {
    const genotype = forcedPartGenotype(`EAR-OUTLINE-${kind}`, 'ears', kind);
    const model = buildRenderModel(phenotypeOf(genotype, 'adult'), null, { detail: 'full', uid: `ear-outline-${kind}` });
    const ears = model.parts.find((part) => part.id === 'ears');
    const outline = model.parts.find((part) => part.id === 'outline');
    expect(ears, kind).toBeDefined();
    expect(outline, kind).toBeDefined();
    expect(ears!.svg, kind).not.toContain('transform="matrix(');
    expect(ears!.svg, kind).not.toMatch(/transform="[^"]*scale\(/);
    expect(ears!.z, kind).toBeGreaterThan(outline!.z);
  }
});

describe('まつ毛の描画', () => {
  it('目の形・瞳の種類に関係なく、まつ毛ありの SVG が差分を持つ', () => {
    for (const eyeShape of EYE_SHAPES) {
      for (const pupil of PUPILS) {
        const seed = `LASH-${eyeShape}-${pupil}`;
        const without = renderFace(seed, eyeShape, pupil, 'none');
        const withLashes = renderFace(seed, eyeShape, pupil, 'lash');
        expect(withLashes, `${eyeShape}/${pupil}`).not.toBe(without);
        expect(withLashes.length, `${eyeShape}/${pupil}`).toBeGreaterThan(without.length);
      }
    }
  });

  it('一覧用と拡大用で同じモデルを描くと、まつ毛の出力が一致する', () => {
    const genotype = forcedGenotype('LASH-DETAIL', 'round', 'bead', 'lash');
    const pheno = phenotypeOf(genotype, 'adult');
    const listModel = buildRenderModel(pheno, null, {
      detail: 'full',
      uid: 'lash-detail:list',
      genotype,
    });
    const detailModel = buildRenderModel(pheno, null, {
      detail: 'full',
      uid: 'lash-detail:detail',
      genotype,
    });
    const listSvg = renderCreatureSvg(listModel, { animatable: false });
    const detailSvg = renderCreatureSvg(detailModel, { animatable: false });
    const normalizeDefs = (svg: string): string =>
      svg.replace(/id="[^"]+"/g, 'id="X"').replace(/url\(#[^)]+\)/g, 'url(#X)');
    expect(normalizeDefs(listSvg)).toBe(normalizeDefs(detailSvg));
  });
});

describe('参考画像から追加した付属物', () => {
  it('新しい目・耳・角・まつ毛の対立遺伝子が SVG に現れる', () => {
    const cases: readonly [CatLocus, readonly string[]][] = [
      ['pupil', ['capsule', 'catEye']],
      ['mouth', ['bowl']],
      ['ears', ['catEar', 'bearEar', 'gill']],
      ['horns', ['nubHorn', 'coneHorn', 'curlHorn', 'goatHorn', 'ramHorn', 'coralHorn']],
      ['lashes', ['mid', 'long', 'sideLong', 'upper', 'lower', 'sleepy']],
      ['tail', ['fluff']],
    ];
    for (const [locus, ids] of cases) {
      const none = locus === 'pupil' ? 'round' : 'none';
      for (const id of ids) {
        const withPart = renderForcedPart(`REF-PART-${locus}-${id}`, locus, id);
        const withoutPart = renderForcedPart(`REF-PART-${locus}-${id}`, locus, none);
        expect(withPart, `${locus}/${id}`).not.toBe(withoutPart);
        expect(withPart, `${locus}/${id}`).toBe(renderForcedPart(`REF-PART-${locus}-${id}`, locus, id));
      }
    }
  });

  it('おわん口とふさふさ丸尾は内部面・尾の帯を含む SVG を安定して描く', () => {
    const mouth = renderForcedPart('REF-PART-bowl', 'mouth', 'bowl');
    const tail = renderForcedPart('REF-PART-fluff', 'tail', 'fluff');
    expect(mouth).toContain('fill=');
    expect(mouth).toContain('stroke=');
    expect(tail).toContain('tailfluffClip');
    expect(tail).toContain('clip-path=');
    expect(tail).toBe(renderForcedPart('REF-PART-fluff', 'tail', 'fluff'));
  });

  it('耳先色は耳がある個体の先端だけを変える', () => {
    const base = randomGenotype('REF-PART-earTip');
    const withTip: Genotype = {
      ...base,
      cat: {
        ...base.cat,
        ears: ['catEar', 'catEar'],
        earTip: ['tip', 'tip'],
      } as Genotype['cat'],
    };
    const withoutTip: Genotype = {
      ...withTip,
      cat: { ...withTip.cat, earTip: ['none', 'none'] } as Genotype['cat'],
    };
    const render = (g: Genotype): string => {
      const pheno = phenotypeOf(g, 'adult');
      return renderCreatureSvg(buildRenderModel(pheno, null, { detail: 'full', uid: `ear-tip-${g.cat.earTip[0]}` }), {
        animatable: false,
      });
    };
    expect(phenotypeOf(withTip, 'adult').parts.earTip).toBe('tip');
    expect(render(withTip)).not.toBe(render(withoutTip));
  });

  it('耳先色は輪郭付きの小片ではなく、フラットな広い面として描かれる', () => {
    const base = randomGenotype('REF-PART-earTip-flat');
    const genotype: Genotype = {
      ...base,
      cat: {
        ...base.cat,
        ears: ['catEar', 'catEar'],
        earTip: ['tip', 'tip'],
      } as Genotype['cat'],
    };
    const svg = renderCreatureSvg(
      buildRenderModel(phenotypeOf(genotype, 'adult'), null, {
        detail: 'full',
        uid: 'ear-tip-flat',
      }),
      { animatable: false },
    );
    expect(svg).toMatch(/fill="#(?:e58aaa|f0d29f|8b5b43)"/);
    expect(svg).not.toMatch(/stroke="#(?:e58aaa|f0d29f|8b5b43)"/);
  });

  it('耳先色は個体ごとにピンク・クリーム・チョコのいずれかを安定して選ぶ', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const base = forcedPartGenotype(`REF-PART-earTip-color-${i}`, 'ears', 'catEar');
      const genotype: Genotype = {
        ...base,
        cat: { ...base.cat, earTip: ['tip', 'tip'] } as Genotype['cat'],
      };
      const svg = renderCreatureSvg(
        buildRenderModel(phenotypeOf(genotype, 'adult'), null, {
          detail: 'full',
          uid: `ear-tip-color-${i}`,
        }),
        { animatable: false },
      );
      for (const color of ['#e58aaa', '#f0d29f', '#8b5b43']) {
        if (svg.includes(`fill="${color}"`)) colors.add(color);
      }
    }
    expect(colors).toEqual(new Set(['#e58aaa', '#f0d29f', '#8b5b43']));
  });
});

describe('Visual Lab の一覧個体を拡大するときの再構成', () => {
  it('一覧フィルターで固定した Genotype を拡大表示でも維持する', () => {
    const listed = makeSpecimen('LAB-EXPAND-NEW-PARTS', {
      stage: 'adult',
      base: null,
      palette: null,
      force: true,
      detail: 'full',
      extraForce: { ears: 'gill', horns: 'coralHorn', lashes: 'long' },
    });
    expect(listed).not.toBeNull();
    if (!listed) return;

    const expanded = rebuildSpecimen(listed, 'adult', 'full');
    expect(expanded.genotype.cat.ears).toEqual(['gill', 'gill']);
    expect(expanded.genotype.cat.horns).toEqual(['coralHorn', 'coralHorn']);
    expect(expanded.genotype.cat.lashes).toEqual(['long', 'long']);
    expect(expanded.pheno.parts.ears).toBe('gill');
    expect(expanded.pheno.parts.horns).toBe('coralHorn');
    expect(expanded.pheno.parts.lashes).toBe('long');
  });
});

// 既存の旧セーブには、新設後の遺伝子座がまだ存在しない場合がある。
// ここで visual regression のテストデータもそのケースを通しておく。
describe('新設遺伝子座の後方互換', () => {
  it('lashes / wingSize が無い旧 Genotype でも表現型を作れる', () => {
    const current = randomGenotype('OLD-GENOTYPE');
    const oldCat = { ...current.cat } as Record<string, CatPair>;
    const oldNum = { ...current.num } as Record<string, readonly [number, number]>;
    delete oldCat['lashes'];
    delete oldNum['wingSize'];

    const oldGenotype = { ...current, cat: oldCat, num: oldNum } as unknown as Genotype;
    expect(() => phenotypeOf(oldGenotype, 'adult')).not.toThrow();
    const pheno = phenotypeOf(oldGenotype, 'adult');
    expect(pheno.parts.lashes).toBe('none');
    expect(Number.isFinite(pheno.wingSize)).toBe(true);
  });
});
