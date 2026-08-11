/**
 * 顔の配置計算。
 *
 * 【必ず守る制約】
 *  1. 目同士が絶対に重ならない（間隔の下限を目の幅から決める）
 *  2. 目・口が faceBox からはみ出さない
 *  3. 目・口が体のシルエットからはみ出さない（その y での体の半幅で抑える）
 *  4. 目が 3 つのときは正三角形ではなく「左右 2 つ＋額に小さい 1 つ」
 *
 * eyeSize / eyeSpacing はこの制約の中で反映する。制約と衝突したときは
 * 遺伝子の希望より制約を優先する（はみ出し・重なりは無条件で不合格のため）。
 */

import type { PartExpression, Phenotype } from '../../core/types.ts';
import { Rng, clamp, lerp } from '../../core/rng.ts';
import type { Box } from '../svg.ts';
import type { BodyShape } from '../geom.ts';

export interface EyeSlot {
  x: number;
  y: number;
  /** 目の基準寸法。 */
  s: number;
  /** 外向きの向き（-1 左目 / +1 右目 / 0 中央）。 */
  dir: number;
  /** 半幅・半高（重なり検査に使う）。 */
  rx: number;
  ry: number;
  /** 額の目か。 */
  brow: boolean;
}

export interface FaceLayout {
  box: Box;
  cx: number;
  cy: number;
  eyes: EyeSlot[];
  mouth: { x: number; y: number; w: number; h: number };
  cheeks: { x: number; y: number; rx: number; ry: number }[];
  /** 首かざりを置く高さ。 */
  neckY: number;
}

/** 表情の芯を包む楕円。 */
export interface FaceCore {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/**
 * 目と口の実寸から「表情の芯」の楕円を作る。
 *
 * 【faceBox ではなく実寸から作る理由】
 *   faceBox は素体の半幅の 1.5〜1.9 倍まで取る器なので、体より広いことすらある。
 *   守りたいのは器ではなく **実際に目と口が置かれている範囲** で、
 *   これは個体ごとに（目の大きさ・間隔・口の幅・顔の高さで）大きく違う。
 *   器を守ると顔の無い場所まで模様が消え、実寸を守ると必要な分だけで済む。
 *
 * 【模様（pattern.ts）と質感（body.ts）で共有する理由】
 *   顔を横切ってはいけないのは模様だけではない。質感の稜線・膜の皺も
 *   同じ理由で顔を避ける必要がある（実測 `9XJD-THXX`: こうぶつ質感の
 *   稜線が眼球の上と口の上を直線で横切り「ガラス片・引っかき傷」に見えた）。
 *   避けるべき範囲の定義が 2 か所にあると必ずずれるので、ここに 1 つだけ置く。
 */
export function faceCoreOf(f: FaceLayout): FaceCore {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const e of f.eyes) {
    x0 = Math.min(x0, e.x - e.rx);
    x1 = Math.max(x1, e.x + e.rx);
    y0 = Math.min(y0, e.y - e.ry);
    y1 = Math.max(y1, e.y + e.ry);
  }
  const m = f.mouth;
  x0 = Math.min(x0, m.x - m.w);
  x1 = Math.max(x1, m.x + m.w);
  y0 = Math.min(y0, m.y - m.h);
  y1 = Math.max(y1, m.y + m.h);
  if (!Number.isFinite(x0)) {
    return { cx: f.cx, cy: f.cy, rx: f.box.w * 0.3, ry: f.box.h * 0.34 };
  }
  // 矩形を包む楕円は √2 倍必要だが、そこまで取ると顔の四隅の外まで守ってしまう。
  // 目尻・口角にわずかな余白（4px）を足す程度に留める。
  return {
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    rx: (x1 - x0) / 2 + 4,
    ry: (y1 - y0) / 2 + 4,
  };
}

/**
 * 「べた目」か（白目を持たない、インク一色の目）。
 *
 * 【なぜ瞳の遺伝子から決めるのか】
 *   eyeShape の対立遺伝子は遺伝子カタログ（genetics/loci.ts）が正本で、
 *   描画担当が勝手に増やせない。しかしビジュアル批評の最大の指摘は
 *   「目の形の実効バリエーションがほぼ無い」「小さい点目が現在ゼロ」だった。
 *   そこで既存の 2 遺伝子座の組み合わせで形を分ける。
 *   瞳『つぶら(bead)』は元々「小さく詰まった瞳」の意味なので、
 *   これを白目の無いべた目に割り当てると意味が通り、
 *   7 種の輪郭 × べた目/白目 で 14 通りの目のシルエットが生まれる。
 *   とくに まるめ／たまご × つぶら は「点目」になり、印象が激変する。
 */
export function isSolidEye(parts: PartExpression): boolean {
  return parts.pupil === 'bead';
}

/**
 * 目の基準寸法の倍率（**形ごと**）。
 *
 * 【一律倍率をやめた理由 — 3 段階の比較シートで製品オーナーが判定】
 *   比較では `mid`（一律 1.18）と `ref`（一律 1.42）を並べた。
 *   `ref` の「目が大きくて視線の弱い顔」は方針として採用されたが、
 *   一律にすると **縦長の目を持つ個体が壊れた**。
 *     `8TQP-9GS9` `CHPU-CLM7` `NGPT-US8Q`（いずれも たまご）
 *       … 縦 1.32s の器が 1.87s まで伸び、顔の上半分を目が占める。
 *          口と頬の置き場が無くなり、左右の目が繋がって
 *          **サングラス／ゴーグル** に見えた。
 *   参考にした絵の目が全部まん丸だったのが原因で、
 *   ゲノモンには 7 種の目の形がある。**丸いものだけ大きくできる**。
 *
 * 【値の決め方】
 *   まん丸系（まるめ・ぱっちり・ほしぞら）は器の縦横比が 1 に近いので、
 *   大きくしても「大きな丸い目」にしかならない。`ref` 寄りの 1.38。
 *   縦長系（たまご）と、横に細長い このは は中くらいの 1.18（`mid` 寄り）。
 *   ねむたげ は上まぶたが器の 30% を覆うので、器を広げても
 *   見える面はほとんど増えない（比較シートでも変化が読めなかった）。据え置き。
 *   みかづき は閉じ目で、器は弧の幅にしか使われないので対象外。
 *   したりめ も同じ閉じ目の弧（`eyeMetrics` の crescent と同じ器）なので、
 *   同じ理由で対象外＝ 1 のまま。
 */
const EYE_SIZE_K: Readonly<Record<string, number>> = {
  round: 1.38,
  wide: 1.36,
  starry: 1.38,
  oval: 1.18,
  leaf: 1.18,
  sleepy: 1,
  crescent: 1,
  smirk: 1,
};

export const eyeSizeK = (shapeId: string): number => EYE_SIZE_K[shapeId] ?? 1.2;

/**
 * 白目（sclera）を描かない「縦長のべた目」か。
 *
 * 【製品オーナーの指示「縦長は白目部分いらないんじゃない？」】
 *   縦長の器（たまご: rx 0.6s / ry 1.32s）は、虹彩を縦長にしてもなお
 *   上下に白が残りやすい。そこへ目を大きくすると、白の面積だけが増えて
 *   「白目を剥いて見開いた人間の目」に戻る。
 *   縦長は白目をやめ、**目の中を意匠の色で塗った 1 枚の面**にする。
 *
 * 【点目（`isSolidEye`）と別物であること】
 *   点目は瞳『つぶら』で発現する **小さな** インク一色の目で、
 *   ここでいうべた目は **器いっぱいの** 意匠色の面。
 *   両者が混ざらないよう、描画側（`face.ts`）は点目を先に判定する。
 *   ＝ たまご × つぶら は点目（小さい）で、べた目にはならない。
 *
 * 【たまごだけにした理由 — このは を両方描いて見比べた】
 *   7 形のうち器が縦長（ry > rx）なのは たまご だけ。
 *   このは は rx 1.14 / ry 0.66 で、名前に反して **横に細長い** アーモンドなので
 *   そもそも「縦長」に当たらない。それでも指示にあったので実際に描いた:
 *     白目あり … 尖った目尻・目頭のきわに明るい縁が残り、
 *                つり目でも「目」として読める（`GZ7K-KTYK` `W965-2FBS`）
 *     白目なし … 同じ個体が、両端の尖りまで濃い一色で埋まった
 *                **細い切れ込み** になる。つり目 ＝ 少し不機嫌 の範囲を越えて
 *                「にらんでいる／傷」に寄り、方針の「視線が強すぎない目」に反する
 *   縦長でないうえ絵も悪くなるので、このは は白目つきのままにする。
 */
export function isTallSolidEye(shapeId: string): boolean {
  return shapeId === 'oval';
}

/**
 * べた目のときの縮小率（点目は小さいほどかわいい）。
 *
 * 【まる／たまご以外も下げた理由】
 *   以前は「点目として描かれるのは まる／たまご だけ」だったので、
 *   それ以外の 0.72 は「白目付きのまま少し小さい目」の値だった。
 *   `face.ts` が bead をすべて点目として描くようになったため、
 *   0.72 のままだと『ぱっちり』の点目が 1.64s × 1.41s の
 *   **大きな黒い塊** になる。それは「視線の強すぎない目」の逆なので、
 *   形ごとに、点目として気持ちのよい大きさまで落とす。
 *   『みかづき』は点目にならない（閉じ目として描かれる）が、
 *   ここを触ると配置が動いて自動検査の前提が変わるので現状維持。
 */
function solidScale(shapeId: string): number {
  switch (shapeId) {
    case 'round':
    case 'oval':
    case 'wide':
      return 0.5;
    case 'leaf':
      return 0.56;
    case 'sleepy':
    case 'starry':
      return 0.62;
    default:
      return 0.72;
  }
}

/**
 * 目の形ごとの白目の縦横比（rx, ry の s に対する倍率）。
 *
 * 【比率を大きく振った理由】
 *   以前は 0.7〜1.14 の狭い範囲だったので、7 種あっても
 *   実質「円」と「横長レンズ」の 2 種にしか見えていなかった。
 *   縦長・横長・平たい半月まで振り切り、シルエットの段階で見分けられるようにする。
 */
export function eyeMetrics(shapeId: string, s: number, solid = false): { rx: number; ry: number } {
  let rx: number;
  let ry: number;
  switch (shapeId) {
    // たまご: 縦長だが、縦長「すぎ」ない程度に。
    //
    // 【1.32 → 1.15 に詰めた理由 — 3 件の「縦長すぎる」指摘】
    //   `PZ6U-RWMR`「目が縦長すぎる」／`M2BV-JA8C`「縦長すぎて口と被っている」／
    //   `DJDP-CRND`「この卵型の個体の目が全般的に縦長すぎる」。
    //   たまごは常に `isTallSolidEye` の対象（白目なし・意匠は器いっぱいに
    //   塗る「べた目」）なので、ここで ry を下げれば見た目の縦長さと
    //   べた目の縦横比の両方に同時に効く（2 つは同じ器を共有している）。
    //   1.32 のままだと器の面積が大きく、`M2BV-JA8C` のように口へ食い込む
    //   個体が出ていた。1.15 まで下げても rx:ry ＝ 1:1.92 でまだ他形（最大でも
    //   `starry` の 1:1.08）よりはっきり縦長で、「たまご」の識別性は保たれる
    //   （実際に描いて確認。`isTallSolidEye` のコメントにある「白目を残すと
    //   人間の目に見える」判断はここでは変えていない）。
    case 'oval':
      rx = 0.6;
      ry = 1.15;
      break;
    // ぱっちり: いちばん開いた横長。
    //
    // 【1.24×1.06 → 1.14×0.98 に詰めた理由 — 実測】
    //   7 形のなかで最大の目でありながら虹彩の比率が最小だったため、
    //   白いまま残る面積が中央 532px²（次点『たまご』364px²）と突出し、
    //   「白目が大きく見える目」の主因になっていた。
    //   虹彩を大きくするだけでは、こんどは「大きな黒目」になる。
    //   器そのものも 15% 詰めて、白も黒も増やさずに済ませる。
    //   それでも横幅は 7 形で最大なので「ぱっちり」の性格は残る。
    case 'wide':
      rx = 1.14;
      ry = 0.98;
      break;
    case 'sleepy': // ねむたげ: 平たいたれ目
      rx = 1.2;
      ry = 0.5;
      break;
    case 'leaf': // このは: 細くとがったつり目
      rx = 1.14;
      ry = 0.66;
      break;
    case 'crescent': // みかづき: 閉じた笑い目
      rx = 1.12;
      ry = 0.52;
      break;
    // したりめ: みかづきと同じ半月の器を使い、傾きと切り欠きは
    // `face.ts` の描画側（回転・くり抜き）だけで作る。器の縦横比を
    // 変えると弧の幅 `w`／高さ `h`（`face.ts` の `rx*1.08`／`ry*1.5`）も
    // 連動してずれるので、みかづきと揃えておくのが安全（実測済みの値）。
    case 'smirk':
      rx = 1.12;
      ry = 0.52;
      break;
    case 'starry':
      rx = 1.0;
      ry = 1.08;
      break;
    case 'round':
    default:
      rx = 0.92;
      ry = 0.98;
      break;
  }
  const k = solid ? solidScale(shapeId) : 1;
  return { rx: s * rx * k, ry: s * ry * k };
}

/**
 * 左右の目の間隔の下限（中心から片目の中心までの距離）。
 *
 * 【`crescent`・`smirk` だけ特別扱いする理由 — 実測で判明した「弧の先端が繋がる」原因】
 *   `crescent`（みかづき）・`smirk`（したりめ）は白目を持たず、
 *   `face.ts` の `drawEye` が弧を **`rx * 1.08`** の半幅で描く
 *   （`const w = rx * 1.08;`）。ところが間隔の下限はここの `rx`（eyeMetrics の値）
 *   をそのまま基準にしていたため、実際に描かれる弧の半幅より 8% 狭い値で
 *   「重なっていない」と判定していた。
 *
 *   実測（`EU9Y-F2EM` eyeSpacing=0.69・数値上は広い側）:
 *     旧 minDx（rx×1.14）での弧の先端の隙間 … 3.9px
 *     輪郭線の太さ（最大 3.85px）を差し引くと視覚的な隙間はほぼ 0px
 *   これが「間隔の遺伝子は広いのに繋がって見える」の正体だった
 *   （`eSpace` は `faceBox.w` に対する比率で dx を決めるだけで、
 *   目そのものの大きさ〈rx〉を考慮しないため、目が大きい個体では
 *   「間隔は広いつもり」でも弧の先端間の実隙間が潰れる）。
 *
 * 【固定 px の下限も足す理由】
 *   `rx` に対する倍率だけだと、目が小さい個体では隙間も比例して小さくなり、
 *   輪郭線の太さに対して相対的に潰れたままになる。
 *   線の太さ（最大 `strokeW*1.15` ≈ 3.85px）を確実に上回る絶対値 4px を
 *   下限として足す。
 */
function minEyeDx(shapeId: string, rx: number, baseFactor: number): number {
  if (shapeId === 'crescent' || shapeId === 'smirk') {
    return rx * 1.08 + Math.max(4, rx * 0.18);
  }
  return rx * baseFactor;
}

/** その y で目・口が使ってよい半幅（体の内側に余白を残す）。 */
function innerHalf(shape: BodyShape, y: number, margin: number): number {
  return Math.max(6, shape.halfAt(y) - margin);
}

/**
 * y0..y1 の範囲で最も狭いところの内側半幅。
 *
 * 【なぜ中心の高さだけでは足りないか】
 *   体の輪郭は曲がっているので、目の中心の高さで収まっていても
 *   目の上端・下端の角が輪郭の外へ出る。自動検査 `face-outside-body` が
 *   500 体中 30 件（幼体は 111 件）鳴っていた原因はここ。
 *   目・口の縦の広がり全体で最小値を取る。
 */
function innerHalfSpan(shape: BodyShape, y0: number, y1: number, margin: number): number {
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  let best = Infinity;
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    best = Math.min(best, innerHalf(shape, lerp(lo, hi, i / steps), margin));
  }
  return Number.isFinite(best) ? best : 6;
}

// 【`sideRoom`（中心から左右の輪郭までの余裕）を廃した理由】
//   halfAt / edgeX による近似は、素体の制御点を開いた曲線として標本化した
//   もので測るため、閉じたパスを展開した「実際に描かれる輪郭」と
//   裾の継ぎ目付近で 1〜8px ずれていた。目・口のはみ出しはすべてそこで
//   起きていたので、判定を `boxInsideBody`（自動検査と同じ折れ線）へ
//   一本化した。近似をひとつ減らすほうが、余白を足すより確実だった。

/**
 * 目・口の bbox が体の輪郭の内側に収まっているか。
 *
 * 【halfAt / bottomYAt では足りない理由 — `A9RE-6LZR` の実測で判明】
 *   これらは「その高さの幅」「その x で輪郭が最も下に来る y」しか答えない。
 *   ところがスライムの裾が割れた個体では、同じ x に
 *   「内側の帯 → 切れ込み（外側）→ また内側の帯」が縦に並ぶ。
 *   bottomYAt は最も下の帯の底（184 付近）を返すので、
 *   その手前にある切れ込みを素通りし、口の下辺が体の無い場所に置かれていた。
 *
 * 【自動検査と同じ 8 点・同じ折れ線で見る理由】
 *   inspect.ts は bbox の四隅と各辺の中点（8 点）を、clipPath の d を
 *   展開した折れ線で内外判定する。配置側が別の近似で測っている限り、
 *   両者がずれた個体が必ず残る。**同じ質問を同じ相手にする。**
 *   しきい値は検査の 2 に対して 1 に取り、丸めの分だけ余裕を持たせる。
 */
function boxInsideBody(
  shape: BodyShape,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): boolean {
  const x0 = cx - rx;
  const x1 = cx + rx;
  const y0 = cy - ry;
  const y1 = cy + ry;
  const probes: readonly [number, number][] = [
    [x0, y0], [cx, y0], [x1, y0],
    [x1, cy], [x1, y1], [cx, y1],
    [x0, y1], [x0, cy],
  ];
  for (const [px, py] of probes) {
    if (shape.outsideAt(px, py) > 1) return false;
  }
  return true;
}

/**
 * 遺伝子の 0..1 値を「見た目の差が出る範囲」へ広げる。
 *
 * 【なぜ必要か】
 *   eyeSize / eyeSpacing は平均 0.5・分散 0.16 の正規分布なので、
 *   実際の個体はほぼ 0.35〜0.65 に収まる。これをそのまま
 *   lerp(14, 20.5) に通していたため、目の大きさの実効差が
 *   16.3〜18.2px しかなく、9 体並べても顔が同じ位置・同じ大きさに見えていた。
 *   中央付近を引き伸ばして、実際に出る値の範囲で差が出るようにする。
 */
const spreadOut = (v: number, k = 2.3): number => clamp((clamp(v, 0, 1) - 0.5) * k + 0.5, 0, 1);

/**
 * 口の種類ごとの「縦の広がり ÷ 横半幅」。
 *
 * 【なぜ表にしたか】
 *   以前は種類に関わらず 0.62 固定で bbox を作っていたが、
 *   実際の描画は『ぽかん』が縦に 1.1 倍近く広がり、『なみなみ』は
 *   0.45 しかない。bbox が実寸と合っていないと、
 *   「輪郭からはみ出していないか」の自動検査が種類ごとに甘くも辛くもなる。
 */
const MOUTH_H_RATIO: Readonly<Record<string, number>> = {
  smile: 0.72,
  tiny: 0.34,
  wavy: 0.34,
  open: 0.68,
  pout: 0.5,
  // 追加 3 種（`face.ts` の `drawMouth` 参照）。
  // くちばし: 小さな三角形なので低い。きば: 横長の三日月。
  // したみせ: ぽかんに似た丸い開口なのでほぼ同じ値。
  beak: 0.34,
  fang: 0.36,
  peek: 0.66,
};

/**
 * 口が **中心より上／下へ実際に広がる量** ÷ 横半幅。
 *
 * 【上下を分けた理由 — 500 体の実測で判明した検査の穴】
 *   `MOUTH_H_RATIO` は上下対称の bbox を作るための値で、いちばん広い側
 *   （多くは下）に合わせてある。ところがどの口も上下は対称ではない。
 *     『にこり』の開口 … 上 0.18w / 下 0.67w（比で 3.7 倍の差）
 *     『ぽかん』       … 上 0.28w / 下 0.40w
 *     『むっ』         … 上 0.16w / 下 0.42w
 *   対称の bbox を使うと、口の上端が実際より 0.2〜0.5w 高いことになり、
 *   **成体・幼体 395 体すべてで目の bbox と重なって見えていた**
 *   （重なりの中央値 15.5px）。実際には目と口は離れているので、
 *   これは検査の側の誤りだった。ここを実寸に合わせると、
 *   「目と口の外接矩形を重ねない」という要求が初めて意味を持つ。
 *
 *   値は `face.ts` の各パスの制御点から出した理論上の極値
 *   （2 次ベジエの極値 = (p0 + 2c + p1)/4）で、同じ種類に複数の描き方が
 *   あるもの（『にこり』の線と開口）は広いほうを採ってある。
 */
export const MOUTH_UP_RATIO: Readonly<Record<string, number>> = {
  smile: 0.34,
  tiny: 0.21,
  wavy: 0.23,
  // ぽかんを「平たい大口」から「小さな o 」へ変えたぶん、
  // 同じ半幅に対して縦へ広がる（rh を 0.42w → 0.66w に起こした）。
  open: 0.44,
  // むっ: 中央の短い縦線が上端を作る（弧の極値 0.15d より上に出る）。
  // 実測ではなく式（0.42d, d ≤ 0.595w）から出した理論値。
  pout: 0.25,

  // 【ここから追加 3 種 — `face.ts` の `drawMouth` と対になる理論値】
  //   2 次ベジエの極値 = (p0 + 2c + p1)/4 を各パスの制御点から計算し、
  //   輪郭線幅ぶんの余裕を足してある（既存 5 種と同じ求め方）。
  //   実測（`?force=mouth:xxx` のスクリーンショット＋ getBBox）でも
  //   このマージン内に収まることを確認済み（作業ログ参照）。

  // くちばし: 上辺の弧の極値は topY − bw×0.07 ＝ w×(0.208+0.028)=0.236w。
  beak: 0.27,
  // きば: 上辺の制御点 topCtrl = y − ww×0.5 ＝ w×0.31（ww=0.62w）。
  // 制御点をそのまま上限に採る（実際の極値はこれよりわずかに小さい）。
  fang: 0.33,
  // したみせ: open と同じ式・rh 係数だけ 0.62（open は 0.66）。
  // 極値 0.625×rh_max ＝ 0.625×0.62×1.06w ≈ 0.41w。
  peek: 0.43,
};
export const MOUTH_DOWN_RATIO: Readonly<Record<string, number>> = {
  smile: 0.68,
  tiny: 0.22,
  wavy: 0.23,
  open: 0.61,
  pout: 0.44,

  // くちばし: 下頂点 tipY ＝ w×0.264（下辺はほぼ直線）。
  beak: 0.3,
  // きば: 下辺の制御点 botCtrl = y + ww×0.4 ＝ w×0.248。
  fang: 0.28,
  // したみせ: 極値 0.875×rh_max ≈ 0.58w（内側の塊は 0.47w で内側に収まる）。
  peek: 0.6,
};

/**
 * 目の bbox の下端と口の bbox の上端のあいだに必ず空ける余白。
 * 本体の輪郭線幅（最大 3.35）の 2 倍。線 2 本ぶん離れていれば、
 * 引きでも「目と口がくっついた 1 つの器官」には見えない。
 */
const MOUTH_EYE_GAP = 6.7;

/**
 * 口の種類ごとの横幅の倍率。
 *
 * 【線の口と面の口を同じ幅にしてはいけない】
 *   『ぽかん』は塗りつぶした面なので、線で描く『にこり』『ちいさい』と
 *   同じ半幅を与えると顔の下半分を丸ごと占める「大きすぎる口」になる。
 *
 * 【実際に描かれる幅は種類ごとに違う — ここで揃える】
 *   同じ半幅 w を渡しても、描画側が使う幅は種類ごとに違う。
 *     にこり 1.72w ／ ちいさい 2.0w ／ なみなみ 2.0w ／
 *     ぽかん 2.0w ／ むっ 1.6w
 *   200 体の実測でも `なみなみ 中央 76.1` `ちいさい 69.9` に対し
 *   `ぽかん 47.0` と、**『ちいさい』がいちばん大きい** という
 *   名前と逆の状態になっていた。この表で描画側の倍率を打ち消し、
 *   狙った実寸に落とす。
 *
 * 【2 回目の「口が大きすぎる」指摘 — 中央値そのものを下げた】
 *   1 回目の指摘には最大値だけを抑えて応えた（`MOUTH_EFF_KNEE` 側）。
 *   結果は中央 37.7 のまま変化なしで、それでも「大きすぎる」との
 *   再指摘を受けた。今回は最大値ではなく **標準的な口の大きさ** を
 *   種類ごとに引き下げる。96px の小サイズで口が線として消えないこと、
 *   5 種類が互いに区別できることを実際に描いて確認したうえで決めた
 *   （`docs/screenshots/face/` の `*-mouth2` 系列で before/after を確認。
 *   36 体シート・96px シート・5 種の拡大クローズアップの 3 段階で見ている）。
 *
 *   500 体実測（旧倍率 → 新倍率、getBBox 実測・中央値、体幅は約 130）:
 *     にこり   39.0 → 31.8（-18%）／ p90 46.5 → 37.3 ／ 最大 50.1 → 39.0
 *     なみなみ 41.3 → 33.8（-18%）／ p90 44.3 → 38.0 ／ 最大 45.4 → 38.8
 *     むっ     37.2 → 30.1（-19%）／ p90 40.6 → 34.6 ／ 最大 41.8 → 36.3
 *     ちいさい 35.5 → 28.9（-19%）／ p90 39.2 → 32.7 ／ 最大 40.9 → 35.2
 *     ぽかん   35.4 → 29.2（-18%）／ p90 39.6 → 33.2 ／ 最大 41.4 → 36.0
 *     全体     37.7 → 30.6（-19%）／ p90 42.2 → 36.2 ／ 最大 45.4 → 39.0
 *   製品オーナーの目安（-15〜-20%）の範囲に全種類が収まった。
 *   一律ではなく種類ごとに個別の倍率で調整しており（機械的な一律掛けはしていない）、
 *   結果として下げ幅が 18〜19% にほぼ揃ったのは「もっとも大きかった なみなみ・にこりを
 *   相対的に強めに、線が薄い ちいさい・面が小さい ぽかんを抑えめに」調整した結果であって、
 *   最初から同じ係数を掛けたわけではない。
 *
 *   口幅 ÷ 目の幅（同じ 500 体、getBBox 実測・中央値）:
 *     全体 0.88 → 0.73（目はここ数回の作業で大きくなっているため、
 *     口を縮めた分だけ相対的にさらに小さく見える。これは今回の目的
 *     「口を小さくする」に合致する数字で、36 体シート・拡大クローズアップの
 *     目視でも「顔が壊れて見える」までは崩れていないことを確認した）。
 */
/**
 * 【3 回目の「口が大きい」指摘 — 中央値をさらに 15〜25% 下げた】
 *   2 回目の縮小（中央 37.7→30.6）のあとも 16 件中 7 件が「口が大きい」と
 *   指摘した。しかも『ちいさい』型（4ZZC-KQUT）ですら大きいと言われており、
 *   種類間の相対バランスではなく基準そのものが大きいと判断した。
 *
 *   一律に掛けるのではなく、実際に `?force=mouth:xxx` で 96px まで描いて
 *   「口として読める下限」を探りながら種類ごとに個別の倍率を決めた
 *   （`_measure_mouth.ts` で `model.parts.find(id==='mouth')` の実パスから
 *   真のジオメトリ bbox を求める自作の実測スクリプトを使用。
 *   ブラウザの getBBox と同じ値になることを smile/wavy の実測値が
 *   2 回目の記録とほぼ一致することで確認済み）。
 *
 *   成体 500 体（`seed0=GENOMON-SHEET`, n=496）実測・全幅（getBBox 相当）:
 *     旧倍率 → 新倍率（中央値の変化率）
 *     にこり   0.70 → 0.56  中央 31.3 → 25.9（-17%）／最大 38.7 → 31.4
 *     なみなみ 0.60 → 0.47  中央 33.7 → 26.4（-22%）／最大 39.1 → 31.5
 *     むっ     0.68 → 0.55  中央 29.7 → 24.1（-19%）／最大 35.9 → 29.1
 *     ちいさい 0.52 → 0.42  中央 28.3 → 22.9（-19%）／最大 34.6 → 27.9
 *     ぽかん   0.52 → 0.42  中央 28.9 → 23.4（-19%）／最大 36.0 → 29.0
 *     くちばし 0.62 → 0.52  中央 13.9 → 11.7（-16%）／最大 16.5 → 13.9
 *     きば     0.86 → 0.69  中央 29.1 → 23.4（-20%）／最大 29.7 → 23.8
 *     したみせ 0.52 → 0.42  中央 24.1 → 19.5（-19%）／最大 24.3 → 19.7
 *     全体     中央 29.9 → 24.3（-19%）／p90 35.2 → 28.3／最大 39.1 → 31.5
 *   96px（`?size=small`）でも 5 種すべてが線・面として消えずに読めることを
 *   スクリーンショットで確認済み。
 */
const MOUTH_W_RATIO: Readonly<Record<string, number>> = {
  smile: 0.56,
  tiny: 0.42,
  wavy: 0.47,
  open: 0.42,
  pout: 0.55,

  // 【追加 3 種 — 少数派の個性であり「大きくする」対象ではない】
  //   dominance 2・weight 4〜5（`genetics/loci.ts`）で既存 6 種より弱く、
  //   出現そのものが少数派になる形質。3 回目の縮小でも既存 6 種との
  //   相対バランス（くちばし＝最小、きば＝標準並み、したみせ＝ぽかん未満）
  //   を保ったまま、同じ比率で下げてある。
  //     くちばし 0.62 → 0.52　　きば 0.86 → 0.69　　したみせ 0.52 → 0.42
  beak: 0.52,
  fang: 0.69,
  peek: 0.42,
};

/**
 * 口の種類ごとの「**描画側が実際に使う** 横幅 ÷ 与えた半幅 w」。
 *
 * `face.ts` の各 case が w のどこまで使うかをそのまま写したもの。
 *   にこり 0.86（ww = w × 0.86。閉じた弧・開口とも同じ）
 *   ちいさい 1.0（ww = w × 0.5 を 2 つ ＝ ±w）
 *   なみなみ 1.0（x − w から q = 0.667w を 3 つ ＝ ±w）
 *   ぽかん   1.0（rw = w）
 *   むっ     0.8（ww = w × 0.8）
 *
 * 【`MOUTH_W_RATIO` と別に持つ理由】
 *   `MOUTH_W_RATIO` は「狙った実寸に落とすための倍率」で、この表は
 *   「実際に描かれる幅を知るための事実」。役割が違ううえ、後者は
 *   `face.ts` を書き換えたときだけ変わる。混ぜると、実寸を測りたいのか
 *   大きさを調整したいのか分からなくなる。
 */
const MOUTH_DRAW_K: Readonly<Record<string, number>> = {
  smile: 0.86,
  tiny: 1,
  wavy: 1,
  open: 1,
  pout: 0.8,
  // くちばし 0.4（bw = w × 0.4）／ きば 0.62（ww = w × 0.62）／
  // したみせ 0.88（rw = w × 0.88、open の 1.0 より控えめ）。
  beak: 0.4,
  fang: 0.62,
  peek: 0.88,
};

/**
 * 口の「実際に描かれる半幅」の柔らかい上限。
 *
 * 【製品オーナーの指示】
 *   「口も、大きすぎるやつがいる。口の最大値をもうちょっと小さくして。」
 *   ただし **中央値は動かさない**。小さい口・普通の口は今の状態が良い。
 *
 * 【どの口の種類が最大値を作っているか — 成体 500 体を実測してから決めた】
 *   ブラウザの getBBox で「実際に描かれた口」の幅を測った結果:
 *     全体   中央 37.7 / p90 45.5 / 最大 51.4（体幅 約130）
 *     なみなみ 中央 44.0 / p90 49.5 / 最大 51.4  ← 最大を作っているのはここ
 *     にこり   中央 39.7 / p90 46.5 / 最大 50.1  ← 数が最多（214/499）でここも大きい
 *     むっ     中央 36.9 / p90 42.5 / 最大 44.9
 *     ちいさい 中央 35.5 / p90 40.2 / 最大 43.3
 *     ぽかん   中央 35.4 / p90 40.8 / 最大 44.2
 *
 * 【`clamp(…, 14, 35)` の上限を下げるだけでは駄目だった — これも実測】
 *   基準幅（`MOUTH_W_RATIO` を掛ける前）の分布は
 *     中央 27.3 / p75 29.8 / p90 31.5 / 最大 34.6
 *   で、**上限 35 は 500 体中 1 体にも当たっていない**（＝ 効いていない）。
 *   ここを 31 まで下げると今度は 22% の個体が同じ値に張り付き、
 *   口の大きさの個体差がその帯で消える。上限クランプは筋が悪い。
 *
 * 【種類ごとの倍率を下げるのも駄目 — 中央値が動く】
 *   なみなみの倍率を下げれば最大は下がるが、**小さいなみなみまで一緒に縮む**。
 *   種類ごとの倍率は「その種類の口の大きさ」そのものなので、
 *   最大側だけを抑える道具にはならない。
 *
 * 【そこで「実際に描かれる幅」に膝を付けた】
 *   種類ごとの倍率（`MOUTH_W_RATIO`）と描画側の倍率（`MOUTH_DRAW_K`）を
 *   両方掛けたあとの値 ＝ **画面に出る口の半幅** に対して、
 *   膝（19）より下はそのまま・膝より上だけ 0.55 倍に圧縮する。
 *   単調な写像で、膝以下の値は 1px も動かないので
 *   **口が小さい子・普通の子の口幅は 1px も変わらない**。
 *   種類ではなく実寸で切るため、なみなみ・にこりの大きい個体に
 *   いちばん強く効く ＝ 実測で特定した最大の作り手にちょうど当たる。
 *
 * 【この値にした結果 — 同じ 500 体を測り直した】
 *     全体   中央 37.7 → **37.7**（変化なし）/ p90 45.5 → 42.2 / 最大 51.4 → 45.4
 *     なみなみ 中央 44.0 → 41.3 / 最大 51.4 → 45.4
 *     にこり   中央 39.7 → 39.0 / 最大 50.1 → 44.7
 *     むっ     中央 36.9 → 37.2 / 最大 44.9 → 41.8
 *     ちいさい 中央 35.5 → 35.5（変化なし）/ 最大 43.3 → 40.9
 *     ぽかん   中央 35.4 → 35.4（変化なし）/ 最大 44.2 → 41.4
 *   狙いどおり中央値は動かず、最大側だけが 12% 縮んだ。
 *   なみなみの中央 41.3 は `MOUTH_W_RATIO` に書いてある設計目標 41 とも一致する
 *   （あの表の目標を実測が 3px 超えていたのが、ここで揃った）。
 *
 * 【`mouthSpan()` / `faceCoreOf()` との整合】
 *   ここで動かすのは `mouth.w` の **値だけ** で、比の表（`MOUTH_UP_RATIO` /
 *   `MOUTH_DOWN_RATIO` / `MOUTH_H_RATIO`）はすべて w に対する比のまま。
 *   `mouthSpan()` も `faceCoreOf()` も w からその比で求めているので、
 *   口が縮めば禁止帯・表情の芯も同じ割合で縮む。ずれは生じない。
 *
 * 【追記 — 2 回目の指摘（`MOUTH_W_RATIO` 側の追記を参照）】
 *   上の「中央値は動かず」は 1 回目の指摘（最大値だけ抑える）の記録であり、
 *   **今は成り立っていない**。2 回目の指摘で `MOUTH_W_RATIO` 自体を
 *   種類ごとに引き下げたため、中央値も p90 も動いている。
 *   この `MOUTH_EFF_KNEE` / `MOUTH_EFF_SOFT` の膝は「実寸に対する上限」という
 *   役割自体は変わらず残しており、2 回目の調整後もそのまま機能している
 *   （併用して問題ないことは 500 体の実測・自動検査で確認済み）。
 *   最新の実測値は `MOUTH_W_RATIO` のコメントを見ること。
 */
const MOUTH_EFF_KNEE = 19;
const MOUTH_EFF_SOFT = 0.55;

const softenMouthWidth = (eff: number): number =>
  eff <= MOUTH_EFF_KNEE ? eff : MOUTH_EFF_KNEE + (eff - MOUTH_EFF_KNEE) * MOUTH_EFF_SOFT;

export function layoutFace(pheno: Phenotype, shape: BodyShape, faceBox: Box): FaceLayout {
  const cx = faceBox.x + faceBox.w / 2;
  const count = clamp(Math.round(pheno.parts.eyeCount || 2), 1, 3);
  const shapeId = pheno.parts.eyeShape;
  const solid = isSolidEye(pheno.parts);
  // 点目は「小ささ」が形質なので、形ごとの拡大倍率は掛けない。
  const sizeK = solid ? 1 : eyeSizeK(shapeId);
  const eSize = spreadOut(pheno.eyeSize);
  const eSpace = spreadOut(pheno.eyeSpacing, 2.5);
  // 顔全体の高さも個体差にする（同じ素体でも「顔が高い子／低い子」が出る）
  const rng = new Rng(pheno.seed).stream('faceLayout');
  const faceLift = rng.float(-0.13, 0.13) + (pheno.plump - 0.5) * 0.1;
  const cy = clamp(
    faceBox.y + faceBox.h / 2 + faceBox.h * faceLift,
    faceBox.y + faceBox.h * 0.3,
    faceBox.y + faceBox.h * 0.72,
  );
  /**
   * 顔の中での「目の高さ」の個体差。
   *
   * 【faceLift だけでは足りない理由】
   *   faceLift は顔の中心（目と口をまとめた塊）ごと上下させるので、
   *   目と口の **間隔** は全個体で同じままだった。
   *   額が広い子／目が口に近い子といった顔つきの違いはここで出る。
   *   目を上げれば口を置く余地も広がるので、口の大きさの分散にも効く。
   * 【±0.09 に留めた理由 — 実測】
   *   ±0.13 まで広げたところ、500 体の自動検査で `53QS-AV4N` が
   *   face-outside-body:eye1 で落ちた（成体・幼体とも）。
   *   目を上げると体が細くなる高さへ入るうえ、左右差（asymmetry）の
   *   高さ補正が**幅を合わせた後に**かかるため、そこで輪郭を越える。
   *   ±0.09 なら成体・幼体それぞれ 500 体で 0 件。
   */
  const eyeLift = rng.float(-0.09, 0.09);
  const met = (ss: number): { rx: number; ry: number } => eyeMetrics(shapeId, ss, solid);

  const eyes: EyeSlot[] = [];

  if (count === 1) {
    const eyeY = cy - faceBox.h * (0.06 + eyeLift);
    // 形ごとの倍率。大きくしても下の輪が輪郭・重なりの制約で縮めるので破綻はしない。
    let s = lerp(19, 32, eSize) * sizeK;
    for (let i = 0; i < 24; i++) {
      const m = met(s);
      const limit = Math.min(faceBox.w / 2 - 5, innerHalfSpan(shape, eyeY - m.ry, eyeY + m.ry, 9));
      if (m.rx <= limit && m.ry <= faceBox.h * 0.44) break;
      s *= 0.94;
    }
    const m = met(s);
    eyes.push({ x: cx, y: eyeY, s, dir: 0, rx: m.rx, ry: m.ry, brow: false });
  } else if (count === 3) {
    const eyeY = cy + faceBox.h * (0.07 - eyeLift);
    let s = lerp(10, 18, eSize) * sizeK;
    let dx = 0;
    for (let i = 0; i < 30; i++) {
      const m = met(s);
      const wantDx = lerp(0.2, 0.42, eSpace) * faceBox.w;
      const minDx = minEyeDx(shapeId, m.rx, 1.16);
      const maxDx =
        Math.min(faceBox.w / 2, innerHalfSpan(shape, eyeY - m.ry, eyeY + m.ry, 8)) - m.rx - 1;
      if (minDx <= maxDx) {
        dx = clamp(wantDx, minDx, maxDx);
        break;
      }
      s *= 0.93;
    }
    const m = met(s);
    if (dx === 0) dx = Math.max(minEyeDx(shapeId, m.rx, 1.16), 8);
    // 額の目。左右の目より小さく、確実に上へ離す。
    //
    // 【下げるのではなく縮める理由】
    //   額は体が細くなっていくので、そのままだと輪郭を突き抜ける。
    //   これを「下げて避ける」と左右の目に近づいて重なり、
    //   検査の eye-overlap が増える。
    //   高さは動かさず、その高さに収まるまで額の目そのものを小さくする。
    //
    // 【縦の間隔と横幅を同じ輪の中で見る理由】
    //   以前は「間隔を確保 → その後で上端・faceBox で押し戻す →
    //   横幅だけ別に縮める」の順だったため、押し戻しで間隔の保証が
    //   壊れても誰も直さず、額の目が左右の目に重なったまま出ていた
    //   （500 体で 2 体、幼体で 3 体。いずれも重なり面積 47〜161）。
    //   間隔・上端・横幅をすべて満たすまで、縮めながら回す。
    let bs = s * 0.74;
    let bm = met(bs);
    let browY = cy - faceBox.h * 0.3;
    for (let i = 0; i < 30; i++) {
      const minGap = m.ry + bm.ry + 2.5;
      const want = Math.min(cy - faceBox.h * 0.3, eyeY - minGap);
      const y = Math.max(want, shape.topY + bm.ry + 5);
      const fits =
        eyeY - y >= minGap && innerHalfSpan(shape, y - bm.ry, y + bm.ry, 5) >= bm.rx;
      if (fits || i === 29) {
        browY = y;
        break;
      }
      bs *= 0.9;
      bm = met(bs);
    }
    eyes.push({ x: cx - dx, y: eyeY, s, dir: -1, rx: m.rx, ry: m.ry, brow: false });
    eyes.push({ x: cx + dx, y: eyeY, s, dir: 1, rx: m.rx, ry: m.ry, brow: false });
    eyes.push({ x: cx, y: browY, s: bs, dir: 0, rx: bm.rx, ry: bm.ry, brow: true });
  } else {
    const eyeY = cy - faceBox.h * (0.04 + eyeLift);
    let s = lerp(12, 24, eSize) * sizeK;
    let dx = 0;
    for (let i = 0; i < 30; i++) {
      const m = met(s);
      const wantDx = lerp(0.19, 0.4, eSpace) * faceBox.w;
      const minDx = minEyeDx(shapeId, m.rx, 1.14);
      const maxDx =
        Math.min(faceBox.w / 2, innerHalfSpan(shape, eyeY - m.ry, eyeY + m.ry, 7)) - m.rx - 1;
      if (minDx <= maxDx) {
        dx = clamp(wantDx, minDx, maxDx);
        break;
      }
      s *= 0.93;
    }
    const m = met(s);
    if (dx === 0) dx = Math.max(minEyeDx(shapeId, m.rx, 1.14), 10);
    eyes.push({ x: cx - dx, y: eyeY, s, dir: -1, rx: m.rx, ry: m.ry, brow: false });
    eyes.push({ x: cx + dx, y: eyeY, s, dir: 1, rx: m.rx, ry: m.ry, brow: false });
  }

  // 軽い左右差（角度ではなく高さで出す。破綻しない範囲）。
  if (eyes.length >= 2 && pheno.asymmetry > 0.45) {
    const d = (pheno.asymmetry - 0.45) * 3.2;
    eyes[0]!.y += d;
    eyes[1]!.y -= d * 0.5;
  }

  // ── 高さを動かしたあとに、その高さの実輪郭へ収め直す ──────────
  //
  // 【なぜ必要か — 500 体の実測で特定】
  //   目の幅を合わせる輪（上の for）は `innerHalfSpan`、つまり
  //   halfAt（左右の輪郭の距離 ÷ 2 ＝ 平均の半幅）で余裕を測っている。
  //   ところが左右非対称な体では狭い側の余裕を過大に見積もるうえ、
  //   直後の左右差補正が**幅を合わせた後に高さを動かす**ので、
  //   体が細くなる高さへ上げた目が輪郭を突き抜けていた
  //   （`53QS-AV4N`: 成体 4.1px / 幼体 2.0〜4.5px のはみ出し）。
  //
  // 【横へ寄せるのではなく縮める理由】
  //   x を中心へ寄せると目同士が近づき、今度は eye-overlap が出る。
  //   縮めれば rx が減って収まり、間隔（dx）は動かないので重ならない。
  //   ry も減るため、目が縦に占める範囲が狭まって余裕自体も増える。
  for (const e of eyes) {
    for (let i = 0; i < 14; i++) {
      if (boxInsideBody(shape, e.x, e.y, e.rx, e.ry)) break;
      e.s *= 0.94;
      const m2 = met(e.s);
      e.rx = m2.rx;
      e.ry = m2.ry;
    }
  }

  // 口。目の下、顔の中心線上。
  //
  // 【大きくし続けたのをここで反転させる — 製品オーナーの方針】
  //   「引きで口が消える」への対処として基準幅を二度引き上げ、
  //   200 体の実測で 口幅 中央 63.4 / 最大 90.7（体幅 約130）まで来た。
  //   顔の下半分を口が占める大きさで、方針は
  //   「全体的に今より小さく、単純な形を基本にする」。
  //   基準幅を約 0.72 倍に戻し、種類ごとの倍率（`MOUTH_W_RATIO`）で
  //   実寸を揃える。引きで消えないための担保は、幅ではなく
  //   線の太さ（`face.ts` の `sw`）で取る。
  const lowest = eyes.reduce((acc, e) => Math.max(acc, e.y + e.ry), -Infinity);
  const faceBottom = faceBox.y + faceBox.h;
  /**
   * 口を置いてよい下限。
   *
   * 【faceBox の底で止めていたのが「口が小さい」の真因だった — 500 体の実測】
   *   faceBox は「装飾が顔を覆っていないか」を測るために決めた箱で、
   *   目が大きい個体は目だけで箱が埋まる。そこを口の下限にしていたため
   *   「目の下に 3px の余地も無い」状態になり、下の輪が 18 回まわって
   *   口の幅が 11%（＝ 5〜10px）まで潰れていた。
   *   **成体の 14.4%（72/500）・幼体の 28.8%（144/500）** がこれに当たり、
   *   「口が目に対して小さすぎる」の正体はこの潰れだった。
   *   口は faceBox ではなく体の内側に収まっていればよい（自動検査もそう見る）。
   *   顔から離れすぎないよう、箱の高さの 1.32 倍を上限として残す。
   *
   * 【1.2 → 1.32 に広げた理由 — 400 体の実測】
   *   口の bbox を実寸（上下非対称）に直したところ、口の **本当の上端** が
   *   目の下端に食い込んでいる個体がまだ多数あり、そのほとんどで
   *   `wantY` がここで頭打ちになっていた。1.32 なら目との余白を確保でき、
   *   口の幅（中央値 70）は変わらない。
   */
  const mouthLowLimit = Math.max(
    faceBottom - 4,
    Math.min(shape.bottomYAt(cx) - 12, faceBox.y + faceBox.h * 1.32),
  );
  // 【最大側だけを抑える 3 段】
  //   1) 基準幅（種類に依らない、その個体の口の大きさ）
  //   2) 種類ごとの倍率で狙った実寸に落とす
  //   3) **画面に出る幅**（＝ 2 の値 × 描画側の倍率）に柔らかい上限を掛け、
  //      それを半幅の単位へ戻す。膝以下は素通りなので中央値は動かない。
  //      根拠は `MOUTH_EFF_KNEE` の注記（成体 500 体の実測）を参照。
  const mouthBase = clamp(
    lerp(18, 32, spreadOut(pheno.eyeSize * 0.45 + rng.float(0.2, 0.8) * 0.55, 1.8)) *
      (0.9 + pheno.size * 0.2),
    14,
    35,
  ) * (MOUTH_W_RATIO[pheno.parts.mouth] ?? 1);
  const drawK = MOUTH_DRAW_K[pheno.parts.mouth] ?? 1;
  const mouthW = softenMouthWidth(mouthBase * drawK) / drawK;
  const hRatio = MOUTH_H_RATIO[pheno.parts.mouth] ?? 0.62;
  const upK = MOUTH_UP_RATIO[pheno.parts.mouth] ?? 0.34;
  // 口の実寸の上端が目の下端から `MOUTH_EYE_GAP` 離れる高さを最低ラインにする。
  // ここで下限を引き上げても、体に入らなければ下の輪が上へ戻して調整する。
  const mouthClear = lowest + MOUTH_EYE_GAP + Math.min(mouthW, faceBox.w * 0.5) * upK;
  const wantY = clamp(
    Math.max(lowest + Math.max(8, eyes[0]!.s * 0.56), mouthClear),
    lowest + 5,
    mouthLowLimit,
  );

  /**
   * 口を「置ける場所へ動かす」→「それでも入らなければ縮める」の順で決める。
   *
   * 【順番が大事な理由 — これが「口が小さい」の直接原因だった】
   *   以前は位置を wantY に固定したまま幅だけを 18 回縮めていた。
   *   縮めても入らない体つき（目が大きく、口の下の余地が薄い個体）では
   *   最後まで縮みきって、幅 5〜10px の見えない口になっていた。
   *   まず上へ 3px ずつ戻して収まる高さを探し、
   *   そこでも駄目なときだけ縮める。ほとんどの個体は 1〜2 回の移動で収まる。
   *
   * 【bbox の実寸で判定する理由】
   *   bbox は `boxAround(x, y, w, max(5, h))` で作られるので、
   *   高さの下限 5 もそこに合わせる（検査と実装で基準をずらさない）。
   */
  let mw = Math.min(mouthW, faceBox.w * 0.5);
  let mouthY = wantY;
  for (let i = 0; i < 12; i++) {
    const mh = Math.max(5, mw * hRatio);
    /**
     * 上へ戻ってよい限界。
     *
     * 【`lowest - 6`（＝目に食い込んでよい）をやめた理由】
     *   「体の外へ出るよりまぶたに触れるほうがまし」という判断で
     *   目の下端より 6px 上まで戻れるようにしていたが、
     *   触れた口は目の一部として読まれ、顔が「1 つの塊」になる。
     *   口の **実寸の上端**（`mw × upK`）が目の下端から
     *   `MOUTH_EYE_GAP` 以上離れる高さを下限にする。
     *   ここまで戻っても入らない個体は、次の周回で口を縮める。
     */
    const highLimit = Math.min(wantY, lowest + MOUTH_EYE_GAP + mw * upK);
    let y = wantY;
    let placed = false;
    for (let k = 0; k < 12; k++) {
      if (boxInsideBody(shape, cx, y, mw, mh)) {
        placed = true;
        break;
      }
      if (y - 3 < highLimit) break;
      y -= 3;
    }
    if (placed || i === 11) {
      mouthY = y;
      break;
    }
    mw *= 0.88;
  }

  // 頬。口の少し上、目の外側。
  const cheekY = clamp(mouthY - 2, faceBox.y + 8, faceBottom - 3);
  const cheekX = Math.min(faceBox.w * 0.38, innerHalf(shape, cheekY, 11));
  const cheeks = [
    { x: cx - cheekX, y: cheekY, rx: 8.4, ry: 5.2 },
    { x: cx + cheekX, y: cheekY, rx: 8.4, ry: 5.2 },
  ];

  // 首かざりは口から十分離す（口の真下に帯が来ると口の一部に見えてしまう）
  //
  // 【下限を顔の位置で変える理由 — 実測】
  //   横広のスライムは顔が体のかなり下まで来るので、「接地から 20 上」という
  //   一律の下限では首かざりが顔の中へ食い込み、自動検査の face-covered が
  //   鳴っていた（`89GZ-6M3E` 65% / `Q6U6-7YMX` 44%）。
  //   顔より下に置けない体つきのときだけ、接地の近くまで下げてよいことにする。
  //   条件を付けるので、余裕のある個体の首かざりの位置は 1px も動かない。
  const wantNeck = Math.max(faceBottom + 10, mouthY + 22);
  const neckLow =
    shape.botY - (shape.grounded ? (wantNeck > shape.botY - 20 ? 11 : 20) : 30);
  const neckY = clamp(wantNeck, shape.topY + 30, neckLow);

  return {
    box: faceBox,
    cx,
    cy,
    eyes,
    mouth: { x: cx, y: mouthY, w: mw, h: mw * hRatio },
    cheeks,
    neckY,
  };
}
