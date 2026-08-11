/**
 * 卵の描画。
 *
 * 【設計判断 D-010「卵は成体を完全には予測させない」】
 *   参照する遺伝子座を意図的に絞り、しかも弱く反映する。
 *     地色      ← palette の色相を鈍らせたもの（彩度を落とし明度を上げる）
 *     緑の脈    ← plant 遺伝子座に非 none を「保因していれば」出やすい（発現不要）
 *     結晶質    ← crystal を保因していれば出やすい
 *     半透明    ← translucency
 *   形・突起・斑・内部の影・光沢は seed 由来の独立系列で決める。
 *   → 見た目からは「その形質が発現するか」までは分からない。
 *
 * 9 個並べて明確に違って見えることを最優先に、
 * 形（5 種）× 表面（4 種）× 模様（5 種）× 付属（脈/結晶/突起/苔）を組み合わせる。
 */

import type { BodyBase, Genotype, Phenotype, RenderDetail, RenderModel } from '../core/types.ts';
import { Rng, clamp, lerp } from '../core/rng.ts';
import { darken, hslToHex, inkFor, lighten, PAPER } from '../core/color.ts';
import { earthy, inkOnDark, inkThemeStyle } from './palette.ts';
import {
  Defs,
  blobPath,
  pathOpen,
  circle,
  ellipse,
  n,
  path,
  pathClosed,
  polyPath,
  starPath,
  url,
  type Vec,
} from './svg.ts';
import { GROUND_Y, VIEW } from './geom.ts';

type EggForm = 'classic' | 'round' | 'teardrop' | 'stubby' | 'tall';
const FORMS: readonly EggForm[] = ['classic', 'round', 'teardrop', 'stubby', 'tall'];

type EggSurface = 'matte' | 'glossy' | 'crystalline' | 'downy';
type EggMark = 'none' | 'speckle' | 'band' | 'stripe' | 'blotch' | 'swirl';

const HALF: Record<EggForm, readonly (readonly [number, number])[]> = {
  classic: [
    [0.0, 0.0], [0.32, 0.06], [0.66, 0.2], [0.9, 0.42], [1.0, 0.63],
    [0.94, 0.83], [0.68, 0.96], [0.32, 1.0], [0.0, 1.0],
  ],
  round: [
    [0.0, 0.0], [0.42, 0.05], [0.78, 0.2], [0.98, 0.44], [1.0, 0.6],
    [0.9, 0.82], [0.6, 0.97], [0.28, 1.0], [0.0, 1.0],
  ],
  // しずく型。
  //
  // 【上端の 2 点目を [0.2, 0.09] から広げた理由 — 実物で確認】
  //   閉じたスプライン（`pathClosed`）は上端 (0,0) で左右の側面が出会う。
  //   接線は水平になるが、そのすぐ次の点が幅 0.2W・高さ 0.09H では
  //   **47 度でいきなり下る**ので、太さ 3.1px の輪郭と合わさって
  //   丸みが潰れ、頂点が尖点として読まれていた
  //   （実測 `NGPT-US8Q` `UBJM-HZYU`：「にんにく」「レモン」）。
  //   幅を広げ、高さを詰めると、しずく型の細い上半分はそのままに
  //   頂点だけが丸くなる。
  teardrop: [
    [0.0, 0.0], [0.31, 0.07], [0.56, 0.26], [0.82, 0.48], [0.98, 0.68],
    [0.96, 0.86], [0.66, 0.98], [0.3, 1.0], [0.0, 1.0],
  ],
  stubby: [
    [0.0, 0.0], [0.44, 0.07], [0.82, 0.24], [1.0, 0.48], [1.0, 0.68],
    [0.9, 0.86], [0.58, 0.98], [0.26, 1.0], [0.0, 1.0],
  ],
  tall: [
    [0.0, 0.0], [0.28, 0.05], [0.6, 0.17], [0.86, 0.36], [0.98, 0.58],
    [0.94, 0.8], [0.68, 0.95], [0.32, 1.0], [0.0, 1.0],
  ],
};

/**
 * 中の子のシルエット（正規化。原点は中心、幅・高さとも ±1）。
 *
 * 【なぜ描くのか】
 *   以前は殻の中央に「殻色から独立した無彩色の楕円」を 1 枚置いていただけで、
 *   シミ・カビにしか見えなかった（ビジュアル批評 P0-7）。
 *   素体だけが分かるぼんやりした影にすると、同じ面積を使って
 *   「中に何かいる」という期待に変わる。
 *   D-010「卵は成体を完全には予測させない」は守れる。
 *   分かるのは 3 系統のどれかだけで、形質・配色・装飾は読めない。
 */
const CHICK_HALF: Record<BodyBase, readonly (readonly [number, number])[]> = {
  // まる型: 上がやや細く下が重い種
  maru: [[0, -1], [0.36, -0.94], [0.74, -0.7], [0.97, -0.24], [1, 0.24], [0.86, 0.7], [0.52, 0.94], [0, 1]],
  // 幽霊型: 釣鐘。裾がゆるく広がる
  yurei: [[0, -1], [0.32, -0.95], [0.68, -0.72], [0.93, -0.32], [1, 0.1], [0.92, 0.52], [0.78, 0.86], [0, 1]],
  // スライム型: 細い天井から裾が最大幅まで広がる水滴
  slime: [[0, -1], [0.26, -0.9], [0.55, -0.62], [0.8, -0.2], [0.95, 0.26], [1, 0.66], [0.94, 0.92], [0, 1]],
};

function chickPath(base: BodyBase, cx: number, cy: number, rx: number, ry: number): string {
  const half = CHICK_HALF[base] ?? CHICK_HALF.maru;
  const pts: Vec[] = half.map(([hx, hy]) => ({ x: cx + hx * rx, y: cy + hy * ry }));
  for (const [hx, hy] of [...half].slice(1, -1).reverse()) {
    pts.push({ x: cx - hx * rx, y: cy + hy * ry });
  }
  return pathClosed(pts);
}

/** 遺伝子座に指定 ID 以外の対立遺伝子を保因しているか。 */
function carries(g: Genotype | null | undefined, locus: 'plant' | 'crystal'): number {
  if (!g) return 0;
  const pair = g.cat[locus];
  if (!pair) return 0;
  let cnt = 0;
  for (const a of pair) if (a && a !== 'none') cnt++;
  return cnt; // 0..2
}

export interface EggOpts {
  detail: RenderDetail;
  uid: string;
  genotype?: Genotype | null;
}

export function buildEggModel(pheno: Phenotype, opts: EggOpts): RenderModel {
  const uid = opts.uid;
  const defs = new Defs(uid);
  const root = new Rng(pheno.seed);
  const rShape = root.stream('egg:shape');
  const rSurf = root.stream('egg:surface');
  const rMark = root.stream('egg:mark');
  const rBump = root.stream('egg:bump');

  // ── 形 ────────────────────────────────────────────────
  const form = rShape.pick(FORMS);
  const size = clamp(0.86 + (pheno.size - 1) * 0.5 + rShape.float(-0.06, 0.06), 0.78, 1.12);
  const bottom = GROUND_Y - 1;
  const H = clamp(
    (form === 'tall' ? 152 : form === 'stubby' ? 124 : form === 'round' ? 134 : 142) * size,
    108,
    162,
  );
  const W = clamp(
    (form === 'stubby' ? 70 : form === 'tall' ? 53 : form === 'round' ? 65 : 59) * size,
    42,
    73,
  );
  const top = bottom - H;
  const cx = 100;

  const pts: Vec[] = [];
  const half = HALF[form];
  /**
   * 相対高さ ry における殻の半幅。
   * 突起や結晶を「輪郭のちょうど上」に置くために使う。
   * これを固定値（例 W*0.82）で近似すると、殻から浮いた輪や
   * 空中に刺さった三角形になって落書きに見えてしまう。
   */
  const halfAtRy = (ry: number): number => {
    const t = clamp(ry, 0, 1);
    for (let i = 1; i < half.length; i++) {
      const a0 = half[i - 1]!;
      const b0 = half[i]!;
      if (t >= a0[1] && t <= b0[1]) {
        const u = b0[1] === a0[1] ? 0 : (t - a0[1]) / (b0[1] - a0[1]);
        return lerp(a0[0], b0[0], u) * W;
      }
    }
    return 0;
  };
  const wob = rShape.float(0, Math.PI * 2);
  const place = (rx: number, ry: number, side: number): Vec => ({
    x: cx + side * rx * W * (1 + 0.035 * Math.sin(ry * 5.4 + wob)),
    y: top + ry * H,
  });
  for (const [rx, ry] of half) pts.push(place(rx, ry, 1));
  for (const [rx, ry] of half.slice(1, -1).reverse()) pts.push(place(rx, ry, -1));
  const d = pathClosed(pts);

  // ── 色（色相をわずかに鈍らせる）────────────────────────
  //
  // 【鈍らせる量を減らした理由】
  //   卵を成体よりやや落ち着いた色にするのは設計判断だが、
  //   彩度を 44%・明度を大きく持ち上げた結果、9 個並べると
  //   どれも同じ白っぽい灰色に見え、成体と「別の絵」になっていた。
  //   配色ファミリーが読める程度には残す。
  const hsl = pheno.palette.hsl ?? { h: 90, s: 40, l: 66 };
  const dullS = clamp(hsl.s * 0.72 + 8, 16, 54);
  const dullL = clamp(hsl.l * 0.66 + 26, 54, 82);
  const shellHue = (hsl.h + rShape.float(-12, 12) + 360) % 360;
  const shell = hslToHex(shellHue, dullS, dullL);
  const shellDark = darken(shell, 0.16);
  const shellLight = lighten(shell, 0.3);
  const ink = inkFor(shell);
  // 輪郭インクのテーマ切り替え。生きものと同じ仕組み（palette.ts の解説を参照）。
  const inkPaint = `var(--gm-ink,${ink})`;
  defs.add('inkvar', () => inkThemeStyle(uid, ink, inkOnDark(ink, shell)));
  const markCol = hslToHex(shellHue, clamp(dullS + 20, 18, 62), clamp(dullL - 26, 28, 58));
  // 中の子の影。無彩色にすると殻の上のシミに見えるので、
  // 殻の色相を保ったまま「暗く・彩度を上げた」色にする。
  const innerCol = hslToHex(shellHue, clamp(dullS + 16, 18, 58), clamp(dullL - 30, 24, 52));

  /**
   * 殻の「緯線」。u（-1..1）を殻の輪郭上に写した弧を返す。
   * 両端はちょうど輪郭に届き、中央ほど下へ垂れる。
   * これを使うと横帯が「巻き付いた帯」になり、直線バーに見えない。
   */
  const latitude = (ryC: number, sagN: number, steps = 18): Vec[] => {
    const pts: Vec[] = [];
    for (let i = 0; i <= steps; i++) {
      const u = -1 + (2 * i) / steps;
      const ryu = clamp(ryC + sagN * (1 - u * u), 0.015, 0.99);
      pts.push({ x: cx + u * halfAtRy(ryu) * 1.01, y: top + ryu * H });
    }
    return pts;
  };

  /** 殻の「経線」。u を固定して縦に走る線（縦の面割り・縦縞に使う）。 */
  const meridian = (u: number, ry0: number, ry1: number, steps = 14): Vec[] => {
    const pts: Vec[] = [];
    for (let i = 0; i <= steps; i++) {
      const ry = lerp(ry0, ry1, i / steps);
      pts.push({ x: cx + u * halfAtRy(ry), y: top + ry * H });
    }
    return pts;
  };

  // ── 表面 ──────────────────────────────────────────────
  const crystalCarry = carries(opts.genotype, 'crystal');
  const plantCarry = carries(opts.genotype, 'plant');
  const surfWeights: Record<EggSurface, number> = {
    matte: 24,
    glossy: 22,
    crystalline: 4 + crystalCarry * 22,
    downy: 14,
  };
  const surfKeys = Object.keys(surfWeights) as EggSurface[];
  const surface = rSurf.pickWeighted(surfKeys, surfKeys.map((k) => surfWeights[k]));
  const marks: readonly EggMark[] = ['none', 'speckle', 'band', 'stripe', 'blotch', 'swirl'];
  const mark = rMark.pickWeighted(marks, [10, 22, 16, 14, 18, 12]);

  const translucency = clamp(pheno.translucency, 0, 1);
  const glow = clamp(pheno.glow, 0, 1);

  const clip = defs.add('eclip', (id) => `<clipPath id="${id}"><path d="${d}"/></clipPath>`);
  const grad = defs.add('eg', (id) =>
    `<radialGradient id="${id}" cx="38%" cy="26%" r="84%">` +
    `<stop offset="0%" stop-color="${lighten(shellLight, 0.2)}"/>` +
    `<stop offset="56%" stop-color="${shell}"/>` +
    `<stop offset="100%" stop-color="${shellDark}"/></radialGradient>`,
  );

  const parts: RenderModel['parts'] = [];
  const push = (id: string, z: number, svg: string, bbox?: RenderModel['parts'][number]['bbox']): void => {
    if (svg) parts.push({ id, z, svg, bbox });
  };

  // 影
  push('shadow', 0, ellipse(cx, bottom + 3, W * 0.95, 6.5, { fill: ink, opacity: 0.16 }), {
    x: cx - W,
    y: bottom - 4,
    w: W * 2,
    h: 14,
  });

  // 発光
  if (glow > 0.3 && opts.detail === 'full') {
    const f = defs.add('eglow', (id) =>
      `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${n(3 + glow * 4)}"/></filter>`,
    );
    push('glow', 4, path(d, { fill: pheno.palette.glow ?? shellLight, opacity: 0.2 + glow * 0.3, extra: `filter="${url(f)}"` }));
  }

  // 根元の草。
  //
  // 【小さく・背面に置く理由】
  //   以前は卵と同じくらいの丈の草が殻の手前を横切っており、
  //   卵が草むらに埋もれて主役でなくなっていた（ビジュアル批評 P0-4）。
  //   z=6（殻 z=20 より奥）に置き、丈を 1/3 まで詰め、足元だけに散らす。
  if (plantCarry > 0 && rBump.bool(0.2 + plantCarry * 0.14)) {
    const leafCol = hslToHex(clamp(110 + rBump.float(-18, 18), 84, 150), rBump.float(30, 46), rBump.float(38, 50));
    const blades = rBump.int(3, 7);
    const spread = rBump.float(0.7, 1.2);
    const lean = rBump.float(-0.35, 0.35);
    let m = '';
    for (let i = 0; i < blades; i++) {
      const t = blades === 1 ? 0.5 : i / (blades - 1);
      const x = cx + lerp(-W * spread, W * spread, t) + rBump.float(-4, 4);
      const ln = rBump.float(3.5, 7);
      const ang = -90 + (t - 0.5 + lean) * rBump.float(70, 130);
      const a = (ang * Math.PI) / 180;
      m += path(
        `M${n(x)} ${n(bottom + 3)}q${n(Math.cos(a) * ln * 0.35)} ${n(Math.sin(a) * ln * 0.62)} ${n(Math.cos(a) * ln)} ${n(Math.sin(a) * ln)}`,
        { stroke: leafCol, width: rBump.float(1.8, 2.8), opacity: rBump.float(0.6, 0.92) },
      );
    }
    push('nest', 6, m, { x: cx - W * 1.4, y: bottom - 8, w: W * 2.8, h: 16 });
  }

  // 殻
  push(
    'shell',
    20,
    path(d, {
      fill: url(grad),
      fillOpacity: clamp(1 - translucency * 0.28, 0.66, 1),
      stroke: inkPaint,
      width: 3.1,
      linejoin: 'round',
    }),
    { x: cx - W, y: top, w: W * 2, h: H },
  );

  // 内部の影 ＝ 中の子のシルエット。
  //
  // 【灰色の円をやめた理由】
  //   以前は殻色から独立した無彩色の楕円を中央に 1 枚置いていたため、
  //   殻の表面のシミ・カビに見えていた（ビジュアル批評 P0-7）。
  //   殻の色相を保った暗色にし、輪郭をぼかし、形を素体のシルエットにする。
  //   「中に何かいる」という期待に変わり、同じ面積が意味を持つ。
  {
    const iy = top + H * 0.6;
    const ox = rMark.float(-3, 3);
    const soft =
      opts.detail === 'full'
        ? defs.add('einner', (id) =>
            `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">` +
            `<feGaussianBlur stdDeviation="${n(W * 0.075)}"/></filter>`,
          )
        : '';
    const sil = chickPath(pheno.base, cx + ox, iy, W * 0.46, H * 0.24);
    let m = `<g clip-path="${url(clip)}"${soft ? ` filter="${url(soft)}"` : ''}>`;
    m += path(sil, { fill: innerCol, opacity: 0.2 + translucency * 0.3 });
    // 頭の側をわずかに濃くして「向きのある塊」に見せる
    m += ellipse(cx + ox, iy - H * 0.09, W * 0.26, H * 0.1, {
      fill: innerCol,
      opacity: 0.14 + translucency * 0.22,
    });
    m += `</g>`;
    push('inner', 24, m);
  }

  // 模様
  {
    let m = `<g clip-path="${url(clip)}">`;
    switch (mark) {
      case 'speckle': {
        const cnt = Math.round(lerp(26, 64, pheno.patDensity));
        for (let i = 0; i < cnt; i++) {
          const ry = rMark.float(0.06, 0.97);
          const y = top + ry * H;
          const hw = W * Math.sin(Math.min(1, ry) * Math.PI * 0.94) ** 0.55;
          m += circle(cx + rMark.float(-hw, hw), y, rMark.float(1.2, 3.4), {
            fill: markCol,
            opacity: rMark.float(0.35, 0.72),
          });
        }
        break;
      }
      case 'band': {
        // 【直線バーをやめた理由】
        //   以前は「水平の Q 曲線を 1 本反らせただけ」で、しかも幅を
        //   W*1.15 の固定値にしていたため、殻の輪郭とは無関係な
        //   水平のベルトが数本渡っているだけに見えていた（ビジュアル批評 P0-8）。
        //   体の縞（parts/pattern.ts の stripes）と同じ考え方で、
        //   殻の正規化座標の上に置いて曲面に巻き付ける。
        //   帯の両端はその高さの輪郭にちょうど届き、中央ほど下へ垂れる。
        const cnt = rMark.int(2, 4);
        const base = rMark.float(0.22, 0.34);
        for (let i = 0; i < cnt; i++) {
          const ry = base + i * rMark.float(0.16, 0.22);
          if (ry > 0.9) break;
          // 垂れ具合。殻が丸いほど（＝その高さが太いほど）大きく垂れる。
          const sag = rMark.float(0.05, 0.085) * (halfAtRy(ry) / W);
          const th = rMark.float(0.035, 0.075);
          const upper = latitude(ry, sag);
          const lower = latitude(Math.min(0.97, ry + th), sag);
          m += path(polyPath([...upper, ...lower.reverse()]), {
            fill: markCol,
            opacity: rMark.float(0.42, 0.62),
          });
        }
        break;
      }
      case 'stripe': {
        // 縦縞。殻の経線に沿わせるので末広がりに湾曲する。
        const cnt = rMark.int(4, 7);
        for (let i = 0; i < cnt; i++) {
          const u0 = ((i + 0.5) / cnt - 0.5) * 2 * rMark.float(0.9, 1.06);
          const hw = rMark.float(0.06, 0.13);
          const left = meridian(u0 - hw, 0.02, 0.99);
          const right = meridian(u0 + hw, 0.02, 0.99);
          m += path(polyPath([...left, ...right.reverse()]), {
            fill: markCol,
            opacity: rMark.float(0.38, 0.6),
          });
        }
        break;
      }
      case 'blotch': {
        const cnt = rMark.int(4, 7);
        for (let i = 0; i < cnt; i++) {
          const ry = rMark.float(0.12, 0.9);
          const y = top + ry * H;
          const hw = W * 0.8;
          m += path(blobPath(cx + rMark.float(-hw, hw), y, rMark.float(7, 15), rMark, 0.3, 8), {
            fill: markCol,
            opacity: rMark.float(0.35, 0.6),
          });
        }
        break;
      }
      case 'swirl': {
        const turns = rMark.int(2, 3);
        const sp: Vec[] = [];
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          const a = t * Math.PI * 2 * turns;
          const rr = lerp(4, W * 0.9, t);
          sp.push({ x: cx + Math.cos(a) * rr, y: top + H * 0.55 + Math.sin(a) * rr * 0.8 });
        }
        m += path(polyPath(sp, false), { stroke: markCol, width: 3.4, opacity: 0.5 });
        break;
      }
      default:
        break;
    }
    m += `</g>`;
    push('mark', 28, m);
  }

  // 緑の脈（植物保因）
  //
  // 【落書き・棒に見せないための条件】
  //  1) 頻度を絞る … plant の none は 42% しかないので、保因判定だけだと
  //     8 割の卵に脈が出て「全部同じ卵」になる。ここで確率を大きく下げる。
  //  2) 低コントラスト … 地色に緑を薄く混ぜた色。殻の内側に透けている想定。
  //  3) 構造を持つ … 大きく傾いた主脈から、長い側脈が左右交互に分岐する。
  //     まっすぐな縦線＋短い枝だと「刺さった棒」にしか見えない。
  if (plantCarry > 0 && rBump.bool(0.16 + plantCarry * 0.14)) {
    // ── 脈の色を「混色」から「殻の色相を緑へ少し寄せる」に変えた ──────
    //
    // 【混色が「小枝」の正体だった — 実物で確認】
    //   以前は殻の色に **絶対的な緑**（hsl(112,35,42)）を 0.22〜0.34 混ぜていた。
    //   混色は 2 色の色相が離れているほど彩度が落ちるので、
    //   紫の殻（`NGPT-US8Q`）では結果が **灰茶** になり、
    //   幹と側枝を持つその形と合わさって「枯れた小枝が刺さっている」絵になった。
    //   暖色の殻でも同じ理屈で黄土色の枝になる。
    //   脈は殻の内側に透けている構造なので、**殻と同じ色相の暗い側**に
    //   わずかな緑みを足すのが正しい。色相の移動量に上限を置けば、
    //   どの配色でも灰にならず「透けて見えている」と読める。
    const eK = earthy(shellHue);
    /** `from` の色相を `to` へ、最大 `maxDeg` 度だけ寄せる。 */
    const hueToward = (from: number, to: number, maxDeg: number): number => {
      const d = (((to - from) % 360) + 540) % 360 - 180;
      return (from + clamp(d, -maxDeg, maxDeg) + 360) % 360;
    };
    // 暖色の殻では寄せ幅をさらに詰める（緑が補色として際立つため）。
    const veinHue = hueToward(shellHue, clamp(112 + rBump.float(-16, 16), 86, 152), lerp(26, 10, eK));
    const veinCol = hslToHex(veinHue, clamp(dullS + 6, 14, 52), clamp(dullL - 21, 26, 58));
    const veinLight = hslToHex(veinHue, clamp(dullS, 10, 44), clamp(dullL - 8, 34, 70));
    // ── 「卵の手前に立った草の茎」から抜ける ────────────────────
    //
    // 【何が起きていたか — 実物で確認】
    //   主脈の根元を殻の **最下端**（`bottom`）に置き、そこから頂点近くまで
    //   1 本の太い線（幅 3）で立ち上げていた。根元が輪郭に接しているので、
    //   人はそれを「殻の内側の構造」ではなく **殻の手前で地面から生えた茎**
    //   として読む（`V2XQ-HFWE` `SKBD-9YM2` は巣の草とつながって見えた）。
    //   1) 根元を殻の内側へ引き上げる（輪郭に触れさせない）
    //   2) 先端も殻の内側で止める
    //   3) 線を細く・淡くする。殻越しに透けているものは太く濃く見えない。
    let m = `<g clip-path="${url(clip)}">`;
    const side0 = rBump.bool(0.5) ? 1 : -1;
    const rootX = cx - side0 * W * rBump.float(0.2, 0.42);
    const tipX = cx + side0 * W * rBump.float(0.22, 0.44);
    const rootY = bottom - H * rBump.float(0.16, 0.26);
    const tipY = top + H * rBump.float(0.18, 0.32);
    const main: Vec[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      main.push({
        x: lerp(rootX, tipX, t * t * 0.7 + t * 0.3),
        y: rootY - t * (rootY - tipY),
      });
    }
    m += path(pathOpen(main), { stroke: veinCol, width: 2.1, opacity: 0.44 });
    m += path(pathOpen(main.slice(3)), { stroke: veinCol, width: 1.5, opacity: 0.44 });
    // 側脈。主脈と同じ向きへ大きく張り出させる（葉脈らしい構造）。
    const ribs = 6;
    for (let i = 0; i < ribs; i++) {
      const t = (i + 1) / (ribs + 1);
      const p2 = main[Math.min(8, Math.max(1, Math.round(t * 8)))]!;
      const side = i % 2 === 0 ? 1 : -1;
      const len = W * lerp(0.7, 0.26, t) * rBump.float(0.85, 1.15);
      m += path(
        `M${n(p2.x)} ${n(p2.y)}Q${n(p2.x + side * len * 0.55)} ${n(p2.y - len * 0.1)} ${n(p2.x + side * len)} ${n(p2.y - len * 0.55)}`,
        { stroke: veinCol, width: lerp(1.4, 0.8, t), opacity: 0.38 },
      );
      m += path(
        `M${n(p2.x + side * len * 0.45)} ${n(p2.y - len * 0.16)}q${n(side * len * 0.26)} ${n(-len * 0.3)} ${n(side * len * 0.4)} ${n(-len * 0.5)}`,
        { stroke: veinLight, width: 0.9, opacity: 0.34 },
      );
    }
    m += `</g>`;
    push('veins', 32, m);
  }

  // 表面質感
  {
    let m = '';
    switch (surface) {
      case 'glossy':
        m += ellipse(cx - W * 0.36, top + H * 0.26, W * 0.24, H * 0.13, {
          fill: '#ffffff',
          opacity: 0.72,
          clip,
        });
        m += ellipse(cx - W * 0.2, top + H * 0.42, W * 0.08, H * 0.045, { fill: '#ffffff', opacity: 0.5, clip });
        break;
      case 'crystalline': {
        // 【放射状（風車）をやめた理由】
        //   以前は殻の中心から扇形パスを 7 枚並べて「割れた面」を表していた。
        //   中心から放射する明暗のくさびと、殻面を横切る直線のシームが生まれ、
        //   ビーチボールにしか見えなかった（ビジュアル批評 P0-5）。
        //   放射をやめ、縦グラデ＋殻の経線に沿った面割り＋楕円ハイライトにする。
        //
        // 【突き出た結晶をやめた理由】
        //   五角形の面を殻の縁に置いていたが、四角と菱形の塊が突き出た
        //   幾何ブロックにしか見えず、殻に接触せず宙に浮く個体もあった
        //   （ビジュアル批評 P0-6・リードが実物で最も目立つ破綻と判断）。
        //   卵に成体の装飾めいた突起は出さない。表面の質感だけで表す。
        const vg = defs.add('ecryg', (id) =>
          `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>` +
          `<stop offset="42%" stop-color="#ffffff" stop-opacity="0.06"/>` +
          `<stop offset="100%" stop-color="${darken(shell, 0.42)}" stop-opacity="0.34"/>` +
          `</linearGradient>`,
        );
        m += `<g clip-path="${url(clip)}">`;
        m += `<rect x="${n(cx - W - 4)}" y="${n(top - 4)}" width="${n(W * 2 + 8)}" height="${n(H + 8)}" fill="${url(vg)}"/>`;
        // 殻の経線に沿った面割り。中心から放射させないので風車にならない。
        // 模様（縦縞）と二重に見えないよう、枚数を絞りコントラストも下げる。
        const facets = rSurf.int(2, 3);
        for (let i = 0; i < facets; i++) {
          const u0 = ((i + 0.5) / facets - 0.5) * 2 + rSurf.float(-0.08, 0.08);
          const wU = rSurf.float(0.2, 0.34);
          const left = meridian(clamp(u0 - wU, -1, 1), 0.02, 0.99);
          const right = meridian(clamp(u0 + wU, -1, 1), 0.02, 0.99);
          const bright = i % 2 === 0;
          m += path(polyPath([...left, ...right.reverse()]), {
            fill: bright ? '#ffffff' : darken(shell, 0.32),
            opacity: bright ? 0.13 : 0.08,
          });
        }
        m += `</g>`;
        // 楕円ハイライト（丸みを伝える唯一の光）
        m += ellipse(cx - W * 0.34, top + H * 0.24, W * 0.24, H * 0.12, {
          fill: '#ffffff',
          opacity: 0.6,
          clip,
        });
        m += ellipse(cx - W * 0.16, top + H * 0.39, W * 0.07, H * 0.04, {
          fill: '#ffffff',
          opacity: 0.44,
          clip,
        });
        break;
      }
      case 'downy': {
        m += `<g clip-path="${url(clip)}">`;
        for (let i = 0; i < 46; i++) {
          const ry = rSurf.float(0.03, 0.99);
          const y = top + ry * H;
          const hw = W * Math.sin(Math.min(1, ry) * Math.PI * 0.96) ** 0.5;
          const x = cx + rSurf.float(-hw, hw);
          m += path(`M${n(x)} ${n(y)}l${n(rSurf.float(-3, 3))} ${n(-rSurf.float(3, 6))}`, {
            stroke: lighten(shell, 0.5),
            width: 1.3,
            opacity: 0.6,
          });
        }
        m += `</g>`;
        m += ellipse(cx - W * 0.32, top + H * 0.26, W * 0.2, H * 0.1, { fill: '#ffffff', opacity: 0.35, clip });
        break;
      }
      default:
        m += ellipse(cx - W * 0.3, top + H * 0.24, W * 0.26, H * 0.12, { fill: '#ffffff', opacity: 0.3, clip });
        break;
    }
    push('surface', 36, m);
  }

  // 卵専用の付属表現は「小突起」と「ヒビ」の 2 つだけ。
  // 成体の耳・角のような幾何ブロックは一切出さない（ビジュアル批評 P0-6）。
  //
  // 突起。殻の縁からふくらんだ半球として描く。
  // 円を丸ごと描くと「殻の上に浮いた輪」になり、貼り付けに見える。
  // 数を減らして 1 つずつ大きくした（小さい丸が並ぶと「ネジ」に見える）。
  if (rBump.bool(0.3)) {
    // 【輪郭から突き出す形をやめた理由】
    //   殻の縁に半円を足すと、輪郭と弦が「D」の輪を作って
    //   小さな取っ手・フックが引っかかっているように見えた。
    //   輪郭は殻そのものに任せ、突起は「殻の表面のこぶ」として
    //   クリップの内側だけで陰影で表す。インクの縁取りは使わない。
    const cnt = rBump.int(5, 9);
    let m = `<g clip-path="${url(clip)}">`;
    const hi = lighten(shell, 0.34);
    const lo = darken(shell, 0.24);
    for (let i = 0; i < cnt; i++) {
      // 高さのスロットを等分してから中で揺らす。完全ランダムだと
      // 2 つがほぼ同じ位置に並んで「耳」に見えてしまう。
      const t = clamp((i + 0.5) / cnt + rBump.float(-0.06, 0.06), 0.1, 0.92);
      const y = top + t * H;
      const hw = halfAtRy(t);
      const x = cx + rBump.float(-0.78, 0.78) * hw;
      const r = rBump.float(4.5, 8);
      m += ellipse(x, y + r * 0.16, r, r * 0.9, { fill: lo, opacity: 0.28 });
      m += ellipse(x, y, r * 0.94, r * 0.86, { fill: shell, opacity: 0.9 });
      m += ellipse(x - r * 0.28, y - r * 0.3, r * 0.42, r * 0.32, { fill: hi, opacity: 0.75 });
    }
    m += `</g>`;
    push('bumps', 38, m, { x: cx - W, y: top, w: W * 2, h: H });
  }

  // ヒビ。殻の中ほどから枝分かれして走る細い割れ目。
  // 「もうすぐ孵る」気配になり、卵らしさの側で個体差を作れる。
  //
  // ── 「曲がった針金」から抜ける ────────────────────────────
  //
  // 【何が起きていたか — 実測 `SKBD-9YM2`】
  //   本体を **5 点の折れ線**（`polyPath`）で描き、点ごとに左右へ
  //   ±1.5〜4px 振っていた。5 点しかないので 1 区間が 15px 以上あり、
  //   そこへ 8px 幅のジグザグが乗ると、割れ目ではなく
  //   **等間隔に折り曲げた針金** にしか見えない。
  //   しかも太さが一定（1.7px）で先端まで同じなので、
  //   「割れて細くなっていく」という割れ目の性質が出ていなかった。
  //
  //   1) 点を 13 点に増やし、ジッタを ±1px に落とす
  //      → 折れ幅が線幅と同程度になり、直線ではないが折れ線でもなくなる
  //   2) 折れ線ではなくスプライン（`pathOpen`）でつなぐ
  //   3) 太い順に短く重ねて先端を細くする（テーパー）＋ `linecap: round`
  // ── 「枯れ枝・髪の毛」から抜ける ────────────────────────────
  //
  // 【前回の作り直しが行き過ぎていた — 実物で確認】
  //   「曲がった針金」を消すためにスプライン（`pathOpen`）＋丸い端＋
  //   ±1px のジッタまで落とした結果、今度は **なめらかに曲がる細い暗線** に
  //   なった。なめらかな曲線＋枝分かれは、割れ目ではなく
  //   **枯れ枝・髪の毛** の特徴そのもの（`WLZX-HB49` `GS8T-KJEX` `4UAU-AWRD`）。
  //   割れ目を割れ目として読ませる手がかりは 2 つある。
  //     1) 角張っていること … 材料が裂けるとき、裂け目は直線の連続になる。
  //        スプラインをやめ、折れ線（`polyPath`）＋角のある継ぎ目に戻す。
  //        ただしジッタは大きめに取り、等間隔のジグザグにはしない。
  //     2) **明線と暗線の二重**であること … 割れは面の段差なので、
  //        隙間の影（暗線）と、光を受ける割れの縁（明線）が必ず対になる。
  //        線が 1 本だけなら「表面に描かれた線」、2 本なら「面が割れている」。
  if (rBump.bool(0.24)) {
    const crackDark = darken(shell, 0.5);
    const crackLight = lighten(shell, 0.55);
    const u0 = rBump.float(-0.55, 0.55);
    const ry0 = rBump.float(0.2, 0.42);
    const STEPS = 9;
    const main = meridian(u0, ry0, Math.min(0.9, ry0 + rBump.float(0.28, 0.44)), STEPS).map(
      (p) => ({ x: p.x + rBump.float(-2.6, 2.6), y: p.y + rBump.float(-1.6, 1.6) }),
    );
    /** 明線は光源（左上）の側へずらす。 */
    const LX = -1.1;
    const LY = -1.1;
    let m = `<g clip-path="${url(clip)}">`;
    // 明線（割れの縁）。暗線より先に、少しはみ出す太さで敷く。
    m += path(polyPath(main.map((p) => ({ x: p.x + LX, y: p.y + LY })), false), {
      stroke: crackLight,
      width: 1.7,
      opacity: 0.6,
      linecap: 'butt',
      linejoin: 'miter',
    });
    // 暗線（隙間そのもの）。根元が太く、先端へ向かって細くなる。
    for (const [frac, w, op] of [[1, 0.9, 0.46], [0.72, 1.4, 0.56], [0.4, 2, 0.66]] as const) {
      const seg = main.slice(0, Math.max(3, Math.round(main.length * frac)));
      m += path(polyPath(seg, false), {
        stroke: crackDark,
        width: w,
        opacity: op,
        linecap: 'butt',
        linejoin: 'miter',
      });
    }
    // 枝分かれ。本線と同じく角のある短い折れ線にする。
    for (let i = 2; i < main.length - 1; i += 2) {
      const p = main[i]!;
      const side = i % 2 === 0 ? 1 : -1;
      const ln = rBump.float(5, 12);
      const dy = rBump.float(-4, 6);
      const br = [
        p,
        { x: p.x + side * ln * 0.45, y: p.y + dy * 0.35 + rBump.float(-1.6, 1.6) },
        { x: p.x + side * ln, y: p.y + dy },
      ];
      m += path(polyPath(br.map((q) => ({ x: q.x + LX, y: q.y + LY })), false), {
        stroke: crackLight,
        width: 1.1,
        opacity: 0.45,
        linecap: 'butt',
        linejoin: 'miter',
      });
      m += path(polyPath(br, false), {
        stroke: crackDark,
        width: 1,
        opacity: 0.5,
        linecap: 'butt',
        linejoin: 'miter',
      });
    }
    m += `</g>`;
    push('crack', 40, m);
  }

  // きらめき（発光が強いとき）
  if (glow > 0.5) {
    let m = '';
    for (let i = 0; i < 3; i++) {
      const a = rBump.float(0, Math.PI * 2);
      const x = cx + Math.cos(a) * W * 1.25;
      const y = top + H * 0.5 + Math.sin(a) * H * 0.5;
      m += path(starPath(clamp(x, 12, 188), clamp(y, 12, 188), 6, 2, 4, -90), {
        fill: pheno.palette.glow ?? shellLight,
        opacity: 0.75,
      });
    }
    push('sparkle', 44, m);
  }

  // 輪郭の描き直し
  push('outline', 48, path(d, { stroke: inkPaint, width: 3.1, linejoin: 'round' }), {
    x: cx - W,
    y: top,
    w: W * 2,
    h: H,
  });

  parts.sort((a, b) => a.z - b.z);

  const bodyBox = { x: cx - W, y: top, w: W * 2, h: H };
  return {
    seed: pheno.seed,
    stage: 'egg',
    base: pheno.base,
    detail: opts.detail,
    uid,
    viewBox: { ...VIEW },
    defs: defs.toString(),
    parts,
    anchors: [{ id: 'egg', x: cx, y: top + H * 0.5, angle: 0, scale: size }],
    bodyBox,
    // 卵に顔はないが、契約上必須なので「殻の中心付近」を入れておく
    faceBox: { x: cx - W * 0.5, y: top + H * 0.32, w: W, h: H * 0.3 },
    motion: {
      breathMs: 4200 - glow * 600,
      breathAmp: 0.018,
      floatAmp: 0,
      floatMs: 5200,
      blinkMs: 0,
      swayDeg: 1.1,
      swayMs: 5000 - glow * 800,
      phase: new Rng(pheno.seed).stream('egg:phase').float(0, 1),
    },
  };
}

/** 卵の背景色（コンタクトシート等で使う）。 */
export const EGG_PAPER = PAPER;
