/**
 * 描画の自動検査（inspectModel）そのものを検査する。
 *
 * 【なぜこのテストが要るのか】
 *   検査は一度「問題個体 0 / 9」と表示しながら、実際には卵の装飾が破綻し、
 *   菱形が宙に浮き、巨大な草が卵を横断していた。**素通りする検査は、
 *   無いよりたちが悪い**（本物の破綻を「検査済み」で覆い隠す）。
 *   そのため検査の甘さ・厳しさの両方を、合成モデルで固定しておく。
 */

import { describe, it, expect } from 'vitest';
import { inspectModel } from '../src/render/inspect.ts';
import { buildRenderModel } from '../src/render/model.ts';
import { randomGenotype } from '../src/genetics/genotype.ts';
import { phenotypeOf } from '../src/genetics/phenotype.ts';
import type { RenderModel, RenderPart } from '../src/core/types.ts';

/** 正常な成体モデルを 1 体作る。 */
function healthyModel(seed = 'INSPECT-BASE'): RenderModel {
  const g = randomGenotype(seed);
  const p = phenotypeOf(g, 'adult');
  return buildRenderModel(p, null, { detail: 'full', uid: 'tst' });
}

/** parts を差し替えた複製を作る（元を壊さない）。 */
function withParts(m: RenderModel, parts: RenderPart[]): RenderModel {
  return { ...m, parts };
}

describe('inspectModel が本物の破綻を見逃さないこと', () => {
  it('体から完全に離れたパーツを検出する', () => {
    const m = healthyModel();
    const floating: RenderPart = {
      id: 'tail',
      z: 10,
      svg: '<circle cx="6" cy="6" r="4" fill="#000"/>',
      // 体（おおよそ x 26..174）から遠く離れた左上に置く
      anchor: { id: 'tail', x: 6, y: 6, angle: 0, scale: 1 },
      bbox: { x: 2, y: 2, w: 8, h: 8 },
    };
    const r = inspectModel(withParts(m, [...m.parts.filter((p) => p.id !== 'tail'), floating]));
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/not-touching-body:tail|detached:tail/);
  });

  it('付け根の宣言だけ体の上にあり、絵が別の場所に描かれているパーツを検出する', () => {
    // anchor は体の上だが bbox がまったく別の場所 ＝ 「宣言と絵が食い違う」状態。
    // anchor だけを見る実装にするとこれを見逃すので、その退行を固定する。
    const m = healthyModel();
    const liar: RenderPart = {
      id: 'tail',
      z: 10,
      svg: '<circle cx="10" cy="10" r="4" fill="#000"/>',
      anchor: { id: 'tail', x: 100, y: 120, angle: 0, scale: 1 }, // 体の中心あたり
      bbox: { x: 2, y: 2, w: 8, h: 8 }, // 絵は左上の隅
    };
    const r = inspectModel(withParts(m, [...m.parts.filter((p) => p.id !== 'tail'), liar]));
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/not-touching-body:tail|detached:tail/);
  });

  it('viewBox からはみ出したパーツを検出する', () => {
    const m = healthyModel();
    const out: RenderPart = {
      id: 'horns',
      z: 10,
      svg: '<circle cx="210" cy="100" r="6" fill="#000"/>',
      anchor: { id: 'horns', x: 100, y: 60, angle: 0, scale: 1 },
      bbox: { x: 198, y: 90, w: 24, h: 20 },
    };
    const r = inspectModel(withParts(m, [...m.parts, out]));
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/out-of-view/);
  });

  it('SVG に NaN / undefined が混ざっていたら検出する', () => {
    const m = healthyModel();
    const broken: RenderPart = {
      id: 'ears',
      z: 10,
      svg: '<circle cx="NaN" cy="100" r="6" fill="#000"/>',
      bbox: { x: 90, y: 90, w: 20, h: 20 },
    };
    const r = inspectModel(withParts(m, [...m.parts, broken]));
    expect(r.ok).toBe(false);
  });
});

describe('inspectModel が正常な個体を誤検出しないこと', () => {
  it('300 体の成体で不良率が 1% 未満', () => {
    let bad = 0;
    const kinds: Record<string, number> = {};
    for (let i = 0; i < 300; i++) {
      const m = healthyModel(`OK-${i}`);
      const r = inspectModel(m);
      if (!r.ok) {
        bad++;
        for (const s of r.issues) {
          const k = s.split('(')[0]!;
          kinds[k] = (kinds[k] ?? 0) + 1;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[inspect] 成体300体 不良 ${bad} 件 内訳 ${JSON.stringify(kinds)}`);
    expect(bad).toBeLessThan(3);
  });

  it('幼体・卵でも不良率が 1% 未満', () => {
    for (const stage of ['juvenile', 'egg'] as const) {
      let bad = 0;
      const kinds: Record<string, number> = {};
      for (let i = 0; i < 200; i++) {
        const g = randomGenotype(`OKS-${stage}-${i}`);
        const m = buildRenderModel(phenotypeOf(g, stage), null, { detail: 'full', uid: 'tst' });
        const r = inspectModel(m);
        if (!r.ok) {
          bad++;
          for (const s of r.issues) {
            const k = s.split('(')[0]!;
            kinds[k] = (kinds[k] ?? 0) + 1;
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(`[inspect] ${stage}200体 不良 ${bad} 件 内訳 ${JSON.stringify(kinds)}`);
      expect(bad).toBeLessThan(2);
    }
  });
});
