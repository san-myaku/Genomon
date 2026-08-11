/**
 * 発光の出かた（locus `lumin`）。
 *
 *   inner … 体の内側から光る（光源が体内にある）
 *   rim   … 輪郭の外側がにじむ（オーラ）
 *   mote  … 模様の粒だけが光る（星屑との組み合わせが主役）
 *
 * 強度は `Phenotype.glow`（RenderColors.glowAmt）が担う。
 * ここが決めるのは「どこがどう光るか」だけ。
 *
 * ─────────────────────────────────────────────────────────
 * 【明背景でも暗背景でも光って見せるための設計】
 *
 *   単純に白を feGaussianBlur で塗り足すと、暗背景では光るが
 *   紙（#f8efdf, L≈93）の上では白が白に溶けて **完全に消える**。
 *   これが「光っているように見えない」原因のほとんどを占める。
 *
 *   そこで光を 3 層で描く。
 *     芯   glowCore … ほぼ白（L94）。暗背景での「まぶしさ」を担う。
 *     中間 glowMid  … 鮮やか（L70）。明背景では **彩度** が光として読まれる。
 *     外縁 glowEdge … 濃く鮮やか（L56）。にじみの外側の締め。
 *
 *   さらに `inner` では光の外側で体をわずかに暗く落とす（ヴィネット）。
 *   明るい紙の上で「明るい面」を作るのは不可能に近いが、
 *   **まわりを暗くすれば中心は光って見える**。絵画の常道であり、
 *   明背景での発光表現はこれで初めて成立する。
 * ─────────────────────────────────────────────────────────
 */

import { mix } from '../../core/color.ts';
import { clamp, type Rng } from '../../core/rng.ts';
import { Z, type DrawCtx, type PartOut } from '../ctx.ts';
import { VIEW } from '../geom.ts';
import { circle, n, path, url, type Box } from '../svg.ts';

/** bbox を viewBox 内に収める（にじみは viewport で切られるので実害はない）。 */
function clampBox(b: Box): Box {
  const x0 = clamp(b.x, VIEW.x, VIEW.x + VIEW.w);
  const y0 = clamp(b.y, VIEW.y, VIEW.y + VIEW.h);
  const x1 = clamp(b.x + b.w, VIEW.x, VIEW.x + VIEW.w);
  const y1 = clamp(b.y + b.h, VIEW.y, VIEW.y + VIEW.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** 発光の実効強度 0..1。glow が低い個体でも形質としては読めるよう下駄を履かせる。 */
export function luminAmount(ctx: DrawCtx): number {
  return clamp(0.32 + ctx.colors.glowAmt * 0.68, 0, 1);
}

// ─────────────────────────────────────────────────────────
//  粒の発光（mote）— 模様側からも使う
// ─────────────────────────────────────────────────────────

export interface MoteInk {
  /** `lumin: 'mote'` が出ているか。 */
  on: boolean;
  core: string;
  mid: string;
  edge: string;
  /** 0..1。 */
  amt: number;
}

export function moteInk(ctx: DrawCtx): MoteInk {
  const c = ctx.colors;
  return {
    on: ctx.parts.lumin === 'mote',
    core: c.glowCore,
    mid: c.glowMid,
    edge: c.glowEdge,
    amt: luminAmount(ctx),
  };
}

/**
 * 1 粒ぶんの光。粒そのものの手前に重ねて使う。
 *
 * 外側から「淡い外縁 → 鮮やかな中間 → 白い芯」の 3 枚。
 * 芯を最後に置くので、粒の中心はどんな背景でも白く抜ける。
 */
export function moteGlow(ink: MoteInk, x: number, y: number, r: number): string {
  const a = ink.amt;
  return (
    circle(x, y, r * 3.4, { fill: ink.edge, opacity: 0.1 + a * 0.12 }) +
    circle(x, y, r * 2.1, { fill: ink.mid, opacity: 0.16 + a * 0.2 }) +
    circle(x, y, r * 1.35, { fill: ink.mid, opacity: 0.24 + a * 0.26 }) +
    circle(x, y, r * 0.62, { fill: ink.core, opacity: 0.6 + a * 0.4 })
  );
}

/**
 * 粒を持つ模様か（`mote` が乗る先があるか）。
 *
 * `dapple`（まだら）は detail='full' では feTurbulence の 1 枚絵なので、
 * 個々の粒が要素として存在しない ＝ 光らせる先が無い。ここに含めてはいけない
 * （含めると『つぶあかり』を持つまだら個体だけ何も光らなくなる）。
 */
export function patternHasGrains(patternId: string): boolean {
  return /^(stardust|speckle|spots|dartPebble|bellySpots|spotsStripes)$/.test(patternId);
}

// ─────────────────────────────────────────────────────────
//  本体
// ─────────────────────────────────────────────────────────

/** ぼかしフィルタ（detail='full' のみ）。lite では空文字を返す。 */
function blurFilter(ctx: DrawCtx, name: string, sd: number): string {
  if (ctx.detail !== 'full') return '';
  return ctx.defs.add(name, (id) =>
    `<filter id="${id}" x="-55%" y="-55%" width="210%" height="210%">` +
    `<feGaussianBlur stdDeviation="${n(sd)}"/></filter>`,
  );
}

export function buildLumin(ctx: DrawCtx): PartOut[] {
  const kind = ctx.parts.lumin;
  if (!kind || kind === 'none') return [];
  const s = ctx.shape;
  const c = ctx.colors;
  const amt = luminAmount(ctx);
  const A = 0.52 + amt * 0.48;
  const H = s.botY - s.topY;
  const clip = ctx.bodyClip;
  const out: PartOut[] = [];
  const rng = ctx.rng(`lumin:${kind}`);

  // 体の外接矩形。radialGradient を objectBoundingBox で扱うための土台。
  const bx = s.cx - s.halfW - 4;
  const by = s.topY - 4;
  const bw = s.halfW * 2 + 8;
  const bh = H + 8;
  const bodyRect = (fill: string): string =>
    `<rect x="${n(bx)}" y="${n(by)}" width="${n(bw)}" height="${n(bh)}" fill="${fill}" clip-path="${url(clip)}"/>`;

  if (kind === 'inner') {
    // ── 体の外へ漏れる光（暗背景で効く）──────────────────
    const f = blurFilter(ctx, 'lumbi', 4 + amt * 5);
    out.push({
      id: 'luminBack',
      z: Z.GLOW,
      svg: f
        ? path(s.d, { fill: c.glowMid, opacity: 0.16 + amt * 0.26, extra: `filter="${url(f)}"` })
        : path(s.d, { stroke: c.glowMid, width: 5 + amt * 6, opacity: 0.2 + amt * 0.24 }),
      bbox: clampBox({ x: bx - 12, y: by - 12, w: bw + 24, h: bh + 24 }),
    });

    // ── 体の内側の光 ──────────────────────────────────
    // 光源の位置は個体差。腹のあたりに置くと生きものらしい。
    const lx = 0.5 + rng.float(-0.1, 0.1);
    const ly = 0.6 + rng.float(-0.1, 0.08);

    // (1) ヴィネット: 縁を落として中心を相対的に持ち上げる。明背景の要。
    const vig = ctx.defs.add('lumvig', (id) =>
      `<radialGradient id="${id}" cx="${n(lx * 100)}%" cy="${n(ly * 100)}%" r="76%">` +
      `<stop offset="0%" stop-color="${c.ink}" stop-opacity="0"/>` +
      `<stop offset="52%" stop-color="${c.ink}" stop-opacity="0"/>` +
      `<stop offset="100%" stop-color="${mix(c.bodyDark, c.ink, 0.45)}" stop-opacity="${n(0.42 * A)}"/>` +
      `</radialGradient>`,
    );
    // (2) 光そのもの
    const core = ctx.defs.add('lumcore', (id) =>
      `<radialGradient id="${id}" cx="${n(lx * 100)}%" cy="${n(ly * 100)}%" r="62%">` +
      `<stop offset="0%" stop-color="${c.glowCore}" stop-opacity="${n(0.92 * A)}"/>` +
      `<stop offset="16%" stop-color="${c.glowMid}" stop-opacity="${n(0.68 * A)}"/>` +
      `<stop offset="42%" stop-color="${c.glowMid}" stop-opacity="${n(0.34 * A)}"/>` +
      `<stop offset="72%" stop-color="${c.glowEdge}" stop-opacity="${n(0.12 * A)}"/>` +
      `<stop offset="100%" stop-color="${c.glowEdge}" stop-opacity="0"/>` +
      `</radialGradient>`,
    );
    out.push({
      id: 'luminInner',
      z: Z.BELLY + 2,
      svg: bodyRect(url(vig)) + bodyRect(url(core)),
      bbox: clampBox({ x: bx, y: by, w: bw, h: bh }),
    });
    return out;
  }

  if (kind === 'rim') {
    // ── 輪郭の外側のにじみ ────────────────────────────
    const f = blurFilter(ctx, 'lumrb', 3 + amt * 4);
    const layers = [
      { w: 15 + amt * 11, col: c.glowEdge, op: 0.14 * A },
      { w: 9 + amt * 6, col: c.glowMid, op: 0.24 * A },
      { w: 4.5 + amt * 3, col: c.glowCore, op: 0.42 * A },
    ];
    const aura = layers
      .map((l) => path(s.d, { stroke: l.col, width: l.w, opacity: l.op, linejoin: 'round' }))
      .join('');
    out.push({
      id: 'luminBack',
      z: Z.GLOW,
      svg: f ? `<g filter="${url(f)}">${aura}</g>` : aura,
      bbox: clampBox({ x: bx - 16, y: by - 16, w: bw + 32, h: bh + 32 }),
    });

    // ── 内側の縁光（どんな背景でも「縁が光っている」と読ませる）──
    // 中心を少しだけ沈めると縁の明るさが際立つ。
    const dip = ctx.defs.add('lumdip', (id) =>
      `<radialGradient id="${id}" cx="50%" cy="52%" r="72%">` +
      `<stop offset="0%" stop-color="${mix(c.bodyDark, c.ink, 0.4)}" stop-opacity="${n(0.2 * A)}"/>` +
      `<stop offset="66%" stop-color="${c.bodyDark}" stop-opacity="0"/>` +
      `<stop offset="100%" stop-color="${c.bodyDark}" stop-opacity="0"/>` +
      `</radialGradient>`,
    );
    out.push({
      id: 'luminRim',
      z: Z.TEXTURE + 2,
      svg:
        bodyRect(url(dip)) +
        path(s.d, { stroke: c.glowMid, width: ctx.strokeW * 3.2, opacity: 0.22 * A, clip }) +
        path(s.d, { stroke: c.glowCore, width: ctx.strokeW * 1.2, opacity: 0.62 * A, clip }),
      bbox: clampBox({ x: bx, y: by, w: bw, h: bh }),
    });
    return out;
  }

  // ── mote（つぶあかり）──────────────────────────────
  // 粒を持つ模様のときは pattern.ts が粒そのものを光らせるので、
  // ここでは全体をほんのり持ち上げるだけにする。
  // 粒を持たない模様のときは、この遺伝子が「出ていない」ように見えるので
  // 体の上に光る粒を自前で散らす。
  const ink = moteInk(ctx);
  const hasGrains = patternHasGrains(basePatternOf(ctx.parts.pattern));
  const f = blurFilter(ctx, 'lummb', 4 + amt * 3);
  out.push({
    id: 'luminBack',
    z: Z.GLOW,
    svg: f
      ? path(s.d, { fill: c.glowMid, opacity: 0.08 + amt * 0.14, extra: `filter="${url(f)}"` })
      : path(s.d, { stroke: c.glowMid, width: 4 + amt * 3, opacity: 0.14 + amt * 0.14 }),
    bbox: clampBox({ x: bx - 10, y: by - 10, w: bw + 20, h: bh + 20 }),
  });

  if (!hasGrains) {
    const cnt = Math.round(10 + amt * 12);
    let g = `<g clip-path="${url(clip)}">`;
    for (let i = 0; i < cnt; i++) {
      const p = sampleInBody(ctx, rng);
      const r = rng.float(0.9, 2.4) * (0.8 + ctx.pheno.patScale * 0.5);
      g += moteGlow(ink, p.x, p.y, r);
    }
    g += `</g>`;
    out.push({
      id: 'luminMote',
      z: Z.TEXTURE + 2,
      svg: g,
      bbox: clampBox({ x: bx, y: by, w: bw, h: bh }),
    });
  }
  return out;
}

/** 合成模様 ID から代表の基本模様を取り出す（`mote` の判定用）。 */
function basePatternOf(id: string): string {
  if (id === 'bellySpots') return 'spots';
  if (id === 'spotsStripes') return 'spots';
  if (id === 'bellyStripes') return 'stripes';
  if (id === 'bellyCow') return 'cow';
  return id;
}

/** 体の内側の点をひとつ引く。顔の中心は避ける。 */
function sampleInBody(ctx: DrawCtx, rng: Rng): { x: number; y: number } {
  const s = ctx.shape;
  const H = s.botY - s.topY;
  const face = ctx.face;
  for (let i = 0; i < 8; i++) {
    const y = s.topY + rng.float(0.06, 0.95) * H;
    const hw = s.halfAt(y);
    const x = s.cx + rng.float(-1, 1) * hw * 0.9;
    const dx = (x - face.cx) / Math.max(1, face.box.w * 0.4);
    const dy = (y - face.cy) / Math.max(1, face.box.h * 0.4);
    if (dx * dx + dy * dy > 1) return { x, y };
  }
  const y = s.topY + H * 0.86;
  return { x: s.cx + rng.float(-1, 1) * s.halfAt(y) * 0.7, y };
}
