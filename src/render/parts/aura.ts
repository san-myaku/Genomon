/**
 * 羽・結晶・浮遊物。
 *
 * いずれも「体の周囲に浮かぶ要素」なので、貼り付け感を消すというより
 * 「体と同じ光と色で統一する」ことで馴染ませる。
 * 浮遊物は顔（faceBox）に重ならない位置にだけ置く。
 */

import { darken, hexToHsl, hslToHex, lighten, mix } from '../../core/color.ts';
import { clamp, lerp } from '../../core/rng.ts';
import { Z, type DrawCtx, type PartOut } from '../ctx.ts';
import { VIEW } from '../geom.ts';
import {
  boxOverlapArea,
  boxUnion,
  circle,
  ellipse,
  n,
  path,
  polyPath,
  shrinkToFit,
  url,
  type Box,
  type Vec,
} from '../svg.ts';
import { decorScale } from './ears.ts';
import { harmonize } from '../palette.ts';
import { organGrad } from './body.ts';
import { decompose } from './pattern.ts';

// ─────────────────────────────────────────────────────────
//  羽
// ─────────────────────────────────────────────────────────

/**
 * 翅に出す模様の種類。
 *
 * 【新しい遺伝子座を作らず、体の `pattern` をそのまま翅にも出す方針】
 *   移植元（`poison_frog_fix_v8_...html`）は翅に独立した `wingPattern`
 *   遺伝子を持っていた（stripes / spots / iridescent / eye / checkered）。
 *   こちらは体と翅で模様を揃える。実在の蛾・蝶は体と翅の模様が
 *   同じ発生機構から出るので生きものとして自然だし、
 *   遺伝の見え方としても「模様の遺伝子が翅にも現れる」ほうが筋が通る。
 *
 * 【現在このうち実際に出るのは 2 種（ぶち・しま）だけ】
 *   『めだま』（`ocelli`）は製品オーナーの判断で不採用になり、
 *   `genetics/loci.ts` の pattern から外れている。よって
 *   **新しく生まれる個体の翅に眼状紋が乗ることはもう無い**。
 *   下の `case 'ocelli'` を消していないのは、既存のセーブが遺伝子型に
 *   `ocelli` を持っている可能性があるため（`pattern.ts` の同名 case と
 *   `face.ts` の `button` 意匠と同じ扱い）。消すとその個体の翅から
 *   模様が消える。死んだコードと判断して削除しないこと。
 *
 * 【3 種を採った理由 — 翅に乗せて美しいものだけを選ぶ】
 *   採用: めだま（`ocelli`）・ぶち（`spots`）・しま（`stripes`）。
 *     めだま … 蛾の眼状紋そのもの。この模様の本来の居場所（現在は取り下げ）。
 *     ぶち   … キジの翅の斑。移植元 1812 行の `spots` に当たる。
 *     しま   … シマエナガ風の縦縞。移植元 1800 行の `stripes` に当たる。
 *   見送り:
 *     はらしろ … 「腹が白い」という体の部位の話で、翅には対応物が無い。
 *     こまかい斑・まだら・ようみゃく … いずれも下地が feTurbulence か
 *       細い線で、半透明の翅に重ねると「汚れ」「かび」にしか見えない。
 *       とくに ようみゃく は翅がすでに翅脈の線を持っているので二重になる。
 *     わもよう … 体を巡る同心円。翅の形（付け根から外へ広がる）と
 *       中心が合わず、模様の意味（体を巻く輪）が失われる。
 *     うしがら … 大きな塊 1 つで翅がほぼ埋まり、翅の形が消える。
 *       牛柄はコントラストが命なので、薄く乗せると形質自体が死ぬ。
 *     ヤドクガエル系 4 種 … 「暗い地 × 明るい模様」の高コントラストが芯。
 *       半透明の翅では地が暗くならず、成立しない。
 *     ほしくず … 翅は半透明で、そこに小さな粒を散らすと
 *       「ほこりが付いた」ようにしか見えない。
 *   移植元の `iridescent`（虹色グラデ）と `checkered`（市松）は
 *   こちらに対応する対立遺伝子が無いので、そもそも移植しない。
 *   新しい遺伝子座を作らない方針なので、翅だけのために足すことはしない。
 */
/**
 * 色相を最短経路で補間する（0..360 度の輪をまたぐ側を選ぶ）。
 * `mix()`（RGB 線形補間）だと補色どうしの中間が濁った灰色を通ってしまうので、
 * ひればねの二色グラデーション（`finW` の `duo` バリエーション）専用に使う。
 */
function hueLerp(h1: number, h2: number, t: number): number {
  const diff = ((h2 - h1 + 540) % 360) - 180;
  return (h1 + diff * t + 360) % 360;
}

function wingPatternOf(patternId: string): 'ocelli' | 'spots' | 'stripes' | null {
  const kinds = decompose(patternId);
  // 合成模様（ぶち＋しま など）では 1 種だけ選ぶ。翅は面積が小さいので、
  // 2 種を重ねると何の模様かが読めなくなる。
  for (const k of ['ocelli', 'spots', 'stripes'] as const) {
    if (kinds.includes(k)) return k;
  }
  return null;
}

/**
 * 翅 1 枚ぶんの模様。翅のシルエット（`clipId`）で切り抜いて描く。
 *
 * 【薄く乗せる理由】
 *   翅は半透明なので、体と同じ濃さで乗せると下の翅色と混ざって濁り、
 *   「汚れた膜」になる。模様は輪郭が読める最低限の濃さに留める。
 *
 * 【左右の翅で同じ乱数列を使う理由】
 *   `ctx.rng()` は呼ぶたびに同じ名前から同じ系列を作る。左右で同じ名前を
 *   使えば、模様は左右で鏡写しになる。実在の蝶・蛾の翅模様は左右対称で、
 *   ここを左右バラバラにすると途端に「模様」ではなく「汚れ」に見える。
 */
function wingPatternSvg(
  ctx: DrawCtx,
  kind: 'ocelli' | 'spots' | 'stripes',
  clipId: string,
  wacc: string,
  ax: number,
  ay: number,
  LL: number,
  side: number,
): string {
  const c = ctx.colors;
  const rng = ctx.rng('wingPattern');
  // 翅の色から作る「濃いほう」。既存の蛾の翅脈と同じ色味に揃える。
  const deep = darken(wacc, 0.4);
  let g = '';
  let op = 0.42;

  switch (kind) {
    case 'stripes': {
      // 移植元の `stripes`（シマエナガ風の細い縦縞）。
      // 向こうは span 方向に等間隔で並べ、1 本ずつ端を揺らしていた。
      // 縞の本数（8 + 0..3）と「揺らす」作りをそのまま写す。
      const cnt = 8 + rng.int(0, 3);
      for (let i = 0; i < cnt; i++) {
        const x = ax + side * LL * (0.14 + 0.74 * (i / (cnt - 1)));
        g += path(
          `M${n(x + rng.float(-2, 2))} ${n(ay - LL * 0.7)}` +
            `Q${n(x + rng.float(-5, 5))} ${n(ay - LL * 0.2)} ${n(x + rng.float(-4, 4))} ${n(ay + LL * 0.6)}`,
          { stroke: deep, width: ctx.strokeThin * 0.85, opacity: 0.8 },
        );
      }
      break;
    }
    case 'spots': {
      // 移植元の `spots`（キジ風の不規則な斑）。
      // 向こうは 12 + 0..7 個・半径 3〜8 を span 全体に散らしていた。
      // 半径は翅の大きさ（LL）に対する比へ読み替える（絶対値は写せない）。
      const cnt = 11 + rng.int(0, 6);
      for (let i = 0; i < cnt; i++) {
        const x = ax + side * LL * rng.float(0.14, 0.98);
        const y = ay + rng.float(-0.82, 0.5) * LL;
        const r = LL * rng.float(0.05, 0.11);
        g += ellipse(x, y, r, r * 0.8, {
          fill: deep,
          opacity: rng.float(0.6, 0.85),
          extra: `transform="rotate(${n(rng.float(0, 180))} ${n(x)} ${n(y)})"`,
        });
      }
      break;
    }
    case 'ocelli': {
      // 移植元の `eye`（孔雀風の目玉模様）。同心 3 層・半径比 1.0 : 0.5 : 0.25。
      // 個数も向こうの 1〜3 に対して、こちらの翅は小さいので 1〜2 にする。
      const cnt = 1 + rng.int(0, 1);
      const halo = mix('#fff8ea', wacc, 0.16);
      const dot = mix(c.ink, deep, 0.3);
      for (let i = 0; i < cnt; i++) {
        const x = ax + side * LL * rng.float(0.42, 0.82);
        const y = ay + rng.float(-0.5, 0.04) * LL;
        const r = LL * rng.float(0.13, 0.2);
        g += circle(x, y, r, { fill: deep, opacity: 0.85 });
        g += circle(x, y, r * 0.5, { fill: halo, opacity: 0.92 });
        g += circle(x, y, r * 0.25, { fill: dot, opacity: 0.9 });
      }
      // 眼状紋はこの個体の「見せ場」なので、縞・斑より濃く乗せる。
      // それでも体（不透明度 0.85〜1）よりはずっと薄い。
      op = 0.7;
      break;
    }
  }
  return g ? `<g clip-path="${url(clipId)}" opacity="${n(op)}">${g}</g>` : '';
}

export function buildWings(ctx: DrawCtx): PartOut[] {
  const kind = ctx.parts.wings;
  if (!kind || kind === 'none') return [];
  const s = ctx.shape;
  const c = ctx.colors;
  const rng = ctx.rng('wings');
  const H = s.botY - s.topY;
  const ay = s.topY + H * 0.4;
  const k = decorScale(ctx);
  /**
   * 羽の大きさ倍率（製品オーナー要望「今の大きさを基準に、最大2.5倍の個体もいるように」）。
   *
   * 【0..1 の生値を 1.0〜2.5 倍へ変換する式】
   *   `wingSize` 遺伝子座は `glow`/`translucency` と同じ低め寄りの分布
   *   （mean 0.22）なので、生値のままだと大多数が 0.1〜0.4 に集まる。
   *   そこを線形に 1.0〜2.5 へ引き伸ばすと「ほとんどの個体が 1.4 倍前後」に
   *   なってしまい、「今の大きさが基準」という要望に反する。
   *   べき乗（指数 1.7）をかけてから引き伸ばすことで、低い値側をさらに
   *   0 寄りへ圧縮し、大多数を 1.0〜1.2 倍（見た目ほぼ今まで通り）に
   *   留めつつ、まれに出る高い生値（0.8 超）だけが 2 倍〜2.5 倍に届く
   *   ようにしている。
   */
  const wingSizeMult = 1 + Math.pow(ctx.pheno.wingSize, 1.7) * 1.5;
  // 体が大きいほど羽は控えめにして viewBox に収める
  // ひればねだけ 1.3 倍。他の羽は付け根から **上** へ立ち上がるので
  // 胴が広くても上端が体の外に出るが、ひれは横へ張り出す形なので、
  // 同じ寸法だと胴の広い個体（`7UDK-894T` `LTQJ-GP3L`）で
  // 体マスクにほぼ全部食われ、羽が 1 枚も見えなかった。
  // `wingSizeMult` は最後に掛ける。`shrinkToFit`（この関数の末尾）が
  // viewBox からのはみ出しを自動で縮めてくれるので、大きい個体でも破綻しない。
  const L = clamp(96 - s.halfW, 26, 46) * k * (kind === 'finW' ? 1.3 : 1) * wingSizeMult;
  let svg = '';
  let bbox: Box | undefined;

  // 羽の色相も本体 ±30 度に収める（桃色の体に緑の羽のような衝突を防ぐ）。
  // 半透明の虫翅は「質感表現で唯一成功している」と評価された箇所なので、
  // 不透明度と gossamer の作りには手を入れない。
  const wacc = harmonize(c.body, c.accent, 30);
  const wingGrad = ctx.defs.add('wingg', (id) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0.6">` +
    `<stop offset="0%" stop-color="${lighten(wacc, 0.45)}" stop-opacity="0.9"/>` +
    `<stop offset="100%" stop-color="${wacc}" stop-opacity="0.5"/></linearGradient>`,
  );

  // 体の模様の遺伝子を翅にも出す（`wingPatternOf` の説明を参照）。
  const wpat = wingPatternOf(ctx.parts.pattern);

  /**
   * ひればね専用の「宝石色」。
   *
   * 【移植元の作りと、それをそのまま写さなかった理由】
   *   向こうは `isBetta` の個体の **体色そのもの** を
   *   色相 `[0, 240, 270, 340, 200, 30]` から選び直し、彩度 95 / 明度 55 に
   *   振り切っていた（625 行）。あの美しさの正体は「彩度と明度の振り切り」で、
   *   6 つの色相表は「どれを選んでも綺麗な色になる保証」にすぎない。
   *
   *   こちらは `palette` 遺伝子座が体色の正本なので、
   *   **羽のために体色を作り直すことはできない**。
   *   そこで振り切るのは羽だけにする。色相は他の羽と同じく
   *   accent を本体 ±30 度へ寄せたものを使い（＝配色ファミリーの個性は残る）、
   *   彩度だけ 90 以上・明度 55 へ持ち上げる。
   *   緑の子はエメラルド、桃の子はマゼンタの鰭になり、
   *   「体の色をそのまま宝石にした鰭」として読める。
   *
   *   6 色の表を採らなかったのは、色相を表へ丸めると
   *   本体 ±30 度の調和則（`harmonize`）を破る個体が出るため。
   *   たとえば黄緑（色相 90）の子は表のどれとも 60 度以上離れていて、
   *   体と衝突する橙か空色の鰭になってしまう。
   *
   * 【無彩色（ash）の例外】
   *   `harmonize` は基準が無彩色のとき色相を動かさない。accent まで
   *   無彩色だと `hexToHsl` が h=0（赤）を返すので、彩度だけ上げると
   *   全個体が同じ赤い鰭になる。配色ファミリーが意図した色相
   *   （`bodyHue`）へ逃がす。
   */
  const jewel = ((): string => {
    const raw = hexToHsl(wacc);
    const h = raw.s < 10 ? c.bodyHue : raw.h;
    return hslToHex(h, Math.max(raw.s, 90), 55);
  })();

  /**
   * ひればねの見た目バリエーション（無地／二色グラデーション／斑点）。
   *
   * 【なぜ要るか】
   *   製品オーナー参考資料（PowerPoint「ヒレの柄」、`docs/screenshots/face/ref/image25〜30.png`
   *   ＝実物のベタの尾びれ写真）を見ると、現状の finW（付け根の濃色 → 先端の
   *   半透明白、という単純な明暗グラデ 1 種類だけ）には無い特徴が 2 つあった。
   *     ① 付け根と先端で色相そのものが変わる二色グラデーション（image26・27・28・30）
   *     ② ひれ条に沿って黒っぽい斑点が規則的に並ぶ（image25）
   *   新しい遺伝子座は作らず、既存の finW の描画を、個体の名前付き乱数で
   *   3 通りに分岐させることでこれを表現する。
   *
   * 【`ctx.rng(name)` を for(side) ループの外で呼ぶ理由】
   *   `ctx.rng(name)` は `root.stream('render:' + name)` を返すだけで、
   *   呼ぶ回数・タイミングに一切依存しない（`model.ts` 参照）。
   *   ループの外で 1 回だけ呼んで結果を変数へ確定させておけば、
   *   左右の翅が同じバリエーション・同じ色になり対称性が保たれる
   *   （`jewel` と同じ扱い）。ループの中で呼ぶと消費順が左右で変わり、
   *   対称性が崩れる。
   */
  const finVariantRng = ctx.rng('finVariant');
  const finVariant: 'plain' | 'duo' | 'spotted' =
    kind === 'finW'
      ? finVariantRng.pickWeighted(['plain', 'duo', 'spotted'] as const, [45, 30, 25])
      : 'plain';

  // 二色グラデーションの「先端側」の色。羽の中だけで完結させるため、
  // 体色（palette 遺伝子座）にも accent にも触れない。jewel の色相を
  // 大きく（50〜130 度、符号もランダム）振っただけの、羽専用の新しい色にする。
  // 彩度・明度は jewel と同じ「宝石色」の帯（彩度 85 以上）に保つ。
  const finTipRng = ctx.rng('finDuoHue');
  const jewelHsl = hexToHsl(jewel);
  const jewelTip = ((): string => {
    const dir = finTipRng.bool(0.5) ? 1 : -1;
    const h2 = (jewelHsl.h + dir * finTipRng.float(50, 130) + 360) % 360;
    // 先端は実物同様わずかに明るく抜ける（image28・30 の白っぽい先端）。
    return hslToHex(h2, Math.max(jewelHsl.s, 85), Math.min(72, jewelHsl.l + 10));
  })();
  const jewelTipHsl = hexToHsl(jewelTip);

  // 斑点の並び（image25）。ひれ条に沿った「規則的な」点々にするため、
  // 個体差は列数・列内の個数という **量** だけに留め、位置そのものは
  // 後述のベジェの t だけで決まる規則配置にする（ランダムに散らばる
  // 「汚れ」ではなく、豹柄のような整った並びに見せるため）。
  const finSpotRng = ctx.rng('finSpots');
  const spotRows = finSpotRng.int(6, 8);
  const spotsPerRow = finSpotRng.int(4, 6);

  for (const side of [-1, 1]) {
    // ひればねは付け根を体の縁寄りに置く（同上の理由）。
    const ax = s.cx + side * s.halfAt(ay) * (kind === 'finW' ? 0.82 : 0.62);
    const jit = 1 + ctx.pheno.asymmetry * rng.float(-0.1, 0.1);
    const LL = L * jit;
    let g = '';
    let b: Box;
    // 翅のシルエット（模様を切り抜く型）。翅の形そのものを使うので、
    // 模様が翅からはみ出すことは構造上ありえない。
    let clipEls = '';
    switch (kind) {
      case 'petalW': {
        for (let i = 0; i < 2; i++) {
          const up = i === 0 ? -1 : 0.35;
          const ll = LL * (i === 0 ? 1 : 0.7);
          const d =
            `M${n(ax)} ${n(ay)}` +
            `C${n(ax + side * ll * 0.4)} ${n(ay + up * ll * 0.95)} ${n(ax + side * ll * 1.05)} ${n(ay + up * ll * 0.7)} ${n(ax + side * ll * 1.0)} ${n(ay + up * ll * 0.14)}` +
            `C${n(ax + side * ll * 0.95)} ${n(ay + up * ll * 0.02 + ll * 0.3)} ${n(ax + side * ll * 0.4)} ${n(ay + ll * 0.28)} ${n(ax)} ${n(ay)}Z`;
          g += path(d, {
            fill: url(wingGrad),
            stroke: c.inkPaint,
            width: ctx.strokeW * 0.75,
            linejoin: 'round',
          });
          clipEls += `<path d="${d}"/>`;
        }
        b = { x: ax - (side < 0 ? LL * 1.1 : 0), y: ay - LL * 1.05, w: LL * 1.15, h: LL * 1.5 };
        break;
      }
      case 'moth': {
        const d =
          `M${n(ax)} ${n(ay - 4)}` +
          `C${n(ax + side * LL * 0.55)} ${n(ay - LL * 0.95)} ${n(ax + side * LL * 1.15)} ${n(ay - LL * 0.55)} ${n(ax + side * LL * 1.05)} ${n(ay + LL * 0.05)}` +
          `C${n(ax + side * LL * 0.98)} ${n(ay + LL * 0.62)} ${n(ax + side * LL * 0.42)} ${n(ay + LL * 0.72)} ${n(ax)} ${n(ay + LL * 0.3)}Z`;
        g += path(d, {
          fill: url(wingGrad),
          fillOpacity: 0.92,
          stroke: c.inkPaint,
          width: ctx.strokeW * 0.8,
          linejoin: 'round',
        });
        clipEls += `<path d="${d}"/>`;
        // 蛾の翅にもとから入っている小さな紋。
        // 『めだま』の個体では本物の眼状紋がこの上に来るので描かない
        // （紋が 2 種類重なると、どちらも「汚れ」に見える）。
        if (wpat !== 'ocelli') {
          g += ellipse(ax + side * LL * 0.66, ay - LL * 0.24, LL * 0.17, LL * 0.13, {
            fill: darken(wacc, 0.3),
            opacity: 0.55,
          });
          g += ellipse(ax + side * LL * 0.66, ay - LL * 0.24, LL * 0.07, LL * 0.055, {
            fill: c.belly,
            opacity: 0.8,
          });
        }
        g += path(
          `M${n(ax + side * LL * 0.2)} ${n(ay + LL * 0.32)}q${n(side * LL * 0.4)} ${n(-LL * 0.1)} ${n(side * LL * 0.78)} ${n(LL * 0.04)}`,
          { stroke: darken(wacc, 0.36), width: ctx.strokeThin * 0.9, opacity: 0.6 },
        );
        b = { x: ax - (side < 0 ? LL * 1.2 : 0), y: ay - LL, w: LL * 1.25, h: LL * 1.8 };
        break;
      }
      case 'finW': {
        // ── ひればね（ベタ＝熱帯魚の移植） ──────────────────
        //
        // 移植元 `poison_frog_fix_v8_...html` の
        //   `drawBettaFinDetailed`（1979 行）／グラデ（2687 行あたり）／
        //   `isBetta` の配色（625 行）
        // から取った。向こうで「稀に出る、はっとするほど綺麗な個体」を
        // 作っていたのは次の 3 つで、そこだけを羽へ持ち込んでいる。
        //   ① 宝石のような高彩度の色
        //   ② 付け根から放射する明るい筋（ひれ条）
        //   ③ 後縁の細かい波
        //
        // 【そのまま写したもの】
        //   ・前縁と後縁のベジェの制御点比（0.5/-0.8, 1.0/-0.5, 1.2/-0.2）
        //   ・後縁を 15 分割し `Math.sin(i * 12.34) * 0.1` で揺らす作り。
        //     この式は乱数ではなく **i だけで決まる** ので、
        //     左右で同じ数列になり、翅は自動的に鏡写しになる
        //     （実在の魚のひれ・蝶の翅が左右対称であることに合わせる）。
        //   ・付け根 → 先端の線形グラデーション（濃色 → 半透明の白）
        //   ・ひれ条を付け根から扇状に張る作りと、ひれの形で切り抜くこと
        //     （向こうの `globalCompositeOperation = 'source-atop'`）
        //
        // 【変えたもの】
        //   ・色は直値ではなく個体の配色から作る（下の `jewel` を参照）
        //   ・ひれ条は 3〜5 本 → **4 本**。96px では翅の縦幅が 20px 前後しか
        //     無く、5 本だと線の間隔が 4px を切って靄になる。
        //   ・線の色は `rgba(255,255,255,0.3)` より濃い 0.52。向こうは
        //     Canvas に 1px の実線を引いていたが、こちらは 200 単位の
        //     viewBox を 96px へ縮めるので、同じ濃さだと消える。
        //   ・上下を非対称（上 0.86 / 下 0.62）にした。魚のひれと違って
        //     ここは「羽」なので、質量が上に寄っていないと胴から
        //     生えた板に見える。
        const W = LL * 1.12;
        const HU = LL * 0.86;
        const HD = LL * 0.62;
        const px = (u: number): number => ax + side * W * u;
        let d =
          `M${n(ax)} ${n(ay)}` +
          `C${n(px(0.5))} ${n(ay - HU * 0.8)} ${n(px(1.0))} ${n(ay - HU * 0.5)} ${n(px(1.2))} ${n(ay - HU * 0.2)}`;
        const SPIKES = 15;
        for (let i = 1; i <= SPIKES; i++) {
          const t = i / SPIKES;
          // 外縁の基準半径は先端側で少し縮む。そこへ向こうの波を重ねる。
          const r = lerp(1.2, 1.0, t) + Math.sin(i * 12.34) * 0.1;
          d += `L${n(px(r))} ${n(lerp(ay - HU * 0.2, ay + HD * 0.5, t))}`;
        }
        d +=
          `C${n(px(1.0))} ${n(ay + HD * 0.5)} ${n(px(0.5))} ${n(ay + HD * 0.8)} ${n(ax)} ${n(ay)}Z`;

        // 付け根（濃く鮮やか）→ 先端。向こうの
        // `colors.sec` → `rgba(255,255,255,0.3)` に当たる。
        // 左右で向きを入れ替えないと、左の翅だけ先端が濃くなる。
        //
        // `duo`（二色グラデーション）は明暗だけでなく色相そのものを
        // jewel → jewelTip へ動かす。SVG のグラデーションは stop 間を
        // RGB で直線補間するため、2 点だけだと補色どうしで中間が濁った
        // 灰色を通ってしまう（`mix()` と同じ問題）。4 点に増やし、
        // 各点の色は `hueLerp` で色相だけを最短経路で先に決めてから
        // hslToHex に戻すことで、実物写真（image26 の赤→水色など）の
        // ような濁らない移り変わりにする。
        const finGrad = ctx.defs.add(`fing${side < 0 ? 'L' : 'R'}`, (id) => {
          const stops =
            finVariant === 'duo'
              ? [0, 0.35, 0.7, 1].map((t, i) => {
                  const hh = hueLerp(jewelHsl.h, jewelTipHsl.h, t);
                  const ss = lerp(jewelHsl.s, jewelTipHsl.s, t);
                  const ll = lerp(jewelHsl.l, jewelTipHsl.l, t);
                  const op = [0.95, 0.88, 0.8, 0.72][i];
                  return { off: t * 100, color: hslToHex(hh, Math.max(ss, 80), ll), op };
                })
              : [
                  { off: 0, color: jewel, op: 0.95 },
                  { off: 52, color: lighten(jewel, 0.2), op: 0.82 },
                  { off: 100, color: lighten(jewel, 0.62), op: 0.44 },
                ];
          const body = stops
            .map((st) => `<stop offset="${n(st.off)}%" stop-color="${st.color}" stop-opacity="${n(st.op)}"/>`)
            .join('');
          return (
            `<linearGradient id="${id}" x1="${side < 0 ? 1 : 0}" y1="0" x2="${side < 0 ? 0 : 1}" y2="0.8">${body}</linearGradient>`
          );
        });
        g += path(d, {
          fill: url(finGrad),
          stroke: c.inkPaint,
          width: ctx.strokeW * 0.68,
          linejoin: 'round',
        });
        clipEls += `<path d="${d}"/>`;

        // ひれ条。ひれの形で切り抜くので、外へはみ出さない。
        const finClip = ctx.defs.add(`finc${side < 0 ? 'L' : 'R'}`, (id) =>
          `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${d}"/></clipPath>`,
        );
        const RAYS = 4;
        for (let i = 0; i < RAYS; i++) {
          const t = i / (RAYS - 1);
          const dy = lerp(-HU * 0.46, HD * 0.56, t);
          g += path(
            `M${n(ax)} ${n(ay)}Q${n(px(0.55))} ${n(ay + dy * 0.5)} ${n(px(0.98))} ${n(ay + dy)}`,
            {
              stroke: '#ffffff',
              width: ctx.strokeThin * 0.95,
              opacity: 0.52,
              clip: finClip,
            },
          );
        }
        // 付け根に濃色をひと刷け。ひれは付け根がいちばん濃いので、
        // グラデだけだと胴との境で色が抜けて「浮いた膜」に見える。
        g += ellipse(ax + side * W * 0.1, ay, W * 0.22, (HU + HD) * 0.34, {
          fill: darken(jewel, 0.18),
          opacity: 0.42,
          clip: finClip,
        });

        // 斑点（`spotted` バリエーションのみ・image25）。
        // 上の RAYS と同じ二次ベジェ（付け根 → 制御点 → 先端）の式に沿って
        // 点を打つ。列（dy の位置）は RAYS と同じ範囲を使い、列内の点は
        // 曲線のパラメータ u で規則的に並べる。u が先端に寄るほど点を
        // 小さくして、実物写真の「先端で点が詰まって小さくなる」見た目に寄せる。
        if (finVariant === 'spotted') {
          const spotColor = mix(c.ink, darken(jewel, 0.5), 0.35);
          for (let ri = 0; ri < spotRows; ri++) {
            const rt = spotRows === 1 ? 0.5 : ri / (spotRows - 1);
            const dy = lerp(-HU * 0.46, HD * 0.56, rt);
            const p0x = ax;
            const p0y = ay;
            const p1x = px(0.55);
            const p1y = ay + dy * 0.5;
            const p2x = px(0.98);
            const p2y = ay + dy;
            for (let di = 0; di < spotsPerRow; di++) {
              const u = spotsPerRow === 1 ? 0.6 : lerp(0.3, 0.94, di / (spotsPerRow - 1));
              const iu = 1 - u;
              const bx = iu * iu * p0x + 2 * iu * u * p1x + u * u * p2x;
              const by = iu * iu * p0y + 2 * iu * u * p1y + u * u * p2y;
              const r = lerp(W * 0.05, W * 0.022, u);
              g += circle(bx, by, r, { fill: spotColor, opacity: 0.74, clip: finClip });
            }
          }
        }

        b = {
          x: ax - (side < 0 ? W * 1.32 : 0),
          y: ay - HU * 0.92,
          w: W * 1.32,
          h: HU * 0.92 + HD * 0.88,
        };
        break;
      }
      case 'gossamer':
      default: {
        for (let i = 0; i < 2; i++) {
          const ll = LL * (i === 0 ? 1 : 0.72);
          const up = i === 0 ? -0.72 : 0.15;
          const cxw = ax + side * ll * 0.6;
          const cyw = ay + ll * up * 0.62;
          g += ellipse(cxw, cyw, ll * 0.6, ll * 0.3, {
            fill: c.glow,
            fillOpacity: 0.42,
            stroke: c.inkPaint,
            width: ctx.strokeW * 0.6,
            extra: `transform="rotate(${n(side * (i === 0 ? -22 : 12))} ${n(cxw)} ${n(cyw)})"`,
          });
          clipEls +=
            `<ellipse cx="${n(cxw)}" cy="${n(cyw)}" rx="${n(ll * 0.6)}" ry="${n(ll * 0.3)}"` +
            ` transform="rotate(${n(side * (i === 0 ? -22 : 12))} ${n(cxw)} ${n(cyw)})"/>`;
        }
        for (let i = 0; i < 3; i++) {
          const t = (i + 1) / 4;
          g += path(
            `M${n(ax)} ${n(ay)}q${n(side * LL * 0.5)} ${n(-LL * (0.55 - t * 0.4))} ${n(side * LL * 1.0)} ${n(-LL * (0.5 - t * 0.55))}`,
            { stroke: mix(c.ink, c.glow, 0.5), width: ctx.strokeThin * 0.7, opacity: 0.55 },
          );
        }
        b = { x: ax - (side < 0 ? LL * 1.2 : 0), y: ay - LL * 0.95, w: LL * 1.25, h: LL * 1.5 };
        break;
      }
    }
    if (wpat && clipEls) {
      const clipId = ctx.defs.add(`wingp${side < 0 ? 'L' : 'R'}`, (id) =>
        `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${clipEls}</clipPath>`,
      );
      g += wingPatternSvg(ctx, wpat, clipId, wacc, ax, ay, LL, side);
    }
    svg += g;
    bbox = boxUnion(bbox, b);
  }

  // 既定の下限 0.72 だと `wingSize` 形質の高倍率個体（最大 2.5 倍）で
  // viewBox に収まりきらないことがある（`shrinkToFit` のコメント参照）。
  // 羽は面積のある翅なので、もう少し縮めても模様や形は読めるままなので
  // 0.42 まで許容する。
  const fitted = shrinkToFit(svg, bbox, s.cx, ay, VIEW, 2, 0.34);
  return [
    {
      id: 'wings',
      z: Z.WING,
      svg: fitted.svg,
      anchor: { id: 'wings', x: s.cx, y: ay, angle: 0, scale: k },
      bbox: fitted.bbox,
    },
  ];
}

// ─────────────────────────────────────────────────────────
//  結晶
// ─────────────────────────────────────────────────────────

function shardPath(x: number, y: number, h: number, w: number, tilt: number): string {
  const a = (tilt * Math.PI) / 180;
  const ux = Math.sin(a);
  const uy = -Math.cos(a);
  const px = -uy;
  const py = ux;
  const pts: Vec[] = [
    { x: x - px * w * 0.5, y: y - py * w * 0.5 },
    { x: x - px * w * 0.42 + ux * h * 0.55, y: y - py * w * 0.42 + uy * h * 0.55 },
    { x: x + ux * h, y: y + uy * h },
    { x: x + px * w * 0.44 + ux * h * 0.5, y: y + py * w * 0.44 + uy * h * 0.5 },
    { x: x + px * w * 0.5, y: y + py * w * 0.5 },
  ];
  return polyPath(pts);
}

export function buildCrystal(ctx: DrawCtx): PartOut[] {
  const kind = ctx.parts.crystal;
  if (!kind || kind === 'none') return [];
  const s = ctx.shape;
  const c = ctx.colors;
  const rng = ctx.rng('crystal');
  const H = s.botY - s.topY;
  const k = decorScale(ctx);
  let svg = '';
  let bbox: Box | undefined;
  let z: number = Z.CRYSTAL_FRONT;
  let anchor = { id: 'crystal', x: s.cx, y: s.topY, angle: 0, scale: k };

  // 結晶もフラット塗りをやめ、本体と同じ光源方向のグラデにする
  //（装飾だけがベタ塗りだと本体と別素材に見える。ビジュアル批評 P2-12）。
  const shardFill = organGrad(ctx, 'crystal', c.crystal);
  const drawShard = (x: number, y: number, h: number, w: number, tilt: number): void => {
    svg += path(shardPath(x, y, h, w, tilt), {
      fill: shardFill,
      fillOpacity: 0.9,
      stroke: c.inkPaint,
      width: ctx.strokeW * 0.72,
      linejoin: 'round',
    });
    const a = ((tilt - 90) * Math.PI) / 180;
    svg += path(
      `M${n(x + Math.cos(a) * w * 0.14)} ${n(y + Math.sin(a) * w * 0.14)}L${n(x + Math.sin((tilt * Math.PI) / 180) * h * 0.86)} ${n(y - Math.cos((tilt * Math.PI) / 180) * h * 0.86)}`,
      { stroke: c.crystalLight, width: ctx.strokeThin * 0.9, opacity: 0.95 },
    );
    bbox = boxUnion(bbox, { x: x - h * 0.7, y: y - h, w: h * 1.4, h: h * 1.3 });
  };

  switch (kind) {
    case 'shard': {
      // 【！！このコードは消さないこと！！ — 遺伝子カタログから外れているが現役】
      //   製品オーナーの判断で『かけら』（結晶）は不採用になり、リードが
      //   `genetics/loci.ts` の crystal から `shard` を **外し済み**。
      //   したがって **新しく生まれる個体にこの結晶は二度と出ない**。
      //   それでも描画を残しているのは、**既存のセーブデータが遺伝子型に
      //   `shard` を持っている可能性がある**ため。ここを消すと
      //   `switch (kind)` がどの case にも入らず、その個体の背中の結晶が
      //   **無地に化ける** ＝ プレイヤーから見れば
      //   飼っている個体の見た目が勝手に変わる。
      //   カタログから消えていることを理由に「もう使われていない死んだコード」と
      //   判断して削除しないこと（`pattern.ts` の `ocelli` / `face.ts` の
      //   `button` と同じ扱い）。
      const side = rng.bool(0.5) ? -1 : 1;
      const y0 = s.topY + H * 0.34;
      const x0 = s.edgeX(y0, side) - side * 4;
      // 体が大きい個体では結晶が viewBox を突き抜けるので、
      // 使える横幅から結晶の大きさそのものを決める。
      const kk = Math.min(k, Math.max(10, side > 0 ? 191 - x0 : x0 - 9) / 26);
      // 「攻撃的なトゲ」対策（PO指摘 6JC2-D45D）:
      //   ・角度: 体から突き刺さるように立つ side*24/42 度（ほぼ垂直に外へ突出）を、
      //     体の輪郭に沿って寝かせる side*62/78 度に変更。切っ先が外へ向かって
      //     刺さる印象を消し、肩の丸みに沿って生えているように見せる。
      //   ・比率: 縦横比を細長い刃物（22:10, 14:7 ≒ 2.2:1, 2:1）から
      //     ほぼ正方形に近い丸みのある鉱石塊（13:12, 8:7 ≒ 1.08:1, 1.14:1）に
      //     変更し、先端の鋭さの印象を弱める（shardPath 自体は変更しない）。
      //   ・長さ: 22/14 → 13/8 に短縮し、体からの突出量そのものを抑える。
      drawShard(x0, y0, 13 * kk, 12 * kk, side * 62);
      drawShard(x0 + side * 5 * kk, y0 + 6 * kk, 8 * kk, 7 * kk, side * 78);
      anchor = { id: 'crystal', x: x0, y: y0, angle: side * 62, scale: kk };
      break;
    }
    case 'cluster': {
      // 【！！このコードは消さないこと！！ — 遺伝子カタログから外れているが現役】
      //   製品オーナーの判断で『むらがり』（結晶）は不採用になり、リードが
      //   `genetics/loci.ts` の crystal から `cluster` を **外し済み**。
      //   したがって **新しく生まれる個体にこの結晶は二度と出ない**。
      //   それでも描画を残しているのは、**既存のセーブデータが遺伝子型に
      //   `cluster` を持っている可能性がある**ため。ここを消すと
      //   `switch (kind)` がどの case にも入らず、その個体の背中の結晶が
      //   **無地に化ける** ＝ プレイヤーから見れば
      //   飼っている個体の見た目が勝手に変わる。
      //   カタログから消えていることを理由に「もう使われていない死んだコード」と
      //   判断して削除しないこと（`shard` / `pattern.ts` の `ocelli` /
      //   `face.ts` の `button` と同じ扱い）。
      const side = rng.bool(0.5) ? -1 : 1;
      const y0 = s.topY + H * 0.42;
      const x0 = s.edgeX(y0, side) - side * 3;
      const kk = Math.min(k, Math.max(10, side > 0 ? 191 - x0 : x0 - 9) / 34);
      for (let i = 0; i < 4; i++) {
        const h = (24 - i * 4) * kk;
        drawShard(x0 + side * i * 6 * kk, y0 + i * 6 * kk - 4, h, (10 - i) * kk, side * (18 + i * 14));
      }
      anchor = { id: 'crystal', x: x0, y: y0, angle: side * 24, scale: kk };
      break;
    }
      case 'halo': {
        // 【！！このコードは消さないこと！！ — 遺伝子カタログから外れているが現役】
        // `crystal` の新規カタログは `none` のみにしたが、旧セーブが
        // `halo` を持っている可能性がある。描画を消すとその個体だけ
        // 結晶が無地に化けるため、互換用に残す。
        z = Z.CRYSTAL_BACK;
      const cy = Math.max(16, s.topY - 12);
      const rx = Math.min(s.halfW * 0.9, 42);
      svg += ellipse(s.cx, cy, rx, rx * 0.32, {
        stroke: mix(c.crystal, c.glow, 0.5),
        width: 2.4,
        opacity: 0.75,
      });
      const cnt = 7;
      for (let i = 0; i < cnt; i++) {
        const t = i / cnt;
        const a = t * Math.PI * 2;
        const px = s.cx + Math.cos(a) * rx;
        const py = cy + Math.sin(a) * rx * 0.32;
        drawShard(px, py, 9 * k, 4.6 * k, Math.sin(a) * 16);
      }
      bbox = boxUnion(bbox, { x: s.cx - rx - 8, y: cy - rx * 0.32 - 12, w: rx * 2 + 16, h: rx * 0.64 + 22 });
      anchor = { id: 'crystal', x: s.cx, y: cy, angle: 0, scale: k };
      break;
    }
    default:
      break;
  }

  if (!svg) return [];
  const fitted = shrinkToFit(svg, bbox, anchor.x, anchor.y, VIEW, 2);
  return [{ id: 'crystal', z, svg: fitted.svg, anchor, bbox: fitted.bbox }];
}

// ─────────────────────────────────────────────────────────
//  浮遊物
// ─────────────────────────────────────────────────────────

export function buildFloaters(ctx: DrawCtx): PartOut[] {
  const kind = ctx.parts.floaters;
  if (!kind || kind === 'none') return [];
  const s = ctx.shape;
  const c = ctx.colors;
  const rng = ctx.rng('floaters');
  const face = ctx.face.box;
  const count = kind === 'motes' ? 12 : kind === 'spores' ? 9 : 6;

  const back: string[] = [];
  const front: string[] = [];
  let bboxB: Box | undefined;
  let bboxF: Box | undefined;

  for (let i = 0; i < count; i++) {
    // 顔に重ならない位置を探す（最大 12 回試行）
    let x = 0;
    let y = 0;
    let ok = false;
    for (let tries = 0; tries < 12; tries++) {
      const a = rng.float(0, Math.PI * 2);
      const rr = rng.float(0.95, 1.35);
      x = s.cx + Math.cos(a) * s.halfW * rr * 1.15;
      y = s.topY + (s.botY - s.topY) * 0.5 + Math.sin(a) * (s.botY - s.topY) * 0.5 * rr;
      x = clamp(x, 10, 190);
      y = clamp(y, 10, 190);
      const cell: Box = { x: x - 6, y: y - 6, w: 12, h: 12 };
      if (boxOverlapArea(cell, face) === 0) {
        ok = true;
        break;
      }
    }
    if (!ok) continue;
    const isFront = rng.bool(0.45);
    const sink = isFront ? front : back;
    const bx: Box = { x: x - 8, y: y - 8, w: 16, h: 16 };
    if (isFront) bboxF = boxUnion(bboxF, bx);
    else bboxB = boxUnion(bboxB, bx);

    switch (kind) {
      case 'orbs': {
        const r = rng.float(3.4, 6.4);
        sink.push(circle(x, y, r * 1.8, { fill: c.glow, opacity: 0.18 }));
        sink.push(circle(x, y, r, { fill: c.glow, fillOpacity: 0.75, stroke: c.inkPaint, width: ctx.strokeThin * 0.7 }));
        sink.push(circle(x - r * 0.3, y - r * 0.3, r * 0.3, { fill: '#ffffff', opacity: 0.85 }));
        break;
      }
      case 'petals': {
        // 【！！このコードは消さないこと！！ — 遺伝子カタログから外れているが現役】
        // 新規抽選からは撤去済み。旧セーブの `floaters=petals` を再表示する
        // ためだけに残している。
        const r = rng.float(4, 6.6);
        const rot = rng.float(0, 360);
        sink.push(
          ellipse(x, y, r, r * 0.62, {
            fill: c.petal,
            stroke: c.inkPaint,
            width: ctx.strokeThin * 0.8,
            extra: `transform="rotate(${n(rot)} ${n(x)} ${n(y)})"`,
          }),
        );
        break;
      }
      case 'spores': {
        const r = rng.float(2.4, 4.2);
        sink.push(circle(x, y, r, { fill: lighten(c.leaf, 0.42), stroke: c.leafDark, width: ctx.strokeThin * 0.6 }));
        for (let j = 0; j < 5; j++) {
          const a = (j / 5) * Math.PI * 2;
          sink.push(
            path(`M${n(x + Math.cos(a) * r)} ${n(y + Math.sin(a) * r)}l${n(Math.cos(a) * 3)} ${n(Math.sin(a) * 3)}`, {
              stroke: c.leafDark,
              width: ctx.strokeThin * 0.5,
              opacity: 0.7,
            }),
          );
        }
        break;
      }
      case 'motes':
      default: {
        // ほこりは丸い粒だけにする。尖った星形を混ぜると、結晶を
        // 新規撤去したあとも浮遊物が「結晶の付属物」に見えてしまう。
        const r = rng.float(1.4, 3);
        sink.push(circle(x, y, r, { fill: mix(c.accent, '#ffffff', 0.35), opacity: rng.float(0.5, 0.9) }));
        break;
      }
    }
  }

  const out: PartOut[] = [];
  if (back.length) {
    out.push({ id: 'floatersBack', z: Z.FLOAT_BACK, svg: back.join(''), bbox: bboxB });
  }
  if (front.length) {
    out.push({
      id: 'floatersFront',
      z: Z.FLOAT_FRONT,
      svg: front.join(''),
      bbox: bboxF,
      anchor: { id: 'floaters', x: s.cx, y: s.topY, angle: 0, scale: 1 },
    });
  }
  return out;
}

/** 装飾が顔をどれだけ覆っているか（0..1）。inspect で使う。 */
export function faceCoverage(face: Box, boxes: readonly (Box | undefined)[]): number {
  const area = Math.max(1, face.w * face.h);
  let cov = 0;
  for (const b of boxes) {
    if (!b) continue;
    cov += boxOverlapArea(face, b);
  }
  return clamp(cov / area, 0, lerp(1, 1, 1));
}
