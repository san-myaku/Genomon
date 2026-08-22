/**
 * 体毛（coat）の回帰テスト。
 *
 * 【何を守っているか】
 *   毛は **輪郭の外側へ** 描かれる初めてのパーツなので、既存のテストが
 *   前提にしていた「パーツは体の中か、体から 1 か所だけ生えている」の
 *   どちらにも当てはまらない。実装中に実際に踏んだ 2 つの不良
 *     ・先端の丸みと線幅のぶんだけ viewBox からはみ出す（out-of-view:coat）
 *     ・接地する素体で毛が地面と影を突き抜ける
 *   は、どちらも「描けているか」ではなく **どこまで伸びたか** の問題だった。
 *   ここではその 2 つと、毛を足したことで他の不良が増えていないことを見る。
 */

import { describe, expect, it } from 'vitest';
import type { Genotype } from '../src/core/types.ts';
import { phenotypeOf, randomGenotype } from '../src/genetics/index.ts';
import { CAT_LOCUS_BY_ID } from '../src/genetics/loci.ts';
import { buildRenderModel } from '../src/render/model.ts';
import { inspectModel } from '../src/render/inspect.ts';
import { GROUND_Y, VIEW } from '../src/render/geom.ts';

/** カタログに載っている毛の種類（'none' を除く）。 */
const KINDS = CAT_LOCUS_BY_ID.coat.alleles.map((a) => a.id).filter((id) => id !== 'none');

function forced(seed: string, over: Record<string, string>): Genotype {
  const base = randomGenotype(seed);
  const cat = { ...base.cat } as unknown as Record<string, readonly [string, string]>;
  for (const [k, v] of Object.entries(over)) cat[k] = [v, v];
  return { ...base, cat: cat as unknown as Genotype['cat'] };
}

function modelFor(
  seed: string,
  over: Record<string, string>,
  stage: 'adult' | 'juvenile' | 'egg' = 'adult',
) {
  return buildRenderModel(phenotypeOf(forced(seed, over), stage), null, {
    detail: 'full',
    uid: `coat-${seed}-${Object.values(over).join('-')}-${stage}`,
  });
}

const coatOf = (m: ReturnType<typeof buildRenderModel>) => m.parts.find((p) => p.id === 'coat');

describe('毛（coat）', () => {
  it('カタログの全種類が実際に描かれ、なしでは描かれない', () => {
    expect(KINDS.length).toBeGreaterThan(0);
    for (const kind of KINDS) {
      for (const seed of ['coat-a', 'coat-b', 'coat-c']) {
        const part = coatOf(modelFor(seed, { coat: kind }));
        expect(part, `${kind}/${seed}`).toBeDefined();
        expect(part!.svg.length, `${kind}/${seed}`).toBeGreaterThan(80);
      }
    }
    for (const seed of ['coat-a', 'coat-b', 'coat-c']) {
      expect(coatOf(modelFor(seed, { coat: 'none' })), seed).toBeUndefined();
    }
  });

  it('種類ごとに違う絵になる（長さ違いの使い回しになっていない）', () => {
    const svgs = KINDS.map((k) => coatOf(modelFor('coat-shape', { coat: k }))!.svg);
    expect(new Set(svgs).size).toBe(KINDS.length);
  });

  it('同じ遺伝子型からは常に同じ SVG（Math.random を使っていない）', () => {
    for (const kind of KINDS) {
      const a = coatOf(modelFor('coat-det', { coat: kind }))!.svg;
      const b = coatOf(modelFor('coat-det', { coat: kind }))!.svg;
      expect(a, kind).toBe(b);
    }
  });

  it('体マスクを通していて、体内の付け根が透けない', () => {
    for (const kind of KINDS) {
      const part = coatOf(modelFor('coat-mask', { coat: kind }))!;
      expect(part.svg.startsWith('<g mask="url(#'), kind).toBe(true);
    }
  });

  it('もこもこは「インク → 本体色」の 2 枚だけで描く（内側の線が残らない）', () => {
    // 房どうしが重なるので、1 本ずつ線を引くと相手の輪郭まで見えて
    // レース編みの縁飾りになる。union の外周だけに線を残すため、
    // 塗りつぶし 2 枚の重ねで描いている。枚数が増えたらその手が崩れた合図。
    const svg = coatOf(modelFor('coat-merge', { coat: 'fuzz' }))!.svg;
    expect((svg.match(/<path /g) ?? []).length).toBe(2);
  });

  it('卵には毛が出ない', () => {
    for (const seed of ['coat-egg-1', 'coat-egg-2']) {
      expect(coatOf(modelFor(seed, { coat: 'shag' }, 'egg')), seed).toBeUndefined();
    }
  });

  it('毛が viewBox からはみ出さず、接地する素体では地面を突き抜けない', () => {
    let worstBottom = -Infinity;
    for (const kind of KINDS) {
      for (let i = 0; i < 60; i++) {
        const seed = `coat-fit-${i}`;
        const g = forced(seed, { coat: kind });
        for (const stage of ['adult', 'juvenile'] as const) {
          const pheno = phenotypeOf(g, stage);
          const model = buildRenderModel(pheno, null, { detail: 'full', uid: `${seed}-${kind}-${stage}` });
          const b = coatOf(model)?.bbox;
          if (!b) continue;
          const label = `${kind}/${seed}/${stage}`;
          expect(b.x, label).toBeGreaterThanOrEqual(VIEW.x - 1.5);
          expect(b.y, label).toBeGreaterThanOrEqual(VIEW.y - 1.5);
          expect(b.x + b.w, label).toBeLessThanOrEqual(VIEW.x + VIEW.w + 1.5);
          expect(b.y + b.h, label).toBeLessThanOrEqual(VIEW.y + VIEW.h + 1.5);
          // 幽霊型は浮くので接地線の下へ出てよい。それ以外は地面より上。
          if (pheno.base !== 'yurei') {
            worstBottom = Math.max(worstBottom, b.y + b.h);
            expect(b.y + b.h, label).toBeLessThanOrEqual(GROUND_Y);
          }
        }
      }
    }
    console.log(`[coat] 接地素体の毛の最下端: ${worstBottom.toFixed(1)}（地面 ${GROUND_Y}）`);
  });

  it('毛を足しても、体からのはみ出し・重なりの不良が増えない', () => {
    let bare = 0;
    let furry = 0;
    const added = new Map<string, number>();
    for (let i = 0; i < 120; i++) {
      const seed = `coat-reg-${i}`;
      for (const kind of KINDS) {
        const before = inspectModel(modelFor(seed, { coat: 'none' })).issues;
        const after = inspectModel(modelFor(seed, { coat: kind })).issues;
        bare += before.length;
        furry += after.length;
        for (const issue of after) {
          if (before.includes(issue)) continue;
          const key = issue.replace(/\(.*/, '');
          added.set(key, (added.get(key) ?? 0) + 1);
        }
      }
    }
    console.log(
      `[coat] 毛なし ${bare} 件 → 毛あり ${furry} 件 / 新規 ${JSON.stringify(Object.fromEntries(added))}`,
    );
    expect(added.size, [...added.keys()].join(',')).toBe(0);
  });
});

describe('毛（coat）— カタログから外した種類', () => {
  /**
   * 【AGENTS.md §2 の手順そのものを守る】
   *   「ひとすじ（wisp）」は 2026-08-22 に製品オーナー判断で取り下げた。
   *   正しい取り下げは **カタログから消す／描画は残す** の 2 点セットで、
   *   描画まで消すと既存セーブの個体から毛が丸ごと消える。
   *   ここは「新規には出ない」と「既存はまだ描ける」を同時に固定する。
   */
  it('ひとすじ（wisp）は新規個体に二度と出ない', () => {
    const ids = CAT_LOCUS_BY_ID.coat.alleles.map((a) => a.id);
    expect(ids).not.toContain('wisp');

    // 1500 体まわしても表現型に出てこないこと（重みが 0 でなく、不在であること）。
    for (let i = 0; i < 1500; i++) {
      expect(phenotypeOf(randomGenotype(`NOWISP-${i}`), 'adult').parts.coat).not.toBe('wisp');
    }
  });

  it('それでも、既存セーブが持っている wisp は描ける', () => {
    // カタログから外しても描画コードを残すのが約束（AGENTS.md §2）。
    const m = modelFor('OLD-SAVE-WISP', { coat: 'wisp' });
    const coat = m.parts.find((p) => p.id === 'coat');
    expect(coat, 'wisp を持つ既存個体の毛が消えている').toBeTruthy();
    expect(coat!.svg.length).toBeGreaterThan(80);
  });
});

describe('もこもこ（fuzz）は体の輪郭を自分で持つ', () => {
  /**
   * 【何を守るテストか — 製品オーナー指摘】
   *   「既存の体の輪郭が際立ちすぎて変」。房の内側になめらかな線が 1 本でも
   *   出ると、人はそちらを本体の形と読み、房を「縁に付けた飾り」と解釈する
   *   （実測で全個体が「縁をピンキングばさみで切った紙」に見えていた）。
   *
   *   輪郭そのもの（outline パーツ）だけでなく、**体の輪郭に沿って引かれる
   *   すべての線**（質感の縁の艶・すみの締め・ふちひかりの内側の光）が
   *   同じ役をしてしまう。実際 `luminRim` の 3.65px / 不透明度 0.47 の線が
   *   輪郭を消したあとも残っていた。パス単位で機械的に見る。
   */
  const bodyPathOf = (svg: string): string | null => svg.match(/ d="([^"]+)"/)?.[1] ?? null;

  it('もこもこの個体には outline パーツが無く、なしの個体には有る', () => {
    for (let i = 0; i < 40; i++) {
      const withFur = modelFor(`FUZZOUT-${i}`, { coat: 'fuzz' });
      const without = modelFor(`FUZZOUT-${i}`, { coat: 'none' });
      expect(withFur.parts.some((p) => p.id === 'outline')).toBe(false);
      expect(without.parts.some((p) => p.id === 'outline')).toBe(true);
      // 房そのものは必ず出る（輪郭役がいなくなるだけでは裸になる）。
      expect(withFur.parts.some((p) => p.id === 'coat')).toBe(true);
    }
  });

  it('体の輪郭と同じ形を、線として描き直しているパーツが 1 つも無い', () => {
    const bad: string[] = [];
    for (let i = 0; i < 260; i++) {
      const seed = `FUZZRIM-${i}`;
      const m = modelFor(seed, { coat: 'fuzz' });
      const body = m.parts.find((p) => p.id === 'body');
      const d = body ? bodyPathOf(body.svg) : null;
      if (!d) continue;
      for (const part of m.parts) {
        if (part.id === 'body' || part.id === 'coat') continue;
        // 体と同じ d を持ち、線として引かれている <path> を拾う。
        const re = /<path d="([^"]+)"[^>]*>/g;
        let hit: RegExpExecArray | null;
        while ((hit = re.exec(part.svg))) {
          if (hit[1] !== d) continue;
          const tag = hit[0];
          const stroke = /stroke="([^"]+)"/.exec(tag)?.[1];
          if (!stroke || stroke === 'none') continue;
          const w = Number(/stroke-width="([^"]+)"/.exec(tag)?.[1] ?? 0);
          const op = Number(/ opacity="([^"]+)"/.exec(tag)?.[1] ?? 1);
          // ぼかしが掛かっていれば「にじみ」であって線には見えない。
          const blurred = /filter="/.test(part.svg);
          if (!blurred && w < 8 && op >= 0.3) bad.push(`${seed} ${part.id} w=${w} op=${op}`);
        }
      }
    }
    expect(bad.slice(0, 8), '房の内側に 2 本目の輪郭が出ている').toEqual([]);
  });

  it('もこもこにしても、はみ出し・重なりの不良が増えない', () => {
    let withFur = 0;
    let without = 0;
    for (let i = 0; i < 200; i++) {
      withFur += inspectModel(modelFor(`FUZZQ-${i}`, { coat: 'fuzz' })).issues.length;
      without += inspectModel(modelFor(`FUZZQ-${i}`, { coat: 'none' })).issues.length;
    }
    expect(withFur).toBeLessThanOrEqual(without + 2);
  });
});
