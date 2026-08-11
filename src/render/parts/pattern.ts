/**
 * 模様。すべて clipPath で本体シルエット内に閉じ込める。
 *
 * detail='full' では feTurbulence 系（speckle / dapple / veins の下地）を使う。
 * detail='lite' ではベクタの点・線に差し替える。
 * 遺伝形質（patDensity / patScale）は両方で同じ意味を持つ。
 */

import { contrastRatio, hexToHsl, hslToHex, lighten, mix } from '../../core/color.ts';
import { clamp, lerp, type Rng } from '../../core/rng.ts';
import { Z, type DrawCtx, type PartOut } from '../ctx.ts';
import {
  TAU,
  blobPath,
  circle,
  ellipse,
  n,
  path,
  pathClosed,
  pointInPoly,
  rad,
  url,
  type Vec,
} from '../svg.ts';
import { moteGlow, moteInk } from './lumin.ts';
import { mouthSpan } from './face.ts';
import { faceCoreOf, type FaceCore } from './faceLayout.ts';

/** 合成 ID を基本模様の集合に分解する。 */
export function decompose(id: string): string[] {
  switch (id) {
    case 'bellySpots':
      return ['spots'];
    case 'bellyStripes':
      return ['stripes'];
    case 'spotsStripes':
      return ['spots', 'stripes'];
    // 腹白＋牛柄。腹の白が強く敷かれる（body.ts 側）ので、
    // ここでは塊のコントラストと数を上げた強調版にする。
    case 'bellyCow':
      return ['cow'];
    case 'belly':
    case 'none':
      return [];
    default:
      return [id];
  }
}

// ─────────────────────────────────────────────────────────
//  形づくりの共通部品
// ─────────────────────────────────────────────────────────

/**
 * 有機的な塊。
 *
 * `blobPath` は各頂点を独立に揺らすので、半径を大きくすると
 * 「ぎざぎざの星形」になってしまい、牛柄のような大きな塊には使えない。
 * ここでは **低周波の正弦波 2 本**（2 倍波・3 倍波）で輪郭をゆがめる。
 * 頂点数を増やしても境界はなめらかなまま、形だけが不定形になる。
 */
function organicBlobPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rng: Rng,
  wobble: number,
  steps: number,
): Vec[] {
  const ph = rng.float(0, TAU);
  const a2 = rng.float(0.45, 1) * wobble;
  const a3 = rng.float(0.25, 0.7) * wobble;
  const rot = rng.float(0, TAU);
  const pts: Vec[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    const k = 1 + a2 * Math.sin(a * 2 + ph) + a3 * Math.sin(a * 3 - ph * 1.7);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // 塊ごとに向きを変える（同じ形の繰り返しに見せない）
    const x = ca * rx * k;
    const y = sa * ry * k;
    pts.push({
      x: cx + x * Math.cos(rot) - y * Math.sin(rot),
      y: cy + x * Math.sin(rot) + y * Math.cos(rot),
    });
  }
  return pts;
}

function organicBlob(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rng: Rng,
  wobble: number,
  steps: number,
): string {
  return pathClosed(organicBlobPoints(cx, cy, rx, ry, rng, wobble, steps));
}

/**
 * 点 (x, y) が半径 pad の広がりを持って表情の芯に食い込んでいるか。
 *
 * 面で描く模様（滴・粒・帯）は網目と違って「細く薄くする」逃げ方ができない。
 * 半透明にしても目や口の上に色の塊が残り、表情が読めなくなる。
 * それらは芯にかかるかどうかを真偽で判定し、位置そのものをずらす。
 */
function coreHit(core: FaceCore, x: number, y: number, pad: number): boolean {
  const dx = (x - core.cx) / Math.max(1, core.rx + pad);
  const dy = (y - core.cy) / Math.max(1, core.ry + pad);
  return dx * dx + dy * dy < 1;
}

/**
 * その点が表情の芯にどれだけ深く入っているか（0..1）。
 *
 * 【段階的に落とす理由】
 *   顔の上だけ模様を切り落とすと、輪郭に沿って白い穴が開き
 *   「顔を切り抜いたステッカー」に見える。生きものの網目や斑は
 *   頭部へ向かうほど細かく薄くなるのが自然なので、
 *   芯へ近づくほどなめらかに細く・薄くする。
 */
function faceSoft(core: FaceCore, x: number, y: number): number {
  const dx = (x - core.cx) / Math.max(1, core.rx);
  const dy = (y - core.cy) / Math.max(1, core.ry);
  const d = Math.sqrt(dx * dx + dy * dy);
  // d<=1.0 で最大、d>=1.34 で 0。あいだは smoothstep でなめらかに。
  //
  // 【外側の縁取りを 1.5 → 1.34 に狭めた理由】
  //   守るべきなのは芯（d<=1＝実際に目と口がある範囲）で、そこの守りは
  //   まったく変えていない。問題は外側の緩衝帯で、口が広い個体では
  //   芯の 1.5 倍が体のほぼ全面になり、**体じゅうの網が薄まっていた**。
  //   薄まった網は暖色の地の上で茶色くにじむ（茶＝土）ので、
  //   顔と関係のない胴や裾まで「ひび割れた土」になっていた。
  const t = clamp((1.34 - d) / 0.34, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 牛柄の色。
 *
 * サムネイルでも一目で分かる識別子であることが要件なので、色相は本体のまま、
 * 彩度は落とす（実際の牛の斑は白か黒であり、色が付くと途端に安っぽくなる）。
 *
 * 【インクとの分離を必ず取る — 実測で特定した破綻】
 *   以前は「本体の明度 − 46（下限 11）」だけで決めていたため、明るい体では
 *   塊が輪郭インクとほぼ同じ暗さになり、**塊の上を通る線が物理的に消えていた**。
 *     `Q5ZA-N8Y3` ink #2e234e / cow #2e283f → **1.02:1**
 *     `ZYPA-QJPP` 1.08:1 ／ `C2SY-A5BV` 1.27:1
 *   輪郭・口の線が塊に飲まれ、「パグの鼻づら」「黒塊の上の目」になっていた。
 *
 * 【インクとの 3.0:1 を「均衡点」ではなく **絶対条件** にした理由 — 実測】
 *   以前は「インクとの比が 3.0 に届く」か「地との比のほうが小さくなる」かの
 *   早いほうで打ち切っていた。後者で抜けると 3.0 に届かないまま確定するので、
 *   36 体の実測で **最小 2.41:1** が残っていた。塊の上を通るのは
 *   口・まぶた・輪郭という「線」なので、面である塊とのコントラストが
 *   2.4:1 では線がにじんで消える。塊が地から少し読みにくくなっても、
 *   顔が読めなくなるほうが決定的に悪い。**インクとの 3.0:1 を先に確保し、
 *   それを満たす色の中で地との比が最大になるものを選ぶ** 順序にする。
 *
 * 【暗背景のインク（`inkDark`）を絶対条件に含めなかった理由 — 実測して撤回した】
 *   顔の線は `inkPaint`（`--gm-ink`）なので暗背景では `inkDark` に化ける。
 *   はじめは両方のインクから 3.0:1 離すことを条件にしたが、`inkDark` 自体が
 *   「地から離れる色」として選ばれるため、塊の逃げ場と正面衝突する。
 *   実測ではこの条件を入れると、明るい体でだけ塊が暗い側へ追い込まれ、
 *   **地との比が 1.6:1** まで落ちて牛柄そのものが読めなくなった。
 *   明背景のインクを絶対条件、暗背景のインクは同点のときの決め手に留める。
 *
 * 【暗い斑と明るい斑を毎回くらべる理由 — 計算で確認】
 *   塊を地とインクの **あいだ** に置く（＝暗い斑）場合、両方 3.0:1 を満たすには
 *   「地の輝度 ≧ インクの輝度の 9 倍」が要る。しんじゅ・しも系の明るい体
 *   （L77, 輝度 0.55）は 9.3 倍あるので満たせるが、たそがれの紫（L66, 輝度 0.27）は
 *   インクを真っ黒にしても 6.3 倍が上限で、**暗い斑では数学的に不可能**。
 *   そこで「白い牛のブチ」＝地より明るい斑も候補にする。
 *   ホルスタインが白黒どちらの地でも成立するのと同じ理屈で、絵としても正しい。
 */
/**
 * 【明暗で別々の色を返す理由 — 実測で判明】
 *   以前は 1 色だけを返し、明背景のインクにだけ 3.0:1 を保証していた。
 *   暗背景ではインクが `inkOnDark()` で差し替わるため保証が外れ、
 *   **200 体中 143 体が 3.0 を割っていた**（中央 1.14:1）。
 *   塊の上には口・まぶた・輪郭の線が通るので、テーマを切り替えるだけで
 *   顔が読めなくなる。
 *
 *   1 色で両立させようとすると、たそがれの紫のような中間調の体では
 *   数学的に不可能な組み合わせが残る（20 体前後）。
 *   インクが既に `--gm-ink` でテーマ別に差し替わっているので、
 *   **塊も同じ仕組み（`--gm-cow`）でテーマ別に持つ**のが素直な解。
 *   これで明暗それぞれに最適な色を選べ、妥協が要らなくなる。
 */
function cowColor(ctx: DrawCtx): { light: string; dark: string } {
  const b = hexToHsl(ctx.colors.body);
  const hue = ctx.colors.bodyHue;
  const ink = ctx.colors.ink;
  const inkDark = ctx.colors.inkDark;
  const body = ctx.colors.body;
  /**
   * 塊としての読みやすさ。地との比が主で、暗背景のインクとの比は
   * 同じくらいの候補が並んだときに「暗背景でも線が残るほう」を選ばせる重み。
   */
  const vsBody = (col: string): number =>
    contrastRatio(body, col) + Math.min(contrastRatio(inkDark, col), 3) * 0.12;

  // 候補は「地と同じ色相・彩度を落とした」帯の明度違い。
  // 暗い斑は彩度を絞り（実際の牛の斑は色を持たない）、
  // 明るい斑はさらに白へ寄せる。
  const candidate = (l: number): string =>
    hslToHex(hue, l >= b.l ? clamp(b.s * 0.3, 0, 16) : clamp(b.s * 0.42 + 2, 0, 26), l);

  /**
   * 塊は不透明度 0.92〜0.97 で地の上に乗るので、**画面に出るのは合成後の色**。
   * 合成前の色でコントラストを測ると保証が外れる。
   *
   * 実際にこれで失敗した: 合成前で測ると 200 体すべて 3.0 以上だったのに、
   * 実 DOM で合成後を測ると 100 体中 15 体が 3.0 を割っていた。
   * 「材料ではなく結果を測る」（DESIGN_DECISIONS D-025）。
   */
  const COW_OPACITY = 1;
  const composite = (col: string): string => mix(body, col, COW_OPACITY);

  /**
   * 指定のインクに対して最適な塊色を選ぶ。
   *
   * インクとの 3.0:1 を絶対条件にし、満たすものの中で地との差が最大の色を採る。
   * 1 つも満たせない体は、インクとの比が最大の色で妥協する。
   */
  const pick = (against: string): string => {
    const vs = (col: string): number => contrastRatio(against, composite(col));
    let best = candidate(clamp(b.l - 46, 11, 28));
    let bestBody = -1;
    let fallback = best;
    let fallbackC = -1;
    for (let l = 8; l <= 94; l += 2) {
      // 地と明度が近すぎる塊は「塗りむら」にしか見えない。
      if (Math.abs(l - b.l) < 16) continue;
      const col = candidate(l);
      const c = vs(col);
      if (c > fallbackC) {
        fallbackC = c;
        fallback = col;
      }
      if (c < 3) continue;
      const cb = vsBody(col);
      if (cb > bestBody) {
        bestBody = cb;
        best = col;
      }
    }
    return bestBody < 0 ? fallback : best;
  };

  return { light: pick(ink), dark: pick(inkDark) };
}

/**
 * ふいり（斑入り）の斑色。
 *
 * 骨格（塊の形・配置・顔よけ）は `case 'cow'` とまったく同じ関数
 * （`organicBlobPoints` / `cowGuardOf` / `placeCowBlob`）を呼んで作る。
 * 違うのは色だけ:
 *   ・`cow` は本体の色相を使い、彩度を落として無彩色（白黒の毛色）に寄せる。
 *   ・`variegate` は **アクセント色相**（`palette.accentShift` で本体からずらした
 *     色相）を使い、彩度を落とさない。参考の斑入り植物（葉）は白×緑・桃×緑
 *     と、地とはっきり違う「色」が乗る模様なので、本体の色相を使い回すと
 *     ただの明度違い（＝ cow と見分けが付かない）になってしまう。
 *
 * 【選び方は `cowColor` と同じ「測って選ぶ」方針】
 *   斑は輪郭に接して途切れる（cow と同じ配置ロジック）ので、体の縁を
 *   なぞる輪郭インクが斑の上を通る場面が必ずある。インクとの 3.0:1 を
 *   絶対条件にし、それを満たす候補の中で地との比が最大になる明度を選ぶ。
 *   明暗テーマで実際に塗るインクが変わる（`--gm-ink`）ので、
 *   明背景用・暗背景用をそれぞれ別に選ぶ（`cowColor` と同じ理由）。
 */
function variegateColor(ctx: DrawCtx): { light: string; dark: string } {
  const acc = hexToHsl(ctx.colors.accent);
  const body = ctx.colors.body;
  const ink = ctx.colors.ink;
  const inkDark = ctx.colors.inkDark;
  const hue = acc.h;

  const vsBody = (col: string): number =>
    contrastRatio(body, col) + Math.min(contrastRatio(inkDark, col), 3) * 0.12;

  /**
   * 斑の彩度。cow と違い明暗で分けず、常に「はっきりした色」を保つ。
   *
   * 【彩度を落とさない理由】
   *   cow は彩度を落として無彩色（白黒）に寄せることで牛の毛色を再現している。
   *   同じ落とし方をすると variegate の斑も無彩色になり、cow と見分けが
   *   付かない別名の同じ模様になってしまう。参考写真の白斑・桃斑はどちらも
   *   「地とは違う色」がはっきり乗っているので、彩度は個体のアクセント色を
   *   底上げして残す（低彩度の配色ファミリーでも斑だけは目立たせる）。
   */
  const sat = clamp(acc.s * 1.1 + 24, 34, 90);
  const candidate = (l: number): string => hslToHex(hue, sat, l);

  /**
   * 指定のインクに対して最適な斑色を選ぶ。`cowColor.pick` と同じ手順。
   */
  const pick = (against: string): string => {
    const vs = (col: string): number => contrastRatio(against, col);
    let best = candidate(clamp(acc.l, 20, 88));
    let bestBody = -1;
    let fallback = best;
    let fallbackC = -1;
    for (let l = 6; l <= 96; l += 2) {
      const col = candidate(l);
      const c = vs(col);
      if (c > fallbackC) {
        fallbackC = c;
        fallback = col;
      }
      if (c < 3) continue;
      const cb = vsBody(col);
      if (cb > bestBody) {
        bestBody = cb;
        best = col;
      }
    }
    return bestBody < 0 ? fallback : best;
  };

  return { light: pick(ink), dark: pick(inkDark) };
}

// ─────────────────────────────────────────────────────────
//  牛柄の置き場所
// ─────────────────────────────────────────────────────────

/** 牛柄の塊が入ってはいけない範囲。 */
interface CowGuard {
  /** 避ける器官（目・口・頬）をそれぞれ包む楕円。 */
  zones: FaceCore[];
  /** 顔全体を包む楕円（逃がし先を探すときの外周）。 */
  hull: FaceCore;
  /** 曲線のふくらみ・輪郭線のぶんの余裕。 */
  margin: number;
  /** あご（口の下端〜その下）の禁止帯。 */
  chinTop: number;
  chinBot: number;
  /** 口の高さの帯。ここに中心を置いてよい塊は 1 つだけ。 */
  bandTop: number;
  bandBot: number;
  /** 目の高さ（横へ逃がすときはここまで持ち上げる）。 */
  eyeY: number;
  /** 頭頂の禁止線。これより上に塊の中心を置かない。 */
  crownY: number;
  /** 目の上端（まぶたの線）。塊はここから塊の半径ぶん離す。 */
  eyeTops: { x: number; y: number; rx: number }[];
}

/**
 * 牛柄用の守備範囲。
 *
 * 【器官ごとの楕円にした理由 — 顔を守ると模様が消えるのを避ける】
 *   目と口をまとめて 1 つの楕円で守ると、目が離れた個体では
 *   その楕円が体の幅いっぱいになり（実測 `Q5ZA-N8Y3`: 芯の半幅 49 に対し
 *   体の半幅 65）、塊がすべて頭頂へ押し出されて牛柄が消える。
 *   実際の牛のブチは目のあいだや目の下を平気で通る。壊れるのは
 *   **目や口そのものが塗り潰されたとき**だけなので、器官ごとに守る。
 *
 * 【頬を含める理由】
 *   頬紅は顔と同じ層（Z.FACE − 1）で塊より手前に描かれるので、
 *   塊の上に桃色の楕円が重なると **打撲痕** に見える
 *   （実測: `Q5ZA-N8Y3` `UFN3-EWML`）。頬の位置を守備範囲に足せば、
 *   描画順を変えずに「頬紅が塊に乗る」状況そのものが起きなくなる。
 *
 * 【あごの禁止帯・口の高さの帯を作る理由】
 *   `bands` の 0.72 / 0.82 / 0.9 は多くの素体であごの直下に当たる。
 *   器官の楕円は口の下端までしか守らないので、その 1 段下の塊が
 *   「やぎひげ」として読まれていた（`3FSA-HWSQ` `C2SY-A5BV`）。
 *   また口の左右に 1 つずつ並ぶと、それだけで「口ひげ」になる
 *   （`YGHW-54Q7` `PHS4-DYQB` `C2SY-A5BV`）。あごは禁止、
 *   口の高さの帯には 1 つしか置かない、の 2 本立てで塞ぐ。
 *
 * 【口の縦幅を 0.6 倍で見る理由】
 *   `face.mouth.h` は bbox 用の値で、実際に描かれる口の 2 倍近く高い
 *   （`smile` は h = 0.7w に対し実寸の下端が 0.32w）。そのまま使うと
 *   あごの半ばまで口として守ってしまい、また模様が消える方向に効く。
 */
function cowGuardOf(ctx: DrawCtx): CowGuard {
  const f = ctx.face;
  const zones: FaceCore[] = [];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const add = (cx: number, cy: number, rx: number, ry: number): void => {
    zones.push({ cx, cy, rx, ry });
    x0 = Math.min(x0, cx - rx);
    x1 = Math.max(x1, cx + rx);
    y0 = Math.min(y0, cy - ry);
    y1 = Math.max(y1, cy + ry);
  };
  for (const e of f.eyes) add(e.x, e.y, e.rx * 1.2 + 3, e.ry * 1.2 + 3);
  const mh = Math.max(5, f.mouth.h) * 0.6;
  add(f.mouth.x, f.mouth.y, f.mouth.w * 1.05 + 3, mh + 3);
  for (const ch of f.cheeks) add(ch.x, ch.y, ch.rx * 1.25, ch.ry * 1.25);
  if (!Number.isFinite(x0)) {
    x0 = f.cx - f.box.w * 0.3;
    x1 = f.cx + f.box.w * 0.3;
    y0 = f.cy - f.box.h * 0.34;
    y1 = f.cy + f.box.h * 0.34;
  }
  const eyeY = f.eyes.length ? f.eyes.reduce((a, e) => a + e.y, 0) / f.eyes.length : f.cy;
  const mouthBot = f.mouth.y + mh;
  const s = ctx.shape;
  return {
    zones,
    hull: { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 },
    margin: ctx.strokeW * 1.1 + 2,
    chinTop: mouthBot,
    chinBot: mouthBot + Math.max(13, mh * 1.5),
    bandTop: f.mouth.y - mh * 1.2,
    bandBot: mouthBot + 4,
    eyeY,
    // 【頭頂を禁じる理由 — 実物で確認】
    //   「器官を避けて外周へ逃がす」逃がし先の第 1 候補が真上（-90 度）で、
    //   顔の大きい個体ではそこしか空いていない。結果、牛柄が出た個体の
    //   ほとんどで頭のてっぺんに 1 つだけ暗い塊が乗り
    //   （`WLZX-HB49` `V2XQ-HFWE` `UV2L-DPB9` `UBJM-HZYU`）、
    //   絵として「鳥のフン」にしか見えなくなっていた。
    //   牛のブチは胴に散るもので、頭頂に 1 点だけ乗ることはない。
    crownY: s.topY + (s.botY - s.topY) * 0.22,
    // 【まぶたに接するのを禁じる理由 — 実物で確認】
    //   器官の楕円は「重なり」しか見ないので、目のすぐ上に **接して** 置くのは
    //   通ってしまう。`WNLS-3WMT` `5T7F-2Z62` は塊が両目の直上・まぶたの線に
    //   触れて並び、「灰色のカツラ」に見えていた。
    //   目の上端から塊の半径ぶんの間隔を必ず空ける。
    eyeTops: f.eyes.map((e) => ({ x: e.x, y: e.y - e.ry, rx: e.rx })),
  };
}

/** 点が楕円の内側か。 */
function inEllipse(e: FaceCore, x: number, y: number, pad: number): boolean {
  const dx = (x - e.cx) / Math.max(1, e.rx + pad);
  const dy = (y - e.cy) / Math.max(1, e.ry + pad);
  return dx * dx + dy * dy < 1;
}

/**
 * 塊（多角形）が器官の楕円に触れているか。
 *
 * 頂点が楕円に入っている／楕円の中心・周が塊に入っている、の両方を見る。
 * 片方だけでは「大きな塊が器官を丸ごと飲む」場合を取りこぼす。
 */
function blobHitsZone(poly: readonly Vec[], e: FaceCore, pad: number, dx: number, dy: number): boolean {
  for (const p of poly) {
    if (inEllipse(e, p.x + dx, p.y + dy, pad)) return true;
  }
  const moved = poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  if (pointInPoly(e.cx, e.cy, moved)) return true;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    if (pointInPoly(e.cx + Math.cos(a) * (e.rx + pad), e.cy + Math.sin(a) * (e.ry + pad), moved)) {
      return true;
    }
  }
  return false;
}

/**
 * 牛柄の塊を置ける場所を探す。
 *
 * 【逃がし方を「横」から作り直した理由】
 *   以前は `faceCx ± (faceBox.w*0.34 + rx*0.45)` へ寄せるだけで
 *   y を一切動かさなかった。その位置はちょうど頬で、左右に 1 つずつ並ぶと
 *   そのまま口ひげになる。ここでは
 *     1) かぶっている器官から **外向きに押し出す**（いちばん自然）
 *     2) それでも駄目なら顔の外周を回る（真下＝あごは候補にしない）
 *     3) それでも駄目なら胴の下側（あごの禁止帯より下）
 *     4) 全部だめなら 0.7 倍に縮めて 1〜3 をもう一巡
 *   の順に探す。横へ置くときは y を目の高さへ持ち上げ、「頬の斑」にする。
 *
 * @param shapePts 原点を中心に作った塊の頂点列。**縮めたときはこの配列を
 *   その場で書き換える**（呼び出し側はこの配列をそのまま描くので、
 *   返り値の位置と形が必ず一致する）。
 * @param bandUsed 口の高さの帯をすでに 1 つ使ったか。
 * @returns 置ける位置（塊の中心）。見つからなければ null（その塊は描かない）。
 */
function placeCowBlob(
  ctx: DrawCtx,
  guard: CowGuard,
  shapePts: Vec[],
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  bandUsed: boolean,
  rng: Rng,
): { x: number; y: number } | null {
  const s = ctx.shape;
  const hull = guard.hull;
  /** その位置に置いても体からほとんど出ないか。 */
  const onBody = (x: number, y: number): boolean => {
    const yy = clamp(y, s.topY, s.botY);
    return (
      Math.abs(x - s.cx) <= s.halfAt(yy) + rx * 0.55 &&
      y > s.topY - ry * 0.5 &&
      y < s.botY + ry * 0.5
    );
  };
  /** あごの禁止帯（中央付近）に中心があるか。 */
  const inChin = (x: number, y: number): boolean =>
    y > guard.chinTop && y < guard.chinBot && Math.abs(x - hull.cx) < hull.rx;
  /** 口の高さの帯（2 つ並ぶと口ひげになる）。 */
  const inBand = (y: number): boolean => y > guard.bandTop && y < guard.bandBot;
  /**
   * まぶたの真上に接している（「灰色のカツラ」）。
   *
   * 目の上端の真上（目の幅＋塊の半幅ぶんの範囲）で、
   * 隙間が塊の半径より狭ければ「接している」とみなす。
   * 横に並ぶだけなら牛のブチとして自然なので、真上だけを見る。
   */
  const onEyelid = (x: number, y: number): boolean => {
    for (const e of guard.eyeTops) {
      if (y >= e.y) continue;
      if (Math.abs(x - e.x) > e.rx + rx * 0.6) continue;
      if (e.y - y < ry + guard.margin) return true;
    }
    return false;
  };

  const ok = (x: number, y: number): boolean => {
    if (!onBody(x, y) || inChin(x, y)) return false;
    // 頭頂は禁止（「鳥のフン」）
    if (y < guard.crownY) return false;
    if (onEyelid(x, y)) return false;
    if (bandUsed && inBand(y)) return false;
    for (const z of guard.zones) {
      if (blobHitsZone(shapePts, z, guard.margin, x, y)) return false;
    }
    return true;
  };

  if (ok(x0, y0)) return { x: x0, y: y0 };

  const step = Math.max(rx, ry) * 0.45 + 4;
  // 顔の外周を回る角度。SVG 座標で -90 度が真上。
  // 真下（60〜120 度）は「やぎひげ」になるので候補に入れない。
  //
  // 【真上（-90 度）と、その両隣（-116 / -64 度）を外した理由】
  //   ここが第 1 候補だったため、顔の大きい個体では逃がした塊がそろって
  //   頭のてっぺんに着地し「鳥のフン」になっていた。頭頂は `ok()` でも
  //   禁止しているが、候補として最初に試すこと自体が
  //   「上へ逃がしてから諦める」流れを作るので、角度表からも外す。
  //   横（0 / 180 度）と斜め下（158 / 22 度）を先に試す。
  const ANGLES = [180, 0, -160, -20, 158, 22, -142, -38];
  const jitter = ANGLES.map((a, k) => ({ a, k: k + rng.float(0, 2.2) }));
  jitter.sort((p, q) => p.k - q.k);

  for (const shrink of [1, 0.7]) {
    // 1) かぶっている器官から外向きに押し出す
    for (const z of guard.zones) {
      if (!blobHitsZone(shapePts, z, guard.margin, x0, y0)) continue;
      let vx = x0 - z.cx;
      let vy = y0 - z.cy;
      const len = Math.hypot(vx, vy);
      if (len < 1) {
        vx = 0;
        vy = -1;
      } else {
        vx /= len;
        vy /= len;
      }
      for (let k = 1; k <= 5; k++) {
        const x = x0 + vx * step * k * shrink;
        const y = y0 + vy * step * k * shrink;
        if (ok(x, y)) return { x, y };
      }
    }
    // 2) 顔の外周を回る
    const reach = Math.max(rx, ry) * 1.1 + 4;
    for (const { a } of jitter) {
      const rr = rad(a);
      const ca = Math.cos(rr);
      const sa = Math.sin(rr);
      for (const push of [0, 0.4, 0.9]) {
        const x = hull.cx + ca * (hull.rx + reach * (1 + push));
        // 横へ寄せるときは目の高さへ持ち上げる（頬の斑として読ませる）
        const y =
          Math.abs(sa) < 0.4 ? guard.eyeY : hull.cy + sa * (hull.ry + reach * (1 + push));
        if (ok(x, y)) return { x, y };
      }
    }
    // 3) 胴の下側（あごの禁止帯より下）。普通の牛のブチとして読める。
    const lowY = Math.max(guard.chinBot + ry * 0.5, hull.cy + hull.ry + ry * 0.4);
    for (let k = 0; k < 6; k++) {
      const y = lerp(lowY, s.botY - ry * 0.3, k / 5);
      for (const dir of [1, -1]) {
        const x = s.cx + dir * s.halfAt(clamp(y, s.topY, s.botY)) * rng.float(0.2, 0.8);
        if (ok(x, y)) return { x, y };
      }
    }
    // 4) 縮めてもう一巡（塊を消すより小さくして残すほうが模様が保たれる）
    if (shrink === 1) {
      for (const p of shapePts) {
        p.x *= 0.7;
        p.y *= 0.7;
      }
      rx *= 0.7;
      ry *= 0.7;
    }
  }
  return null;
}

function turbulenceFilter(
  ctx: DrawCtx,
  name: string,
  freq: number,
  octaves: number,
  alphaRow: string,
  color: string,
  seedNum: number,
  /** 仕上げのぼかし半径。斑の縁を溶かして「発疹」に見せないために使う。 */
  blur = 0,
): string {
  return ctx.defs.add(name, (id) =>
    `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${n(freq)}" numOctaves="${octaves}" seed="${seedNum}" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${alphaRow}" result="m"/>` +
    `<feFlood flood-color="${color}"/>` +
    `<feComposite in2="m" operator="in"/>` +
    (blur > 0 ? `<feGaussianBlur stdDeviation="${n(blur)}"/>` : '') +
    `</filter>`,
  );
}

function fullRect(ctx: DrawCtx, filterId: string): string {
  const s = ctx.shape;
  return `<rect x="${n(s.cx - s.halfW - 8)}" y="${n(s.topY - 8)}" width="${n(s.halfW * 2 + 16)}" height="${n(s.botY - s.topY + 16)}" filter="${url(filterId)}"/>`;
}

export function buildPattern(ctx: DrawCtx): PartOut[] {
  const kinds = decompose(ctx.parts.pattern);
  if (kinds.length === 0) return [];

  const s = ctx.shape;
  const c = ctx.colors;
  const H = s.botY - s.topY;
  const density = clamp(ctx.pheno.patDensity, 0, 1);
  const scale = clamp(ctx.pheno.patScale, 0, 1);
  const multi = kinds.length > 1;
  const full = ctx.detail === 'full';
  // 『つぶあかり』が出ていれば模様の粒そのものが光る。
  // 粒は先に描き、光は最後にまとめて上へ重ねる（芯の白が粒に隠れないように）。
  const mote = moteInk(ctx);
  // 表情の芯（実際に目と口が置かれている範囲）。ヤドクガエル系の 4 種が
  // それぞれ別の方法でここを避ける。1 度だけ測って共有する。
  const core = faceCoreOf(ctx.face);
  let glowLayer = '';
  let g = `<g clip-path="${url(ctx.bodyClip)}">`;

  for (const kind of kinds) {
    const rng = ctx.rng(`pattern:${kind}`);
    switch (kind) {
      case 'spots': {
        const cnt = Math.round(lerp(5, 15, density) * (multi ? 0.6 : 1));
        const base = lerp(4.5, 12, scale) * (0.7 + ctx.pheno.size * 0.3);
        for (let i = 0; i < cnt; i++) {
          const y = s.topY + rng.float(0.1, 0.94) * H;
          const hw = s.halfAt(y);
          const x = s.cx + rng.float(-1, 1) * hw * 0.86;
          const r = base * rng.float(0.62, 1.3);
          g += path(blobPath(x, y, r, rng, 0.24, 7), {
            fill: c.pattern,
            opacity: rng.float(0.6, 0.85),
          });
          if (mote.on) glowLayer += moteGlow(mote, x, y, r * 0.6);
        }
        break;
      }
      case 'stripes': {
        // 【重要】等間隔・等幅の直線ストロークで描くと、生きものの縞ではなく
        // 印刷されたバーコードに見える。そうならないよう:
        //   1) 体の正規化幅（u = x / halfAt(y)）の上に縞を置く
        //      → 体の丸みに沿って自然に湾曲・末広がりになる
        //   2) 縞ごとに帯として描き、両端を細く絞る（テーパー）
        //   3) 幅・傾き・不透明度を 1 本ずつ揺らす
        const cnt = Math.round(lerp(3, 8, density) * (multi ? 0.7 : 1));
        const baseW = lerp(0.1, 0.26, scale);
        for (let i = 0; i < cnt; i++) {
          const u0 = ((i + 0.5) / cnt - 0.5) * 2 * rng.float(0.92, 1.06);
          const skew = rng.float(-0.16, 0.16);
          const halfU = baseW * rng.float(0.7, 1.35);
          const y0 = s.topY - 4;
          const y1 = s.botY + 4;
          const steps = 12;
          const left: Vec[] = [];
          const right: Vec[] = [];
          for (let k = 0; k <= steps; k++) {
            const t = k / steps;
            const y = lerp(y0, y1, t);
            const hw = Math.max(2, s.halfAt(y));
            // 端を細く絞る（両端で 0 にはせず、体の外へ抜ける縞も残す）
            const taper = 0.34 + 0.66 * Math.sin(Math.PI * clamp(t, 0, 1)) ** 0.6;
            const u = u0 + skew * (t - 0.5);
            left.push({ x: s.cx + (u - halfU * taper) * hw, y });
            right.push({ x: s.cx + (u + halfU * taper) * hw, y });
          }
          g += path(pathClosed([...left, ...right.reverse()]), {
            fill: c.pattern,
            opacity: rng.float(0.5, 0.76),
          });
        }
        break;
      }
      case 'speckle': {
        // ── 暖色・淡色の地で「挽き肉／カビ」に見えないようにする ──────────
        //
        // 【何が起きていたか — おきび 9 体を強制生成して確認】
        //   細かい粒（baseFrequency 0.09〜0.24）を不透明度 0.72 で敷くと、
        //   ベージュ〜黄土の地の上では **粒の 1 つ 1 つが独立した肉片**として
        //   読まれる。`HC74-P5QK` `87TW-2Y4D` `9LKK-RNE6` `RT8B-TBER` は
        //   どれも「挽き肉」「パン粉」の質感になっていた。
        //   寒色の地では同じ粒が「石の斑」に見えるので、色相帯の問題である。
        //
        //   1) 土色帯では baseFrequency を半分にする（粒が 2 倍に育つ）。
        //      大きい斑は「肉片の集合」ではなく「皮膚の模様」として読まれる。
        //   2) 不透明度を 0.72 → 0.4 まで落とす。粒の縁が地に溶け、
        //      「載っているもの」ではなく「地の色ムラ」になる。
        //
        // 【緩和の対象を「土色帯」から「暖色全域」へ広げた理由 — 実測】
        //   上の緩和は `earthy`（色相 44 ± 14 で 1.0）にしか掛かっていなかった。
        //   ところが **さんご（色相 10〜20）は対象外** で、
        //   `UBJM-HZYU` は文字どおり挽き肉、`UV2L-DPB9` `SKBD-9YM2` も同じ。
        //   `UBJM-HZYU` は 100 体シートの 1 番目のセルなので、
        //   このゲームを開いて最初に目に入る絵がそれだった。
        //   肉に見える帯は色相 340〜60。`warm` はその帯を測る係数。
        const eK = Math.max(c.earthy, c.warm);
        // 【mote との関係】feTurbulence の斑は個々の粒が要素として存在しないので
        // 光らせられない。『つぶあかり』が出ている個体はベクタ版に切り替える。
        if (full && !mote.on) {
          const f = turbulenceFilter(
            ctx,
            'pspeck',
            lerp(0.24, 0.09, scale) * lerp(1, 0.5, eK),
            2,
            `${n(lerp(5, 9, density))} 0 0 0 ${n(-lerp(2.2, 3.4, 1 - density))}`,
            c.pattern,
            rng.int(1, 90),
          );
          g += `<g opacity="${n(lerp(0.72, 0.4, eK))}">${fullRect(ctx, f)}</g>`;
        } else {
          // lite ではベクタの点に差し替える。サムネイルでも「斑がある」と
          // 読めなければ模様の意味がないので、full より粒を大きく濃くする。
          // 土色帯では full と同じ理屈で粒を大きく・薄くする。
          const cnt = Math.round(lerp(46, 130, density) * lerp(1, 0.55, eK));
          for (let i = 0; i < cnt; i++) {
            const y = s.topY + rng.float(0.04, 0.98) * H;
            const hw = s.halfAt(y);
            const x = s.cx + rng.float(-1, 1) * hw * 0.95;
            const r = lerp(1.5, 3.2, scale) * rng.float(0.7, 1.3) * lerp(1, 1.55, eK);
            g += circle(x, y, r, {
              fill: c.pattern,
              opacity: rng.float(0.55, 0.88) * lerp(1, 0.58, eK),
            });
            // 全粒を光らせると面全体が光ってしまい、しかも「発疹」に見える。
            // こまかい斑では 15% だけ、しかも小さく光らせる。
            if (mote.on && rng.bool(0.15)) glowLayer += moteGlow(mote, x, y, r * 0.62);
          }
        }
        break;
      }
      case 'dapple': {
        // ── まだら ──
        //
        // 【「発疹・カビ」から抜けるための 4 点】
        //   1. 色は palette 側で本体と同色相・明度違いだけに固定してある。
        //   2. 縁をぼかす。硬い縁の斑は皮膚病の絵そのものになる。
        //   3. 数を減らして 1 つを大きくする（小さい斑が多数＝発疹）。
        //   4. 不透明度を下げ、下の陰影が透けるようにする（体の一部に見える）。
        if (ctx.detail === 'full') {
          const f = turbulenceFilter(
            ctx,
            'pdap',
            // 周波数を下げて斑ひとつを約 1.4 倍に。
            // ここを下げすぎると斑が体より大きくなり、模様が消える（実際に消えた）。
            lerp(0.027, 0.011, scale),
            // オクターブを 3→2。細かいざらつき（＝粒状の発疹）が消える。
            2,
            // 傾きを緩める（4.5..7 → 3.2..4.4）と、しきい値の前後が
            // 半透明の帯になり、縁がやわらかく溶ける。
            `${n(lerp(3.2, 4.4, density))} 0 0 0 ${n(-lerp(1.3, 2.0, 1 - density))}`,
            c.pattern,
            rng.int(1, 90),
            2.0,
          );
          g += `<g opacity="0.8">${fullRect(ctx, f)}</g>`;
        } else {
          // lite: フィルタを使えないので、同じ塊を 3 段の大きさ・不透明度で
          // 重ねて縁のぼけを作る（外側ほど薄く大きい）。
          const cnt = Math.round(lerp(3, 6, density));
          for (let i = 0; i < cnt; i++) {
            const y = s.topY + rng.float(0.1, 0.9) * H;
            const hw = s.halfAt(y);
            const x = s.cx + rng.float(-1, 1) * hw * 0.62;
            const r = lerp(18, 34, scale) * rng.float(0.78, 1.2);
            const ry2 = r * rng.float(0.62, 0.95);
            for (const [k, op] of [[1.16, 0.2], [1.0, 0.26], [0.78, 0.3]] as const) {
              g += path(organicBlob(x, y, r * k, ry2 * k, rng, 0.22, 12), {
                fill: c.pattern,
                opacity: op,
              });
            }
          }
        }
        break;
      }
      // ── わもよう ────────────────────────────────────
      //
      // 【製品オーナー指摘 HLUD-ART6 — 「この柄はなくそう」】
      //   中心の高さが `topY + H*0.58` にほぼ固定（横も halfW*0.16 の
      //   範囲でしか動かない）で、顔を避ける仕組みが一切無かった。
      //   輪郭によってはその高さがちょうど目・口の並ぶ高さと一致し、
      //   同心円がそのまま顔に乗って「的」「傷跡」に見えていた。
      //
      // 【直し方 — `dartPebble` / `ocelli` と同じ考え方（3: 窓を探す）】
      //   置ける高さの候補をいくつか用意し、いちばん外側の輪が顔にかからない
      //   場所を探す。1 巡で見つからなければクラスタをひとまわり縮めて
      //   もう一度探す（輪の数は減らさない＝「輪が重なる」個性はそのまま残す）。
      //   最後の砦として、縮めても顔にかかる輪だけは個別に描かない
      //   （選択肢 2）。的の中心だけが消えて外側の輪が浮く歯抜けより、
      //   「そもそも顔に乗らない位置へどければ描ける輪が多い」ほうを
      //   優先したいので、位置探しを主・個別スキップを保険にしてある。
      //
      // 【判定を `faceCoreOf` の 1 枚楕円ではなく `cowGuardOf` の器官別
      //   楕円にした理由 — 実測】
      //   最初は `core`（目と口をまとめた 1 枚の外接楕円）で判定していたが、
      //   楕円は矩形の外接ではなく内接（対角線方向で角が外へはみ出す）ため、
      //   候補が「芯の外」と判定されても実際の口の bbox にわずかに触れる
      //   個体が 500 体中 14 体（2.8%）残った。とくに縦長の目 1 つ（たまご）
      //   の個体で、輪の外周が口の実際の弧をかすめていた（最大で
      //   顔 bbox の 49.5% が重なる個体もあった）。
      //   `cowGuardOf` は目・口・頬を **器官ごと** の楕円で持ち、口の高さも
      //   `mh = f.mouth.h * 0.6`（実際に描かれる弧に合わせて縮めてある）
      //   ため、`cow`／`variegate` 側の絵は変えずにここでも呼べば、
      //   より実寸に近い判定になる（`cowGuardOf` 自体は変更していない）。
      case 'rings': {
        const cnt = Math.round(lerp(2, 5, density));
        const guard = cowGuardOf(ctx);
        // 候補点が器官のどれかにどれだけ食い込んでいるか（1 以上なら安全）。
        // 複数ある器官のうち「いちばん危ない」ものだけを見る＝
        // すべての器官から離れていて初めて安全と判定する。
        //
        // 【`core`（目・口をまとめた 1 枚の外接楕円）も一緒に見る理由 — 実測】
        //   `cowGuardOf` の口の zone は実際に描かれる弧に合わせて高さを
        //   0.6 倍に縮めてある（`cow`／`variegate` の斑は面なので、口の実寸に
        //   合わせるのが正しい）。ところが輪はただの線で、口の bbox 全体を
        //   覆いはしなくても弧の外側をかすめるだけで「口の上に輪が乗っている」
        //   ように読める。zone だけで判定すると、口の bbox 下端付近を通る輪が
        //   多数残ってしまった（実測: 500 体中 85 体・17.0%）。
        //   `core` は口・目の bbox をそのまま包む楕円なので、zone とあわせて
        //   両方から離れて初めて安全とみなす（どちらも変更していない共有の値）。
        const zones: readonly FaceCore[] = [core, ...guard.zones];
        const clearanceAt = (x: number, y: number, pad: number): number => {
          let worst = Infinity;
          for (const z of zones) {
            const dx = (x - z.cx) / Math.max(1, z.rx + pad);
            const dy = (y - z.cy) / Math.max(1, z.ry + pad);
            worst = Math.min(worst, dx * dx + dy * dy);
          }
          return Number.isFinite(worst) ? worst : 1;
        };
        // いちばん外側の輪（i = cnt-1）の半径。置き場所探しはこれで見積もる。
        const outerR0 = lerp(9, 20, scale) * cnt * 0.9;
        // 候補の高さ。まず旧来の 0.58（胴の中ほど）を試し、駄目なら上下へ散らす。
        const yBands = [0.58, 0.76, 0.4, 0.86, 0.28, 0.68, 0.5, 0.2];
        let cy = s.topY + H * yBands[0]!;
        let cx0 = s.cx;
        let fit = 1;
        let placed = false;
        // 【顔が体に対して大きい個体でも「空」にしない理由 — 実測】
        //   最初の実装は「1 巡もぜんぶ外れたら topY+0.58H・fit=1（＝直す前と
        //   同じ最悪の位置）のまま」だった。そこへ下の個別スキップ（保険）を
        //   かけると、ほぼ全部の輪が顔にかかって消え、rings 500 体中
        //   74 体（成体 14.8%）・90 体（幼体 18.0%）が「輪が 1 本も無い」
        //   実質空になっていた。顔にいちばん近づけない候補でも、
        //   「その中でいちばん顔から離れている候補」を常に覚えておき、
        //   最後まで見つからなければそれを使う。個別スキップは
        //   「もっとも良い位置でもなお顔にかかる輪」だけを間引く保険として働く。
        // 横のずれも数点だけ候補にする（1 点だと、まっすぐ上下に探すだけでは
        // 見つからない「顔の横は空いている」体つきを取りこぼすため）。
        const xJitters = [0, -1, 1, -0.6, 0.6];
        let bestClear = -Infinity;
        for (const shrink of [1, 0.72, 0.5, 0.35, 0.22, 0.14]) {
          const pad = outerR0 * shrink * 0.8;
          for (const band of yBands) {
            const y = s.topY + H * band;
            for (const xj of xJitters) {
              const x = s.cx + (xj + rng.float(-0.15, 0.15)) * s.halfW * 0.16;
              const clear = clearanceAt(x, y, pad);
              if (clear > bestClear) {
                bestClear = clear;
                cy = y;
                cx0 = x;
                fit = shrink;
              }
              if (clear >= 1) {
                placed = true;
                break;
              }
            }
            if (placed) break;
          }
          if (placed) break;
        }
        for (let i = 0; i < cnt; i++) {
          const rr = lerp(9, 20, scale) * (i + 1) * 0.9 * fit;
          const ringX = cx0 + rng.float(-1, 1) * s.halfW * 0.16;
          // 保険: 縮めてもなお顔にかかる輪だけは描かない（他の輪は残す）。
          if (clearanceAt(ringX, cy, rr * 0.4) < 1) continue;
          g += ellipse(ringX, cy, rr, rr * 0.78, {
            stroke: c.pattern,
            width: lerp(2.4, 5.2, scale),
            opacity: 0.55,
          });
        }
        // 上部にも小さい輪をひとつ。同じ考え方で顔を避ける。
        const topBands = [0.22, 0.14, 0.3, 0.08];
        for (const band of topBands) {
          const ty = s.topY + H * band;
          const tx = s.cx + rng.float(-10, 10);
          const trx = lerp(6, 12, scale);
          const try2 = lerp(5, 10, scale);
          if (clearanceAt(tx, ty, Math.max(trx, try2) * 0.8) < 1) continue;
          g += ellipse(tx, ty, trx, try2, {
            stroke: c.pattern,
            width: 2.6,
            opacity: 0.42,
          });
          break;
        }
        break;
      }
      case 'veins': {
        if (ctx.detail === 'full') {
          const f = turbulenceFilter(
            ctx,
            'pvein',
            lerp(0.05, 0.02, scale),
            2,
            `${n(lerp(3, 5, density))} 0 0 0 -2.2`,
            lighten(c.pattern, 0.3),
            rng.int(1, 90),
          );
          g += `<g opacity="0.34">${fullRect(ctx, f)}</g>`;
        }
        // 葉脈は必ずベクタでも引く（形が読めることが大事）
        const rootY = s.botY - H * 0.06;
        const tipY = s.topY + H * 0.1;
        g += path(`M${n(s.cx)} ${n(rootY)}L${n(s.cx)} ${n(tipY)}`, {
          stroke: c.pattern,
          width: lerp(2, 4, scale),
          opacity: 0.6,
        });
        const branches = Math.round(lerp(4, 9, density));
        for (let i = 0; i < branches; i++) {
          const t = (i + 0.7) / (branches + 0.6);
          const y = lerp(rootY, tipY, t);
          const len = s.halfAt(y) * lerp(0.55, 0.92, 1 - t);
          for (const side of [-1, 1]) {
            const dy = -len * 0.5;
            g += path(
              `M${n(s.cx)} ${n(y)}q${n(side * len * 0.55)} ${n(dy * 0.4)} ${n(side * len)} ${n(dy)}`,
              { stroke: c.pattern, width: lerp(1.4, 2.8, scale), opacity: 0.5 },
            );
          }
        }
        break;
      }

      // ── 牛柄 ────────────────────────────────────────
      case 'cow': {
        // 【識別子としての設計】
        //   ・円ではない大きな不定形（低周波の正弦波でゆがめた閉曲線）
        //   ・3〜6 個、左右非対称、大きさもばらばら
        //   ・半分は輪郭に接して途切れる（クリップで切られる）
        //   ・地との明度差を大きく取る
        //   これで 96px のサムネイルでも「うしがら」と分かる。
        //
        // ── 顔を壊さないための守り（作り直した部分）─────────────
        //
        // 【以前なにが起きていたか — 牛柄が出た 9 体すべてで破綻】
        //   ここだけ dart 系と違い `faceBox.w*0.3 / faceBox.h*0.34` という
        //   粗い楕円で判定していた。faceBox は器なので実際の目・口とずれる。
        //   さらに余裕が半径の 0.35 倍しか無いのに、`organicBlob` の半径係数は
        //   最大 1.58 まで伸びる。中心が守備範囲の外でも突起が顔へ食い込む。
        //   逃がし先も `faceCx ± (faceBox.w*0.34 + rx*0.45)` ＝ **ちょうど頬**で、
        //   しかも y を動かさないので「口の真横に塊が 2 つ」＝口ひげになっていた。
        //
        // 【外接円ではなく「実際に描く多角形」で判定する理由 — 実測】
        //   指示は `pad = max(rx, ry) * 1.6`（＝塊の外接円）だったが、
        //   `Q5ZA-N8Y3` では 芯の半幅 52 + pad 40 = 92 に対し体の半幅が 65 で、
        //   守備範囲が体全体を覆い、**牛柄そのものが消える**個体が出た。
        //   塊の輪郭は方向によって半径 1.0〜1.58 倍と大きく変わるので、
        //   外接円は最大 1.6 倍も過大に見積もる。ここでは塊の頂点列そのものと
        //   芯の楕円で交差を見る。外接円より緩いのではなく **正確** で、
        //   実際の重なりを見逃すことはない（曲線のふくらみ分は margin で足す）。
        const strong = ctx.parts.pattern === 'bellyCow';
        // 幼体は patDensity が 0.45 倍になるが、塊が 1〜2 個では形が読めない。
        // 下限を 3 個で固定する。
        const cnt = clamp(Math.round(lerp(3, 6, density)) + (strong ? 1 : 0), 3, 7);
        // 明暗で別の色を使う。CSS 変数はインク（--gm-ink）と同じ仕組みで、
        // `model.ts` / `egg.ts` が `inkThemeStyle` の extra として流し込む。
        const cowPair = cowColor(ctx);
        ctx.themeVars.cow = [cowPair.light, cowPair.dark];
        const col = `var(--gm-cow,${cowPair.light})`;
        // 【0.16 を外した理由】
        //   最初の塊の基準高さが頭頂（0.16H）だったので、そこが空いていれば
        //   そのまま「頭のてっぺんの 1 点」になっていた。
        //   基準を胴の側へ寄せ、頭頂の禁止帯（0.22H）に最初から入らないようにする。
        const bands = [0.34, 0.58, 0.76, 0.92, 0.44, 0.66, 0.86];
        const guard = cowGuardOf(ctx);
        // 口の高さの帯は 1 つまで。2 つ並ぶとそれだけで口ひげになる。
        let bandUsed = false;
        for (let i = 0; i < cnt; i++) {
          const edge = i % 2 === 1;
          const y0 = s.topY + H * clamp(bands[i]! + rng.float(-0.06, 0.06), 0.04, 0.95);
          const hw = Math.max(6, s.halfAt(y0));
          const side = rng.bool() ? 1 : -1;
          const ux = edge ? side * rng.float(0.7, 1.06) : rng.float(-0.52, 0.52);
          const x0 = s.cx + ux * hw;
          const rx = lerp(0.3, 0.5, scale) * s.halfW * rng.float(0.76, 1.32) * (strong ? 1.1 : 1);
          const ry = rx * rng.float(0.6, 1.06);
          // 原点で形を作っておき、置き場所は平行移動で決める
          // （同じ塊を何度も作り直すと rng の消費が位置に依存してしまう）。
          const shapePts = organicBlobPoints(0, 0, rx, ry, rng, 0.34, 14);
          const spot = placeCowBlob(ctx, guard, shapePts, x0, y0, rx, ry, bandUsed, rng);
          if (!spot) continue;
          if (spot.y > guard.bandTop && spot.y < guard.bandBot) bandUsed = true;
          // 【不透明にする理由】
          //   以前は 0.92 で乗せていたが、合成で色が地へ引かれるぶん
          //   `cowColor()` が保証したコントラストが実画面では崩れていた
          //   （実 DOM 実測で 100 体中 15 体が 3.0 未満）。
          //   牛の斑はもともと不透明なので、透かす必然性がない。
          //   不透明にすれば「選んだ色 ＝ 画面に出る色」になり保証が素直に効く。
          g += path(
            pathClosed(shapePts.map((p) => ({ x: p.x + spot.x, y: p.y + spot.y }))),
            { fill: col },
          );
        }
        break;
      }

      // ── ふいり（斑入り） ────────────────────────────
      //
      // 【`cow` からコピーした理由 — リード指示】
      //   骨格（低周波の波で歪めた不規則な塊・3〜7 個・左右非対称・
      //   顔を避ける仕組み・輪郭に接して途切れる）は `case 'cow'` と
      //   完全に同じにする。「`cow` の描画コードそのものは変更しない」
      //   という指示があるため、共通化のために `cow` 側を書き換えるのではなく、
      //   このブロックを丸ごとコピーして別ケースとして持つ。
      //   呼んでいる `organicBlobPoints` / `cowGuardOf` / `placeCowBlob` は
      //   どれも `cow` 専用のロジックではなく、塊の形・置き場所を扱う
      //   汎用の共有関数（`cow` が最初に使い始めただけ）なので、
      //   ここから呼んでも `cow` の見た目には一切影響しない。
      //
      // 【`cow` と違うのは色だけ】
      //   `variegateColor()` がアクセント色相から作った、地とは別の
      //   鮮やかな色を使う（`cow` は本体色相を彩度落としした無彩色）。
      //   `strong`（腹白＋牛柄の強調）に相当する仕組みは無い
      //   （`genetics/loci.ts` の coExpress に `belly+variegate` は無いので不要）。
      case 'variegate': {
        const cnt = clamp(Math.round(lerp(3, 6, density)), 3, 7);
        // 明暗で別の色を使う。cow と同じ CSS 変数の仕組み（`--gm-variegate`）。
        const variegatePair = variegateColor(ctx);
        ctx.themeVars.variegate = [variegatePair.light, variegatePair.dark];
        const vcol = `var(--gm-variegate,${variegatePair.light})`;
        const vBands = [0.34, 0.58, 0.76, 0.92, 0.44, 0.66, 0.86];
        const vGuard = cowGuardOf(ctx);
        let vBandUsed = false;
        for (let i = 0; i < cnt; i++) {
          const edge = i % 2 === 1;
          const y0 = s.topY + H * clamp(vBands[i]! + rng.float(-0.06, 0.06), 0.04, 0.95);
          const hw = Math.max(6, s.halfAt(y0));
          const side = rng.bool() ? 1 : -1;
          const ux = edge ? side * rng.float(0.7, 1.06) : rng.float(-0.52, 0.52);
          const x0 = s.cx + ux * hw;
          const rx = lerp(0.3, 0.5, scale) * s.halfW * rng.float(0.76, 1.32);
          const ry = rx * rng.float(0.6, 1.06);
          const shapePts = organicBlobPoints(0, 0, rx, ry, rng, 0.34, 14);
          const spot = placeCowBlob(ctx, vGuard, shapePts, x0, y0, rx, ry, vBandUsed, rng);
          if (!spot) continue;
          if (spot.y > vGuard.bandTop && spot.y < vGuard.bandBot) vBandUsed = true;
          g += path(
            pathClosed(shapePts.map((p) => ({ x: p.x + spot.x, y: p.y + spot.y }))),
            { fill: vcol },
          );
        }
        break;
      }

      // ── ヤドクガエル: たいおび ───────────────────────
      case 'dartBand': {
        // 太い帯が体を横切る。キオビヤドクガエル的な、暗い地に鮮やかな帯。
        // 帯は既存の縞と同じく正規化幅の上に置き、体の丸みに沿って湾曲させる。
        //
        // ── 帯を胴の中央帯に閉じ込める ────────────────────────
        //
        // 【「帽子と靴下」の正体 — 強制生成 9 体すべてで発生】
        //   置ける高さを 0.12〜0.9 と広く取っていたため、顔を避けた帯が
        //   必ず上端か下端へ寄り、頭頂に色の帯（＝ニット帽）か
        //   裾に色の帯（＝靴下）になっていた。体の丸みで端ほど帯が短くなり、
        //   さらに輪郭で切られるので、「巻いた帯」ではなく「被った／履いた」
        //   ものとして読まれる。実際の矢毒蛙の帯は **胴の中ほど** を巻く。
        //   上下端の 15% を禁止し、置ける帯域を胴の中央〜下に限る。
        /** 上端 15% は帯の中心を置いてはいけない（裾側はスロットごとに決める）。 */
        const yLimLo = s.topY + H * 0.15;
        /** 目の上下端。帯が唯一避けなければならない範囲。 */
        let eyeTop = Infinity;
        let eyeBot = -Infinity;
        for (const e of ctx.face.eyes) {
          eyeTop = Math.min(eyeTop, e.y - e.ry);
          eyeBot = Math.max(eyeBot, e.y + e.ry);
        }
        if (!Number.isFinite(eyeTop)) {
          eyeTop = core.cy - core.ry;
          eyeBot = core.cy + core.ry;
        }
        // ── 口の高さの帯を「置いてよい場所」から外す ────────────────
        //
        // 【「口紅・道化の口」の正体 — 強制生成 9 体すべてで発生】
        //   置ける帯域を 0.52〜0.82H に閉じ込めたのは「帽子と靴下」を消すため
        //   だったが、**多くの素体では口がちょうどこの帯域にある**。
        //   結果、帯が口の高さに一致し、口の周りだけ鮮やかな色が横切る
        //   ＝ 口紅（`UBJM-HZYU` `HLLG-LHHJ` `UV2L-DPB9` `BMH5-AL2U`）、
        //   あるいは あごひげ（`SKBD-9YM2` `WLZX-HB49`）になっていた。
        //   帯は「目を避ければよい」ではなく「顔の器官の高さを避ける」もの。
        //   口の **実寸**（`MOUTH_UP_RATIO` / `MOUTH_DOWN_RATIO`）で禁止帯を作り、
        //   そこを外した残りを「胸」と「腰」の 2 スロットとして使う。
        // `mouthSpan` は輪郭線の太さを含んだ実寸なので、余白はごく小さくてよい。
        // ここを厚く取ると、口の低い素体で腰の窓が閉じて帯が額へ逃げる。
        const mPad = 2;
        const mSpan = mouthSpan(ctx);
        const banTop = mSpan.top - mPad;
        const banBot = mSpan.bot + mPad;
        // 【本数を 1〜3 → 1〜2 に絞った理由 — 抜本的な作り直し】
        //   参考写真（image21）の帯は「体を覆うほど太い帯が 1〜2 本」で、
        //   細い帯が何本も並ぶ絵ではない。同じ窓を 3 本で分けると
        //   1 本あたりの太さの上限（`maxHalf`）が下がり、密度が高い個体ほど
        //   かえって帯が細くなってしまう。本数を減らし、そのぶん 1 本を太くする。
        let cnt = clamp(Math.round(lerp(1, 2, density)), 1, 2);
        const cyMid = s.topY + H * 0.5;
        // ── 置ける窓を先に決めてから、そこへ収まる太さで引く ────────────
        //
        // 【「重なったら逃がす」をやめた理由 — 実物で確認】
        //   逃がし方式は「窓が狭い個体では逃がし先も無い」ので、
        //   口の禁止帯を足したとたん **6 体中 5 体で帯が消えた**。
        //   模様が消えるのは口紅と同じくらい重い破綻（たいおびが たいおび でなくなる）。
        //   窓（＝置いてよい範囲）を先に測り、cnt 本がそこに収まる太さへ
        //   自動的に細めれば、禁止帯を守ったまま必ず引ける。
        //
        // 【スロットに優先順位を付けた理由 — 実測して分かった素体の事情】
        //   この生きものは「ほぼ頭」なので、口の下端は体の高さの
        //   **0.66〜0.99** に来る（6 体の実測）。つまり口より下に胴が
        //   ほとんど無い個体が普通にある。
        //     `UBJM-HZYU` 口の下端 0.99H（口が体の底に届く）
        //     `SKBD-9YM2` 0.84H ／ `WLZX-HB49` 0.83H ／ `BMH5-AL2U` 0.79H
        //   だから「腰へ寄せる」だけでは半分以上の個体で帯が消える。
        //     1) 腰（口の禁止帯の下）… いちばん自然。まずここ。
        //     2) 胸の上（目と口のあいだ）… 口が低い個体はここ。
        //     3) 額（目の上）… 口が体の底まで届く個体の最後の逃げ場。
        //        頭頂 0.12H より下に中心を置き、帯を細くして「ニット帽」を避ける。
        /** これ以下に細めると帯ではなく線に見える下限。 */
        const MIN_HALF = Math.max(2.8, H * 0.022);
        const eyeTopLim = eyeTop - 4;
        const slots: [number, number][] = [
          // 1) 腰。裾は 4% まで許す（帯は輪郭で切られるので「靴下」にはならない）。
          //    ここを 15% のままにすると、口が低い素体では窓が閉じて
          //    帯が額（＝はちまき）へ追い出される。腰を先に取れるようにする。
          [Math.max(yLimLo, banBot, eyeBot + 4), s.botY - H * 0.04],
          // 2) 胸の上（目と口のあいだ）
          [Math.max(yLimLo, eyeBot + 4), banTop],
          // 3) 額（目の上）。頭頂は空ける。
          [s.topY + H * 0.12, eyeTopLim],
        ];
        let winTop = 0;
        let winBot = -1;
        for (const [a, b] of slots) {
          if (b - a >= MIN_HALF * 2.6) {
            winTop = a;
            winBot = b;
            break;
          }
        }
        let win = winBot - winTop;
        /** フォールバック（太さの妥協）で描いているかどうか。半径の求め方だけ変える。 */
        let usingFallback = false;
        if (win < MIN_HALF * 2.6) {
          // ── 最終フォールバック: 「窓が無ければ諦める」をやめる ──────────
          //
          // 【なぜ必要か — 実測】
          //   3 スロットすべてが `MIN_HALF*2.6`（≒7.3px）未満になる個体で、
          //   今までは帯を 1 本も描いていなかった（500 体中 30 体 = 6.0%）。
          //   実測すると、この 30 体は「3 スロットとも負」ではなく、
          //   最も広いスロットが 1〜7px と僅かに足りないだけだった
          //   （腰スロットの下限 `s.botY - H*0.04` と口の禁止帯がぎりぎり
          //   詰まっている個体が大半）。目・口を避ける判定は変えず、
          //   太さの下限だけを大きく緩めて、その僅かな窓へ必ず 1 本だけ引く。
          usingFallback = true;
          let bestTop = slots[0]![0];
          let bestBot = slots[0]![1];
          for (const [a, b] of slots) {
            if (b - a > bestBot - bestTop) {
              bestTop = a;
              bestBot = b;
            }
          }
          if (bestBot - bestTop < 4) {
            // 3 スロットとも実質ゼロ以下（目がほぼ体を覆う極端な個体）。
            // 口の禁止帯だけは緩め、体の裾ぎりぎりまで許す
            // （唯一の絶対条件「目に重ならない」は守ったまま）。
            const emTop = Math.max(eyeBot + 4, banBot);
            const emBot = s.botY - 1;
            if (emBot - emTop >= 4) {
              bestTop = emTop;
              bestBot = emBot;
            } else {
              // それでも無ければ、目だけを避けて裾ぎりぎりへ強制的に置く。
              bestTop = eyeBot + 4;
              bestBot = emBot;
            }
          }
          winTop = bestTop;
          winBot = bestBot;
          win = winBot - winTop;
          cnt = 1; // 太さを確保するため、フォールバックは必ず 1 本にする。
        }
        // ここまでで確保できなければ、本当に置き場がない極端な例外として諦める
        // （実測 500 体では発生しなかった）。1.3px 半径 × 2.6 が視認できる下限。
        if (win < 3.4) break;
        /** cnt 本を窓に均等配分したときの 1 本あたりの上限。 */
        const maxHalf = win / (2.6 * cnt);
        // 【太さを 0.055〜0.105H → 0.11〜0.19H に倍増した理由】
        //   旧実装は体の高さの 1 割強しかなく、パステル色と相まって
        //   「腹にうっすら乗った線」にしか見えなかった（製品オーナー指摘）。
        //   参考写真の帯は体幅の半分近くを占める迫力があるので、
        //   窓が許すぎりぎりまで太らせる（`maxHalf` が上限を保証する）。
        //
        // 【フォールバックだけ別式にした理由】
        //   通常式は `MIN_HALF` を下限に強制するため、窓が `MIN_HALF*2.6` を
        //   下回るフォールバックの窓では `half` が窓からはみ出しかねない
        //   （＝目・口の禁止帯を踏み越える）。フォールバックでは `maxHalf`
        //   そのものを上限にして、窓からのはみ出しを構造的に防ぐ。
        for (let i = 0; i < cnt; i++) {
          const half = usingFallback
            ? clamp(win * 0.4, 1.3, Math.max(1.3, maxHalf))
            : clamp(
                H * lerp(0.11, 0.19, scale) * rng.float(0.88, 1.18),
                MIN_HALF,
                Math.max(MIN_HALF, maxHalf),
              );
          const yc = winTop + (win * (i + 0.5)) / cnt;
          // 中心より上の帯は端が持ち上がり、下の帯は端が垂れる（球に巻いた輪）。
          // 係数を上げるほど「体に巻きついている」立体感が強くなる。
          const amp = 16 * ((yc - cyMid) / (H * 0.5));
          const steps = 20;
          const top: Vec[] = [];
          const bot: Vec[] = [];
          // 縁を小さくうねらせる（定規で引いた直線ではなく、皮膚に乗った帯にする）。
          const edgePh = rng.float(0, TAU);
          const edgeAmp = half * rng.float(0.05, 0.12);
          for (let k = 0; k <= steps; k++) {
            const u = -1.2 + (2.4 * k) / steps;
            const x = s.cx + u * s.halfW * 1.05;
            const yy = yc + amp * u * u;
            const th = half * (1 + 0.2 * (1 - Math.min(1, u * u)));
            const wob = Math.sin(k * 1.7 + edgePh) * edgeAmp;
            top.push({ x, y: yy - th + wob });
            bot.push({ x, y: yy + th + wob * 0.7 });
          }
          g += path(pathClosed([...top, ...bot.reverse()]), { fill: c.pattern, opacity: 1 });
        }
        break;
      }

      // ── ヤドクガエル: あみめ ─────────────────────────
      //
      // 【全面作り直し — 「ひび割れた土」から「融合した網目」へ】
      //   旧実装は交点をゆらした格子から**細い線**を引いていた。線である以上、
      //   目が少しでも粗いとそのまま「ひび割れ」「メロンの皮」に見える
      //   （`こうせき/mineral` 質感の稜線と同じ見た目になっていた＝製品オーナー指摘）。
      //   参考写真（image20/24）を見ると、実際の網目は「線」ではなく
      //   **丸みを帯びた黒い塊が寄り集まり、隙間だけ地色が覗く**面である。
      //   線ではなく面（塗りつぶした不定形の塊）を格子状に並べて隣と重ねれば、
      //   重なった部分が自然に融合し、狙った見た目に一致する。
      case 'dartNet': {
        const cols = Math.round(lerp(6, 9, density)) + (full ? 1 : 0);
        const rows = Math.round(lerp(7, 10, density)) + (full ? 1 : 0);
        const jx = (s.halfW * 1.7) / cols;
        const jy = (H * 0.85) / rows;
        // 【格子の間隔自体をばらつかせる】
        //   等間隔の格子に頂点ジッタだけ足すと、塊の大きさがどれも同じになり
        //   規則的な水玉に見える。行と列の幅そのものを乱すと、
        //   大きい塊と小さい塊が混ざった生きものの網目になる。
        //   振れ幅は最大差 2 倍以内に抑える（極端な 1 マスだけが割れ目に見えないよう）。
        const spans = (cnt: number): number[] => {
          const w = Array.from({ length: cnt }, () => rng.float(0.72, 1.4));
          const total = w.reduce((a, b) => a + b, 0);
          const acc: number[] = [0];
          let run = 0;
          for (const v of w) {
            run += v / total;
            acc.push(run);
          }
          return acc;
        };
        const rowT = spans(rows);
        const colT = spans(cols);
        const grid: Vec[][] = [];
        for (let r = 0; r <= rows; r++) {
          const row: Vec[] = [];
          const yy = s.topY - 5 + (H + 10) * rowT[r]!;
          for (let q = 0; q <= cols; q++) {
            const xx = s.cx - s.halfW - 7 + (s.halfW * 2 + 14) * colT[q]!;
            row.push({ x: xx + rng.float(-0.5, 0.5) * jx, y: yy + rng.float(-0.5, 0.5) * jy });
          }
          grid.push(row);
        }
        // ── 顔の上では塊を小さく薄くする ──────────────────────
        //
        // 【なぜ要るか（リードが実物で確認した指摘）】
        //   網目は本体の輪郭インクに近い黒なので、目のあいだ・口の上を
        //   埋めると目と口がその模様に飲まれる。`faceSoft` で芯へ近づくほど
        //   なめらかに小さく・薄くし、切り落とさず自然に消えるようにする
        //   （切り落とすと「網の服から顔だけ出す」不自然な絵になる）。
        // 【土色帯だけ薄めずに縮める理由 — 実測に基づく】
        //   顔の上で塊を弱めるとき、「薄くする」と「縮める」は同じだけ弱めても
        //   見え方が違う。薄めた黒は地と混ざり地の色相のまま暗くなるだけなので、
        //   暖色の地（橙〜黄）では地と混ざった黒が **茶** に見える
        //   （実測 D-025 系の知見と同じ現象）。土色帯では薄めずに縮め、
        //   線が黒いまま小さくなることで「茶色いにじみ」を避ける。
        const eK = c.earthy;
        /** 芯の上での大きさの倍率（土色帯ほど小さく）。 */
        const scaleFloor = 0.22 - 0.1 * eK;
        /** 芯の上での不透明度の倍率（土色帯ほど濃いまま）。 */
        const oFloor = 0.22 + 0.3 * eK;
        interface Cell { cx: number; cy: number; rx: number; ry: number; skip: boolean }
        const cells: (Cell | null)[][] = [];
        for (let r = 0; r < rows; r++) {
          const rowCells: (Cell | null)[] = [];
          for (let q = 0; q < cols; q++) {
            const p00 = grid[r]![q]!;
            const p01 = grid[r]![q + 1]!;
            const p10 = grid[r + 1]![q]!;
            const p11 = grid[r + 1]![q + 1]!;
            const cx = (p00.x + p01.x + p10.x + p11.x) / 4;
            const cy = (p00.y + p01.y + p10.y + p11.y) / 4;
            const hx = (Math.abs(p01.x - p00.x) + Math.abs(p11.x - p10.x)) / 4;
            const hy = (Math.abs(p10.y - p00.y) + Math.abs(p11.y - p01.y)) / 4;
            // 隣の塊とちょうど重なるよう、セルの半分よりわずかに大きく取る
            // （これが「融合してつながる」の正体）。まれに大きく育てて
            // 参考写真のような大きな融合パッチも作る。まれに間引いて
            // 隙間の大きさにも自然なばらつきを持たせる。
            //
            // 【重なり係数を 1.24 → 1.06 に下げた理由 — 実測して確認】
            // 　1.24 だと隣接セルすべてが常に大きく重なり、体の大半が
            // 　真っ黒に塗りつぶれて地色がほとんど覗かない個体が多発した
            // 　（`橋` と合わせると特に顕著）。地が覗く「網目」であるためには
            // 　塊どうしは軽く触れる程度に留め、繋がりは主に `bridge` で作る。
            let mul = rng.float(0.68, 0.98);
            if (rng.bool(0.12)) mul *= rng.float(1.2, 1.45);
            const skip = rng.bool(0.07);
            rowCells.push({ cx, cy, rx: hx * 1.06 * mul, ry: hy * 1.06 * mul, skip });
          }
          cells.push(rowCells);
        }
        const drawBlob = (cell: Cell): void => {
          if (cell.skip) return;
          const soft = faceSoft(core, cell.cx, cell.cy);
          const sc = lerp(1, scaleFloor, soft);
          const rx = cell.rx * sc;
          const ry = cell.ry * sc;
          if (rx < 1.1 || ry < 1.1) return;
          g += path(organicBlob(cell.cx, cell.cy, rx, ry, rng, 0.3, 11), {
            fill: c.pattern,
            opacity: rng.float(0.94, 1) * lerp(1, oFloor, soft),
          });
        };
        // 隣接する塊どうしを太い「橋」でつなぐ。塊単体の重なりだけでは
        // 間隔がばらついた格子で隙間が残ることがあるため、橋で必ず地続きにする。
        const bridge = (a: Cell, b: Cell): void => {
          if (a.skip || b.skip) return;
          const mx = (a.cx + b.cx) / 2;
          const my = (a.cy + b.cy) / 2;
          const soft = faceSoft(core, mx, my);
          const wid = Math.min(a.rx + a.ry, b.rx + b.ry) * 0.22 * lerp(1, scaleFloor, soft);
          if (wid < 1) return;
          const dx = b.cx - a.cx;
          const dy = b.cy - a.cy;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * wid;
          const ny = (dx / len) * wid;
          g += path(
            pathClosed([
              { x: a.cx + nx, y: a.cy + ny },
              { x: b.cx + nx, y: b.cy + ny },
              { x: b.cx - nx, y: b.cy - ny },
              { x: a.cx - nx, y: a.cy - ny },
            ]),
            { fill: c.pattern, opacity: rng.float(0.92, 1) * lerp(1, oFloor, soft) },
          );
        };
        for (let r = 0; r < rows; r++) {
          for (let q = 0; q < cols; q++) {
            const cell = cells[r]![q]!;
            drawBlob(cell);
            if (q + 1 < cols && !rng.bool(0.22)) bridge(cell, cells[r]![q + 1]!);
            if (r + 1 < rows && !rng.bool(0.26)) bridge(cell, cells[r + 1]![q]!);
          }
        }
        break;
      }

      // ── ヤドクガエル: したたり ───────────────────────
      case 'dartDrop': {
        // 上から滴が垂れたような縦の流れ。長さ・太さ・膨らむ位置がすべて違う。
        //
        // 【顔を避ける必要があった理由 — 実物で確認】
        //   滴は体の上端から下へ真っすぐ流れるので、中央付近の 1〜2 本が
        //   必ず顔の真上を通る。網目（dartNet）と違って**面**なので、
        //   細く薄くする逃げ方が使えない（色の塊が目と口に残る）。
        //   `Z2G5-RRL7` `C2T7-U9L6` は顔全体が滴に覆われ、
        //   目も口も滴の中に沈んで表情がまったく読めなかった。
        //
        // 【逃がし方を 3 段にした理由】
        //   一律に「顔の手前で止める」と全個体で額に短い滴が並び、
        //   前髪のような同じ絵になる。実際のヤドクガエルの流れ模様も
        //   頭を避けて体側を流れたり、あごの下から始まったりする。
        //     1) まず横へずらす（体側を流れる。いちばん自然）
        //     2) 駄目なら額で止める（顔の手前で途切れる）
        //     3) それも駄目ならあごの下から流す（胸〜腹の滴）
        //   どれも成立しないほど顔が大きい個体でだけ、その滴を描かない。
        //
        // ── 「サイド髪」から抜けるための 3 つの制約 ────────────────
        //
        // 【何が起きていたか — 強制生成 9 体のうち 6 体で発生】
        //   ・開始 y が全滴 `topY + H×(-0.02..0.14)` ＝ ほぼ上端に揃っていた
        //   ・顔を避けるときの逃がし先が `core.rx + wBase×1.5 + 3` の固定値で、
        //     左右どちらへ逃がしても **顔のすぐ外の同じ x** に着地した
        //   結果、上端から始まる太い帯が顔の左右に 1 本ずつ垂れ、
        //   `B4KQ-YHUV`（桃）`HG8G-W7HU`（水色）`FDLZ-T9CU`（薄荷）
        //   `NGPT-US8Q`（青）`LTQJ-GP3L`（藤）はどれも
        //   「ボブカットの前髪」にしか見えなくなっていた。
        //
        //   1) 開始 y を体の上半分いっぱい（0〜0.5）に散らす。
        //      上端から始まる滴は 1 本まで。
        //   2) 同じ高さの帯に左右対称で 2 本並べない（対称＝髪の分け目）。
        //   3) 横への逃がしは 2 本まで。以降は額で止めるか、あごの下から流す。
        //
        // ── ここから作り直し: 「嘔吐・よだれ・裂傷」から抜けるための 3 条件 ──
        //
        // 【何が起きていたか — 強制生成で確認】
        //   上の「1 本ずつ独立に置いて、駄目なら逃がす」やり方は、
        //   結果として **本数 1〜2 本・長さバラバラ・左右非対称** の滴を作る。
        //   人は体に付いた「不規則で少数の垂れ」を模様とは読まない。
        //     `HLLG-LHHJ` … 口の直下に 1 本だけ短く垂れる → 口から垂れる液体
        //     `UV2L-DPB9` `UBJM-HZYU` … 顔の側面を斜めに走る 1 本 → 裂傷
        //     `BMH5-AL2U` … 左右の裾から下へ垂れる → 溶け落ちている
        //   模様として読ませるには規則が要る。
        //     1) 左右対称（対で置く）
        //     2) すべて同じ長さ・同じ太さ
        //     3) 3 本以上（＝2 対以上。1〜2 本は「垂れ」であって模様ではない）
        //   そのうえで **口の高さから下へは出さない**。口の下から始まる／
        //   口の高さを越えて垂れる滴は、何本あっても「よだれ」に見える。
        //
        // ── さらに作り直し: 「毛・触角」から抜けて涙滴形の鎖にする ──────
        //
        // 【何が起きていたか — 実測】
        //   上まで作った版は「対称・同長・同太さ」の規則は満たしたが、
        //   1 本の線として頭から股まで細く長く伸びていたため、
        //   結局は「体から生えた毛・触角」に見えていた
        //   （製品オーナー指摘: 現状は毛のよう）。太さが `wBase` 一定のまま
        //   端から端まで伸びるので、どこにも「しずくらしい丸み」が無かった。
        //
        // 【対応】
        //   1 本の長い線ではなく、**先端が尖り根元が丸い涙滴を 2〜3 個
        //   すこし隙間を空けて縦に並べた鎖**にする。個々の涙滴が
        //   「太さのある丸み」を持つので、遠目にも毛ではなく斑紋として読める。
        //   位置決め（芯を避ける・対で置く・窓を探す）のロジックは
        //   実物で検証済みなのでそのまま流用し、**最後の描画だけ**を作り直す。
        const steps = 14;
        /** 口の実寸（上端・下端）。滴は通常ここより下へ出さない（フォールバック時を除く）。 */
        const mSpan = mouthSpan(ctx);
        const mouthTop = mSpan.top;
        const yTop = s.topY + H * 0.02;
        /** 下限の候補: 口の直前 → 中間 → 目の上（顔の大きい個体用）。 */
        const capBot = Math.min(mouthTop - 4, s.botY - H * 0.05);
        const eyeBot = core.cy - core.ry - 5;
        // 【太さを 0.062〜0.108 → 0.12〜0.19 に増やした理由】
        //   「毛」に見えていた最大の原因は細さそのもの。参考写真の しずく状の
        //   斑紋は体幅の 1〜2 割の太さを持つ面であり、線ではない。
        //
        // 【最初 0.14〜0.23・ww=wBase×1.45 で試して撤回した理由 — 実測】
        //   顔よけ判定 `pairCrosses` に渡す安全半径 `ww` は目の楕円をその分
        //   膨らませて回避するため、大きくしすぎると回避できる `uu` が
        //   ほぼ無くなり、**9 体中 8 体で滴が 1 本も描かれなかった**
        //   （実際にスクリーンショットで確認）。太さと安全半径の両方を
        //   引き下げ、実際に描く涙滴の最大幅（後述のビーズ幅×太り具合の
        //   実測上限、おおむね 1.2 倍前後）に近い値まで絞った。
        const wBase = s.halfW * lerp(0.12, 0.19, scale);
        const wave = rng.float(0.03, 0.055);
        /**
         * 滴の中心線。`side` を掛けて左右対称にする
         * （うねりも符号ごと反転するので、対が鏡像になる）。
         * `ww` は顔よけ判定（`pairCrosses`）専用の安全半径で、実際に描く
         * 涙滴ビーズの太り切ったときの半幅に近い定数を返す。
         */
        const at = (uu: number, side: number, yy0: number, ll: number, t: number) => {
          const y = yy0 + ll * t;
          const hw = Math.max(3, s.halfAt(y));
          const u = side * (uu + Math.sin(t * 3.1 + uu * 4.3) * wave);
          return { x: s.cx + u * hw, y, ww: wBase * 1.05 };
        };
        /**
         * その |u| で置いた対が、左右どちらかでも **目** にかかるか。
         *
         * 【避ける対象を「表情の芯」から目だけに変えた理由】
         *   芯（`faceCoreOf`）は口の bbox まで含むので、口の大きい個体では
         *   半幅が体の半幅に迫る。滴はもともと口の高さより下へ出さないので、
         *   口とぶつかりようがないのに、その芯を避けようとして
         *   **どの |u| でも通せず**、額の短い滴＝「帽子」に落ちていた
         *   （`HLLG-LHHJ` `UBJM-HZYU`）。滴が潰しうるのは面である目だけ。
         */
        const eyeZones: FaceCore[] = ctx.face.eyes.map((e) => ({
          cx: e.x,
          cy: e.y,
          rx: e.rx + 2,
          ry: e.ry + 2,
        }));
        const pairCrosses = (uu: number, yy0: number, ll: number): boolean => {
          for (const side of [-1, 1]) {
            for (let k = 0; k <= steps; k++) {
              const p = at(uu, side, yy0, ll, k / steps);
              for (const z of eyeZones) {
                if (inEllipse(z, p.x, p.y, p.ww)) return true;
              }
            }
          }
          return false;
        };
        /** 対の数。密度が高い個体では 3 対まで狙うが、入らなければ後で減らす。 */
        const pairsWant = clamp(Math.round(lerp(2, 3, density)), 2, 3);
        /** 対どうしの最小間隔（正規化幅）。 */
        const GAP = 0.13;
        /**
         * いちばん内側の対でも、体の中央からこれだけは離す。
         *
         * 【下限を設ける理由 — 実物で確認】
         *   芯を避けられる最小の |u| をそのまま起点にすると、顔の小さい個体では
         *   0.1 前後になり、4〜6 本の滴が額の中央に束になって並ぶ。
         *   そのうえ滴が短い（目の上で止まる）と、模様ではなく
         *   **前髪・かつら** にしか見えない（`HLLG-LHHJ` `UBJM-HZYU` `WLZX-HB49`）。
         *   体の幅いっぱいに散らして初めて「体を流れる模様」として読める。
         */
        const U_INNER = 0.32;
        const U_OUTER = 0.94;
        /**
         * 【対の数を「入らなければ減らす」フォールバックにした理由 — 実測】
         *   この生きものは「ほぼ頭」の素体が多く、目そのものが体幅の
         *   かなりの割合を占める（`yurei` の一つ目・大目など）。
         *   窓の探索を density 由来の対数（2〜3）で固定していたところ、
         *   30 体中 27 体で全 3 段の窓すべてが失敗し、**模様が一切描かれなかった**
         *   （実際にシートを生成して確認）。3 対 → 2 対 → 1 対の順に緩め、
         *   1 対でも入らない窓だけを諦める。1 対（＝しずく 2 個の対称）でも
         *   「毛」ではなく「模様」として十分読める太さ・丸みにしてある。
         */
        /**
         * 1 個の涙滴を描く。`t0`→`t1` は流線上の局所区間（0..1）。
         * 先端（区間の始点）は細く尖らせ、根元（区間の終点）へ向けて
         * 太らせ、最後に半円状の張り出しを 1 点足して丸い底にする。
         */
        const beadSteps = 10;
        const drawBead = (
          uu: number,
          side: number,
          yy0: number,
          ll: number,
          t0: number,
          t1: number,
          wid: number,
        ): void => {
          const left: Vec[] = [];
          const right: Vec[] = [];
          for (let k = 0; k <= beadSteps; k++) {
            const lt = k / beadSteps;
            const t = t0 + (t1 - t0) * lt;
            const p = at(uu, side, yy0, ll, t);
            const w = wid * (0.12 + 1.05 * Math.pow(Math.sin((lt * Math.PI) / 2), 0.8));
            left.push({ x: p.x - w, y: p.y });
            right.push({ x: p.x + w, y: p.y });
          }
          const lastL = left[left.length - 1]!;
          const lastR = right[right.length - 1]!;
          const bx = (lastL.x + lastR.x) / 2;
          const by = Math.max(lastL.y, lastR.y) + wid * 0.6;
          g += path(pathClosed([...left, { x: bx, y: by }, ...right.reverse()]), {
            fill: c.pattern,
            opacity: rng.float(0.93, 1),
          });
        };
        /** 通常探索（3段の高さ×3〜1対）でどれか 1 つでも描けたか。 */
        let drew = false;
        outer: for (const yBot of [capBot, (capBot + eyeBot) / 2, eyeBot]) {
          const len = yBot - yTop;
          if (len < H * 0.14) continue;
          for (let pairs = pairsWant; pairs >= 1; pairs--) {
            // 芯を避けられる最小の |u| を探す。ここを起点に外へ等間隔で並べる。
            let uMin = -1;
            for (let u = U_INNER; u <= U_OUTER; u += 0.02) {
              if (!pairCrosses(u, yTop, len)) {
                uMin = u;
                break;
              }
            }
            if (uMin < 0) continue;
            if (U_OUTER - uMin < GAP * (pairs - 1)) continue;
            // 内側から外側いっぱいまで等間隔に散らす（束にしない）。
            const spread = U_OUTER - uMin;
            for (let i = 0; i < pairs; i++) {
              const uu = uMin + (pairs === 1 ? 0 : (spread * i) / (pairs - 1));
              for (const side of [-1, 1]) {
                // 窓が広ければ 3 個、狭ければ 2 個の鎖にする（隙間を挟んで並べる）。
                const segN = len > H * 0.3 ? 3 : 2;
                const widBase = wBase * rng.float(0.88, 1.16);
                for (let si = 0; si < segN; si++) {
                  const t0 = si / segN;
                  const t1 = t0 + 0.72 / segN;
                  // 根元（体の下のほう）へ行くほど心持ち太くする（垂れて溜まる感じ）。
                  const wid = widBase * lerp(0.78, 1.06, si / Math.max(1, segN - 1));
                  drawBead(uu, side, yTop, len, t0, t1, wid);
                }
              }
            }
            drew = true;
            break outer;
          }
        }
        // ── 最終フォールバック: 「横に逃がす」を諦め、目の y 範囲そのものを外す ──
        //
        // 【なぜ必要か — 実測】
        //   3 段の高さ×3〜1 対、すべて失敗する個体が 500 体中 134 体（26.8%）
        //   あった。実測すると原因は「窓の長さ不足」ではなく、
        //   `pairCrosses` が要求する横方向の逃げ場（`U_INNER`〜`U_OUTER`）が
        //   頭の細い個体では確保できないことだった。局所半幅 `halfAt(y)` が
        //   小さい頭頂〜目の高さでは、u をどれだけ外へ振っても実ピクセル距離が
        //   目の安全半径に届かない（`yurei`/`slime` 系の大目個体に集中）。
        //   横位置を探すのを諦め、**滴の縦の範囲そのものを目の外へ追い出す**
        //   （額 / 目の下〜口の手前 / 目の下〜体の裾、のいちばん広い区間を使う）
        //   と、経路が目の y 範囲と重ならなくなるので回避判定が要らなくなり、
        //   頭の細さに関係なく必ず安全に置ける。
        if (!drew) {
          let realEyeTop = Infinity;
          let realEyeBot = -Infinity;
          for (const e of ctx.face.eyes) {
            realEyeTop = Math.min(realEyeTop, e.y - e.ry);
            realEyeBot = Math.max(realEyeBot, e.y + e.ry);
          }
          const mBot = mSpan.bot;
          /** 目の y 範囲を外した候補区間。広い順ではなく安全な順に並べ、後で最大を選ぶ。 */
          const fbCandidates: [number, number][] = [
            // 額（頭頂〜目の上）。
            [yTop, realEyeTop - 4],
            // 目の下〜口の手前（通常の「あごの下」候補と同じ発想）。
            [realEyeBot + 4, capBot],
            // 目の下〜体の裾。口をまたぐが、唯一の絶対条件「目に重ならない」は守れる。
            [realEyeBot + 4, s.botY - H * 0.015],
          ];
          let fbTop = 0;
          let fbBot = -1;
          for (const [a, b] of fbCandidates) {
            if (b - a > fbBot - fbTop) {
              fbTop = a;
              fbBot = b;
            }
          }
          const fbLen = fbBot - fbTop;
          // 4px 未満はもはや点にしかならない下限。実測 500 体では 2 体だけ
          // ここに落ちた（目が体高の 7〜8 割を占める極端な `slime` 型）。
          if (fbLen >= 4) {
            // 選んだ区間が口の高さとも重なるなら、横位置だけ口の実寸の外へ逃がす
            // （`banTop`/`banBot` と同じ考え方。目の回避判定は変えず、
            // ここだけ「口の bbox の外」を追加で探す）。
            const crossesMouth = fbTop < mBot && fbBot > mSpan.top;
            let uu = U_INNER;
            if (crossesMouth) {
              const m = ctx.face.mouth;
              const hwAt = Math.max(3, s.halfAt(fbTop + fbLen * 0.5));
              for (let u = U_INNER; u <= U_OUTER; u += 0.02) {
                uu = u;
                if (Math.abs(u * hwAt) > m.w + 6) break;
              }
            }
            const segN = fbLen > H * 0.22 ? 2 : 1;
            // 窓が狭いフォールバックなので、通常より心持ち細めにする。
            // 窓が極端に低い（点に近い）個体では、太さも窓なりに絞って
            // 「丸い塊」に潰れないようにする。
            const widBase = wBase * rng.float(0.8, 1.05) * 0.85 * clamp(fbLen / 16, 0.4, 1);
            for (const side of [-1, 1]) {
              for (let si = 0; si < segN; si++) {
                const t0 = si / segN;
                const t1 = t0 + 0.8 / segN;
                const wid = widBase * lerp(0.85, 1, si / Math.max(1, segN - 1));
                drawBead(uu, side, fbTop, fbLen, t0, t1, wid);
              }
            }
          }
        }
        break;
      }

      // ── ヤドクガエル: つぶいし ───────────────────────
      //
      // 【作り直した点 — 「均一な円」から「不規則なアメーバ状」へ】
      //   旧実装は `organicBlob` の wobble を 0.13 と低くかけていたため、
      //   輪郭がほぼ真円のまま並ぶだけで、参考写真（image17/18/19）の
      //   「境界が有機的で大きさが極端にばらつく」斑にはなっていなかった。
      //   wobble を大きく上げ、縦横比も大きく振って輪郭をゆがめる。
      //   大きさのレンジも、体の 3 割近くまで育つ大粒が稀に混ざるように広げた
      //   （小粒中心・大粒はまれ、という分布の形はそのまま保つ）。
      case 'dartPebble': {
        // t^2.3 で「小さい粒が多く、たまに大きい粒」。上限を大きく引き上げ、
        // まれに体の 1/4〜1/3 に達する大きな塊も混ざるようにした。
        const cnt = Math.round(lerp(14, 34, density) * (full ? 1 : 0.85));
        const base = lerp(3, 6.6, scale);
        for (let i = 0; i < cnt; i++) {
          const y = s.topY + rng.float(0.03, 0.97) * H;
          const hw = s.halfAt(y);
          let x = s.cx + rng.float(-1, 1) * hw * 0.93;
          const r = base * (0.42 + Math.pow(rng.float(0, 1), 2.3) * 4.2);
          // ── 目と口の上に粒を置かない ────────────────────────
          //
          // 【なぜ要るか — 実物で確認】
          //   粒は不透明度 0.86〜1 の面なので、目にかかると白目や瞳を
          //   そのまま塗りつぶす。`B63Z-ZS98` は大粒が左目に食い込み、
          //   `XX43-8U9B` は口をまるごと覆っていた。
          //
          // 【下へ落とさず横へ逃がす理由】
          //   牛柄と同じで、下へ逃がすと全個体であごの下に粒が溜まり
          //   「口ひげ」に見える。横へ寄せれば頬の斑として自然に読める。
          //   寄せた先が体からはみ出す個体だけ、その粒を描かない
          //   （粒は 16〜40 個あるので 1〜2 個減っても密度は変わらない）。
          //
          // 【寄せ先をばらつかせる理由】
          //   芯の縁ちょうどへ寄せると、逃がした粒が縦一列に並んで
          //   顔の輪郭をなぞる「額縁」になる（実際に、口の弧に沿って
          //   粒がきれいに並ぶ個体が出た）。散らして偶然に見せる。
          if (coreHit(core, x, y, r * 0.85)) {
            const dir = x >= core.cx ? 1 : -1;
            x = core.cx + dir * (core.rx + r * 0.85 + rng.float(2, 14));
            if (Math.abs(x - s.cx) > hw * 0.94 || coreHit(core, x, y, r * 0.85)) continue;
          }
          g += path(
            organicBlob(x, y, r, r * rng.float(0.62, 1.38), rng, rng.float(0.3, 0.48), 12),
            { fill: c.pattern, opacity: rng.float(0.9, 1) },
          );
          if (mote.on) glowLayer += moteGlow(mote, x, y, r * 0.75);
        }
        break;
      }

      // ── 星屑 ────────────────────────────────────────
      case 'stardust': {
        // 夜空を体に閉じ込める。粒の大きさに明確な幅を持たせ、
        // いくつかは 4 方向の光条を持つ。密度は上下どちらかに偏らせる。
        const cnt = Math.round(lerp(30, 78, density) * (full ? 1 : 0.8));
        const bias = rng.float(-1, 1);
        const base = lerp(0.9, 2.1, scale);
        for (let i = 0; i < cnt; i++) {
          const u = rng.float(0, 1);
          // bias > 0 で上が濃く、< 0 で下が濃くなる。
          const t = bias >= 0 ? Math.pow(u, 1 + bias * 1.7) : 1 - Math.pow(1 - u, 1 - bias * 1.7);
          const y = s.topY + clamp(t, 0.01, 0.99) * H;
          const hw = s.halfAt(y);
          const x = s.cx + rng.float(-1, 1) * hw * 0.94;
          const big = rng.float(0, 1);
          const r = base * (0.45 + Math.pow(big, 2.6) * 3.6);
          // 光条を持つ粒は 1 割強に留める。多すぎると夜空ではなく
          // ラメのシールに見える（実際にそう見えた）。
          if (big > 0.87) {
            // きらめく星（4 方向の光条）
            const rot = rng.float(-14, 14);
            g += path(starPath4(x, y, r * 3.1, r * 0.5, rot), {
              fill: c.pattern,
              opacity: rng.float(0.75, 0.95),
            });
            g += circle(x, y, r * 0.72, { fill: c.pattern, opacity: 0.98 });
            if (mote.on) glowLayer += moteGlow(mote, x, y, r * 1.15);
          } else {
            g += circle(x, y, r, { fill: c.pattern, opacity: rng.float(0.55, 0.95) });
            // すべての粒を光らせると星空ではなく発光体になる。3 割だけ光らせる。
            if (mote.on && rng.bool(0.32)) glowLayer += moteGlow(mote, x, y, r * 0.95);
          }
        }
        break;
      }

      // ── 眼状紋（めだま模様）────────────────────────────
      //
      // 製品オーナーの個人プロジェクト（`poison_frog_fix_v8_...html` の
      // `wingPattern === 'eye'`）からの移植。向こうは Canvas 2D の
      // `ctx.arc()` 3 発で、外側の輪（acc）→ 内側の明るい輪（#fff）→
      // 中心の点（#000）を **同心** に重ねていた。
      //
      // 【写したもの】
      //   ・同心 3 層という構造そのもの
      //   ・半径の比 **1.0 : 0.5 : 0.25**（向こうの `r` / `r*0.5` / `r*0.25`）
      //   ・「数個ぽつんと乗る」密度（向こうは 1〜3 個）
      //
      // 【変えたもの】
      //   ・色は直値ではなく個体の配色から作る（`#fff` `#000` は使わない）
      //   ・外側の輪に細い暗縁を足した。向こうは翅（半透明・地が一定）に
      //     描いていたので縁なしで成立したが、こちらは体の地の色が
      //     個体ごとに大きく動く。地が模様色と近い個体では
      //     外側の輪が地に溶けて「白い点に黒い点」だけが残り、
      //     眼状紋ではなく汚れに見える。実在の蛾・クジャクの眼状紋も
      //     いちばん外は暗い輪なので、絵としても正しい方向。
      //   ・顔を避ける（`coreHit`）。目玉模様が顔に乗ると目が 4 つに見える。
      //   ・紋どうしの重なりを禁止した。重なると同心構造が壊れて
      //     ただの斑になり、この模様の意味が消える。
      case 'ocelli': {
        // 【！！このコードは消さないこと！！ — 遺伝子カタログから外れているが現役】
        //   製品オーナーの判断で『めだま（眼状紋）』は不採用になり、リードが
        //   `genetics/loci.ts` の pattern から `ocelli` を **外し済み**。
        //   したがって **新しく生まれる個体にこの模様は二度と出ない**。
        //   それでも描画を残しているのは、**既存のセーブデータが遺伝子型に
        //   `ocelli` を持っている可能性がある**ため。ここを消すと
        //   `buildPattern` の `switch (kind)` がどの case にも入らず、その個体の模様が
        //   **無地に化ける** ＝ プレイヤーから見れば
        //   飼っている個体の見た目が勝手に変わる。
        //   カタログから消えていることを理由に「もう使われていない死んだコード」と
        //   判断して削除しないこと。`face.ts` の `button` 意匠と同じ扱い。
        //   同じ理由で `aura.ts`（翅の模様）の `case 'ocelli'` も残してある。
        //
        // 【向こうの 1〜3 個に対してこちらを 2〜4 個にした理由 — 実物で確認】
        //   最初 3〜6 個・半径 9〜15 で描いたところ、紋が小さく数が多く、
        //   眼状紋ではなく「体に付いた気泡・鋲」に見えた（`7UDK-894T`）。
        //   眼状紋は「大きな目がこちらを見ている」ことが形質なので、
        //   数を減らして 1 つを大きくする。
        const cnt = Math.round(lerp(2, 4, density));
        const base = lerp(11, 18, scale) * (0.75 + ctx.pheno.size * 0.35);
        // 外側の輪。
        //
        // 【模様色そのままにしなかった理由 — 実物で確認】
        //   `c.pattern` は地と同系色で作られているので、そのまま円に塗ると
        //   地に溶けて外の輪が消え、明るい輪と中心の点だけが残る。
        //   `EVHY-ZR2E` `7UDK-894T` はそれで「体に打たれた鋲」に見えていた。
        //   実在の蛾・クジャクの眼状紋もいちばん外は **暗い** 輪なので、
        //   模様色にインクを混ぜて沈めるのが絵としても正しい。
        const ring = mix(c.pattern, c.ink, 0.32);
        // いちばん外の細い縁。輪をさらに地から切り離す。
        const rim = mix(c.pattern, c.ink, 0.62);
        // 内側の明るい輪。向こうの `#fff` に当たるが、紙の白に寄せて
        // わずかに模様色を混ぜる（硬い純白は貼りものに見える）。
        const halo = mix('#fff8ea', c.pattern, 0.14);
        // 中心の点。向こうの `#000` に当たる。純黒にすると穴に見えるので、
        // 模様色をわずかに混ぜて「その子の色のいちばん濃いところ」にする。
        const dot = mix(c.ink, c.pattern, 0.22);
        // ── 紋を置いてはいけない範囲 ──────────────────────
        //
        // 【顔の芯（`core`）だけでは足りない — 実物で確認】
        //   芯に乗っていなくても、**本物の目と同じ高さ**に同じくらいの丸が
        //   来れば、人はそれを目として読む。`HG8G-W7HU`（目が 1 つの個体）は
        //   芯の外・頬の高さに紋が並んだだけで「目が 3 つ」に見えていた。
        //
        // 【禁止するのは「目の高さの帯」だけにした理由 — 実測】
        //   最初は芯の周りに横広の緩衝帯（芯の半幅の半分）を巻いたが、
        //   丸い素体では体のほとんどが緩衝帯に入り、300 体中 78 体（26%）で
        //   紋が 1 つも乗らなかった。模様の対立遺伝子を持っているのに
        //   絵が無地になるのは、遺伝子が画面に出ないということで致命的。
        //   危ないのは高さであって左右の距離ではないので、
        //   **目の上下端が占める帯**だけを禁止する。額・あご下・胴・裾は
        //   そのまま置けるので、模様として死なない。
        const eyeBand = ctx.face.eyes.length
          ? {
              y0: Math.min(...ctx.face.eyes.map((e) => e.y - e.ry)),
              y1: Math.max(...ctx.face.eyes.map((e) => e.y + e.ry)),
            }
          : null;
        const placed: { x: number; y: number; r: number }[] = [];
        for (let i = 0; i < cnt; i++) {
          let r = base * rng.float(0.82, 1.2);
          for (let t = 0; t < 64; t++) {
            // ── 妥協の段階 ──────────────────────────────
            //   24 回置き場所を外したら、目の高さの帯の禁止だけ解いて
            //   紋を少しずつ小さくする。**芯（実際に目と口がある範囲）は
            //   最後まで守る**ので、顔に乗ることはない。
            //   妥協するのは 1 つ目の紋だけ。2 つ目以降まで緩めると
            //   顔の真横に紋が並ぶ個体が出て「目が 4 つ」に逆戻りする。
            const strict = t < 24 || placed.length > 0;
            if (!strict && t % 8 === 0) r *= 0.93;
            const y = s.topY + rng.float(0.1, 0.95) * H;
            const hw = s.halfAt(y);
            // 紋は同心構造なので、端で切れると何の模様か読めなくなる。
            // 半径ぶんの余白が取れない高さは最初から捨てる。
            const room = hw - r * 1.12;
            if (room <= 0) continue;
            const x = s.cx + rng.float(-1, 1) * room;
            // 顔の芯には絶対に置かない（目玉模様が顔に乗ると目が増えて見える）。
            if (coreHit(core, x, y, r * 1.15)) continue;
            // 目と同じ高さの帯にも置かない（上の説明）。
            //   見るのは紋の **中心** の高さ。紋の縁が帯にわずかに掛かるのは
            //   構わない（額のすぐ上に置いた紋まで弾くと、置ける高さが
            //   ほとんど残らない）。目として読まれるのは
            //   「目と同じ高さに中心がある丸」だけ。
            if (strict && eyeBand && y > eyeBand.y0 - r * 0.35 && y < eyeBand.y1 + r * 0.35) {
              continue;
            }
            if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < (p.r + r) * 1.12)) continue;
            placed.push({ x, y, r });
            g += circle(x, y, r, {
              fill: ring,
              stroke: rim,
              width: lerp(1.5, 2.4, scale),
              opacity: 0.92,
            });
            g += circle(x, y, r * 0.5, { fill: halo, opacity: 0.95 });
            g += circle(x, y, r * 0.25, { fill: dot, opacity: 0.95 });
            if (mote.on) glowLayer += moteGlow(mote, x, y, r * 0.55);
            break;
          }
        }
        break;
      }

      default:
        break;
    }
  }

  g += glowLayer;
  g += `</g>`;

  // 模様が密なときだけ、顔まわりをわずかに抜いて表情を読みやすくする。
  // 常時かけると本体色が白へ寄り、配色ファミリーの個性が消える。
  const fine = ['speckle', 'spots', 'dapple', 'dartPebble', 'stardust'];
  // 細かい模様は密度に関わらず顔の上でうるさくなるので、
  // ヤドクガエル系と星屑は密度条件を緩める（地が暗く、粒が明るいため）。
  //
  // 【あみめ（dartNet）をこの仕組みから完全に外した理由】
  //   網目には「顔の芯へ近づくほど線を細く薄くする」処理（faceSoft）を
  //   入れたので、地色を薄める楕円は不要になった。むしろこの楕円は
  //   鮮やかな地をそこだけクリーム色に抜き、暖色個体で
  //   「メロンの皮」「ひび割れた土」に見せていた張本人だった。
  const dense =
    (density > 0.55 && kinds.some((k) => fine.includes(k))) ||
    kinds.some((k) => k === 'dartPebble' || k === 'stardust');
  // 暗い地の個体で「白く抜く」と顔だけ霧がかかったように見える。
  // 抜き色は地の色そのものにして、模様のコントラストだけを下げる。
  const easeCol = hexToHsl(c.body).l < 46 ? c.body : lighten(c.body, 0.3);
  const faceEase = dense
    ? ellipse(ctx.face.cx, ctx.face.cy + 2, ctx.face.box.w * 0.46, ctx.face.box.h * 0.44, {
        fill: easeCol,
        opacity: hexToHsl(c.body).l < 46 ? 0.3 : 0.2,
        clip: ctx.bodyClip,
      })
    : '';

  // うすぎぬ（veil）では模様も膜の下にあるので、同じだけ薄くする。
  const inner = g + faceEase;
  return [
    {
      id: 'pattern',
      z: patternZ(ctx.parts.pattern),
      svg: c.sheer < 1 ? `<g opacity="${n(c.sheer)}">${inner}</g>` : inner,
      bbox: { x: s.cx - s.halfW, y: s.topY, w: s.halfW * 2, h: H },
    },
  ];
}

/**
 * 模様を描く高さ（z）。
 *
 * 【ヤドクガエル系と星屑だけ質感より手前に出す理由 — 実測で特定】
 *   「暖色の あみめ が茶色い網になり、ひび割れた土に見える」問題の原因を
 *   描画後の実ピクセルで測ったところ、**地と模様の色そのものは正しかった**。
 *     おきび matte  地 L79 / 網 L11（ΔL 68）
 *     おきび しんじゅ 地 L72 / 網 **L24**（ΔL 48）
 *     おきび すりガラス 地 L74 / 網 L15
 *   つまり犯人は配色ではなく、模様より **手前** に敷かれる
 *   しんじゅ／すりガラス／すきとおりの白い膜だった。
 *   黒い網（L11）の上に白の膜が乗ると L24 まで持ち上がり、
 *   暖色の色相を帯びた L24 は黒ではなく **茶** として読まれる。
 *   ヤドクガエルの美しさは「明るい鮮やかな地 × はっきり黒い網目」なので、
 *   ここが崩れると絵の芯が失われる。
 *
 *   白の量を減らすだけでは質感の遺伝子が死ぬので、
 *   **順番を入れ替えて** 模様を膜の上に出す。膜は地の上には残るため
 *   しんじゅの虹色・すりガラスのぼけは見えたまま、網だけが黒に戻る。
 *   輪郭の描き直し（Z.OUTLINE = 58）より奥なので、太いインク輪郭の
 *   優先順位は変わらない。
 */
function patternZ(pattern: string): number {
  return /^(dart|stardust)/.test(pattern) ? Z.TEXTURE + 2 : Z.PATTERN;
}

/**
 * 4 方向に伸びる光条（きらめき）。
 * 直線の星より辺を内側へ抉ったほうが「点光源のにじみ」に見える。
 */
function starPath4(cx: number, cy: number, r: number, w: number, rotDeg: number): string {
  const a0 = (rotDeg * Math.PI) / 180 - Math.PI / 2;
  const pt = (ang: number, rad: number): Vec => ({
    x: cx + Math.cos(ang) * rad,
    y: cy + Math.sin(ang) * rad,
  });
  // 縦横で長さを変えると人工的でなくなる
  const len = (i: number): number => (i % 2 === 0 ? r : r * 0.66);
  let d = '';
  for (let i = 0; i < 4; i++) {
    const a = a0 + (i * Math.PI) / 2;
    const tip = pt(a, len(i));
    const next = pt(a + Math.PI / 2, len(i + 1));
    const mid = pt(a + Math.PI / 4, w);
    if (i === 0) d = `M${n(tip.x)} ${n(tip.y)}`;
    d += `Q${n(mid.x)} ${n(mid.y)} ${n(next.x)} ${n(next.y)}`;
  }
  return `${d}Z`;
}
