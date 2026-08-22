/**
 * カードの「絵」を作る小さな SVG 工房。
 *
 * ここが作るのはゲノモン本体ではなく、その周りの意匠：
 *   - foil マスク（どこを光らせ、どこを光らせないか）
 *   - セキュリティ模様（DNA・遺伝子座モチーフ。角度で見え隠れする）
 *   - QR 風プレースホルダ
 *   - Collector の抽象背景
 *   - Natural History の血統図
 *
 * 【決定論】
 *   模様の粒の位置は個体 seed から作る（`Math.random()` は使わない）。
 *   同じ個体のカードはいつ見ても同じ指紋になる。将来カード固有 ID の
 *   visual fingerprint として使えるように、DNA 模様の刻みは
 *   証明書番号のハッシュから直接引いている。
 *
 * 【なぜ data URI を返すか】
 *   `@kongyo2/cards-css` の `mask` / `layers[].image` / `layers[].mask` は
 *   URL しか受け取らない（CSS の mask-image / background-image に載るため）。
 *   外部ファイルを増やさずに済むよう、SVG をそのまま data URI にして渡す。
 */

import type { Phenotype } from '../core/types.ts';
import { Rng, hashString } from '../core/rng.ts';
import type { CardDesign } from './cardModel.ts';

/** マスク・模様の作画キャンバス。カード比（63:88）に合わせてある。 */
const W = 630;
const H = 880;

/** SVG 文字列を CSS から使える data URI にする。 */
function dataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function wrap(inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
    `preserveAspectRatio="none">${inner}</svg>`
  );
}

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

// ─────────────────────────────────────────────────────────
//  foil マスク
// ─────────────────────────────────────────────────────────
//
// 【設計方針 — 全面レインボーにしない】
//   カード全面に foil を掛けると、どの個体も同じ「安いキラカード」に見え、
//   何より **ゲノモン自身の色と模様が読めなくなる**。主役は個体なので、
//   紙・枠・ロゴ・箔押しの層を分け、個体の上には原則 foil を置かない。
//
// 【重要 — CSS の mask は「アルファ」で効く】
//   `mask-image: url(...)` は `mask-mode: match-source` が既定で、
//   画像を渡した場合は **輝度ではなくアルファ** で切り抜く。
//   つまり「黒く塗れば隠れる」は誤りで、黒も白も不透明なら等しく残る。
//   最初これを取り違えて、Prism がカード全面（ゲノモンの上まで）を
//   洗い流してしまった。ここの SVG は必ず
//   **描いた所＝箔が出る／透明な所＝箔が出ない** で組むこと。
//   穴を開けたいときは SVG の `<mask>` で alpha を落とす。

/**
 * Certified：枠・ロゴ帯・Grade の箱・スペック罫・フッタのロゴだけを光らせる。
 * 背景は塗らない（＝透明＝箔なし）ので、ゲノモンの窓には箔が乗らない。
 *
 * 【座標の出どころ】
 *   実際に描画したカードの各要素の位置を測って、この 630×880 の座標系へ
 *   置き換えたもの（目分量で置くと箔が罫線から半分ずれる）。
 *   レイアウト（cardStyles.ts）を動かしたら、ここも測り直すこと。
 */
function certifiedMask(): string {
  const parts: string[] = [];
  // 外周の二重罫
  parts.push(`<rect x="14" y="20" width="601" height="840" rx="17" fill="none" stroke="#fff" stroke-width="8"/>`);
  parts.push(`<rect x="27" y="33" width="575" height="814" rx="10" fill="none" stroke="#fff" stroke-width="2.5"/>`);
  // ロゴ帯と認証シール
  parts.push(`<rect x="40" y="40" width="492" height="58" rx="4" fill="#fff" opacity="0.88"/>`);
  parts.push(`<circle cx="558" cy="73" r="33" fill="#fff" opacity="0.8"/>`);
  // 名前行の下の太い罫
  parts.push(`<rect x="44" y="156" width="542" height="6" fill="#fff"/>`);
  // Grade の箱
  parts.push(`<rect x="39" y="610" width="69" height="64" rx="6" fill="#fff" opacity="0.9"/>`);
  // スペック帯の上下罫
  parts.push(`<rect x="44" y="680" width="542" height="4" fill="#fff"/>`);
  parts.push(`<rect x="44" y="759" width="542" height="4" fill="#fff"/>`);
  // フッタのロゴ
  parts.push(`<rect x="44" y="805" width="470" height="22" rx="3" fill="#fff" opacity="0.8"/>`);
  return wrap(parts.join(''));
}

/**
 * Natural History：罫線・角の見出し括弧・下部の DNA 帯だけ。
 * 標本の紙面そのものは箔を持たない（博物館の刷り物は光らない）。
 */
function naturalMask(): string {
  const parts: string[] = [];
  parts.push(`<rect x="16" y="23" width="597" height="834" rx="10" fill="none" stroke="#fff" stroke-width="4.5"/>`);
  parts.push(`<rect x="26" y="33" width="577" height="814" rx="6" fill="none" stroke="#fff" stroke-width="1.8"/>`);
  // 見出しの二重罫
  parts.push(`<rect x="45" y="92" width="539" height="5" fill="#fff"/>`);
  parts.push(`<rect x="45" y="100" width="539" height="2" fill="#fff"/>`);
  // 標本板の角括弧（4 隅）
  const bracket = (x: number, y: number, sx: number, sy: number): string =>
    `<path d="M ${n(x)} ${n(y + sy * 32)} L ${n(x)} ${n(y)} L ${n(x + sx * 32)} ${n(y)}" ` +
    `fill="none" stroke="#fff" stroke-width="4"/>`;
  parts.push(bracket(49, 148, 1, 1));
  parts.push(bracket(580, 148, -1, 1));
  parts.push(bracket(49, 414, 1, -1));
  parts.push(bracket(580, 414, -1, -1));
  // 節の区切り罫
  for (const y of [429, 491, 572, 721]) {
    parts.push(`<rect x="45" y="${y}" width="539" height="2.5" fill="#fff"/>`);
  }
  // 下部の DNA 帯（ここは強め）
  parts.push(`<rect x="45" y="836" width="461" height="20" rx="3" fill="#fff" opacity="0.8"/>`);
  return wrap(parts.join(''));
}

/**
 * Collector：ほぼ全面に箔を許すが、**ゲノモンの居る楕円だけ** をやわらかく抜く。
 * ここだけ Prism を強めてよい、という約束の実装。
 * 抜きは stop-opacity（アルファ）で作る。
 */
function collectorMask(): string {
  const inner =
    // 【抜きを深くした理由】
    //   箔は color-dodge で合成される。暗いカードの上では
    //   **アルファ 10% でも十分に明るく焼き付く**ので、最初の抜き
    //   （中心 0 → 55% で 0.10）では Gold / Aurora がカード全面を
    //   1 色に塗り潰し、ゲノモンの色が消えた。中心付近はほぼ 0 にする。
    `<defs><radialGradient id="hole" cx="50%" cy="43%" r="54%">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset="0.42" stop-color="#fff" stop-opacity="0.03"/>` +
    `<stop offset="0.72" stop-color="#fff" stop-opacity="0.42"/>` +
    `<stop offset="1" stop-color="#fff" stop-opacity="1"/>` +
    `</radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#hole)"/>`;
  return wrap(inner);
}

/** デザインごとの foil マスク（data URI）。 */
export function foilMaskUri(design: CardDesign): string {
  const svg =
    design === 'certified' ? certifiedMask() : design === 'natural' ? naturalMask() : collectorMask();
  return dataUri(svg);
}

/**
 * ゲノモンの窓を避けるマスク。セキュリティ模様のレイヤーに掛ける。
 *
 * DNA 模様が個体の上を横切ると、模様と個体の輪郭が混ざって
 * どちらも読めなくなる。窓の中だけアルファを落として、紙面にだけ乗せる。
 * 窓の位置と大きさは実測値（certifiedMask のコメント参照）。
 */
export function artHoleMaskUri(design: CardDesign): string {
  const hole =
    design === 'certified'
      ? { x: 40, y: 170, w: 550, h: 431, r: 10 }
      : design === 'natural'
        ? { x: 41, y: 140, w: 547, h: 282, r: 8 }
        : { x: 31, y: 64, w: 567, h: 622, r: 22 };
  return dataUri(
    wrap(
      `<defs><mask id="h" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">` +
        `<rect width="${W}" height="${H}" fill="#fff"/>` +
        `<rect x="${hole.x}" y="${hole.y}" width="${hole.w}" height="${hole.h}" rx="${hole.r}" fill="#000"/>` +
        `</mask></defs>` +
        `<rect width="${W}" height="${H}" fill="#fff" mask="url(#h)"/>`,
    ),
  );
}

// ─────────────────────────────────────────────────────────
//  セキュリティ模様（DNA・遺伝子座モチーフ）
// ─────────────────────────────────────────────────────────

/**
 * カード固有の「指紋」。二重らせんと、その周りの刻み（塩基対）で構成する。
 *
 * 刻みの長さ・傾き・欠けの位置は証明書番号のハッシュから引くので、
 * 別の個体では並びが変わる。将来ここを本物の ID エンコードに差し替えれば、
 * 見た目を変えずに「読み取れる」模様にできる。
 *
 * 【見え方】
 *   紙面には薄く敷き、カードを傾けたときだけ強く出す（CSS 側で
 *   `--pointer-from-center` に連動させる）。常時くっきり出すと
 *   ただの飾りになり、情報が読みにくくなる。
 */
export function dnaPatternUri(certId: string, ink: string): string {
  const rng = new Rng(`${certId}#cardart:dna`);
  const rows = 30;
  const parts: string[] = [];

  // 【細かさの調整】
  //   最初は 3 本・振幅 34 の太いらせんにしたら、紙面の主役が模様になり
  //   「安いホログラム紙」に見えた。証券の地紋がそうであるように、
  //   細く・数多く・低コントラストにすると「精密な印刷物」に見える。
  const strands = 6;
  for (let strand = 0; strand < strands; strand++) {
    const x0 = 52 + strand * ((W - 104) / (strands - 1));
    const amp = 15 + (strand % 3) * 3;
    const phase = rng.float(0, Math.PI * 2);
    const up: string[] = [];
    const down: string[] = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const y = 24 + t * (H - 48);
      const s = Math.sin(t * Math.PI * 4.2 + phase);
      up.push(`${n(x0 + s * amp)},${n(y)}`);
      down.push(`${n(x0 - s * amp)},${n(y)}`);
    }
    parts.push(`<polyline points="${up.join(' ')}" fill="none" stroke="${ink}" stroke-width="1.1"/>`);
    parts.push(`<polyline points="${down.join(' ')}" fill="none" stroke="${ink}" stroke-width="1.1"/>`);
    // 塩基対の刻み。欠けを混ぜると「印刷された記号」らしく見える。
    for (let i = 0; i <= rows; i++) {
      if (rng.bool(0.3)) continue;
      const t = i / rows;
      const y = 24 + t * (H - 48);
      const s = Math.sin(t * Math.PI * 4.2 + phase) * amp;
      parts.push(
        `<line x1="${n(x0 + s)}" y1="${n(y)}" x2="${n(x0 - s)}" y2="${n(y)}" ` +
          `stroke="${ink}" stroke-width="${n(rng.float(0.6, 1.2))}"/>`,
      );
    }
  }

  // 遺伝子座モチーフ：小さな目盛りを左右の縁に沿って並べる（証券の側面刻み）
  const ticks = 56;
  for (let i = 0; i < ticks; i++) {
    const y = 26 + (i / ticks) * (H - 52);
    const w = rng.pick([4, 7, 11, 15]);
    parts.push(`<rect x="${n(W - 30 - w)}" y="${n(y)}" width="${n(w)}" height="2" fill="${ink}"/>`);
    parts.push(`<rect x="30" y="${n(y + 5)}" width="${n(rng.pick([4, 8, 12]))}" height="2" fill="${ink}"/>`);
  }

  return dataUri(wrap(parts.join('')));
}

// ─────────────────────────────────────────────────────────
//  QR 風プレースホルダ
// ─────────────────────────────────────────────────────────

/**
 * **本物の QR ではない**。レイアウト検証のための見た目だけの正方形。
 *
 * 将来 `genomon.app/g/<cardId>` へ飛ばす想定の場所を、実物と同じ面積で
 * 押さえておくためのもの。モジュールの並びは payload のハッシュから
 * 決まるので、同じカードなら同じ模様になる。
 */
export function qrPlaceholderSvg(payload: string, ink: string, paper: string): string {
  const N = 21;
  const rng = new Rng(`${payload}#cardart:qr`);
  const d: string[] = [];

  // 【なぜ <rect> ではなく <path> なのか — 実際に消えた】
  //   このカードは `.holo-card__content` の中に置く。ライブラリ CSS の
  //   `.holo-card__content *` は全子孫へ `width:auto` を掛けるので、
  //   SVG の `<rect width="1">` は CSS の width に上書きされて幅 0 になり、
  //   QR が真っ白の箱になった。パスの `d` は CSS から触られないので安全。
  const cell = (x: number, y: number): string => `M${x} ${y}h1v1h-1z`;
  const box = (x: number, y: number, w: number, h: number, t: number): string =>
    `M${x} ${y}h${w}v${h}h${-w}z` +
    `M${x + t} ${y + t}v${h - t * 2}h${w - t * 2}v${-(h - t * 2)}z`;

  const isFinder = (x: number, y: number): boolean =>
    (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (isFinder(x, y)) continue;
      if (!rng.bool(0.48)) continue;
      d.push(cell(x, y));
    }
  }

  const finder = (ox: number, oy: number): string =>
    box(ox, oy, 7, 7, 1) + `M${ox + 2} ${oy + 2}h3v3h-3z`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${N + 2} ${N + 2}" ` +
    `class="gmc-qr-svg" role="img" aria-label="QR プレースホルダ">` +
    `<path d="M-1 -1h${N + 2}v${N + 2}h${-(N + 2)}z" fill="${paper}"/>` +
    `<path fill="${ink}" fill-rule="evenodd" d="${d.join('')}${finder(0, 0)}${finder(N - 7, 0)}${finder(0, N - 7)}"/>` +
    `</svg>`
  );
}

// ─────────────────────────────────────────────────────────
//  Collector の抽象背景
// ─────────────────────────────────────────────────────────

/**
 * その個体の配色・模様・発光から作る抽象背景。
 *
 * Collector だけに許した「絵の後ろに何かある」感じの担保。
 * 具象を描くとゲノモンと喧嘩するので、光の帯と粒だけにしてある。
 */
export function collectorBackdropUri(pheno: Phenotype): string {
  const rng = new Rng(`${pheno.seed}#cardart:backdrop`);
  const pal = pheno.palette;
  const parts: string[] = [];

  // 後光：模様の密度が高い個体ほど本数を増やす
  const rays = 10 + Math.round(pheno.patDensity * 14);
  const cx = W / 2;
  const cy = H * 0.40;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + rng.float(-0.06, 0.06);
    const spread = rng.float(0.035, 0.085);
    const len = H * rng.float(0.55, 0.95);
    const p1 = `${n(cx + Math.cos(a - spread) * len)},${n(cy + Math.sin(a - spread) * len)}`;
    const p2 = `${n(cx + Math.cos(a + spread) * len)},${n(cy + Math.sin(a + spread) * len)}`;
    parts.push(
      `<polygon points="${n(cx)},${n(cy)} ${p1} ${p2}" fill="${pal.accent}" opacity="${n(rng.float(0.05, 0.16))}"/>`,
    );
  }

  // 同心の輪：発光が強い個体ほどはっきり出す
  const ringAlpha = 0.10 + pheno.glow * 0.22;
  for (let i = 0; i < 4; i++) {
    const r = H * (0.16 + i * 0.09);
    parts.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${pal.glow}" ` +
        `stroke-width="${n(1.5 + i * 0.8)}" opacity="${n(ringAlpha / (i + 1))}"/>`,
    );
  }

  // 粒：模様の大きさに合わせて粒径を変える
  const motes = 40 + Math.round(pheno.patDensity * 50);
  for (let i = 0; i < motes; i++) {
    parts.push(
      `<circle cx="${n(rng.float(20, W - 20))}" cy="${n(rng.float(20, H - 20))}" ` +
        `r="${n(rng.float(0.8, 2.2 + pheno.patScale * 2.6))}" fill="${pal.bodyLight}" ` +
        `opacity="${n(rng.float(0.12, 0.5))}"/>`,
    );
  }

  return dataUri(wrap(parts.join('')));
}

// ─────────────────────────────────────────────────────────
//  Natural History の血統図
// ─────────────────────────────────────────────────────────

/**
 * 親 2 体 → 本個体、をつなぐ小さな括弧。名前は HTML 側で添える。
 *
 * 最初は名前の位置まで含めて 1 枚の SVG で描いたが、カード幅 150px の
 * 一覧では線が潰れ、名前だけが宙に浮いて「何の図か分からない」状態になった。
 * 図は接続を示す括弧だけに絞り、文字は普通のテキストとして左右に置く。
 */
export function pedigreeSvg(ink: string, accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 40" class="gmc-ped-svg" aria-hidden="true">` +
    `<path d="M1 7 H13 V20 H22" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M1 33 H13 V20" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<circle cx="1.5" cy="7" r="2" fill="${ink}"/>` +
    `<circle cx="1.5" cy="33" r="2" fill="${ink}"/>` +
    `<circle cx="22.5" cy="20" r="3.4" fill="${accent}" stroke="${ink}" stroke-width="1.4"/>` +
    `</svg>`
  );
}

// ─────────────────────────────────────────────────────────
//  紙の地模様
// ─────────────────────────────────────────────────────────

/**
 * 生成紙・パーチメントの繊維。個体ごとに変える必要はないので
 * デザイン ID だけを seed にして、同じデザインなら同じ紙にする
 * （紙が個体ごとに変わると「同じシリーズのカード」に見えない）。
 */
export function paperGrainUri(design: CardDesign, ink: string): string {
  const rng = new Rng(`${design}#cardart:paper`);
  const parts: string[] = [];
  for (let i = 0; i < 260; i++) {
    const x = rng.float(0, W);
    const y = rng.float(0, H);
    const len = rng.float(4, 26);
    const a = rng.float(-0.5, 0.5);
    parts.push(
      `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + Math.cos(a) * len)}" y2="${n(y + Math.sin(a) * len)}" ` +
        `stroke="${ink}" stroke-width="${n(rng.float(0.4, 1.1))}" opacity="${n(rng.float(0.05, 0.22))}"/>`,
    );
  }
  return dataUri(wrap(parts.join('')));
}

/** 個体 seed を 32bit の整数へ。foil テクスチャの seed に使う。 */
export function textureSeedOf(seed: string): number {
  return hashString(`${seed}#cardart:texture`);
}
