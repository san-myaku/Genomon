/**
 * 耳・触角・角。
 *
 * 【貼り付けに見せないための工夫】
 *  - 付け根は輪郭より数 px 内側に置き、体の背面（Z.EAR_BACK）へ描く。
 *    体の塗りが付け根を覆うので、生えている接続になる。
 *  - 塗りは本体色、線は本体と同じ inkFor(body)・同じ線幅。
 *  - 付け根には本体色を暗くした短い影だけを落とす（体のクリップ内）。
 *    縁取りのある楕円を置くと全個体で同形になり「ネジ穴」に見える。
 *  - asymmetry が高い個体は角度と大きさをわずかにずらす。
 *
 * 【耳の輪郭を「全周」に引かない理由 — 製品オーナーの指摘で直した】
 *   耳は付け根を横切る直線で閉じた図形だった。その直線にも輪郭インクが
 *   乗るので、体と接する側にも黒枠が出る。人はそれを「体に貼り付けた
 *   別のパーツの縁」と読み、耳が浮いて見えていた
 *   （`A8BC-G7N4` `7UDK-894T`：耳の底辺にはっきり横線が出ていた）。
 *
 *   直し方は 2 つを組み合わせる。
 *     ① 付け根に **すそ（skirt）** を足して体の内側まで図形を伸ばす。
 *        背面パーツは `registerBodyMaskOut` で体内が切られるので、
 *        すそは体の輪郭ちょうどで切断される。切断面の上には
 *        Z.OUTLINE で体の輪郭が引き直されるため、継ぎ目は太いインク線に隠れる。
 *     ② 輪郭のパスを **開いたまま** 描き、塗りだけ閉じる。
 *        こうすると「付け根を横切る線」がそもそも存在しない。
 *   結果、耳の輪郭は体の輪郭へそのまま流れ込み、途切れも穴もできない。
 *
 *   すそを伸ばす向きは形ごとに違う（`EAR_ROOT_DIR`）。
 *   まみみ系は付け根が下にあるので「下＋内」、たれみみは付け根が上にあり
 *   下へ垂れるので「内（やや下）」。ローカル座標で一律に下へ伸ばすと
 *   たれみみだけ耳の内部へ伸びてしまい、体には届かない。
 */

import { darken, lighten, mix } from '../../core/color.ts';
import { clamp, lerp } from '../../core/rng.ts';
import { Z, type DrawCtx, type PartOut } from '../ctx.ts';
import { VIEW } from '../geom.ts';
import { harmonize } from '../palette.ts';
import { organGrad, rootShade } from './body.ts';
import {
  boxUnion,
  circle,
  ellipse,
  leafPath,
  leafVein,
  n,
  path,
  pathOpen,
  polyPath,
  sampleOpen,
  shrinkToFit,
  type Box,
  type Vec,
} from '../svg.ts';

interface Local {
  svg: string;
  /** ローカル座標のおよその外接矩形（原点＝付け根、上が -y）。 */
  box: Box;
}

/** ローカル図形を付け根に配置し、グローバル bbox を推定する。 */
function place(loc: Local, ax: number, ay: number, angDeg: number, scl: number): { svg: string; bbox: Box } {
  const svg = `<g transform="translate(${n(ax)} ${n(ay)}) rotate(${n(angDeg)}) scale(${n(scl)})">${loc.svg}</g>`;
  const a = (angDeg * Math.PI) / 180;
  const co = Math.cos(a);
  const si = Math.sin(a);
  const corners: Vec[] = [
    { x: loc.box.x, y: loc.box.y },
    { x: loc.box.x + loc.box.w, y: loc.box.y },
    { x: loc.box.x, y: loc.box.y + loc.box.h },
    { x: loc.box.x + loc.box.w, y: loc.box.y + loc.box.h },
  ].map((p) => ({
    x: ax + (p.x * co - p.y * si) * scl,
    y: ay + (p.x * si + p.y * co) * scl,
  }));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of corners) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { svg, bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/**
 * 器官の色を本体色相へ引き寄せる。
 *
 * 【なぜ必要か】
 *   耳・角・尾の色を palette の accent（本体色相 ±160 度まで振れる）から
 *   そのまま取っていたため、桃色の体に緑の耳のような補色衝突が起きていた
 *   （ビジュアル批評 P2-12「別の絵から切り貼りしたシール」）。
 *   器官は体の一部なので、色相は本体 ±30 度に収める。
 *   彩度・明度の差は残すので「同色べた塗り」にはならない。
 */
function organTint(ctx: DrawCtx, hex: string): string {
  return harmonize(ctx.colors.body, hex, 30);
}

/**
 * 器官（耳・角）の面と輪郭を分けて描く。
 *
 * 【なぜ 1 本の `path` に fill と stroke を同時に指定してはいけないか — 実測】
 *   SVG の stroke は輪郭線の **中心** に置かれるので、線幅 w のとき
 *   図形の内側を w/2 だけ食う。角や耳の先端は幅が 0 に収束するので、
 *   先端から「幅が w になる高さ」までは **塗りが 1px も残らず、
 *   全部インク色の塊になる**。
 *     `twin`（ふたつづの）… 先端 4〜5px が真っ黒
 *     `budHorn`（つぼみづの）… 同上
 *   長さ 20〜26px の角にとって 4〜5px は 2 割で、
 *   「先の尖った角」ではなく「先が焦げた角」に見えていた。
 *
 * 【解き方】
 *   輪郭つきで一度描いたあと、**同じパスを塗りだけでもう一度重ねる**。
 *   線の内側半分が塗りに覆われるので、実効的に「外側だけの輪郭」になり、
 *   塗りは図形の輪郭ちょうどまで残る。先端でも塗りが消えない。
 *   見た目の線の太さを保つため、1 本目の線幅を 1.9 倍にしてある
 *   （外側に出るのは半分なので、結果は元の 0.95 倍）。
 */
function organShape(ctx: DrawCtx, d: string, fill: string, w: number, fillOpacity?: number): string {
  return (
    path(d, {
      fill,
      fillOpacity,
      stroke: ctx.colors.inkPaint,
      width: w * 1.9,
      linejoin: 'round',
    }) + path(d, { fill, fillOpacity })
  );
}

/**
 * 付け根の線を引かない版の `organShape`。
 *
 * `dOpen` は「付け根の始点 → 先端 → 付け根の終点」までの **開いた** パス。
 * 線はこの開いたパスにだけ引き、塗りは `Z` で閉じたものを使う。
 * 付け根を横切る辺は塗りの境界としてだけ存在し、インクは乗らない。
 *
 * 重ね順は `organShape` と同じ理由（先端が焦げないよう、線の内側半分を
 * 塗りで覆う）で「太い線 → 塗り」の順。
 */
function organShapeOpen(ctx: DrawCtx, dOpen: string, fill: string, w: number, fillOpacity?: number): string {
  return (
    path(dOpen, {
      stroke: ctx.colors.inkPaint,
      width: w * 1.9,
      linejoin: 'round',
      linecap: 'butt',
    }) + path(`${dOpen}Z`, { fill, fillOpacity })
  );
}

/**
 * 付け根に「すそ」を足した開いたパスを組み立てる。
 *
 * @param a      付け根の始点（ローカル座標）
 * @param arc    a から先端をまわって b へ至るパスコマンド（先頭の `M` は含まない）
 * @param b      付け根の終点（ローカル座標）
 * @param inw    体の内側へ向かう単位ベクトル（ローカル座標）
 * @param dip    すそを内側へ伸ばす長さ
 */
function rootedPath(a: Vec, arc: string, b: Vec, inw: Vec, dip: number): string {
  const sa = { x: a.x + inw.x * dip, y: a.y + inw.y * dip };
  const sb = { x: b.x + inw.x * dip, y: b.y + inw.y * dip };
  return `M${n(sa.x)} ${n(sa.y)}L${n(a.x)} ${n(a.y)}${arc}L${n(sb.x)} ${n(sb.y)}`;
}

// ─────────────────────────────────────────────────────────
//  耳
// ─────────────────────────────────────────────────────────

function earShape(ctx: DrawCtx, kind: string, k: number, inw: Vec): Local {
  const c = ctx.colors;
  const w = ctx.strokeW;
  const inner = organTint(ctx, mix(c.belly, c.accent, 0.3));
  // 本体と同じ「左上から光が当たる」グラデ。フラット塗りだと本体だけが
  // 立体で、耳がステッカーに見える（ビジュアル批評 P2-12）。
  const skin = organGrad(ctx, 'ear', c.body);
  // すそを体の内側へ伸ばす長さ。付け根は輪郭の 3.5px 内側にあるが、
  // 耳は傾いているので付け根の角（±bw）は体の **外** に出る。
  // 角から内側へ 18px 進めば、どの素体でも輪郭の内側に入る（実測で確認）。
  const dip = 18 * k;
  let s = '';

  switch (kind) {
    case 'nub': {
      const bw = 11.5 * k;
      const L = 15 * k;
      s += organShapeOpen(
        ctx,
        rootedPath(
          { x: -bw, y: 3 },
          `C${n(-bw * 1.05)} ${n(-L * 0.75)} ${n(-bw * 0.5)} ${n(-L)} 0 ${n(-L)}C${n(bw * 0.5)} ${n(-L)} ${n(bw * 1.05)} ${n(-L * 0.75)} ${n(bw)} 3`,
          { x: bw, y: 3 },
          inw,
          dip,
        ),
        skin,
        w,
      );
      s += ellipse(0, -L * 0.34, bw * 0.42, L * 0.3, { fill: inner, opacity: 0.6 });
      return { svg: s, box: { x: -bw - 2, y: -L - 2, w: bw * 2 + 4, h: L + 8 } };
    }
    case 'round': {
      const bw = 13 * k;
      const L = 27 * k;
      s += organShapeOpen(
        ctx,
        rootedPath(
          { x: -bw, y: 5 },
          `C${n(-bw * 1.16)} ${n(-L * 0.5)} ${n(-bw * 0.62)} ${n(-L)} 0 ${n(-L)}C${n(bw * 0.62)} ${n(-L)} ${n(bw * 1.16)} ${n(-L * 0.5)} ${n(bw)} 5`,
          { x: bw, y: 5 },
          inw,
          dip,
        ),
        skin,
        w,
      );
      s += path(
        `M${n(-bw * 0.56)} 2C${n(-bw * 0.7)} ${n(-L * 0.48)} ${n(-bw * 0.34)} ${n(-L * 0.76)} 0 ${n(-L * 0.78)}C${n(bw * 0.34)} ${n(-L * 0.76)} ${n(bw * 0.7)} ${n(-L * 0.48)} ${n(bw * 0.56)} 2Z`,
        { fill: inner, opacity: 0.75 },
      );
      return { svg: s, box: { x: -bw - 3, y: -L - 3, w: bw * 2 + 6, h: L + 10 } };
    }
    case 'longEar': {
      const bw = 8.5 * k;
      const L = 44 * k;
      s += organShapeOpen(
        ctx,
        rootedPath(
          { x: -bw, y: 5 },
          `C${n(-bw * 1.5)} ${n(-L * 0.5)} ${n(-bw * 0.8)} ${n(-L)} 0 ${n(-L)}C${n(bw * 0.8)} ${n(-L)} ${n(bw * 1.5)} ${n(-L * 0.5)} ${n(bw)} 5`,
          { x: bw, y: 5 },
          inw,
          dip,
        ),
        skin,
        w,
      );
      s += path(
        `M${n(-bw * 0.5)} 0C${n(-bw * 0.85)} ${n(-L * 0.5)} ${n(-bw * 0.45)} ${n(-L * 0.8)} 0 ${n(-L * 0.82)}C${n(bw * 0.45)} ${n(-L * 0.8)} ${n(bw * 0.85)} ${n(-L * 0.5)} ${n(bw * 0.5)} 0Z`,
        { fill: inner, opacity: 0.7 },
      );
      return { svg: s, box: { x: -bw * 1.5 - 2, y: -L - 3, w: bw * 3 + 4, h: L + 10 } };
    }
    case 'flopEar': {
      // 垂れ耳。外へ出てから下へ落ちる。
      // 付け根が **上** にある唯一の形なので、すその向きも他と違う
      //（`EAR_ROOT_DIR` を参照）。
      const L = 34 * k;
      const bw = 11 * k;
      s += organShapeOpen(
        ctx,
        rootedPath(
          { x: -bw * 0.7, y: 0 },
          `C${n(-bw * 1.5)} ${n(L * 0.34)} ${n(-bw * 1.2)} ${n(L * 0.86)} ${n(-bw * 0.1)} ${n(L)}C${n(bw * 1.1)} ${n(L * 0.9)} ${n(bw * 1.25)} ${n(L * 0.34)} ${n(bw * 0.72)} ${n(-4)}`,
          { x: bw * 0.72, y: -4 },
          inw,
          dip,
        ),
        skin,
        w,
      );
      s += path(
        `M${n(-bw * 0.34)} ${n(L * 0.12)}C${n(-bw * 0.85)} ${n(L * 0.42)} ${n(-bw * 0.62)} ${n(L * 0.76)} ${n(-bw * 0.05)} ${n(L * 0.85)}C${n(bw * 0.62)} ${n(L * 0.76)} ${n(bw * 0.7)} ${n(L * 0.4)} ${n(bw * 0.4)} ${n(L * 0.08)}Z`,
        { fill: inner, opacity: 0.65 },
      );
      return { svg: s, box: { x: -bw * 1.6, y: -6, w: bw * 3.2, h: L + 8 } };
    }
    case 'tuft': {
      const L = 26 * k;
      // 房の付け根も体の内側から始める。輪郭の外で線が始まると、
      // 毛束が宙に浮いた短い棒に見える。
      for (let i = -1; i <= 1; i++) {
        const ll = L * (1 - Math.abs(i) * 0.28);
        const x0 = i * 4 * k + inw.x * dip * 0.5;
        const y0 = 3 + inw.y * dip * 0.5;
        const d =
          `M${n(x0)} ${n(y0)}L${n(i * 4 * k)} 3q${n(i * 5 * k)} ${n(-ll * 0.6)} ${n(i * 9 * k)} ${n(-ll)}`;
        s += path(d, { stroke: c.inkPaint, width: ctx.strokeThin * 1.5 });
        s += path(d, { stroke: lighten(c.body, 0.2), width: ctx.strokeThin * 0.6 });
      }
      return { svg: s, box: { x: -14 * k, y: -L - 3, w: 28 * k, h: L + 8 } };
    }
    case 'leafEar': {
      const L = 32 * k;
      const wid = 11 * k;
      // 葉の耳も「体から生えた器官」なので色相を本体へ寄せる。
      // 純緑のままだと桃色の体に緑の耳が貼り付いて見える。
      const lf = organTint(ctx, c.leafLight);
      // 葉は付け根が **1 点に収束する** ので「付け根を横切る辺」が無い。
      // 代わりに、その 1 点が体の外に出ていると葉が浮いて見えていた。
      // 葉の起点を内側へ `dip` ずらし、長さも同じだけ足して
      // 先端の位置を変えずに付け根だけを体へ埋める。
      const ox = inw.x * dip;
      const oy = 2 + inw.y * dip;
      // 先端は元と同じ (0, -L)。起点だけ動かしたので長さと角度を引き直す。
      const dx = -ox;
      const dy = -L - oy;
      const len = Math.hypot(dx, dy);
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      // 起点を下げたぶん葉が細長くなるので、幅も同じ比で足して形を保つ。
      const wid2 = wid * (len / L);
      s += organShape(ctx, leafPath(ox, oy, len, wid2, ang, 0.34), organGrad(ctx, 'earleaf', lf), w * 0.92);
      s += path(leafVein(ox, oy, len, ang), {
        stroke: darken(lf, 0.34),
        width: ctx.strokeThin * 0.9,
        opacity: 0.8,
      });
      return { svg: s, box: { x: -wid - 3, y: -L - 3, w: wid * 2 + 6, h: L + 8 } };
    }
    case 'roundLeafEar': {
      // 共優性: まるみみの輪郭に葉の先端と葉脈が混ざる
      const bw = 12.5 * k;
      const L = 32 * k;
      s += organShapeOpen(
        ctx,
        rootedPath(
          { x: -bw, y: 5 },
          `C${n(-bw * 1.2)} ${n(-L * 0.46)} ${n(-bw * 0.72)} ${n(-L * 0.8)} 0 ${n(-L)}C${n(bw * 0.72)} ${n(-L * 0.8)} ${n(bw * 1.2)} ${n(-L * 0.46)} ${n(bw)} 5`,
          { x: bw, y: 5 },
          inw,
          dip,
        ),
        organGrad(ctx, 'earrl', organTint(ctx, mix(c.body, c.leafLight, 0.45))),
        w,
      );
      s += path(leafVein(0, 2, L, -90), { stroke: c.leafDark, width: ctx.strokeThin, opacity: 0.7 });
      for (let i = 1; i <= 3; i++) {
        const y = -L * (0.2 * i + 0.1);
        const ln = bw * 0.5 * (1 - i * 0.18);
        s += path(`M0 ${n(y)}l${n(-ln)} ${n(-ln * 0.5)}M0 ${n(y)}l${n(ln)} ${n(-ln * 0.5)}`, {
          stroke: c.leafDark,
          width: ctx.strokeThin * 0.7,
          opacity: 0.55,
        });
      }
      return { svg: s, box: { x: -bw - 3, y: -L - 3, w: bw * 2 + 6, h: L + 10 } };
    }
    default:
      return { svg: '', box: { x: 0, y: 0, w: 0, h: 0 } };
  }
}

const EAR_TILT: Record<string, number> = {
  nub: 24,
  round: 28,
  longEar: 16,
  // 【たれみみだけ符号が逆な理由 — 付け根の直しと一緒に見つけた】
  //   +38 度だと、耳のローカル下（＝垂れる向き）が
  //   グローバルでは「下＋**内**」を指す。つまり耳は頭の中へ垂れ、
  //   体マスクにほぼ全部食われて、輪郭の外に小さな瘤しか残らなかった。
  //   実物 9 体中 4 体で耳がまったく見えていない。
  //   -38 度にすると垂れる向きが「下＋外」になり、
  //   たれみみが本来の「頭の横に垂れた耳」として読める。
  flopEar: -38,
  tuft: 24,
  leafEar: 34,
  roundLeafEar: 30,
};

/**
 * 付け根のすそを伸ばす向き（**グローバル座標**・単位ベクトルでなくてよい）。
 * `x` は「体の中心へ向かう向き」を +1 として書く（左右で符号を掛ける）。
 *
 * ローカル座標で書けないのは、耳ごとに傾き（`EAR_TILT`）が違うため。
 * たとえば `round`（28 度）のローカル下は外へ 47% 逃げるので、
 * 素直に下へ伸ばすと体の外へ出てしまう個体が出る。
 * 「体のほうへ」はグローバルでしか定義できない。
 */
const EAR_ROOT_DIR: Record<string, Vec> = {
  // 付け根が下にある形（立ち耳）。下＋内へ潜らせる。
  nub: { x: 0.55, y: 1 },
  round: { x: 0.55, y: 1 },
  longEar: { x: 0.55, y: 1 },
  tuft: { x: 0.55, y: 1 },
  leafEar: { x: 0.55, y: 1 },
  roundLeafEar: { x: 0.55, y: 1 },
  // たれみみは付け根が **上** にあり、耳は下へ垂れる。
  // ここで下へ伸ばすと耳自身の内部へ潜るだけで体に届かないので、
  // ほぼ真横（内向き）に伸ばす。
  flopEar: { x: 1, y: 0.15 },
};

/**
 * すその向きを「グローバル」から「回転後のローカル」へ引き戻す。
 * `place()` は `rotate(angDeg)` を掛けるので、ローカル v は R(ang)·v で
 * グローバルになる。逆に必要なローカル方向は R(-ang)·g。
 */
function rootDirLocal(kind: string, side: number, angDeg: number): Vec {
  const g = EAR_ROOT_DIR[kind] ?? { x: 0.55, y: 1 };
  // side=+1（右耳）では体の中心は -x 方向。
  const gx = -side * g.x;
  const gy = g.y;
  const m = Math.hypot(gx, gy) || 1;
  const a = (angDeg * Math.PI) / 180;
  const co = Math.cos(a);
  const si = Math.sin(a);
  return { x: (gx * co + gy * si) / m, y: (-gx * si + gy * co) / m };
}

export function buildEars(ctx: DrawCtx): PartOut[] {
  const kind = ctx.parts.ears;
  if (!kind || kind === 'none') return [];
  const s = ctx.shape;
  const H = s.botY - s.topY;
  const yFrac = kind === 'flopEar' ? 0.18 : 0.12;
  const ay = s.topY + H * yFrac;
  const rng = ctx.rng('ears');
  const asym = ctx.pheno.asymmetry;
  const k = clamp(0.82 + ctx.pheno.size * 0.24 + ctx.pheno.decorAmount * 0.16, 0.8, 1.25);

  let svg = '';
  let bbox: Box | undefined;
  for (const side of [-1, 1]) {
    const ax = s.edgeX(ay, side) - side * 3.5;
    const jitterA = asym * rng.float(-9, 9);
    const jitterK = 1 + asym * rng.float(-0.11, 0.11);
    // すその向きは置いたあとの角度に依存するので、先に角度を決める。
    const ang = side * EAR_TILT[kind]! + jitterA * side;
    const loc = earShape(ctx, kind, k * jitterK, rootDirLocal(kind, side, ang));
    if (!loc.svg) continue;
    const p = place(loc, ax, ay, ang, 1);
    svg += p.svg;
    bbox = boxUnion(bbox, p.bbox);
  }

  const fitted = shrinkToFit(svg, bbox, s.cx, s.topY + H * 0.4, VIEW, 2);
  return [
    {
      id: 'ears',
      z: Z.EAR_BACK,
      svg: fitted.svg,
      anchor: { id: 'ears', x: s.cx, y: ay, angle: 0, scale: k },
      bbox: fitted.bbox,
    },
  ];
}

// ─────────────────────────────────────────────────────────
//  触角
// ─────────────────────────────────────────────────────────

/**
 * 触角の複雑な形状（櫛歯・帯）用に、実際に置いた点から bbox を集計する。
 *
 * 【なぜ要るか】
 *   `feather`（羽毛状）・`banded`（縞模様）は Catmull-Rom の軸に沿って
 *   多数の点を打つため、定数で書いた矩形では実際の外接矩形とずれやすい。
 *   ずれた bbox は `out-of-view` を見逃したり `shrinkToFit` を誤動作させたりする
 *   （指示書の自動検査を悪化させないという条件に直結する）ので、
 *   描画に使った座標そのものから最小外接矩形を作る。
 */
function boxTracker(): { add: (x: number, y: number) => void; box: (pad?: number) => Box } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  return {
    add(x: number, y: number): void {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    },
    box(pad = 2): Box {
      if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
      return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    },
  };
}

function antennaShape(ctx: DrawCtx, kind: string, k: number, side: number): Local {
  const c = ctx.colors;
  const tw = ctx.strokeThin * 1.35;
  // 触角の先の玉・葉も本体色相 ±30 度に収める。角だけ色相を寄せると
  // 「角は肌色・触角は紫」のようにかえって不統一になる。
  const tip = organTint(ctx, c.accent);
  const tipLeaf = organTint(ctx, c.leafLight);
  const full = ctx.detail === 'full';
  let s = '';
  const L = 26 * k;

  switch (kind) {
    case 'dot': {
      s += path(`M0 0q${n(side * 4 * k)} ${n(-L * 0.6)} ${n(side * 9 * k)} ${n(-L)}`, {
        stroke: c.inkPaint,
        width: tw,
      });
      s += circle(side * 9 * k, -L, 4.4 * k, {
        fill: organGrad(ctx, 'antdot', tip),
        stroke: c.inkPaint,
        width: tw * 0.9,
      });
      s += circle(side * 9 * k - 1.4 * k, -L - 1.4 * k, 1.4 * k, { fill: '#ffffff', opacity: 0.8 });
      return { svg: s, box: { x: Math.min(0, side * 15 * k), y: -L - 7 * k, w: 15 * k, h: L + 10 } };
    }
    case 'curl': {
      s += path(
        `M0 0C${n(side * 3 * k)} ${n(-L * 0.5)} ${n(side * 13 * k)} ${n(-L * 0.72)} ${n(side * 13 * k)} ${n(-L)}C${n(side * 13 * k)} ${n(-L * 1.25)} ${n(side * 3 * k)} ${n(-L * 1.2)} ${n(side * 5 * k)} ${n(-L * 0.95)}`,
        { stroke: c.inkPaint, width: tw },
      );
      return { svg: s, box: { x: Math.min(0, side * 16 * k), y: -L * 1.35, w: 16 * k, h: L * 1.4 } };
    }
    case 'feather': {
      // ガの触角（羽毛状）。参考: docs/screenshots/face/ref/ref-antenna-moth.png
      //
      // 【旧実装との違い】
      //   旧: 直線 1 本 + 3〜4 本のまばらな V 字ハネ。参考の「密で優美な羽根飾り」
      //   とは別物という指摘（製品オーナー）を受け、軸と櫛歯を作り直した。
      //     ・軸は Catmull-Rom の 5 節点で滑らかに外へ弧を描く
      //       （根元は立ち上がり、先端で大きく開く＝参考写真そのままの曲線）。
      //     ・軸を密にサンプリングし、各点の接線から法線を求めて
      //       その法線方向へ櫛歯を生やす。櫛歯は軸のどこでも軸に対して
      //       正しい向きになり、扇の形が崩れない。
      //     ・櫛歯の本数を 4→最大 14（軽量表示でも 8）へ増やし、
      //       長さは中央が最も長く両端でしぼむ密度分布（sin カーブ）にした。
      //       これで「まばらなブラシ」ではなく「羊歯のような羽根飾り」になる。
      //   左右対称は各触角自身がそれぞれ左右へ櫛歯を出すことで作る
      //   （このアンテナ 1 本の軸を中心に、櫛歯が両側へ生えている）。
      const Lf = 30 * k;
      const box = boxTracker();
      box.add(0, 0);
      const shaftPts: Vec[] = [
        { x: 0, y: 0 },
        { x: side * 2.6 * k, y: -Lf * 0.3 },
        { x: side * 7.4 * k, y: -Lf * 0.6 },
        { x: side * 12.2 * k, y: -Lf * 0.86 },
        { x: side * 14 * k, y: -Lf },
      ];
      const shaftD = pathOpen(shaftPts, 0.9);
      // 軸そのもの。ふさみみ（tuft）と同じ「インクの下敷き→色の細線」の
      // 二重掛けで、細い線でも輪郭が沈まないようにする。
      s += path(shaftD, { stroke: c.inkPaint, width: tw * 1.1 });
      s += path(shaftD, { stroke: tip, width: tw * 0.55 });

      // 軸を密にサンプリングし、実際に曲線が通る点から bbox と接線を取る。
      const samples = sampleOpen(shaftPts, full ? 12 : 7);
      for (const p of samples) box.add(p.x, p.y);
      const nTeeth = full ? 14 : 8;
      for (let i = 1; i < nTeeth; i++) {
        const t = i / nTeeth;
        const idx = clamp(Math.round(t * (samples.length - 1)), 0, samples.length - 2);
        const p0 = samples[idx]!;
        const p1 = samples[idx + 1]!;
        let tx = p1.x - p0.x;
        let ty = p1.y - p0.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        // 法線 = 接線を 90 度回したもの。ここが「櫛歯の向き」になる。
        const nx = -ty;
        const ny = tx;
        // 中央（t≈0.55）が最も長く、付け根・先端でしぼむ密度分布。
        // 実物は先端寄りがいちばん長いので、指数をわずかに歪めて片寄らせる。
        const env = Math.sin(Math.PI * Math.pow(t, 0.82));
        const bl = k * (2.4 + 7.6 * env);
        let d = '';
        for (const dir of [-1, 1]) {
          // 櫛歯は軸に垂直な方向へ伸ばしつつ、わずかに先端側へなびかせる
          // （実物の櫛歯は軸に対して直角ではなく、先端寄りへ軽くしなる）。
          const cx1 = p0.x + nx * dir * bl * 0.55 + tx * bl * 0.08;
          const cy1 = p0.y + ny * dir * bl * 0.55 + ty * bl * 0.08;
          const ex = p0.x + nx * dir * bl + tx * bl * 0.24;
          const ey = p0.y + ny * dir * bl + ty * bl * 0.24;
          d += `M${n(p0.x)} ${n(p0.y)}Q${n(cx1)} ${n(cy1)} ${n(ex)} ${n(ey)}`;
          box.add(cx1, cy1);
          box.add(ex, ey);
        }
        s += path(d, { stroke: c.inkPaint, width: tw * 0.48 });
        s += path(d, { stroke: tip, width: tw * 0.24 });
      }
      return { svg: s, box: box.box(3) };
    }
    case 'banded': {
      // 甲虫の触角（すじつの）。参考: docs/screenshots/face/ref/ref-antenna-beetle.png
      //
      // 【たまつき(dot) と別物にした理由】
      //   dot は「棒 1 本＋先端に球」。参考は「体からはみ出すほど長く弧を描き、
      //   明暗の色が交互に縞になる」触角で、形も色の使い方も別物。
      //   既存 dot の描画には触れず、ここに新設する。
      //
      // 【作り】
      //   ・軸は Catmull-Rom の 6 節点。根元はほぼ直立、中ほどから大きく
      //     外へ弧を描き、先端はわずかに巻き戻す（参考写真の「先が軽く
      //     お辞儀する」曲線）。dot/curl/feather よりずっと長い（35〜51px）。
      //   ・軸を密にサンプリングし、等分した区間ごとに色を交互（本体色寄りの
      //     明色 / インク色寄りの暗色）に塗り分けて「縞」を作る。
      //     直線の帯ではなく曲線に沿った帯にするため、区間の折れ線をそのまま
      //     stroke で引く。
      //   ・明るい帯にだけ薄いハイライトを重ねて艶を出す。
      //   ・節目に短い毛羽、先端に房を足して「毛の生えた長い触角」に寄せる。
      const Lb = 44 * k;
      const box = boxTracker();
      box.add(0, 2);
      const shaftPts: Vec[] = [
        { x: 0, y: 2 },
        { x: side * 3 * k, y: -Lb * 0.22 },
        { x: side * 11 * k, y: -Lb * 0.5 },
        { x: side * 21 * k, y: -Lb * 0.78 },
        { x: side * 27 * k, y: -Lb * 0.98 },
        { x: side * 25 * k, y: -Lb * 1.08 },
      ];
      const samples = sampleOpen(shaftPts, full ? 14 : 8);
      for (const p of samples) box.add(p.x, p.y);
      const nSeg = full ? 9 : 6;
      // 暗い帯は他の触角と同じ `c.inkPaint` をそのまま使う。
      //
      // 【`mix(c.inkPaint, ...)` にしてはいけない理由 — 実測で NaN を踏んだ】
      //   `inkPaint` はテーマ（明/暗）で切り替える CSS 変数の文字列
      //   （例: `var(--gm-ink,#3a2f28)`）で、16進 hex そのものではない。
      //   `mix()` は hex を前提に RGB へ分解するため、CSS 変数文字列を渡すと
      //   `#NaNNaNNaN` になり、SVG 全体が描画されずに自動検査が
      //   `bad-token:NaN` で落ちる（300 体中 3 体で実際に発生した）。
      //   計算に使ってよいのは `c.ink`（計算用の固定値）だけ、というのは
      //   `palette.ts` の `RenderColors.inkPaint` のコメントに明記されている。
      //   ここでは無理に混ぜず、他の触角と同じ「そのまま inkPaint」に揃える。
      //   参考写真の黒い帯とも素直に対応する。
      const darkBand = c.inkPaint;
      for (let seg = 0; seg < nSeg; seg++) {
        const i0 = Math.floor((seg / nSeg) * (samples.length - 1));
        const i1 = Math.floor(((seg + 1) / nSeg) * (samples.length - 1));
        const slice = samples.slice(i0, Math.max(i0 + 2, i1 + 1));
        if (slice.length < 2) continue;
        let d = `M${n(slice[0]!.x)} ${n(slice[0]!.y)}`;
        for (let j = 1; j < slice.length; j++) d += `L${n(slice[j]!.x)} ${n(slice[j]!.y)}`;
        // 根元は太く、先端に向かって細くなる（実物の触角と同じ先細り）。
        const wgt = lerp(1.55, 0.6, seg / (nSeg - 1)) * tw;
        const bandColor = seg % 2 === 0 ? tip : darkBand;
        s += path(d, { stroke: bandColor, width: wgt, linecap: 'round' });
        if (seg % 2 === 0) {
          s += path(d, { stroke: lighten(tip, 0.34), width: wgt * 0.28, opacity: 0.85 });
        }
        // 節ごとの毛羽。全部の節に足すとうるさいので、軽量表示では間引く。
        if (full || seg % 2 === 1) {
          const jp = slice[slice.length - 1]!;
          const jn = slice[Math.max(0, slice.length - 2)]!;
          let jx = jp.x - jn.x;
          let jy = jp.y - jn.y;
          const jl = Math.hypot(jx, jy) || 1;
          jx /= jl;
          jy /= jl;
          const px = -jy;
          const py = jx;
          const bl = 2.6 * k;
          const hx0 = jp.x - px * bl;
          const hy0 = jp.y - py * bl;
          const hx1 = jp.x + px * bl;
          const hy1 = jp.y + py * bl;
          s += path(`M${n(hx0)} ${n(hy0)}L${n(jp.x)} ${n(jp.y)}L${n(hx1)} ${n(hy1)}`, {
            stroke: c.inkPaint,
            width: tw * 0.4,
            opacity: 0.7,
          });
          box.add(hx0, hy0);
          box.add(hx1, hy1);
        }
      }
      // 先端の房。3 本のごく短い毛を扇状に開く。
      const tp = shaftPts[shaftPts.length - 1]!;
      const pp = shaftPts[shaftPts.length - 2]!;
      let dx = tp.x - pp.x;
      let dy = tp.y - pp.y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      for (const spread of [-0.55, 0, 0.55]) {
        const co = Math.cos(spread);
        const si = Math.sin(spread);
        const fx = dx * co - dy * si;
        const fy = dx * si + dy * co;
        const ex = tp.x + fx * 6 * k;
        const ey = tp.y + fy * 6 * k;
        s += path(`M${n(tp.x)} ${n(tp.y)}L${n(ex)} ${n(ey)}`, { stroke: c.inkPaint, width: tw * 0.4 });
        box.add(ex, ey);
      }
      return { svg: s, box: box.box(3) };
    }
    case 'stemA': {
      s += path(`M0 0q${n(side * 3 * k)} ${n(-L * 0.6)} ${n(side * 6 * k)} ${n(-L)}`, {
        stroke: darken(tipLeaf, 0.38),
        width: tw * 1.15,
      });
      s += path(leafPath(side * 6 * k, -L, 12 * k, 4.5 * k, side > 0 ? -46 : -134, 0.3), {
        fill: organGrad(ctx, 'antleaf', tipLeaf),
        stroke: c.inkPaint,
        width: ctx.strokeThin * 0.85,
      });
      return { svg: s, box: { x: Math.min(-6 * k, side * 20 * k), y: -L - 14 * k, w: 26 * k, h: L + 16 * k } };
    }
    default:
      return { svg: '', box: { x: 0, y: 0, w: 0, h: 0 } };
  }
}

/**
 * 触角と角が同じ個体で同時に発現しているか。
 *
 * 【なぜ要るか — 製品オーナー指摘（`KPGX-FNEX` `HLUD-ART6` `MK6U-TYVM` `23K3-FD29`）】
 *   触角は `topY + H*0.055` を軸±0.5、角は `topY + H*0.075` を軸±0.52 に
 *   付け根を置いていた。縦位置・横位置ともにほぼ同じ座標のため、
 *   両方が発現した個体では頭のてっぺんの同じ場所に必ず重なって描かれていた。
 *   片方だけ発現している個体（大多数）は既存の座標のままにしたいので、
 *   この判定が true のときだけ座標をずらす。
 */
function hasBothAntennaeAndHorns(ctx: DrawCtx): boolean {
  const h = ctx.parts.horns;
  const a = ctx.parts.antennae;
  return !!h && h !== 'none' && !!a && a !== 'none';
}

/**
 * 同時発現時だけ、触角の付け根をどれだけ中央へ寄せるか（横方向係数）。
 *
 * 【なぜ形ごとに値が要るか — 座標を離しただけでは足りなかった実測】
 *   付け根の位置をずらした直しのあと、製品オーナーから「まだ重なっている」
 *   という再指摘（Visual Lab）を受けて調べ直したところ、`banded`（すじつの）
 *   と `feather`（ふわり）だけ、座標を離しても軸の中ほどが角へ届いていた。
 *   原因は付け根の距離ではなく軸の長さそのもの:
 *     ・`banded` は軸長 44px（他の触角は 26px）で、根元から先端まで
 *       側方へ 27px も流れる。付け根をどれだけ離しても、軸の中間から先が
 *       角の生えている帯（頭頂の下寄り・外寄り）まで届いてしまう。
 *     ・`feather` は軸長 30px に加えて、軸の左右へ生える櫛歯が
 *       軸の外側さらに 2〜10px 張り出す。実効的な幅が軸そのものより広い。
 *   他の触角（`dot` `curl` `stemA`、軸長はいずれも 26px）は、既存の座標調整
 *   だけでほとんどの個体で重ならず、左右差（asymmetry）が強い一部の個体
 *   でだけ触れる程度だった（実測: n=16 中 1〜3 体）。
 *
 *   回転で外側へ振る直し方も試したが、軸の長い形は 20〜30 度回すだけで
 *   軸自身の外接矩形（斜めに寝た分）がかえって膨らみ、さらに左右差の
 *   揺れ（既存の `asymmetry * rng.float(-7,7)`）と足し合わさると
 *   **左右の触角どうしが頭頂で交差する**新しい破綻を実機で確認した
 *   （`A8BC-G7N4` で回転が最大 49 度に達し、左右の軸が X 字に交差した）。
 *   回転は角度が増えるほど副作用が急激に大きくなるため、ここでは使わない。
 *
 *   代わりに「軸が長い触角ほど、付け根をより中央へ寄せる」という
 *   位置だけの直しにした。軸の外側へのドリフト量（`banded`/`feather` の
 *   形状定義にある `side * 27k` 等）は付け根の位置に関わらず一定なので、
 *   付け根を中央側へ引くとカーブ全体が同じ量だけ内側へ平行移動し、
 *   角の帯（軸係数 0.72 で外側に置かれている）との距離が広がる。
 *   単独発現（`both` が false）の分岐には一切触れていないので、
 *   触角だけの個体の見た目はこの表に関係なく変わらない。
 */
const ANT_BOTH_AX_FACTOR: Record<string, number> = {
  dot: 0.3,
  curl: 0.3,
  feather: 0.2,
  stemA: 0.27,
  banded: 0.14,
};

/**
 * 同時発現時だけ、軸の長い触角にかける追加の縮小率。
 *
 * 【付け根を中央へ寄せるだけでは `banded` が足りなかった実測】
 *   `banded` は軸のドリフト（先端が付け根から側方へ最大 27px 流れる）が
 *   付け根の位置を中央へ寄せてもそのまま残る（形の定義そのものにある
 *   側方への流れなので、付け根をどれだけ動かしても長さは変わらない）。
 *   ドリフト量が付け根同士の間隔（`ANT_BOTH_AX_FACTOR` と角側の軸係数
 *   0.72 の差でできる間隔）より大きいままだと、軸の中ほどが必ず角の
 *   帯を超えてしまう。実測（n=16, `A8BC-G7N4` ほか）で `banded` は
 *   縮小なしだと 16 体中 10〜11 体で角と重なっていた。
 *
 *   そこで「同時発現のときだけ」`k`（触角全体の縮尺）を追加でわずかに
 *   縮める。長さもドリフト量も `k` に比例するので、他の座標をいじらず
 *   一律に縮小するだけで軸の届く範囲を狭められる。`feather` も軸長
 *   30px で同様の傾向があったため、弱めに同じ処置を足す。
 *   単独発現（`both` が false）では乗算しない（＝ 1 のまま）ので、
 *   触角だけの個体の大きさは変わらない。
 */
const ANT_BOTH_SCALE: Record<string, number> = {
  dot: 1,
  curl: 1,
  feather: 0.86,
  stemA: 1,
  banded: 0.66,
};

/**
 * 同時発現時だけ、角にさらに足す「外向き」の傾き（度）。
 *
 * 角は付け根が既に軸係数 0.72（触角の 2 倍以上）まで外側にあり、
 * 角自身の軸も短い（20〜30px）ため、触角ほど回転の副作用が出ない
 * （実測でも 10 度前後の追加回転で目立った交差は起きなかった）。
 * 単独発現時の角の傾き（`side * 11`）はそのまま残し、`both` のときだけ
 * この分を上乗せする。`spiral`（らせん）は形そのものが渦を巻きながら
 * 外側へ流れていくため、他の角より重なりにくいことを実測（n=16）で確認した。
 */
const HORN_BOTH_EXTRA_TILT: Record<string, number> = {
  // `budHorn` は先端のつぼみ（楕円、半径 5.2k）が軸の先よりさらに外側へ
  // 張り出すため、他の角より少し多めに振る（実測: `feather` の外側の
  // 櫛歯とだけ、まれに触れていた）。
  budHorn: 13,
  twin: 8,
  spiral: 2,
  crystalHorn: 8,
};

export function buildAntennae(ctx: DrawCtx): PartOut[] {
  const kind = ctx.parts.antennae;
  if (!kind || kind === 'none') return [];
  const s = ctx.shape;
  const H = s.botY - s.topY;
  // 角も発現している個体だけ、触角を頭頂へ引き上げ・中央へ寄せる。
  // 角は下（額寄り）・外（耳寄り）へ動かすので、これで上下・左右の
  // 両方向に間隔ができる（`buildHorns` 側のコメントも参照）。
  const both = hasBothAntennaeAndHorns(ctx);
  const ay = s.topY + H * (both ? 0.018 : 0.055);
  // `both` のときだけ、軸の長い触角ほど付け根を中央へ寄せる
  // （`ANT_BOTH_AX_FACTOR` のコメントを参照）。単独発現では従来どおり 0.5。
  const axFactor = both ? (ANT_BOTH_AX_FACTOR[kind] ?? 0.3) : 0.5;
  const rng = ctx.rng('antennae');
  const k = clamp(0.85 + ctx.pheno.size * 0.2, 0.85, 1.15);
  let svg = '';
  let bbox: Box | undefined;

  // `both` のときだけ、軸の長い触角の縮尺をさらに絞る
  // （`ANT_BOTH_SCALE` のコメントを参照）。単独発現では 1 なので無効。
  const bothScale = both ? (ANT_BOTH_SCALE[kind] ?? 1) : 1;

  // 付け根の影を先に敷く（体の座標系。器官の transform の外側で描く）。
  let shade = '';
  for (const side of [-1, 1]) {
    const ax = s.cx + side * s.halfAt(ay) * axFactor;
    const loc = antennaShape(ctx, kind, k * bothScale * (1 + ctx.pheno.asymmetry * rng.float(-0.12, 0.12)), side);
    if (!loc.svg) continue;
    const ang = ctx.pheno.asymmetry * rng.float(-7, 7);
    const p = place(loc, ax, ay, ang, 1);
    shade += rootShade(ctx, ax, ay, 6 * k, side * 0.5, 0.8);
    svg += p.svg;
    bbox = boxUnion(bbox, p.bbox);
  }
  const fitted = shrinkToFit(svg, bbox, s.cx, s.topY + H * 0.3, VIEW, 2);
  return [
    {
      id: 'antennae',
      z: Z.ANTENNA,
      svg: shade + fitted.svg,
      anchor: { id: 'antennae', x: s.cx, y: ay, angle: 0, scale: k },
      bbox: fitted.bbox,
    },
  ];
}

// ─────────────────────────────────────────────────────────
//  角
// ─────────────────────────────────────────────────────────

/**
 * 角の付け根も「全周の黒枠」をやめる。
 *
 * 【耳と同じ直しにできない理由】
 *   角は `Z.HORN`（70）＝ **体より手前** に描くので、体マスクが効かない。
 *   すそを伸ばしても体の上に重なって見えるだけで、切ってくれない。
 *   そこでここは
 *     ・付け根を横切る線を引かない（開いた輪郭）
 *     ・付け根を少しだけ（4px）体側へ伸ばして、塗りの境目を
 *       `rootShade` の暗いくぼみの中に落とす
 *   の 2 つで済ませる。角は幅が 10px 前後と細いので、
 *   耳のような 18px のすそは要らない。
 */
const HORN_DIP = 4;

function hornShape(ctx: DrawCtx, kind: string, k: number, side: number): Local {
  const c = ctx.colors;
  const w = ctx.strokeW * 0.86;
  // 角の色相も本体 ±30 度に制限し、塗りは本体と同じ光源方向のグラデにする。
  // 付け根のにじみ（本体色の radialGradient 円）は廃止した。
  // 体より手前に描かれるため、全個体で同じ明るい円が乗って
  // 「ネジ穴」「はげ」に見えていた（ビジュアル批評 P0-2）。
  const horn = organTint(ctx, mix(c.accent, c.belly, 0.35));
  const hornFill = organGrad(ctx, 'horn', horn);
  let s = '';

  switch (kind) {
    case 'budHorn': {
      const L = 20 * k;
      s += organShapeOpen(
        ctx,
        `M${n(-4.6 * k)} ${n(2 + HORN_DIP)}L${n(-4.6 * k)} 2C${n(-4.4 * k)} ${n(-L * 0.6)} ${n(-2.4 * k)} ${n(-L * 0.9)} 0 ${n(-L)}C${n(2.4 * k)} ${n(-L * 0.9)} ${n(4.4 * k)} ${n(-L * 0.6)} ${n(4.6 * k)} 2L${n(4.6 * k)} ${n(2 + HORN_DIP)}`,
        hornFill,
        w,
      );
      // つぼみ
      const bud = organTint(ctx, c.petal);
      s += ellipse(0, -L - 4.4 * k, 5.2 * k, 6.2 * k, {
        fill: organGrad(ctx, 'bud', bud),
        stroke: c.inkPaint,
        width: w * 0.85,
      });
      s += path(
        `M${n(-3.4 * k)} ${n(-L - 4.4 * k)}q${n(3.4 * k)} ${n(-5 * k)} ${n(6.8 * k)} 0`,
        { stroke: darken(bud, 0.22), width: ctx.strokeThin * 0.8 },
      );
      return { svg: s, box: { x: -8 * k, y: -L - 12 * k, w: 16 * k, h: L + 16 * k } };
    }
    case 'twin': {
      const L = 26 * k;
      s += organShapeOpen(
        ctx,
        `M${n(-4.8 * k)} ${n(2 + HORN_DIP)}L${n(-4.8 * k)} 2C${n(-5.4 * k)} ${n(-L * 0.5)} ${n(side * 3 * k)} ${n(-L * 0.8)} ${n(side * 6 * k)} ${n(-L)}C${n(side * 2 * k)} ${n(-L * 0.72)} ${n(4.6 * k)} ${n(-L * 0.42)} ${n(4.8 * k)} 2L${n(4.8 * k)} ${n(2 + HORN_DIP)}`,
        hornFill,
        w,
      );
      return { svg: s, box: { x: -9 * k, y: -L - 4 * k, w: 20 * k, h: L + 8 * k } };
    }
    case 'spiral': {
      const L = 30 * k;
      const pts: Vec[] = [];
      for (let i = 0; i <= 22; i++) {
        const t = i / 22;
        const r = 6.5 * k * (1 - t * 0.72);
        const a = t * Math.PI * 3.1;
        pts.push({ x: side * (Math.sin(a) * r + t * 7 * k), y: -t * L });
      }
      s += path(polyPath(pts, false), { stroke: c.inkPaint, width: w * 2.4, linecap: 'round' });
      s += path(polyPath(pts, false), { stroke: horn, width: w * 1.3, linecap: 'round' });
      return { svg: s, box: { x: -14 * k, y: -L - 5 * k, w: 28 * k, h: L + 8 * k } };
    }
    case 'crystalHorn': {
      const L = 26 * k;
      const pts: Vec[] = [
        { x: -5 * k, y: 2 },
        { x: -2.6 * k, y: -L * 0.55 },
        { x: side * 2 * k, y: -L },
        { x: 3.4 * k, y: -L * 0.45 },
        { x: 5 * k, y: 2 },
      ];
      const cr = organTint(ctx, c.crystal);
      s += organShapeOpen(
        ctx,
        polyPath(
          [{ x: pts[0]!.x, y: 2 + HORN_DIP }, ...pts, { x: pts[4]!.x, y: 2 + HORN_DIP }],
          false,
        ),
        organGrad(ctx, 'chorn', cr),
        w,
        0.92,
      );
      s += path(polyPath([pts[0]!, { x: side * 2 * k, y: -L }, pts[4]!], false), {
        stroke: lighten(cr, 0.4),
        width: ctx.strokeThin * 0.9,
        opacity: 0.9,
      });
      return { svg: s, box: { x: -8 * k, y: -L - 4 * k, w: 16 * k, h: L + 8 * k } };
    }
    default:
      return { svg: '', box: { x: 0, y: 0, w: 0, h: 0 } };
  }
}

export function buildHorns(ctx: DrawCtx): PartOut[] {
  const kind = ctx.parts.horns;
  if (!kind || kind === 'none') return [];
  const s = ctx.shape;
  const H = s.botY - s.topY;
  // 触角も発現している個体だけ、角を額寄り（下）・耳寄り（外）へ動かす。
  // 触角は上（頭頂）・中央へ動くので、これで重なりが解消する
  // （`hasBothAntennaeAndHorns` のコメントを参照）。
  const both = hasBothAntennaeAndHorns(ctx);
  const ay = s.topY + H * (both ? 0.135 : 0.075);
  const axFactor = both ? 0.72 : 0.52;
  const rng = ctx.rng('horns');
  const k = clamp(0.85 + ctx.pheno.size * 0.22 + ctx.pheno.decorAmount * 0.12, 0.82, 1.2);
  let svg = '';
  let bbox: Box | undefined;

  // 付け根の影。以前ここに置いていた「本体色の明るい円」は
  // 全個体で同形・同明度になり「ネジ穴」に見えていたので廃止した。
  let shade = '';
  for (const side of [-1, 1]) {
    const ax = s.cx + side * s.halfAt(ay) * axFactor;
    const loc = hornShape(ctx, kind, k * (1 + ctx.pheno.asymmetry * rng.float(-0.13, 0.13)), side);
    if (!loc.svg) continue;
    // `both` のときだけ追加の外向き回転を足す（`HORN_BOTH_EXTRA_TILT` を参照）。
    // 単独発現では 0 度で、既存の `side * 11` のみが効く＝見た目は変わらない。
    const bothTilt = both ? side * (HORN_BOTH_EXTRA_TILT[kind] ?? 0) : 0;
    const ang = side * 11 + bothTilt + ctx.pheno.asymmetry * rng.float(-8, 8);
    const p = place(loc, ax, ay, ang, 1);
    shade += rootShade(ctx, ax, ay, 8 * k, side * 0.6);
    svg += p.svg;
    bbox = boxUnion(bbox, p.bbox);
  }
  const fitted = shrinkToFit(svg, bbox, s.cx, s.topY + H * 0.35, VIEW, 2);
  return [
    {
      id: 'horns',
      z: Z.HORN,
      svg: shade + fitted.svg,
      anchor: { id: 'horns', x: s.cx, y: ay, angle: 0, scale: k },
      bbox: fitted.bbox,
    },
  ];
}

/** 装飾量に応じた飾りの縮尺（他パーツでも使う）。 */
export const decorScale = (ctx: DrawCtx): number =>
  clamp(lerp(0.86, 1.16, ctx.pheno.decorAmount) * (0.9 + ctx.pheno.size * 0.12), 0.8, 1.24);
