/**
 * 育成室。ゲームの本拠地。
 *
 * 【最優先】ゲノモンが主役。
 *   舞台（stage）は画面上部に置き、パネル・ボタンは一切重ねない。
 *   ただし **「なでる → 反応を見る」が同時に成立すること** を舞台の大きさより優先する。
 *   世話ボタンが初期表示で 1 つも見えないと、目標行が「世話しましょう」と言っても
 *   実行手段が画面に無いことになるため、
 *     - スマホ … 世話パネルを下部に貼り付け（sticky）、舞台と同時に見えるようにする
 *     - PC    … 舞台と操作卓を 2 列に並べ、どちらもファーストビューに入れる
 *   という構成にしている。舞台の高さはその制約から逆算した値。
 *
 * 【連打は損、という事実を画面に出す】
 *   効果倍率は「直前の世話からの経過時間」に比例する（game/config.ts の SATIATION）。
 *   つまり最適な遊び方は「1 回押して待つ」で、連打は遅くなる。
 *   以前の説明文は「別の世話をしてみましょう」＝もっと押せ、と真逆の指示をしていた。
 *   ここでは効き目メーターと「あと ○ 秒で 全効果」のカウントダウンを出し、
 *   押す価値のある瞬間そのものを見せる。
 *
 * 【更新方式】
 *   ゲノモンの SVG は作り直すと待機モーションが途切れるので、
 *   個体・段階が変わったときだけ作り直し、ゲージとボタンだけを 250ms ごとに書き換える。
 */

import type { CareAction, CareResult, Creature, Stage } from '../../core/types.ts';
import { icon, iconOrText } from '../icons.ts';
import { playReaction, reactionForCare } from '../../render/anim.ts';
import { sfx } from '../../audio/index.ts';
import type { App, Screen } from '../app.ts';
import type { TickReport } from '../gameApi.ts';
import { $, burstSparkles, delegate, el, esc, playOnce, setHtml } from '../dom.ts';
import { mountCreature, thumbSvg } from '../creatureView.ts';
import { emptyState, gaugesFor } from '../components/bits.ts';
import { pageHeader } from '../app.ts';
import { toast } from '../components/toast.ts';
import { CARE_SFX, DECOR_VIEW, STAGE_ICON, STAGE_LABEL, levelOf, pct } from '../format.ts';
import { GAUGES_EGG, GAUGES_LIVE } from '../format.ts';
import {
  CARE_DEFS,
  careActionsFor,
  careAvailability,
  capacityUsed,
  doCare,
  findCreature,
  getPhenotype,
} from '../gameApi.ts';

/** 効き目が「ほぼ全開」とみなす倍率。 */
const FULL_EFF = 0.98;
/** 効き目が全開に戻るまでを探す上限（飽きの完全回復が 90 秒なので余裕を見る）。 */
const ETA_SEARCH_MAX_MS = 150_000;

/**
 * その世話の効き目が全開に戻るまでの残り ms。
 *
 * `careAvailability` は state と now だけで決まる純関数（副作用なし）なので、
 * **未来の時刻を渡して二分探索する**ことで「いつ全開になるか」を聞き出せる。
 * SATIATION.fullMs などの内部定数は公開契約（game/API.md）に無いため、
 * UI 側に数値を写さずに済むこの方法を採る。
 */
function msUntilFullEffect(app: App, creatureId: string, action: CareAction, now: number): number {
  const effAt = (t: number): number => careAvailability(app.state, creatureId, action, t).effectiveness;
  if (effAt(now) >= FULL_EFF) return 0;

  let lo = 0;
  let hi = 1000;
  while (hi < ETA_SEARCH_MAX_MS && effAt(now + hi) < FULL_EFF) {
    lo = hi;
    hi *= 2;
  }
  if (effAt(now + hi) < FULL_EFF) return ETA_SEARCH_MAX_MS;

  for (let i = 0; i < 12 && hi - lo > 250; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (effAt(now + mid) >= FULL_EFF) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function screenNursery(app: App, host: HTMLElement): Screen {
  // 個体が 1 体もいないときは、空の舞台と反応しないボタンを並べない。
  // 何をすればよいかだけを出して、卵選択へ送る。
  if (app.state.creatures.length === 0) {
    host.innerHTML =
      pageHeader('育成室', undefined, 'sprout') +
      emptyState('egg', ['まだ ゲノモンが いません。', 'まずは 育てる 卵を えらびましょう。']) +
      `<div class="row" style="justify-content:center">` +
      `<a class="btn btn--lg" href="#/eggSelect" data-goto="/eggSelect">卵を えらぶ</a></div>`;
    return {};
  }

  let stopMotion: () => void = () => {};
  /** いま舞台に立てている個体の「見た目キー」。変わったら描き直す。 */
  let mountedKey = '';
  let speechTimer = 0;
  let evolveTimer = 0;

  /**
   * 「全開に戻る時刻」のキャッシュ。
   *
   * 効き目は lastCareAt だけで決まり、それが変わるのは世話をした瞬間だけ。
   * だから残り時間を毎 tick 二分探索し直す必要はなく、
   * 「いつ全開になるか」を一度求めて、あとは引き算するだけでよい。
   */
  let etaKey = '';
  let etaAt: Partial<Record<CareAction, number>> = {};

  // 【DOM の並び】switcher → 舞台 → 操作卓 → ゲージ類。
  //   スマホは 1 列なので、この順で「生きもの」と「世話ボタン」が隣り合う。
  //   PC は grid-template-areas で 2 列（左：舞台とゲージ／右：操作卓）に組み替える。
  host.innerHTML =
    `<div class="nursery">` +
    `<div class="switcher" data-switcher role="group" aria-label="育てている ゲノモン"></div>` +
    `<div class="nursery__view">` +
    `<div class="stage" data-stage>` +
    `<div class="stage__tag"><span class="nameplate" data-nameplate></span></div>` +
    `<div class="decor-layer" data-decor></div>` +
    `<div class="stage__art" data-art></div>` +
    `</div>` +
    `</div>` +
    `<div class="nursery__ctrl">` +
    `<div class="card care-panel">` +
    `<div class="care-panel__head"><h2 class="section__title"><span aria-hidden="true">${icon('hands')}</span>おせわ</h2></div>` +
    `<div class="care-meter" data-meter></div>` +
    `<div class="care" data-care></div>` +
    `<p class="section__note care-panel__note" data-carenote></p>` +
    `</div>` +
    `</div>` +
    `<div class="nursery__info">` +
    `<div class="card card--tight" data-gauges></div>` +
    `<div class="row"><span class="pill" data-capacity></span>` +
    `<span class="grow"></span>` +
    `<a class="btn btn--ghost btn--sm" data-detail href="#/nursery">この子を くわしく見る</a></div>` +
    `</div>` +
    `</div>`;

  const stageEl = $('[data-stage]', host);
  const artEl = $('[data-art]', host);
  const nameEl = $('[data-nameplate]', host);
  const gaugeEl = $('[data-gauges]', host);
  const careEl = $('[data-care]', host);
  const careNote = $('[data-carenote]', host);
  const meterEl = $('[data-meter]', host);
  const switcherEl = $('[data-switcher]', host);
  const decorEl = $('[data-decor]', host);
  const capEl = $('[data-capacity]', host);
  const detailLink = $<HTMLAnchorElement>('[data-detail]', host);
  const viewEl = $('.nursery__view', host);
  const ctrlEl = $('.nursery__ctrl', host);

  // ── 舞台の高さ合わせ ────────────────────────────────
  //
  // スマホでは操作卓を画面下部に貼り付けるので、舞台がそのぶん隠れうる。
  // 「生きものを見る」と「世話する」は同時に成立しないと育成ゲームにならないため、
  // 操作卓と重ならない最大の高さを実測して舞台に与える。
  //
  // 操作卓の高さは自分の内容と幅だけで決まり、舞台の高さには依存しない。
  // だから測って入れ直しても循環しない。
  /** 舞台の最小の高さ。これを割るくらいなら少し重なった方がまし。 */
  const STAGE_MIN_PX = 150;

  function fitStage(): void {
    if (!viewEl || !ctrlEl || !artEl) return;
    // PC は 2 列で並ぶので調整不要。CSS に任せる。
    if (window.innerWidth >= 900) {
      artEl.style.removeProperty('max-height');
      return;
    }
    const nav = document.querySelector('.nav');
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const viewTop = viewEl.getBoundingClientRect().top + window.scrollY;
    const ctrlH = ctrlEl.getBoundingClientRect().height;
    // 26px = 貼り付きの余白（6）＋ 舞台と操作卓のすき間（12）＋ 枠線などの端数（8）
    const avail = window.innerHeight - viewTop - ctrlH - navH - 26;
    artEl.style.maxHeight = `${Math.round(Math.max(STAGE_MIN_PX, avail))}px`;
  }

  let fitRaf = 0;
  function scheduleFit(): void {
    if (fitRaf) return;
    fitRaf = window.requestAnimationFrame(() => {
      fitRaf = 0;
      fitStage();
    });
  }

  // 操作卓の高さは世話の理由文（何行になるか）で変わるので、変化を監視して追従する。
  const ro =
    typeof ResizeObserver !== 'undefined' && ctrlEl
      ? new ResizeObserver(() => scheduleFit())
      : null;
  ro?.observe(ctrlEl!);
  window.addEventListener('resize', scheduleFit);

  /** いま世話をする対象。 */
  function active(): Creature | undefined {
    const id = app.state.activeCreatureId;
    const found = id ? findCreature(app.state, id) : undefined;
    if (found) return found;
    const first = app.state.creatures[0];
    if (first) app.state.activeCreatureId = first.id;
    return first;
  }

  // ── 舞台 ────────────────────────────────────────────
  function renderStage(): void {
    const c = active();
    if (!c || !artEl) return;

    const key = `${c.id}:${c.life.stage}`;
    if (key !== mountedKey) {
      stopMotion();
      const pheno = getPhenotype(c, c.life.stage);
      stopMotion = mountCreature(artEl, pheno, c.life, {
        detail: 'full',
        title: `${c.name}（${STAGE_LABEL[c.life.stage]}）`,
        creature: c,
        reducedMotion: app.reducedMotion,
      });
      mountedKey = key;
    }

    setHtml(
      nameEl,
      `<span aria-hidden="true">${iconOrText(STAGE_ICON[c.life.stage])}</span>` +
        `<span>${esc(c.name)}</span>`,
    );
    if (detailLink) detailLink.href = `#/detail/${encodeURIComponent(c.id)}`;
  }

  /** 購入した装飾・設備を育成室の見た目に反映する。 */
  function renderDecor(): void {
    if (!decorEl) return;
    const items = app.state.owned
      .map((id) => DECOR_VIEW[id])
      .filter((d): d is (typeof DECOR_VIEW)[string] => !!d);
    setHtml(
      decorEl,
      items
        .map(
          (d) =>
            `<span class="decor ${d.cls}" title="${esc(d.label)}" aria-hidden="true">` +
            `${iconOrText(d.glyph)}</span>`,
        )
        .join(''),
    );
  }

  // ── 切り替えタブ ────────────────────────────────────
  function renderSwitcher(): void {
    if (!switcherEl) return;
    const cur = app.state.activeCreatureId;
    const html = app.state.creatures
      .map((c) => {
        const pheno = getPhenotype(c, c.life.stage);
        const thumb = thumbSvg(pheno, c.life);
        return (
          `<button type="button" class="switcher__btn" data-pick="${esc(c.id)}"` +
          ` aria-pressed="${c.id === cur ? 'true' : 'false'}">` +
          `<span class="switcher__thumb" aria-hidden="true">${thumb}</span>` +
          `<span>${esc(c.name)}</span></button>`
        );
      })
      .join('');
    setHtml(switcherEl, html);
  }

  // ── ゲージ ──────────────────────────────────────────
  function renderGauges(full = false): void {
    const c = active();
    if (!c || !gaugeEl) return;
    if (full || !gaugeEl.querySelector('.gauge')) {
      setHtml(gaugeEl, gaugesFor(c));
      return;
    }
    // 部分更新（作り直すとトランジションが効かないので値だけ書き換える）
    const defs = c.life.stage === 'egg' ? GAUGES_EGG : GAUGES_LIVE;
    for (const d of defs) {
      const node = gaugeEl.querySelector(`[data-gauge="${String(d.key)}"]`);
      if (!node) {
        setHtml(gaugeEl, gaugesFor(c));
        return;
      }
      let v = Number(c.life[d.key] ?? 0);
      if (d.key === 'growth' && c.life.stage === 'adult') v = 100;
      const p = pct(v);
      const fill = node.querySelector<HTMLElement>('.gauge__fill');
      const val = node.querySelector('.gauge__val');
      const track = node.querySelector('.gauge__track');
      if (fill) {
        fill.style.width = `${p}%`;
        fill.dataset.level = levelOf(p);
      }
      if (val) val.textContent = String(p);
      track?.setAttribute('aria-valuenow', String(p));
    }
  }

  // ── 効き目の残り時間 ────────────────────────────────

  /** 「全開に戻る時刻」を必要なら計算し直す。 */
  function refreshEta(c: Creature, now: number): void {
    const key = `${c.id}:${c.life.stage}:${c.life.careCount}`;
    if (key === etaKey) return;
    etaKey = key;
    etaAt = {};
    for (const a of careActionsFor(c.life.stage)) {
      etaAt[a] = now + msUntilFullEffect(app, c.id, a, now);
    }
  }

  /** その世話が全開に戻るまでの残り秒（0 なら押しどき）。 */
  function etaSec(action: CareAction, now: number): number {
    const at = etaAt[action];
    if (at === undefined) return 0;
    return Math.max(0, Math.ceil((at - now) / 1000));
  }

  // ── 世話ボタン ──────────────────────────────────────

  /**
   * いま描画している世話ボタンの並び。
   *
   * 【なぜ差分更新にするのか】
   *   以前は 250ms ごとに `setHtml` でパネルごと作り直していた。
   *   押した瞬間にボタンの DOM が消えるので、
   *   キーボードで遊んでいる人のフォーカスが毎回 body へ飛び、
   *   「押した直後に、もう一度押す」ことができなかった。
   *   段階が変わってボタンの顔ぶれが変わったときだけ作り直し、
   *   ふだんは中身（理由文・効き目・活性）だけを書き換える。
   */
  let careKeys = '';
  /** 直前にフォーカスしていた世話ボタン（クールダウンで disabled になると失われるため）。 */
  let focusedCare: CareAction | null = null;
  /** 直近の操作がキーボードだったか。フォーカスを返すのはそのときだけにする。 */
  let keyboardMode = false;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') keyboardMode = true;
  };
  const onPointerDown = (): void => {
    keyboardMode = false;
  };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', onPointerDown, true);

  interface CareSpec {
    action: CareAction;
    enabled: boolean;
    note: string;
    label: string;
    hint: string;
    icon: string;
    text: string;
    effPct: number;
    level: string;
  }

  function careBtnHtml(s: CareSpec): string {
    return (
      `<button type="button" class="care__btn" data-care="${esc(s.action)}"` +
      (s.enabled ? '' : ' disabled') +
      ` title="${esc(s.hint)}" aria-label="${esc(s.label)}">` +
      `<span class="care__ico" aria-hidden="true">${iconOrText(s.icon)}</span>` +
      `<span class="care__label">${esc(s.text)}</span>` +
      // 空でも必ず置く。あとから中身だけ差し替えられるようにするため（CSS で :empty は隠す）。
      `<span class="care__note" data-note>${esc(s.note)}</span>` +
      `<span class="care__eff" aria-hidden="true"><i data-eff data-level="${esc(s.level)}" style="width:${s.effPct}%"></i></span>` +
      `</button>`
    );
  }

  /** ボタンを作り直さずに中身だけ更新する。戻り値 false なら作り直しが要る。 */
  function patchCareBtn(s: CareSpec): boolean {
    const btn = careEl?.querySelector<HTMLButtonElement>(`[data-care="${s.action}"]`);
    if (!btn) return false;
    if (btn.disabled !== !s.enabled) btn.disabled = !s.enabled;
    if (btn.getAttribute('aria-label') !== s.label) btn.setAttribute('aria-label', s.label);
    const note = btn.querySelector('[data-note]');
    if (note && note.textContent !== s.note) note.textContent = s.note;
    const bar = btn.querySelector<HTMLElement>('[data-eff]');
    if (bar) {
      const w = `${s.effPct}%`;
      if (bar.style.width !== w) bar.style.width = w;
      if (bar.dataset.level !== s.level) bar.dataset.level = s.level;
    }
    return true;
  }

  function renderCare(): void {
    const c = active();
    if (!c || !careEl) return;
    const now = Date.now();
    const actions = careActionsFor(c.life.stage);
    refreshEta(c, now);

    /** 効き目メーターの見た目（0..1 → good / mid / low）。 */
    const levelFor = (eff: number): string => (eff >= 0.75 ? 'good' : eff >= 0.45 ? 'mid' : 'low');

    let bestEff = 0;
    let soonest = Number.POSITIVE_INFINITY;

    const specs: CareSpec[] = actions.map((a) => {
      const ui = CARE_DEFS[a];
      const av = careAvailability(app.state, c.id, a, now);
      const eff = Math.max(0, Math.min(1, av.effectiveness));
      const left = etaSec(a, now);
      if (eff > bestEff) bestEff = eff;
      if (left < soonest) soonest = left;

      // 【重要】文言は game の careAvailability が返す reason をそのまま出す。
      //   以前は effectiveness だけを見て UI 側で組み立てていたため、
      //   一度も使っていない世話にまで「あきているみたい」と出ていた。
      //   満足と飽きを区別できるのは game 側だけなので、判断を持ち込まない。
      const note = av.reason ?? (left > 0 ? `あと ${left} 秒で 全効果` : '');
      return {
        action: a,
        enabled: av.enabled,
        note,
        label: `${ui.label}。${note || ui.hint}`,
        hint: ui.hint,
        icon: ui.icon,
        text: ui.label,
        effPct: Math.round(eff * 100),
        level: levelFor(eff),
      };
    });

    const keys = actions.join(',');
    if (keys !== careKeys || specs.some((s) => !patchCareBtn(s))) {
      careKeys = keys;
      setHtml(careEl, specs.map(careBtnHtml).join(''));
    }

    // クールダウンで disabled になった瞬間、ブラウザはフォーカスを body へ落とす。
    // 押せる状態に戻ったら、キーボードで遊んでいる人にフォーカスを返す。
    // 押したボタン自身は 5〜20 秒の個別クールダウンに入っていることが多いので、
    // それが明けていなければ「いま押せるボタン」へ渡す（Tab のやり直しをさせない）。
    if (keyboardMode && focusedCare && document.activeElement === document.body) {
      const same = careEl.querySelector<HTMLButtonElement>(`[data-care="${focusedCare}"]`);
      const target =
        same && !same.disabled ? same : careEl.querySelector<HTMLButtonElement>('.care__btn:not([disabled])');
      target?.focus({ preventScroll: true });
    }

    renderMeter(bestEff, Number.isFinite(soonest) ? soonest : 0, levelFor(bestEff));

    if (careNote) {
      // 【文言を実測に合わせてある】
      //   以前は「別の世話を してみましょう」＝もっと押せ、と真逆を案内していた。
      //   それを「連打しても 早くは なりません。」と断定形に直したが、
      //   リードが孵化まで通しで測ると **連打はまだ 1.26 倍速かった**
      //   （2 秒間隔 69.8 秒 / 35 クリック vs 18 秒間隔 87.8 秒 / 5 クリック）。
      //   満足度関数だけを取り出すと間隔によらず一定なのに、通しでは一致しない。
      //   断定形のまま置くと画面が嘘をつくことになるので、
      //   **手数の差**（7 倍）という確実に正しい事実で言い切る形にした。
      //   詳細は DESIGN_DECISIONS D-023。
      careNote.textContent =
        '「効き目」が もどってから 押すと、少ない 回数で 同じだけ 育ちます。';
    }
  }

  /** 効き目メーター（押しどきの可視化）。 */
  function renderMeter(bestEff: number, leftSec: number, level: string): void {
    if (!meterEl) return;
    const p = Math.round(bestEff * 100);
    const ready = leftSec <= 0;
    setHtml(
      meterEl,
      `<span class="care-meter__k">いまの 効き目</span>` +
        `<span class="care-meter__bar" role="meter" aria-label="世話の 効き目"` +
        ` aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100">` +
        `<i data-level="${esc(level)}" style="width:${p}%"></i></span>` +
        `<span class="care-meter__v">${p}%</span>` +
        `<span class="care-meter__eta" data-ready="${ready ? '1' : '0'}" role="status">` +
        `${ready ? 'いまが 押しどき！' : `あと ${leftSec} 秒で 全効果`}</span>`,
    );
  }

  function renderCapacity(): void {
    if (!capEl) return;
    const used = capacityUsed(app.state);
    const cap = app.state.capacity;
    // アイコンは SVG なので textContent では出せない（要素として入れる必要がある）。
    setHtml(
      capEl,
      `${icon('egg')} ${used.egg}/${cap.egg}　${icon('hatch')} ${used.juvenile}/${cap.juvenile}` +
        `　${icon('leaf')} ${used.adult}/${cap.adult}`,
    );
  }

  // ── 吹き出し ────────────────────────────────────────
  function showSpeech(text: string, reaction: CareResult['reaction']): void {
    if (!stageEl || !text) return;
    stageEl.querySelector('.speech')?.remove();
    const bubble = el('div', 'speech');
    bubble.dataset.reaction = reaction;
    bubble.setAttribute('role', 'status');
    bubble.textContent = text;
    stageEl.appendChild(bubble);
    window.clearTimeout(speechTimer);
    speechTimer = window.setTimeout(() => bubble.remove(), 2600);
  }

  // ── 世話の実行 ──────────────────────────────────────
  function performCare(action: CareAction, btn: HTMLElement): void {
    const c = active();
    if (!c) return;
    const before = c.life.stage;
    const result = doCare(app.state, c.id, action, Date.now());

    if (!result.ok) {
      sfx.play('deny');
      toast(result.reason ?? 'いまは できません。', 'warn');
      renderCare();
      return;
    }

    // 音：世話ごとの効果音 + 個体の声（seed と性格で変わる）
    sfx.play(CARE_SFX[action]);
    if (before !== 'egg') {
      window.setTimeout(() => sfx.voice(c.seed, getPhenotype(c, c.life.stage).personality, result.reaction), 150);
    }

    // 演出：反応アニメ + 吹き出し + 粒子
    if (before === 'egg') {
      playOnce(artEl, 'egg-wobble', 780);
    } else {
      playReaction(artEl, reactionForCare(action, result.reaction));
    }
    showSpeech(result.speech, result.reaction);
    if (result.reaction === 'delighted') burstSparkles(stageEl, 12);
    playOnce(btn, 'egg--picked', 400);

    if (result.evolved) onEvolved(c, result.evolved);

    renderGauges();
    renderCare();
    app.rerender();
    app.save('世話');
  }

  /**
   * 孵化・成体化の「前 → 後」を画面中央で見せる。
   *
   * トースト 1 行だけだと、姿がどう変わったのかが分からないまま流れてしまう。
   * ただし **操作は一切妨げない**（pointer-events: none ＋ 自動で消える）。
   * 孵化は時間でも起きるので、モーダルで手を止めると邪魔になるため。
   * 読み上げはトーストが担当するので、この札は aria-hidden にする。
   */
  function showEvolveCard(c: Creature, to: 'juvenile' | 'adult'): void {
    if (app.skipCutscenes) return;
    document.querySelector('.evolve')?.remove();

    const from: Stage = to === 'juvenile' ? 'egg' : 'juvenile';
    const layer = el('div', 'evolve');
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML =
      `<div class="evolve__card">` +
      `<p class="evolve__title">${esc(c.name)} が ` +
      `${to === 'juvenile' ? '生まれました' : '成体に なりました'}！</p>` +
      `<div class="evolve__pair">` +
      `<span class="evolve__col"><span class="evolve__art">${thumbSvg(getPhenotype(c, from), c.life)}</span>` +
      `<span class="evolve__cap">${esc(STAGE_LABEL[from])}</span></span>` +
      `<span class="evolve__arrow">→</span>` +
      `<span class="evolve__col"><span class="evolve__art evolve__art--new">${thumbSvg(getPhenotype(c, to), c.life)}</span>` +
      `<span class="evolve__cap">${esc(STAGE_LABEL[to])}</span></span>` +
      `</div></div>`;
    document.body.appendChild(layer);
    window.clearTimeout(evolveTimer);
    evolveTimer = window.setTimeout(() => layer.remove(), 4200);
  }

  /** 孵化・成体化の演出。 */
  function onEvolved(c: Creature, to: string): void {
    mountedKey = ''; // 見た目が変わったので作り直す
    renderStage();
    renderSwitcher();
    renderGauges(true);
    renderCare();
    if (to === 'juvenile' || to === 'adult') showEvolveCard(c, to);

    if (to === 'juvenile') {
      sfx.play('hatch');
      if (stageEl && !app.reducedMotion) {
        const flash = el('div', 'hatch-flash');
        stageEl.appendChild(flash);
        window.setTimeout(() => flash.remove(), 1300);
      }
      burstSparkles(stageEl, 18);
      toast(`${c.name} が 生まれました！`, 'good', 4200);
      window.setTimeout(() => sfx.voice(c.seed, getPhenotype(c, 'juvenile').personality, 'delighted'), 700);
    } else if (to === 'adult') {
      sfx.play('grow');
      burstSparkles(stageEl, 20);
      toast(`${c.name} が 成体に なりました！`, 'good', 4200);
      // 珍しい形質が出ていたら、それが分かる音を足す（成体で初めて確定する）。
      const pheno = getPhenotype(c, 'adult');
      if (pheno.rarity.tier === 'rare' || pheno.rarity.tier === 'precious') {
        window.setTimeout(() => sfx.play('rare'), 620);
      }
    }
  }

  // ── イベント ────────────────────────────────────────
  const off = delegate(host, 'click', '[data-care],[data-pick]', (t) => {
    const pick = t.dataset.pick;
    if (pick) {
      sfx.play('tap');
      app.state.activeCreatureId = pick;
      mountedKey = '';
      renderAll();
      app.markDirty();
      return;
    }
    const care = t.dataset.care as CareAction | undefined;
    if (care) performCare(care, t);
  });

  // どの世話ボタンにフォーカスがあったかを覚えておく（クールダウン明けに返すため）。
  const offFocus = delegate(host, 'focusin', '[data-care]', (t) => {
    focusedCare = (t.dataset.care as CareAction | undefined) ?? focusedCare;
  });

  function renderAll(): void {
    renderSwitcher();
    renderStage();
    renderDecor();
    renderGauges(true);
    renderCare();
    renderCapacity();
    scheduleFit();
  }

  renderAll();
  fitStage();

  return {
    update: renderAll,
    tick(report: TickReport) {
      const c = active();
      if (!c) return;
      // この画面で見ている個体が孵化・成長したら演出を出す
      if (report.hatched.includes(c.id)) onEvolved(c, 'juvenile');
      else if (report.grownUp.includes(c.id)) onEvolved(c, 'adult');
      else if (report.hatched.length || report.grownUp.length) renderSwitcher();

      renderGauges();
      // ボタンの活性は時間で変わる（クールダウン・休息中）ので毎 tick 見直す
      renderCare();
      // 目標行の文の長さでヘッダの高さが変わることがあるので、舞台の高さも見直す。
      scheduleFit();
    },
    dispose() {
      off();
      offFocus();
      stopMotion();
      window.clearTimeout(speechTimer);
      window.clearTimeout(evolveTimer);
      document.querySelector('.evolve')?.remove();
      window.cancelAnimationFrame(fitRaf);
      window.removeEventListener('resize', scheduleFit);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      ro?.disconnect();
    },
  };
}
