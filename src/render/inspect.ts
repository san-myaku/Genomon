/**
 * RenderModel の自動検査。QA が 100 体走らせて機械的に不具合を拾うためのもの。
 *
 * 「絵として良いか」は人の目でしか判断できないが、
 * 「はみ出し／重なり／浮き／NaN」は機械が確実に拾える。ここはその機械側。
 *
 * 【2 度目の作り直しの理由】
 *   初版は bodyBox（外接矩形）だけを見ていた。矩形は輪郭よりずっと大きいので
 *     ・まぶたの線が体の輪郭から突き抜けている
 *     ・菱形の装飾が卵に接触せず宙に浮いている
 *     ・背面パーツ（脚）の体内部分が半透明の体を透けて台形に見えている
 *   のどれも「矩形の中」に収まってしまい、9 個の卵に明白な破綻があっても
 *   「問題個体 0 / 9」と報告していた。
 *   そこで検査を次の 3 本立てにした。
 *     A) 実シルエット（clipPath のパスを折れ線に展開したもの）で内外を判定する
 *     B) 「体に生えている」はずのパーツは、付け根が輪郭に接していることを要求する
 *     C) 構造不変条件（背面パーツは必ず体マスクを通す 等）を文字列レベルで検査する
 *   B と C は幾何では拾えない種類のバグを拾うので、両方要る。
 */

import type { RenderModel } from '../core/types.ts';
import { boxOverlapArea, flattenPath, outsideDepth, type Box, type Vec } from './svg.ts';

export interface InspectResult {
  ok: boolean;
  issues: string[];
}

/**
 * 顔を覆いうる装飾＝「体より手前に描かれるもの」だけ。
 * 羽・後ろ耳・尾・足は体の背面（z < 40）に描かれるので、
 * bbox が faceBox と重なっても実際には顔を隠さない。ここを区別しないと
 * 検査が偽陽性だらけになり、本当に顔が潰れている個体を見落とす。
 */
// 浮遊物は散らばって配置されるため、束ねた bbox が実際の占有面積を大きく
// 上回る。配置側で faceBox を避けているので、覆い率の検査からは外す。
const DECOR_IDS = new Set(['antennae', 'horns', 'plant', 'crystal', 'collar']);
/** 体より手前とみなす z の下限（ctx.ts の Z.OUTLINE）。 */
const FRONT_Z = 58;
/** 体そのものの z（ctx.ts の Z.BODY）。 */
const BODY_Z = 40;

/** 体から離れていて当然のパーツ（浮き検査から除外）。 */
const FLOATING_IDS = new Set([
  'floatersBack',
  'floatersFront',
  'crystal',
  'shadow',
  'glow',
  'sparkle',
  'nest',
]);

/** 体に「生えている」ことを要求するパーツ。付け根が輪郭に接していなければ不合格。 */
const ATTACHED_IDS = new Set([
  'ears',
  'horns',
  'antennae',
  'plant',
  'feet',
  'tail',
  'wings',
  'collar',
  'bumps',
]);

/** 体の内側に完全に収まっていなければならないパーツ（顔）。 */
const INSIDE_IDS = /^(eye\d+|lash\d+|mouth|cheeks)$/;

/**
 * 背面（z < BODY）に描かれるパーツのうち、体マスクを通していないと
 * 半透明の体越しに「体内部分」が透けて見えるもの。
 */
const MUST_MASK_IDS = new Set(['feet', 'ears', 'tail', 'wings']);

/** 卵に出てはいけないパーツ ID（成体用の装飾）。 */
const EGG_FORBIDDEN = new Set([
  'ears',
  'horns',
  'antennae',
  'plant',
  'wings',
  'tail',
  'collar',
  'feet',
  'crystal',
  'eye0',
  'eye1',
  'eye2',
  'lash0',
  'lash1',
  'lash2',
  'mouth',
  'cheeks',
]);

const inside = (b: Box, v: Box, tol: number): boolean =>
  b.x >= v.x - tol &&
  b.y >= v.y - tol &&
  b.x + b.w <= v.x + v.w + tol &&
  b.y + b.h <= v.y + v.h + tol;

/** 矩形の外側までの距離（内側なら 0）。 */
function distToBox(x: number, y: number, b: Box): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/**
 * defs から本体（または殻）のシルエットを取り出して折れ線にする。
 * clipPath は描画で実際に使っているものなので、
 * 「絵として見えている輪郭」と検査の基準が必ず一致する。
 */
function silhouetteOf(model: RenderModel): Vec[] {
  const m = /<clipPath id="[^"]*_(?:bclip|eclip)"><path d="([^"]+)"/.exec(model.defs);
  if (!m) return [];
  return flattenPath(m[1]!, 6);
}

/** 矩形の周囲＋四隅の代表点。 */
function boxProbes(b: Box): Vec[] {
  const x0 = b.x;
  const y0 = b.y;
  const x1 = b.x + b.w;
  const y1 = b.y + b.h;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  return [
    { x: x0, y: y0 },
    { x: mx, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: my },
    { x: x1, y: y1 },
    { x: mx, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: my },
  ];
}

export function inspectModel(model: RenderModel): InspectResult {
  const issues: string[] = [];
  const v = model.viewBox;
  const poly = silhouetteOf(model);
  const hasPoly = poly.length >= 8;

  // ── 1. すべてのパーツ bbox が viewBox 内か ────────────────
  for (const p of model.parts) {
    if (!p.bbox) continue;
    const b = p.bbox;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.w) || !Number.isFinite(b.h)) {
      issues.push(`bbox-invalid:${p.id}`);
      continue;
    }
    if (!inside(b, v, 1.5)) {
      issues.push(
        `out-of-view:${p.id}(${b.x.toFixed(1)},${b.y.toFixed(1)},${(b.x + b.w).toFixed(1)},${(b.y + b.h).toFixed(1)})`,
      );
    }
  }

  // ── 2. 目同士が重なっていないか ──────────────────────────
  const eyes = model.parts.filter((p) => /^eye\d+$/.test(p.id) && p.bbox);
  for (let i = 0; i < eyes.length; i++) {
    for (let j = i + 1; j < eyes.length; j++) {
      const a = eyes[i]!.bbox!;
      const b = eyes[j]!.bbox!;
      const area = boxOverlapArea(a, b);
      if (area > 1) {
        issues.push(`eye-overlap:${eyes[i]!.id}/${eyes[j]!.id}(${area.toFixed(1)})`);
      }
    }
  }
  if (model.stage !== 'egg' && eyes.length === 0) {
    issues.push('no-eyes');
  }

  // ── 3. 顔（目・口・頬）が体の輪郭から突き抜けていないか ───
  //    矩形ではなく実シルエットで見る。まぶたの弧やまつげが輪郭の外へ
  //    飛び出す不具合はここでしか捕まらない。
  for (const p of model.parts) {
    if (!p.bbox || !INSIDE_IDS.test(p.id)) continue;
    if (hasPoly) {
      let worst = 0;
      // 【`probes` があるパーツは矩形を見ない】
      //   まつげのように斜めに伸びる絵は、bbox の **角が空白** になる。
      //   そこを検査すると、絵が体の中に収まっていても不良として出る
      //   （実測で成体 300 体中 43 件の誤検出）。輪郭上の点を宣言している
      //   パーツは、その点だけを見るのが正しい。
      const pts = p.probes?.length ? p.probes : boxProbes(p.bbox);
      for (const q of pts) worst = Math.max(worst, outsideDepth(q.x, q.y, poly));
      if (worst > 2) issues.push(`face-outside-body:${p.id}(${worst.toFixed(1)})`);
    } else {
      const grown: Box = {
        x: model.bodyBox.x - 3,
        y: model.bodyBox.y - 3,
        w: model.bodyBox.w + 6,
        h: model.bodyBox.h + 6,
      };
      if (!inside(p.bbox, grown, 0)) issues.push(`face-outside-body:${p.id}`);
    }
  }

  // ── 4. 装飾が faceBox を過剰に覆っていないか ─────────────
  const faceArea = Math.max(1, model.faceBox.w * model.faceBox.h);
  let cover = 0;
  const covering: string[] = [];
  for (const p of model.parts) {
    if (!p.bbox || !DECOR_IDS.has(p.id) || p.z < FRONT_Z) continue;
    const a = boxOverlapArea(model.faceBox, p.bbox);
    if (a > 0) {
      cover += a;
      covering.push(p.id);
    }
  }
  const ratio = cover / faceArea;
  if (ratio > 0.42) {
    issues.push(`face-covered:${(ratio * 100).toFixed(0)}%[${covering.join(',')}]`);
  }

  // ── 5. パーツが体から離れて浮いていないか ────────────────
  for (const p of model.parts) {
    if (!p.anchor || FLOATING_IDS.has(p.id)) continue;
    const d = hasPoly
      ? outsideDepth(p.anchor.x, p.anchor.y, poly)
      : distToBox(p.anchor.x, p.anchor.y, model.bodyBox);
    if (d > (hasPoly ? 5 : 18)) issues.push(`detached:${p.id}(${d.toFixed(1)})`);
  }

  // ── 6. 「生えている」パーツが体に接触しているか ───────────
  //    付け根が正しくても、shrinkToFit で縮んで体から離れることがある。
  //    bbox とシルエットの接触を別途要求する。
  if (hasPoly) {
    for (const p of model.parts) {
      if (!p.bbox || !ATTACHED_IDS.has(p.id)) continue;

      // 【付け根を見る理由】
      //   boxProbes は bbox の角と辺の中点しか見ない。尾の渦巻きのように
      //   付け根が「角でも辺の中点でもない」位置にあるパーツでは、実際には
      //   体に接していても接触点を取りこぼし、300 体中 7 体が誤検出されていた。
      //   anchor は「このパーツが体のどこから生えているか」の宣言そのものなので、
      //   それが体の上にあるかを直接見るほうが正しい。
      //
      //   ただし anchor を見るだけだと「付け根の宣言はあるが、絵はまったく別の
      //   場所に描かれている」パーツを見逃す。そこで
      //     ① 付け根が体の上（または縁から 3 以内）にある
      //     ② パーツの絵が実際にその付け根の周りに描かれている（bbox が anchor を含む）
      //   の両方を満たすときだけ「生えている」と認める。
      const a = p.anchor;
      const rootAttached =
        !!a &&
        outsideDepth(a.x, a.y, poly) < 3 &&
        a.x >= p.bbox.x - 2 &&
        a.x <= p.bbox.x + p.bbox.w + 2 &&
        a.y >= p.bbox.y - 2 &&
        a.y <= p.bbox.y + p.bbox.h + 2;

      const bboxTouches =
        boxOverlapArea(p.bbox, model.bodyBox) > 0.5 &&
        boxProbes(p.bbox).some((q) => outsideDepth(q.x, q.y, poly) < 3);

      if (!rootAttached && !bboxTouches) issues.push(`not-touching-body:${p.id}`);
    }
  }

  // ── 7. 背面パーツが体マスクを通っているか（構造の不変条件）──
  //    体の塗りには透明度があるので、マスク無しの背面パーツは
  //    「体内部分」が硬いエッジの図形として透けてしまう。
  for (const p of model.parts) {
    if (p.z >= BODY_Z || !MUST_MASK_IDS.has(p.id)) continue;
    if (!/mask="url\(#/.test(p.svg)) issues.push(`unmasked-back-part:${p.id}`);
  }

  // ── 7b. 背面パーツの体内部分が「硬いエッジ」で透けていないか ──
  //
  // 【なぜ 7 だけでは足りないか — 実際に取りこぼした】
  //   7 は「マスクを通しているか」しか見ない。ところが うすぎぬ（veil）用に
  //   体マスクの内側をグレー（≒27%）にした実装では、マスクは通っているのに
  //   **輪郭線ごと**体内へ透ける。`V2XQ-HFWE` は口の直下に灰色の台形が 2 つ
  //   （脚）、左に円（尾）が出て「体が割れている」絵になっていたが、
  //   検査は 0/9 と報告していた。見るべきなのは
  //     ① 体を切り抜くマスクが本当に体内を消しているか（＝純黒か）
  //     ② 透け用の重ねレイヤに線（stroke）が残っていないか
  //   の 2 点で、どちらも文字列で確実に判定できる。
  const cut = /<mask id="[^"]*_bmaskout"[^>]*>[\s\S]*?<path d="[^"]*" fill="([^"]+)"[^>]*\/><\/mask>/.exec(
    model.defs,
  );
  if (cut) {
    const fill = cut[1]!.trim().toLowerCase();
    const lum = ((): number => {
      const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(fill);
      if (rgb) return Math.max(+rgb[1]!, +rgb[2]!, +rgb[3]!) / 255;
      const hex = /^#([0-9a-f]{6})$/.exec(fill);
      if (hex) {
        const v = parseInt(hex[1]!, 16);
        return Math.max((v >> 16) & 255, (v >> 8) & 255, v & 255) / 255;
      }
      return fill === 'black' || fill === '#000' ? 0 : 1;
    })();
    // マスクは 0（＝完全に切る）でなければならない。1% でも残ると
    // その中の輪郭線がそのまま体内に現れる。
    if (lum > 0.01) {
      issues.push(`backpart-showthrough:mask(${(lum * 100).toFixed(0)}%)`);
    }
  }
  for (const p of model.parts) {
    if (p.z >= BODY_Z || !MUST_MASK_IDS.has(p.id)) continue;
    const at = p.svg.indexOf('gm-veil-in');
    if (at < 0) continue;
    // 透けレイヤは必ずパーツ svg の最後に置く（model.ts）。
    // そこから先に stroke が残っていれば、体内に線が出るということ。
    if (/\sstroke="/.test(p.svg.slice(at))) {
      issues.push(`backpart-showthrough:${p.id}`);
    }
  }

  // ── 8. 卵に成体の装飾が出ていないか ──────────────────────
  if (model.stage === 'egg') {
    for (const p of model.parts) {
      if (EGG_FORBIDDEN.has(p.id)) issues.push(`egg-adult-part:${p.id}`);
    }
  }

  // ── 9. SVG 文字列に NaN / undefined / Infinity ────────────
  const all = model.defs + model.parts.map((p) => p.svg).join('');
  for (const bad of ['NaN', 'undefined', 'Infinity', 'null']) {
    if (all.includes(bad)) issues.push(`bad-token:${bad}`);
  }
  if (all.includes('url(#)') || all.includes('fill=""')) issues.push('empty-ref');

  // ── 10. 基本の整合 ──────────────────────────────────────
  if (model.parts.length === 0) issues.push('no-parts');
  if (!(model.bodyBox.w > 0 && model.bodyBox.h > 0)) issues.push('bad-bodyBox');
  if (!(model.faceBox.w > 0 && model.faceBox.h > 0)) issues.push('bad-faceBox');
  if (!hasPoly) issues.push('no-silhouette');

  return { ok: issues.length === 0, issues };
}

/** 複数モデルをまとめて検査し、種別ごとの件数を返す。 */
export function inspectBatch(models: readonly RenderModel[]): {
  total: number;
  bad: number;
  byKind: Record<string, number>;
  samples: { seed: string; issues: string[] }[];
} {
  const byKind: Record<string, number> = {};
  const samples: { seed: string; issues: string[] }[] = [];
  let bad = 0;
  for (const m of models) {
    const r = inspectModel(m);
    if (!r.ok) {
      bad++;
      if (samples.length < 24) samples.push({ seed: m.seed, issues: r.issues });
      for (const i of r.issues) {
        const kind = i.split(':')[0]!;
        byKind[kind] = (byKind[kind] ?? 0) + 1;
      }
    }
  }
  return { total: models.length, bad, byKind, samples };
}
