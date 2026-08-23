/**
 * Cards Lab（開発ツールの第 3 タブ）。
 *
 * 【何のための画面か】
 *   ゲーム本編にカードシステムを入れる前に、「どんなカードなら本当に
 *   集めたくなるか」を **実物を見ながら** 決めるための研究環境。
 *   機能を作ることではなく、美術判断を回せることが目的なので、
 *   1 枚を大きく見る場と、並べて比べる場の両方を用意する。
 *
 * 【スマホでの使いかたを主役に据える】
 *   カードは手に持って眺めるものなので、判断もスマホでできないと意味がない。
 *   狭い画面では次の 3 つを守る:
 *     1. **カードが最初に見える。** 設定は畳んでカードの下へ回す
 *        （CSS の order で入れ替え、設定は details に入れる）。
 *     2. **親指の届く所に「つぎのカード」がある。** 画面下に固定した
 *        デッキバーから、めくる・戻る・版面を変える・箔を変える・
 *        気に入ったら残す、が片手でできる。
 *     3. **左右スワイプでめくれる。** 次々に出したいときに、
 *        ボタンを狙う必要すらないようにする。
 *   比較（6 枚・3 枚）と一覧（8〜30 枚）は狭い画面では **畳んでおき、
 *   開くまで作らない**。カードを 1 枚めくるたびに 40 枚作り直していては
 *   「次から次に」にならない。
 *
 * 【本編に影響しないこと】
 *   ここは `lab.html` からしか読まれない。GameState もセーブも触らない。
 *   localStorage は Cards Lab 専用キー（cardStore.ts）だけ。
 *   Visual Lab の `genomon.dev.prefs.v1` は読み書きしない。
 *
 * 【個体の作りかた】
 *   カード専用の生成処理は書かない。`gen.ts` の `makeSpecimen` /
 *   `makeSpecimenNear` / `drawSpecimen` をそのまま使うので、
 *   カードに載るゲノモンは Visual Lab・本編と同一の個体になる。
 *
 * 【重さの配分】
 *   Showcase 1 枚 = full（tilt / glare / depth / 視差レイヤー / ジャイロ）
 *   比較 3〜6 枚  = medium（静止時も箔が見える。ポインタ追従はしない）
 *   一覧 8〜30 枚 = lite（ライブラリの JS を一切付けず、CSS だけ）
 *   30 枚に pointer tracking を張ると、指を動かすたびに 30 個のバネが
 *   走って比較にならない。lite は静止画として扱う。
 */

import '@kongyo2/cards-css/styles.css';

import type { BodyBase, Stage } from '../core/types.ts';
import { BODY_BASES } from '../core/types.ts';
import { PALETTE_FAMILIES } from '../core/color.ts';
import { makeWorldSeed, normalizeSeed } from '../core/rng.ts';
import { $, $$, esc, setHtml } from '../ui/dom.ts';
import { copyText } from './util.ts';
import { drawSpecimen, makeSpecimen, makeSpecimenNear, seedAt, triesFor, type GenSpec, type Specimen } from './gen.ts';
import type { LabDeps, Mounted } from './visualLab.ts';
import {
  CARD_DESIGNS,
  CARD_DESIGN_BY_ID,
  CARD_FINISHES,
  CARD_FINISH_BY_ID,
  CARD_GRADES,
  DEFAULT_DESIGN,
  deriveCardFacts,
  resolveFinish,
  type CardDesign,
  type CardFinish,
  type CardFinishChoice,
  type CardGrade,
  type CardQuality,
} from './cardModel.ts';
import {
  cardTitle,
  mountCard,
  type CardSpec,
  type CardVisuals,
  type MountedCard,
} from './cardDesign.ts';
import { deriveLabHistory } from './cardHistory.ts';
import {
  CARD_RANKS,
  CARD_RANK_BY_ID,
  resolveRank,
  type CardRank,
  type RankTreatment,
  type SealMaterial,
} from './cardRarity.ts';
import { installCardStyles } from './cardStyles.ts';
import {
  addSavedCard,
  clearSavedCards,
  loadCardPrefs,
  loadSavedCards,
  removeSavedCard,
  saveCardPrefs,
} from './cardStore.ts';

// ─────────────────────────────────────────────────────────
//  画面の状態
// ─────────────────────────────────────────────────────────

interface CardPrefs {
  seed: string;
  design: CardDesign;
  /** 'auto' なら段（rarity）が仕上げを決める。 */
  finish: CardFinishChoice;
  grade: CardGrade;
  /**
   * 希少度の強制表示（§19）。
   *
   * **見た目だけのオーバーライド**で、遺伝データには一切触れない。
   * 同じ個体で STANDARD 〜 MYTHIC の加工差を見比べるためだけにある。
   */
  rarity: CardRank | 'auto';
  /** 認証印の素材。'auto' なら段が決める。 */
  seal: SealMaterial | 'auto';
  /** 素体の強制（''＝指定なし）。Visual Lab と同じ発想。 */
  base: BodyBase | '';
  /** 配色ファミリーの強制（''＝指定なし）。 */
  palette: string;
  /** true: ホモ接合で強制 / false: 自然出現から絞り込み。 */
  force: boolean;
  bg: 'light' | 'dark';
  foil: number;
  glare: number;
  tilt: number;
  depth: boolean;
  mask: boolean;
  security: boolean;
  /** Showcase のカード幅（px）。狭い画面では画面幅が優先される。 */
  showcaseW: number;
  /** 個体比較に並べる体数。 */
  galleryN: number;
  /** 比較に並べる Finish（最大 6）。 */
  cmpFinishes: CardFinish[];
}

const DEFAULTS: CardPrefs = {
  seed: 'GENOMON-CARD',
  // 既定は Collector v2（§4）。ここを変えると `tests/cards.test.ts` が落ちる。
  design: DEFAULT_DESIGN,
  finish: 'auto',
  grade: 9,
  rarity: 'auto',
  seal: 'auto',
  base: '',
  palette: '',
  force: true,
  bg: 'dark',
  foil: 1,
  glare: 1,
  tilt: 1,
  depth: true,
  mask: true,
  security: true,
  showcaseW: 430,
  galleryN: 8,
  cmpFinishes: ['standard', 'silver', 'holo', 'prism', 'gold', 'aurora'],
};

/** カードは成体で見る（卵・幼体はカードの主題にならない）。 */
const STAGE: Stage = 'adult';

const BASE_LABEL: Record<BodyBase, string> = { maru: 'まる型', yurei: '幽霊型', slime: 'スライム型' };

/** 比較に並べる Finish の最大数。これ以上並べると 1 枚あたりが小さすぎて比べられない。 */
const CMP_MAX = 6;

/**
 * ここより狭ければ「スマホの持ちかた」で組む。
 * `.cards-wrap` を 2 段組にする閾値（cardStyles.ts の 900px）と必ず揃えること。
 */
const NARROW_PX = 900;

/**
 * デッキバーの「箔をかえる」が回す順番。
 * 先頭は AUTO（段が決める）。既定の見えかたへ 1 タップで戻れるようにする。
 */
const CYCLE_FINISHES: readonly CardFinishChoice[] = [
  'auto',
  ...CARD_FINISHES.filter((f) => f.core).map((f) => f.id),
];

/** 履歴に残すカードの枚数。めくり戻せれば十分なので上限は控えめ。 */
const HISTORY_MAX = 80;

/**
 * 比較・一覧を作り直すまでの待ち時間。
 *
 * 【220ms では PC で「次々に」めくれなかった — 実測】
 *   PC は折りたたみが全部開いているので、1 枚めくるたびに 23 枚を作り直す。
 *   220ms は人が連続で押す間隔（300ms 前後）より短いため **1 タップごとに
 *   full の再構築が走り**、5 連打が 1500ms のはずのところ 2687ms かかっていた。
 *   手が止まってから追いつけば十分なので、連打を 1 回にまとめられる長さにする。
 */
const SETTLE_MS = 500;

const isNarrow = (): boolean => window.innerWidth < NARROW_PX;

// ─────────────────────────────────────────────────────────
//  mount
// ─────────────────────────────────────────────────────────

export function mountCardLab(host: HTMLElement, deps: LabDeps): Mounted {
  installCardStyles();

  const st = loadCardPrefs<CardPrefs>(DEFAULTS);
  // 保存された配列が壊れていても画面を出す（開発ツールが開かない方が困る）。
  if (!Array.isArray(st.cmpFinishes) || st.cmpFinishes.length === 0) {
    st.cmpFinishes = [...DEFAULTS.cmpFinishes];
  }

  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** 生きているカード（再描画のたびに destroy する）。 */
  const live: MountedCard[] = [];
  /** Showcase に出ている個体。 */
  let current: Specimen | null = null;
  /** 描画をまとめるためのタイマー。 */
  let settleTimer = 0;
  let disposed = false;

  /**
   * めくった seed の履歴。「次から次に」出したあとで
   * 「さっきの子が良かった」に戻れないと、たくさん出す意味がない。
   */
  const trail: string[] = [];
  let trailAt = -1;

  /** 畳んである比較・一覧が、開いたときに作り直す必要があるか。 */
  const stale = { rarity: true, finish: true, design: true, gallery: true };

  /** Showcase に出ているカード（裏返しの制御に使う）。 */
  let showcaseCard: MountedCard | null = null;
  /**
   * Showcase をどちらの面で出しているか。
   * 再描画のたびに表へ戻さないよう、画面の状態としてここに持つ
   * （保存はしない ── 開き直したときは表から始めたい）。
   */
  let face: 'front' | 'back' = 'front';

  const persist = (): void => saveCardPrefs(st);

  const spec = (): GenSpec => ({
    stage: STAGE,
    base: st.base === '' ? null : st.base,
    palette: st.palette === '' ? null : st.palette,
    force: st.force,
    detail: 'full',
  });

  const visuals = (): CardVisuals => ({
    foil: st.foil,
    glare: st.glare,
    // OS が「動きを減らす」なら、保存済みの設定に関わらず傾きを止める。
    tilt: reducedMotion ? 0 : st.tilt,
    depth: st.depth,
    mask: st.mask,
    security: st.security,
  });

  /**
   * その個体の段。`st.rarity` が 'auto' 以外なら強制表示だが、
   * **`sp.pheno` も `sp.genotype` も触らない**（§19）。
   */
  function rankOf(sp: Specimen, override: CardRank | 'auto' = st.rarity): RankTreatment {
    return resolveRank(sp.pheno.rarity.score, override, sp.seed);
  }

  function cardSpecOf(
    sp: Specimen,
    design: CardDesign,
    quality: CardQuality,
    opts: { finish?: CardFinishChoice; rank?: RankTreatment; flippable?: boolean } = {},
  ): CardSpec {
    const rank = opts.rank ?? rankOf(sp);
    const choice = opts.finish ?? st.finish;
    return {
      pheno: sp.pheno,
      genotype: sp.genotype,
      facts: deriveCardFacts(sp.pheno, st.grade),
      history: deriveLabHistory(sp.seed, rank.def.id),
      rank,
      design,
      finish: resolveFinish(choice, rank.def.id),
      finishFromRank: choice === 'auto',
      quality,
      creatureSvg: drawSpecimen(sp.model, {
        background: null,
        debug: false,
        width: '100%',
        height: '100%',
      }),
      visuals: visuals(),
      sealStyle: st.seal,
      flippable: opts.flippable ?? false,
    };
  }

  /** 1 枚ぶんを作って器へ入れ、後始末リストへ積む。 */
  function place(
    into: HTMLElement,
    sp: Specimen,
    design: CardDesign,
    quality: CardQuality,
    opts: { finish?: CardFinishChoice; rank?: RankTreatment; flippable?: boolean } = {},
  ): MountedCard {
    const m = mountCard(cardSpecOf(sp, design, quality, opts));
    into.appendChild(m.element);
    live.push(m);
    return m;
  }

  function clearLive(): void {
    while (live.length) live.pop()?.destroy();
  }

  /**
   * 生きているカードのうち、指定した器の中のものだけ捨てる。
   * 9 枚を毎回作り直すとスライダーもスワイプも重くなるので、
   * 動かしている最中は Showcase だけ差し替える。
   */
  function clearLiveIn(sel: string): void {
    const root = $(sel, host);
    if (!root) return;
    for (let i = live.length - 1; i >= 0; i--) {
      const m = live[i];
      if (m && root.contains(m.element)) {
        m.destroy();
        live.splice(i, 1);
      }
    }
    root.innerHTML = '';
  }

  function build(): void {
    host.innerHTML = shell(st, reducedMotion, isNarrow());
  }

  build();

  // ── 個体 ──────────────────────────────────────────────

  function rebuildSpecimen(): void {
    const s = spec();
    current = makeSpecimenNear(normalizeSeed(st.seed), s, triesFor(1, s));
  }

  /** 履歴へ積む（前へ戻ってから新しくめくったら、先の分は捨てる）。 */
  function pushTrail(seed: string): void {
    if (trailAt < trail.length - 1) trail.length = trailAt + 1;
    if (trail[trail.length - 1] !== seed) trail.push(seed);
    if (trail.length > HISTORY_MAX) trail.shift();
    trailAt = trail.length - 1;
  }

  /**
   * seed を切り替えて **Showcase だけ** すぐ描く。
   *
   * 比較や一覧まで同時に作り直すと、1 タップに 40 枚ぶんの生成が乗って
   * 「次から次に」めくれない。重いものは `settle()` に回して、
   * 連打したときは最後の 1 回にまとめる。
   */
  function applySeed(seed: string): void {
    st.seed = seed;
    const input = $<HTMLInputElement>('#cards-seed', host);
    if (input) input.value = seed;
    persist();
    rebuildSpecimen();
    clearLiveIn('#cards-showcase');
    renderShowcase();
    syncControls();
    settle();
  }

  /** 新しい個体をめくる。 */
  function nextCard(): void {
    if (trailAt >= 0 && trailAt < trail.length - 1) {
      // 戻ったあとの「次」は、まず履歴の先へ進む
      trailAt++;
      applySeed(trail[trailAt]!);
      return;
    }
    // 「新しい一覧を始める」起点なので makeWorldSeed を使ってよい（AGENTS.md §1 の例外）。
    const seed = makeWorldSeed();
    pushTrail(seed);
    applySeed(seed);
  }

  function prevCard(): void {
    if (trailAt <= 0) {
      deps.toast('これより前のカードはありません', 'info');
      return;
    }
    trailAt--;
    applySeed(trail[trailAt]!);
  }

  // ── Showcase ─────────────────────────────────────────

  function renderShowcase(): void {
    const stage = $('#cards-stage', host);
    const box = $('#cards-showcase', host);
    const cap = $('#cards-caption', host);
    if (!stage || !box || !cap) return;

    stage.dataset.bg = st.bg;
    box.style.setProperty('--cards-showcase-w', `${st.showcaseW}px`);
    box.innerHTML = '';

    if (!current) {
      setHtml(
        cap,
        `<b class="warn">条件に合う個体が見つかりませんでした。</b>` +
          `潜性の配色（しんじゅ・こうせき・すみ）を「絞り込み」で狙うと出現率が 1% 前後です。` +
          `「強制」に切り替えてください。`,
      );
      return;
    }

    showcaseCard = place(box, current, st.design, 'full', { flippable: true });
    // 直前に裏を見ていたなら、めくり直さずに裏のまま出す
    // （設定をいじるたびに表へ戻ると、裏面の調整ができない）。
    if (face === 'back') showcaseCard.flip('back');

    const facts = deriveCardFacts(current.pheno, st.grade);
    const rank = rankOf(current);
    const finish = resolveFinish(st.finish, rank.def.id);
    const pos = trail.length > 1 ? ` <span class="cards-count">${trailAt + 1}/${trail.length}</span>` : '';
    setHtml(
      cap,
      `<b>${esc(cardTitle(facts, st.design, finish))}</b>${pos}<br>` +
        `<span class="cards-cap-sub">seed <code>${esc(current.seed)}</code> · ${esc(facts.certId)} · ` +
        `${esc(facts.baseLabel)}・${esc(facts.paletteLabel)} · ` +
        // 【強制表示していることを必ず書く】
        //   カードの数字だけを見ると本当の希少度と取り違える。
        //   実データは何だったのかを、必ず並べて出す。
        (rank.forced
          ? `<b class="warn">強制 ${esc(rank.def.label)}</b>（実データ ${rank.trueScore.toFixed(1)} ／ ` +
            `${esc(CARD_RANK_BY_ID[resolveRank(rank.trueScore, 'auto', current.seed).def.id].label)}）`
          : `rarity ${rank.score.toFixed(1)}（${esc(rank.def.label)}）`) +
        `</span>` +
        `<span class="cards-cap-tip">タップ／Enter で裏返す・左右スワイプでめくる</span>` +
        (current.issues.length
          ? `<br><span class="warn">自動検査: ${esc(current.issues.join(' / '))}</span>`
          : ''),
    );
  }

  // ── 段（rarity）比較 ─────────────────────────────────

  /** 畳んである間は作らない。開いたときに `onToggle` が呼び直す。 */
  function foldOpen(id: string): boolean {
    return $<HTMLDetailsElement>(id, host)?.open ?? false;
  }

  /**
   * 同じ個体を 5 段ぶん並べる。**この Lab でいちばん大事な比較**（§18）。
   *
   * 「STANDARD → MYTHIC と並べたとき、MYTHIC を見て本当に欲しくなるか」
   * が今回の完成条件（§31）なので、その判断が 1 画面でできる場所を作る。
   * ここでの強制は視覚だけ（`resolveRank` の forced 側）で、
   * 遺伝データも Phenotype も変わらない。
   */
  function renderRarityCmp(): void {
    const strip = $('#cards-cmp-rarity', host);
    if (!strip || !current) return;
    if (!foldOpen('#cards-fold-rarity')) {
      stale.rarity = true;
      return;
    }
    stale.rarity = false;
    strip.dataset.bg = st.bg;
    strip.innerHTML = '';
    const real = rankOf(current, 'auto').def.id;
    for (const def of CARD_RANKS) {
      const slot = slotButton(def.id === real ? `${def.label}（実データ）` : def.label, def.id === st.rarity);
      slot.dataset.rarity = def.id;
      strip.appendChild(slot);
      place(slotBody(slot), current, st.design, 'medium', { rank: rankOf(current, def.id) });
    }
  }

  // ── Finish 比較 ──────────────────────────────────────

  function renderFinishCmp(): void {
    const strip = $('#cards-cmp-finish', host);
    if (!strip || !current) return;
    if (!foldOpen('#cards-fold-finish')) {
      stale.finish = true;
      return;
    }
    stale.finish = false;
    strip.dataset.bg = st.bg;
    strip.innerHTML = '';
    for (const fin of st.cmpFinishes.slice(0, CMP_MAX)) {
      const slot = slotButton(CARD_FINISH_BY_ID[fin].label, fin === st.finish);
      slot.dataset.finish = fin;
      strip.appendChild(slot);
      place(slotBody(slot), current, st.design, 'medium', { finish: fin });
    }
  }

  // ── Design 比較 ──────────────────────────────────────

  function renderDesignCmp(): void {
    const strip = $('#cards-cmp-design', host);
    if (!strip || !current) return;
    if (!foldOpen('#cards-fold-design')) {
      stale.design = true;
      return;
    }
    stale.design = false;
    strip.dataset.bg = st.bg;
    strip.innerHTML = '';
    for (const d of CARD_DESIGNS) {
      const slot = slotButton(d.legacy ? `${d.label}（旧）` : d.label, d.id === st.design);
      slot.dataset.design = d.id;
      strip.appendChild(slot);
      place(slotBody(slot), current, d.id, 'medium');
    }
  }

  // ── 個体比較（一覧） ─────────────────────────────────

  function renderGallery(): void {
    const grid = $('#cards-gallery', host);
    if (!grid) return;
    if (!foldOpen('#cards-fold-gallery')) {
      stale.gallery = true;
      return;
    }
    stale.gallery = false;
    clearLiveIn('#cards-gallery');
    grid.dataset.bg = st.bg;

    const s = spec();
    const base = normalizeSeed(st.seed);
    const want = Math.max(4, Math.min(30, st.galleryN));
    const tries = triesFor(want, s);
    let found = 0;
    for (let i = 0; i < tries && found < want; i++) {
      const sp = makeSpecimen(seedAt(base, i + 1), s);
      if (!sp) continue;
      found++;
      const slot = slotButton(sp.seed, false);
      slot.classList.add('cards-slot--tile');
      slot.style.setProperty('--slot-w', '100%');
      slot.dataset.seed = sp.seed;
      grid.appendChild(slot);
      place(slotBody(slot), sp, st.design, 'lite');
    }
    const note = $('#cards-gallery-note', host);
    if (note) {
      note.textContent =
        `${found} 体（${CARD_DESIGN_BY_ID[st.design].label} × ${finishLabel()}）。` +
        `タップで Showcase へ送ります。一覧は静止表示・表面のみ（tilt / depth / 裏面なし）です。`;
    }
  }

  // ── 保存 ─────────────────────────────────────────────

  function renderSaved(): void {
    const box = $('#cards-saved', host);
    if (!box) return;
    const list = loadSavedCards();
    if (!list.length) {
      setHtml(box, `<p class="hint">まだ保存された案はありません。良い組み合わせが出たら残してください。</p>`);
      return;
    }
    setHtml(
      box,
      list
        .map(
          (c, i) =>
            `<div class="cards-saved-item" data-idx="${i}">` +
            `<span class="t"><b>${esc(CARD_DESIGN_BY_ID[c.design]?.label ?? c.design)}</b> · ` +
            `${esc(CARD_FINISH_BY_ID[c.finish]?.label ?? c.finish)} · G${c.grade} · ` +
            `<code>${esc(c.seed)}</code>${c.note ? ` — ${esc(c.note)}` : ''}</span>` +
            `<span class="d">${new Date(c.savedAt).toLocaleDateString()}</span>` +
            `<button data-act="load-saved" data-idx="${i}">開く</button>` +
            `<button class="danger" data-act="drop-saved" data-idx="${i}">削除</button>` +
            `</div>`,
        )
        .join(''),
    );
  }

  function saveCurrent(note: string): void {
    if (!current) {
      deps.toast('保存できる個体がありません', 'bad');
      return;
    }
    addSavedCard({
      seed: current.seed,
      design: st.design,
      finish: resolveFinish(st.finish, rankOf(current).def.id),
      grade: st.grade,
      visuals: visuals(),
      bg: st.bg,
      note,
      savedAt: Date.now(),
    });
    renderSaved();
    deps.toast('このカードを保存しました', 'ok');
  }

  // ── 再描画のまとめ ───────────────────────────────────

  /** Showcase だけ。スライダーを動かしている最中に呼ぶ。 */
  function renderLight(): void {
    clearLiveIn('#cards-showcase');
    renderShowcase();
  }

  /** 全部。個体・デザイン・仕上げが変わったときに呼ぶ。 */
  function renderAll(rebuild: boolean): void {
    if (disposed) return;
    if (rebuild) rebuildSpecimen();
    clearLive();
    renderShowcase();
    renderRarityCmp();
    renderFinishCmp();
    renderDesignCmp();
    renderGallery();
    syncControls();
  }

  /** 重い所を後回しにする（連打しても 1 回にまとまる）。 */
  function settle(): void {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      if (disposed) return;
      clearLiveIn('#cards-cmp-rarity');
      clearLiveIn('#cards-cmp-finish');
      clearLiveIn('#cards-cmp-design');
      renderRarityCmp();
      renderFinishCmp();
      renderDesignCmp();
      renderGallery();
    }, SETTLE_MS);
  }

  /** 仕上げの表示名。'auto' のときは、いま実際に選ばれている効果も添える。 */
  function finishLabel(): string {
    if (st.finish !== 'auto') return CARD_FINISH_BY_ID[st.finish].label;
    if (!current) return 'AUTO';
    return `AUTO（${CARD_FINISH_BY_ID[resolveFinish('auto', rankOf(current).def.id)].label}）`;
  }

  function syncControls(): void {
    for (const b of $$<HTMLElement>('[data-set]', host)) {
      const [key, value] = (b.dataset.set ?? '').split('=');
      if (!key) continue;
      const cur = String((st as unknown as Record<string, unknown>)[key]);
      b.setAttribute('aria-pressed', cur === value ? 'true' : 'false');
    }
    const designNote = $('#cards-design-note', host);
    if (designNote) designNote.textContent = CARD_DESIGN_BY_ID[st.design].note;
    const rarityNote = $('#cards-rarity-note', host);
    if (rarityNote) {
      rarityNote.textContent =
        st.rarity === 'auto'
          ? '実データ（pheno.rarity.score）から段を決めます。'
          : `${CARD_RANK_BY_ID[st.rarity].note}　※見た目だけの強制。遺伝データは変わりません。`;
    }
    const deckDesign = $('#cards-deck-design', host);
    if (deckDesign) deckDesign.textContent = CARD_DESIGN_BY_ID[st.design].label;
    const deckFinish = $('#cards-deck-finish', host);
    // デッキは幅が足りない（AUTO（Standard）で 122px 占めていた）。短い方を出す。
    if (deckFinish) {
      deckFinish.textContent = st.finish === 'auto' ? 'AUTO' : CARD_FINISH_BY_ID[st.finish].label;
    }
    const deckFace = $('#cards-deck-face', host);
    if (deckFace) deckFace.textContent = face === 'back' ? '裏' : '表';
    for (const b of $$<HTMLElement>('[data-act="flip"]', host)) {
      b.setAttribute('aria-pressed', face === 'back' ? 'true' : 'false');
    }
    // 「戻る」はカードの下とデッキバーの 2 か所に出る。$ は先頭しか返さないので
    // $$ で全部そろえる（片方だけ押せる状態が残ると、押しても何も起きない）。
    for (const back of $$<HTMLButtonElement>('[data-act="prev"]', host)) {
      back.disabled = trailAt <= 0;
    }
  }

  /** 表 ↔ 裏。裏面はここで初めて作られる（mountCard の遅延生成）。 */
  function flipShowcase(): void {
    if (!showcaseCard) return;
    showcaseCard.flip();
    face = showcaseCard.face();
    syncControls();
  }

  // ── 入力 ─────────────────────────────────────────────

  /** 版面・箔をぐるぐる回す（スマホのデッキバー用。1 タップで次の候補へ）。 */
  function cycleDesign(): void {
    const i = CARD_DESIGNS.findIndex((d) => d.id === st.design);
    const next = CARD_DESIGNS[(i + 1) % CARD_DESIGNS.length]!;
    st.design = next.id;
    persist();
    renderLight();
    syncControls();
    settle();
    deps.toast(`版面: ${next.label}`, 'info');
  }

  /**
   * デッキの「箔」を 1 タップ進める。
   *
   * 【同じ効果に着地する候補は飛ばす】
   *   AUTO は段が決めるので、STANDARD の個体では AUTO も 'standard' も
   *   同じ効果になる。素直に次へ進めると **1 タップ押しても何も変わらない**
   *   （デッキの主目的は「押したら変わる」こと）。実際に着地する effect が
   *   変わるまで進める。
   */
  function cycleFinish(): void {
    const cur = current ? resolveFinish(st.finish, rankOf(current).def.id) : null;
    const i = CYCLE_FINISHES.indexOf(st.finish);
    let next = CYCLE_FINISHES[(i + 1) % CYCLE_FINISHES.length]!;
    for (let step = 1; step < CYCLE_FINISHES.length && current && cur; step++) {
      const cand = CYCLE_FINISHES[(i + step) % CYCLE_FINISHES.length]!;
      if (resolveFinish(cand, rankOf(current).def.id) !== cur) {
        next = cand;
        break;
      }
    }
    st.finish = next;
    persist();
    renderLight();
    syncControls();
    settle();
    deps.toast(`仕上げ: ${finishLabel()}`, 'info');
  }

  const onClick = (ev: Event): void => {
    const t = ev.target as HTMLElement | null;
    if (!t) return;

    // カードそのものを押して裏返した場合。めくる処理は mountCard 側が持って
    // いるので、ここでは画面の状態（どちらの面か）を追いつかせるだけ。
    if (showcaseCard && t.closest('.gmc-flip-inner')) {
      face = showcaseCard.face();
      syncControls();
      return;
    }

    const setter = t.closest<HTMLElement>('[data-set]');
    if (setter) {
      const [key, value] = (setter.dataset.set ?? '').split('=');
      if (key && value !== undefined) {
        const rec = st as unknown as Record<string, unknown>;
        // seg ボタンの値は文字列なので、型ごとにここで戻す
        // （force を 'false' のまま入れると、文字列は真なので絞り込みが効かなくなる）。
        rec[key] = key === 'grade' ? (Number(value) as CardGrade) : key === 'force' ? value === 'true' : value;
        persist();
        if (key === 'force') {
          renderAll(true);
        } else {
          renderLight();
          syncControls();
          settle();
        }
      }
      return;
    }

    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const slot = t.closest<HTMLElement>('.cards-slot');

    if (!act && slot) {
      if (slot.dataset.rarity) {
        // 比較で押した段を Showcase へ送る。もう一度押すと AUTO へ戻す
        // （実データの見えかたへ帰れないと、比較が「戻れない道」になる）。
        const picked = slot.dataset.rarity as CardRank;
        st.rarity = st.rarity === picked ? 'auto' : picked;
        persist();
        renderLight();
        syncControls();
        settle();
      } else if (slot.dataset.finish) {
        st.finish = slot.dataset.finish as CardFinish;
        persist();
        renderLight();
        syncControls();
        settle();
      } else if (slot.dataset.design) {
        st.design = slot.dataset.design as CardDesign;
        persist();
        renderLight();
        syncControls();
        settle();
      } else if (slot.dataset.seed) {
        pushTrail(slot.dataset.seed);
        applySeed(slot.dataset.seed);
        scrollToStage();
      }
      return;
    }

    if (!act) return;
    switch (act) {
      case 'apply': {
        const input = $<HTMLInputElement>('#cards-seed', host);
        const seed = input?.value.trim() || DEFAULTS.seed;
        pushTrail(seed);
        applySeed(seed);
        break;
      }
      case 'next':
      case 'random':
        nextCard();
        break;
      case 'prev':
        prevCard();
        break;
      case 'cycle-design':
        cycleDesign();
        break;
      case 'cycle-finish':
        cycleFinish();
        break;
      case 'flip':
        flipShowcase();
        break;
      case 'regen':
        renderAll(true);
        break;
      case 'gallery':
        renderGallery();
        break;
      case 'copy-seed':
        void copyText(current?.seed ?? st.seed).then((ok) =>
          deps.toast(ok ? 'seed をコピーしました' : 'コピーできませんでした', ok ? 'ok' : 'bad'),
        );
        break;
      case 'save-quick':
        saveCurrent('');
        break;
      case 'save': {
        const noteInput = $<HTMLInputElement>('#cards-note', host);
        saveCurrent(noteInput?.value.trim() ?? '');
        if (noteInput) noteInput.value = '';
        break;
      }
      case 'load-saved': {
        const idx = Number(t.closest<HTMLElement>('[data-idx]')?.dataset.idx ?? -1);
        const hit = loadSavedCards()[idx];
        if (!hit) break;
        st.seed = hit.seed;
        st.design = hit.design;
        st.finish = hit.finish;
        st.grade = hit.grade;
        st.bg = hit.bg;
        Object.assign(st, hit.visuals);
        persist();
        pushTrail(hit.seed);
        clearLive();
        build();
        renderAll(true);
        renderSaved();
        scrollToStage();
        break;
      }
      case 'drop-saved': {
        const idx = Number(t.closest<HTMLElement>('[data-idx]')?.dataset.idx ?? -1);
        const hit = loadSavedCards()[idx];
        if (hit) removeSavedCard(hit);
        renderSaved();
        break;
      }
      case 'clear-saved':
        clearSavedCards();
        renderSaved();
        deps.toast('保存した案をすべて消しました', 'info');
        break;
      default:
        break;
    }
  };

  const onInput = (ev: Event): void => {
    const t = ev.target as HTMLInputElement | HTMLSelectElement | null;
    if (!t?.dataset.bind) return;
    const key = t.dataset.bind;
    const rec = st as unknown as Record<string, unknown>;

    if (t instanceof HTMLInputElement && t.type === 'checkbox') {
      rec[key] = t.checked;
    } else if (t instanceof HTMLInputElement && t.type === 'range') {
      rec[key] = Number(t.value);
      const out = t.parentElement?.querySelector('output');
      if (out) out.textContent = t.value;
    } else if (t instanceof HTMLInputElement && t.type === 'number') {
      rec[key] = Number(t.value);
    } else {
      rec[key] = t.value;
    }
    persist();

    if (key === 'showcaseW') {
      const box = $('#cards-showcase', host);
      box?.style.setProperty('--cards-showcase-w', `${st.showcaseW}px`);
      return;
    }
    if (key === 'galleryN') return; // 「一覧を作り直す」を押したときだけ反映する

    if (key === 'palette' || key === 'base') {
      renderAll(true);
      return;
    }
    renderLight();
    syncControls();
    settle();
  };

  /**
   * 畳んだ比較・一覧は、開いたときに初めて作る。
   * `toggle` は **バブルしない** ので、host 側では捕捉フェーズで拾う。
   */
  const onToggle = (ev: Event): void => {
    const d = ev.target;
    if (!(d instanceof HTMLDetailsElement)) return;
    if (d.id === 'cards-fold-rarity') {
      if (d.open) {
        if (stale.rarity) renderRarityCmp();
      } else clearLiveIn('#cards-cmp-rarity');
    } else if (d.id === 'cards-fold-finish') {
      if (d.open) {
        if (stale.finish) renderFinishCmp();
      } else clearLiveIn('#cards-cmp-finish');
    } else if (d.id === 'cards-fold-design') {
      if (d.open) {
        if (stale.design) renderDesignCmp();
      } else clearLiveIn('#cards-cmp-design');
    } else if (d.id === 'cards-fold-gallery') {
      if (d.open) {
        if (stale.gallery) renderGallery();
      } else clearLiveIn('#cards-gallery');
    }
  };

  /**
   * キーボードでめくる（PC の主動線）。
   *
   * 【なぜ要るか】
   *   スマホには画面下のデッキバーと左右スワイプがあるが、PC では
   *   「つぎのカード」が設定パネルの中にしか無く、カードから目を離して
   *   左端まで狙う必要があった。**次々に見る**のがこの Lab の使いかたなので、
   *   手を動かさずに送れる経路を用意する。
   *
   * 【文字入力を奪わない】
   *   seed を打っている最中に矢印キーを取ると、カーソル移動ができなくなる。
   *   入力欄・選択肢・別タブ表示中は必ず素通しする。
   */
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (host.hidden) return;
    const el = document.activeElement as HTMLElement | null;
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      el?.isContentEditable
    ) {
      return;
    }

    if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      nextCard();
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      prevCard();
    } else if (ev.key === 'f' || ev.key === 'F') {
      ev.preventDefault();
      flipShowcase();
    }
  };

  function scrollToStage(): void {
    $('#cards-stage', host)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ── スワイプでめくる ─────────────────────────────────
  //
  // 【マウスでは効かせない】
  //   ポインタを寄せると箔が動く（それが Showcase の見どころ）。
  //   マウスのドラッグまでめくりに使うと、箔を眺めるつもりの動きで
  //   カードが変わってしまう。指とペンだけを対象にする。

  let swipeX = 0;
  let swipeY = 0;
  let swipeId = -1;
  let swiping = false;
  /** スワイプ直後の click（＝拡大鑑賞）を 1 回だけ握りつぶす。 */
  let swiped = false;

  const onPointerDown = (ev: PointerEvent): void => {
    if (ev.pointerType === 'mouse') return;
    if (!(ev.target as HTMLElement | null)?.closest('#cards-stage')) return;
    swipeX = ev.clientX;
    swipeY = ev.clientY;
    swipeId = ev.pointerId;
    swiping = true;
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (!swiping || ev.pointerId !== swipeId) return;
    swiping = false;
    const dx = ev.clientX - swipeX;
    const dy = ev.clientY - swipeY;
    // 縦に流れている指はスクロールなので拾わない。
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    swiped = true;
    window.setTimeout(() => {
      swiped = false;
    }, 400);
    if (dx < 0) nextCard();
    else prevCard();
  };

  const onStageClickCapture = (ev: Event): void => {
    if (!swiped) return;
    if (!(ev.target as HTMLElement | null)?.closest('#cards-stage')) return;
    ev.stopPropagation();
    ev.preventDefault();
  };

  /** 広い画面へ戻したら、畳んでいた設定を開き直す。 */
  const onResize = (): void => {
    const settings = $<HTMLDetailsElement>('#cards-fold-settings', host);
    if (settings && !isNarrow() && !settings.open) settings.open = true;
  };

  // input だけを購読する。select も checkbox も input を発火するので
  // change を重ねると 1 操作で 2 回描き直してしまう。
  host.addEventListener('click', onStageClickCapture, true);
  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  host.addEventListener('toggle', onToggle, true);
  host.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);

  pushTrail(normalizeSeed(st.seed));
  renderAll(true);
  renderSaved();

  return {
    dispose() {
      disposed = true;
      window.clearTimeout(settleTimer);
      host.removeEventListener('click', onStageClickCapture, true);
      host.removeEventListener('click', onClick);
      host.removeEventListener('input', onInput);
      host.removeEventListener('toggle', onToggle, true);
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      clearLive();
    },
  };
}

// ─────────────────────────────────────────────────────────
//  DOM の骨組み
// ─────────────────────────────────────────────────────────

/** 比較の 1 枠（押せるボタン + カードの器 + ラベル）。 */
function slotButton(label: string, on: boolean): HTMLElement {
  const b = document.createElement('button');
  b.className = 'cards-slot';
  b.type = 'button';
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.innerHTML = `<span class="cards-slot-card"></span><span class="cards-slot-label"></span>`;
  const lab = b.querySelector('.cards-slot-label');
  if (lab) lab.textContent = label;
  return b;
}

function slotBody(slot: HTMLElement): HTMLElement {
  return slot.querySelector<HTMLElement>('.cards-slot-card') ?? slot;
}

function seg(key: string, items: readonly { v: string; label: string }[]): string {
  return (
    `<span class="seg">` +
    items
      .map((i) => `<button type="button" data-set="${esc(key)}=${esc(i.v)}">${esc(i.label)}</button>`)
      .join('') +
    `</span>`
  );
}

function range(key: string, min: number, max: number, step: number, value: number, label: string): string {
  return (
    `<label class="f">${esc(label)}` +
    `<input type="range" data-bind="${esc(key)}" min="${min}" max="${max}" step="${step}" value="${value}">` +
    `<output>${value}</output></label>`
  );
}

function check(key: string, label: string, on: boolean): string {
  return (
    `<label class="f"><input type="checkbox" data-bind="${esc(key)}"${on ? ' checked' : ''}>${esc(label)}</label>`
  );
}

/**
 * 折りたたみ 1 つ。
 * 狭い画面では既定で閉じ、開くまで中身を作らない（cardLab の `foldOpen`）。
 */
function fold(id: string, title: string, body: string, open: boolean, extraClass = ''): string {
  return (
    `<details class="cards-fold ${extraClass}" id="${esc(id)}"${open ? ' open' : ''}>` +
    `<summary>${esc(title)}</summary>` +
    `<div class="cards-fold-body">${body}</div>` +
    `</details>`
  );
}

function shell(st: CardPrefs, reducedMotion: boolean, narrow: boolean): string {
  const finishOptions = (group: boolean): string =>
    CARD_FINISHES.filter((f) => f.core === group)
      .map((f) => `<option value="${f.id}"${f.id === st.finish ? ' selected' : ''}>${esc(f.label)}</option>`)
      .join('');

  const settings =
    `<div class="card"><h2>個体</h2>` +
    `<div class="row"><input type="text" id="cards-seed" class="grow" value="${esc(st.seed)}" spellcheck="false">` +
    `<button class="primary" data-act="apply">表示</button></div>` +
    `<div class="row"><button data-act="random">つぎのカード</button>` +
    `<button data-act="regen">同 seed で再生成</button>` +
    `<button data-act="copy-seed">seed をコピー</button></div>` +
    `<div class="row">` +
    `<label class="f">素体<select data-bind="base">` +
    `<option value=""${st.base === '' ? ' selected' : ''}>指定なし</option>` +
    BODY_BASES.map(
      (b) => `<option value="${b}"${st.base === b ? ' selected' : ''}>${esc(BASE_LABEL[b])}</option>`,
    ).join('') +
    `</select></label>` +
    `<label class="f">配色<select data-bind="palette">` +
    `<option value=""${st.palette === '' ? ' selected' : ''}>指定なし</option>` +
    PALETTE_FAMILIES.map(
      (p) =>
        `<option value="${p.id}"${st.palette === p.id ? ' selected' : ''}>${esc(p.label)}${p.rare ? '（稀）' : ''}</option>`,
    ).join('') +
    `</select></label>` +
    seg('force', [
      { v: 'true', label: '強制' },
      { v: 'false', label: '絞り込み' },
    ]) +
    `</div>` +
    `<p class="hint">カードは成体で見ます。ここで作る個体は Visual Lab・本編と同じ生成経路（gen.ts）です。</p>` +
    `</div>` +

    `<div class="card"><h2>Design</h2>` +
    `<div class="row">` +
    seg('design', CARD_DESIGNS.map((d) => ({ v: d.id, label: d.legacy ? `${d.label}（旧）` : d.label }))) +
    `</div>` +
    `<p class="hint" id="cards-design-note">${esc(CARD_DESIGN_BY_ID[st.design].note)}</p>` +
    `</div>` +

    // ── 段（rarity）──
    //   AUTO は実データ。強制は **見た目だけ** のオーバーライドで、
    //   遺伝データにも Phenotype にも触らない（§19）。
    `<div class="card"><h2>Rarity</h2>` +
    `<div class="row">` +
    seg('rarity', [
      { v: 'auto', label: 'AUTO' },
      ...CARD_RANKS.map((r) => ({ v: r.id, label: r.label })),
    ]) +
    `</div>` +
    `<p class="hint" id="cards-rarity-note"></p>` +
    `<p class="hint">強制しても遺伝データは変わりません（カード面の見た目だけ）。実データは説明文に併記します。</p>` +
    `</div>` +

    `<div class="card"><h2>Finish</h2>` +
    `<div class="row"><label class="f grow">仕上げ<select data-bind="finish" class="grow">` +
    `<option value="auto"${st.finish === 'auto' ? ' selected' : ''}>AUTO（段が決める）</option>` +
    `<optgroup label="主要">${finishOptions(true)}</optgroup>` +
    `<optgroup label="その他">${finishOptions(false)}</optgroup>` +
    `</select></label></div>` +
    `<p class="hint">箔は foil マスクで枠・ロゴ・段の帯・認証印だけに掛かります。Collector v2 では、` +
    `どこに掛かるかを段そのものが決めます（STANDARD は箔ゼロ）。</p>` +
    `</div>` +

    `<div class="card"><h2>認証印</h2>` +
    `<div class="row">` +
    seg('seal', [
      { v: 'auto', label: 'AUTO' },
      { v: 'ink', label: 'インク' },
      { v: 'inkFoil', label: '縁だけ箔' },
      { v: 'silver', label: '銀箔' },
      { v: 'gold', label: '金箔' },
      { v: 'holo', label: 'ホロ箔' },
    ]) +
    `</div>` +
    `<p class="hint">紙に押したインク → 箔押し → ホロ箔押し。素材そのものが格を語ります。</p>` +
    `</div>` +

    `<div class="card"><h2>Grade</h2>` +
    `<div class="row">${seg('grade', CARD_GRADES.map((g) => ({ v: String(g), label: String(g) })))}</div>` +
    `<p class="hint">現段階では手動。ゲーム内の鑑定ロジックとは連動しません。</p>` +
    `</div>` +

    `<div class="card"><h2>Visual</h2>` +
    `<div class="row">${range('foil', 0, 1.5, 0.05, st.foil, '箔')}` +
    `${range('glare', 0, 1.5, 0.05, st.glare, '映り込み')}</div>` +
    `<div class="row">${range('tilt', 0, 1.5, 0.05, st.tilt, '傾き')}` +
    `${range('showcaseW', 300, 560, 10, st.showcaseW, '幅')}</div>` +
    `<div class="row">${check('depth', '箔の 3D 押し出し', st.depth)}` +
    `${check('mask', 'foil マスク', st.mask)}` +
    `${check('security', 'セキュリティ模様', st.security)}</div>` +
    `<div class="row"><label class="f">背景</label>` +
    seg('bg', [
      { v: 'dark', label: '暗' },
      { v: 'light', label: '明' },
    ]) +
    `</div>` +
    (reducedMotion
      ? `<p class="hint warn">OS が「動きを減らす」設定なので、傾きを止めています。</p>`
      : `<p class="hint">「foil マスク」を切ると、箔がカード全面に掛かる悪い例を確認できます。</p>`) +
    `</div>` +

    `<div class="card"><h2>保存（Cards Lab 専用キー）</h2>` +
    `<div class="row"><input type="text" id="cards-note" class="grow" placeholder="なぜ良いと思ったか"></div>` +
    `<div class="row"><button class="primary" data-act="save">この組み合わせを保存</button>` +
    `<button class="danger" data-act="clear-saved">すべて削除</button></div>` +
    `<div class="cards-saved" id="cards-saved"></div>` +
    `</div>`;

  return (
    `<div class="cards-wrap${narrow ? ' cards-wrap--narrow' : ''}">` +
    // ── 見る場（狭い画面では CSS の order でこちらが上に来る）──
    `<div class="cards-right">` +
    `<div class="card cards-showcard"><h2>Showcase</h2>` +
    `<div class="cards-stage" id="cards-stage" data-bg="${esc(st.bg)}">` +
    `<div class="cards-showcase" id="cards-showcase" style="--cards-showcase-w:${st.showcaseW}px"></div>` +
    `</div>` +
    `<p class="cards-caption" id="cards-caption"></p>` +
    // 【カードの真下に「つぎ」を置く（PC の主動線）】
    //   スマホのデッキバーと同じ並びを、固定バーではなくカードの直下へ置く。
    //   設定パネルの中にしか「つぎのカード」が無かったので、
    //   PC では毎回カードから目を離して左端まで狙う必要があった。
    //   狭い画面ではデッキバーが同じ役割を担うので、この列は出さない。
    `<div class="cards-deal">` +
    `<button type="button" data-act="prev" aria-label="前のカードへ戻る">◀</button>` +
    `<button type="button" class="primary cards-deal-main" data-act="next">つぎのカード</button>` +
    `<button type="button" data-act="flip" aria-pressed="false">表 ／ 裏</button>` +
    `<button type="button" class="cards-deal-save" data-act="save-quick" ` +
    `aria-label="このカードを保存">♥</button>` +
    `<span class="hint cards-deal-keys">` +
    `<kbd>←</kbd> <kbd>→</kbd> でめくる・<kbd>F</kbd> で裏返す（カード本体をクリックでも裏返ります）` +
    `</span>` +
    `</div>` +
    `</div>` +

    fold(
      'cards-fold-rarity',
      '段の比較（同じ個体・STANDARD → MYTHIC）',
      `<div class="cards-strip" id="cards-cmp-rarity" data-bg="${esc(st.bg)}"></div>` +
        `<p class="hint">見た目だけの強制です。遺伝データは変わりません。` +
        `タップでその段を Showcase へ送り、もう一度押すと AUTO（実データ）へ戻します。</p>`,
      !narrow,
    ) +

    fold(
      'cards-fold-finish',
      'Finish 比較（同じ個体・同じ Design）',
      `<div class="cards-strip" id="cards-cmp-finish" data-bg="${esc(st.bg)}"></div>` +
        `<p class="hint">タップするとその仕上げを Showcase へ送ります。</p>`,
      !narrow,
    ) +

    fold(
      'cards-fold-design',
      'Design 比較（同じ個体・同じ Finish）',
      `<div class="cards-strip" id="cards-cmp-design" data-bg="${esc(st.bg)}"></div>`,
      !narrow,
    ) +

    fold(
      'cards-fold-gallery',
      '個体比較（同じ Design・同じ Finish）',
      `<div class="row"><label class="f">体数<input type="number" data-bind="galleryN" min="4" max="30" step="1" value="${st.galleryN}" style="width:66px"></label>` +
        `<button class="primary" data-act="gallery">一覧を作り直す</button></div>` +
        `<div class="cards-gallery" id="cards-gallery" data-bg="${esc(st.bg)}"></div>` +
        `<p class="hint" id="cards-gallery-note"></p>`,
      !narrow,
    ) +
    `</div>` +

    // ── 設定（狭い画面では畳んでカードの下へ）──
    `<div class="cards-left">` +
    fold('cards-fold-settings', '設定', settings, !narrow, 'cards-fold--settings') +
    `</div>` +
    `</div>` +

    // ── 親指の届く所（狭い画面だけ表示）──
    `<div class="cards-deck" role="group" aria-label="カードをめくる">` +
    `<button type="button" class="cards-deck-btn" data-act="prev" aria-label="前のカードへ戻る">◀</button>` +
    `<button type="button" class="cards-deck-btn cards-deck-main" data-act="next">つぎのカード</button>` +
    `<button type="button" class="cards-deck-btn cards-deck-swap" data-act="cycle-design" aria-label="版面をかえる">` +
    `<i>版面</i><b id="cards-deck-design">${esc(CARD_DESIGN_BY_ID[st.design].label)}</b></button>` +
    `<button type="button" class="cards-deck-btn cards-deck-swap" data-act="cycle-finish" aria-label="仕上げをかえる">` +
    `<i>箔</i><b id="cards-deck-finish">${st.finish === 'auto' ? 'AUTO' : esc(CARD_FINISH_BY_ID[st.finish].label)}</b></button>` +
    `<button type="button" class="cards-deck-btn cards-deck-swap" data-act="flip" aria-label="カードを裏返す" aria-pressed="false">` +
    `<i>面</i><b id="cards-deck-face">表</b></button>` +
    `<button type="button" class="cards-deck-btn cards-deck-save" data-act="save-quick" aria-label="このカードを保存">♥</button>` +
    `</div>`
  );
}
