/**
 * Phenotype.palette から「描画に必要な色一式」を解決する。
 *
 * Phenotype.palette は本体・腹・模様・アクセントなど基本色を持つが、
 * 描画では更に「葉の緑」「結晶の青」「瞳の黒」「紙の色」など
 * 配色ファミリーから調和的に導く色が要る。ここで一括して決める。
 *
 * 方針:
 *   - 輪郭は必ず inkFor(body)。彩度が暴れても輪郭が読めることを保証する。
 *   - 植物器官は「緑」だが、完全な純緑ではなく本体色相へ少し寄せて馴染ませる。
 *   - 結晶は本体色相 + 一定角度の淡い寒色。
 *   - どの色も PAPER(#f8efdf) の上で沈まないよう明度下限/上限を持たせる。
 */

import type { Phenotype } from '../core/types.ts';
import {
  contrastRatio,
  darken,
  hexToHsl,
  hslToHex,
  inkFor,
  lighten,
  mix,
  PAPER,
  PAPER_DARK,
} from '../core/color.ts';
import { clamp, lerp } from '../core/rng.ts';

export interface RenderColors {
  paper: string;
  body: string;
  bodyDark: string;
  bodyLight: string;
  belly: string;
  ink: string;
  /** 暗背景用のインク（明度を上げたもの）。 */
  inkDark: string;
  /**
   * 線・塗りに **実際に書く** インクの値。
   *
   * 【なぜ色そのものではなく CSS 変数なのか】
   *   暗背景では ink がそのまま紙（#221d26）と 1.15:1 まで沈み、
   *   輪郭が消えて生きものの片側が背景に溶けていた（実測 `Q5ZA-N8Y3`）。
   *   個体ごとに 2 枚描くのは現実的でないので、
   *   `svg[data-uid=…]` でスコープした CSS 変数を 1 つだけ切り替える。
   *   `--gm-ink` が定義されていない環境（PNG 書き出しなど）では
   *   フォールバックの明背景用インクがそのまま使われる。
   *   計算（mix / darken / コントラスト測定）には必ず `ink` のほうを使うこと。
   */
  inkPaint: string;
  /** 少し薄いインク（内側の線・細部用）。 */
  inkSoft: string;
  pattern: string;
  accent: string;
  iris: string;
  irisDark: string;
  pupil: string;
  glow: string;
  /** 発光の芯（ほぼ白・わずかに色み）。暗背景で「光っている」ことを担う。 */
  glowCore: string;
  /** 発光の中間色（鮮やか）。明背景で光を読ませるのはこの色。 */
  glowMid: string;
  /** 発光の外縁（濃く鮮やか）。にじみの外側。 */
  glowEdge: string;
  cheek: string;
  /** 植物器官の色。 */
  leaf: string;
  leafLight: string;
  leafDark: string;
  /** 花の色。 */
  petal: string;
  petalCore: string;
  /** 結晶の色。 */
  crystal: string;
  crystalLight: string;
  /** 白目。 */
  sclera: string;
  /** 本体の不透明度（透明感・質感から決まる）。 */
  bodyOpacity: number;
  /**
   * 体の中身（腹・素体アクセント・模様）に掛ける不透明度の倍率。
   *
   * 【なぜ要るか】
   *   `veil`（うすぎぬ）は本体の塗りを薄くするが、その上に描く腹・模様・
   *   ハイライトが不透明のままだと「薄い膜」に見えず、ただ縁だけ透けた
   *   厚い体になる。膜の内側にあるものは等しく薄くする必要がある。
   */
  sheer: number;
  /** 発光の強さ 0..1。 */
  glowAmt: number;
  /** 配色ファミリー ID。無彩色（ash）の特別扱いに使う。 */
  family: string;
  /**
   * 配色ファミリーが意図した色相（度）。
   * 無彩色の個体は本体 hex から色相を復元できない（灰は色相を持たない）ので、
   * 「本来の色相」が要る処理はこちらを見る。
   */
  bodyHue: number;
  /**
   * 本体色相が「土の色」として読まれる帯（橙〜黄）にどれだけ入っているか 0..1。
   *
   * 【描画側が知る必要がある理由】
   *   薄く重ねた黒は、地の色によってまったく別の色名になる。
   *   紫の地に 26% の黒 → hsl(265,30,36)＝濃い紫（＝陰に見える）
   *   橙の地に 26% の黒 → hsl(28,32,43)＝**茶**（＝土・汚れに見える）
   *   模様を薄めて逃がす処理は、この帯でだけ別の逃がし方に切り替える必要がある。
   */
  earthy: number;
  /**
   * 本体色相が「肉の色」として読まれる暖色帯（色相 340〜60）にどれだけ入っているか 0..1。
   *
   * 【`earthy` と別に要る理由 — 実測】
   *   `earthy` は色相 44 を中心とした狭い帯（30〜58 で 1.0）なので、
   *   **さんご（色相 10〜20）が対象外**だった。細かい粒はさんごの地の上で
   *   そのまま「挽き肉・モルタデッラ」に読まれる（`UBJM-HZYU` は 100 体シートの
   *   1 番目のセルでまさにそれだった）。土に見えるかどうかと、
   *   肉に見えるかどうかは別の帯なので、係数を分ける。
   */
  warm: number;
}

/** 質感ごとの基本不透明度。 */
const TEXTURE_OPACITY: Record<string, number> = {
  matte: 1,
  jelly: 0.87,
  pearl: 0.97,
  frost: 0.93,
  mossy: 1,
  mineral: 0.98,
  glassy: 0.68,
  // うすぎぬ: 4 つの半透明質感のなかで最も薄い。
  // glassy(0.68) は「厚いガラスの塊」なので中身が歪んで濃く見えるが、
  // veil は「向こうが透ける薄い膜」なので地の紙がそのまま透ける。
  veil: 0.46,
};

/** 牛柄（腹白＋牛柄を含む）。インクを黒側へ寄せる対象。 */
const COW_PATTERNS: ReadonlySet<string> = new Set(['cow', 'bellyCow']);

/** ヤドクガエル系の模様。地と模様のコントラストを別扱いで作る。 */
export const DART_PATTERNS: ReadonlySet<string> = new Set([
  'dartBand',
  'dartNet',
  'dartDrop',
  'dartPebble',
]);

/**
 * 暗背景用のインク。
 *
 * 【なぜ要るか — 実測】
 *   輪郭インクは明度 22 前後に固定されている。明背景（#f8efdf）では
 *   9.6〜12.6:1 で申し分ないが、暗背景のカード（#221d26）に対しては
 *     `Q5ZA-N8Y3` **1.15:1** ／ `QCB8-C65V` 1.25:1 ／ しも系 1.41:1
 *   しかなく、輪郭が背景と見分けられない。暗い体色の個体は
 *   輪郭も体も背景に沈み、右半分が消えたように見えていた。
 *
 * 【一律に「明度 +27」で上げなかった理由 — 実測して分かったこと】
 *   指示どおり +27 すると背景とは 3.4〜3.9:1 まで離れるが、
 *   今度は **体との差** が 1.20〜1.51:1 まで潰れた
 *   （`ZG9W-6RWF` 1.20 ／ `Q5ZA-N8Y3` 1.46 ／ `QCB8-C65V` 1.51）。
 *   輪郭が体に溶けては「太いインク輪郭」という美術方針が消えてしまう。
 *   輪郭は背景と体の **両方** から離れていなければ意味がないので、
 *   min(背景との比, 体との比) が最大になる明度を選ぶ。
 *
 * 【「体より暗い側」だけを見ていたのが残った破綻の原因だった — 計算で確認】
 *   以前は体が背景から 3.6:1 以上離れていれば「体より暗い側」だけを走査し、
 *   それ未満のときだけリムライト（体より明るい縁）を許していた。
 *   ところが **中間調の体** はこのしきい値のすぐ上に居る。
 *   たそがれの紫 `#937bc6` は背景と 4.6:1 なので暗い側しか探せないが、
 *   暗いインクで両側 3:1 を取るには
 *     背景側 (X+0.05)/0.0655 ≥ 3 → 輝度 X ≥ 0.146
 *     体側   (0.30)/(X+0.05) ≥ 3 → 輝度 X ≤ 0.050
 *   と矛盾し、**数学的に不可能**だった（実測 2.09:1 で頭打ち）。
 *   同じ体でも白に近い縁なら体と 2.9:1・背景と 13:1 が取れる。
 *   つまり中間調では「暗い縁」ではなく「明るい縁」しか解が無い。
 *
 * 【しきい値をやめて全域を走査し、暗い側を優遇する形にした理由】
 *   明るい体（しも・しんじゅ）では暗い縁のほうがスコアが高いので、
 *   全域を走査しても選ばれるのは従来どおり暗い縁になる。
 *   一方、解が無い帯だけ自動的に明るい縁へ切り替わる。
 *   ただし僅差で明暗が入れ替わると同系統の個体で縁の性格がばらつき、
 *   しかも明るい縁は「インクで描いた線」ではなく「光っている縁」に見える。
 *   明るい縁は暗い縁を **1.35 倍以上** 上回ったときだけ採る。
 *   この比なら、暗い縁が本当に成立しない暗い体でだけ切り替わる。
 *
 * 【判定を HSL の明度ではなく背景とのコントラストで行う理由】
 *   彩度の高い色は HSL の明度が高くても輝度が低い。たそがれの地
 *   hsl(265,70,50) は明度 50 なのに背景との比が 2.8 しかなく、
 *   「明るい体」として扱うと逃げ場が無くなる（実測 `ZG9W-6RWF` 1.77:1）。
 */
export function inkOnDark(ink: string, body: string): string {
  const h = hexToHsl(ink);
  const b = hexToHsl(body);
  const s = clamp(h.s * 0.92, 0, 46);
  /** 背景と体の両方からどれだけ離れているか（小さいほうが効く）。 */
  const score = (col: string): number =>
    Math.min(contrastRatio(col, PAPER_DARK), contrastRatio(col, body));
  /** 走査して最良の 1 色とそのスコアを返す。 */
  const scan = (lo: number, hi: number): { col: string; sc: number } => {
    let col = hslToHex(h.h, s, clamp(lo, 4, 94));
    let sc = -1;
    for (let l = lo; l <= hi; l += 2) {
      const cand = hslToHex(h.h, s, clamp(l, 4, 94));
      const v = score(cand);
      if (v > sc) {
        sc = v;
        col = cand;
      }
    }
    return { col, sc };
  };
  // 暗い縁（従来の探索範囲）。体より明るくならないところまで。
  const dark = scan(h.l, Math.max(h.l, clamp(b.l - 8, h.l, 66)));
  // 明るい縁（暗い場面のリムライト）。体より確実に明るい帯だけを見る。
  const light = scan(clamp(b.l + 10, 40, 90), 92);
  return light.sc > dark.sc * 1.35 ? light.col : dark.col;
}

/**
 * インク色をテーマで切り替える CSS。
 *
 * 接地影の切り替え（creature.ts の SHADOW_THEME_CSS）とまったく同じ仕組み。
 * 違うのは色が個体ごとに変わることだけなので、ルートの `data-uid` で
 * セレクタをその個体に絞る。インライン SVG の `<style>` は文書全体に効くため、
 * 同じページに 100 体並べても互いを侵さない。
 */
export function inkThemeStyle(
  uid: string,
  light: string,
  dark: string,
  extra?: Readonly<Record<string, readonly [string, string]>>,
): string {
  const sel = `svg[data-uid="${uid}"]`;
  const vars = (i: 0 | 1): string => {
    let s = `--gm-ink:${i === 0 ? light : dark}`;
    for (const [name, pair] of Object.entries(extra ?? {})) s += `;--gm-${name}:${pair[i]}`;
    return s;
  };
  return (
    `<style>` +
    `${sel}{${vars(0)}}` +
    `@media(prefers-color-scheme:dark){${sel}{${vars(1)}}}` +
    `:root[data-theme="light"] ${sel}{${vars(0)}}` +
    `:root[data-theme="dark"] ${sel}{${vars(1)}}` +
    `</style>`
  );
}

/** 角度差を -180..180 に畳む。 */
function hueDelta(a: number, b: number): number {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  if (Object.is(d, -180)) d = 180;
  return d;
}

/**
 * 「土の色」として読まれる色相帯（橙〜黄）の強さ 0..1。
 *
 * 【なぜ色相で場合分けが要るのか — 実測して分かったこと】
 *   ヤドクガエル系の地と模様の明度差は、11 配色すべてで ΔL 38〜49 あり、
 *   WCAG コントラスト比はむしろ暖色のほうが高い。
 *     おきび  地 #e0a444(L58) / 網 #3b2f1d(L18)  ΔL 40  CR 5.14〜6.76
 *     たそがれ 地 #9643dd(L58) / 網 #2b1c38(L18)  ΔL 40  CR 2.69〜3.86
 *   つまり **明度差の保証そのものは暖色でも効いている。**
 *   それでも暖色だけが破綻するのは、明度ではなく「色の名前」の問題で、
 *   彩度を持った暗い橙〜黄は黒ではなく **茶** として読まれるため。
 *   茶の網が黄土色の地に乗れば、コントラストが足りていても
 *   「ひび割れた土」「メロンの皮」になる。ヤドクガエルの地と模様の関係は
 *   「黒 × 鮮やか」であって「茶 × 黄土」ではない。
 *   そこでこの帯だけ彩度を抜き、黒側／明るい側へ振り切る。
 */
export function earthy(h: number): number {
  const d = Math.abs(hueDelta(((h % 360) + 360) % 360, 44));
  return clamp(1 - (d - 14) / 26, 0, 1);
}

/**
 * 「生肉の色」として読まれる暖色帯（色相 340〜60）の強さ 0..1。
 *
 * 細かい粒（speckle）は、暖色の地の上では粒ひとつひとつが
 * **独立した肉片**として読まれる。寒色の地では同じ粒が石の斑に見えるので、
 * これも `earthy` と同じく色相の問題。ただし帯の位置が違う。
 *   `earthy` … 色相 44 中心（＝土・黄土）
 *   ここ      … 色相 20 中心・±40 度（＝さんご〜おきび、生肉の帯）
 * 中心を 20 に置くと 340〜60 が 1.0 になり、さんご（10〜20）が確実に入る。
 */
export function warmMeat(h: number): number {
  const d = Math.abs(hueDelta(((h % 360) + 360) % 360, 20));
  return clamp(1 - (d - 40) / 20, 0, 1);
}

/**
 * 色 `c` の色相を、基準色 `base` の色相 ±`maxDeg` 度に収める。
 * 彩度・明度はそのまま残すので、器官が「同じ色のべた塗り」にはならない。
 *
 * 【なぜ要るか】
 *   耳・角・尾・羽が palette の accent（本体色相 ±160 度まで振れる）を
 *   そのまま使っていたため、桃色の体に緑の耳のような補色衝突が起きていた
 *   （ビジュアル批評 P2-12）。器官は体の一部なので色相を近づける。
 */
export function harmonize(base: string, c: string, maxDeg = 30): string {
  const b = hexToHsl(base);
  // 【無彩色（ash）の例外】
  //   灰色は色相を持たない。hexToHsl は r=g=b のとき h=0（＝赤）を返すので、
  //   そのまま基準にすると耳も角も尾も赤系へ引き寄せられてしまう。
  //   灰の体では「色を持つのは装飾と目と模様だけ」が設計意図なので、
  //   基準が無彩色のときは色相を動かさない。
  if (b.s < 10) return c;
  const t = hexToHsl(c);
  const d = hueDelta(t.h, b.h);
  if (Math.abs(d) <= maxDeg) return c;
  return hslToHex(b.h + Math.sign(d) * maxDeg, t.s, t.l);
}

/** 色相だけを基準角へ引き寄せる（基準を色ではなく角度で渡す版）。 */
function towardHue(baseH: number, c: string, maxDeg: number): string {
  const t = hexToHsl(c);
  const d = hueDelta(t.h, baseH);
  if (Math.abs(d) <= maxDeg) return c;
  return hslToHex(baseH + Math.sign(d) * maxDeg, t.s, t.l);
}

/**
 * 模様に応じた「地色の作り直し」。
 *
 * 【なぜ描画側で地色を変えるのか】
 *   実在のヤドクガエルの美しさは、体色そのものではなく
 *   「地と模様の強烈な明暗差」という **関係** にある。
 *   遺伝子側（Palette）は個体の色相・彩度・明度をひとつ持つだけなので、
 *   その関係は模様を知っている描画側でしか作れない。
 *   色相と彩度は保つので、配色ファミリーの個性（さんご／みずうみ…）は残る。
 *
 * 【2 方向に分けた理由 — 参考写真 8 枚を実見して分類した】
 *   参考写真は「明るい電流のような地に黒い模様」（コバルト・イチゴヤドクガエル
 *   系＝ image17/18/19/20/24）と「黒に近い地に発光的な模様」
 *   （キオビ・トマトガエル系＝ image21/22、暗色の地＝ image23）の
 *   2 系統にはっきり分かれ、中間の「地味な中間調」は 1 枚も無かった。
 *   個体ごとに毎回どちらへ振るかを乱数で決めると、輪郭インク（`ink0`）が
 *   同じ体でも明暗の勝負に必ず負ける帯ができてしまう（実測: 地の明度が
 *   35 を切るとインクとの比が 2.0 を切り、口の線が地に沈む）。
 *   そこで **模様の種類ごとに** 方向を固定する。
 *     ・dartNet（あみめ）／dartPebble（ぶちがら）… 明るい地 × 黒い模様
 *     ・dartBand（たいおび）／dartDrop（したたり） … 暗い地 × 発光的な模様
 *   これは「模様ごとに実在の別モルフを再現している」と読めるので、
 *   ヤドクガエル系 4 種を並べたときに個体差として両方向が必ず現れる
 *   （プレイヤーが 4 種のうちどれを引くかは遺伝なので「個体ごとに」成立する）。
 *
 * @returns 作り直した地色。変更しない場合は null ではなく元の色を返す。
 */
function groundFor(pattern: string, rawBody: string, hue: number): string {
  const b = hexToHsl(rawBody);
  const ash = b.s < 10;
  const e = earthy(hue);
  const sat = (mul: number, add: number, hi: number, lo = 14): number =>
    clamp(b.s * mul + (ash ? 0 : add), ash ? 0 : lo, hi);
  /**
   * ヤドクガエル系「暗い地」グループ（dartBand / dartDrop）。
   * 土色帯では彩度をほぼ抜き、明度も少し下げて **チョコレートではなく黒** にする。
   * 寒色帯（e=0）は従来どおり彩度のある濃紺・濃緑・濃紫のままで、
   * そちらは実物でも美しいので触らない。
   *
   * 【真っ黒（L10 前後）まで落とさない理由 — 実測して決めた下限】
   *   参考写真の地は L5〜15 まで沈むが、この地は輪郭・口・まぶたの
   *   「インク」も同じ体の上に乗る。インクは `bh.l - 16` 前後まで
   *   しか暗くできない（それ以上は黒つぶれで色情報が消え、暗背景用の
   *   `inkOnDark` とも整合しなくなる）ため、地が L25 を切るとインクとの
   *   コントラスト比が 2.0 を割り、口の線が地に沈んで消える
   *   （実測: 地 L20/インク L6 で 1.6:1、地 L36/インク L4 で 3.3:1）。
   *   「模様が映える暗さ」と「輪郭が消えない明るさ」の両立点を実測し、
   *   下限を 28 に固定した。地の彩度と模様側の明度・彩度を目一杯振ることで、
   *   この明るさでも「黒に近い地」の迫力は十分に出る。
   */
  const darkGround = (target: number, lo: number, hi: number): string =>
    hslToHex(
      hue,
      clamp(sat(1.25, 10, 62) * (1 - 0.75 * e), ash ? 0 : 12, 62),
      clamp(clamp(lerp(b.l, target, 0.84), lo, hi) - 6 * e, lo, hi),
    );
  /**
   * ヤドクガエル系「明るい地」グループ（dartNet / dartPebble）。
   * 電流のように鮮やかな地に、ほぼ黒い模様を乗せる（コバルト／イチゴ
   * ヤドクガエル系）。地そのものを強く発色させることで、模様側は
   * 彩度を持たない黒 1 色でも強烈なコントラストが立つ。
   *
   * 【土色帯で上げるのは明度ではなく彩度 — 実測して決めた（旧 dartNet 由来）】
   *   同じ明度でも、彩度が足りない暖色は「黄土」＝土の色に読まれる。
   *   明度を上げるとパンの皮のようなクリーム色になり、
   *   かえってメロンパンに近づく（実際に試して確認した）。
   *   彩度を上げ切って初めて、土ではなくマリーゴールドの黄になる。
   *
   * 【描画で持ち上がるぶんを土色帯だけ先に引く — 実測して分かったこと】
   *   ここで決めた地色は、そのまま画面に出るわけではない。実際には
   *   本体グラデの左上ハイライト・腹の淡色・不透明度（紙が透ける）が
   *   重なって **必ず明るく・淡く** なる（9 体の描画ピクセルで実測: L +6〜+10）。
   *   色相 28〜52 では、その持ち上がった L はもう「マリーゴールド」ではなく
   *   **「小麦・黄土」** に見えるため、土色帯でだけ持ち上がるぶんを先に引く。
   */
  const brightGround = (target: number, lo: number, hi: number): string => {
    const l0 = clamp(lerp(b.l, target, 0.66), lo - 4, hi + 4);
    return hslToHex(
      hue,
      sat(1.42, 18, 88 + 8 * e, 22 + 46 * e),
      clamp(l0 - 11 * e, lo, hi),
    );
  };
  switch (pattern) {
    // ── 明るい地 × 黒い模様（コバルト／イチゴヤドクガエル系）───────
    case 'dartNet':
    case 'dartPebble':
      return brightGround(60, 50, 70);
    // ── 黒に近い地 × 発光的な模様（キオビ／トマトガエル系）─────────
    case 'dartBand':
      return darkGround(30, 28, 38);
    case 'dartDrop':
      return darkGround(32, 28, 40);
    case 'stardust':
      // 夜空。暗くするが真っ黒にはせず、体の形が読める明度を残す。
      return hslToHex(hue, sat(1.1, 4, 56), clamp(lerp(b.l, 34, 0.62), 30, 52));
    default:
      return rawBody;
  }
}

/**
 * 模様色。模様の種類ごとに「地との関係」を作り分ける。
 *
 * 既定（従来どおり）は本体色相 ±12 度に固定する。genetics 側の pattern は
 * アクセントの色相オフセットを 18% 引き継ぐので、暖色の体に緑や黄の斑が乗り、
 * まだらがカビ・皮膚病に見えていた（ビジュアル批評 P3-16）。
 * 明度と彩度の差だけで模様を読ませるのが基本方針。
 *
 * 例外は 3 つ。
 *   ・ヤドクガエル系 … 地を暗くしてあるので、鮮やかな色を許す（そこが芯）。
 *   ・星屑           … 星の白。アクセントの色みだけ残す。
 *   ・無彩色（ash）  … 灰の体に一点だけ色を置く。ここだけは彩度を持たせる。
 */
function patternColor(
  pat: string,
  p: Phenotype['palette'],
  body: string,
  bodyHue: number,
  acc: string,
  isAsh: boolean,
): string {
  const bh = hexToHsl(body);
  const bl = bh.l;

  if (pat === 'dapple') {
    // ── まだら ──
    // 【色相を一切動かさない】
    //   まだらが「カビ・皮膚病」に見えていた原因は、斑がアクセント色の
    //   色みを引き継いで暖色の体に緑や黄の斑が乗っていたこと。
    //   斑は「同じ皮膚の、光の当たり方が違うところ」なので、
    //   色相は本体そのまま・彩度もほぼそのまま・**明度だけ**を動かす。
    //   無彩色（ash）でも同じ（灰の体に色の斑は最も病的に見える）。
    // 明度差 22。色相が同じなので、これ以下だと「塗りむら」にすら見えず、
    // これ以上だと再び「別の色の斑」＝病変に近づく。
    const dir = bl > 54 ? -1 : 1;
    return hslToHex(
      bodyHue,
      clamp(bh.s * 0.9, isAsh ? 0 : 10, 62),
      clamp(bl + dir * 22, 14, 88),
    );
  }

  if (pat === 'dartNet' || pat === 'dartPebble') {
    // ── 明るい地に乗る **黒い** 模様（あみめ／ぶちがら）──────────
    // 彩度を残すと暖色では茶色になり、地と合わせて「ひび割れた土」
    // 「挽き肉」に見える（実測: おきびで 網 #3b2f1d ＝ 茶）。
    // 色相だけ本体から借り、彩度と明度は黒へ振り切って
    // 「地の色に関係なく黒い模様」にする。
    //
    // 【dartPebble を dartNet と同じ式に揃えた理由】
    //   旧実装は dartPebble だけ「暗い地×明るい斑」の逆方向だったが、
    //   参考写真（image17/18/19）はどれも「鮮やかな地×黒い斑」で、
    //   むしろ dartNet 側の設計のほうが実物に合っていた。
    return hslToHex(bodyHue, clamp(bh.s * 0.16, 0, 12), clamp(bl - 50, 5, 12));
  }
  if (pat === 'dartBand' || pat === 'dartDrop') {
    // ── 黒に近い地に乗る発光的な模様（たいおび／したたり）──────────
    // 色相は無彩色なら自由、有彩色なら本体 ±30〜60 度。
    //
    // 【たいおび（dartBand）だけ ±30 度に締める理由 — 実物で確認】
    //   帯は模様の中で最も面積が大きく、しかも輪郭に届くので、
    //   ±60 度だと「別の配色の帯を巻いた個体」に見える。
    //   実際に おきび（橙）の体に桃の帯、たそがれ（紫）の体に濃桃の帯が出て、
    //   交配画面で「配色は親ゆずり」と説明できない絵になっていた。
    //   ヤドクガエルらしさは色相差ではなく **明度差** で出す方針
    //   （明度は下の `Math.max(a.l + 18, bl + 50)` が担保している）。
    //
    // 【地を大幅に暗くしたぶん、模様側の彩度を底上げした — 実測】
    //   地の下限を darkGround(28..40) まで下げたので、模様側は
    //   以前の `bl + 38 / clamp 58..80` のままでは「暗い地に薄暗い模様」
    //   にしかならない。彩度を振り切って電光へ寄せる。
    //
    // 【固定式ではなく実測スキャンで明度を選ぶ理由 — 実測して発覚】
    //   「彩度最大・明度 60..76 固定」で組んだところ、青紫系（みずうみ／
    //   たそがれ）だけ実測コントラストが 1.2〜1.9:1 と壊滅していた。
    //   WCAG の輝度式は G を 0.72・R を 0.21・B をわずか 0.07 しか見ないため、
    //   同じ HSL 明度でも青は橙よりずっと「暗く」評価される
    //   （実測: 地 L36 に対し 橙 L60 で 2.1:1、青紫 L66 で 1.5:1）。
    //   色相ごとに必要な明度がまったく違うので、固定の明度レンジでは
    //   どこかの色相帯が必ず犠牲になる。`contrastRatio()` で実際に地との比を
    //   測りながら明度を探り、その色相で最も比が高い点を選ぶ
    //   （`cowColor` / `inkOnDark` と同じ「測って選ぶ」方針）。
    const span = pat === 'dartBand' ? 30 : 60;
    const a = hexToHsl(isAsh ? acc : towardHue(bodyHue, acc, span));
    const patSat = clamp(a.s * 1.6 + 30, 78, 100);
    // 【明度の探索範囲を 48..78 に区切った理由 — 「電光」と「パステル」の境目】
    //   90 まで探させると、青紫系はどこまでも明度を上げたほうが有利なため
    //   スキャンが常に上限（L90 前後）を選び、#ffcecc のような **白に色みが
    //   差しただけの淡い色** に戻ってしまった（実際に描いて確認）。
    //   実在のネオン・電光色（信号の赤・電光看板の青）は明度 78 を大きく
    //   超えない。上限を 78 に区切ることで、コントラスト最優先の暴走を止め、
    //   「その色相のなかで再取できる最良の対比」を選ばせる。
    // 【明度に単純な下限（旧 `bl + 26`）を足さなかった理由 — 実測で撤回した】
    //   下限を足すと、スキャンが「範囲内で最良」と判断した点を
    //   「地の明度＋26」という無関係な値で上書きしてしまうことがあった。
    //   実際に 地 L39 の個体で、スキャンの最良点は L48（比 1.96）なのに
    //   下限が L65 を強制し、そこはこの色相にとって **コントラストが谷になる
    //   分岐点**（比 1.00）で、かえって旧式より悪化した。
    //   スキャンの結果をそのまま信じるほうが、常にこの色相・この地の中で
    //   実際に測った最良の対比になる。
    let bestL = 66;
    let bestCr = -1;
    for (let l = 48; l <= 78; l += 2) {
      const cr = contrastRatio(body, hslToHex(a.h, patSat, l));
      if (cr > bestCr) {
        bestCr = cr;
        bestL = l;
      }
    }
    return hslToHex(a.h, patSat, bestL);
  }
  if (pat === 'stardust') {
    const a = hexToHsl(acc);
    return hslToHex(a.h, clamp(a.s * 0.55, 6, 34), clamp(Math.max(a.l + 28, bl + 36), 80, 95));
  }

  const raw = p.pattern ?? darken(body, 0.3);
  if (pat === 'speckle' && !isAsh && warmMeat(bodyHue) > 0.35) {
    // ── 暖色の地に散る細かい粒 ──
    //
    // 【粒径・不透明度だけでは抜けられなかった — 実際に試して確認】
    //   粒を 2 倍に育て不透明度を 0.4 まで落としても、`UBJM-HZYU` は
    //   挽き肉のままだった。理由は大きさではなく **明暗の向き**。
    //   桃色の地に **地より明るい** 粒が散ると、それは脂身であり、
    //   モルタデッラそのものになる。寒色（`BMH5-AL2U`）で同じ粒が
    //   「石の斑」に見えるのは、青には脂身の連想が無いからにすぎない。
    //   暖色帯では粒を必ず **地より暗く** し、彩度も抜く。
    //   暗い粒は皮膚のそばかす・花崗岩の斑として読まれる。
    const r = hexToHsl(harmonize(body, raw, 12));
    const w = warmMeat(bodyHue);
    return hslToHex(bodyHue, clamp(r.s * 0.45, 0, 20), clamp(bl - lerp(14, 22, w), 18, 68));
  }
  if (pat === 'speckle' && bl > 80 && !isAsh) {
    // ── 淡い地の細かい斑 ──
    //
    // 【なぜここだけ別扱いか — 実測】
    //   通常の模様色は `harmonize(body, raw, 12)` で本体色相 ±12 度に収める。
    //   ところが明度 80 を超える淡い地（しんじゅ・しも・淡いおきび）では、
    //   ±12 度でも彩度がそのまま残るため、細かい粒が地から色として浮き、
    //   「地の色ムラ」ではなく **地の上に散った別のもの** に見える。
    //   これが暖色で「挽き肉」、寒色で「カビ」と読まれていた正体。
    //   淡い地では色相を本体そのままにし、彩度をさらに落として
    //   明度差だけで斑を読ませる。
    const r = hexToHsl(harmonize(body, raw, 12));
    return hslToHex(bodyHue, clamp(r.s * 0.45, 0, 20), clamp(bl - 24, 44, 72));
  }
  if (isAsh) {
    // 灰の体では模様が唯一の彩度になる。明度は genetics 側の値
    // （本体と逆方向へ振ってある＝必ず読める）をそのまま使う。
    const a = hexToHsl(acc);
    const r = hexToHsl(raw);
    return hslToHex(a.h, clamp(a.s * 1.15 + 10, 26, 50), r.l);
  }
  return harmonize(body, raw, 12);
}

export function resolveColors(pheno: Phenotype): RenderColors {
  const p = pheno.palette;
  const rawBody = p.body ?? '#9ac97f';
  const hsl = p.hsl ?? hexToHsl(rawBody);
  const tex = pheno.parts.texture;
  const pat = pheno.parts.pattern ?? 'none';
  const bodyHue = ((hsl.h % 360) + 360) % 360;
  const isAsh = p.family === 'ash' || hexToHsl(rawBody).s < 10;

  // 模様が「地の暗さ」を要求する場合はここで地色を作り直す。
  const body = groundFor(pat, rawBody, bodyHue);
  const reground = body !== rawBody;
  const bh = hexToHsl(body);

  // 地色を作り直したときは、そこから導く色（インク・陰・腹）も作り直す。
  // 元の明るい体から作ったインクを暗い地に載せると輪郭が消える。
  // 土色帯では輪郭インクの彩度も落とす。黒い網目の隣に茶色の輪郭があると
  // 「黒で描いた絵」に見えず、地の茶色っぽさが輪郭から戻ってきてしまう。
  //
  // 【下限を 6 → 4 に、引く量を 14 → 16 に広げた理由 — 実測】
  //   dartBand / dartDrop の地を darkGround(28..40) まで暗くしたことで、
  //   「地の明度 − 14」だけではインクとの差が縮み過ぎる帯が出た
  //   （地 L30 のとき旧式で片や L16、比 1.98:1）。地が暗いところほど
  //   インク側も限界まで沈められるよう、引く量と下限の両方を広げた
  //   （同条件で 3.0:1 前後まで回復する）。明るい地（あみめ／ぶちがら）は
  //   上限 16 にすぐ当たるので、この変更による影響はない。
  const ink0 = reground
    ? hslToHex(
        bodyHue,
        Math.min(40, bh.s * 0.5 + 6) * (1 - 0.55 * earthy(bodyHue)),
        clamp(bh.l - 16, 4, 16),
      )
    : (p.ink ?? inkFor(rawBody));
  /**
   * 牛柄のときだけインクを黒側へ寄せる。
   *
   * 【なぜこの模様だけ特別扱いが要るか — 計算して分かったこと】
   *   牛柄は「大きな暗い塊」と「その塊の上を通る顔の線」が同居する唯一の模様。
   *   塊はインクより明るくなければ線が消え、地よりは暗くなければ塊に見えない。
   *   両方を 3.0:1 で満たすには **地の輝度 ≧ インクの輝度の 9 倍** が要る。
   *   ところが inkFor は明度 22 固定で、明るい体（L77）でもこの比は 6.6 倍しかなく、
   *   どこに塊を置いても片方が 3.0 を割った（実測: 塊↔インク 1.02〜1.27）。
   *   インクを 22 → 13 に落とすと比が 9 倍を超え、地・塊・線の 3 者が分離する。
   *   輪郭が黒く締まるぶん、牛柄の白黒らしさとも噛み合う。
   */
  const ink = COW_PATTERNS.has(pat)
    ? ((): string => {
        const i = hexToHsl(ink0);
        return hslToHex(i.h, Math.min(i.s, 34), 13);
      })()
    : ink0;
  const bodyDark = reground
    ? hslToHex(bodyHue, clamp(bh.s * 1.05, 0, 70), clamp(bh.l - 11, 8, 40))
    : (p.bodyDark ?? darken(rawBody, 0.2));
  const bodyLight = reground
    ? hslToHex(bodyHue, clamp(bh.s * 0.95, 0, 70), clamp(bh.l + 13, 20, 70))
    : (p.bodyLight ?? lighten(rawBody, 0.26));
  const belly = reground
    ? hslToHex(bodyHue, clamp(bh.s * 0.8, 0, 60), clamp(bh.l + 17, 30, 66))
    : (p.belly ?? lighten(rawBody, 0.52));

  // 植物の緑。本体色相へ 30% 寄せて馴染ませる（純緑の貼り付け感を消す）。
  const leafH = lerp(118, ((hsl.h % 360) + 360) % 360, 0.22);
  const leafHue = leafH > 200 ? lerp(118, leafH, 0.35) : leafH;
  const leaf = hslToHex(clamp(leafHue, 78, 156), 42, 46);
  const leafLight = hslToHex(clamp(leafHue + 8, 78, 160), 46, 60);
  const leafDark = hslToHex(clamp(leafHue - 6, 74, 152), 40, 33);

  // 花。アクセント色を明るく淡く。
  const acc = p.accent ?? hslToHex(hsl.h + 150, 48, 68);
  const accHsl = hexToHsl(acc);
  const petal = hslToHex(accHsl.h, clamp(accHsl.s, 34, 62), clamp(accHsl.l + 12, 66, 86));
  const petalCore = hslToHex(clamp(accHsl.h + 28, 0, 360), 62, 62);

  // 結晶。本体色相 + 40 度前後の淡い寒色。
  const crH = ((hsl.h + 46) % 360 + 360) % 360;
  const crystal = hslToHex(crH, 34, 74);
  const crystalLight = hslToHex(crH, 40, 88);

  const iris = p.iris ?? hslToHex((hsl.h + 175) % 360, 52, 40);
  const opacityBase = TEXTURE_OPACITY[tex] ?? 1;
  const translucent = 1 - clamp(pheno.translucency, 0, 1) * 0.3;
  /**
   * ヤドクガエル系は地の不透明度に下限を置く。
   *
   * 【実測して分かった、暖色だけが破綻していた最大の原因】
   *   本体は `bodyOpacity` で紙（#f8efdf）を透かす。紙は **色相 38** の
   *   クリーム色なので、橙〜黄の地はそこへ混ざると色相が変わらないまま
   *   彩度だけ落ちる ＝ そのまま「黄土・小麦」になる。
   *     おきび MJEC-HP6H（すきとおり, 不透明度 0.65）
   *       地の計算値 hsl(37,90,48) → 実測 hsl(37,75,63)（L +15）
   *   寒色は紙と色相が離れているので、同じだけ透けても
   *   「淡い紫」「淡い水色」であって別の色名にはならない。
   *   ＝ 明度差の保証は効いていたが、**地そのものが土の色に化けていた**。
   *
   *   ヤドクガエル系は「明るい鮮やかな地 × 黒い網目」という関係が模様の芯で、
   *   その芯を透明度が打ち消してしまう。質感の白い膜を dartLike で薄めている
   *   （body.ts の veilDown）のと同じ理由で、ここでも地を守る。
   *   うすぎぬ（veil）だけは「膜であること」自体が形質なので除外する。
   */
  const dartGround = DART_PATTERNS.has(pat) && tex !== 'veil';

  // ── 模様色 ────────────────────────────────────────────
  const pattern = patternColor(pat, p, body, bodyHue, acc, isAsh);

  // ── 発光の 3 色 ───────────────────────────────────────
  // 【明背景でも暗背景でも光って見えるための設計】
  //   白いにじみだけで光を描くと、紙（#f8efdf）の上では白が白に溶けて消える。
  //   逆に濃い色だけで描くと暗背景でただの染みになる。
  //   芯（ほぼ白）→ 中間（鮮やか）→ 外縁（濃く鮮やか）の 3 段にすると、
  //   明背景では中間・外縁の彩度が、暗背景では芯の明度が光を担う。
  //
  // 【色相を本体 ±55 度に収める理由】
  //   アクセントは本体色相から最大 ±165 度まで振れる。その色をそのまま光に
  //   使うと、さんご色の体に菫色の光が乗り「あざ」や「発疹」に見えた（実際に見えた）。
  //   光は体の材質を透かして出るものなので、体の色から大きく離れないほうが自然。
  //   無彩色（ash）の体は色相を持たないので towardHue はそのまま素通しになる。
  const gh = hexToHsl(isAsh ? acc : towardHue(bodyHue, acc, 55));
  const glowCore = hslToHex(gh.h, clamp(gh.s * 0.5 + 12, 16, 56), 94);
  const glowMid = hslToHex(gh.h, clamp(gh.s * 1.2 + 24, 48, 90), 70);
  const glowEdge = hslToHex(gh.h, clamp(gh.s * 1.3 + 28, 54, 94), 56);

  // うすぎぬは体の中身も同じだけ薄くする（縁だけ透ける厚い体にしない）。
  const sheer = tex === 'veil' ? clamp(0.52 + (1 - clamp(pheno.translucency, 0, 1)) * 0.2, 0.5, 0.74) : 1;

  return {
    paper: PAPER,
    body,
    bodyDark,
    bodyLight,
    belly,
    ink,
    inkDark: inkOnDark(ink, body),
    inkPaint: `var(--gm-ink,${ink})`,
    inkSoft: mix(ink, body, 0.36),
    pattern,
    accent: acc,
    iris,
    irisDark: darken(iris, 0.28),
    pupil: darken(ink, 0.35),
    glow: p.glow ?? lighten(acc, 0.4),
    glowCore,
    glowMid,
    glowEdge,
    cheek: p.cheek ?? '#f2879f',
    leaf,
    leafLight,
    leafDark,
    petal,
    petalCore,
    crystal,
    crystalLight,
    /**
     * 白目。**純白にしない**。
     *
     * 【体色を混ぜる理由 — 製品オーナーの方針「白目を減らす」】
     *   白目が人間っぽく見えるかどうかは、面積だけでなく
     *   「その白がどれだけ強く白いか」で決まる。#fffdf8 は紙(#f8efdf)より
     *   明るい純白で、体のどの色よりも明るい **画面でいちばん強い白** だった。
     *   面積を減らしても、この強さのままでは眼球の白として目に付く。
     *   体色を 18% 混ぜると、白目は「その子の体のいちばん明るいところ」になり、
     *   眼球ではなく生きものの一部として読まれる。
     *   明度はまだ 85 以上あるので、虹彩との分離（＝目の形の読み取り）は保たれる。
     */
    sclera: mix('#fffdf8', body, 0.18),
    // うすぎぬのために下限を 0.5 → 0.34 へ下げた。
    // 既存質感の実効値（glassy 0.68×0.7=0.48）はもともと下限に触れていない。
    bodyOpacity: clamp(opacityBase * translucent, dartGround ? 0.92 : 0.34, 1),
    sheer,
    glowAmt: clamp(pheno.glow, 0, 1),
    family: p.family ?? '',
    bodyHue,
    // 無彩色（灰）は色相を持たないので土色帯には入れない。
    earthy: isAsh ? 0 : earthy(bodyHue),
    warm: isAsh ? 0 : warmMeat(bodyHue),
  };
}
