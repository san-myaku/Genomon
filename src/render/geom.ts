/**
 * 素体シルエットの生成。
 *
 * 【なぜ制御点方式にしたか】
 *   「縦横比を変えただけ」の 3 素体では、指示書 §10 が求める
 *   「シルエットとして明確に区別できる」を満たせない。
 *   そこで素体ごとに右半分の制御点列を持ち、Catmull-Rom で閉じた輪郭にする。
 *     まる型   … 上がやや細く下が重い、種のような円
 *     幽霊型   … 釣鐘状に絞り込み、裾が波打って浮く（接地しない）
 *     スライム型 … 上が細く裾が最大幅まで広がり、底が平らに接地する
 *   silhouette 遺伝子座はこの制御点を「素体らしさを壊さない範囲で」変形する。
 *
 * 座標系は viewBox 0 0 200 200 固定。接地線 y=184。
 */

import type { BodyBase, Phenotype } from '../core/types.ts';
import { clamp, lerp, Rng } from '../core/rng.ts';
import {
  boxOf,
  flattenPath,
  outsideDepth,
  pathClosed,
  sampleOpen,
  type Box,
  type Vec,
} from './svg.ts';

export const VIEW = { x: 0, y: 0, w: 200, h: 200 } as const;
/** 接地線。 */
export const GROUND_Y = 184;
/** 体が使ってよい水平範囲。 */
export const BODY_X_MIN = 26;
export const BODY_X_MAX = 174;
/** 頭上の余白（角・植物・触角のため）。 */
export const HEAD_ROOM = 44;
export const CENTER_X = 100;

/** 正規化された右半分の制御点 [rx(0..1), ry(0..1)]。 */
type Half = readonly (readonly [number, number])[];

/** まる型: ほぼ円。下がわずかに重い「種」のシルエット。 */
const HALF_MARU: Half = [
  [0.0, 0.0],
  [0.34, 0.02],
  [0.68, 0.09],
  [0.92, 0.235],
  [1.0, 0.45],
  [0.99, 0.68],
  [0.84, 0.855],
  [0.55, 0.96],
  [0.26, 0.998],
  [0.0, 1.0],
];

/** 幽霊型: 上が丸く、下へ絞り込む釣鐘。裾は波打ち、接地しない。 */
const HALF_YUREI: Half = [
  [0.0, 0.0],
  [0.28, 0.018],
  [0.58, 0.085],
  [0.85, 0.215],
  [0.99, 0.385],
  [1.0, 0.535],
  [0.9, 0.695],
  [0.76, 0.81],
  [0.66, 0.878],
];

/** スライム型: 細い丸天井から一気に張り出し、底が最大幅で平らに広がる水滴。 */
const HALF_SLIME: Half = [
  [0.0, 0.0],
  [0.27, 0.032],
  [0.51, 0.105],
  [0.71, 0.215],
  [0.86, 0.355],
  [0.95, 0.505],
  [0.995, 0.665],
  [1.0, 0.805],
  [0.985, 0.915],
  [0.92, 0.975],
  [0.7, 1.0],
  [0.34, 1.0],
  [0.0, 1.0],
];

const HALVES: Record<BodyBase, Half> = {
  maru: HALF_MARU,
  yurei: HALF_YUREI,
  slime: HALF_SLIME,
};

/** 素体ごとの基準寸法（高さ・半幅・接地位置）。 */
const DIMS: Record<BodyBase, { h: number; halfW: number; bottom: number; faceT: number }> = {
  //           高さ  半幅  底辺 y   顔の相対高さ（低いほど幼く見える）
  maru: { h: 120, halfW: 62, bottom: 178, faceT: 0.43 },
  yurei: { h: 134, halfW: 52, bottom: 165, faceT: 0.37 },
  slime: { h: 104, halfW: 70, bottom: 184, faceT: 0.47 },
};

export interface BodyShape {
  base: BodyBase;
  /** 閉じた輪郭パス。 */
  d: string;
  /** 輪郭の制御点（絶対座標）。 */
  outline: Vec[];
  box: Box;
  cx: number;
  topY: number;
  botY: number;
  /** 最大半幅。 */
  halfW: number;
  /** 接地するか（幽霊型は false）。 */
  grounded: boolean;
  /** 影の中心 y。 */
  shadowY: number;
  /** 指定 y における輪郭の x。side: -1 左 / +1 右。 */
  edgeX(y: number, side: number): number;
  /** 指定 y における半幅。 */
  halfAt(y: number): number;
  /**
   * 指定 x における体の下端 y。
   *
   * 【なぜ botY だけでは足りないか】
   *   スライム型の裾が波・しずく・割れで切れ上がるようになったため、
   *   「底辺はどこでも botY」という前提が崩れた。足を botY に置くと
   *   切れ上がった位置では体から離れて浮く（自動検査 detached:feet）。
   */
  bottomYAt(x: number): number;
  /**
   * その点が輪郭の **外** にどれだけ出ているか（内側なら 0）。
   *
   * 【なぜ必要か】
   *   `halfAt` や `bottomYAt` は「その高さの幅」「その x の下端」しか答えられず、
   *   裾が割れた形（スライムの split / drip、幽霊型の波）では
   *   「内側 → 外側 → また内側」と縦に切り替わる x が存在する。
   *   そこでは下端だけ見ても足りず、実際に置いた点が体の中かどうかを
   *   直接聞く必要がある。自動検査（inspect.ts）とまったく同じ折れ線で
   *   判定するので、「置いてよいか」と「検査に通るか」が必ず一致する。
   */
  outsideAt(x: number, y: number): number;
}

interface Mods {
  /** 幅の一括倍率。 */
  wScale: number;
  /** 高さの一括倍率。 */
  hScale: number;
  /** 中央のふくらみ。 */
  plump: number;
  /** 上部を尖らせる強さ。 */
  point: number;
  /** くびれの強さ。 */
  lobe: number;
  /** 波打ちの強さ。 */
  wave: number;
}

function modsFor(sil: string): Mods {
  switch (sil) {
    case 'tall':
      return { wScale: 0.82, hScale: 1.18, plump: -0.02, point: 0.12, lobe: 0, wave: 0 };
    case 'wide':
      return { wScale: 1.2, hScale: 0.84, plump: 0.18, point: 0, lobe: 0, wave: 0 };
    case 'wavy':
      return { wScale: 1.0, hScale: 1.0, plump: 0.04, point: 0, lobe: 0, wave: 0.13 };
    case 'pointed':
      return { wScale: 0.93, hScale: 1.08, plump: -0.05, point: 0.7, lobe: 0, wave: 0 };
    case 'lobed':
      return { wScale: 1.06, hScale: 1.0, plump: 0.12, point: 0, lobe: 0.24, wave: 0.03 };
    default:
      return { wScale: 1.0, hScale: 1.0, plump: 0, point: 0, lobe: 0, wave: 0 };
  }
}

/** ちょうど中央で 1、両端で 0 になる釣鐘。 */
const bell = (t: number, center: number, width: number): number => {
  const u = (t - center) / width;
  return Math.exp(-(u * u));
};

// ─────────────────────────────────────────────────────────
//  スライム型の分散
// ─────────────────────────────────────────────────────────

/**
 * スライム型の裾の作り。
 *
 * 【なぜ専用の仕組みが要ったか】
 *   スライムは人口の約 1/3 を占めるのに、16 体並べて 14 体が
 *   「同じドーム」だった。コレクションのサムネイルで 1/3 が
 *   判別不能になるという重い問題で、まる型の `lobed`／幽霊型の
 *   波打つ裾に相当する「素体内の作り分け」がスライムだけ無かった。
 *   裾・頂点の左右・潰れ具合の 3 軸で分散させる。
 */
type SlimeHem = 'flat' | 'wave' | 'drip' | 'split';

/** silhouette 対立遺伝子のうち、意味が裾の形に直結するもの。 */
const HEM_BY_SIL: Readonly<Record<string, SlimeHem>> = {
  wavy: 'wave', // ゆらぎ → 波打つ裾
  lobed: 'split', // くびれ → 裾が割れて 2 本足に見える
  pointed: 'drip', // とんがり → しずくが垂れる
};

/**
 * 右下の角から左下の角へ向かう裾の点列（両端の角そのものは含めない）。
 *
 * 【裾が結び目（自己交差）にならないための約束 — 実測で特定】
 *   輪郭は Catmull-Rom（`pathClosed`）で結ぶ。この曲線のベジエ制御点は
 *   「前後の点の差の 1/6」に置かれるので、隣り合う 3 つの間隔を
 *   g0, g1, g2 とすると **4·g1 < g0 + g2 のとき x が折り返す**。
 *   折り返した区間はその前後と交差し、裾に三角の穴の開いたループができる。
 *
 *   以前の `drip` は「滴の右肩」と「次の滴の左肩」を独立に置いていたため、
 *   その 2 点がほぼ同じ x に来ていた（実測 `N7KQ-CXDA`: x=119.2 の次が
 *   x=120.8 と **逆走**）。400 体中スライム 141 体のうち **24 体（17%）** で
 *   裾が結び目になっていた。`split` も中心と幅の乱数しだいで
 *   端の間隔だけが極端に狭くなり、同じ折り返しが起きうる。
 *
 *   そこで裾の点は
 *     ・x について必ず単調（同じ切れ込みを 2 つの山で共有する）
 *     ・間隔をほぼ等しく（最小間隔が隣の 1/3 を下回らない）
 *   にする。この条件だと制御点の距離は山の半幅の 1/3 に収まり
 *   （＝指示された 0.55 以下）、山の頂点で接線が反転しない。
 *
 * @param xR,xL  右下・左下の角の x
 * @param yBase  接地線の y（点はここから **上へ** しか動かない）
 * @param depth  切れ上がりの基準量
 */
function slimeHemPoints(
  kind: SlimeHem,
  xR: number,
  xL: number,
  yBase: number,
  depth: number,
  rng: Rng,
): Vec[] {
  const pts: Vec[] = [];
  const at = (t: number): number => lerp(xR, xL, t);
  switch (kind) {
    case 'wave':
    case 'drip': {
      // 波: 丸い山が並ぶ水たまりの裾。
      // しずく: 底を平らにして、切れ込みを深くした滴。
      // どちらも「山 → 切れ込み → 山」を切れ込みの共有で作るので、
      // 点は必ず x について単調に並ぶ。
      const drip = kind === 'drip';
      const K = drip ? 3 + rng.int(0, 1) : 3 + rng.int(0, 1);
      for (let j = 0; j < K; j++) {
        if (drip) {
          // 滴の底は平ら（2 点）。間隔は 0.3 / 0.4 / 0.3 で、
          // どれも隣の 3 分の 1 を下回らない。
          pts.push({ x: at((j + 0.3) / K), y: yBase });
          pts.push({ x: at((j + 0.7) / K), y: yBase });
        } else {
          pts.push({ x: at((j + 0.5) / K), y: yBase });
        }
        if (j < K - 1) {
          // 山と山のあいだの切れ込み。深さだけを乱数で振る
          // （x は等間隔に固定するので、振っても折り返さない）。
          const up = depth * (drip ? rng.float(0.9, 1.35) : rng.float(0.55, 0.95));
          pts.push({ x: at((j + 1) / K), y: yBase - up });
        }
      }
      break;
    }
    case 'split': {
      // 割れ: 中央が深く切れ上がり、2 つの足で立っているように見える。
      //
      // 【幅と中心のレンジを狭めた理由】
      //   外側の 2 点が角へ寄りすぎると、そこだけ間隔が極端に狭くなり
      //   上の条件（4·g1 ≥ g0 + g2）を割って折り返す。
      //   w を 0.13〜0.17、中心のずれを ±0.05 に収めると、
      //   角までの間隔は最大 0.29 に対し 3w = 0.39 以上あり、必ず満たす。
      const c = 0.5 + rng.float(-0.05, 0.05);
      const w = rng.float(0.13, 0.17);
      pts.push({ x: at(c - w * 2), y: yBase });
      pts.push({ x: at(c - w), y: yBase - depth * 1.3 });
      pts.push({ x: at(c), y: yBase - depth * 1.55 });
      pts.push({ x: at(c + w), y: yBase - depth * 1.3 });
      pts.push({ x: at(c + w * 2), y: yBase });
      break;
    }
    default:
      // 平ら（従来のドーム）。
      pts.push({ x: at(0.36), y: yBase });
      pts.push({ x: at(0.68), y: yBase });
      break;
  }
  return pts;
}

/**
 * 表現型から素体シルエットを組み立てる。
 * 同じ Phenotype からは常に同じ形が出る（Rng は seed 由来のサブストリームのみ）。
 */
export function buildShape(pheno: Phenotype): BodyShape {
  const base = pheno.base;
  const dim = DIMS[base];
  const mods = modsFor(pheno.parts.silhouette);
  const rng = new Rng(pheno.seed).stream('shape');
  const wavePhase = rng.float(0, Math.PI * 2);

  // ── スライム型だけの追加分散 ────────────────────────────
  // 他の素体の乱数列を変えないよう、スライムのときだけ引く。
  const slime = base === 'slime';
  //   ① 潰れ具合（縦に伸びた雫 ⇔ べたっと広がった水たまり）
  const squash = slime ? rng.float(-1, 1) : 0;
  //   ② 頂点をどちら側へ寄せるか（左右非対称の山）
  const lean = slime ? rng.float(-1, 1) * (0.07 + pheno.asymmetry * 0.09) : 0;
  //   ③ 裾の形。silhouette に意味が対応するものはそれを使い、
  //      残り（すなお・たてなが・よこひろ ＝ 人口の 6 割）は種で振り分ける。
  const hemKind: SlimeHem = slime
    ? (HEM_BY_SIL[pheno.parts.silhouette] ??
      rng.pick<SlimeHem>(['flat', 'wave', 'drip', 'split']))
    : 'flat';

  // 大きさ・縦横比。ratio 0.78..1.28 を「横に広い ⇔ 縦に長い」へ写す。
  const size = clamp(pheno.size, 0.72, 1.3);
  const rn = clamp((pheno.ratio - 0.78) / 0.5, 0, 1);
  const wRatio = lerp(0.84, 1.18, rn);
  const hRatio = lerp(1.13, 0.88, rn);

  let H = dim.h * size * mods.hScale * hRatio * (1 + squash * 0.2);
  let W =
    dim.halfW * size * mods.wScale * wRatio * (1 + (pheno.plump - 0.5) * 0.14) *
    (1 - squash * 0.13);

  // viewBox からはみ出さないよう厳格にクランプする。
  W = clamp(W, 26, (BODY_X_MAX - BODY_X_MIN) / 2);
  const bottom = dim.bottom;
  H = clamp(H, 66, bottom - HEAD_ROOM - 2);
  const top = bottom - H;

  const half = HALVES[base];
  const plumpAmt = (pheno.plump - 0.5) * 0.2 + mods.plump;

  /** 正規化点 → 絶対座標。side=+1 右 / -1 左。 */
  const place = (rx: number, ry: number, side: number): Vec => {
    let x = rx;
    // 中央のふくらみ
    x *= 1 + plumpAmt * bell(ry, 0.52, 0.34);
    // 上部を尖らせる（頭頂に向けて絞る）
    if (mods.point > 0) x *= 1 - mods.point * 0.42 * bell(ry, 0.0, 0.34);
    // くびれ
    if (mods.lobe > 0) x *= 1 - mods.lobe * bell(ry, 0.44, 0.13);
    // 波打ち
    if (mods.wave > 0) x *= 1 + mods.wave * Math.sin(ry * 8.4 + wavePhase);
    // 軽い左右差（破綻しない範囲）
    if (side < 0) x *= 1 + pheno.asymmetry * 0.032 * Math.sin(ry * 3.3 + wavePhase);
    else x *= 1 + pheno.asymmetry * 0.018 * Math.cos(ry * 2.7 + wavePhase);
    let y = top + ry * H;
    if (mods.point > 0 && ry < 0.06) y -= mods.point * 5;
    // 頂点の左右寄せ（スライム型のみ）。
    // 【上半分だけに効かせる理由】
    //   輪郭ごと平行移動すると顔の高さでも中心がずれ、目・口が
    //   輪郭を突き抜ける。効きを ry 0.58 で 0 に落とし、
    //   幅が最大になる下半分は動かさない。上へ行くほど元の rx が
    //   小さいので、これで viewBox からはみ出すこともない。
    let xOff = 0;
    if (lean !== 0) {
      const k = Math.max(0, 1 - ry / 0.58);
      xOff = lean * W * k * k;
    }
    return { x: CENTER_X + side * x * W + xOff, y };
  };

  const right: Vec[] = half.map(([rx, ry]) => place(rx, ry, 1));
  const left: Vec[] = half.map(([rx, ry]) => place(rx, ry, -1));

  let outline: Vec[];
  if (base === 'yurei') {
    // 裾を波立たせる。ホラーにしないため、深さは控えめ・数は 3 山に固定。
    const hemY = top + 0.878 * H;
    const dipY = top + H;
    const rHem = right[right.length - 1]!;
    const lHem = left[left.length - 1]!;
    const hem: Vec[] = [];
    const K = 6;
    for (let i = 1; i < K; i++) {
      const t = i / K;
      const x = lerp(rHem.x, lHem.x, t);
      const isDip = i % 2 === 1;
      const y = isDip ? lerp(hemY, dipY, 0.92) : lerp(hemY, dipY, 0.06);
      hem.push({ x, y });
    }
    outline = [...right, ...hem, ...left.slice(1).reverse()];
  } else if (slime) {
    // 平らな底辺（HALF_SLIME の末尾 2 点）を捨てて、裾を作り直す。
    const rCore = right.slice(0, right.length - 2);
    const lCore = left.slice(0, left.length - 2);
    const rc = rCore[rCore.length - 1]!;
    const lc = lCore[lCore.length - 1]!;
    const hem = slimeHemPoints(hemKind, rc.x, lc.x, bottom, H * 0.085, rng);
    outline = [...rCore, ...hem, ...lCore.slice(1).reverse()];
  } else {
    outline = [...right, ...left.slice(1, -1).reverse()];
  }

  // edgeX / halfAt が参照する片側の点列。
  // スライムは平らな底辺を落とした側（rCore 相当）で取る。
  // 水平に並んだ 3 点をそのまま入れると、同じ y の区間で x が
  // 一意に決まらず、目・口の可用幅の計算がぶれる。
  const rEdge = slime ? right.slice(0, right.length - 2) : right;
  const lEdge = slime ? left.slice(0, left.length - 2) : left;
  const dense = sampleOpen(rEdge, 8);
  const denseL = sampleOpen(lEdge, 8);

  const edgeX = (y: number, side: number): number => {
    const arr = side < 0 ? denseL : dense;
    if (arr.length === 0) return CENTER_X;
    const first = arr[0]!;
    const last = arr[arr.length - 1]!;
    if (y <= first.y) return first.x;
    if (y >= last.y) return last.x;
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1]!;
      const b = arr[i]!;
      if (y >= a.y && y <= b.y) {
        const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
        return lerp(a.x, b.x, t);
      }
    }
    return last.x;
  };

  const botY = base === 'yurei' ? top + H : bottom;

  const d = pathClosed(outline);

  /**
   * 実際に描かれる曲線を折れ線に展開したもの。
   *
   * 【制御点の多角形で測ってはいけない理由 — 実測で特定】
   *   `d` は制御点を通る曲線なので、スライムの裾の切れ込みや幽霊型の
   *   波打つ裾では、曲線が制御点どうしを結んだ弦よりずっと **上** に来る。
   *   制御点の折れ線で下端を測ると `A9RE-6LZR` では 8px 以上も甘く出て、
   *   口の下辺が「体の無いところ」に置かれ、自動検査の
   *   face-outside-body:mouth が鳴っていた。
   *   自動検査（inspect.ts）は clipPath の d を `flattenPath(d, 6)` で
   *   展開した折れ線で内外を判定するので、**同じもので測る**。
   *   これで「配置する側」と「検査する側」の基準がずれなくなる。
   */
  const flat = flattenPath(d, 6);

  /** 輪郭の各辺のうち x をまたぐものを見て、いちばん下の y を返す。 */
  const bottomYAt = (x: number): number => {
    const pts = flat.length >= 8 ? flat : outline;
    let best = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const lo = Math.min(a.x, b.x);
      const hi = Math.max(a.x, b.x);
      if (x < lo || x > hi) continue;
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      best = Math.max(best, a.y + (b.y - a.y) * t);
    }
    return Number.isFinite(best) ? best : botY;
  };

  const shape: BodyShape = {
    base,
    d,
    outline,
    box: boxOf(outline),
    cx: CENTER_X,
    topY: top,
    botY,
    halfW: W,
    grounded: base !== 'yurei',
    shadowY: base === 'yurei' ? GROUND_Y + 3 : GROUND_Y + 2,
    edgeX,
    halfAt: (y: number) => Math.max(0, (edgeX(y, 1) - edgeX(y, -1)) / 2),
    bottomYAt,
    outsideAt: (x: number, y: number) => (flat.length >= 8 ? outsideDepth(x, y, flat) : 0),
  };
  return shape;
}

/**
 * 顔の領域。装飾が覆っていないかの検査基準にもなる。
 *
 * 【個体差を持たせた理由】
 *   顔の高さ・幅・大きさが素体ごとの定数だったため、9 体並べると
 *   顔ボックスが体ボックスに対して常に同じ相対位置・相対幅になり、
 *   「どの子も同じ顔配置」に見えていた（ビジュアル批評 P1-10）。
 *   目の大きさ・間隔（eyeSize / eyeSpacing）は遺伝子座にあるが、
 *   その器である顔ボックスが固定では効きが半分しか出ない。
 *   種と体つき（plump / ratio）から、高さ・幅・縦幅を散らす。
 *
 * 【中心を輪郭から取る理由】
 *   スライム型は頂点が左右どちらかに寄る個体があるので、
 *   常に CENTER_X に顔を置くと、細い側で目や口が輪郭を突き抜ける。
 *   その高さでの輪郭の中点を顔の中心にする。
 */
export function faceBoxOf(pheno: Phenotype, shape: BodyShape): Box {
  const dim = DIMS[pheno.base];
  const H = shape.botY - shape.topY;
  const rng = new Rng(pheno.seed).stream('faceBox');
  // 顔の高さ: 素体の基準 ±0.05。低いほど幼く、高いほど大人びて見える。
  const faceT = clamp(dim.faceT + rng.float(-0.05, 0.05) + (pheno.plump - 0.5) * 0.04, 0.28, 0.58);
  let cy = shape.topY + faceT * H;
  // 顔の幅・縦幅も個体差にする（小顔／大顔）。
  const wK = rng.float(1.5, 1.9);
  const hK = rng.float(0.42, 0.56);
  const w = Math.min(shape.halfAt(cy) * wK, shape.halfW * wK, 104);
  const h = Math.min(H * hK, 70);
  // 下端は botY ではなく「中心線での実際の下端」で抑える。
  // スライム型の裾が切れ上がる個体では botY まで顔を下ろせず、
  // そのままだと目の下に口を置く余地が無くなる。
  cy = clamp(cy, shape.topY + h * 0.5 + 4, shape.bottomYAt(shape.cx) - h * 0.5 - 6);
  const cx = (shape.edgeX(cy, 1) + shape.edgeX(cy, -1)) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
