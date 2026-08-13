/**
 * 足と尾。
 *
 * 足は体の背面（Z.FEET）に描いて下からのぞかせる。輪郭が体に食い込むので
 * 「貼り付けた楕円」ではなく「体から続く足」に見える。
 * 幽霊型は接地しないので、足があっても地面から浮いた位置に置く。
 */

import { darken, lighten, mix } from '../../core/color.ts';
import { clamp, lerp } from '../../core/rng.ts';
import { Z, type DrawCtx, type PartOut } from '../ctx.ts';
import { GROUND_Y, VIEW } from '../geom.ts';
import {
  boxOf,
  boxUnion,
  circle,
  ellipse,
  leafPath,
  leafVein,
  n,
  path,
  pathOpen,
  shrinkToFit,
  type Box,
  type Vec,
} from '../svg.ts';
import { harmonize } from '../palette.ts';
import { organGrad } from './body.ts';

/**
 * 足。
 *
 * 【針金に見せないための条件】
 *  - 線ではなく「面」で描く。細い stroke を 3 本引くと針金にしか見えない。
 *  - 付け根を体の輪郭より内側から始め、体の背面（Z.FEET）に置く。
 *    体の塗りが付け根を隠すので、生えている接続になる。
 *  - 塗りは本体色から連続させ、線は体と同じインク・同じ太さ。
 */
export function buildFeet(ctx: DrawCtx): PartOut[] {
  const kind = ctx.parts.feet;
  if (!kind || kind === 'none') return [];
  const s = ctx.shape;
  const c = ctx.colors;
  const rng = ctx.rng('feet');
  const k = clamp(0.85 + ctx.pheno.size * 0.25, 0.82, 1.2);
  const spread = Math.max(14, s.halfAt(s.botY - 10) * 0.62);
  /**
   * 足の付け根の高さ。
   *
   * 【底辺の y をそのまま使えない理由】
   *   スライム型の裾は波・しずく・割れで切れ上がるので、
   *   「底辺 = botY」の前提で足を置くと切れ上がった位置で体から離れて浮く。
   *   その x での実際の下端を見て、そこから体の内側へ 3 だけ食い込ませる。
   */
  const rootY = (x: number): number =>
    s.grounded ? Math.min(s.bottomYAt(x) - 3, GROUND_Y - 4) : s.botY + 3;
  const baseY = rootY(s.cx);
  // 足の塗りは体色をわずかに沈めた色。真っ平らな体色だと切り貼りに見える。
  const footFill = mix(c.body, c.bodyDark, 0.18);
  let svg = '';
  let bbox: Box | undefined;

  for (const side of [-1, 1]) {
    const x = s.cx + side * spread;
    const jit = ctx.pheno.asymmetry * rng.float(-2.2, 2.2);
    const y = rootY(x) + jit;
    let g = '';
    let b: Box;
    switch (kind) {
      case 'paw': {
        const rx = 13.5 * k;
        const ry = 10 * k;
        // 付け根から足首へつながる面（体の中へ食い込ませる）
        g += path(
          `M${n(x - rx * 0.66)} ${n(y - ry * 2.2)}` +
          `C${n(x - rx * 0.9)} ${n(y - ry * 0.6)} ${n(x - rx)} ${n(y + ry * 0.4)} ${n(x - rx * 0.86)} ${n(y + ry * 0.7)}` +
          `L${n(x + rx * 0.86)} ${n(y + ry * 0.7)}` +
          `C${n(x + rx)} ${n(y + ry * 0.4)} ${n(x + rx * 0.9)} ${n(y - ry * 0.6)} ${n(x + rx * 0.66)} ${n(y - ry * 2.2)}Z`,
          { fill: footFill, stroke: c.inkPaint, width: ctx.strokeW, linejoin: 'round' },
        );
        g += ellipse(x, y + ry * 0.16, rx * 0.9, ry * 0.72, {
          fill: footFill,
          stroke: c.inkPaint,
          width: ctx.strokeW,
          linejoin: 'round',
        });
        g += ellipse(x, y + ry * 0.34, rx * 0.5, ry * 0.4, { fill: mix(c.belly, c.cheek, 0.3), opacity: 0.8 });
        for (let i = -1; i <= 1; i++) {
          g += path(`M${n(x + i * rx * 0.4)} ${n(y - ry * 0.16)}l0 ${n(ry * 0.44)}`, {
            stroke: c.inkSoft,
            width: ctx.strokeThin * 0.85,
            opacity: 0.7,
          });
        }
        b = { x: x - rx - 1, y: y - ry * 2.3, w: rx * 2 + 2, h: ry * 3.1 };
        break;
      }
      case 'root': {
        // ねっこ: 太い根が体から下りて、先が枝分かれして地面に接する。
        const L = 17 * k;
        const trunkW = 7.5 * k;
        for (let i = -1; i <= 1; i++) {
          const tipX = x + i * 11 * k;
          const tipY = y + L * (i === 0 ? 0.92 : 0.78);
          const w0 = trunkW * (i === 0 ? 0.62 : 0.5);
          const w1 = w0 * 0.34;
          // 太さの変わる帯として描く（stroke ではなく面）
          g += path(
            `M${n(x + i * 2 * k - w0)} ${n(y - 8 * k)}` +
            `C${n(x + i * 5 * k - w0 * 0.8)} ${n(y + L * 0.3)} ${n(tipX - w1 * 1.6)} ${n(tipY - L * 0.34)} ${n(tipX - w1)} ${n(tipY)}` +
            `L${n(tipX + w1)} ${n(tipY)}` +
            `C${n(tipX + w1 * 1.6)} ${n(tipY - L * 0.34)} ${n(x + i * 5 * k + w0 * 0.8)} ${n(y + L * 0.3)} ${n(x + i * 2 * k + w0)} ${n(y - 8 * k)}Z`,
            { fill: mix(footFill, c.leafDark, 0.28), stroke: c.inkPaint, width: ctx.strokeW * 0.92, linejoin: 'round' },
          );
        }
        // 付け根の塊（体と根をつなぐ）
        g += ellipse(x, y - 7 * k, 11 * k, 8 * k, {
          fill: mix(footFill, c.leafDark, 0.18),
          stroke: c.inkPaint,
          width: ctx.strokeW,
          linejoin: 'round',
        });
        g += ellipse(x - 2 * k, y - 9 * k, 5 * k, 3 * k, { fill: lighten(c.body, 0.3), opacity: 0.55 });
        b = { x: x - 14 * k, y: y - 16 * k, w: 28 * k, h: L + 18 * k };
        break;
      }
      case 'stub':
      default: {
        // ちょこあし: 体から続く短い足。付け根を体へ深く差し込む。
        const rx = 10.5 * k;
        const ry = 7.5 * k;
        g += path(
          `M${n(x - rx * 0.72)} ${n(y - ry * 2.4)}` +
          `C${n(x - rx * 1.02)} ${n(y - ry * 0.5)} ${n(x - rx)} ${n(y + ry * 0.6)} ${n(x - rx * 0.7)} ${n(y + ry * 0.86)}` +
          `C${n(x - rx * 0.3)} ${n(y + ry * 1.12)} ${n(x + rx * 0.3)} ${n(y + ry * 1.12)} ${n(x + rx * 0.7)} ${n(y + ry * 0.86)}` +
          `C${n(x + rx)} ${n(y + ry * 0.6)} ${n(x + rx * 1.02)} ${n(y - ry * 0.5)} ${n(x + rx * 0.72)} ${n(y - ry * 2.4)}Z`,
          { fill: footFill, stroke: c.inkPaint, width: ctx.strokeW, linejoin: 'round' },
        );
        g += ellipse(x - rx * 0.22, y - ry * 0.1, rx * 0.42, ry * 0.34, {
          fill: lighten(c.body, 0.34),
          opacity: 0.6,
        });
        b = { x: x - rx - 1, y: y - ry * 2.5, w: rx * 2 + 2, h: ry * 3.7 };
        break;
      }
    }
    svg += g;
    bbox = boxUnion(bbox, b);
  }

  const fitted = shrinkToFit(svg, bbox, s.cx, s.botY - 10, VIEW, 2);
  return [
    {
      id: 'feet',
      z: Z.FEET,
      svg: fitted.svg,
      anchor: { id: 'feet', x: s.cx, y: baseY, angle: 0, scale: k },
      bbox: fitted.bbox,
    },
  ];
}

// ─────────────────────────────────────────────────────────

export function buildTail(ctx: DrawCtx): PartOut[] {
  const kind = ctx.parts.tail;
  if (!kind || kind === 'none') return [];
  const s = ctx.shape;
  const c = ctx.colors;
  // 尾は体の一部なので色相を本体 ±30 度に収め、塗りも本体と同じ
  // 光源方向のグラデにする。フラット塗りのままだと本体だけが立体で、
  // 尾が別の絵から切り貼りしたシールに見える（ビジュアル批評 P2-12）。
  const tacc = harmonize(c.body, c.accent, 30);
  const rng = ctx.rng('tail');
  const k = clamp(0.85 + ctx.pheno.size * 0.22 + ctx.pheno.decorAmount * 0.14, 0.82, 1.2);
  // 尾は右側に出す。個体差で左に出ることもある。
  const side = rng.bool(0.28) ? -1 : 1;
  const ay = s.topY + (s.botY - s.topY) * (s.base === 'yurei' ? 0.66 : 0.74);
  const ax = s.edgeX(ay, side) - side * 4;
  // viewBox 内に確実に収まる長さの上限。体が大きい個体ほど尾は短くなる。
  const room = Math.max(14, side > 0 ? 193 - ax : ax - 7);
  const fit = (nominal: number, reach: number): number => Math.min(nominal, room / reach);
  let svg = '';
  let bbox: Box = { x: ax - 4, y: ay - 4, w: 8, h: 8 };

  const ext = (b: Box): void => {
    bbox = boxUnion(bbox, b);
  };

  switch (kind) {
    case 'stub': {
      const r = fit(11 * k, 1.7);
      svg += ellipse(ax + side * r * 0.55, ay, r, r * 0.86, {
        fill: organGrad(ctx, 'tailstub', c.body),
        stroke: c.inkPaint,
        width: ctx.strokeW,
        linejoin: 'round',
      });
      svg += ellipse(ax + side * r * 0.5, ay - r * 0.3, r * 0.42, r * 0.3, {
        fill: lighten(c.body, 0.32),
        opacity: 0.7,
      });
      ext({ x: ax + side * r * 0.55 - r, y: ay - r, w: r * 2, h: r * 2 });
      break;
    }
    case 'fluff': {
      /**
       * ふさふさ丸尾: 体の背面から続く、丸く大きな毛束の尾。
       *
       * 根元を体の内側へ食い込ませ、体を描く前の Z 層に置くことで、
       * 横へ貼った円ではなく「背中から生えた尾」に見せる。
       * 外周はわずかな毛束の山谷だけに抑え、縮小時も丸い塊として読めるようにする。
       */
      // 通常の細い尾と同じ `ax` をそのまま根元にすると、体の外へ出る
      // 数十 px しか残らず、丸尾が「小さなひれ」に縮んでしまう。
      // 根元を体の内側へ入れ、そのぶん尾の面を外へ広げる。
      const rootInset = Math.min(18 * k, Math.max(8, room * 0.55));
      const rootX = ax - side * rootInset;
      const tailRoom = Math.max(18, side > 0 ? 193 - rootX - 3 : rootX - 7);
      const L = Math.min(54 * k, tailRoom / 1.14);
      const H = L * 1.12;
      const ux = (u: number): number => rootX + side * u;
      const tailD =
        `M${n(ux(-2))} ${n(ay + H * 0.28)}` +
        `C${n(ux(2))} ${n(ay + H * 0.02)} ${n(ux(3))} ${n(ay - H * 0.5)} ${n(ux(L * 0.24))} ${n(ay - H * 0.74)}` +
        `C${n(ux(L * 0.3))} ${n(ay - H * 0.98)} ${n(ux(L * 0.36))} ${n(ay - H * 1.06)} ${n(ux(L * 0.42))} ${n(ay - H * 0.86)}` +
        `C${n(ux(L * 0.52))} ${n(ay - H * 1.02)} ${n(ux(L * 0.6))} ${n(ay - H * 1.02)} ${n(ux(L * 0.66))} ${n(ay - H * 0.82)}` +
        `C${n(ux(L * 0.82))} ${n(ay - H * 0.98)} ${n(ux(L * 0.98))} ${n(ay - H * 0.82)} ${n(ux(L * 0.94))} ${n(ay - H * 0.62)}` +
        `C${n(ux(L * 1.12))} ${n(ay - H * 0.46)} ${n(ux(L * 1.14))} ${n(ay - H * 0.2)} ${n(ux(L * 0.99))} ${n(ay - H * 0.06)}` +
        `C${n(ux(L * 1.12))} ${n(ay + H * 0.08)} ${n(ux(L * 1.05))} ${n(ay + H * 0.24)} ${n(ux(L * 0.9))} ${n(ay + H * 0.23)}` +
        `C${n(ux(L * 0.88))} ${n(ay + H * 0.43)} ${n(ux(L * 0.72))} ${n(ay + H * 0.52)} ${n(ux(L * 0.58))} ${n(ay + H * 0.36)}` +
        `C${n(ux(L * 0.42))} ${n(ay + H * 0.5)} ${n(ux(L * 0.2))} ${n(ay + H * 0.44)} ${n(ux(-2))} ${n(ay + H * 0.28)}Z`;
      const tailBase = harmonize(c.body, mix(c.bodyLight, c.accent, 0.18), 24);
      const band = mix(c.belly, c.paper, 0.14);
      svg += path(tailD, {
        fill: organGrad(ctx, 'tailfluff', tailBase),
        stroke: c.inkPaint,
        width: ctx.strokeW,
        linejoin: 'round',
      });
      // 斜めの淡色帯は外周の外へ出ないよう、尾のシルエットでクリップする。
      const clip = ctx.defs.add('tailfluffClip', (id) => `<clipPath id="${id}"><path d="${tailD}"/></clipPath>`);
      const bandD =
        `M${n(ux(L * 0.02))} ${n(ay + H * 0.22)}` +
        `C${n(ux(L * 0.24))} ${n(ay + H * 0.08)} ${n(ux(L * 0.5))} ${n(ay - H * 0.22)} ${n(ux(L * 0.86))} ${n(ay - H * 0.44)}`;
      svg += path(bandD, {
        stroke: band,
        width: H * 0.22,
        linecap: 'round',
        clip,
        opacity: 0.86,
      });
      // 毛束の向きを示す短い明るい筋を少数だけ入れる。
      for (let i = 0; i < 3; i++) {
        const u = L * (0.38 + i * 0.17);
        svg += path(
          `M${n(ux(u))} ${n(ay - H * (0.72 - i * 0.04))}` +
          `q${n(side * L * 0.06)} ${n(-H * 0.08)} ${n(side * L * 0.13)} ${n(-H * 0.03)}`,
          { stroke: lighten(tailBase, 0.2), width: ctx.strokeThin * 0.8, opacity: 0.42 },
        );
      }
      const x0 = Math.min(ux(-4), ux(L * 1.18));
      const x1 = Math.max(ux(-4), ux(L * 1.18));
      ext({ x: x0 - ctx.strokeW, y: ay - H * 1.1 - ctx.strokeW, w: x1 - x0 + ctx.strokeW * 2, h: H * 1.7 + ctx.strokeW * 2 });
      break;
    }
    case 'curl': {
      /**
       * 「くるん」＝ 渦を巻いた尾。
       *
       * 【直した理由】
       *   旧実装は 1 周未満（1.75π）の緩いカーブに、線幅 strokeW*2.4 の太い軸＋
       *   先端の丸い塊（塗り circle）を組み合わせていた。これが「円柱＋先端が
       *   丸い形」に読めてしまい、PO から下品だと指摘された（R3K4-BJHR,
       *   KL5S-EGKG。他の尾には同種の指摘なし）。
       *
       *   直し方の骨格：
       *    - 軸を細くする（線幅を約半分に）。
       *    - 先端の塊（circle）を廃止し、渦の芯へ半径そのものを収束させて
       *      自然にすぼめる。
       *    - 巻き数を 1 周半（2.5π）に増やし、「曲がった棒」ではなく
       *      明確に「渦」と分かる形にする。
       *    - 全長も短くする。
       *   円の中心を付け根から side 方向へ R0 だけ離した位置に置くことで、
       *   t=0 の点がちょうど付け根 (ax, ay) に一致し、t=1 で渦の中心
       *   （半径 0）へ収束する — 太さが最後まで変わらない棒にならない。
       */
      const L = fit(24 * k, 0.72);
      const R0 = L * 0.42;
      const turns = 2.5; // 巻き数（π 単位）。2.5π = 1.25 周。
      const cx = ax + side * R0;
      const cy = ay;
      const N = 22;
      const pts: Vec[] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const a = t * Math.PI * turns;
        const r = R0 * Math.pow(1 - t, 0.85);
        pts.push({ x: cx - side * Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      const d = pathOpen(pts);
      svg += path(d, { stroke: c.inkPaint, width: ctx.strokeW * 1.5, linecap: 'round' });
      // 塗りの線に本体色 harmonize 済みのアクセント tacc をわずかに混ぜて、
      // 「体の一部として色が続いている」印象を保つ（PO指摘の対応で塊は消したが、
      // 尾ごとの個性は色みで残す）。
      svg += path(d, { stroke: mix(c.body, tacc, 0.35), width: ctx.strokeW * 0.82, linecap: 'round' });
      ext(boxOf(pts, ctx.strokeW * 1.2));
      break;
    }
    case 'frond': {
      const L = fit(30 * k, 1.6);
      const base = { x: ax, y: ay };
      const pts: Vec[] = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        pts.push({ x: base.x + side * L * t, y: base.y - L * 0.42 * t * t });
      }
      svg += path(pathOpen(pts), { stroke: c.inkPaint, width: ctx.strokeW * 0.9 });
      for (let i = 1; i <= 4; i++) {
        const t = i / 5;
        const px = base.x + side * L * t;
        const py = base.y - L * 0.42 * t * t;
        const ll = L * 0.42 * (1 - t * 0.35);
        const frondCol = harmonize(c.body, mix(c.leafLight, c.accent, 0.3), 30);
        svg += path(leafPath(px, py, ll, ll * 0.4, side > 0 ? -40 : -140, 0.3), {
          fill: organGrad(ctx, 'tailfrond', frondCol),
          stroke: c.inkPaint,
          width: ctx.strokeThin * 0.95,
        });
        svg += path(leafVein(px, py, ll, side > 0 ? -40 : -140), {
          stroke: darken(frondCol, 0.4),
          width: ctx.strokeThin * 0.6,
          opacity: 0.7,
        });
      }
      ext({ x: ax - (side < 0 ? L + 14 * k : 6), y: ay - L * 0.8 - 14 * k, w: L + 20 * k, h: L + 18 * k });
      break;
    }
    case 'fin': {
      const L = fit(30 * k, 1.2);
      const d =
        `M${n(ax)} ${n(ay - 10 * k)}` +
        `C${n(ax + side * L * 0.8)} ${n(ay - L * 0.85)} ${n(ax + side * L * 1.1)} ${n(ay - L * 0.1)} ${n(ax + side * L * 0.72)} ${n(ay + L * 0.5)}` +
        `C${n(ax + side * L * 0.4)} ${n(ay + L * 0.2)} ${n(ax + side * L * 0.16)} ${n(ay + 6 * k)} ${n(ax)} ${n(ay + 8 * k)}Z`;
      const finCol = harmonize(c.body, mix(c.accent, c.belly, 0.3), 30);
      svg += path(d, {
        fill: organGrad(ctx, 'tailfin', finCol),
        fillOpacity: 0.88,
        stroke: c.inkPaint,
        width: ctx.strokeW * 0.9,
        linejoin: 'round',
      });
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        svg += path(
          `M${n(ax + side * 4)} ${n(ay - 6 * k + t * 12 * k)}q${n(side * L * 0.4)} ${n(-L * 0.16)} ${n(side * L * 0.62)} ${n(-L * 0.1 + t * L * 0.3)}`,
          { stroke: darken(finCol, 0.28), width: ctx.strokeThin * 0.8, opacity: 0.6 },
        );
      }
      ext({ x: ax - (side < 0 ? L * 1.15 : 4), y: ay - L * 0.9, w: L * 1.2 + 8, h: L * 1.5 });
      break;
    }
    case 'wisp': {
      const L = fit(36 * k, 1.4);
      const pts: Vec[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push({
          x: ax + side * L * t + Math.sin(t * 5.2) * 6 * k,
          y: ay + L * 0.3 * t - Math.sin(t * 3.1) * 5 * k,
        });
      }
      const d = pathOpen(pts);
      svg += path(d, { stroke: c.glow, width: ctx.strokeW * 2.6, opacity: 0.32, linecap: 'round' });
      svg += path(d, { stroke: mix(c.body, '#ffffff', 0.4), width: ctx.strokeW * 1.1, opacity: 0.8, linecap: 'round' });
      for (let i = 0; i < 3; i++) {
        const p = pts[3 + i * 2]!;
        svg += circle(p.x, p.y, (3.4 - i * 0.7) * k, { fill: c.glow, opacity: 0.55 });
      }
      ext({ x: ax - (side < 0 ? L + 10 : 6), y: ay - 14 * k, w: L + 16, h: L * 0.7 + 22 * k });
      break;
    }
    default:
      break;
  }

  if (!svg) return [];
  const fitted = shrinkToFit(svg, bbox, ax, ay, VIEW, 2);
  return [
    {
      id: 'tail',
      z: Z.TAIL_BACK,
      svg: fitted.svg,
      anchor: { id: 'tail', x: ax, y: ay, angle: side > 0 ? 0 : 180, scale: k },
      bbox: fitted.bbox,
    },
  ];
}

/** 足の接地位置（アニメーションの基準に使う）。 */
export const footY = (ctx: DrawCtx): number =>
  ctx.shape.grounded ? Math.min(ctx.shape.botY, GROUND_Y) : ctx.shape.botY + lerp(2, 6, 0.5);
