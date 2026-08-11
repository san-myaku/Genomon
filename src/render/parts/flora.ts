/**
 * 植物器官（葉・芽・花・しだ・こけ）と首かざり。
 *
 * 植物は「頭に載せた飾り」ではなく「体から生えたもの」に見せる必要がある。
 *  - 付け根には本体色を暗くした短い影だけを落とす（閉じた楕円は置かない）
 *  - 茎の根本は体の内側から出す（y を輪郭より 2px 下げる）
 *  - 葉色は配色ファミリーの色相へ少し寄せてある（palette.ts 参照）
 */

import { lighten, mix } from '../../core/color.ts';
import { clamp, lerp } from '../../core/rng.ts';
import { Z, type DrawCtx, type PartOut } from '../ctx.ts';
import { VIEW } from '../geom.ts';
import {
  boxUnion,
  circle,
  ellipse,
  leafPath,
  leafVein,
  n,
  path,
  pathOpen,
  shrinkToFit,
  starPath,
  type Box,
  type Vec,
} from '../svg.ts';
import { decorScale } from './ears.ts';
import { rootShade } from './body.ts';

// 以前ここには rootMound（本体色で塗りインクで縁取った楕円）があったが、
// 全個体で同じ形・同じ明度の輪が頭頂に乗り「ネジ穴」「はげ」に見えていた
// （ビジュアル批評 P0-2）。body.ts の rootShade（本体色を暗くした短い影を
// 体のクリップ内に落とすだけ）へ置き換えた。

function stem(ctx: DrawCtx, x: number, y: number, len: number, lean: number): { svg: string; tip: Vec } {
  const tip = { x: x + lean * len * 0.36, y: y - len };
  const d = `M${n(x)} ${n(y)}Q${n(x + lean * len * 0.1)} ${n(y - len * 0.55)} ${n(tip.x)} ${n(tip.y)}`;
  return {
    svg:
      path(d, { stroke: ctx.colors.inkPaint, width: ctx.strokeW * 0.9 }) +
      path(d, { stroke: ctx.colors.leaf, width: ctx.strokeW * 0.4 }),
    tip,
  };
}

function drawLeaf(ctx: DrawCtx, x: number, y: number, len: number, wid: number, ang: number): string {
  const c = ctx.colors;
  return (
    path(leafPath(x, y, len, wid, ang, 0.32), {
      fill: c.leafLight,
      stroke: c.inkPaint,
      width: ctx.strokeW * 0.78,
      linejoin: 'round',
    }) +
    path(leafVein(x, y, len, ang), { stroke: c.leafDark, width: ctx.strokeThin * 0.85, opacity: 0.75 })
  );
}

function drawFlower(ctx: DrawCtx, x: number, y: number, r: number): string {
  const c = ctx.colors;
  let s = '';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(a) * r * 0.82;
    const py = y + Math.sin(a) * r * 0.82;
    s += ellipse(px, py, r * 0.62, r * 0.52, {
      fill: c.petal,
      stroke: c.inkPaint,
      width: ctx.strokeW * 0.68,
      extra: `transform="rotate(${n((a * 180) / Math.PI + 90)} ${n(px)} ${n(py)})"`,
    });
  }
  s += circle(x, y, r * 0.42, { fill: c.petalCore, stroke: c.inkPaint, width: ctx.strokeW * 0.62 });
  s += circle(x - r * 0.14, y - r * 0.14, r * 0.14, { fill: '#ffffff', opacity: 0.75 });
  return s;
}

function drawSprout(ctx: DrawCtx, x: number, y: number, k: number): string {
  const st = stem(ctx, x, y, 13 * k, 0);
  return (
    st.svg +
    drawLeaf(ctx, st.tip.x, st.tip.y + 2, 15 * k, 6.5 * k, -152) +
    drawLeaf(ctx, st.tip.x, st.tip.y + 2, 16 * k, 7 * k, -28)
  );
}

function drawFern(ctx: DrawCtx, x: number, y: number, k: number, lean: number): string {
  const c = ctx.colors;
  const L = 34 * k;
  const pts: Vec[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push({ x: x + lean * L * 0.34 * t * t, y: y - L * t });
  }
  let s = path(pathOpen(pts), { stroke: c.leafDark, width: ctx.strokeW * 0.7 });
  for (let i = 1; i <= 5; i++) {
    const t = i / 6;
    const px = x + lean * L * 0.34 * t * t;
    const py = y - L * t;
    const ll = 11 * k * (1 - t * 0.55);
    s += path(leafPath(px, py, ll, ll * 0.36, -150 + lean * 6, 0.3), {
      fill: c.leafLight,
      stroke: c.inkPaint,
      width: ctx.strokeThin * 0.9,
    });
    s += path(leafPath(px, py, ll, ll * 0.36, -30 + lean * 6, 0.3), {
      fill: c.leaf,
      stroke: c.inkPaint,
      width: ctx.strokeThin * 0.9,
    });
  }
  s += path(starPath(pts[6]!.x, pts[6]!.y - 2, 3.6 * k, 1.6 * k, 5, -90), { fill: c.leafLight, opacity: 0.9 });
  return s;
}

function drawMoss(ctx: DrawCtx, x: number, y: number, k: number): string {
  const c = ctx.colors;
  const rng = ctx.rng('moss');
  let s = ellipse(x, y - 2 * k, 16 * k, 8 * k, {
    fill: c.leaf,
    stroke: c.inkPaint,
    width: ctx.strokeW * 0.75,
    linejoin: 'round',
  });
  for (let i = 0; i < 16; i++) {
    const a = rng.float(Math.PI * 1.04, Math.PI * 1.96);
    const rr = rng.float(0.35, 1);
    const px = x + Math.cos(a) * 15 * k * rr;
    const py = y - 2 * k + Math.sin(a) * 8 * k * rr;
    s += circle(px, py, rng.float(1.6, 3.4) * k, {
      fill: rng.bool(0.5) ? c.leafLight : lighten(c.leaf, 0.3),
      opacity: rng.float(0.6, 0.95),
    });
  }
  for (let i = 0; i < 4; i++) {
    const px = x + lerp(-11, 11, i / 3) * k;
    s += path(`M${n(px)} ${n(y - 5 * k)}q${n(1.6 * k)} ${n(-6 * k)} ${n(0.6 * k)} ${n(-9 * k)}`, {
      stroke: c.leafDark,
      width: ctx.strokeThin * 0.85,
    });
    s += circle(px + 0.6 * k, y - 14 * k, 1.9 * k, { fill: c.leafLight, stroke: c.inkPaint, width: ctx.strokeThin * 0.6 });
  }
  return s;
}

export function buildPlant(ctx: DrawCtx): PartOut[] {
  const kind = ctx.parts.plant;
  if (!kind || kind === 'none') return [];
  const s = ctx.shape;
  const H = s.botY - s.topY;
  const rng = ctx.rng('plant');
  const k = decorScale(ctx);
  const ox = ctx.pheno.asymmetry * rng.float(-7, 7);
  const ax = s.cx + ox;
  const ay = s.topY + H * 0.02 + 2;

  // 付け根は「体に落ちる短い影」だけ。閉じた図形は置かない。
  const shade = rootShade(ctx, ax, ay + 1, 11 * k, ox > 0 ? 0.4 : -0.4);
  let svg = '';
  let bbox: Box = { x: ax - 12 * k, y: ay - 6, w: 24 * k, h: 12 };

  const grow = (x: number, y: number, kk: number, which: string): void => {
    switch (which) {
      case 'sprout':
        svg += drawSprout(ctx, x, y, kk);
        bbox = boxUnion(bbox, { x: x - 20 * kk, y: y - 30 * kk, w: 40 * kk, h: 32 * kk });
        break;
      case 'leaf': {
        const st = stem(ctx, x, y, 15 * kk, 0.3);
        svg += st.svg + drawLeaf(ctx, st.tip.x, st.tip.y + 1, 26 * kk, 10 * kk, -74);
        bbox = boxUnion(bbox, { x: x - 16 * kk, y: y - 46 * kk, w: 34 * kk, h: 48 * kk });
        break;
      }
      case 'flower': {
        const st = stem(ctx, x, y, 20 * kk, -0.2);
        svg += st.svg + drawFlower(ctx, st.tip.x, st.tip.y - 4 * kk, 8.6 * kk);
        bbox = boxUnion(bbox, { x: x - 22 * kk, y: y - 40 * kk, w: 44 * kk, h: 42 * kk });
        break;
      }
      case 'fern':
        svg += drawFern(ctx, x, y, kk, -0.5) + drawFern(ctx, x, y, kk * 0.8, 0.7);
        bbox = boxUnion(bbox, { x: x - 26 * kk, y: y - 42 * kk, w: 52 * kk, h: 44 * kk });
        break;
      case 'mossTuft':
        svg += drawMoss(ctx, x, y, kk);
        bbox = boxUnion(bbox, { x: x - 20 * kk, y: y - 20 * kk, w: 40 * kk, h: 24 * kk });
        break;
      default:
        break;
    }
  };

  switch (kind) {
    case 'leafSprout':
      grow(ax - 8 * k, ay + 1, k * 0.86, 'leaf');
      grow(ax + 7 * k, ay + 1, k * 0.8, 'sprout');
      break;
    case 'flowerLeaf':
      grow(ax + 6 * k, ay + 1, k * 0.86, 'flower');
      grow(ax - 9 * k, ay + 2, k * 0.78, 'leaf');
      break;
    case 'flowerSprout':
      grow(ax - 6 * k, ay + 1, k * 0.86, 'flower');
      grow(ax + 8 * k, ay + 2, k * 0.76, 'sprout');
      break;
    default:
      grow(ax, ay, k, kind);
      break;
  }

  const fitted = shrinkToFit(svg, bbox, s.cx, s.topY + 10, VIEW, 2);
  return [
    {
      id: 'plant',
      z: Z.PLANT,
      // 影は体の座標系で描いてあるので shrinkToFit の transform の外に置く
      // （中に入れるとクリップのパスまで一緒に縮んでしまう）。
      svg: shade + fitted.svg,
      anchor: { id: 'plant', x: ax, y: ay, angle: 0, scale: k },
      bbox: fitted.bbox,
    },
  ];
}

// ─────────────────────────────────────────────────────────
//  首かざり
// ─────────────────────────────────────────────────────────

export function buildCollar(ctx: DrawCtx): PartOut[] {
  const kind = ctx.parts.collar;
  if (!kind || kind === 'none') return [];
  const s = ctx.shape;
  const c = ctx.colors;
  const y = clamp(ctx.face.neckY, s.topY + 30, s.botY - 14);
  const rx = s.halfAt(y) * 0.96;
  const ry = Math.max(4.5, rx * 0.19);
  const rng = ctx.rng('collar');
  let svg = '';

  switch (kind) {
    case 'beadRing': {
      const cnt = Math.max(7, Math.round(rx / 5.4));
      for (let i = 0; i < cnt; i++) {
        const t = i / (cnt - 1);
        const a = Math.PI * (0.06 + t * 0.88);
        const px = s.cx - Math.cos(a) * rx;
        const py = y + Math.sin(a) * ry;
        const r = lerp(2.6, 4.2, Math.sin(t * Math.PI));
        svg += circle(px, py, r, { fill: c.accent, stroke: c.inkPaint, width: ctx.strokeThin * 0.9 });
        svg += circle(px - r * 0.3, py - r * 0.3, r * 0.3, { fill: '#ffffff', opacity: 0.7 });
      }
      break;
    }
    case 'frill': {
      const cnt = Math.max(6, Math.round(rx / 6.5));
      let d = '';
      for (let i = 0; i < cnt; i++) {
        const t0 = i / cnt;
        const t1 = (i + 1) / cnt;
        const a0 = Math.PI * (0.02 + t0 * 0.96);
        const a1 = Math.PI * (0.02 + t1 * 0.96);
        const x0 = s.cx - Math.cos(a0) * rx;
        const y0 = y + Math.sin(a0) * ry;
        const x1 = s.cx - Math.cos(a1) * rx;
        const y1 = y + Math.sin(a1) * ry;
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2 + 9;
        d += `M${n(x0)} ${n(y0)}Q${n(mx)} ${n(my)} ${n(x1)} ${n(y1)}`;
      }
      svg += path(d, { fill: mix(c.belly, c.accent, 0.4), stroke: c.inkPaint, width: ctx.strokeW * 0.78, linejoin: 'round' });
      svg += path(d, { stroke: lighten(c.accent, 0.35), width: ctx.strokeThin * 0.7, opacity: 0.7 });
      break;
    }
    case 'mossRing': {
      // 【！！このコードは消さないこと！！ — 遺伝子カタログから外れているが現役】
      //   製品オーナーの判断で『こけわ』（首かざり）は不採用になり、リードが
      //   `genetics/loci.ts` の collar から `mossRing` を **外し済み**。
      //   したがって **新しく生まれる個体にこの首かざりは二度と出ない**。
      //   それでも描画を残しているのは、**既存のセーブデータが遺伝子型に
      //   `mossRing` を持っている可能性がある**ため。ここを消すと
      //   `switch (kind)` がどの case にも入らず、その個体の首元が
      //   **無地に化ける** ＝ プレイヤーから見れば
      //   飼っている個体の見た目が勝手に変わる。
      //   カタログから消えていることを理由に「もう使われていない死んだコード」と
      //   判断して削除しないこと（`pattern.ts` の `ocelli` / `face.ts` の
      //   `button` と同じ扱い）。
      //
      // 苔の輪。以前は「面＋粒」で 1 つの帯を大きく波打たせて垂らしていたが、
      // それだと顎の下に左右非対称な塊が下がって「腰巻き」に見えてしまった
      // （ビジュアル批評 R3K4-BJHR / 4UJW-5WXY）。
      // 面にしたこと自体ではなく「1 つの塊が大きく垂れる形」が原因なので、
      // beadRing と同じ「弧に沿って小さな房を連ねる」構成に作り直す。
      // 房どうしが少し重なるくらいの密度で並べ、房の大きさ・位置だけを
      // 名前付き乱数でわずかにばらけさせることで、
      // 均等な点列＝「ファスナー」にも見えないようにしている。
      const cnt = Math.max(12, Math.round(rx / 3.6));
      for (let i = 0; i < cnt; i++) {
        const t = i / (cnt - 1);
        const a = Math.PI * (0.05 + t * 0.9);
        const px = s.cx - Math.cos(a) * rx + rng.float(-1.3, 1.3);
        const py = y + Math.sin(a) * ry * 0.8 + rng.float(-0.6, 1.6);
        const tr = rng.float(3, 4.8);
        svg += circle(px, py, tr, {
          fill: c.leaf,
          stroke: c.inkPaint,
          width: ctx.strokeThin * 0.95,
        });
        svg += circle(px + rng.float(-tr * 0.35, tr * 0.35), py + rng.float(-tr * 0.4, tr * 0.15), tr * 0.4, {
          fill: rng.bool(0.5) ? c.leafLight : lighten(c.leaf, 0.3),
          opacity: rng.float(0.65, 1),
        });
      }
      break;
    }
    default:
      break;
  }

  if (!svg) return [];
  const bbox: Box = { x: s.cx - rx - 5, y: y - ry - 6, w: rx * 2 + 10, h: ry * 2 + 18 };
  return [
    {
      id: 'collar',
      z: Z.COLLAR,
      svg,
      anchor: { id: 'collar', x: s.cx, y, angle: 0, scale: 1 },
      bbox,
    },
  ];
}
