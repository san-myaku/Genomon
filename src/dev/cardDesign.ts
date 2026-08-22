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
 * 【箔の掛けかた（AGENTS.md の「主役は個体」に対応する判断）】
 *   全面レインボーにはしない。foil は mask で枠・ロゴ・Grade・罫線に限定し、
 *   ゲノモン本体の上には原則置かない（Collector だけ、個体の周りを
 *   やわらかく抜いた上で強めてよい）。マスクの実体は cardArt.ts。
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

import type { Phenotype } from '../core/types.ts';
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
import {
  CARD_DESIGN_BY_ID,
  CARD_FINISH_BY_ID,
  type CardDesign,
  type CardFacts,
  type CardFinish,
  type CardQuality,
} from './cardModel.ts';

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
  facts: CardFacts;
  design: CardDesign;
  finish: CardFinish;
  quality: CardQuality;
  /** 既に描き終えたゲノモンの SVG 文字列（gen.ts の drawSpecimen 出力）。 */
  creatureSvg: string;
  visuals: CardVisuals;
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
 * Collector だけ 1.0 で、Prism を強めてよい。
 */
const DESIGN_FOIL_SCALE: Readonly<Record<CardDesign, number>> = {
  certified: 0.46,
  natural: 0.38,
  collector: 0.7,
};

/** Cards Lab で組み立てた設定を、ライブラリの options へ翻訳する。 */
export function holoOptionsFor(spec: CardSpec): HoloCardOptions {
  const { design, finish, quality, visuals, facts, pheno } = spec;
  const def = CARD_FINISH_BY_ID[finish];
  const skin = SKINS[design];
  const full = quality === 'full';
  const medium = quality === 'medium';

  const foilAmount = def.strength * DESIGN_FOIL_SCALE[design] * visuals.foil;

  const layers: HoloLayerOptions[] = [];
  if (visuals.security && quality !== 'lite') {
    layers.push({
      image: dnaPatternUri(facts.certId, design === 'collector' ? skin.metal : skin.ink),
      mask: artHoleMaskUri(design),
      blend: design === 'collector' ? 'screen' : 'multiply',
      opacity: design === 'collector' ? 0.5 : 0.34,
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
  const paper = design === 'collector' ? mix('#0a0810', pheno.palette.bodyDark, 0.34) : skin.paper;
  const paper2 = design === 'collector' ? mix('#100c18', pheno.palette.body, 0.16) : skin.paper2;

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
    //   ホバー時はライブラリ内蔵の CSS が滑らかに持ち上げてくれる。
    interactive: full,
    activateOnClick: full,
    // ジャイロは Showcase の 1 枚だけ。比較の 3〜6 枚すべてが端末の傾きで
    // 動くと、目で比べたい差がモーションに埋もれる。
    gyroscope: full,
    showcase: false,
    textureSeed: facts.textureSeed,
    glow: pheno.palette.glow,
    palette: foilPalette(pheno, finish),
    visual: {
      shineOpacity: foilAmount,
      glareOpacity: (design === 'collector' ? 0.8 : 0.34) * visuals.glare,
      saturate: design === 'collector' ? 1.05 : 0.86,
      brightness: design === 'collector' ? 1 : 0.92,
      contrast: design === 'collector' ? 1 : 0.95,
    },
    glare: {
      shape: 'ellipse',
      size: design === 'collector' ? '80% 60%' : '65% 45%',
      stops:
        design === 'collector'
          ? ['hsla(0,0%,100%,.72) 8%', 'hsla(0,0%,100%,.34) 26%', 'hsla(0,0%,0%,.55) 92%']
          : ['hsla(42,60%,100%,.5) 10%', 'hsla(0,0%,100%,.22) 30%', 'hsla(0,0%,0%,.34) 92%'],
      blend: 'soft-light',
    },
    physics: {
      maxTilt: (design === 'collector' ? 15 : 11) * visuals.tilt,
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
      '--gmc-window': design === 'collector' ? paper : skin.window,
      '--gmc-accent': pheno.palette.accent,
      '--gmc-glow': pheno.palette.glow,
      '--gmc-body': pheno.palette.body,
      '--gmc-grain': `url("${paperGrainUri(design, skin.grain)}")`,
      '--gmc-backdrop': `url("${collectorBackdropUri(pheno)}")`,
    },
  };

  if (visuals.mask && def.effect !== 'none') {
    opts.mask = { image: foilMaskUri(design), size: '100% 100%', mode: 'shine' };
  }
  if (layers.length) opts.layers = layers;
  if (visuals.depth && (full || medium)) {
    opts.depth = {
      strength: full ? 13 : 7,
      perspective: 640,
      shadow: design === 'collector' ? 0.45 : 0.3,
      layerScale: 0.8,
    };
  }
  return opts;
}

// ─────────────────────────────────────────────────────────
//  DOM
// ─────────────────────────────────────────────────────────

/**
 * ライブラリが要求する骨格 + 自前のレイアウトを持つ `.holo-card` を作る。
 * JS は付けない（`attachHoloCard` するかどうかは呼び出し側が品質で決める）。
 */
export function buildCardElement(spec: CardSpec): HTMLElement {
  const root = document.createElement('div');
  root.className = `holo-card gmc-card gmc-card--${spec.design} gmc-q-${spec.quality}`;
  root.dataset.effect = toEffect(spec.finish);
  root.dataset.seed = spec.facts.seed;
  root.dataset.design = spec.design;
  root.dataset.finish = spec.finish;

  root.innerHTML =
    `<div class="holo-card__translater"><div class="holo-card__rotator">` +
    `<div class="holo-card__front">` +
    `<div class="holo-card__content">${cardFrontHtml(spec)}</div>` +
    `<div class="holo-card__shine"></div>` +
    `<div class="holo-card__glare"></div>` +
    `</div></div></div>`;

  return root;
}

/**
 * lite（一覧）用に、ライブラリの JS を付けずに見た目だけ揃える。
 *
 * `attachHoloCard` は effect ごとの CSS 変数（生成テクスチャ・パレット）を
 * 実行時に流し込む。lite ではその JS を動かさないので、
 * **同じ変数を静的に置いて** 30 枚ぶんのイベント購読を作らずに済ませる。
 */
export function applyStaticCardVars(root: HTMLElement, spec: CardSpec): void {
  const opts = holoOptionsFor(spec);
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
  element: HTMLElement;
  /** lite のときは null（ライブラリの JS を動かさない）。 */
  card: HoloCard | null;
  destroy(): void;
}

/** 1 枚ぶんを組み立てて、品質に応じて挙動を付ける。 */
export function mountCard(spec: CardSpec): MountedCard {
  const element = buildCardElement(spec);
  if (spec.quality === 'lite') {
    applyStaticCardVars(element, spec);
    return { element, card: null, destroy() { element.remove(); } };
  }
  const card = attachHoloCard(element, holoOptionsFor(spec));
  return {
    element,
    card,
    destroy() {
      card.destroy();
      element.remove();
    },
  };
}

// ─────────────────────────────────────────────────────────
//  カード表面のレイアウト
// ─────────────────────────────────────────────────────────

function cardFrontHtml(spec: CardSpec): string {
  const inner =
    spec.design === 'certified'
      ? certifiedFront(spec)
      : spec.design === 'natural'
        ? naturalFront(spec)
        : collectorFront(spec);
  return `<div class="gmc gmc--${spec.design}">${inner}</div>`;
}

/** ゲノモンの窓。3 デザイン共通の中身（枠の飾りだけ差し替える）。 */
function artWindow(spec: CardSpec, extra = ''): string {
  return (
    `<div class="gmc-art">` +
    `<div class="gmc-art-bg"></div>` +
    extra +
    `<div class="gmc-art-inner">${spec.creatureSvg}</div>` +
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
 * Certified の丸い認証シール。
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

// ── Design A: Certified ───────────────────────────────────

function certifiedFront(spec: CardSpec): string {
  const f = spec.facts;
  const skin = SKINS.certified;
  const spec3 = [
    { k: 'PATTERN', v: f.lines[0]?.value ?? '—', ja: f.lines[0]?.valueJa ?? '' },
    { k: 'LINEAGE', v: f.lineage, ja: f.paletteLabel },
    { k: 'RARITY', v: f.rarityScore.toFixed(1), ja: f.rarityLabel },
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
    `<div class="gmc-c-gradetext gmc-c-print"><b>PRINT</b><span>${esc(f.print.text)}</span></div>` +
    `<div class="gmc-c-tier">${esc(f.rarityLabel)}</div>` +
    `</div>` +
    `<div class="gmc-c-spec">` +
    spec3
      .map(
        (s) =>
          `<div><b>${esc(s.k)}</b><span>${esc(s.v)}</span><em>${esc(s.ja)}</em></div>`,
      )
      .join('') +
    `</div>` +
    `<footer class="gmc-c-foot">` +
    `<div class="gmc-c-foottext"><b>GENOMON CERTIFIED</b>` +
    `<span>${esc(f.certifiedOn)} · GEN ${esc(f.generationRoman)} · ${esc(f.baseLabel)}</span></div>` +
    qrBlock(f, skin.ink, skin.window) +
    `</footer>` +
    `</div>`
  );
}

// ── Design B: Natural History ─────────────────────────────

function naturalFront(spec: CardSpec): string {
  const f = spec.facts;
  const skin = SKINS.natural;
  const notable = f.notableTraits.slice(0, 2);
  const carrier = f.carriers[0] ?? null;

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
    `<div class="gmc-n-no">No. ${esc(f.print.text)}</div>` +
    `</div>` +
    artWindow(
      spec,
      `<div class="gmc-brackets"><i></i><i></i><i></i><i></i></div>` +
        `<div class="gmc-scale"><i></i><span>10 mm</span></div>`,
    ) +
    `<div class="gmc-n-meta">` +
    `<div><b>GENERATION</b><span>${esc(f.generationRoman)}</span></div>` +
    `<div><b>GRADE</b><span>${f.grade}</span></div>` +
    `<div><b>RARITY</b><span>${f.rarityScore.toFixed(1)}</span></div>` +
    `</div>` +
    `<section class="gmc-n-sec">` +
    `<h4>PEDIGREE</h4>` +
    `<div class="gmc-n-ped">` +
    `<div class="gmc-n-parents"><span>${esc(f.parents[0])}</span><span>${esc(f.parents[1])}</span></div>` +
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
    (f.showRecord
      ? `<p class="gmc-n-show"><b>${esc(f.showRecord.place)}</b>` +
        `<span>${esc(f.showRecord.event)} · ${f.showRecord.year}</span></p>`
      : `<p class="gmc-n-show gmc-n-none"><span>NO RECORD ON FILE</span></p>`) +
    `</section>` +
    `<footer class="gmc-n-foot">` +
    `<div class="gmc-n-strip"><span>${esc(f.certId)}</span><i></i></div>` +
    qrBlock(f, skin.ink, skin.window) +
    `</footer>` +
    `</div>`
  );
}

// ── Design C: Collector ───────────────────────────────────

function collectorFront(spec: CardSpec): string {
  const f = spec.facts;
  return (
    `<div class="gmc-paper"></div>` +
    // 背景と後光は **カード全面** に敷く。窓の中だけに入れると、
    // 光の帯が窓の縁でぷつりと切れて「絵を貼った板」に見えてしまう。
    `<div class="gmc-k-backdrop"></div><div class="gmc-k-halo"></div>` +
    `<div class="gmc-k-scrim"></div>` +
    `<div class="gmc-body">` +
    `<header class="gmc-k-rail">` +
    `<div class="gmc-wordmark">GENOMON</div>` +
    `<div class="gmc-k-stamp">${esc(CARD_FINISH_BY_ID[spec.finish].stamp)}</div>` +
    `</header>` +
    artWindow(spec) +
    `<div class="gmc-k-info">` +
    `<div class="gmc-k-name">${esc(f.code)}<em>${esc(f.name)}</em></div>` +
    `<div class="gmc-k-rule"></div>` +
    `<div class="gmc-k-stats">` +
    `<div><b>RARITY</b><span>${f.rarityScore.toFixed(1)}</span></div>` +
    `<div><b>GEN</b><span>${esc(f.generationRoman)}</span></div>` +
    `<div><b>GRADE</b><span>${f.grade}</span></div>` +
    `</div>` +
    `<div class="gmc-k-foot"><span class="gmc-k-print">${esc(f.print.text)}</span>` +
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
