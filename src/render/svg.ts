/**
 * SVG 組み立てユーティリティ。
 *
 * 【設計方針】
 *  - 数値は必ず `n()` を通す。NaN / Infinity が SVG 文字列に混入すると
 *    ブラウザによっては要素まるごと描画されなくなり、原因追跡が難しい。
 *    `n()` は非有限値を 0 に潰し、小数 2 桁に丸めて文字列長も抑える。
 *  - グラデーション / フィルタ / クリップの id は必ず `Defs` 経由で作る。
 *    同一ページに 100 体並べるため、id 衝突は致命的（他個体のフィルタを拾う）。
 *  - 曲線は Catmull-Rom スプラインをベジエに変換して出す。制御点を並べるだけで
 *    「手描きのやわらかい輪郭」が得られるので、生きものの形と相性が良い。
 */

import { Rng, hashString } from '../core/rng.ts';

export interface Vec {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TAU = Math.PI * 2;

/** 小数 2 桁に丸める。非有限値は 0。 */
export function n(v: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const r = Math.round(v * 100) / 100;
  // -0 を 0 に正規化（"-0" という文字列が出るのを防ぐ）
  return r === 0 ? 0 : r;
}

export const vec = (x: number, y: number): Vec => ({ x, y });

/** 角度（度）→ ラジアン。 */
export const rad = (d: number): number => (d * Math.PI) / 180;

/** 楕円周上の点。角度は度、0 度が右、時計回りが正（SVG 座標系）。 */
export function onEllipse(cx: number, cy: number, rx: number, ry: number, angDeg: number): Vec {
  const a = rad(angDeg);
  return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
}

// ─────────────────────────────────────────────────────────
//  Catmull-Rom スプライン
// ─────────────────────────────────────────────────────────

function at(pts: readonly Vec[], i: number, closed: boolean): Vec {
  const N = pts.length;
  if (closed) return pts[((i % N) + N) % N]!;
  return pts[i < 0 ? 0 : i >= N ? N - 1 : i]!;
}

/**
 * Catmull-Rom を 3 次ベジエ列に変換したパス文字列。
 * tension 1 で標準の Catmull-Rom（1/6 係数）。小さくすると角ばる。
 */
function spline(pts: readonly Vec[], closed: boolean, tension: number): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${n(pts[0]!.x)} ${n(pts[0]!.y)}`;
  const k = tension / 6;
  let d = `M${n(pts[0]!.x)} ${n(pts[0]!.y)}`;
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(pts, i - 1, closed);
    const p1 = at(pts, i, closed);
    const p2 = at(pts, i + 1, closed);
    const p3 = at(pts, i + 2, closed);
    const c1x = p1.x + (p2.x - p0.x) * k;
    const c1y = p1.y + (p2.y - p0.y) * k;
    const c2x = p2.x - (p3.x - p1.x) * k;
    const c2y = p2.y - (p3.y - p1.y) * k;
    d += `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(p2.x)} ${n(p2.y)}`;
  }
  if (closed) d += 'Z';
  return d;
}

/** 閉じたなめらかな輪郭。 */
export const pathClosed = (pts: readonly Vec[], tension = 1): string => spline(pts, true, tension);

/** 開いたなめらかな線。 */
export const pathOpen = (pts: readonly Vec[], tension = 1): string => spline(pts, false, tension);

/** 直線で結んだパス。 */
export function polyPath(pts: readonly Vec[], closed = true): string {
  if (pts.length === 0) return '';
  let d = `M${n(pts[0]!.x)} ${n(pts[0]!.y)}`;
  for (let i = 1; i < pts.length; i++) d += `L${n(pts[i]!.x)} ${n(pts[i]!.y)}`;
  if (closed) d += 'Z';
  return d;
}

/** Catmull-Rom 上の点を評価（密なサンプリング用）。 */
function splinePoint(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/** 開いた Catmull-Rom を密にサンプリングする（輪郭上の座標を引くのに使う）。 */
export function sampleOpen(pts: readonly Vec[], per = 6): Vec[] {
  if (pts.length < 2) return pts.slice();
  const out: Vec[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(pts, i - 1, false);
    const p1 = at(pts, i, false);
    const p2 = at(pts, i + 1, false);
    const p3 = at(pts, i + 2, false);
    for (let s = 0; s < per; s++) out.push(splinePoint(p0, p1, p2, p3, s / per));
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

// ─────────────────────────────────────────────────────────
//  形の生成
// ─────────────────────────────────────────────────────────

/** 有機的な閉曲線（斑・苔・花びらの土台）。 */
export function blobPath(cx: number, cy: number, r: number, rng: Rng, wobble = 0.22, steps = 7): string {
  const pts: Vec[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    const rr = r * (1 + rng.float(-wobble, wobble));
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.94 });
  }
  return pathClosed(pts);
}

/** 葉の形（付け根 → 先端）。side で左右の反り。 */
export function leafPath(x0: number, y0: number, len: number, wid: number, angDeg: number, bend = 0.35): string {
  const a = rad(angDeg);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  const tipX = x0 + ux * len;
  const tipY = y0 + uy * len;
  const c1x = x0 + ux * len * 0.28 + nx * wid;
  const c1y = y0 + uy * len * 0.28 + ny * wid;
  const c2x = x0 + ux * len * 0.74 + nx * wid * (1 - bend);
  const c2y = y0 + uy * len * 0.74 + ny * wid * (1 - bend);
  const d1x = x0 + ux * len * 0.74 - nx * wid * (1 - bend) * 0.72;
  const d1y = y0 + uy * len * 0.74 - ny * wid * (1 - bend) * 0.72;
  const d2x = x0 + ux * len * 0.28 - nx * wid * 0.72;
  const d2y = y0 + uy * len * 0.28 - ny * wid * 0.72;
  return (
    `M${n(x0)} ${n(y0)}` +
    `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(tipX)} ${n(tipY)}` +
    `C${n(d1x)} ${n(d1y)} ${n(d2x)} ${n(d2y)} ${n(x0)} ${n(y0)}Z`
  );
}

/** 葉の主脈。 */
export function leafVein(x0: number, y0: number, len: number, angDeg: number): string {
  const a = rad(angDeg);
  return `M${n(x0)} ${n(y0)}L${n(x0 + Math.cos(a) * len * 0.86)} ${n(y0 + Math.sin(a) * len * 0.86)}`;
}

/** 星形（先端数 spikes）。 */
export function starPath(cx: number, cy: number, rOuter: number, rInner: number, spikes = 5, rot = -90): string {
  const pts: Vec[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rad(rot + (i * 360) / (spikes * 2));
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return polyPath(pts, true);
}

// ─────────────────────────────────────────────────────────
//  バウンディングボックス
// ─────────────────────────────────────────────────────────

export function boxOf(pts: readonly Vec[], pad = 0): Box {
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

export function boxAround(cx: number, cy: number, rx: number, ry = rx): Box {
  return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
}

export function boxUnion(a: Box | undefined, b: Box | undefined): Box {
  if (!a) return b ?? { x: 0, y: 0, w: 0, h: 0 };
  if (!b) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 2 つの矩形の重なり面積。 */
export function boxOverlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// ─────────────────────────────────────────────────────────
//  パス → ポリゴン（自動検査用）
// ─────────────────────────────────────────────────────────

/**
 * `M/C/L/Q/Z` だけで構成された閉じたパス文字列を折れ線に展開する。
 *
 * 【なぜ必要か】
 *   自動検査が bodyBox（外接矩形）だけを見ていたため、
 *   「まぶたの線が輪郭の外へ突き抜けている」「装飾が体に接していない」を
 *   1 件も検出できていなかった。矩形ではなく実際のシルエットで判定するには
 *   描画に使ったパスそのものが要る。ここはその展開器。
 *   （本モジュールが生成するパスは M/C/L/Q/A/Z しか使わないので、
 *     A だけは弦で近似する。検査用の精度としてはこれで足りる。）
 */
export function flattenPath(d: string, per = 8): Vec[] {
  const out: Vec[] = [];
  if (!d) return out;
  const tokens = d.match(/[MmLlCcQqAaZzHhVv]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return out;
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  const num = (): number => {
    const v = Number(tokens[i++]);
    return Number.isFinite(v) ? v : 0;
  };
  const push = (x: number, y: number): void => {
    out.push({ x, y });
  };
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i++;
    } else if (cmd === 'M') {
      cmd = 'L';
    } else if (cmd === 'm') {
      cmd = 'l';
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        cx = num() + ox;
        cy = num() + oy;
        sx = cx;
        sy = cy;
        push(cx, cy);
        break;
      }
      case 'L': {
        cx = num() + ox;
        cy = num() + oy;
        push(cx, cy);
        break;
      }
      case 'H': {
        cx = num() + ox;
        push(cx, cy);
        break;
      }
      case 'V': {
        cy = num() + oy;
        push(cx, cy);
        break;
      }
      case 'C': {
        const x1 = num() + ox;
        const y1 = num() + oy;
        const x2 = num() + ox;
        const y2 = num() + oy;
        const x3 = num() + ox;
        const y3 = num() + oy;
        for (let k = 1; k <= per; k++) {
          const u = k / per;
          const m = 1 - u;
          push(
            m * m * m * cx + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u * x3,
            m * m * m * cy + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u * y3,
          );
        }
        cx = x3;
        cy = y3;
        break;
      }
      case 'Q': {
        const x1 = num() + ox;
        const y1 = num() + oy;
        const x2 = num() + ox;
        const y2 = num() + oy;
        for (let k = 1; k <= per; k++) {
          const u = k / per;
          const m = 1 - u;
          push(m * m * cx + 2 * m * u * x1 + u * u * x2, m * m * cy + 2 * m * u * y1 + u * u * y2);
        }
        cx = x2;
        cy = y2;
        break;
      }
      case 'A': {
        // 弧は終点への直線で近似する（検査用途には十分）。
        num();
        num();
        num();
        num();
        num();
        cx = num() + ox;
        cy = num() + oy;
        push(cx, cy);
        break;
      }
      case 'Z': {
        cx = sx;
        cy = sy;
        push(cx, cy);
        break;
      }
      default:
        i++;
        break;
    }
  }
  return out.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** 点がポリゴン内部にあるか（even-odd）。 */
export function pointInPoly(x: number, y: number, poly: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-9) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** 点からポリゴンの辺までの最短距離（内外は問わない）。 */
export function distToPoly(x: number, y: number, poly: readonly Vec[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : Infinity;
}

/** ポリゴンの外側にどれだけ出ているか（内側なら 0）。 */
export function outsideDepth(x: number, y: number, poly: readonly Vec[]): number {
  if (poly.length < 3) return 0;
  return pointInPoly(x, y, poly) ? 0 : distToPoly(x, y, poly);
}

// ─────────────────────────────────────────────────────────
//  defs 名前空間
// ─────────────────────────────────────────────────────────

export const url = (id: string): string => `url(#${id})`;

/**
 * 同一ページ内で衝突しない id を発行しつつ、defs 断片を集める入れ物。
 * `add()` は同じ名前で二度呼ばれても 1 回しか登録しない。
 */
export class Defs {
  private readonly items: string[] = [];
  private readonly seen = new Set<string>();

  constructor(readonly uid: string) {}

  id(name: string): string {
    return `${this.uid}_${name}`;
  }

  add(name: string, make: (id: string) => string): string {
    const id = this.id(name);
    if (!this.seen.has(id)) {
      this.seen.add(id);
      this.items.push(make(id));
    }
    return id;
  }

  toString(): string {
    return this.items.join('');
  }
}

/** seed から短くて衝突しにくい uid を作る（決定論的）。 */
export function makeUid(seed: string, salt = ''): string {
  const h1 = hashString(`${seed}#uid#${salt}`).toString(36);
  const h2 = hashString(`${seed}#uid2#${salt}`).toString(36).slice(0, 4);
  return `g${h1}${h2}`;
}

// ─────────────────────────────────────────────────────────
//  よく使う断片
// ─────────────────────────────────────────────────────────

export interface StrokeOpts {
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  width?: number;
  opacity?: number;
  linecap?: 'round' | 'butt' | 'square';
  linejoin?: 'round' | 'miter' | 'bevel';
  clip?: string;
  extra?: string;
}

/** path 要素を組み立てる。undefined の属性は出力しない。 */
export function path(d: string, o: StrokeOpts = {}): string {
  if (!d) return '';
  let s = `<path d="${d}"`;
  s += ` fill="${o.fill ?? 'none'}"`;
  if (o.fillOpacity !== undefined && o.fillOpacity < 1) s += ` fill-opacity="${n(o.fillOpacity)}"`;
  if (o.stroke) {
    s += ` stroke="${o.stroke}" stroke-width="${n(o.width ?? 2)}"`;
    s += ` stroke-linecap="${o.linecap ?? 'round'}" stroke-linejoin="${o.linejoin ?? 'round'}"`;
  }
  if (o.opacity !== undefined && o.opacity < 1) s += ` opacity="${n(o.opacity)}"`;
  if (o.clip) s += ` clip-path="${url(o.clip)}"`;
  if (o.extra) s += ` ${o.extra}`;
  return `${s}/>`;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, o: StrokeOpts = {}): string {
  let s = `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(Math.max(0, rx))}" ry="${n(Math.max(0, ry))}"`;
  s += ` fill="${o.fill ?? 'none'}"`;
  if (o.fillOpacity !== undefined && o.fillOpacity < 1) s += ` fill-opacity="${n(o.fillOpacity)}"`;
  if (o.stroke) s += ` stroke="${o.stroke}" stroke-width="${n(o.width ?? 2)}"`;
  if (o.opacity !== undefined && o.opacity < 1) s += ` opacity="${n(o.opacity)}"`;
  if (o.clip) s += ` clip-path="${url(o.clip)}"`;
  if (o.extra) s += ` ${o.extra}`;
  return `${s}/>`;
}

export function circle(cx: number, cy: number, r: number, o: StrokeOpts = {}): string {
  return ellipse(cx, cy, r, r, o);
}

/** グループで囲う。transform が空なら素通し。 */
export function group(inner: string, transform?: string, extra?: string): string {
  if (!inner) return '';
  const t = transform ? ` transform="${transform}"` : '';
  const e = extra ? ` ${extra}` : '';
  return `<g${t}${e}>${inner}</g>`;
}

/**
 * bbox が viewBox からはみ出す場合に、指定中心で縮小して収める安全網。
 * 形状パラメータ側で収まるよう設計してあるので、実際に効くのは極端な個体のみ。
 * scale は既定で最小 0.72 までに制限する（それ以上潰すとパーツが読めなくなるため）。
 *
 * 【`minK` を呼び出し側で選べるようにした理由 — 羽の大きさ形質】
 *   `wingSize` 遺伝子座（最大 2.5 倍）を足したことで、体が大きく羽の
 *   付け根の余白が狭い個体では、0.72 の下限でも viewBox に収まりきらず
 *   `inspectModel` の `out-of-view` に引っかかるケースが実測で見つかった。
 *   羽は「潰れても模様が読めなくなるほど繊細ではない」（触角や角の
 *   ような細い線一本の意匠と違い、面積のある翅なので多少縮んでも
 *   翅だと分かる）ため、羽の呼び出しだけ下限をさらに下げてよい。
 *   他のパーツ（触角・角・crystal・肢など）は既定の 0.72 のまま。
 */
export function shrinkToFit(
  svg: string,
  bbox: Box | undefined,
  cx: number,
  cy: number,
  view: Box,
  pad = 1,
  minK = 0.72,
): { svg: string; bbox: Box | undefined } {
  if (!svg || !bbox || bbox.w <= 0 || bbox.h <= 0) return { svg, bbox };
  const lo = { x: view.x + pad, y: view.y + pad };
  const hi = { x: view.x + view.w - pad, y: view.y + view.h - pad };
  let k = 1;
  const need = (edge: number, center: number, limit: number): void => {
    const d = edge - center;
    if (d === 0) return;
    const allowed = limit - center;
    if (Math.sign(d) !== Math.sign(allowed) || Math.abs(d) <= Math.abs(allowed)) return;
    k = Math.min(k, Math.abs(allowed / d));
  };
  need(bbox.x, cx, lo.x);
  need(bbox.x + bbox.w, cx, hi.x);
  need(bbox.y, cy, lo.y);
  need(bbox.y + bbox.h, cy, hi.y);
  if (k >= 0.999) return { svg, bbox };
  k = Math.max(k, minK);
  const nb: Box = {
    x: cx + (bbox.x - cx) * k,
    y: cy + (bbox.y - cy) * k,
    w: bbox.w * k,
    h: bbox.h * k,
  };
  return {
    svg: `<g transform="translate(${n(cx)} ${n(cy)}) scale(${n(k)}) translate(${n(-cx)} ${n(-cy)})">${svg}</g>`,
    bbox: nb,
  };
}

/** XML テキストのエスケープ。 */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
