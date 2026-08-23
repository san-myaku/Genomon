/**
 * カード 1 枚の DOM を組み立て、`@kongyo2/cards-css` の設定を決める層。
 *
 * 【createHoloCard ではなく attachHoloCard を使う理由】
 *   `createHoloCard()` は「1 枚の画像 + 任意の overlay」という前提の DOM を
 *   自動で作る。ゲノモンのカードは画像ではなく **その場で組み立てた SVG と
 *   文字組み** なので、レイアウトを完全にこちらが握りたい。
 *   ライブラリが要求する骨格（`.holo-card__rotator` 以下）だけを自前で作り、
 *   `attachHoloCard()` で挙動（tilt / glare / shine / depth / layers）を後付けする。
 *
 * 【マークアップの制約（ライブラリ CSS 由来）】
 *   `.holo-card__rotator *` は全子孫に `display:grid; grid-area:1/1; overflow:hidden`
 *   を掛けるが、`.holo-card__content *` がそれを revert する。つまり
 *   **自分のレイアウトは必ず `.holo-card__content` の中に置く**。
 *
 * 【箔の掛けかた】
 *   全面レインボーにはしない。foil は mask で枠・ロゴ・段の帯・認証印に限定し、
 *   ゲノモン本体の上には置かない。**どこに掛けるかは段（rarity）が決める**
 *   （cardArt.ts の `collectorV2Mask`）。マスクの実体は cardArt.ts。
 *
 * ─────────────────────────────────────────────────────────
 * 【裏返しをライブラリの `.holo-card__back` でやらない理由】
 *   ライブラリの `.holo-card__back` は「読み込み中に見せる裏地の画像」で、
 *   `backface-visibility: visible` が当たっている。裏返し用の面ではない。
 *   ここでは `.holo-card` の **外側** に 3D の器（`.gmc-flip`）を作り、
 *   表と裏に独立した `.holo-card` を 1 枚ずつ入れる。こうすると
 *   ライブラリの傾き・箔がどちらの面でもそのまま効く。
 *
 *   裏面は **最初に裏返した瞬間まで作らない**。Showcase 以外では
 *   そもそも器ごと作らないので、一覧 30 枚が二重の DOM を持つことはない（§22）。
 * ─────────────────────────────────────────────────────────
 */

import {
  HOLO_EFFECTS,
  attachHoloCard,
  generateTextures,
  paletteToCssVariables,
  texturesToCssVariables,
  type HoloCard,
  type HoloCardOptions,
  type HoloEffect,
  type HoloLayerOptions,
  type PaletteOptions,
} from '@kongyo2/cards-css';

import type { Genotype, Phenotype } from '../core/types.ts';
import { hslToHex, mix } from '../core/color.ts';
import { esc } from '../ui/dom.ts';
import {
  artHoleMaskUri,
  collectorBackdropUri,
  dnaPatternUri,
  foilMaskUri,
  paperGrainUri,
  pedigreeSvg,
  qrPlaceholderSvg,
} from './cardArt.ts';
import { cardBackHtml } from './cardBack.ts';
import type { LabCardHistory } from './cardHistory.ts';
import {
  CARD_DESIGN_BY_ID,
  CARD_FINISH_BY_ID,
  type CardDesign,
  type CardFacts,
  type CardFinish,
  type CardQuality,
} from './cardModel.ts';
import { pipHtml, type RankTreatment, type SealMaterial } from './cardRarity.ts';
import { sealBlock, sealUid } from './cardSeal.ts';

// ─────────────────────────────────────────────────────────
//  設定
// ─────────────────────────────────────────────────────────

/** 見た目のつまみ（Cards Lab の Visual controls がそのままこの形になる）。 */
export interface CardVisuals {
  /** 箔の強さ 0..1.5。 */
  foil: number;
  /** 映り込みの強さ 0..1.5。 */
  glare: number;
  /** 傾きの強さ 0..1.5。 */
  tilt: number;
  /** 箔の 3D 押し出し。 */
  depth: boolean;
  /** foil マスク（部位ごとの箔）を使うか。切ると「全面ベタ箔」の悪例が見られる。 */
  mask: boolean;
  /** セキュリティ模様（DNA）を出すか。 */
  security: boolean;
}

export const DEFAULT_VISUALS: CardVisuals = {
  foil: 1,
  glare: 1,
  tilt: 1,
  depth: true,
  mask: true,
  security: true,
};

export interface CardSpec {
  pheno: Phenotype;
  /**
   * 裏面の遺伝欄で使う。**本編とまったく同じ計算**（`deriveGeneticReportOf`）を
   * 通すので、裏面の遺伝情報だけはダミーにならない。
   */
  genotype: Genotype;
  facts: CardFacts;
  /** Lab 専用の仮の経歴（親・展示・発行番号）。 */
  history: LabCardHistory;
  /** 解決済みの段（強制表示なら forced が立つ）。 */
  rank: RankTreatment;
  design: CardDesign;
  finish: CardFinish;
  quality: CardQuality;
  /** 既に描き終えたゲノモンの SVG 文字列（gen.ts の drawSpecimen 出力）。 */
  creatureSvg: string;
  visuals: CardVisuals;
  /**
   * 仕上げを段（AUTO）から決めたのか、人が明示的に選んだのか。
   *
   * 【なぜ要るか — Finish 比較が全部まっ黒になった】
   *   段が箔の総量を決める設計にしたので、STANDARD の個体では
   *   `rank.def.foil === 0`。ところがそれを一律に掛けると、
   *   **Prism を明示的に選んでも何も光らない**。仕上げを見比べる場が
   *   成立しなくなる。明示指定のときは下限を持たせる。
   */
  finishFromRank: boolean;
  /** 認証印の素材。'auto' は段が決める。 */
  sealStyle: SealMaterial | 'auto';
  /** 裏返せるようにするか（Showcase だけ true）。 */
  flippable: boolean;
}

/** デザインごとの紙とインク。カード内部だけで完結する配色。 */
interface Skin {
  paper: string;
  paper2: string;
  ink: string;
  inkSoft: string;
  rule: string;
  metal: string;
  metalDim: string;
  /** ゲノモンを置く窓の地色。 */
  window: string;
  /** 紙の繊維の色。 */
  grain: string;
}

const SKINS: Readonly<Record<CardDesign, Skin>> = {
  certified: {
    paper: '#f7f1e3',
    paper2: '#efe6d2',
    ink: '#38302a',
    inkSoft: '#8a7c6a',
    rule: '#c9b9a8',
    metal: '#b6923f',
    metalDim: '#e3d0a0',
    window: '#fdf9ef',
    grain: '#6b5a44',
  },
  natural: {
    paper: '#e9e0c8',
    paper2: '#ddd2b4',
    ink: '#2c3a38',
    inkSoft: '#6e7d76',
    rule: '#9aa89c',
    metal: '#9c7434',
    metalDim: '#cdb07a',
    window: '#f2ecd8',
    grain: '#4a5a52',
  },
  collector: {
    paper: '#0c0a12',
    paper2: '#141021',
    ink: '#f2ecff',
    inkSoft: '#9b90b8',
    rule: '#3a3150',
    metal: '#d8c9ff',
    metalDim: '#6a5c92',
    window: '#0f0c18',
    grain: '#b7a8e0',
  },
  // v2 は旧 Collector より「黒」に寄せる。紫に寄せると全個体が同じ紫の
  // カードに見えるため、地色は個体の体色から作る（holoOptionsFor 参照）。
  collectorV2: {
    paper: '#08070c',
    paper2: '#0e0c14',
    ink: '#f4f0ff',
    inkSoft: '#a096bb',
    rule: '#332c46',
    metal: '#e2d6ff',
    metalDim: '#6d5f95',
    window: '#0a0810',
    grain: '#bcaee6',
  },
};

// ─────────────────────────────────────────────────────────
//  foil の色（個体の配色から作る）
// ─────────────────────────────────────────────────────────

/** 分光系の foil。ここだけ個体の色相からスペクトルを組み直す。 */
const SPECTRAL: ReadonlySet<string> = new Set(['holo', 'prism', 'aurora', 'cosmos', 'rainbow', 'oilslick', 'radiant', 'reverse']);

/**
 * 箔の色を個体の配色に寄せる。
 *
 * 何もしないと、どの個体も同じ既定の虹色になり「その子のカード」に見えない。
 * 色相をその子の hue から等間隔にずらして 6 本のスペクトルを作ると、
 * 箔の光まで血統の色になる。gold / metal / crystal のような
 * 「素材そのものが決まっている」箔にはスペクトルを渡さない。
 */
function foilPalette(pheno: Phenotype, finish: CardFinish): PaletteOptions {
  const { h, s } = pheno.palette.hsl;
  const out: PaletteOptions = {
    edge: pheno.palette.accent,
    glow: pheno.palette.glow,
  };
  const effect = CARD_FINISH_BY_ID[finish].effect;
  if (!SPECTRAL.has(effect)) return out;

  const sat = Math.min(96, Math.max(62, s + 34));
  out.sunpillars = [0, 58, 118, 176, 236, 296].map((d) => hslToHex((h + d) % 360, sat, 72));
  out.spectrum = [0, 72, 144, 216, 288].map((d) => hslToHex((h + d) % 360, sat, 66));
  out.cosmos = [0, 40, 90, 150, 215, 280].map((d, i) => hslToHex((h + d) % 360, sat, 30 + i * 9));
  return out;
}

// ─────────────────────────────────────────────────────────
//  ライブラリ設定
// ─────────────────────────────────────────────────────────

function toEffect(finish: CardFinish): HoloEffect {
  const id = CARD_FINISH_BY_ID[finish].effect;
  return ((HOLO_EFFECTS as readonly string[]).includes(id) ? id : 'none') as HoloEffect;
}

/**
 * デザインごとの箔の遠慮。
 * Certified と Natural History は「証明書」なので、箔は罫線の艶どまり。
 * Collector 系だけ強めてよい。
 */
const DESIGN_FOIL_SCALE: Readonly<Record<CardDesign, number>> = {
  certified: 0.46,
  natural: 0.38,
  collector: 0.7,
  collectorV2: 0.8,
};

const isCollector = (d: CardDesign): boolean => d === 'collector' || d === 'collectorV2';

/** その段で実際に使う認証印の素材。 */
export function sealMaterialOf(spec: CardSpec): SealMaterial {
  return spec.sealStyle === 'auto' ? spec.rank.def.seal : spec.sealStyle;
}

/** Cards Lab で組み立てた設定を、ライブラリの options へ翻訳する。 */
export function holoOptionsFor(spec: CardSpec, face: 'front' | 'back' = 'front'): HoloCardOptions {
  const { design, finish, quality, visuals, facts, pheno, rank } = spec;
  const def = CARD_FINISH_BY_ID[finish];
  const skin = SKINS[design];
  const full = quality === 'full';
  const medium = quality === 'medium';
  const v2 = design === 'collectorV2';

  // 段が箔の総量そのものを決める。AUTO のままなら STANDARD は 0 で、
  // つまみを最大にしても光らない（「段で素材が変わる」ことを、つまみで壊せない）。
  // 人が仕上げを選んだときだけ下限を持たせる（そうしないと Finish 比較が
  // まっ黒な 6 枚になり、比べられない）。
  const rankFoil = !v2 ? 1 : spec.finishFromRank ? rank.def.foil : Math.max(0.45, rank.def.foil);
  // 裏面は「読む面」。箔は縁と印だけに留めて、本文のコントラストを守る。
  const faceScale = face === 'back' ? 0.55 : 1;
  const foilAmount = def.strength * DESIGN_FOIL_SCALE[design] * visuals.foil * rankFoil * faceScale;

  const securityAmount = v2 ? rank.def.security : 1;

  const layers: HoloLayerOptions[] = [];
  if (visuals.security && quality !== 'lite' && securityAmount > 0) {
    layers.push({
      image: dnaPatternUri(facts.certId, isCollector(design) ? skin.metal : skin.ink),
      mask: artHoleMaskUri(face === 'back' ? 'certified' : design),
      blend: isCollector(design) ? 'screen' : 'multiply',
      opacity: (isCollector(design) ? 0.5 : 0.34) * (v2 ? 0.35 + securityAmount * 0.75 : 1),
      parallax: full ? 10 : 4,
      className: 'holo-card__layer--dna',
    });
  }

  // 【Collector の地色は個体ごとに変える】
  //   最初は真っ黒を全個体で共有し、上に紫の光だけを固定で置いていた。
  //   その結果、**茶色い個体も紫の個体も同じ紫の背景**になり、
  //   「その子のカード」に見えなかった（Collector は文字が最小限なので、
  //   個体らしさを背負えるのが絵と地色しかない）。
  //   ほぼ黒のまま、体色の方向へわずかに寄せる。
  //   v2 では寄せかたを旧 Collector より弱くしてある。製品オーナーの好みは
  //   「黒〜非常に暗い背景」で、明るい体色の個体（黄緑・淡橙）だと 0.34 では
  //   地色が中間色まで持ち上がり、黒いカードに見えなくなる。
  const paper = isCollector(design) ? mix(skin.paper, pheno.palette.bodyDark, v2 ? 0.2 : 0.34) : skin.paper;
  const paper2 = isCollector(design) ? mix(skin.paper2, pheno.palette.body, v2 ? 0.1 : 0.16) : skin.paper2;

  const opts: HoloCardOptions = {
    effect: toEffect(finish),
    aspectRatio: 63 / 88,
    // 【なぜ medium も interactive:false なのか — 比較が成立しなかった】
    //   ライブラリは --card-opacity を 0 から始め、ポインタが乗ったときだけ
    //   箔を出す。しかも interactive なカードは休止中も毎フレームの結果を
    //   **インラインスタイル**で書くので、CSS で「静止時の箔」を与えられない。
    //   その結果、Finish 比較の 6 枚が 6 枚とも同じ絵に見えた。
    //   interactive を切ると、ライブラリは静止時にインライン変数を捨てて
    //   純 CSS のフォールバックへ譲る。こちらが cardStyles.ts で固定の
    //   ポインタ位置を与えれば、6 枚が最初から別々の箔で並ぶ。
    interactive: full,
    // 【裏返しと取り合いになるので切る】
    //   activateOnClick はクリックで「拡大鑑賞」状態に入る機能。
    //   Showcase のクリックは裏返しに使うので、両方は付けられない。
    activateOnClick: full && !spec.flippable,
    // ジャイロは Showcase の 1 枚だけ。比較の 3〜6 枚すべてが端末の傾きで
    // 動くと、目で比べたい差がモーションに埋もれる。
    gyroscope: full,
    showcase: false,
    textureSeed: facts.textureSeed,
    glow: pheno.palette.glow,
    palette: foilPalette(pheno, finish),
    visual: {
      shineOpacity: foilAmount,
      glareOpacity: (isCollector(design) ? 0.8 : 0.34) * visuals.glare * (face === 'back' ? 0.6 : 1),
      saturate: isCollector(design) ? 1.05 : 0.86,
      brightness: isCollector(design) ? 1 : 0.92,
      contrast: isCollector(design) ? 1 : 0.95,
    },
    // 【最後の stop は必ず透明で終わらせる — 矩形の段差が出た】
    //   以前は `hsla(0,0%,0%,.55) 92%` で終わっていた。92% より外側は
    //   その色のまま element の縁まで続くので、**glare の箱の縁が
    //   そのままカードの上に矩形の継ぎ目として見えていた**
    //   （depth の視差で glare がカードより内側へずれると、絵の真ん中に出る）。
    //   暗い縁取り（vignette）は残したいので、暗い stop の外側へ
    //   透明な stop を 1 つ足して、縁に届く前に消えるようにする。
    glare: {
      shape: 'ellipse',
      size: isCollector(design) ? '80% 60%' : '65% 45%',
      stops:
        isCollector(design)
          ? ['hsla(0,0%,100%,.72) 8%', 'hsla(0,0%,100%,.34) 26%', 'hsla(0,0%,0%,.5) 78%', 'hsla(0,0%,0%,0) 100%']
          : ['hsla(42,60%,100%,.5) 10%', 'hsla(0,0%,100%,.22) 30%', 'hsla(0,0%,0%,.3) 80%', 'hsla(0,0%,0%,0) 100%'],
      blend: 'soft-light',
    },
    physics: {
      maxTilt: (isCollector(design) ? 15 : 11) * visuals.tilt,
      parallax: full ? 1 : 0.5,
      glareRange: 1,
    },
    vars: {
      '--gmc-paper': paper,
      '--gmc-paper2': paper2,
      '--gmc-ink': skin.ink,
      '--gmc-ink-soft': skin.inkSoft,
      '--gmc-rule': skin.rule,
      '--gmc-metal': skin.metal,
      '--gmc-metal-dim': skin.metalDim,
      '--gmc-window': isCollector(design) ? paper : skin.window,
      '--gmc-accent': pheno.palette.accent,
      '--gmc-glow': pheno.palette.glow,
      '--gmc-body': pheno.palette.body,
      '--gmc-grain': `url("${paperGrainUri(design, skin.grain)}")`,
      '--gmc-backdrop': `url("${collectorBackdropUri(pheno)}")`,
      '--gmc-backdrop-amount': String(v2 ? rank.def.backdrop : 1),
    },
  };

  if (visuals.mask && def.effect !== 'none') {
    opts.mask = { image: foilMaskUri(design, rank.def), size: '100% 100%', mode: 'shine' };
  }
  if (layers.length) opts.layers = layers;
  if (visuals.depth && (full || medium)) {
    opts.depth = {
      strength: full ? 13 : 7,
      perspective: 640,
      shadow: isCollector(design) ? 0.45 : 0.3,
      layerScale: 0.8,
    };
  }
  return opts;
}

// ─────────────────────────────────────────────────────────
//  DOM
// ─────────────────────────────────────────────────────────

function cardShell(spec: CardSpec, face: 'front' | 'back', inner: string): HTMLElement {
  const root = document.createElement('div');
  root.className = `holo-card gmc-card gmc-card--${spec.design} gmc-q-${spec.quality} gmc-face--${face}`;
  root.dataset.effect = toEffect(spec.finish);
  root.dataset.seed = spec.facts.seed;
  root.dataset.design = spec.design;
  root.dataset.finish = spec.finish;
  root.dataset.rank = spec.rank.def.id;
  root.dataset.seal = sealMaterialOf(spec);
  root.dataset.face = face;

  root.innerHTML =
    `<div class="holo-card__translater"><div class="holo-card__rotator">` +
    `<div class="holo-card__front">` +
    `<div class="holo-card__content">${inner}</div>` +
    `<div class="holo-card__shine"></div>` +
    `<div class="holo-card__glare"></div>` +
    `</div></div></div>`;

  return root;
}

/**
 * ライブラリが要求する骨格 + 自前のレイアウトを持つ `.holo-card` を作る。
 * JS は付けない（`attachHoloCard` するかどうかは呼び出し側が品質で決める）。
 */
export function buildCardElement(spec: CardSpec): HTMLElement {
  return cardShell(spec, 'front', cardFrontHtml(spec));
}

/**
 * lite（一覧）用に、ライブラリの JS を付けずに見た目だけ揃える。
 *
 * `attachHoloCard` は effect ごとの CSS 変数（生成テクスチャ・パレット）を
 * 実行時に流し込む。lite ではその JS を動かさないので、
 * **同じ変数を静的に置いて** 30 枚ぶんのイベント購読を作らずに済ませる。
 */
export function applyStaticCardVars(root: HTMLElement, spec: CardSpec, face: 'front' | 'back' = 'front'): void {
  const opts = holoOptionsFor(spec, face);
  const vars: Record<string, string> = {
    ...texturesToCssVariables(generateTextures({ seed: spec.facts.textureSeed })),
    ...paletteToCssVariables(opts.palette ?? {}),
  };
  for (const [k, v] of Object.entries(opts.vars ?? {})) vars[k] = String(v);
  vars['--card-aspect'] = String(63 / 88);
  vars['--card-glow'] = spec.pheno.palette.glow;
  vars['--hc-shine-opacity'] = String(opts.visual?.shineOpacity ?? 1);
  vars['--hc-glare-opacity'] = String(opts.visual?.glareOpacity ?? 1);
  vars['--hc-saturate'] = String(opts.visual?.saturate ?? 1);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);

  if (opts.mask && typeof opts.mask === 'object' && opts.mask.image) {
    root.style.setProperty('--mask', `url("${opts.mask.image}")`);
    root.style.setProperty('--mask-size', '100% 100%');
    root.classList.add('holo-card--masked');
  }
}

export interface MountedCard {
  /** 器（裏返せるカードでは `.gmc-flip`、それ以外は `.holo-card` そのもの）。 */
  element: HTMLElement;
  /** lite のときは null（ライブラリの JS を動かさない）。 */
  card: HoloCard | null;
  /** 裏返す（裏面はここで初めて作られる）。裏返せないカードでは何もしない。 */
  flip(to?: 'front' | 'back'): void;
  face(): 'front' | 'back';
  destroy(): void;
}

/**
 * 1 枚ぶんを組み立てて、品質に応じて挙動を付ける。
 *
 * `spec.flippable` が立っているときだけ 3D の器で包む。包まない場合の
 * `element` は今までどおり `.holo-card` そのものなので、比較・一覧側の
 * レイアウト（`.cards-slot-card > .holo-card`）は変わらない。
 */
export function mountCard(spec: CardSpec): MountedCard {
  const front = buildCardElement(spec);
  const attach = (el: HTMLElement, face: 'front' | 'back'): HoloCard | null => {
    if (spec.quality === 'lite') {
      applyStaticCardVars(el, spec, face);
      return null;
    }
    return attachHoloCard(el, holoOptionsFor(spec, face));
  };

  const frontCard = attach(front, 'front');

  if (!spec.flippable) {
    return {
      element: front,
      card: frontCard,
      flip() {
        /* 裏返せないカード（比較・一覧）。呼ばれても何もしない。 */
      },
      face: () => 'front',
      destroy() {
        frontCard?.destroy();
        front.remove();
      },
    };
  }

  // ── 裏返せるカード ──
  const wrap = document.createElement('div');
  wrap.className = 'gmc-flip';
  wrap.dataset.face = 'front';

  const inner = document.createElement('button');
  inner.type = 'button';
  inner.className = 'gmc-flip-inner';
  inner.setAttribute('aria-pressed', 'false');
  inner.setAttribute('aria-label', 'カードを裏返す');

  const frontFace = document.createElement('div');
  frontFace.className = 'gmc-flip-face gmc-flip-face--front';
  frontFace.appendChild(front);

  const backFace = document.createElement('div');
  backFace.className = 'gmc-flip-face gmc-flip-face--back';

  inner.append(frontFace, backFace);
  wrap.appendChild(inner);

  let backCard: HoloCard | null = null;
  let backEl: HTMLElement | null = null;
  let face: 'front' | 'back' = 'front';

  /** 裏面は「初めて裏返した瞬間」に作る（§22）。 */
  const ensureBack = (): void => {
    if (backEl) return;
    backEl = cardShell(spec, 'back', cardBackHtml(spec));
    backFace.appendChild(backEl);
    backCard = attach(backEl, 'back');
  };

  const setFace = (next: 'front' | 'back'): void => {
    if (next === 'back') ensureBack();
    face = next;
    wrap.dataset.face = next;
    inner.setAttribute('aria-pressed', next === 'back' ? 'true' : 'false');
    inner.setAttribute('aria-label', next === 'back' ? 'カードを表に戻す' : 'カードを裏返す');
  };

  const onClick = (): void => setFace(face === 'front' ? 'back' : 'front');
  inner.addEventListener('click', onClick);

  return {
    element: wrap,
    card: frontCard,
    flip(to) {
      setFace(to ?? (face === 'front' ? 'back' : 'front'));
    },
    face: () => face,
    destroy() {
      inner.removeEventListener('click', onClick);
      frontCard?.destroy();
      backCard?.destroy();
      wrap.remove();
    },
  };
}

// ─────────────────────────────────────────────────────────
//  カード表面のレイアウト
// ─────────────────────────────────────────────────────────

function cardFrontHtml(spec: CardSpec): string {
  const inner =
    spec.design === 'collectorV2'
      ? collectorV2Front(spec)
      : spec.design === 'certified'
        ? certifiedFront(spec)
        : spec.design === 'natural'
          ? naturalFront(spec)
          : collectorFront(spec);
  return `<div class="gmc gmc--${spec.design}">${inner}</div>`;
}

/** ゲノモンの窓。共通の中身（枠の飾りだけ差し替える）。 */
function artWindow(spec: CardSpec, extra = ''): string {
  return (
    `<div class="gmc-art">` +
    `<div class="gmc-art-bg"></div>` +
    extra +
    `<div class="gmc-art-inner">${spec.creatureSvg}</div>` +
    `</div>`
  );
}

/**
 * カードに刷るフレーバー。
 *
 * 【lite では作らない】
 *   一覧は 8〜30 枚を静止画として並べる場所で、そこでは 3〜4px の文字になり
 *   読めない。読めない文字のために DOM を 30 枚ぶん増やさない。
 *
 * 【1 行に押し込めない】
 *   以前は `white-space:nowrap` で 1 行に収め、あふれたら三点リーダで
 *   切っていた。文の途中で切れると「意味ありげな一文」ではなく
 *   「入りきらなかった文字列」に見える。2 行まで許して、収まる長さで組む。
 */
function flavorBlock(spec: CardSpec): string {
  if (spec.quality === 'lite') return '';
  const f = spec.facts.flavor;
  return (
    `<div class="gmc-flavor">` +
    `<b>${esc(f.kind)}</b>` +
    `<span>${esc(f.text)}</span>` +
    `</div>`
  );
}

function qrBlock(facts: CardFacts, ink: string, paper: string): string {
  return (
    `<div class="gmc-qr" title="${esc(facts.qrPayload)}（QR 風プレースホルダ・実 URL 未接続）">` +
    qrPlaceholderSvg(facts.qrPayload, ink, paper) +
    `</div>`
  );
}

/**
 * Certified の丸い認証シール（旧デザイン用）。
 *
 * 最初は二重らせんを重ねた意匠にしたが、線が交差して **✗（バツ印）に見え**、
 * 「不合格」の記号として読めてしまった。鑑定証の印なので、
 * ゲノモンそのもの（卵と芽）を型どった紋に差し替えてある。
 */
function sealSvg(): string {
  return (
    `<svg viewBox="0 0 48 48" class="gmc-seal-svg" aria-hidden="true">` +
    `<circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
    `<circle cx="24" cy="24" r="18.5" fill="none" stroke="currentColor" stroke-width="0.7" stroke-dasharray="1.6 2.4"/>` +
    // 卵
    `<path d="M24 15 C 30 21 32 27 30.5 31.5 C 29.2 35.4 26.8 37 24 37 C 21.2 37 18.8 35.4 17.5 31.5 C 16 27 18 21 24 15 Z" ` +
    `fill="none" stroke="currentColor" stroke-width="1.6"/>` +
    // 芽
    `<path d="M24 15 V 10" fill="none" stroke="currentColor" stroke-width="1.4"/>` +
    `<path d="M24 11.6 C 27.4 11 29 9 28.8 6.6 C 26 6.9 24.2 8.6 24 11.6 Z" fill="currentColor"/>` +
    // 左右の小さな点（封蝋の押し跡）
    `<circle cx="12.5" cy="24" r="1.1" fill="currentColor"/>` +
    `<circle cx="35.5" cy="24" r="1.1" fill="currentColor"/>` +
    `</svg>`
  );
}

// ── Design A: Collector v2（本命）─────────────────────────

/**
 * 【表は「読む資料」ではなく「見るカード」（§5）】
 *   主役はゲノモン。文字を足しても絵を小さくしない。窓は上から 62% までを
 *   占め、下の情報欄は 4 行に収まる高さしか取らない。
 *
 * 【視線の順序（§9）】
 *   ゲノモン → 段（名前・点数・記号）→ 認証印 → 名前とメタ →
 *   最後にフレーバー。フレーバーは左下・小さく・2 行まで。
 *
 * 【表に出さないもの（§5）】
 *   全遺伝子座・ホモ/ヘテロ・保因・詳細血統・交配記録は裏面（cardBack.ts）。
 *   ここに出るのは **姿から読める特徴** と、鑑定で確定した格だけ。
 */
function collectorV2Front(spec: CardSpec): string {
  const f = spec.facts;
  const h = spec.history;
  const rank = spec.rank;
  const lite = spec.quality === 'lite';
  // 特徴は 2〜4 個。多いほど賑やかになるが、5 個目からは版面が濁る。
  const traits = f.headlineTraits.slice(0, 4);

  const seal = lite
    ? ''
    : `<div class="gmc-v-seal">` +
      sealBlock({
        material: sealMaterialOf(spec),
        certId: f.certId,
        certifiedOn: h.certifiedOn,
        uid: sealUid(f.seed, `v2-${spec.quality}`),
        security: rank.def.security,
        compact: spec.quality === 'medium',
      }) +
      `</div>`;

  return (
    `<div class="gmc-paper"></div>` +
    // 背景と後光は **カード全面** に敷く。窓の中だけに入れると、
    // 光の帯が窓の縁でぷつりと切れて「絵を貼った板」に見えてしまう。
    `<div class="gmc-k-backdrop"></div><div class="gmc-k-halo"></div>` +
    `<div class="gmc-k-scrim"></div>` +
    `<div class="gmc-v-edge" aria-hidden="true"></div>` +
    `<div class="gmc-body">` +
    `<header class="gmc-v-rail">` +
    `<div class="gmc-wordmark">GENOMON</div>` +
    `<div class="gmc-v-pips" role="img" aria-label="希少度 ${esc(rank.def.label)}">${pipHtml(rank.def)}</div>` +
    `</header>` +
    artWindow(spec) +
    `<div class="gmc-v-info">` +
    // ── 段の帯。ここだけで「一瞬で格が分かる」ことを担保する ──
    `<div class="gmc-v-band gmc-v-band--${rank.def.band}">` +
    `<b class="gmc-v-rankname">${esc(rank.def.label)}</b>` +
    `<span class="gmc-v-score">${rank.score.toFixed(1)}</span>` +
    `</div>` +
    `<div class="gmc-v-name">${esc(f.code)}<em>${esc(f.name)}</em></div>` +
    (traits.length
      ? `<div class="gmc-v-traits">${traits.map((t) => `<span>${esc(t)}</span>`).join('')}</div>`
      : `<div class="gmc-v-traits gmc-v-traits--none"><span>${esc(f.baseLabel)}・${esc(f.paletteLabel)}</span></div>`) +
    `<div class="gmc-v-meta">` +
    `<span><b>GEN</b>${esc(h.generationRoman)}</span>` +
    `<span><b>GRADE</b>${f.grade}</span>` +
    `<span><b>NO.</b>${esc(h.print.text)}</span>` +
    `</div>` +
    // 【印は情報欄の *中* に置く】
    //   外に出すと、位置決めの基準が `.gmc`（カード全面）になり、
    //   絵の高さが個体ごとに動くたびに印が飛ぶ（実測で card の外へ出ていた）。
    //   情報欄が右 23% を空けてあるので、その柱に収まる。
    seal +
    `</div>` +
    `<footer class="gmc-v-foot">` +
    flavorBlock(spec) +
    `<span class="gmc-v-cert">${esc(f.certId)}</span>` +
    `</footer>` +
    `</div>`
  );
}

// ── Design B: Certified ───────────────────────────────────

function certifiedFront(spec: CardSpec): string {
  const f = spec.facts;
  const h = spec.history;
  const skin = SKINS.certified;
  const spec3 = [
    { k: 'PATTERN', v: f.lines[0]?.value ?? '—', ja: f.lines[0]?.valueJa ?? '' },
    { k: 'LINEAGE', v: f.lineage, ja: f.paletteLabel },
    { k: 'RARITY', v: spec.rank.score.toFixed(1), ja: spec.rank.def.label },
  ];

  return (
    `<div class="gmc-paper"></div>` +
    `<div class="gmc-frame"></div>` +
    `<div class="gmc-body">` +
    `<header class="gmc-c-head">` +
    `<div class="gmc-c-title"><div class="gmc-wordmark">GENOMON</div>` +
    `<div class="gmc-c-sub">${esc(CARD_DESIGN_BY_ID.certified.subtitle)}</div></div>` +
    `<div class="gmc-c-seal">${sealSvg()}</div>` +
    `</header>` +
    `<div class="gmc-c-id">` +
    `<div class="gmc-c-name">${esc(f.code)}<em>${esc(f.name)}</em></div>` +
    `<div class="gmc-c-cert">${esc(f.certId)}</div>` +
    `</div>` +
    artWindow(spec, `<div class="gmc-ticks"><i></i><i></i><i></i><i></i></div>`) +
    `<div class="gmc-c-grade">` +
    `<div class="gmc-c-gradebox"><span>${f.grade}</span></div>` +
    `<div class="gmc-c-gradetext"><b>GRADE</b><span>${esc(f.gradeWord)}</span></div>` +
    // Grade の右側が大きく空いて版面が間延びしていたので、通し番号を置いた。
    `<div class="gmc-c-gradetext gmc-c-print"><b>PRINT</b><span>${esc(h.print.text)}</span></div>` +
    `<div class="gmc-c-tier">${esc(spec.rank.def.label)}</div>` +
    `</div>` +
    `<div class="gmc-c-spec">` +
    spec3
      .map(
        (s) =>
          `<div><b>${esc(s.k)}</b><span>${esc(s.v)}</span><em>${esc(s.ja)}</em></div>`,
      )
      .join('') +
    `</div>` +
    flavorBlock(spec) +
    `<footer class="gmc-c-foot">` +
    `<div class="gmc-c-foottext"><b>GENOMON CERTIFIED</b>` +
    `<span>${esc(h.certifiedOn)} · GEN ${esc(h.generationRoman)} · ${esc(f.baseLabel)}</span></div>` +
    qrBlock(f, skin.ink, skin.window) +
    `</footer>` +
    `</div>`
  );
}

// ── Design C: Natural History ─────────────────────────────

function naturalFront(spec: CardSpec): string {
  const f = spec.facts;
  const h = spec.history;
  const skin = SKINS.natural;
  const notable = f.notableTraits.slice(0, 2);
  const carrier = f.carriers[0] ?? null;
  const best = h.bestShow;

  return (
    `<div class="gmc-paper"></div>` +
    `<div class="gmc-frame"></div>` +
    `<div class="gmc-body">` +
    `<header class="gmc-n-head">` +
    `<div class="gmc-wordmark">GENOMON</div>` +
    `<div class="gmc-n-sub">${esc(CARD_DESIGN_BY_ID.natural.subtitle)}</div>` +
    `</header>` +
    `<div class="gmc-n-id">` +
    `<div class="gmc-n-name">${esc(f.code)}<em>${esc(f.name)}</em></div>` +
    `<div class="gmc-n-no">No. ${esc(h.print.text)}</div>` +
    `</div>` +
    artWindow(
      spec,
      `<div class="gmc-brackets"><i></i><i></i><i></i><i></i></div>` +
        `<div class="gmc-scale"><i></i><span>10 mm</span></div>`,
    ) +
    `<div class="gmc-n-meta">` +
    `<div><b>GENERATION</b><span>${esc(h.generationRoman)}</span></div>` +
    `<div><b>GRADE</b><span>${f.grade}</span></div>` +
    `<div><b>RARITY</b><span>${spec.rank.score.toFixed(1)}</span></div>` +
    `</div>` +
    `<section class="gmc-n-sec">` +
    `<h4>PEDIGREE</h4>` +
    `<div class="gmc-n-ped">` +
    `<div class="gmc-n-parents"><span>${esc(h.parents[0].code)}</span><span>${esc(h.parents[1].code)}</span></div>` +
    pedigreeSvg(skin.ink, spec.pheno.palette.accent) +
    `<b class="gmc-n-child">${esc(f.code)}</b>` +
    `<span class="gmc-n-house">HOUSE OF ${esc(f.lineage)}</span>` +
    `</div>` +
    `</section>` +
    `<section class="gmc-n-sec">` +
    `<h4>PHENOTYPE</h4>` +
    `<dl class="gmc-n-dl">` +
    f.lines
      .map(
        (l) =>
          `<dt>${esc(l.key)}</dt><dd${l.notable ? ' class="on"' : ''}>${esc(l.value)}` +
          // 英字と同じ内容（どちらも「—」）を 2 度出さない
          (l.valueJa && l.valueJa !== l.value ? `<em>${esc(l.valueJa)}</em>` : '') +
          `</dd>`,
      )
      .join('') +
    (carrier ? `<dt>CARRIER</dt><dd class="ja">${esc(carrier)}</dd>` : '') +
    (notable.length ? `<dt>NOTABLE</dt><dd class="ja">${esc(notable.join(' / '))}</dd>` : '') +
    `</dl>` +
    `</section>` +
    `<section class="gmc-n-sec gmc-n-last">` +
    `<h4>SHOW RECORD</h4>` +
    (best
      ? `<p class="gmc-n-show"><b>${esc(best.place)}</b>` +
        `<span>${esc(best.event)} · ${best.year}</span></p>`
      : `<p class="gmc-n-show gmc-n-none"><span>NO RECORD ON FILE</span></p>`) +
    `</section>` +
    flavorBlock(spec) +
    `<footer class="gmc-n-foot">` +
    `<div class="gmc-n-strip"><span>${esc(f.certId)}</span><i></i></div>` +
    qrBlock(f, skin.ink, skin.window) +
    `</footer>` +
    `</div>`
  );
}

// ── Design D: Legacy Collector（比較用に残す）──────────────

function collectorFront(spec: CardSpec): string {
  const f = spec.facts;
  const h = spec.history;
  return (
    `<div class="gmc-paper"></div>` +
    `<div class="gmc-k-backdrop"></div><div class="gmc-k-halo"></div>` +
    `<div class="gmc-k-scrim"></div>` +
    `<div class="gmc-body">` +
    `<header class="gmc-k-rail">` +
    `<div class="gmc-wordmark">GENOMON</div>` +
    `<div class="gmc-k-stamp">${esc(CARD_FINISH_BY_ID[spec.finish].stamp)}</div>` +
    `</header>` +
    artWindow(spec) +
    `<div class="gmc-k-info">` +
    flavorBlock(spec) +
    `<div class="gmc-k-name">${esc(f.code)}<em>${esc(f.name)}</em></div>` +
    `<div class="gmc-k-rule"></div>` +
    `<div class="gmc-k-stats">` +
    `<div><b>RARITY</b><span>${f.rarityScore.toFixed(1)}</span></div>` +
    `<div><b>GEN</b><span>${esc(h.generationRoman)}</span></div>` +
    `<div><b>GRADE</b><span>${f.grade}</span></div>` +
    `</div>` +
    `<div class="gmc-k-foot"><span class="gmc-k-print">${esc(h.print.text)}</span>` +
    `<span class="gmc-k-tier">${esc(f.rarityLabel)}</span>` +
    // QR は暗い地でも「濃いモジュール × 明るい下地」にする。
    // 実際に読み取れる QR はこの向きなので、置き換えたときに面積と
    // 明るさの印象が変わらないようにしておく。
    qrBlock(f, '#1a1626', '#c9c0dd') +
    `</div>` +
    `</div>` +
    `</div>`
  );
}

/** カード名（保存一覧やコピー用の見出しに使う）。 */
export function cardTitle(facts: CardFacts, design: CardDesign, finish: CardFinish): string {
  return `${facts.code} · ${CARD_DESIGN_BY_ID[design].label} · ${CARD_FINISH_BY_ID[finish].label}`;
}
