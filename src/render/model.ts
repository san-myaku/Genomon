/**
 * Phenotype (+ LifeState) → RenderModel。
 *
 * ここがアート側の入口。パーツを組み立て、z 昇順に並べ、
 * アンカー（接合点）とモーションパラメータを添えて返す。
 *
 * 【不変条件】
 *   同じ (Phenotype, life, detail) からは常に同じ RenderModel が出る。
 *   Math.random() は一切使わない（すべて Rng の名前付きサブストリーム）。
 */

import type {
  Anchor,
  Genotype,
  LifeState,
  MotionParams,
  Phenotype,
  RenderDetail,
  RenderModel,
  RenderPart,
} from '../core/types.ts';
import { Rng, clamp, lerp } from '../core/rng.ts';
import { Defs, makeUid, url, type Box } from './svg.ts';
import { VIEW, buildShape, faceBoxOf } from './geom.ts';
import { inkThemeStyle, resolveColors } from './palette.ts';
import { Z, moodOf, type DrawCtx, type PartOut } from './ctx.ts';
import { layoutFace } from './parts/faceLayout.ts';
import {
  buildBody,
  registerBodyClip,
  registerBodyMaskIn,
  registerBodyMaskOut,
  veilShowThrough,
} from './parts/body.ts';
import { buildCoat } from './parts/coat.ts';
import { buildFace } from './parts/face.ts';
import { buildPattern } from './parts/pattern.ts';
import { buildLumin } from './parts/lumin.ts';
import { buildAntennae, buildEars, buildHorns } from './parts/ears.ts';
import { buildCollar, buildPlant } from './parts/flora.ts';
import { buildFeet, buildTail } from './parts/limbs.ts';
import { buildCrystal, buildFloaters, buildWings } from './parts/aura.ts';
import { buildEggModel } from './egg.ts';

export interface BuildOpts {
  detail: RenderDetail;
  uid?: string;
  /** 卵の描画で保因遺伝子を参照するために使う（任意）。 */
  genotype?: Genotype | null;
}

function motionFor(pheno: Phenotype, rng: Rng): MotionParams {
  const p = pheno.personality;
  const energy = clamp(p?.energy ?? 0.5, 0, 1);
  const curiosity = clamp(p?.curiosity ?? 0.5, 0, 1);
  const yurei = pheno.base === 'yurei';
  const slime = pheno.base === 'slime';
  return {
    breathMs: Math.round(lerp(3600, 1900, energy) * (slime ? 1.12 : 1)),
    breathAmp: clamp(0.026 + energy * 0.026 + (slime ? 0.03 : 0) + pheno.plump * 0.012, 0.02, 0.09),
    floatAmp: yurei ? lerp(4.5, 8.5, energy) : slime ? lerp(1, 2.4, energy) : lerp(1.4, 3.4, energy),
    floatMs: Math.round(lerp(4200, 2200, energy) * (yurei ? 1.25 : 1)),
    blinkMs: Math.round(lerp(5400, 2600, curiosity)),
    swayDeg: clamp(lerp(1, 3.2, energy) * (yurei ? 1.5 : 1), 0.6, 5),
    swayMs: Math.round(lerp(4600, 2400, energy)),
    phase: rng.float(0, 1),
  };
}

/** 表現型の parts が欠けていても落ちないよう既定値で埋める。 */
function safeParts(pheno: Phenotype): Phenotype['parts'] {
  const p = pheno.parts ?? ({} as Phenotype['parts']);
  return {
    eyeCount: clamp(Math.round(p.eyeCount ?? 2), 1, 3),
    eyeShape: p.eyeShape ?? 'round',
    pupil: p.pupil ?? 'round',
    lashes: p.lashes ?? 'none',
    mouth: p.mouth ?? 'smile',
    ears: p.ears ?? 'none',
    earTip: p.earTip ?? 'none',
    antennae: p.antennae ?? 'none',
    horns: p.horns ?? 'none',
    plant: p.plant ?? 'none',
    wings: p.wings ?? 'none',
    tail: p.tail ?? 'none',
    crystal: p.crystal ?? 'none',
    collar: p.collar ?? 'none',
    feet: p.feet ?? 'none',
    floaters: p.floaters ?? 'none',
    bicolor: p.bicolor ?? 'none',
    lumin: p.lumin ?? 'none',
    pattern: p.pattern ?? 'none',
    texture: p.texture ?? 'matte',
    coat: p.coat ?? 'none',
    silhouette: p.silhouette ?? 'plain',
  };
}

export function buildRenderModel(
  pheno: Phenotype,
  life: LifeState | null,
  opts: BuildOpts,
): RenderModel {
  const detail = opts.detail ?? 'full';
  const uid = opts.uid ?? makeUid(pheno.seed, `${pheno.stage}:${detail}`);

  if (pheno.stage === 'egg') {
    return buildEggModel(pheno, { detail, uid, genotype: opts.genotype ?? null });
  }

  const root = new Rng(pheno.seed);
  const parts = safeParts(pheno);
  const phenoSafe: Phenotype = { ...pheno, parts };
  const shape = buildShape(phenoSafe);
  const faceBox = faceBoxOf(phenoSafe, shape);
  const face = layoutFace(phenoSafe, shape, faceBox);
  const colors = resolveColors(phenoSafe);
  const defs = new Defs(uid);
  // テーマで切り替える色。パーツ構築中に書き込まれるので、
  // <style> の登録はパーツを組み立てた **後** に行う（Defs.add は即時評価）。
  const themeVars: Record<string, [string, string]> = {};
  const sizeNorm = clamp((phenoSafe.size - 0.78) / 0.5, 0, 1);
  const strokeW = lerp(2.7, 3.35, sizeNorm);

  const ctx: DrawCtx = {
    pheno: phenoSafe,
    parts,
    colors,
    shape,
    face,
    detail,
    uid,
    defs,
    strokeW,
    strokeThin: strokeW * 0.62,
    life,
    mood: moodOf(life, phenoSafe),
    bodyClip: '',
    themeVars,
    rng: (name: string) => root.stream(`render:${name}`),
  };
  ctx.bodyClip = registerBodyClip(ctx);

  const collected: PartOut[] = [
    ...buildCoat(ctx),
    ...buildWings(ctx),
    ...buildTail(ctx),
    ...buildEars(ctx),
    ...buildFeet(ctx),
    ...buildBody(ctx),
    ...buildLumin(ctx),
    ...buildPattern(ctx),
    ...buildCollar(ctx),
    ...buildPlant(ctx),
    ...buildHorns(ctx),
    ...buildAntennae(ctx),
    ...buildCrystal(ctx),
    ...buildFloaters(ctx),
    ...buildFace(ctx),
  ];

  // ── 背面パーツの「体内部分」を切り落とす ──────────────────
  // 足・耳・尾・羽は付け根を体の内側から始めているが、本体の塗りには
  // 透明度があるため、体内部分が透けて硬いエッジの図形として見えていた。
  // 塗りの不透明度に依存しないよう、体の内側は描画そのものを止める。
  const maskOut = registerBodyMaskOut(ctx);
  // うすぎぬ（veil）だけ「膜越しに付け根が透ける」レイヤを足す。
  // ここが 0 でない個体は、体内側を **輪郭なし・ぼかし・低不透明度** で重ねる。
  const showThrough = veilShowThrough(ctx);
  const maskIn = showThrough > 0 ? registerBodyMaskIn(ctx) : '';
  const veilBlur =
    showThrough > 0
      ? defs.add('veilblur', (id) =>
          `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">` +
          `<feGaussianBlur stdDeviation="1.5"/></filter>`,
        )
      : '';
  const BACK_MASKED = new Set(['feet', 'ears', 'tail', 'wings', 'coat']);
  // うすぎぬの「透けレイヤ」を足すのは、体内に面積のある付け根を持つ器官だけ。
  // 毛は体内へ 3px ほどの細い根が埋まっているだけなので、透かしても絵にならず
  // パスの数（毛は 1 個体で最大 96 本）が倍になるだけになる。
  const VEIL_SHOWN = new Set(['feet', 'ears', 'tail', 'wings']);
  for (const p of collected) {
    if (p.z < Z.BODY && BACK_MASKED.has(p.id) && p.svg) {
      const outer = `<g mask="${url(maskOut)}">${p.svg}</g>`;
      if (!maskIn || !VEIL_SHOWN.has(p.id)) {
        p.svg = outer;
        continue;
      }
      // 【輪郭線を落とす理由】
      //   体内に残すのが「輪郭」だと、その直線が体を横切る割れ目として読まれる
      //   （実測 `V2XQ-HFWE`: 口の下に灰色の台形 2 つ＝脚、左に円＝尾）。
      //   塗りだけなら、膜の下にうっすら差す影として読める。
      //   `stroke="…"` は svg.ts が必ずこの形で出す属性なので、
      //   属性ごと落とせば線は消え、面はそのまま残る。
      const fillsOnly = p.svg.replace(/\sstroke="[^"]*"/g, '').replace(/\sstroke-width="[^"]*"/g, '');
      p.svg =
        outer +
        `<g class="gm-veil-in" mask="${url(maskIn)}" filter="${url(veilBlur)}"` +
        ` opacity="${Math.round(showThrough * 100) / 100}">${fillsOnly}</g>`;
    }
  }

  // 輪郭インクとテーマ依存色の切り替え（`--gm-ink` ほか）。
  // defs の中の <style> は文書全体に効くので、セレクタを data-uid で絞ってある。
  // パーツが `ctx.themeVars` へ書き込んだ後でなければ拾えないのでここで登録する。
  defs.add('inkvar', () => inkThemeStyle(uid, colors.ink, colors.inkDark, themeVars));

  // z 昇順（同値は配列順を保つ安定ソート）
  const indexed = collected.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => (a.p.z - b.p.z) || (a.i - b.i));

  const renderParts: RenderPart[] = indexed.map(({ p }) => ({
    id: p.id,
    z: p.z,
    svg: p.svg,
    ...(p.anchor ? { anchor: p.anchor } : {}),
    ...(p.bbox ? { bbox: p.bbox } : {}),
    ...(p.probes?.length ? { probes: p.probes } : {}),
    ...(p.roots?.length ? { roots: p.roots } : {}),
  }));

  const anchors: Anchor[] = renderParts
    .map((p) => p.anchor)
    .filter((a): a is Anchor => !!a);
  // 顔と接地点は常にアンカーとして持たせる（Visual Lab のデバッグ表示用）
  anchors.push({ id: 'faceCenter', x: face.cx, y: face.cy, angle: 0, scale: 1 });
  anchors.push({ id: 'ground', x: shape.cx, y: shape.botY, angle: 0, scale: 1 });
  face.eyes.forEach((e, i) => {
    anchors.push({ id: `eye${i}`, x: e.x, y: e.y, angle: 0, scale: e.s / 16 });
  });
  anchors.push({ id: 'mouth', x: face.mouth.x, y: face.mouth.y, angle: 0, scale: 1 });

  const bodyBox: Box = {
    x: shape.cx - shape.halfW,
    y: shape.topY,
    w: shape.halfW * 2,
    h: shape.botY - shape.topY,
  };

  return {
    seed: pheno.seed,
    stage: pheno.stage,
    base: phenoSafe.base,
    detail,
    uid,
    viewBox: { ...VIEW },
    defs: defs.toString(),
    parts: renderParts,
    anchors,
    bodyBox,
    faceBox,
    motion: motionFor(phenoSafe, root.stream('motion')),
  };
}
