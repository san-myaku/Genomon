/**
 * 展示会。
 *
 * 【要件（指示書 §7）】
 *   登場演出 → 審査 → 項目別評価 → 合計点 → ランク → 観客の反応 → 紙吹雪 → コイン獲得演出。
 *   **演出はスキップできること。**
 *
 * 【設計】
 *   採点そのものは game の runExhibition が一度で済ませる（state もそこで更新される）。
 *   UI がやるのは「結果を順番に見せる」ことだけ。
 *   途中で画面を離れても破綻しないよう、演出は cancelled フラグで打ち切れるようにしてある。
 *
 * 【カットを必ず画面に入れる（最重要）】
 *   以前はカットを下へ足していくだけで、スクロールを一切動かしていなかった。
 *   その結果 PC でも スマホでも「項目別の評価」以降が全部フォールド下に流れ、
 *   プレイヤーには生きものと「それでは、拝見します。」しか見えていなかった。
 *   ＝ いちばん演出に手をかけた画面が丸ごと空振りしていた。
 *   対策は 3 つ:
 *     1. 演出中は舞台を縮める（exh-stage--show）。結果カードの置き場所を作る。
 *     2. カットを挿入したら必ず reveal() で「読める帯」の中央へ送る。
 *        帯はヘッダ・下タブ・スキップバーを差し引いた実測値から作る。
 *     3. 最後のカットは下に何も無くスクロールが届かないので、
 *        末尾の余白（exh-tail）を必要なぶんだけ伸ばしてから送る。
 */

import type { Creature, ExhibitionScore } from '../../core/types.ts';
import { icon } from '../icons.ts';
import { sfx } from '../../audio/index.ts';
import type { App, Screen } from '../app.ts';
import { pageHeader } from '../app.ts';
import { $, confetti, delegate, esc, setHtml, wait } from '../dom.ts';
import { mountCreature } from '../creatureView.ts';
import { creatureCard, emptyState, lockedNotice } from '../components/bits.ts';
import { toast } from '../components/toast.ts';
import { num } from '../format.ts';
import { visibleRarity } from '../traits.ts';
import { canExhibit, creaturesByStage, getPhenotype, isAppraised, observedRarity, runExhibition, unlockHint } from '../gameApi.ts';

/** 項目の見出し（ExhibitionScore のキーと対応）。 */
const CRITERIA: readonly { key: keyof ExhibitionScore; label: string }[] = [
  { key: 'beauty', label: '美しさ' },
  { key: 'care', label: '育成状態' },
  { key: 'health', label: '健康状態' },
  { key: 'character', label: '個性' },
  { key: 'rarity', label: '希少性' },
];

/**
 * 未鑑定の「希少性」バーの長さ。
 * 数字を伏せてもバーの長さを測れば同じことなので、10 点刻みへ丸める。
 * これで復元できるのは `rarity.score` にして 20 点幅の帯までになる。
 */
function roughRarityWidth(v: number): number {
  return Math.round(v / 10) * 10;
}

const AUDIENCE = ['guestHat', 'guestGlasses', 'guestElder', 'guestChild', 'guestArtist', 'guestHat', 'guestGlasses'];

export function screenExhibition(app: App, host: HTMLElement): Screen {
  let mode: 'select' | 'show' = 'select';
  let selected: string | null = null;
  let stopMotion: () => void = () => {};
  let cancelled = false;
  /** 演出中のスキップ要求。 */
  let skipped = false;
  /** ヘッダの更新を止めている間の解除関数（止めていなければ null）。 */
  let releaseChrome: (() => void) | null = null;

  /** 止めていたヘッダ更新を再開する（コイン獲得のカット・画面離脱の両方から呼ぶ）。 */
  function resumeChrome(): void {
    const fn = releaseChrome;
    releaseChrome = null;
    fn?.();
  }

  // ── 選択画面 ────────────────────────────────────────
  function renderSelect(): void {
    stopMotion();
    const adults = creaturesByStage(app.state, 'adult');
    const now = Date.now();

    const cards = adults
      .map((c) => {
        const pheno = getPhenotype(c, 'adult');
        const chk = canExhibit(app.state, c.id, now);
        return (
          `<div class="stack stack--s">` +
          creatureCard(c, pheno, {
            action: 'enter',
            pressed: selected === c.id,
            // 未鑑定の tier をここで出すと、詳細画面が「まだ分からない」と言っている
            // すぐ隣で展示会が「ふつう」と断定してしまう。鑑定済みだけ正式な札を出す。
            rarity: isAppraised(c) ? visibleRarity(pheno, 'adult') : null,
            extraPills: isAppraised(c)
              ? [`<span class="pill pill--brass">鑑定済み</span>`]
              : [`<span class="pill">${icon('spark')} ${esc(observedRarity(pheno).label)}</span>`],
            hideRarity: true,
            meta: c.exhibitionCount > 0 ? `出場 ${c.exhibitionCount} 回・最高 ${Math.round(c.bestScore)} 点` : 'はじめての 出場',
          }) +
          (chk.ok
            ? ''
            : `<p class="section__note" style="margin:0;font-size:.76rem;color:var(--mid)">${esc(chk.reason ?? '')}</p>`) +
          `</div>`
        );
      })
      .join('');

    setHtml(
      host,
      pageHeader('展示会', '成体を 1 体 えらんで 出場します。審査員が 5 つの 目で 見てくれます。', 'medal') +
        (adults.length === 0
          ? emptyState('sprout', ['まだ 成体が いません。', '育成室で ゲノモンを 育てましょう。'])
          : `<div class="grid-auto">${cards}</div>`) +
        `<p class="section__note" style="margin-top:var(--sp-4)">` +
        `点数は「美しさ・育成状態・健康状態・個性・希少性」の 5 項目。` +
        `よく 世話を した子ほど 高く 出ます。` +
        `未鑑定の子は、審査員も 見た目で しか 判断できないので、希少性の 点は 伏せられます。</p>` +
        lockedNotice(
          'オンラインの 品評会',
          'ほかの 人の ゲノモンと 競い合う 仕組みは、この版には 入っていません。今後の 更新で ひらきます。',
          'globe',
        ),
    );
  }

  // ── 結果画面（骨組み）────────────────────────────────
  function renderShowFrame(c: Creature): void {
    setHtml(
      host,
      pageHeader('展示会', `${c.name} が 出場します。`, 'medal') +
        // 演出中は舞台を縮める。等身大のままだと結果カードが最初から画面外に出る。
        `<div class="exh-stage exh-stage--show">` +
        `<div class="exh-stage__art exh-enter" data-art></div>` +
        `<div class="audience" data-audience aria-hidden="true"></div>` +
        `</div>` +
        `<div class="stack" data-result aria-live="polite"></div>` +
        // スキップは画面下に貼り付ける。カットを追ってスクロールするので、
        // 通常のボタンだと「とばす」を押したくなった頃には画面外にいる。
        // 貼り付き（sticky bottom）は「自分より下にまだ中身がある」あいだだけ効くので、
        // 結果より後ろ・末尾の余白より前に置く。
        `<div class="exh-skip" data-skipbar>` +
        `<button type="button" class="btn btn--ghost btn--sm" data-act="skip">演出を とばす</button></div>` +
        `<div class="exh-tail" data-tail aria-hidden="true"></div>`,
    );

    const artEl = $('[data-art]', host);
    stopMotion = mountCreature(artEl, getPhenotype(c, 'adult'), c.life, {
      detail: 'full',
      title: `${c.name}`,
      creature: c,
      reducedMotion: app.reducedMotion,
    });
  }

  /**
   * 「読める帯」＝ 固定ヘッダ・下タブ・スキップバーに隠れない縦の範囲。
   * 値を CSS から写すと必ずずれるので、そのときの実寸から作る。
   */
  function readableBand(): { top: number; bottom: number } {
    const hdr = document.querySelector<HTMLElement>('.hdr');
    const nav = document.querySelector<HTMLElement>('.nav');
    const top = hdr && !hdr.hidden ? hdr.getBoundingClientRect().bottom : 0;
    let bottom = window.innerHeight;
    // ナビが画面下に固定されるのはスマホ幅だけ（PC は左サイド）。
    if (nav && !nav.hidden && window.innerWidth < 900) {
      bottom = Math.min(bottom, nav.getBoundingClientRect().top);
    }
    // スキップバーは演出中ずっと下に貼り付いているので、出ている間は席を空けておく。
    // 「いま貼り付いているか」で場合分けすると帯の高さが毎回ぶれて、
    // カットが少しずつ上下にずれる（読みづらい）。
    const skip = $('[data-skipbar]', host);
    if (skip) {
      const h = skip.getBoundingClientRect().height;
      if (h > 0) bottom -= h + 8;
    }
    return { top: top + 8, bottom: bottom - 8 };
  }

  /**
   * 挿入したカットを読める帯へ送る。演出が画面外で流れるのを防ぐ最後の砦。
   *
   * @param center 演出中のカットは中央へ（見せ場なので目線を集める）。
   *               演出が終わったあとは false にして、動かす量を最小にする
   *               （中央に置こうとすると下に無駄な余白が残る）。
   */
  function reveal(node: Element | null | undefined, center = true): void {
    if (!node) return;
    const band = readableBand();
    const avail = Math.max(96, band.bottom - band.top);
    const r = node.getBoundingClientRect();
    if (!center && r.top >= band.top && r.bottom <= band.bottom) return;
    // 帯より高いカットは上端合わせ（中央に置くと見出しが隠れる）。
    const want =
      r.height > avail
        ? band.top
        : center
          ? band.top + (avail - r.height) / 2
          : Math.max(band.top, Math.min(r.top, band.bottom - r.height));
    const delta = Math.round(r.top - want);
    if (Math.abs(delta) < 3) return;

    // 最後のカットは下に何も無く、そのままではスクロールが目標まで届かない。
    // 足りないぶんだけ末尾の余白を伸ばす（伸ばすのは必要最小限）。
    const tail = $('[data-tail]', host);
    if (tail && delta > 0) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const need = window.scrollY + delta - max;
      if (need > 0) {
        const cur = Number.parseFloat(tail.style.height || '0') || 0;
        tail.style.height = `${Math.ceil(cur + need)}px`;
      }
    }
    window.scrollTo({
      top: Math.max(0, window.scrollY + delta),
      behavior: app.reducedMotion || skipped || app.skipCutscenes ? 'auto' : 'smooth',
    });
  }

  /** スキップ指定・設定を見て待ち時間を決める。 */
  async function beat(ms: number): Promise<void> {
    if (skipped || app.skipCutscenes || app.reducedMotion) return;
    await wait(ms);
  }

  // ── 演出 ────────────────────────────────────────────
  async function runShow(c: Creature): Promise<void> {
    // 採点は一度で終わり、state（コイン・解放）もここで書き換わる。
    // そのままだと審査員が「拝見します」と言っている段階で
    // ヘッダのコインとナビの解放が先に更新され、結果がばれてしまうので、
    // コイン獲得のカット（⑥）までヘッダの反映を止めておく。
    releaseChrome = app.holdChrome();

    const score = runExhibition(app.state, c.id, Date.now());
    app.save('展示会');

    renderShowFrame(c);
    const resultEl = $('[data-result]', host);
    const audienceEl = $('[data-audience]', host);
    if (!resultEl) return;

    // ① 登場
    sfx.voice(c.seed, getPhenotype(c, 'adult').personality, 'happy');
    setHtml(audienceEl, AUDIENCE.map((a, i) => `<span style="animation-delay:${i * 120}ms">${a}</span>`).join(''));
    await beat(700);
    if (cancelled) return;

    // ② 審査開始
    resultEl.innerHTML =
      `<div class="judge-line"><span class="judge-line__ava" aria-hidden="true">${icon('glass')}</span>` +
      `<span class="judge-line__body"><span class="judge-line__name">${esc(score.judge)}</span>` +
      `<span class="judge-line__title">審査員</span>` +
      `<span class="judge-line__say">それでは、拝見します。</span></span></div>`;
    sfx.play('judge');
    reveal(resultEl.lastElementChild);
    await beat(900);
    if (cancelled) return;

    // ③ 項目別評価（1 項目ずつ伸ばす）
    //
    // 【未鑑定では「希少性」の点数を数字で出さない — 逆算できてしまう】
    //   希少性の点は `judgeScale(rarity.score/100, …)` の単調変換なので、
    //   表示された整数から `rarity.score` をほぼそのまま復元できる。
    //   詳細画面で伏せている正確な希少度が、展示会の結果画面から漏れる経路になる。
    //   （総合点は ±6% のゆらぎが乗るので、そちらからの逆算は成立しない。）
    //   鑑定済みの個体は証明書を出している扱いなので、数字で見せてよい。
    const showRarityValue = isAppraised(c);
    const rows = CRITERIA.map(
      (cr) =>
        `<div class="score-row"><span class="score-row__k">${esc(cr.label)}</span>` +
        `<span class="score-row__bar"><i data-bar="${cr.key}"></i></span>` +
        `<span class="score-row__v" data-val="${cr.key}">–</span></div>`,
    ).join('');
    resultEl.insertAdjacentHTML(
      'beforeend',
      `<div class="card"><div class="section__head"><h2 class="section__title">項目別の 評価</h2></div>` +
        `<div class="scores">${rows}</div></div>`,
    );
    // 得点バーが伸びるところを見せたいので、伸ばす前に画面へ入れる。
    reveal(resultEl.lastElementChild);
    await beat(260);
    if (cancelled) return;

    for (const cr of CRITERIA) {
      if (cancelled) return;
      const v = Math.round(Number(score[cr.key] ?? 0));
      const bar = host.querySelector<HTMLElement>(`[data-bar="${cr.key}"]`);
      const val = host.querySelector(`[data-val="${cr.key}"]`);
      // バーは印象として残す（伸びる演出はこの画面の見どころ）。数字だけ伏せる。
      const hide = cr.key === 'rarity' && !showRarityValue;
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, hide ? roughRarityWidth(v) : v))}%`;
      if (val) val.textContent = hide ? '？' : String(v);
      sfx.play('tap');
      await beat(340);
    }
    await beat(400);
    if (cancelled) return;

    // ④ 合計点 → ランク
    resultEl.insertAdjacentHTML(
      'beforeend',
      `<div class="card" style="text-align:center">` +
        `<p class="section__note" style="margin:0 0 var(--sp-2)">合計</p>` +
        `<p style="font-size:2rem;font-weight:900;color:var(--head);margin:0">${Math.round(score.total)} 点</p>` +
        `<div style="margin:var(--sp-3) 0"><span class="rank-badge" data-rank="${esc(score.rank)}">${esc(score.rank)}</span></div>` +
        `</div>`,
    );
    sfx.play('fanfare');
    reveal(resultEl.lastElementChild);
    await beat(1100);
    if (cancelled) return;

    // ⑤ 観客の反応（審査員コメント）
    if (score.comments.length > 0) {
      resultEl.insertAdjacentHTML(
        'beforeend',
        `<div class="judge-line"><span class="judge-line__ava" aria-hidden="true">${icon('speech')}</span>` +
          `<span class="judge-line__body"><span class="judge-line__name">${esc(score.judge)}</span>` +
          `<span class="judge-line__title">講評</span>` +
          score.comments.map((m) => `<span class="judge-line__say">${esc(m)}</span>`).join('') +
          `</span></div>`,
      );
      reveal(resultEl.lastElementChild);
    }
    await beat(1100);
    if (cancelled) return;

    // ⑥ 紙吹雪 + コイン（ここで初めてヘッダのコイン・目標行・ナビ解放を反映する）
    if (score.rank !== 'D') confetti();
    resumeChrome();
    // コインと「次にどうするか」は 1 かたまりにする。
    // 別々に足すと、片方だけ画面に入って片方が切れる。
    resultEl.insertAdjacentHTML(
      'beforeend',
      `<div class="stack stack--s" data-final>` +
        `<div class="card"><p class="coin-pop">${icon('coin')} +${num(score.coins)}</p>` +
        `<p class="section__note" style="text-align:center;margin:0">いまの 所持コイン：${num(app.state.coins)}</p></div>` +
        `<div class="row row--end">` +
        `<button type="button" class="btn btn--ghost" data-act="again">ほかの子を 出す</button>` +
        `<a class="btn" href="#/nursery" data-act="nursery">育成室へ もどる</a></div>` +
        `</div>`,
    );
    sfx.play('coin');
    finish();
    // ここでトーストは出さない。
    // 結果（ランク・点・コイン）は必ず画面の中に入るようになったので同じことを二度言うことになり、
    // しかもスマホではトーストが画面下に出るぶん「ほかの子を 出す／育成室へ もどる」を覆ってしまう。
    // 読み上げは結果の入れ物（data-result）の aria-live が担当する。
    app.rerender();
  }

  /**
   * 演出の終わり。スキップバーを片付け、伸ばしていた末尾の余白を戻してから、
   * 最後のカット（コイン獲得と次の行き先）をもう一度画面に合わせる。
   */
  function finish(): void {
    $('[data-skipbar]', host)?.remove();
    const tail = $('[data-tail]', host);
    if (tail) tail.style.height = '0px';
    reveal($('[data-final]', host), false);
  }

  // ── 操作 ────────────────────────────────────────────
  const off = delegate(host, 'click', '[data-enter],[data-act]', (t) => {
    const act = t.dataset.act;
    if (act === 'skip') {
      skipped = true;
      sfx.play('tap');
      return;
    }
    if (act === 'again') {
      sfx.play('back');
      resumeChrome();
      mode = 'select';
      selected = null;
      skipped = false;
      stopMotion();
      renderSelect();
      // 演出でスクロールを下げているので、一覧は先頭から見せる。
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }

    const id = t.dataset.enter;
    if (!id) return;

    const chk = canExhibit(app.state, id, Date.now());
    if (!chk.ok) {
      sfx.play('deny');
      toast(chk.reason ?? 'いまは 出場できません。', 'warn');
      return;
    }
    const c = app.state.creatures.find((x) => x.id === id);
    if (!c) return;

    sfx.play('tap');
    selected = id;
    mode = 'show';
    skipped = app.skipCutscenes;
    void runShow(c);
  });

  if (!app.state.unlocks.exhibition) {
    setHtml(
      host,
      pageHeader('展示会', undefined, 'medal') + lockedNotice('展示会', unlockHint(app.state, 'exhibition')),
    );
  } else {
    renderSelect();
  }

  return {
    update() {
      if (mode === 'select') renderSelect();
    },
    dispose() {
      cancelled = true;
      // 演出の途中で画面を離れても、ヘッダの更新は必ず戻す（止めっぱなしにしない）。
      resumeChrome();
      off();
      stopMotion();
    },
  };
}
