/**
 * 体毛（coat）— 輪郭に沿って外向きに生える毛。
 *
 * 【なぜ「頭に生やす」ではなく「輪郭に沿わせる」のか】
 *   頭頂は植物・角・触角・結晶が既に取り合っていて、根元が近すぎる不良を
 *   自動検査が拾うようになっている（DESIGN_DECISIONS.md の D-033）。
 *   毛をそこへ足すと、必ずその検査に掛かる。輪郭の全周へ散らす方式なら
 *   「1 か所から生えている器官」ではないので `roots` を宣言する必要がなく、
 *   既存の装飾と場所を奪い合わない。
 *
 * 【なぜ体より奥（Z.COAT = 10）に描くのか】
 *   毛は体の内側から始めて外へ伸ばし、体内部分をマスクで切り落とす
 *   （model.ts の BACK_MASKED）。切り口はちょうど輪郭と重なり、その上から
 *   Z.OUTLINE が輪郭を引き直すので、付け根は太いインク線の下に隠れる。
 *   足・耳・尾・羽と同じ、実績のある「生えている」の作り方。
 *   さらに羽・耳・尾よりも奥に置いてあるので、器官の付け根が毛に埋もれない。
 *
 * 【決定論】
 *   乱数は `ctx.rng('coat')` の名前付きサブストリームのみ。
 */

import { clamp, lerp } from '../../core/rng.ts';
import { Z, type DrawCtx, type PartOut } from '../ctx.ts';
import { GROUND_Y, VIEW } from '../geom.ts';
import { boxOf, flattenPath, group, n, path, type Vec } from '../svg.ts';

/** 毛の生えかたごとの寸法。 */
interface CoatStyle {
  /** 輪郭に沿った毛の間隔。小さいほど密。 */
  gap: number;
  /** 毛の長さ（基準）。 */
  len: number;
  /** 長さのばらつき（±の割合）。 */
  vary: number;
  /** 付け根の太さ（半幅）。 */
  wid: number;
  /** 重力になびく強さ（0 で真っ直ぐ）。 */
  curl: number;
  /**
   * 側面のふくらみ。0.5 でまっすぐな三角、大きいほど葉のようにふくらみ、
   * 小さいほど針のようにくびれる。
   *
   * 【この 1 つの数だけで種類が描き分けられる理由】
   *   最初は長さと太さだけで 5 種を作ったが、実際に並べると
   *   「同じとげの長短」にしか見えなかった（実測: もこもこ・つんつん・
   *   ぼさぼさが判別できない）。輪郭の曲がり方こそが
   *   「ふわふわ」と「とげとげ」を分けている。
   */
  taper: number;
  /**
   * 先端の丸み。0 でとがり、大きいほど丸い房になる（付け根の太さに対する割合）。
   *
   * 【なぜ「太さ」だけでは足りなかったか】
   *   もこもこを太く短くしただけでは、先がとがったままなので
   *   「細かいギザギザ（ピンキングばさみの切り口）」にしか見えなかった。
   *   ふわふわに見えるかどうかを決めているのは **先端が丸いこと**。
   */
  blunt: number;
  /**
   * 隣どうしを溶かして 1 つの塊として描くか。
   *
   * 【なぜ切り替えが要るか — 実測して分かった】
   *   毛は 1 本ずつ独立した閉じたパスなので、そのまま線を引くと
   *   **重なった相手の輪郭も全部見えてしまう**。房を重ねた「もこもこ」は
   *   これで輪が鎖状に並び、ふわふわではなく **レース編みの縁飾り** に
   *   見えていた（v3 で実際にそうなった）。
   *   true のときは「インクで塗りつぶした版 → 本体色で塗った版」の
   *   2 枚重ねにして、union の外周にだけ線が残るようにする
   *   （`ears.ts` の `organShapeOpen` と同じ「太い線 → 塗り」の手）。
   *   逆に 1 本 1 本を見せたい毛（ぼさぼさ・ひとすじ）では、交差した線が
   *   そのまま「別の毛」に読めるので false のままがよい。
   */
  merge: boolean;
  /** 付け根を体内へ埋める深さ。輪郭のインク幅より深くする。 */
  inset: number;
  /**
   * この毛が **体の輪郭そのもの** を担うか。
   *
   * 【なぜ切り替えが要るか — 実測して分かった】
   *   もこもこは房が体のまわりを覆うので、その上から体の輪郭を引き直すと
   *   **房の内側にもう 1 本、なめらかな輪郭が出る**。人はその内側の線を
   *   本体の形として読み、外の房を「縁に付けた飾り」として読む。
   *   実測（`B4KQ-YHUV` `HG8G-W7HU` `FDLZ-T9CU`）では、どれも
   *   「縁をピンキングばさみで切った紙」に見えていた。
   *   true のときは body.ts が体の輪郭を引かず、房の外周だけが輪郭になる。
   */
  owns: boolean;
}

/**
 * その毛が体の輪郭を担うか（＝body.ts は輪郭を引き直してはいけないか）。
 * 判断の根拠は毛の側にあるので、述語もここに置く。
 */
export function coatOwnsOutline(coat: string): boolean {
  return STYLES[coat]?.owns === true;
}

const STYLES: Readonly<Record<string, CoatStyle>> = {
  // うぶ毛: 細かく密。1 本 1 本は輪郭のインクに埋もれて、縁が毛羽立って見える。
  down: { gap: 5.4, len: 4, vary: 0.32, wid: 0.5, curl: 0.12, taper: 0.45, blunt: 0, merge: false, inset: 2.6, owns: false },
  // もこもこ: 丸い房が隣どうし重なって 1 つの塊になり、縁が雲のように波打つ。
  // 【重ねるのは付け根ではなく「先端」】
  //   付け根だけ重ねても、先はすぼまって離れる。先端の幅
  //   （wid × blunt × 2 = 7.2）を gap（5.6）より大きく取って初めて
  //   「とげの列」ではなく「ふわふわの塊」になる。
  fuzz: { gap: 5.6, len: 6.6, vary: 0.18, wid: 4.6, curl: 0.08, taper: 0.9, blunt: 0.78, merge: true, inset: 3.5, owns: true },
  // つんつん: まっすぐな三角のとげ。なびかない硬い毛。
  spiky: { gap: 8.5, len: 9, vary: 0.24, wid: 2.8, curl: 0.02, taper: 0.5, blunt: 0, merge: false, inset: 3.4, owns: false },
  // ぼさぼさ: 細く長く、重力に大きくなびく。伸びっぱなしの毛。
  shag: { gap: 6.4, len: 13, vary: 0.42, wid: 1.4, curl: 0.5, taper: 0.42, blunt: 0.14, merge: false, inset: 3.4, owns: false },
  // ── ！！このコードは消さないこと！！ ──────────────────
  //   ひとすじ（wisp）は 2026-08-22 に **カタログ（loci.ts）から外した**
  //   （製品オーナー判断「キモすぎる」）。新規個体には二度と出ない。
  //   しかし既存のセーブが遺伝子型に `wisp` を持っている可能性があるので、
  //   ここを消すと **その個体の毛だけが無くなる**。描画は残しておく。
  wisp: { gap: 17, len: 18, vary: 0.46, wid: 0.85, curl: 0.34, taper: 0.4, blunt: 0, merge: false, inset: 3, owns: false },
};

/** 毛 1 本ぶんの、先が細く（または丸く）なる閉じたパス。 */
function strandPath(
  bx: number,
  by: number,
  ux: number,
  uy: number,
  len: number,
  wid: number,
  curl: number,
  taper: number,
  blunt: number,
): string {
  // u が毛の向き、p はその直交方向。curl は p 方向への反り。
  const px = -uy;
  const py = ux;
  const tipX = bx + ux * len + px * curl * len;
  const tipY = by + uy * len + py * curl * len;
  const mx = bx + ux * len * 0.5 + px * curl * len * 0.22;
  const my = by + uy * len * 0.5 + py * curl * len * 0.22;
  const b = wid * blunt;
  // 先端。blunt が 0 なら 1 点、大きいと p 方向に開いた短い弧になる。
  const cap =
    b < 0.05
      ? ''
      : `Q${n(tipX + ux * b)} ${n(tipY + uy * b)} ${n(tipX - px * b)} ${n(tipY - py * b)}`;
  return (
    `M${n(bx + px * wid)} ${n(by + py * wid)}` +
    `Q${n(mx + px * wid * taper)} ${n(my + py * wid * taper)} ${n(tipX + px * b)} ${n(tipY + py * b)}` +
    cap +
    `Q${n(mx - px * wid * taper)} ${n(my - py * wid * taper)} ${n(bx - px * wid)} ${n(by - py * wid)}Z`
  );
}

/**
 * その向きへ伸ばせる最大の長さ。
 * viewBox からはみ出すと `inspectModel` の out-of-view になり、
 * 接地する素体では毛が地面と影を突き抜けて見える。
 */
function reachLimit(bx: number, by: number, dx: number, dy: number, botLimit: number): number {
  const PAD = 3;
  const along = (d: number, cur: number, lo: number, hi: number): number => {
    if (d > 1e-6) return (hi - cur) / d;
    if (d < -1e-6) return (lo - cur) / d;
    return Infinity;
  };
  return Math.min(
    along(dx, bx, VIEW.x + PAD, VIEW.x + VIEW.w - PAD),
    along(dy, by, VIEW.y + PAD, botLimit),
  );
}

export function buildCoat(ctx: DrawCtx): PartOut[] {
  const style = STYLES[ctx.parts.coat];
  if (!style) return [];

  // 実際に描かれる曲線を折れ線に展開する。制御点の多角形ではない
  // （geom.ts の `flat` と同じ理由 —— 曲線は弦よりずっと外側を通る）。
  const poly = flattenPath(ctx.shape.d, 6);
  if (poly.length < 8) return [];

  // 外向きの法線を決めるために巻き方向を測る（y 下向き座標系）。
  let area2 = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  // 時計回り（area2 > 0）なら接線 t に対する外向きは (t.y, -t.x)。
  const sign = area2 > 0 ? 1 : -1;

  // 周長と、各頂点までの累積距離。
  const cum: number[] = [0];
  for (let i = 1; i <= poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i % poly.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const perim = cum[poly.length]!;
  if (!(perim > 1)) return [];

  const rng = ctx.rng('coat');
  const lite = ctx.detail === 'lite';
  // 軽量表示では本数を半分に間引く（触角の羽毛と同じ方針）。
  const gap = style.gap * (lite ? 2 : 1);
  const MAX = lite ? 48 : 96;
  const count = clamp(Math.round(perim / gap), 6, MAX);

  // 体の大きさに毛の長さを合わせる。幼体は体が小さいので、
  // 同じ絶対長だと相対的に毛だらけに見える。
  const scale = clamp(ctx.pheno.size, 0.75, 1.3);
  const wid = style.wid * scale;
  /** bbox に足す線幅ぶんの余白。下端の判定にも同じ値を使う。 */
  const bboxPad = (style.owns ? ctx.strokeW : ctx.strokeThin) * 0.6;
  const botLimit = (ctx.shape.grounded ? GROUND_Y - 1 : VIEW.y + VIEW.h - 3) - bboxPad;

  /** 累積距離 s の位置の点と接線。 */
  const at = (s: number): { p: Vec; t: Vec } => {
    let i = 1;
    while (i < cum.length && cum[i]! < s) i++;
    const a = poly[(i - 1) % poly.length]!;
    const b = poly[i % poly.length]!;
    const seg = cum[i]! - cum[i - 1]!;
    const u = seg > 1e-6 ? (s - cum[i - 1]!) / seg : 0;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return {
      p: { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) },
      t: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
    };
  };

  let svg = '';
  const pts: Vec[] = [];
  const step = perim / count;

  for (let i = 0; i < count; i++) {
    // 等間隔ちょうどだと定規で引いたように並ぶ。半歩ぶんだけ揺らす。
    const s = ((i + 0.5 + rng.float(-0.34, 0.34)) * step + perim) % perim;
    const { p, t } = at(s);
    const ux = t.y * sign;
    const uy = -t.x * sign;

    // 付け根は体の内側へ。体内部分はマスクで切られ、輪郭の下に隠れる。
    const bx = p.x - ux * style.inset;
    const by = p.y - uy * style.inset;

    // 【付け根の「肩」も地面より上に収める】
    //   毛の長さは `reachLimit` で先端を見て抑えているが、付け根の左右へ
    //   wid ぶん広がる肩は長さと無関係に決まる。接地する素体の下端では
    //   ここが地面を 0.1〜1 ほど割り、`out-of-view` ではなく
    //   「毛が影を突き抜けている」形の不良になる。肩の縦方向のずれは
    //   最大でも wid（接線は単位ベクトル）なので、それで判定できる。
    if (by + wid > botLimit) continue;

    // 重力になびく向き。毛が真下を向いている所（法線が水平）では反らない。
    const px = -uy;
    const py = ux;
    // 1 本ずつ反りを変える。全部同じだと定規で引いたように整いすぎる。
    const curl = (py >= 0 ? style.curl : -style.curl) * rng.float(0.55, 1.35);

    // 先端の丸みと線幅は「長さ」の外側に張り出す。その分を先に差し引かないと
    // viewBox からはみ出す（`reachLimit` は先端 1 点しか見ていない）。
    const overhang = wid * style.blunt + bboxPad;

    let len = style.len * scale * (1 + rng.float(-style.vary, style.vary)) + style.inset;
    len = Math.min(len, reachLimit(bx, by, ux + px * curl, uy + py * curl, botLimit) - overhang);
    // 付け根の埋め込みぶんも出ていない毛は、描いてもマスクで消える。
    if (len <= style.inset + 0.6) continue;

    svg += strandPath(bx, by, ux, uy, len, wid, curl, style.taper, style.blunt);
    // 【bbox は「付け根の中心 ＋ 余白 wid」で作らない】
    //   付け根は体の内側にあるので、その周りへ wid ぶんの余白を足すと
    //   先端側にも同じ余白が付き、実際には何も描かれていない外側まで
    //   bbox が伸びて `out-of-view:coat` を鳴らす（実測 `FDLZ-T9CU`）。
    //   絵が本当にある 3 点 —— 付け根の両肩と先端 —— をそのまま積む。
    pts.push({ x: bx + px * wid, y: by + py * wid });
    pts.push({ x: bx - px * wid, y: by - py * wid });
    const reach = len + wid * style.blunt;
    pts.push({ x: bx + ux * reach + px * curl * len, y: by + uy * reach + py * curl * len });
  }

  if (!svg || pts.length === 0) return [];

  const ink = ctx.colors.inkPaint;
  const op = ctx.colors.bodyOpacity;
  // 輪郭を担う毛は、体の輪郭と同じ太さで描く。細いままだと
  // 「本体より頼りない線で囲まれた形」になり、輪郭として読めない。
  const strokeW = style.owns ? ctx.strokeW : ctx.strokeThin;
  const painted = style.merge
    ? // インクで塗った版を下敷きにし、その上を本体色で塗り直す。
      // 内側の線はすべて塗りに隠れ、union の外周だけがインクとして残る。
      path(svg, { fill: ink, stroke: ink, width: strokeW, linejoin: 'round' }) +
      path(svg, { fill: ctx.colors.body })
    : path(svg, {
        fill: ctx.colors.body,
        fillOpacity: op,
        stroke: ink,
        width: strokeW,
        linejoin: 'round',
      });

  return [
    {
      id: 'coat',
      z: Z.COAT,
      // 2 枚重ねの側は塗りが不透明でなければ下のインクが透けるので、
      // 透明感はパーツ全体の opacity で表す（線も塗りも等しく薄くなる）。
      svg: style.merge && op < 1 ? group(painted, undefined, `opacity="${n(op)}"`) : painted,
      bbox: boxOf(pts, bboxPad),
    },
  ];
}
