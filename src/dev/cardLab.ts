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
  deriveCardFacts,
  type CardDesign,
  type CardFinish,
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
  finish: CardFinish;
  grade: CardGrade;
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
  design: 'certified',
  finish: 'prism',
  grade: 9,
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

/** デッキバーの「箔をかえる」が回す順番。主要 8 種だけ。 */
const CYCLE_FINISHES: readonly CardFinish[] = CARD_FINISHES.filter((f) => f.core).map((f) => f.id);

/** 履歴に残すカードの枚数。めくり戻せれば十分なので上限は控えめ。 */
const HISTORY_MAX = 80;

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
  const stale = { finish: true, design: true, gallery: true };

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

  function cardSpecOf(sp: Specimen, design: CardDesign, finish: CardFinish, quality: CardQuality): CardSpec {
    return {
      pheno: sp.pheno,
      facts: deriveCardFacts(sp.pheno, st.grade),
      design,
      finish,
      quality,
      creatureSvg: drawSpecimen(sp.model, {
        background: null,
        debug: false,
        width: '100%',
        height: '100%',
      }),
      visuals: visuals(),
    };
  }

  /** 1 枚ぶんを作って器へ入れ、後始末リストへ積む。 */
  function place(
    into: HTMLElement,
    sp: Specimen,
    design: CardDesign,
    finish: CardFinish,
    quality: CardQuality,
  ): void {
    const m = mountCard(cardSpecOf(sp, design, finish, quality));
    into.appendChild(m.element);
    live.push(m);
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

    place(box, current, st.design, st.finish, 'full');

    const facts = deriveCardFacts(current.pheno, st.grade);
    const pos = trail.length > 1 ? ` <span class="cards-count">${trailAt + 1}/${trail.length}</span>` : '';
    setHtml(
      cap,
      `<b>${esc(cardTitle(facts, st.design, st.finish))}</b>${pos}<br>` +
        `<span class="cards-cap-sub">seed <code>${esc(current.seed)}</code> · ${esc(facts.certId)} · ` +
        `${esc(facts.baseLabel)}・${esc(facts.paletteLabel)} · rarity ${facts.rarityScore.toFixed(1)}` +
        `（${esc(facts.rarityLabel)}）</span>` +
        `<span class="cards-cap-tip">タップで拡大鑑賞／左右スワイプでめくる</span>` +
        (current.issues.length
          ? `<br><span class="warn">自動検査: ${esc(current.issues.join(' / '))}</span>`
          : ''),
    );
  }

  // ── Finish 比較 ──────────────────────────────────────

  /** 畳んである間は作らない。開いたときに `onToggle` が呼び直す。 */
  function foldOpen(id: string): boolean {
    return $<HTMLDetailsElement>(id, host)?.open ?? false;
  }

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
      place(slotBody(slot), current, st.design, fin, 'medium');
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
      const slot = slotButton(d.label, d.id === st.design);
      slot.dataset.design = d.id;
      strip.appendChild(slot);
      place(slotBody(slot), current, d.id, st.finish, 'medium');
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
      place(slotBody(slot), sp, st.design, st.finish, 'lite');
    }
    const note = $('#cards-gallery-note', host);
    if (note) {
      note.textContent =
        `${found} 体（${CARD_DESIGN_BY_ID[st.design].label} × ${CARD_FINISH_BY_ID[st.finish].label}）。` +
        `タップで Showcase へ送ります。一覧は静止表示（tilt / depth なし）です。`;
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
      finish: st.finish,
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
      clearLiveIn('#cards-cmp-finish');
      clearLiveIn('#cards-cmp-design');
      renderFinishCmp();
      renderDesignCmp();
      renderGallery();
    }, 220);
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
    const deckDesign = $('#cards-deck-design', host);
    if (deckDesign) deckDesign.textContent = CARD_DESIGN_BY_ID[st.design].label;
    const deckFinish = $('#cards-deck-finish', host);
    if (deckFinish) deckFinish.textContent = CARD_FINISH_BY_ID[st.finish].label;
    const back = $<HTMLButtonElement>('[data-act="prev"]', host);
    if (back) back.disabled = trailAt <= 0;
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

  function cycleFinish(): void {
    const i = CYCLE_FINISHES.indexOf(st.finish);
    const next = CYCLE_FINISHES[(i + 1) % CYCLE_FINISHES.length]!;
    st.finish = next;
    persist();
    renderLight();
    syncControls();
    settle();
    deps.toast(`仕上げ: ${CARD_FINISH_BY_ID[next].label}`, 'info');
  }

  const onClick = (ev: Event): void => {
    const t = ev.target as HTMLElement | null;
    if (!t) return;

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
      if (slot.dataset.finish) {
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
    if (d.id === 'cards-fold-finish') {
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
    seg('design', CARD_DESIGNS.map((d) => ({ v: d.id, label: d.label }))) +
    `</div>` +
    `<p class="hint" id="cards-design-note">${esc(CARD_DESIGN_BY_ID[st.design].note)}</p>` +
    `</div>` +

    `<div class="card"><h2>Finish</h2>` +
    `<div class="row"><label class="f grow">仕上げ<select data-bind="finish" class="grow">` +
    `<optgroup label="主要">${finishOptions(true)}</optgroup>` +
    `<optgroup label="その他">${finishOptions(false)}</optgroup>` +
    `</select></label></div>` +
    `<p class="hint">箔は foil マスクで枠・ロゴ・Grade・罫線だけに掛かります（Collector だけ個体の周りも光ります）。</p>` +
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
    `</div>` +

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
    `<i>箔</i><b id="cards-deck-finish">${esc(CARD_FINISH_BY_ID[st.finish].label)}</b></button>` +
    `<button type="button" class="cards-deck-btn cards-deck-save" data-act="save-quick" aria-label="このカードを保存">♥</button>` +
    `</div>`
  );
}
