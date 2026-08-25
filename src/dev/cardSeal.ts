/**
 * 鑑定機関の認証印。
 *
 * 【なぜこれが要るか】
 *   カードを「集めたい物」にしているのは絵と箔だけではない。
 *   **公的機関が押した印がある** という一点が、ただの絵札を
 *   「この個体の記録」に変える。しかも印の素材そのものが段を語るので、
 *   数字を読まなくても格が分かる（§8）。
 *
 *     紙に押したインク → 箔押し → ホロ箔押し
 *
 * 【外部画像に依存しない】
 *   すべて SVG。data URI ではなく **インライン SVG** で返すのは、
 *   CSS 変数（`--seal-ink` など）で素材を差し替えたいから。
 *   data URI にすると色が焼き込まれ、素材ごとに別の URI を作る羽目になる。
 *
 * 【`<rect>` を使わない】
 *   カードは `.holo-card__content` の中に置く。ライブラリ CSS の
 *   `.holo-card__content *` が全子孫へ `width:auto` を掛けるので、
 *   SVG の `<rect width="…">` は幅 0 に潰れる（QR で実際に消えた。
 *   AGENTS.md「Cards Lab」4）。ここは `<path>` `<circle>` `<line>` だけで組む。
 *
 * 【決定論】
 *   地紋（ギヨシェ）の巻き数・微細目盛りの並びは証明書番号のハッシュから引く。
 *   同じカードはいつ見ても同じ印になる。`Math.random()` は使わない。
 *
 * 【430px で潰れないこと（§21）】
 *   微細表現は「よく見るとヤバい」までで、遠目には濃度に見えるのが正しい。
 *   線を細くしすぎると、縮小時に消えるのではなく **灰色のもや** になる。
 *   ギヨシェは 0.35 幅・不透明度 0.5 前後を下限にしてある。
 */

import { Rng, hashString } from '../core/rng.ts';
import type { SealMaterial } from './cardRarity.ts';

/** 印の作画キャンバス。円形なので正方形。 */
const S = 120;
const CX = S / 2;
const CY = S / 2;

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

/**
 * 「押されかた」の揺らぎ。
 *
 * 【なぜ要るか（§9）】
 *   同じ場所・同じ角度・同じ濃さで出ると、**印刷済みの UI** に見える。
 *   認証印は「あとから人が 1 枚ずつ押したもの」でなければならないので、
 *   位置・角度・大きさ・濃さを個体ごとにずらす。
 *
 * 【決定論（AGENTS.md §1）】
 *   すべて `new Rng(seed)` の名前付きサブストリーム。`Math.random()` は使わない。
 *   同じ個体のカードは、何度描き直しても寸分違わず同じ押されかたになる。
 *   ストリーム名を変えると押されかたが総入れ替えになるので、名前は変えない。
 */
export interface SealStamp {
  /** 回転（度）。 */
  rotate: number;
  /** 右端からの位置（カード幅に対する %）。 */
  x: number;
  /** 上からの位置（カード高さに対する %）。 */
  y: number;
  /** 拡大率。 */
  scale: number;
  /** 濃さ。インクだけ差が大きい（箔は圧着差の程度に留める）。 */
  opacity: number;
  /** 押しムラの種（feTurbulence の seed）。 */
  inkSeed: number;
  /** 押しムラの強さ 0..1。0 なら均一。 */
  inkFade: number;
}

/**
 * 個体ごとの押されかたを決める。
 *
 * 【振れ幅は実物を見て決めた】
 *   回転を ±20° まで振ると「貼り間違えた」に見え、±4° では揃って見える。
 *   位置も同様で、大きく散らすと版面が崩れ、小さいと印刷に見える。
 *   ここの数値を変えたら、必ず 20 個体を並べて目で確かめること（§20）。
 */
export function sealStamp(seed: string, material: SealMaterial): SealStamp {
  const root = new Rng(`${seed}#seal:stamp`);
  const foil = isFoil(material);
  return {
    rotate: root.stream('rot').float(-12, 10),
    // 右端から。カードの縁を割らない範囲で振る。
    x: root.stream('x').float(2.5, 9),
    // 【下限は脚（フレーバー）に掛からない高さで止める】
    //   印の高さはカード高さの 24.3%（幅 34% の正方形）。
    //   上端 70% だと下端が 94% になり、**2 行になったフレーバーに重なって
    //   文が読めなくなった**（実測。medium の比較帯で発生）。
    //   脚は 92% から始まるので、上端は 65% までに留める。
    //   絵の下端〜情報欄にはこの範囲でも十分にまたがる。
    y: root.stream('y').float(54, 65),
    scale: root.stream('scale').float(0.94, 1.06),
    // 箔は圧着差の程度（§10）。インクは押し圧の差が大きい。
    opacity: foil ? root.stream('op').float(0.94, 1) : root.stream('op').float(0.8, 1),
    inkSeed: root.stream('ink').int(1, 9999),
    inkFade: foil ? root.stream('fade').float(0.12, 0.28) : root.stream('fade').float(0.3, 0.72),
  };
}

export interface SealOptions {
  material: SealMaterial;
  /** 証明書番号（下弧に刷る・地紋の seed）。 */
  certId: string;
  /** 鑑定日（中央下）。 */
  certifiedOn: string;
  /**
   * SVG 内 id の衝突回避。1 画面に何枚もカードが出るので、
   * `<textPath href="#...">` の参照先が混ざらないように必ず変える。
   */
  uid: string;
  /** 地紋・微細目盛りの濃さ 0..1。0 なら入れない（STANDARD）。 */
  security: number;
  /** 小さく描くとき（比較・一覧）に、潰れる要素を省く。 */
  compact?: boolean;
  /**
   * 押しムラ（§10）。`sealStamp()` の inkSeed / inkFade を渡す。
   * 省略すると均一な印になる（比較・一覧では計算を省くため既定は無し）。
   */
  ink?: { seed: number; fade: number };
}

/** 箔（面で光る）系か、インク（線だけ）系か。 */
function isFoil(material: SealMaterial): boolean {
  return material === 'silver' || material === 'gold' || material === 'holo';
}

// ─────────────────────────────────────────────────────────
//  微細表現
// ─────────────────────────────────────────────────────────

/**
 * ギヨシェ（紙幣・証券の地紋）。
 *
 * ハイポトロコイド（スピログラフ）で描く。R/r/d の比で花弁の数が決まり、
 * 証明書番号ごとに違う模様になる。**閉じた 1 本の線**なので、
 * 縮小しても「編み目」の印象が残る（点の集合だと灰色に潰れる）。
 */
function guilloche(rng: Rng, radius: number, petals: number, depth: number): string {
  const R = radius;
  const r = R / petals;
  const d = r * depth;
  const pts: string[] = [];
  const steps = petals * 26;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * 1;
    const k = (R - r) / r;
    const x = CX + (R - r) * Math.cos(t) + d * Math.cos(k * t);
    const y = CY + (R - r) * Math.sin(t) - d * Math.sin(k * t);
    pts.push(`${n(x)},${n(y)}`);
  }
  const rot = rng.float(0, 60);
  return (
    `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--seal-line)" ` +
    `stroke-width="0.4" transform="rotate(${n(rot)} ${CX} ${CY})"/>`
  );
}

/**
 * 二重らせん。印の中に「遺伝の証明書である」ことを刻む。
 *
 * 【交差を ✗ に見せない】
 *   Certified の初代シールで、二重らせんが交差して **バツ印（不合格）** に
 *   読めた失敗がある。ここでは中央に置かず、内側リングに沿った
 *   **細い帯**として左右に走らせる。交点が中心に来ないので記号化しない。
 */
function helixBand(y: number, width: number, turns: number): string {
  const steps = 60;
  const up: string[] = [];
  const down: string[] = [];
  const x0 = CX - width / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + t * width;
    const s = Math.sin(t * Math.PI * turns) * 2.6;
    up.push(`${n(x)},${n(y + s)}`);
    down.push(`${n(x)},${n(y - s)}`);
  }
  const rungs: string[] = [];
  for (let i = 2; i < steps - 1; i += 4) {
    const t = i / steps;
    const x = x0 + t * width;
    const s = Math.sin(t * Math.PI * turns) * 2.6;
    rungs.push(`<line x1="${n(x)}" y1="${n(y + s)}" x2="${n(x)}" y2="${n(y - s)}" stroke="var(--seal-line)" stroke-width="0.32"/>`);
  }
  return (
    `<polyline points="${up.join(' ')}" fill="none" stroke="var(--seal-line)" stroke-width="0.4"/>` +
    `<polyline points="${down.join(' ')}" fill="none" stroke="var(--seal-line)" stroke-width="0.4"/>` +
    rungs.join('')
  );
}

/**
 * 押しムラ（§10）。
 *
 * 【外部画像を使わずに作る】
 *   `feTurbulence` の雑音をアルファへ写して、ところどころインクが乗り切って
 *   いない状態を作る。`seed` 属性があるので **完全に決定論** で、
 *   同じ個体なら毎回同じムラになる。
 *
 * 【やりすぎない】
 *   濃さを削りすぎると「汚い印」「読めない印」になる。
 *   `k` を負・`b` を 1 より少し上に置いて、**大半は不透明のまま、
 *   一部だけ薄くなる** 側へ寄せてある。箔（`strength` が小さい）は
 *   ほとんど均一で、圧着のムラ程度にしか出ない。
 */
function inkFilter(id: string, seed: number, strength: number): string {
  // strength 0..1 → 削る量。0.72（インクの上限）でも下地が透ける程度に留める。
  const k = -(0.5 + strength * 1.5);
  const b = 1 + (0.5 + strength * 1.5) * 0.62;
  return (
    `<filter id="${id}" x="-6%" y="-6%" width="112%" height="112%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="4" ` +
    `seed="${seed}" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" result="a" values="` +
    `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${n(k)} ${n(b)}"/>` +
    `<feComposite in="SourceGraphic" in2="a" operator="in"/>` +
    `</filter>`
  );
}

/** 内リングに沿った微細目盛り。長短の並びが証明書番号で変わる。 */
function registrationTicks(rng: Rng, radius: number, count: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    const len = rng.pick([1.4, 2.2, 3.0]);
    const x1 = CX + Math.cos(a) * radius;
    const y1 = CY + Math.sin(a) * radius;
    const x2 = CX + Math.cos(a) * (radius - len);
    const y2 = CY + Math.sin(a) * (radius - len);
    out.push(
      `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ` +
        `stroke="var(--seal-line)" stroke-width="0.42"/>`,
    );
  }
  return out.join('');
}

// ─────────────────────────────────────────────────────────
//  紋章
// ─────────────────────────────────────────────────────────

/**
 * 鑑定機関の紋章＝ゲノモンそのもの（卵と芽）。
 *
 * 既存の Certified シールで一度作り込んだ意匠をそのまま引き継ぐ。
 * ここを別の絵にすると「同じ機関の印」に見えなくなる。
 */
function emblem(): string {
  // 【縦位置の根拠】
  //   上弧の文字は半径 43（ベースライン y=17・字面は y=9..17）に乗る。
  //   芽の先を y=27 より上へ出すと文字とぶつかるので、卵は y=36..64、
  //   芽は y=27..36 に収めてある。下は罫（y=70.5）まで 6 空けている。
  return (
    `<g class="gmc-seal-emblem">` +
    `<path d="M60 36 C 69 44.5 72 53 69.7 59.5 C 67.8 65 64.2 67.3 60 67.3 C 55.8 67.3 52.2 65 50.3 59.5 ` +
    `C 48 53 51 44.5 60 36 Z" fill="none" stroke="var(--seal-ink)" stroke-width="2.1"/>` +
    `<path d="M60 36 V 29" fill="none" stroke="var(--seal-ink)" stroke-width="1.8"/>` +
    `<path d="M60 31.2 C 65 30.4 67.3 27.5 67 24 C 62.9 24.4 60.3 26.8 60 31.2 Z" fill="var(--seal-ink)"/>` +
    `</g>`
  );
}

// ─────────────────────────────────────────────────────────
//  印そのもの
// ─────────────────────────────────────────────────────────

/**
 * 認証印 1 つ。呼び出し側は `<div class="gmc-seal gmc-seal--<material>">` に
 * これを入れる（材質ごとの色は cardStyles.ts の CSS 変数が決める）。
 */
export function sealSvg(opts: SealOptions): string {
  const { material, certId, certifiedOn, uid, security, compact = false } = opts;
  const rng = new Rng(`${certId}#seal`);
  const foil = isFoil(material);
  const topId = `sealTop-${uid}`;
  const botId = `sealBot-${uid}`;

  const parts: string[] = [];

  // 押しムラは意匠全体に掛ける。文字だけ均一に残すと、
  // 「かすれた枠に印刷された文字」という別物に見える。
  const inkId = `sealInk-${uid}`;
  const useInk = Boolean(opts.ink && opts.ink.fade > 0);
  if (useInk) parts.push(`<defs>${inkFilter(inkId, opts.ink!.seed, opts.ink!.fade)}</defs>`);

  // ── 箔の地（medallion）──
  //   インク系は「紙に押した」なので地を持たない。箔系は面そのものが箔なので、
  //   円盤を敷いてから意匠を抜く。ここが素材の違いをいちばん強く語る。
  if (foil) {
    parts.push(`<circle cx="${CX}" cy="${CY}" r="58" fill="var(--seal-disc)"/>`);
    parts.push(`<circle cx="${CX}" cy="${CY}" r="58" fill="none" stroke="var(--seal-disc-edge)" stroke-width="1.4"/>`);
  }

  // ── 外周の二重リング ──
  // 外周だけ別の色を許す（inkFoil＝インクの意匠に、縁だけ箔を回す段）。
  parts.push(`<circle cx="${CX}" cy="${CY}" r="55.5" fill="none" stroke="var(--seal-ring)" stroke-width="1.9"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="52" fill="none" stroke="var(--seal-ring)" stroke-width="0.7"/>`);

  // ── 地紋（RARE 以上）──
  if (security > 0 && !compact) {
    // 【花弁は細かく・彫りは浅く】
    //   初版は花弁 7〜11・深さ 0.9〜1.2 で、印を大きくしたら
    //   放射状の線が目立って **クモの巣** に見えた（実物で確認）。
    //   紙幣の地紋がそうであるように、細かく浅くすると
    //   「精密に彫った下地」に見える。
    const g = `<g class="gmc-seal-guilloche" opacity="${n(0.26 + security * 0.24)}">`;
    const layers = security >= 0.9 ? 3 : security >= 0.6 ? 2 : 1;
    const rings: string[] = [];
    for (let i = 0; i < layers; i++) {
      rings.push(guilloche(rng, 45 - i * 5.5, 15 + i * 4 + rng.int(0, 3), 0.5 + i * 0.1));
    }
    parts.push(g + rings.join('') + `</g>`);
  }

  // ── 微細目盛り ──
  if (security > 0) {
    parts.push(
      `<g class="gmc-seal-ticks" opacity="${n(0.5 + security * 0.35)}">` +
        registrationTicks(rng, 50, compact ? 36 : 72) +
        `</g>`,
    );
  }

  // ── 弧に沿う文字 ──
  //   半径 45 の上弧・下弧。下弧は反時計回りに引いて、文字が正立するようにする。
  parts.push(
    `<defs>` +
      `<path id="${topId}" d="M ${CX - 43} ${CY} A 43 43 0 0 1 ${CX + 43} ${CY}" fill="none"/>` +
      `<path id="${botId}" d="M ${CX - 43} ${CY} A 43 43 0 0 0 ${CX + 43} ${CY}" fill="none"/>` +
      `</defs>`,
  );
  parts.push(
    `<text class="gmc-seal-arc gmc-seal-arc--top">` +
      `<textPath href="#${topId}" startOffset="50%" text-anchor="middle">GENOMON APPRAISAL OFFICE</textPath>` +
      `</text>`,
  );
  parts.push(
    `<text class="gmc-seal-arc gmc-seal-arc--bot">` +
      `<textPath href="#${botId}" startOffset="50%" text-anchor="middle">${certId}</textPath>` +
      `</text>`,
  );

  // ── 紋章と本文 ──
  parts.push(emblem());

  // 罫は MYTHIC だけ二重らせんになる（「よく見るとヤバい」の一つ）。
  // 縦の余白は取り合いなので、行を増やさず **同じ場所の意匠を差し替える**。
  if (security >= 0.9 && !compact) parts.push(helixBand(70.5, 44, 4));
  else parts.push(`<path d="M38 70.5 H82" stroke="var(--seal-ink)" stroke-width="0.6" opacity="0.8"/>`);

  parts.push(`<text class="gmc-seal-word" x="${CX}" y="79" text-anchor="middle">CERTIFIED</text>`);
  if (!compact) {
    parts.push(`<text class="gmc-seal-date" x="${CX}" y="88" text-anchor="middle">${certifiedOn}</text>`);
  }

  // defs は filter の外に出しておく（自分自身を掛けない）。
  const defs = useInk ? parts.shift()! : '';
  const body = useInk ? `<g filter="url(#${inkId})">${parts.join('')}</g>` : parts.join('');

  return (
    `<svg viewBox="0 0 ${S} ${S}" class="gmc-seal-svg" role="img" ` +
    `aria-label="鑑定機関の認証印 ${certId}">${defs}${body}</svg>`
  );
}

/**
 * カードに置く認証印の一式（印 + 箔の艶の層）。
 *
 * ホロ／金／銀は、印そのものが光らなければ素材が伝わらない。
 * 艶の層は CSS 側（`.gmc-seal-shine`）がポインタ位置に反応して動かす。
 * インク系ではこの層を作らない（紙に押したインクは光らない）。
 */
export function sealBlock(opts: SealOptions & { className?: string; stamp?: SealStamp }): string {
  const shine = isFoil(opts.material) ? `<span class="gmc-seal-shine" aria-hidden="true"></span>` : '';
  // 押されかたは CSS 変数で渡す。CSS 側が位置と回転を組み立てるので、
  // 版面（どこを基準に置くか）は cardStyles.ts の責務のまま保てる。
  const st = opts.stamp;
  const style = st
    ? ` style="--seal-rot:${n(st.rotate)}deg;--seal-x:${n(st.x)}%;--seal-y:${n(st.y)}%;` +
      `--seal-scale:${n(st.scale)};--seal-op:${n(st.opacity)}"`
    : '';
  return (
    `<div class="gmc-seal gmc-seal--${opts.material} ${opts.className ?? ''}" ` +
    `data-seal="${opts.material}"${style}>` +
    sealSvg(opts) +
    shine +
    `</div>`
  );
}

/** 印の SVG 内 id をぶつけないための短い uid。 */
export function sealUid(seed: string, slot: string): string {
  return `s${(hashString(`${seed}#seal:${slot}`) % 0xffffff).toString(36)}`;
}
