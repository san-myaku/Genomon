/**
 * 素体の本体描画（影・発光・塗り・腹・質感・輪郭の描き直し）。
 *
 * 【美術方針】
 *  - radial-gradient で軽い陰影。光は左上から。
 *  - 腹側に淡色の楕円を常に重ねる（`belly` 遺伝子はこれを強調する）。
 *  - 模様の上から輪郭をもう一度引く。太いインク輪郭が最優先。
 */

import { lighten, darken, hexToHsl, hslToHex, mix } from '../../core/color.ts';
import { clamp, lerp, type Rng } from '../../core/rng.ts';
import { Z, type DrawCtx, type PartOut } from '../ctx.ts';
import { GROUND_Y } from '../geom.ts';
import { TAU, circle, ellipse, n, path, pathClosed, pathOpen, polyPath, rad, url, type Vec } from '../svg.ts';
import { faceCoreOf } from './faceLayout.ts';

/** 本体シルエットの clipPath を登録して id を返す。 */
export function registerBodyClip(ctx: DrawCtx): string {
  return ctx.defs.add('bclip', (id) => `<clipPath id="${id}"><path d="${ctx.shape.d}"/></clipPath>`);
}

/**
 * 「体の外側だけを残す」マスクを登録して id を返す。
 *
 * 【なぜ clip ではなくマスクなのか、なぜ必要なのか】
 *   足・耳・尾・羽は付け根を体の内側から始め、体より奥（z < Z.BODY）に置いて
 *   「体の塗りが付け根を隠す」ことで生えている接続を作っている。
 *   ところが本体の塗りには透明度（bodyOpacity / translucency）があるため、
 *   体内部分が薄く透けて硬いエッジの台形として見えていた（ズボンを履いた絵）。
 *   透明度に依存しないよう、体内部分は「描かない」に変える。
 *   マスクの切り口は体の輪郭とぴったり重なり、その上から Z.OUTLINE で
 *   輪郭を引き直すので、切断面は太いインク線の下に隠れる。
 */
export function registerBodyMaskOut(ctx: DrawCtx): string {
  // 【うすぎぬ（veil）も例外なく完全に切る — 一度戻して再発させた】
  //   以前は veil だけ体内を約 27% のグレーで残していた（膜越しに付け根が
  //   透ける表現のつもり）。だが透けるのは塗りだけでなく **輪郭線も** で、
  //   足と尾の輪郭がそのまま体の中に現れる。人はその硬い直線を
  //   「体が割れている」「ズボンを履いている」と読む。
  //   実測 `V2XQ-HFWE`（veil × plain）では口の直下に灰色の台形が 2 つ
  //   （＝脚）、左に円（＝尾）がはっきり出ていた。
  //   ここは常に純黒で切り、透け表現は `registerBodyMaskIn` を使った
  //   **輪郭なし・ぼかし付きの別レイヤ**で作る（model.ts）。
  return ctx.defs.add(
    'bmaskout',
    (id) =>
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">` +
      `<rect x="0" y="0" width="200" height="200" fill="#fff"/>` +
      `<path d="${ctx.shape.d}" fill="#000000"/></mask>`,
  );
}

/** うすぎぬの透け表現の強さ 0..1（0 なら透けレイヤを作らない）。 */
export function veilShowThrough(ctx: DrawCtx): number {
  if (ctx.parts.texture !== 'veil') return 0;
  return clamp((1 - ctx.colors.bodyOpacity) * 0.42, 0, 0.26);
}

/**
 * 「体の内側だけを残す」マスクを登録して id を返す（うすぎぬの透け用）。
 *
 * `registerBodyMaskOut` の裏返し。こちらを通した背面パーツは
 * **体の中の部分しか出ない**。model.ts はこのレイヤから輪郭線を取り除き、
 * ぼかしを掛けてから重ねる。塗りだけ・ぼけ・低不透明度の 3 つが揃って初めて
 * 「膜の向こうに付け根の影がある」と読め、「割れている」とは読まれない。
 *
 * マスク自体も縁をぼかしてある。輪郭ぴったりで切ると、体の縁に沿って
 * 影の硬い縁が現れ、結局そこが「割れ目」に見えるため。
 */
export function registerBodyMaskIn(ctx: DrawCtx): string {
  // マスクは体の内側を素通しにするだけ（透けの強さは重ねる側の opacity で決める）。
  const blur = ctx.defs.add('bmaskinb', (id) =>
    `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feGaussianBlur stdDeviation="2.6"/></filter>`,
  );
  return ctx.defs.add(
    'bmaskin',
    (id) =>
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">` +
      `<path d="${ctx.shape.d}" fill="#ffffff" filter="${url(blur)}"/></mask>`,
  );
}

/**
 * 縁が地に溶ける楕円。
 *
 * 体の上に重ねる「明るい面（腹・核・重み）」は、硬い縁を持った瞬間に
 * **体の一部ではなく上に載せた別のもの** に見える（よだれかけ・貼り紙）。
 * 光の当たり方を表す面はすべてこれで描く。
 * `core` は不透明のまま残す内側の割合（0..1）。小さいほどふんわりする。
 *
 * ぼかしフィルタではなく放射グラデにしているのは、lite（サムネイル）でも
 * 同じ絵が出ること、100 体並べたときの負荷が軽いことの 2 点による。
 */
function softEllipse(
  ctx: DrawCtx,
  name: string,
  o: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    color: string;
    opacity: number;
    clip: string;
    core?: number;
  },
): string {
  const core = clamp(o.core ?? 0.5, 0, 0.9);
  const id = ctx.defs.add(name, (i) =>
    `<radialGradient id="${i}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="${o.color}" stop-opacity="1"/>` +
    `<stop offset="${n(core * 100)}%" stop-color="${o.color}" stop-opacity="0.92"/>` +
    `<stop offset="100%" stop-color="${o.color}" stop-opacity="0"/></radialGradient>`,
  );
  // 外周が透明になるぶん見た目が縮むので、半径を少し広げて面積を保つ。
  return ellipse(o.cx, o.cy, o.rx * 1.16, o.ry * 1.16, {
    fill: url(id),
    opacity: o.opacity,
    clip: o.clip,
  });
}

export function buildBody(ctx: DrawCtx): PartOut[] {
  const { shape, colors, pheno } = ctx;
  const out: PartOut[] = [];
  const clip = ctx.bodyClip;

  // ── 接地影 ──────────────────────────────────────────────
  // 幽霊型は「浮いている」ことを影の小ささ・薄さ・ぼけで伝える。
  //
  // 【暗背景で影が消える問題】
  //   影を「黒の低 alpha」で描くと、暗い背景では背景と同化して
  //   生きものが虚空に浮いてしまう。明暗どちらでも接地が読めるよう 2 枚出し、
  //   creature.ts が仕込む CSS でテーマに応じて片方だけ表示する。
  //
  // 【暗背景用を「明るい溜まり」から「暗い影＋細い接地帯」へ変えた理由】
  //   以前は `mix(body, #fff, 0.25)` の明るい溜まりを敷いていた。
  //   明背景では影が暗く、暗背景では明るいので **光源が上下で反転** し、
  //   白い溜まりは「こぼした牛乳」に見えていた。
  //   影は暗いまま（＝光源は常に上）にし、暗背景で消えないよう
  //   広いぼけではなく **細く濃い帯** で接地を担保する。
  const shW = shape.halfW * (shape.grounded ? 0.94 : 0.4);
  const shH = shape.grounded ? 7.5 : 3;
  // ぼかし半径。bbox の算出に使うので変数に出しておく
  // （定数を直書きすると bbox と実寸がずれ、自動検査が誤検出を出す）。
  const blurSd = shape.grounded ? 1.6 : 2.6;
  const softId =
    ctx.detail === 'full'
      ? ctx.defs.add('shsoft', (id) =>
          `<filter id="${id}" x="-60%" y="-160%" width="220%" height="420%">` +
          `<feGaussianBlur stdDeviation="${n(blurSd)}"/></filter>`,
        )
      : '';
  const softAttr = softId ? `filter="${url(softId)}"` : '';
  const darkShadow =
    ellipse(shape.cx, shape.shadowY, shW, shH, {
      fill: colors.inkPaint,
      opacity: shape.grounded ? 0.16 : 0.075,
      extra: softAttr,
    }) +
    (shape.grounded
      ? ''
      : ellipse(shape.cx, shape.shadowY, shW * 1.6, shH * 1.5, {
          fill: colors.inkPaint,
          opacity: 0.035,
          extra: softAttr,
        }));
  // 暗背景用: 影は暗いまま。広く薄い影は背景に溶けるので、
  // 接地は中央の細い帯（濃い・幅は影の 3 分の 2・高さは 4 分の 1）で読ませる。
  const deepShadow = darken(colors.ink, 0.62);
  const darkModeShadow =
    ellipse(shape.cx, shape.shadowY, shW * 1.02, shH * 1.1, {
      fill: deepShadow,
      opacity: shape.grounded ? 0.42 : 0.18,
      extra: softAttr,
    }) +
    ellipse(shape.cx, shape.shadowY, shW * 0.66, Math.max(1.6, shH * 0.28), {
      fill: deepShadow,
      opacity: shape.grounded ? 0.6 : 0.26,
      extra: softAttr,
    });
  out.push({
    id: 'shadow',
    z: Z.SHADOW,
    svg:
      `<g class="gm-sh-light">${darkShadow}</g>` +
      `<g class="gm-sh-dark">${darkModeShadow}</g>`,
    // bbox は実際に描かれる楕円の外接矩形＋ぼかしの裾（3σ）にする。
    // 以前は 2.4 倍・4.8 倍の丸めた値を入れていたため、実際には viewBox 内に
    // 収まっている影が「はみ出し」として 25 体中 13 体も誤検出されていた。
    // 検査が鳴りっぱなしになると本物の破綻が埋もれるので、実寸に合わせる。
    ...(() => {
      const margin = ctx.detail === 'full' ? blurSd * 3 : 0;
      const outerRx = (shape.grounded ? shW : shW * 1.6) + margin;
      const outerRy = (shape.grounded ? shH : shH * 1.5) + margin;
      return {
        bbox: {
          x: shape.cx - outerRx,
          y: shape.shadowY - outerRy,
          w: outerRx * 2,
          h: outerRy * 2,
        },
      };
    })(),
  });

  // ── 発光（周囲のにじみ）────────────────────────────────
  if (colors.glowAmt > 0.24) {
    const amt = clamp((colors.glowAmt - 0.24) / 0.76, 0, 1);
    if (ctx.detail === 'full') {
      const f = ctx.defs.add('glowf', (id) =>
        `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">` +
        `<feGaussianBlur stdDeviation="${n(3 + amt * 5)}"/></filter>`,
      );
      out.push({
        id: 'glow',
        z: Z.GLOW,
        svg: path(shape.d, { fill: colors.glow, opacity: 0.16 + amt * 0.34, extra: `filter="${url(f)}"` }),
        bbox: shape.box,
      });
    } else {
      out.push({
        id: 'glow',
        z: Z.GLOW,
        svg: path(shape.d, {
          stroke: colors.glow,
          width: 5 + amt * 5,
          opacity: 0.24 + amt * 0.24,
        }),
        bbox: shape.box,
      });
    }
  }

  // ── 本体の塗り ────────────────────────────────────────
  const grad = bodyGradient(ctx);

  out.push({
    id: 'body',
    z: Z.BODY,
    svg: path(shape.d, {
      fill: grad,
      fillOpacity: colors.bodyOpacity,
      stroke: colors.inkPaint,
      width: ctx.strokeW,
      linejoin: 'round',
    }),
    anchor: { id: 'body', x: shape.cx, y: (shape.topY + shape.botY) / 2, angle: 0, scale: 1 },
    bbox: shape.box,
  });

  // ── 2 色化（bicolor）────────────────────────────────
  const bic = buildBicolor(ctx);
  if (bic) out.push(bic);

  // ── 腹の淡色 ──────────────────────────────────────────
  const H = shape.botY - shape.topY;
  const bellyY = shape.topY + H * (shape.base === 'yurei' ? 0.68 : 0.66);
  const bellyRx = shape.halfAt(bellyY) * 0.78;
  const bellyRy = H * 0.3;
  const strongBelly = ctx.parts.pattern.startsWith('belly');
  out.push({
    id: 'belly',
    z: Z.BELLY,
    // 【縁をぼかす理由 — 実物で確認】
    //   硬い縁の楕円をそのまま体に貼ると、腹の淡色が「体の一部」ではなく
    //   **上に載せた別の布** に見える。`5T7F-2Z62` `HLLG-LHHJ` はどちらも
    //   よだれかけを着けているように読めた。腹の明るさは光の当たり方なので、
    //   境界は必ず溶けていなければならない。
    svg: softEllipse(ctx, 'bellyg', {
      cx: shape.cx,
      cy: bellyY,
      rx: bellyRx,
      ry: bellyRy,
      // `belly` 遺伝子が出ていないときは「腹側がほんのり明るい」程度に留める。
      // 濃く敷くと本体色が白へ引っ張られ、配色が読めなくなる。
      color: colors.belly,
      opacity: (strongBelly ? 0.9 : 0.24) * colors.sheer,
      clip,
      core: strongBelly ? 0.6 : 0.42,
    }),
    bbox: { x: shape.cx - bellyRx, y: bellyY - bellyRy, w: bellyRx * 2, h: bellyRy * 2 },
  });

  // ── 素体そのものの性格づけ ────────────────────────────
  // 質感遺伝子とは別に、素体ごとの「素の見え方」を必ず持たせる。
  // これが無いと 3 系統が「輪郭違いの同じ塗り」になってしまう。
  const baseAccent = buildBaseAccent(ctx);
  if (baseAccent) out.push(baseAccent);

  // ── 質感 ──────────────────────────────────────────────
  const tex = buildTexture(ctx);
  if (tex) out.push(tex);

  // ── 輪郭の描き直し（模様・質感の上から）────────────────
  out.push({
    id: 'outline',
    z: Z.OUTLINE,
    svg: path(shape.d, { stroke: colors.inkPaint, width: ctx.strokeW, linejoin: 'round' }),
    bbox: shape.box,
  });

  // ── 幽霊型は裾を薄く抜いて浮遊感を出す ──────────────────
  if (shape.base === 'yurei') {
    // 【ヤドクガエル系・星屑で弱める理由】
    //   ここは紙の色（クリーム #f8efdf）を裾に重ねる処理なので、
    //   暖色の地の下半分がそのままパンの皮のような色に抜ける。
    //   「明るい鮮やかな地 × 黒い網目」が命の模様では、
    //   この抜けが下半分だけ別の生きものにしてしまう。
    //   浮遊感は輪郭と影で足りているので、量を半分以下にする。
    const hemK = /^(dart|stardust)/.test(ctx.parts.pattern) ? 0.42 : 1;
    const fadeId = ctx.defs.add('hemfade', (id) =>
      `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="${colors.paper}" stop-opacity="0"/>` +
      `<stop offset="100%" stop-color="${colors.paper}" stop-opacity="${n((0.34 + pheno.translucency * 0.3) * hemK)}"/>` +
      `</linearGradient>`,
    );
    const y0 = shape.topY + H * 0.7;
    out.push({
      id: 'hemFade',
      z: Z.TEXTURE + 1,
      svg: `<rect x="${n(shape.cx - shape.halfW - 4)}" y="${n(y0)}" width="${n(shape.halfW * 2 + 8)}" height="${n(shape.botY - y0 + 4)}" fill="${url(fadeId)}" clip-path="${url(clip)}"/>`,
      bbox: { x: shape.cx - shape.halfW, y: y0, w: shape.halfW * 2, h: shape.botY - y0 },
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────
//  本体の塗り（グラデーション）
// ─────────────────────────────────────────────────────────

/**
 * 本体の塗りに使うグラデーションの url。
 *
 * 【彩度が飛ばないためのグラデ設計】
 *   以前は 0% を lighten(bodyLight, 0.16)（＝body を 38% も白へ寄せた色）に
 *   していたため、配色ファミリーの個性（さんご／おきび／たそがれ等）が
 *   すべて淡いパステルに潰れていた。
 *   ハイライトは 0.16 程度に抑え、体の大半を本体色そのままで見せる。
 *
 * 【無彩色（すみ）だけ階調を増やす理由】
 *   灰色は色相と彩度で情報を出せないぶん、明度の階調だけが頼りになる。
 *   4 段のグラデでは平坦に見え、「塗り忘れ」の印象になる。
 *   そこで 6 段に増やし、さらに **光を暖かく・陰を冷たく** 振る
 *   （絵画の常道）。灰の中に温度差が生まれ、単なるグレーではなく
 *   「灰色に塗られたもの」として読めるようになる。
 */
function bodyGradient(ctx: DrawCtx): string {
  const c = ctx.colors;
  const b = hexToHsl(c.body);

  if (c.family === 'ash') {
    // 温かい灰（黄み）と冷たい灰（青み）。彩度は 12 を超えさせない。
    const warm = (l: number, s: number): string => hslToHex(34, clamp(s, 0, 12), clamp(l, 4, 96));
    const cool = (l: number, s: number): string => hslToHex(228, clamp(s, 0, 13), clamp(l, 4, 96));
    const own = (l: number, s: number): string => hslToHex(c.bodyHue, clamp(s, 0, 12), clamp(l, 4, 96));
    const id = ctx.defs.add('bodyg', (gid) =>
      `<radialGradient id="${gid}" cx="36%" cy="21%" r="92%">` +
      `<stop offset="0%" stop-color="${warm(b.l + 15, b.s + 7)}"/>` +
      `<stop offset="16%" stop-color="${warm(b.l + 8, b.s + 4)}"/>` +
      `<stop offset="34%" stop-color="${own(b.l + 2, b.s + 1)}"/>` +
      `<stop offset="56%" stop-color="${own(b.l - 3, b.s + 2)}"/>` +
      `<stop offset="78%" stop-color="${cool(b.l - 12, b.s + 5)}"/>` +
      `<stop offset="100%" stop-color="${cool(b.l - 22, b.s + 8)}"/>` +
      `</radialGradient>`,
    );
    return url(id);
  }

  const id = ctx.defs.add('bodyg', (gid) =>
    `<radialGradient id="${gid}" cx="38%" cy="24%" r="88%">` +
    `<stop offset="0%" stop-color="${lighten(c.body, 0.16)}"/>` +
    `<stop offset="30%" stop-color="${c.body}"/>` +
    `<stop offset="72%" stop-color="${c.body}"/>` +
    `<stop offset="100%" stop-color="${mix(c.bodyDark, darken(c.body, 0.28), 0.5)}"/>` +
    `</radialGradient>`,
  );
  return url(id);
}

// ─────────────────────────────────────────────────────────
//  2 色化（bicolor）
// ─────────────────────────────────────────────────────────

/**
 * 第 2 の色。本体色相から調和する角度（±25〜60 度）へずらし、
 * 彩度・明度も併せて動かす。
 *
 * 【補色の衝突を作らないための制約】
 *   色相差を 60 度までに抑えると、隣接〜類似配色の範囲に必ず収まる。
 *   加えて明度を必ず一方向（明るい側 or 暗い側）へずらすので、
 *   2 色は「同じ光の下にある同じ材質」に見える。
 *
 * 【無彩色（すみ）との組み合わせ】
 *   灰の体では第 2 色に彩度を与える。「灰から色へ」の移行になり、
 *   これは 2 色化のなかで最も美しい組み合わせになる。
 */
function secondColor(ctx: DrawCtx, rng: Rng, minL: number): string {
  const c = ctx.colors;
  const b = hexToHsl(c.body);
  const dir = rng.bool() ? 1 : -1;
  const h = c.bodyHue + dir * rng.float(25, 60);
  /**
   * 明度差の下限を必ず確保する。
   * clamp の端（22 / 88）に当たって差が縮んだときは、反対方向へ振り直す。
   * 「片方向へ」の原則より「2 色に読めること」を優先する。
   */
  const solveL = (base: number, lo: number, hi: number): number => {
    const d = base > 62 ? -1 : 1;
    const want = clamp(base + d * rng.float(minL, minL + 16), lo, hi);
    if (Math.abs(want - base) >= minL) return want;
    const back = clamp(base - d * (minL + 4), lo, hi);
    return Math.abs(back - base) > Math.abs(want - base) ? back : want;
  };
  if (c.family === 'ash') {
    // 灰 → 色。彩度は控えめ（26〜44）に留めて品を保つ。
    // 無彩色は彩度そのものが差になるので、明度差の下限は緩めでよい。
    return hslToHex(h, rng.float(26, 44), clamp(b.l + rng.float(-16, 12), 30, 74));
  }
  const satDir = rng.float(-0.18, 0.34);
  const s = clamp(b.s * (1 + satDir) + rng.float(0, 12), 22, 80);
  return hslToHex(h, s, solveL(b.l, 20, 88));
}

/**
 * 2 色グラデーション。
 *
 * 【硬い境界を作らないための実装】
 *   別色の図形を重ねて境界線を引くのではなく、`linearGradient` の
 *   **不透明度そのもの** を 0 → 1 へなめらかに動かした 1 枚の矩形を
 *   体のクリップ内に敷く。境界は必ずぼけ、下の陰影がそのまま透ける。
 */
function buildBicolor(ctx: DrawCtx): PartOut | null {
  const kind = ctx.parts.bicolor;
  if (!kind || kind === 'none') return null;
  const s = ctx.shape;
  const rng = ctx.rng('bicolor');
  // 【ななめぼかしだけ明度差の下限を上げる理由】
  //   ふたいろ・すそぞめは「上と下」「体と裾」という **位置** が境界を教えるので、
  //   多少弱くても 2 色だと読める。ななめぼかしは境界が斜めで、しかも
  //   体の丸みの陰影と同じ方向に走るため、差が小さいと
  //   「ただの陰」に吸収されて効果そのものが見えない（9 体中 3〜4 体で消えていた）。
  const col = secondColor(ctx, rng, kind === 'diagonal' ? 26 : 14);
  const H = s.botY - s.topY;

  // 勾配ベクトルと不透明度の段。種類ごとに「どこからどこへ変わるか」が違う。
  let x1 = 0;
  let y1 = 0;
  let x2 = 0;
  let y2 = 1;
  let stops: { at: number; op: number }[];

  switch (kind) {
    case 'diagonal': {
      // ななめぼかし: 30〜45 度。左右どちらから差すかは個体差。
      const deg = rng.float(30, 45);
      const a = (deg * Math.PI) / 180;
      const dir = rng.bool() ? 1 : -1;
      x1 = dir > 0 ? 0 : 1;
      x2 = dir > 0 ? Math.cos(a) : 1 - Math.cos(a);
      y1 = 0;
      y2 = Math.sin(a);
      // 手前の角は完全に第 2 色、向こうの角は完全に地色。
      // 途中を全部「混ざった色」にすると 2 色に読めない。
      //
      // 【移行帯を狭めた理由】
      //   以前は 0.28→0.82 の 54% を移行に使っていたので、体のほとんどが
      //   「混ざった色」になり、境界の位置そのものが読めなかった。
      //   両端の「完全に片方の色」の面積を増やし、移行帯を中央 3 割に寄せる。
      stops = [
        { at: 0, op: 1 },
        { at: 0.36, op: 0.98 },
        { at: 0.52, op: 0.7 },
        { at: 0.68, op: 0.18 },
        { at: 0.84, op: 0 },
        { at: 1, op: 0 },
      ];
      break;
    }
    case 'tipped': {
      // すそぞめ: 下端だけを別色に染める。境界はぼかすが幅は狭い。
      // 体の一番下は輪郭の陰で潰れるので、0.93 で染め切って裾まで色を届かせる。
      y1 = 0;
      y2 = 1;
      const start = rng.float(0.5, 0.66);
      stops = [
        { at: 0, op: 0 },
        { at: start, op: 0 },
        { at: lerp(start, 1, 0.5), op: 0.6 },
        { at: 0.93, op: 1 },
        { at: 1, op: 1 },
      ];
      break;
    }
    case 'duotone':
    default: {
      // ふたいろ: 上下でなめらかに 2 色。空や夕暮れのような移り変わり。
      const down = rng.bool(0.62);
      y1 = down ? 0 : 1;
      y2 = down ? 1 : 0;
      stops = [
        { at: 0, op: 0 },
        { at: 0.24, op: 0.12 },
        { at: 0.54, op: 0.56 },
        { at: 0.8, op: 0.9 },
        { at: 1, op: 1 },
      ];
      break;
    }
  }

  // うすぎぬ等で体が薄いときは 2 色目も同じだけ薄くする。
  const k = ctx.colors.bodyOpacity;
  const gid = ctx.defs.add('bicol', (id) =>
    `<linearGradient id="${id}" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">` +
    stops
      .map((st) => `<stop offset="${n(st.at * 100)}%" stop-color="${col}" stop-opacity="${n(st.op * k)}"/>`)
      .join('') +
    `</linearGradient>`,
  );

  const x = s.cx - s.halfW - 6;
  const y = s.topY - 6;
  const w = s.halfW * 2 + 12;
  const h = H + 12;
  return {
    id: 'bicolor',
    // 腹の淡色より手前。ここより奥に置くと、腹の楕円と裾の陰に負けて
    // 「同じ色をぼかしただけ」に見える（実際にそうなっていた）。
    z: Z.BELLY + 1,
    svg: `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${url(gid)}" clip-path="${url(ctx.bodyClip)}"/>`,
    bbox: { x: s.cx - s.halfW, y: s.topY, w: s.halfW * 2, h: H },
  };
}

/**
 * 光の当たり方（ハイライト）を素体形状に沿わせて置く。
 *
 * 【なぜ関数にしたか】
 *   以前はどの個体も「cx - halfW*0.24, topY + H*0.2」の固定位置に
 *   同じ楕円を置いていたため、100 体並べるとハイライトだけが全個体で
 *   完全に一致し、丸い個体では「はげ」に見えていた。
 *   位置・大きさ・傾きを個体ごとに散らし、さらにその高さでの体の半幅
 *   （halfAt）に比例させて、形に沿った光にする。
 *
 * 【楕円をやめて閉曲線にした理由（批評 P2-15「同一位置・同一形」）】
 *   位置と大きさを散らしても、**形が常に楕円** である限り、
 *   横広の体にも縦長の体にも同じ形の光が乗って「貼り付けたシール」に見える。
 *   輪郭の各方向について、その高さでの体の半幅（halfAt）で半径を伸縮させると、
 *   くびれた体では光もくびれ、尖った体では光も細くなる。
 *   素体が違えば光の形も違う、という当たり前の関係がここで初めて成立する。
 */
function highlightSpot(
  ctx: DrawCtx,
  rng: Rng,
  opts: { t?: number; k?: number; opacity?: number; color?: string; blur?: number },
): string {
  const s = ctx.shape;
  const H = s.botY - s.topY;
  // 上寄りのどこに光が当たるかは個体ごとに違う
  const t = clamp((opts.t ?? 0.2) + rng.float(-0.06, 0.07), 0.08, 0.5);
  const y = s.topY + H * t;
  const hw = Math.max(6, s.halfAt(y));
  const k = opts.k ?? 1;
  const side = rng.float(-0.44, -0.1);
  const x = s.cx + hw * side;
  const rx = hw * rng.float(0.26, 0.44) * k;
  const ry = rx * rng.float(0.4, 0.72);
  const rot = rad(rng.float(-38, 16));
  const steps = 7;
  const pts: Vec[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    // 傾けた楕円座標系での点
    const ox = Math.cos(a) * rx;
    const oy = Math.sin(a) * ry;
    const yy = y + ox * Math.sin(rot) + oy * Math.cos(rot);
    // その高さでの体の太さで横方向を伸縮させる（形が素体に追従する）
    const kk = clamp(Math.max(4, s.halfAt(yy)) / hw, 0.5, 1.6);
    pts.push({ x: x + (ox * Math.cos(rot) - oy * Math.sin(rot)) * kk, y: yy });
  }
  const body = path(pathClosed(pts), {
    fill: opts.color ?? '#ffffff',
    opacity: opts.opacity ?? 0.2,
  });
  const inner = opts.blur
    ? `<g filter="${url(softBlur(ctx, 'hlb', opts.blur))}">${body}</g>`
    : body;
  return `<g clip-path="${url(ctx.bodyClip)}">${inner}</g>`;
}

/** 使い回すガウスぼかしフィルタ（半径ごとに 1 つ）。 */
function softBlur(ctx: DrawCtx, name: string, sd: number): string {
  return ctx.defs.add(`${name}${Math.round(sd * 10)}`, (id) =>
    `<filter id="${id}" x="-45%" y="-45%" width="190%" height="190%">` +
    `<feGaussianBlur stdDeviation="${n(sd)}"/></filter>`,
  );
}

/**
 * 輪郭に沿って走る光の帯（シーン）。
 *
 * 【楕円のハイライトと別に用意する理由】
 *   ガラス・真珠・すりガラスの「面で光る」感じは、点の光沢では出ない。
 *   輪郭から一定量内側に入った線を上から下へ辿る三日月にすると、
 *   帯そのものが素体のシルエットの写しになるので、
 *   丸い体・尖った体・波打つ体で光の形が必ず変わる。
 *
 * @param inset 輪郭からどれだけ内側に入るか（その高さの半幅に対する比）
 * @param width 帯の太さ（同上）
 * @param side  -1 左 / +1 右
 */
function sheenBand(
  ctx: DrawCtx,
  opts: { t0: number; t1: number; inset: number; width: number; side?: number },
): string {
  const s = ctx.shape;
  const H = s.botY - s.topY;
  const side = opts.side ?? -1;
  const steps = 8;
  const outer: Vec[] = [];
  const inner: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const y = s.topY + H * lerp(opts.t0, opts.t1, u);
    const hw = Math.max(4, s.halfAt(y));
    const ex = s.edgeX(y, side);
    // 両端を絞る。切り落としたままだと帯が「棒」に見える。
    const taper = Math.sin(Math.PI * u) ** 0.6;
    outer.push({ x: ex - side * hw * opts.inset, y });
    inner.push({ x: ex - side * hw * (opts.inset + opts.width * taper), y });
  }
  inner.reverse();
  return pathClosed([...outer, ...inner], 0.85);
}

/**
 * 装飾の付け根に落とす短い影（絶対座標）。
 *
 * 【楕円をやめた理由】
 *   以前は「本体色で塗り・インクで縁取った楕円」を付け根に置いていたが
 *   （ears.ts の rootGlow / flora.ts の rootMound）、全個体で同じ形・
 *   同じ明度になり、頭頂の芽や角の根元が「ネジ穴」「はげ」に見えていた
 *   （ビジュアル批評 P0-2）。縁取りのある閉じた図形をやめ、
 *   本体色を暗くした短い影だけにする。
 *
 * 【絶対座標にした理由】
 *   影は「体の表面に落ちる」ものなので体のクリップに乗せる必要がある。
 *   器官のローカル座標系（translate + rotate 済み）で clip-path を指定すると
 *   クリップのパスまで一緒に回ってしまうので、器官の transform の外側、
 *   つまり素体と同じ座標系で描く。
 *
 * @param x,y   付け根の絶対座標
 * @param w     器官の付け根の幅
 * @param lean  影を寄せる向き（-1..1）。器官の傾きと同じ側へ。
 */
export function rootShade(ctx: DrawCtx, x: number, y: number, w: number, lean = 0, strength = 1): string {
  const c = ctx.colors;
  const dark = mix(c.body, c.bodyDark, 0.72);
  const clip = ctx.bodyClip;
  return (
    ellipse(x + w * 0.16 * lean, y + w * 0.2, w * 0.74, w * 0.3, {
      fill: dark,
      opacity: 0.26 * strength,
      clip,
    }) +
    ellipse(x + w * 0.24 * lean, y + w * 0.12, w * 0.44, w * 0.17, {
      fill: dark,
      opacity: 0.22 * strength,
      clip,
    })
  );
}

/**
 * 素体固有の内部表現。
 *   まる型   … 下半分にやわらかい重みの陰。もこもこした体毛感の縁取り。
 *   幽霊型   … 内側から発する淡い光と、裾に向かう縦の流れ。
 *   スライム型 … 体内に沈む核と、底に溜まった濃い層、上面の水滴ハイライト。
 */
function buildBaseAccent(ctx: DrawCtx): PartOut | null {
  const { shape, colors } = ctx;
  const clip = ctx.bodyClip;
  const H = shape.botY - shape.topY;
  const cx = shape.cx;
  const rng = ctx.rng('accent');
  let s = '';

  if (shape.base === 'slime') {
    // 体内の核（半透明に沈んで見える）
    // 縁は必ず溶かす。硬い縁だと体内に沈んだ核ではなく、
    // 表面に貼った明るい楕円＝よだれかけに見える（`5T7F-2Z62`）。
    const coreY = shape.topY + H * 0.72;
    s += softEllipse(ctx, 'slcore', {
      cx,
      cy: coreY,
      rx: shape.halfW * 0.46,
      ry: H * 0.2,
      color: mix(colors.body, colors.bodyDark, 0.55),
      opacity: 0.3,
      clip,
      core: 0.4,
    });
    s += softEllipse(ctx, 'slcoreh', {
      cx,
      cy: coreY - H * 0.03,
      rx: shape.halfW * 0.26,
      ry: H * 0.1,
      color: lighten(colors.belly, 0.2),
      opacity: 0.42,
      clip,
      core: 0.3,
    });
    // 底に溜まる層
    s += softEllipse(ctx, 'slbot', {
      cx,
      cy: shape.botY + H * 0.05,
      rx: shape.halfW * 1.05,
      ry: H * 0.2,
      color: mix(colors.body, colors.bodyDark, 0.75),
      opacity: 0.24,
      clip,
      core: 0.45,
    });
    // 上面の水滴ハイライト（スライムらしさの要）
    //
    // 【質感で強さを変える理由 — 批評「全個体が同一の艶ゼリーに見える」】
    //   ここは素体の性格づけなので **質感に関係なく** 強い点光沢を 2 つ
    //   置いていた。スライムは人口の約 1/3 なので、マットでも苔でも鉱物でも
    //   同じ艶が乗り、質感の遺伝子が何であろうと「艶のあるゼリー」に見えていた。
    //   艶を持つ質感（ゼリー・しんじゅ・すきとおり）でだけ水滴を強く出し、
    //   艶の無い質感では広く弱い光に替える。スライムらしい「まとまった塊」感は
    //   体内の核と底の層が担っているので、艶を落としても素体は読める。
    const glossy = /^(jelly|pearl|glassy)$/.test(ctx.parts.texture);
    const matteLike = /^(matte|mossy|mineral|veil)$/.test(ctx.parts.texture);
    const gloss = glossy ? 1 : matteLike ? 0.22 : 0.55;
    s += highlightSpot(ctx, rng, { t: 0.17, k: matteLike ? 1.5 : 0.9, opacity: 0.6 * gloss });
    if (!matteLike) s += highlightSpot(ctx, rng, { t: 0.1, k: 0.34, opacity: 0.42 * gloss });
  } else if (shape.base === 'yurei') {
    // 内側からの淡い光
    //
    // 【弱めた理由】
    //   以前は「白に 50% 寄せた色を 0.6」で敷いていたため、体の上半分の
    //   色みがほぼ消えていた。とくに 2 色化（bicolor）は素体アクセントより
    //   奥に描かれるので、幽霊型だけ第 2 色が読めなくなっていた。
    //   幽霊らしさは「中心が明るい」ことで足りる。白の量を落とす。
    //
    // 【ヤドクガエル系・星屑でさらに落とす理由 — 実測】
    //   この淡い光は体の中央上半分を白へ寄せる。「明るい鮮やかな地 × 黒い網」
    //   が命の模様では、その中央がちょうど網のいちばん見せたい面なので、
    //   地色が計算値より **L +12** も持ち上がって黄土色へ抜けていた
    //   （おきび MJEC-HP6H: 計算 L51 → 実測 L63）。裾の抜き（hemFade）と
    //   同じ理由・同じ考え方で量を落とす。浮遊感は輪郭と影で足りている。
    const glowK = /^(dart|stardust)/.test(ctx.parts.pattern) ? 0.4 : 1;
    const g = ctx.defs.add('yglow', (id) =>
      `<radialGradient id="${id}" cx="50%" cy="34%" r="70%">` +
      `<stop offset="0%" stop-color="${lighten(colors.bodyLight, 0.3)}" stop-opacity="${n(0.4 * glowK)}"/>` +
      `<stop offset="100%" stop-color="${colors.body}" stop-opacity="0"/></radialGradient>`,
    );
    s += `<rect x="${n(cx - shape.halfW)}" y="${n(shape.topY)}" width="${n(shape.halfW * 2)}" height="${n(H)}" fill="${url(g)}" clip-path="${url(clip)}"/>`;
    // 裾へ向かう縦の流れ
    //
    // 【顔より下から始める理由 — 実物で確認】
    //   開始が一律 `topY + H×0.5` だったため、顔の低い個体では
    //   ちょうど目の高さから始まり、口の脇を通って裾へ抜ける
    //   淡い縦線が 2 本できる。`WNLS-3WMT` はそれが **涙の跡** に見えていた。
    //   幽霊の「裾へ流れる」感じは顔より下だけで十分に出る。
    const flowCore = faceCoreOf(ctx.face);
    const flowTop = Math.max(shape.topY + H * 0.5, flowCore.cy + flowCore.ry + 3);
    if (flowTop < shape.botY - H * 0.12) {
      for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        const x = cx + i * shape.halfW * 0.32;
        s += path(
          `M${n(x)} ${n(flowTop)}Q${n(x + i * 3)} ${n(lerp(flowTop, shape.botY, 0.55))} ${n(x)} ${n(shape.botY)}`,
          { stroke: lighten(colors.body, 0.42), width: 2.2, opacity: 0.28, clip },
        );
      }
    }
  } else {
    // まる型: 下半分の重みと、輪郭沿いのやわらかい陰
    // ここも縁を溶かす（硬い縁だと腹の淡色と二重の「よだれかけ」になる）。
    s += softEllipse(ctx, 'maruw', {
      cx,
      cy: shape.botY - H * 0.06,
      rx: shape.halfW * 0.9,
      ry: H * 0.22,
      color: mix(colors.body, colors.bodyDark, 0.7),
      opacity: 0.18,
      clip,
      core: 0.4,
    });
    s += path(shape.d, { stroke: mix(colors.body, colors.bodyDark, 0.6), width: 5, opacity: 0.2, clip });
  }

  // ── 無彩色（すみ）の輪郭側の締め ──────────────────────
  // 明度上限（78）に近い灰は紙（#f8efdf, L≈93）との差が小さく、
  // 輪郭インクだけで持たせると「線画に色が塗られていない」ように見える。
  // 内側に冷たい灰の縁を一本入れて、面としての厚みを作る。
  if (colors.family === 'ash') {
    const bl = hexToHsl(colors.body).l;
    const strength = clamp((bl - 52) / 26, 0, 1);
    s += path(shape.d, {
      stroke: hslToHex(228, 10, clamp(bl - 20, 12, 58)),
      width: 6.5,
      opacity: 0.16 + strength * 0.2,
      clip,
    });
    s += path(shape.d, {
      stroke: hslToHex(228, 12, clamp(bl - 30, 8, 46)),
      width: 2.6,
      opacity: 0.12 + strength * 0.16,
      clip,
    });
  }

  if (!s) return null;
  const sheer = colors.sheer;
  return {
    id: 'baseAccent',
    z: Z.BELLY + 1,
    svg: sheer < 1 ? `<g opacity="${n(sheer)}">${s}</g>` : s,
    bbox: shape.box,
  };
}

// ─────────────────────────────────────────────────────────
//  質感
// ─────────────────────────────────────────────────────────

function buildTexture(ctx: DrawCtx): PartOut | null {
  const { shape, colors } = ctx;
  const clip = ctx.bodyClip;
  const H = shape.botY - shape.topY;
  const cx = shape.cx;
  const rng = ctx.rng('texture');
  // 【模様のコントラストを質感で潰さない】
  //   しんじゅ／すりガラス／すきとおりは白い膜を体全体に重ねる。
  //   ヤドクガエル系と星屑は「暗い地 × 鮮やかな模様」が命なので、
  //   その膜をそのまま乗せると地と模様の差が半分近く消える（実際に消えていた）。
  //   質感の個性は残したいので、白の量だけ落とす。
  //
  //   模様そのものは pattern.ts 側でこの膜より手前へ出してあるので、
  //   ここで守るのは **地の彩度** のほう。膜が濃いと『あみめ』の
  //   マリーゴールドの地がクリーム色へ抜け、黒い網と合わせて
  //   「メロンパン」になる（実測: しんじゅで地 L72→ 白飛び側へ）。
  const dartLike = /^(dart|stardust)/.test(ctx.parts.pattern);
  const veilDown = dartLike ? 0.34 : 1;
  const full = ctx.detail === 'full';
  let s = '';

  switch (ctx.parts.texture) {
    case 'jelly': {
      // ── ゼリー: 厚みのある半透明。光は表面ではなく内部で散る ──
      //
      // 【マットとの違いをどこで作るか】
      //   以前は「少し強い楕円の光沢＋底の濃い層」だけで、マットと同じ
      //   点光沢だったため 2 つが見分けられなかった（実際に並べて確認）。
      //   ゼリーの手がかりは光沢の強さではなく **光が中に入ること**:
      //     ・大きな明部を強くぼかして体の内部へ沈める（境界を持たせない）
      //     ・底に光が溜まる（透過光）。これが厚みの証拠になる
      //     ・底の濃い沈殿層
      //     ・表面の鋭い小さな光沢は 1 つだけ（＝表面はまだ艶やか）
      if (full) {
        s += highlightSpot(ctx, rng, { t: 0.3, k: 1.3, opacity: 0.42, blur: 4.6 });
      } else {
        s += highlightSpot(ctx, rng, { t: 0.3, k: 1.3, opacity: 0.3 });
      }
      // 透過光の溜まり（下ほど明るい）。厚い半透明体の底で光が集まる。
      const jg = ctx.defs.add('jelthru', (id) =>
        `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0%" stop-color="${lighten(colors.belly, 0.3)}" stop-opacity="0"/>` +
        `<stop offset="62%" stop-color="${lighten(colors.belly, 0.3)}" stop-opacity="0.12"/>` +
        `<stop offset="88%" stop-color="${lighten(colors.belly, 0.34)}" stop-opacity="0.42"/>` +
        `<stop offset="100%" stop-color="${lighten(colors.belly, 0.34)}" stop-opacity="0.2"/>` +
        `</linearGradient>`,
      );
      s += `<rect x="${n(cx - shape.halfW - 4)}" y="${n(shape.topY)}" width="${n(shape.halfW * 2 + 8)}" height="${n(H)}" fill="${url(jg)}" clip-path="${url(clip)}"/>`;
      // 底の沈殿
      s += ellipse(cx, shape.botY - H * 0.06, shape.halfW * 0.78, H * 0.13, {
        fill: darken(colors.body, 0.24),
        opacity: 0.3,
        clip,
      });
      // 表面の鋭い光沢（小さく 1 つだけ）
      s += highlightSpot(ctx, rng, { t: 0.16, k: 0.3, opacity: 0.62 });
      break;
    }
    case 'pearl': {
      // ── しんじゅ: 見る角度で色が変わる干渉色 ──
      //
      // 【斜めのグラデだけでは足りなかった】
      //   1 枚の斜めグラデは「色つきセロファンを貼った」ようにしか見えず、
      //   真珠の干渉色にならない。干渉色は **曲面に沿って帯として現れ**、
      //   帯ごとに色が違う。輪郭に沿う帯（sheenBand）を色違いで 2 本重ね、
      //   下地の斜めグラデは弱めて「全体の色みの傾き」だけを担わせる。
      const g = ctx.defs.add('pearlg', (id) =>
        `<linearGradient id="${id}" x1="0.1" y1="0" x2="0.9" y2="1">` +
        `<stop offset="0%" stop-color="#fff3c9" stop-opacity="${n(0.4 * veilDown)}"/>` +
        `<stop offset="34%" stop-color="#ffd8ef" stop-opacity="${n(0.34 * veilDown)}"/>` +
        `<stop offset="64%" stop-color="#cfe9ff" stop-opacity="${n(0.36 * veilDown)}"/>` +
        `<stop offset="100%" stop-color="#e2ffdf" stop-opacity="${n(0.42 * veilDown)}"/>` +
        `</linearGradient>`,
      );
      s += `<rect x="${n(cx - shape.halfW - 4)}" y="${n(shape.topY - 4)}" width="${n(shape.halfW * 2 + 8)}" height="${n(H + 8)}" fill="${url(g)}" clip-path="${url(clip)}"/>`;
      // 【帯の色を本体から作る理由】
      //   最初は固定の桃・水色・若草を置いたが、淡いさんご色の体の上では
      //   水色の帯が灰緑に濁り、干渉色ではなく **大きなシミ** に見えた
      //   （`A8BC-G7N4` で確認）。真珠の干渉色は「体の色が角度でずれて見える」
      //   ものなので、本体色相を ±55 度ずらした **明度の高い** 淡色にする。
      //   明度を上げておけば、どんな地の上でも濁らず「光って見える」側に転ぶ。
      const bandF = full ? `filter="${url(softBlur(ctx, 'prlb', 3.4))}"` : '';
      const irid = (deg: number): string => hslToHex(colors.bodyHue + deg, 58, 88);
      s += `<g clip-path="${url(clip)}" ${bandF}>`;
      // 左右の帯で色相が逆へ振れる（＝見る位置で色が変わる）
      s += path(sheenBand(ctx, { t0: 0.06, t1: 0.66, inset: 0.05, width: 0.3, side: -1 }), {
        fill: irid(58),
        opacity: 0.32 * veilDown,
      });
      s += path(sheenBand(ctx, { t0: 0.24, t1: 0.88, inset: 0.04, width: 0.24, side: 1 }), {
        fill: irid(-62),
        opacity: 0.28 * veilDown,
      });
      s += `</g>`;
      s += highlightSpot(ctx, rng, { t: 0.2, k: 0.52, opacity: 0.5 * veilDown });
      break;
    }
    case 'frost': {
      // ── すりガラス: 輪郭がわずかに滲み、内部が霞む ──
      //
      // 【すきとおりと分けるための決め手】
      //   どちらも白を足すので、縁だけ光らせると両方「ガラス」になる。
      //   すりガラスは **中が見えない** ことが本質なので、
      //   体全体に白い霞を敷いて内部のコントラストを落とし、
      //   鋭い点光沢は置かない（置いた瞬間に透明なガラスになる）。
      if (full) {
        const f = softBlur(ctx, 'frostf', 3.4);
        s += `<g clip-path="${url(clip)}" filter="${url(f)}">`;
        s += path(shape.d, { stroke: '#ffffff', width: 12, opacity: 0.46 * veilDown });
        s += ellipse(cx, shape.topY + H * 0.36, shape.halfW * 0.72, H * 0.28, {
          fill: '#ffffff',
          opacity: 0.26 * veilDown,
        });
        s += `</g>`;
        // 内部を霞ませる均一な膜。中身のコントラストを一段落とす。
        s += `<g clip-path="${url(clip)}" filter="${url(softBlur(ctx, 'frosth', 6.5))}">`;
        s += ellipse(cx, shape.topY + H * 0.5, shape.halfW * 1.05, H * 0.56, {
          fill: '#f4fbff',
          opacity: 0.3 * veilDown,
        });
        s += `</g>`;
      } else {
        s += path(shape.d, { stroke: '#ffffff', width: 8, opacity: 0.34 * veilDown, clip });
        s += ellipse(cx, shape.topY + H * 0.5, shape.halfW * 0.9, H * 0.44, {
          fill: '#f4fbff',
          opacity: 0.2 * veilDown,
          clip,
        });
      }
      break;
    }
    case 'mossy': {
      // 表面の細かい苔粒。上面ほど密。
      //
      // 【ヤドクガエル系・星屑では苔の緑を使わない理由】
      //   苔粒は本来「湿った岩の表面」を作るためのものだが、
      //   黄土〜金色の地（おきび の『あみめ』など）の上に緑の粒が散ると
      //   途端に **カビの生えたメロン** になる。実際に、リードが名指しした
      //   `Z2G5-RRL7`（おきび × こけ質感 × あみめ）がこれだった。
      //   模様が地の関係を作っている個体では、粒を地の暗い側の色にして
      //   「皮膚のざらつき」として読ませる。質感の存在は残る。
      const grain = dartLike ? mix(colors.body, colors.ink, 0.55) : colors.leaf;
      const grainHi = dartLike ? mix(colors.body, colors.ink, 0.35) : colors.leafLight;
      const grainOp = dartLike ? 0.5 : 1;
      const cnt = ctx.detail === 'full' ? 62 : 30;
      s += `<g clip-path="${url(clip)}">`;
      for (let i = 0; i < cnt; i++) {
        const t = rng.float(0, 1) ** 1.7;
        const y = shape.topY + t * H * 0.92 + 2;
        const hw = shape.halfAt(y);
        const x = cx + rng.float(-hw, hw) * 0.98;
        const r = rng.float(1.1, 2.9);
        s += circle(x, y, r, { fill: grain, opacity: rng.float(0.3, 0.62) * grainOp });
      }
      // 上端の苔むし
      for (let i = 0; i < (ctx.detail === 'full' ? 16 : 8); i++) {
        const t = i / (ctx.detail === 'full' ? 16 : 8);
        const y = shape.topY + H * 0.03 + t * H * 0.2;
        const side = i % 2 === 0 ? -1 : 1;
        const x = shape.edgeX(y, side);
        s += circle(x - side * 2, y, rng.float(1.6, 3.4), { fill: grainHi, opacity: 0.5 * grainOp });
      }
      s += `</g>`;
      // 【光を吸う】
      //   粒だけでは「緑の点が散った艶ゼリー」にしかならなかった。
      //   苔の表面は光を反射せず吸うので、体全体をわずかに沈ませて
      //   本体グラデのハイライトを殺す。点光沢は一切置かない。
      s += path(shape.d, {
        fill: mix(colors.bodyDark, colors.ink, 0.25),
        opacity: 0.13 * (dartLike ? 0.5 : 1),
        clip,
      });
      break;
    }
    case 'mineral': {
      // ── こうぶつ: 面を割ったような多角形。硬質 ──
      //
      // 【弱すぎて matte と区別できていなかった】
      //   面の不透明度が 0.16/0.2 しかなく、しかも境界が同系色どうしの
      //   なめらかな変化だったので、並べると「マットと同じ」に見えた。
      //   鉱物の手がかりは面の明暗そのものより **稜線** で、
      //   隣り合う面のあいだにはっきりした線が走る。
      //   面のコントラストを上げ、稜線を明るい線で引く。
      // 【放射（風車）ではなく平面で割る理由】
      //   中心から扇形に割ると、どの個体も同じ「風車」になり、しかも
      //   卵で一度失敗した放射アーティファクトと同じ絵になる。
      //   結晶は **まっすぐな面** で割れるので、体を横切る直線を数本引き、
      //   その半平面を明・暗で塗る。重なりが自然に多角形の面を作る。
      // ── 稜線を「顔を横切る直線」にしないための 2 つの条件 ────────────
      //
      // 【何が起きていたか — 実物で確認】
      //   稜線は体をまたぐ **完全な直線** なので、割れる角度によっては
      //   眼球の上や口の上をそのまま通る。自然界に純粋な直線は無いので、
      //   人はそれを材質ではなく「表面に付いた傷」「割れたガラス片」と読む。
      //   `9XJD-THXX` は白い直線が 2 本、眼球の上と口の上を斜めに走っていた。
      //   1) 線をゆるく湾曲させる（塗る面の境界も同じ曲線にする）
      //   2) 表情の芯（faceCore）を通る割れ方は採らない
      //   結晶の面が顔を避けて割れるのは不自然ではない（面は体の形で決まる）。
      s += `<g clip-path="${url(clip)}">`;
      const midY = shape.topY + H * 0.46;
      const R = Math.max(shape.halfW, H * 0.62) * 2.2;
      const cuts = full ? 4 : 3;
      const core = faceCoreOf(ctx.face);
      /** 曲線上の点が表情の芯に入っているか。 */
      const inCore = (p: Vec, pad: number): boolean => {
        const dx = (p.x - core.cx) / Math.max(1, core.rx + pad);
        const dy = (p.y - core.cy) / Math.max(1, core.ry + pad);
        return dx * dx + dy * dy < 1;
      };
      for (let i = 0; i < cuts; i++) {
        let line: Vec[] | null = null;
        let nx = 0;
        let ny = 0;
        // 角度と位置を振り直して、顔を通らない割れ方を探す。
        for (let tryI = 0; tryI < 8; tryI++) {
          const a = rng.float(0, Math.PI);
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          // 割れ目は体の中心から少しずれた位置を通る
          const off = rng.float(-0.42, 0.42);
          const px = cx + shape.halfW * off * sa;
          const py = midY + H * 0.5 * off * -ca;
          const ux = sa;
          const uy = -ca;
          // 中央がふくらむゆるい弧。直線ではないので「傷」に読まれない。
          const bow = rng.float(-1, 1) * H * 0.16;
          const pts: Vec[] = [];
          for (let k = 0; k <= 10; k++) {
            const t = -1 + k * 0.2;
            const kk = (1 - t * t) * bow;
            pts.push({ x: px + ca * R * t + ux * kk, y: py + sa * R * t + uy * kk });
          }
          if (pts.some((p) => inCore(p, ctx.strokeW))) continue;
          line = pts;
          nx = ux;
          ny = uy;
          break;
        }
        // 顔を避けられる割れ方が見つからない個体では、この面は割らない。
        // 稜線が 1 本減っても質感は残るが、顔を横切ると絵が壊れる。
        if (!line) continue;
        const quad: Vec[] = [
          ...line,
          ...line
            .slice()
            .reverse()
            .map((p) => ({ x: p.x + nx * R, y: p.y + ny * R })),
        ];
        // 左上を向く面ほど明るい（本体グラデと同じ光源）
        const lit = nx * -0.7 + ny * -0.7 > 0;
        s += path(polyPath(quad), {
          fill: lit ? lighten(colors.body, 0.5) : darken(colors.body, 0.38),
          opacity: lit ? 0.2 : 0.16,
        });
        // 稜線。硬い材質は面と面のあいだに必ず線が出る（明側と暗側の二重線）。
        s += path(pathOpen(line), {
          stroke: lighten(colors.body, 0.62),
          width: 1.6,
          opacity: 0.42,
        });
        s += path(pathOpen(line.map((p) => ({ x: p.x - nx * 1.9, y: p.y - ny * 1.9 }))), {
          stroke: darken(colors.body, 0.42),
          width: 1.4,
          opacity: 0.28,
        });
      }
      s += path(shape.d, { stroke: lighten(colors.body, 0.5), width: 1.4, opacity: 0.5 });
      s += `</g>`;
      break;
    }
    case 'glassy': {
      // ── すきとおり: 高い透明度＋縁の強い屈折 ──
      //
      // 【すりガラスと分ける決め手】
      //   中が霞まないこと。縁で光が折れ曲がるので、輪郭に沿った
      //   **くっきりした帯** が走り、底の反対側に集光（コースティクス）が出る。
      //   すりガラスがぼかしだけで作られるのに対し、こちらは境界を持つ。
      s += `<g clip-path="${url(clip)}">`;
      // 強い縁の屈折ハイライト
      s += path(shape.d, { stroke: '#ffffff', width: ctx.strokeW * 2.2, opacity: 0.42 * veilDown });
      // 輪郭に沿う鋭い帯（素体ごとに形が変わる）
      s += path(sheenBand(ctx, { t0: 0.05, t1: 0.66, inset: 0.1, width: 0.17, side: -1 }), {
        fill: '#ffffff',
        opacity: 0.42 * veilDown,
      });
      s += `</g>`;
      s += highlightSpot(ctx, rng, { t: 0.24, k: 0.5, opacity: 0.72 * veilDown });
      // 集光。光が抜けた先の底が明るくなる。
      s += ellipse(cx + shape.halfW * 0.34, shape.botY - H * 0.16, shape.halfW * 0.3, H * 0.07, {
        fill: '#ffffff',
        opacity: 0.36 * veilDown,
        clip,
      });
      break;
    }
    case 'veil': {
      // うすぎぬ: 向こうが透ける薄い膜。
      //
      // 【jelly / frost / glassy と見分けるための作り分け】
      //   jelly  … 厚みのあるゼリー。内部ハイライト＋底に溜まる濃い層。
      //   frost  … すりガラス。白いぼかしが縁と内側に広く乗る。
      //   glassy … 厚いガラス。縁の屈折が鋭く、点ハイライトが強い。
      //   veil   … 膜。**全体が均一に薄く**、ハイライトを置かない。
      //            そのかわり縁だけ密度が上がる（膜が重なって見える）。
      //   ハイライトを置かないことが決定的で、これがある限り
      //   「艶のあるゼリー」から抜けられない。
      //
      // 本体の塗りは既に bodyOpacity 0.46 まで落ちているので、
      // 紙（または暗背景）が体を透かして見えている状態が地。
      // ここでは縁の密度と、膜のたわみだけを足す。
      s += `<g clip-path="${url(clip)}">`;
      // 縁の重なり（外側ほど濃く、内側へ 2 段で薄れる）
      s += path(shape.d, { stroke: colors.body, width: ctx.strokeW * 3.4, opacity: 0.3 });
      s += path(shape.d, { stroke: colors.body, width: ctx.strokeW * 1.6, opacity: 0.26 });
      // 膜のたわみ。縦に走るごく淡い皺を 2〜3 本だけ。
      const folds = ctx.detail === 'full' ? 3 : 2;
      for (let i = 0; i < folds; i++) {
        const u = (i + 0.6) / (folds + 0.2) - 0.5;
        const x0 = cx + u * shape.halfW * 1.5;
        s += path(
          `M${n(x0)} ${n(shape.topY + H * 0.12)}Q${n(x0 + rng.float(-7, 7))} ${n(shape.topY + H * 0.55)} ${n(x0 + rng.float(-5, 5))} ${n(shape.botY - H * 0.06)}`,
          { stroke: lighten(colors.body, 0.4), width: 2.4, opacity: 0.16 },
        );
      }
      s += `</g>`;
      break;
    }
    default: {
      // ── マット: 光沢なし。紙や粘土のように光が拡散する ──
      //
      // 【点光沢を置いていたのが間違いだった】
      //   従来は不透明度を下げただけの同じ楕円ハイライトを置いていたので、
      //   ゼリーと並べても「少し弱いゼリー」にしかならなかった。
      //   マットの本質は **鏡面反射が無い** ことなので、境界のある光を
      //   一切置かない。かわりに広く滲む光と、輪郭の内側の陰で形を出す。
      if (full) {
        // 大きくぼかした拡散光。境界を持たないので「光沢」に見えない。
        s += highlightSpot(ctx, rng, { t: 0.24, k: 1.7, opacity: 0.16, blur: 7 });
      } else {
        s += highlightSpot(ctx, rng, { t: 0.24, k: 1.6, opacity: 0.1 });
      }
      // 輪郭の内側の陰。艶が無いぶん、形はこの陰だけで読ませる。
      s += path(shape.d, {
        stroke: mix(colors.body, colors.bodyDark, 0.85),
        width: 7,
        opacity: 0.17,
        clip,
      });
      // 紙・粘土の地肌。ごく淡い粒を均一にまく（艶の代わりの手ざわり）。
      if (full) {
        s += `<g clip-path="${url(clip)}">`;
        for (let i = 0; i < 46; i++) {
          const y = shape.topY + rng.float(0.04, 0.96) * H;
          const hw = Math.max(3, shape.halfAt(y));
          const x = cx + rng.float(-hw, hw) * 0.94;
          s += circle(x, y, rng.float(0.7, 1.7), {
            fill: rng.bool() ? colors.bodyDark : colors.bodyLight,
            opacity: rng.float(0.06, 0.14),
          });
        }
        s += `</g>`;
      }
      break;
    }
  }

  if (!s) return null;
  return { id: 'texture', z: Z.TEXTURE, svg: s, bbox: shape.box };
}

/** 足元の地面（接地している素体だけ薄く敷く）。 */
export function groundTint(ctx: DrawCtx): string {
  if (!ctx.shape.grounded) return '';
  return ellipse(ctx.shape.cx, GROUND_Y + 1, ctx.shape.halfW * 1.05, 4.5, {
    fill: ctx.colors.inkPaint,
    opacity: 0.07,
  });
}

/**
 * 器官の塗りに本体と同じ光源方向のグラデーションをかける。
 *
 * 【なぜ要るか】
 *   耳・角・羽・尾がフラット塗りのままだと、本体だけが立体で装飾が
 *   ステッカーに見える（ビジュアル批評 P2-12）。本体は左上から光が来る
 *   radialGradient なので、器官にも同じ向きの線形グラデを入れて素材を揃える。
 */
export function organGrad(ctx: DrawCtx, name: string, base: string): string {
  const id = ctx.defs.add(`og_${name}`, (gid) =>
    `<linearGradient id="${gid}" x1="0.12" y1="0" x2="0.9" y2="1">` +
    `<stop offset="0%" stop-color="${lighten(base, 0.24)}"/>` +
    `<stop offset="52%" stop-color="${base}"/>` +
    `<stop offset="100%" stop-color="${mix(base, darken(base, 0.34), 0.85)}"/>` +
    `</linearGradient>`,
  );
  return url(id);
}
