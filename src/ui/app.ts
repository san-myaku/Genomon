/**
 * アプリシェル — ルーター・ヘッダ・ナビ・保存・時間経過。
 *
 * 【設計】
 *   - ハッシュルーター（`#/nursery` など）。ブラウザの「戻る」がそのまま効く。
 *   - 画面は「ファクトリ関数 → Screen オブジェクト」の形。
 *     Screen.update() は state 変更時、Screen.tick() は 250ms ごとに呼ばれる。
 *   - ヘッダの `nextObjective()` は常時表示。これが「次に何をすればよいか分かる」の中核。
 *   - 保存のタイミングは指示書 §27 の通り（各操作の直後・画面遷移時・20 秒ごと）。
 *     保存に失敗したら必ずトーストで知らせる（黙って失敗させない）。
 */

import type { GameState, ScreenId, Stage } from '../core/types.ts';
import { load, save as saveToStorage } from '../save/index.ts';
import { sfx } from '../audio/index.ts';
import { $, delegate, el, esc, setHtml } from './dom.ts';
import { toast } from './components/toast.ts';
import { openDialog } from './components/dialog.ts';
import {
  applyTick,
  blockedCreatures,
  creaturesByStage,
  newGame,
  nextObjective,
  refreshUnlocks,
  unlockHint,
} from './gameApi.ts';
import type { TickReport } from './gameApi.ts';
import { num } from './format.ts';
import { icon, iconOrText } from './icons.ts';

import { screenTitle } from './screens/title.ts';
import { screenEggSelect } from './screens/eggSelect.ts';
import { screenNursery } from './screens/nursery.ts';
import { screenCollection } from './screens/collection.ts';
import { screenDetail } from './screens/detail.ts';
import { screenExhibition } from './screens/exhibition.ts';
import { screenShop } from './screens/shop.ts';
import { screenBreeding } from './screens/breeding.ts';
import { screenSettings } from './screens/settings.ts';

/** 画面が返すハンドル。 */
export interface Screen {
  /** state の変化を画面に反映する。 */
  update?(): void;
  /** 250ms ごと。孵化・成長などの通知を受け取る。 */
  tick?(report: TickReport): void;
  /** 画面を離れるときの後始末。 */
  dispose?(): void;
}

export type ScreenFactory = (app: App, host: HTMLElement, params: string[]) => Screen;

/** UI 固有の設定（core の Settings 型は変更できないので localStorage に別途持つ）。 */
const THEME_KEY = 'genomon.ui.theme';
type ThemePref = 'auto' | 'light' | 'dark';

/** 自動保存の間隔。指示書 §27「一定時間ごと」。 */
const AUTOSAVE_MS = 20_000;
/** ゲームループの間隔。API.md 「UI は 250ms ごとに呼ぶ」。 */
const TICK_MS = 250;

interface NavDef {
  id: ScreenId;
  path: string;
  label: string;
  icon: string;
  /** 解放フラグのキー。省略時は常に開いている。 */
  unlock?: keyof GameState['unlocks'];
}

const NAV: readonly NavDef[] = [
  { id: 'nursery', path: '/nursery', label: '育成室', icon: 'sprout' },
  { id: 'collection', path: '/collection', label: '標本帳', icon: 'book', unlock: 'collection' },
  { id: 'exhibition', path: '/exhibition', label: '展示会', icon: 'medal', unlock: 'exhibition' },
  { id: 'shop', path: '/shop', label: 'ショップ', icon: 'pot', unlock: 'shop' },
  { id: 'breeding', path: '/breeding', label: '交配', icon: 'helix', unlock: 'breeding' },
  { id: 'settings', path: '/settings', label: '設定', icon: 'gear' },
];

/** ナビに出ない画面の日本語名（次の目標ボタンのラベルに使う）。 */
const SCREEN_LABEL: Readonly<Record<string, string>> = {
  title: 'タイトル',
  eggSelect: '卵をえらぶ',
  detail: '個体の記録',
};

const ROUTES: Readonly<Record<string, { id: ScreenId; make: ScreenFactory; bare?: boolean }>> = {
  title: { id: 'title', make: screenTitle, bare: true },
  eggSelect: { id: 'eggSelect', make: screenEggSelect },
  nursery: { id: 'nursery', make: screenNursery },
  collection: { id: 'collection', make: screenCollection },
  detail: { id: 'detail', make: screenDetail },
  exhibition: { id: 'exhibition', make: screenExhibition },
  shop: { id: 'shop', make: screenShop },
  breeding: { id: 'breeding', make: screenBreeding },
  settings: { id: 'settings', make: screenSettings },
};

export class App {
  state: GameState;
  /** 開発者モード。`?dev=1` かバージョン 7 回タップで有効。 */
  dev = false;

  private root: HTMLElement;
  private main: HTMLElement | null = null;
  private screen: Screen | null = null;
  private screenId: ScreenId = 'title';
  private params: string[] = [];
  private saveState: 'saved' | 'dirty' | 'error' = 'saved';
  private lastSaveAt = 0;
  private tickTimer = 0;
  private autoSaveTimer = 0;
  private bareLayout = false;
  /**
   * ヘッダ（コイン・次の目標・ナビの解放）の更新を止めている数。
   * 展示会の演出中に結果が先にヘッダへ出てしまう「ネタバレ」を防ぐために使う。
   */
  private chromeHold = 0;
  /**
   * 「次の目標」の行だけを止めている数。
   *
   * 交配が成功した直後、目標行はすぐ次の条件
   * （「交配の じゅんび: ○○ の 機嫌が たりません（59 / 60）」）へ書き換わる。
   * 成功の余韻を、失敗しているように見える赤い条件文が一瞬で塗りつぶしてしまうので、
   * 成功カードを見せているあいだだけ目標行を据え置く。
   * コインやナビまで止める chromeHold と違い、こちらは目標行だけを止める。
   */
  private objectiveHold = 0;

  constructor(root: HTMLElement, state: GameState) {
    this.root = root;
    this.state = state;
  }

  // ── 設定の反映 ────────────────────────────────────────

  get reducedMotion(): boolean {
    return (
      this.state.settings.reducedMotion ||
      (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)
    );
  }

  get skipCutscenes(): boolean {
    return this.state.settings.skipCutscenes;
  }

  /** 設定を画面（DOM 属性・音量）へ反映する。 */
  applySettings(): void {
    const r = document.documentElement;
    if (this.state.settings.reducedMotion) r.dataset.motion = 'reduced';
    else delete r.dataset.motion;

    sfx.setVolume(this.state.settings.volume);
    sfx.setMuted(this.state.settings.muted);
    this.applyTheme(this.themePref);
  }

  get themePref(): ThemePref {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  }

  setTheme(pref: ThemePref): void {
    try {
      if (pref === 'auto') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, pref);
    } catch {
      /* プライベートモードなどで書けなくても続行 */
    }
    this.applyTheme(pref);
  }

  private applyTheme(pref: ThemePref): void {
    const r = document.documentElement;
    if (pref === 'auto') delete r.dataset.theme;
    else r.dataset.theme = pref;
  }

  // ── 保存 ──────────────────────────────────────────────

  /**
   * 保存する。指示書 §27 のタイミングから呼ぶ。
   * 失敗したら必ずトーストで知らせる（黙って失敗させない）。
   */
  save(reason: string): void {
    this.state.updatedAt = Date.now();
    const r = saveToStorage(this.state);
    if (r.ok) {
      this.saveState = 'saved';
      this.lastSaveAt = Date.now();
    } else {
      this.saveState = 'error';
      toast(`保存できませんでした（${reason}）：${r.error}`, 'bad');
    }
    this.renderChrome();
  }

  /** 変更はあったがまだ保存していない、という印。 */
  markDirty(): void {
    if (this.saveState !== 'error') this.saveState = 'dirty';
    this.renderChrome();
  }

  // ── 遷移 ──────────────────────────────────────────────

  go(path: string, replace = false): void {
    const hash = `#${path.startsWith('/') ? path : `/${path}`}`;
    if (location.hash === hash) {
      this.route();
      return;
    }
    if (replace) location.replace(hash);
    else location.hash = hash;
  }

  /** 現在の画面を作り直す（state の構造が変わったとき）。 */
  rerender(): void {
    this.renderChrome();
    this.screen?.update?.();
  }

  /**
   * ヘッダの更新を一時的に止める（展示会の演出中など）。
   *
   * 採点は演出の前に終わっている（game が state を書き換える）ので、
   * そのままだと審査員が「拝見します」と言っている段階で
   * ヘッダのコインとナビの解放が先に更新され、結果がばれてしまう。
   * 戻り値を呼ぶと止めていた更新をまとめて反映する。
   * 画面を離れるときは必ず解除すること（dispose で呼ぶ）。
   */
  holdChrome(): () => void {
    this.chromeHold += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.chromeHold = Math.max(0, this.chromeHold - 1);
      this.renderChrome();
    };
  }

  /**
   * 「次の目標」の行だけを一時的に据え置く（交配の成功カードを見せているあいだなど）。
   * 戻り値を呼ぶと更新を再開する。画面を離れるときは必ず解除すること。
   */
  holdObjective(): () => void {
    this.objectiveHold += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.objectiveHold = Math.max(0, this.objectiveHold - 1);
      this.renderObjective();
    };
  }

  // ── 起動 ──────────────────────────────────────────────

  start(): void {
    this.applySettings();
    this.renderShell();

    window.addEventListener('hashchange', () => this.route());
    // 最初のユーザー操作で AudioContext を作る（自動再生制限への対応）。
    const unlockAudio = (): void => {
      sfx.unlock();
      sfx.setVolume(this.state.settings.volume);
      sfx.setMuted(this.state.settings.muted);
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
      window.addEventListener(ev, unlockAudio, { once: true, passive: true });
    }

    // 離脱時にも保存する（タブを閉じる・バックグラウンドへ回る）。
    window.addEventListener('pagehide', () => this.save('離脱'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.save('離脱');
    });

    this.tickTimer = window.setInterval(() => this.onTick(), TICK_MS);
    this.autoSaveTimer = window.setInterval(() => {
      if (this.saveState !== 'saved') this.save('自動保存');
    }, AUTOSAVE_MS);

    if (!location.hash || location.hash === '#' || location.hash === '#/') {
      const first = this.state.creatures.length === 0 ? '/title' : '/nursery';
      location.replace(`#${first}`);
    }
    this.route();
  }

  stop(): void {
    window.clearInterval(this.tickTimer);
    window.clearInterval(this.autoSaveTimer);
    this.screen?.dispose?.();
  }

  // ── 時間経過 ──────────────────────────────────────────

  private onTick(): void {
    const report = applyTick(this.state, Date.now());

    if (report.hatched.length || report.grownUp.length || report.unlocked.length || report.offlineMs > 0) {
      this.markDirty();
    }

    if (report.offlineMs > 60_000) {
      toast(`おかえりなさい。${Math.round(report.offlineMs / 60_000)} 分ぶんの時間が流れました。`, 'info');
    }
    for (const id of report.unlocked) {
      const def = NAV.find((n) => n.unlock === id);
      sfx.play('unlock');
      toast(`${def ? def.label : id} が つかえるように なりました！`, 'good', 4200);
    }

    this.screen?.tick?.(report);

    if (report.hatched.length || report.grownUp.length || report.unlocked.length) {
      this.renderChrome();
      this.save(report.hatched.length ? '孵化' : report.grownUp.length ? '成長' : '解放');
    } else {
      this.renderObjective();
      this.renderCoins();
    }
  }

  // ── 描画 ──────────────────────────────────────────────

  private renderShell(): void {
    this.root.innerHTML =
      `<a class="skip-link" href="#gm-main">本文へスキップ</a>` +
      `<div class="shell">` +
      `<header class="hdr" data-chrome>` +
      `<div class="hdr__top">` +
      `<a class="hdr__brand" href="#/nursery" data-nav-brand>${icon('helix')}<span>ゲノモン</span></a>` +
      `<span class="hdr__spacer"></span>` +
      `<span class="hdr__stats" data-stats></span>` +
      `</div>` +
      `<div class="objective" data-objective></div>` +
      `</header>` +
      `<div class="shell__body">` +
      `<nav class="nav" data-nav aria-label="画面の切り替え"></nav>` +
      `<main class="shell__main" id="gm-main" tabindex="-1"></main>` +
      `</div>` +
      `</div>`;

    this.main = $('#gm-main', this.root);

    // ナビ（イベント委譲。画面を作り直してもリスナが外れない）
    delegate(this.root, 'click', '[data-goto]', (t, ev) => {
      ev.preventDefault();
      const path = t.dataset.goto ?? '/nursery';
      const locked = t.dataset.locked === '1';
      if (locked) {
        sfx.play('deny');
        const feature = t.dataset.feature as keyof GameState['unlocks'] | undefined;
        const hint = feature ? unlockHint(this.state, feature) : 'まだ ひらいていません。';
        void openDialog({
          title: `${t.dataset.label ?? 'この画面'}｜今後解放`,
          icon: 'lock',
          bodyHtml: `<p>${esc(hint)}</p>`,
        });
        return;
      }
      sfx.play('tap');
      // 目標行が個体を名指ししているときは、遷移と同時にその子を選択状態にする。
      // （「キプノ を 世話して…」と言われて舞台に別の子が立っている問題への対処）
      const creature = t.dataset.creature;
      if (creature) {
        this.state.activeCreatureId = creature;
        this.markDirty();
      }
      this.go(path);
    });

    // 目標行が名指しした個体へ、画面を移らずに切り替える。
    delegate(this.root, 'click', '[data-pickobj]', (t, ev) => {
      ev.preventDefault();
      const id = t.dataset.pickobj;
      if (!id) return;
      sfx.play('tap');
      this.state.activeCreatureId = id;
      this.markDirty();
      this.rerender();
    });

    this.renderChrome();
  }

  /** ヘッダとナビ（画面によらず常に出る部分）。 */
  private renderChrome(): void {
    document.documentElement.classList.toggle('is-bare', this.bareLayout);
    const shell = $('.shell', this.root);
    if (shell) shell.classList.toggle('shell--bare', this.bareLayout);

    const hdr = $('[data-chrome]', this.root);
    const nav = $('[data-nav]', this.root);
    if (hdr) hdr.hidden = this.bareLayout;
    if (nav) nav.hidden = this.bareLayout;
    if (this.bareLayout) return;

    this.renderCoins();
    this.renderObjective();
    this.renderNav();
  }

  private renderCoins(): void {
    if (this.chromeHold > 0) return;
    const host = $('[data-stats]', this.root);
    if (!host) return;
    const saveLabel =
      this.saveState === 'error'
        ? `${icon('warn')} 保存できません`
        : this.saveState === 'dirty'
          ? '… 未保存'
          : `${icon('check')} 保存ずみ`;
    setHtml(
      host,
      `<span class="chip" title="所持コイン">${icon('coin')} <span data-coins>${num(this.state.coins)}</span></span>` +
        (this.dev ? `<span class="chip chip--dev" title="開発者モード">DEV</span>` : '') +
        `<span class="chip chip--save" data-state="${this.saveState === 'error' ? 'error' : this.saveState === 'dirty' ? 'saving' : 'ok'}" title="セーブの状態">${saveLabel}</span>`,
    );
  }

  /**
   * 枠が満杯で進行が止まっているとき、手放す候補（＝満杯の段階にいる 1 体）の ID。
   *
   * 詰まっているのは「孵れない卵」「成体になれない幼体」の側だが、
   * プレイヤーが手放すべきなのは **枠を埋めている側** なので、そちらへ案内する。
   */
  private releaseTargetId(): string | null {
    const first = blockedCreatures(this.state)[0];
    if (!first) return null;
    // 卵が孵れない＝幼体の枠が満杯。幼体が育たない＝成体の枠が満杯。
    const fullStage: Stage = first.creature.life.stage === 'egg' ? 'juvenile' : 'adult';
    return creaturesByStage(this.state, fullStage)[0]?.id ?? null;
  }

  /** 「次に何をすればよいか」の 1 行ガイド。ヘッダに常時出す。 */
  private renderObjective(): void {
    if (this.chromeHold > 0 || this.objectiveHold > 0) return;
    const host = $('[data-objective]', this.root);
    if (!host) return;
    const obj = nextObjective(this.state);

    // ① 枠が満杯で詰まっている：「手放す」画面へ直接飛ばす。
    //    目標行が「どれかを 手放すか」と言う以上、そこへ行く手段が要る。
    const releaseId = this.releaseTargetId();
    const onThatDetail =
      this.screenId === 'detail' && releaseId !== null && this.decodedParam(0) === releaseId;

    let btn = '';
    if (releaseId && !onThatDetail) {
      const path = `/detail/${encodeURIComponent(releaseId)}`;
      btn =
        `<a class="btn btn--sm objective__go" href="#${esc(path)}" data-goto="${esc(path)}">` +
        `手放す子を えらぶ</a>`;
    } else if (obj.screen && ROUTES[obj.screen] && obj.screen !== this.screenId) {
      // ② 別の画面が行き先：そこへ飛ぶ。名指しされた個体も同時に選択状態にする（P1-7）。
      const label = NAV.find((n) => n.id === obj.screen)?.label ?? SCREEN_LABEL[obj.screen] ?? 'ひらく';
      btn =
        `<a class="btn btn--sm objective__go" href="#/${esc(obj.screen)}" data-goto="/${esc(obj.screen)}"` +
        (obj.creatureId ? ` data-creature="${esc(obj.creatureId)}"` : '') +
        `>${esc(label)}</a>`;
    } else if (
      this.screenId === 'nursery' &&
      obj.creatureId &&
      obj.creatureId !== this.state.activeCreatureId
    ) {
      // ③ 行き先が「いま開いている画面」：押しても何も起きないボタンは出さない（P1-8）。
      //    ただし育成室だけは、名指しされた個体が舞台の子と違うなら
      //    「その子に切り替える」という実際に効くことがあるので、そのボタンを出す。
      btn =
        `<button type="button" class="btn btn--sm objective__go" data-pickobj="${esc(obj.creatureId)}">` +
        `その子を 見る</button>`;
    }

    setHtml(
      host,
      `<span class="objective__icon" aria-hidden="true">${icon('compass')}</span>` +
        `<span class="objective__text">${esc(obj.text)}</span>${btn}`,
    );
  }

  /** ルートパラメータをデコードして取り出す（未指定なら null）。 */
  private decodedParam(i: number): string | null {
    const raw = this.params[i];
    if (raw === undefined) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  private renderNav(): void {
    if (this.chromeHold > 0) return;
    const host = $('[data-nav]', this.root);
    if (!host) return;
    const items = NAV.map((n) => {
      const open = !n.unlock || this.state.unlocks[n.unlock];
      const current = this.screenId === n.id;
      return (
        `<a class="nav__item" href="#${esc(n.path)}" data-goto="${esc(n.path)}"` +
        ` data-label="${esc(n.label)}"` +
        (open ? '' : ` data-locked="1" data-feature="${esc(String(n.unlock))}"`) +
        (current ? ' aria-current="page"' : '') +
        `>` +
        `<span class="nav__ico" aria-hidden="true">${iconOrText(n.icon)}</span>` +
        `<span>${esc(n.label)}</span>` +
        (open ? '' : `<span class="nav__lock">${icon('lock', { label: '今後解放' })}</span>`) +
        `</a>`
      );
    }).join('');
    setHtml(host, items);
  }

  // ── ルーティング ──────────────────────────────────────

  private route(): void {
    const raw = location.hash.replace(/^#\/?/, '');
    const segs = raw.split('/').filter(Boolean);
    const name = segs[0] || 'nursery';
    const def = ROUTES[name] ?? ROUTES.nursery;

    // 未解放の画面へ直接来た場合は育成室へ戻す（URL を直打ちされても壊れないように）。
    const navDef = NAV.find((n) => n.id === def.id);
    if (navDef?.unlock && !this.state.unlocks[navDef.unlock]) {
      toast(unlockHint(this.state, navDef.unlock), 'warn');
      this.go('/nursery', true);
      return;
    }
    // 卵を選ぶ前に育成室へ来ても意味がないので卵選択へ送る。
    if (def.id === 'nursery' && this.state.creatures.length === 0 && !this.state.pendingEggs) {
      this.go('/title', true);
      return;
    }

    this.screen?.dispose?.();
    this.screen = null;

    this.screenId = def.id;
    this.params = segs.slice(1);
    this.bareLayout = def.bare === true;

    this.renderChrome();

    if (this.main) {
      this.main.innerHTML = '';
      this.main.hidden = false;
      if (this.bareLayout) {
        // タイトルはシェルを使わず全画面で出す。
        this.main.classList.add('shell__main--bare');
      } else {
        this.main.classList.remove('shell__main--bare');
      }
      this.screen = def.make(this, this.main, this.params);
      // 画面が変わったことを支援技術へ伝える。
      this.main.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'auto' });
    }

    // 画面遷移時の保存（指示書 §27）
    if (this.saveState !== 'saved' || Date.now() - this.lastSaveAt > 5_000) this.save('画面遷移');
  }
}

/** 開発者モードの判定（`?dev=1`）。 */
function devFromUrl(): boolean {
  try {
    return new URLSearchParams(location.search).get('dev') === '1';
  } catch {
    return false;
  }
}

/**
 * アプリを起動する。
 * 壊れたセーブでもゲームを起動不能にせず、復旧内容を説明して選ばせる（指示書 §27）。
 */
export async function boot(root: HTMLElement): Promise<App> {
  const result = load();
  let state: GameState;

  if (result.ok) {
    state = result.state;
    if (result.migratedFrom !== undefined) {
      toast(`古いセーブ（v${result.migratedFrom}）を読み込んで、今の形式に変換しました。`, 'info', 5000);
    }
    if (result.usedBackup) {
      toast('セーブが壊れていたので、バックアップから復元しました。', 'warn', 6000);
    }
  } else if (result.reason === 'empty') {
    state = newGame();
  } else {
    // 壊れている。何が起きたかを説明して、続けるか作り直すかを選ばせる。
    const canRecover = !!result.recovered;
    const choice = await openDialog({
      title: 'セーブデータが読めませんでした',
      icon: 'patch',
      bodyHtml:
        `<p>保存されていたデータが壊れていました。</p>` +
        `<p style="color:var(--ink-soft);font-size:.86rem">内容：${esc(result.detail)}</p>` +
        (canRecover
          ? `<p>読み取れたところまでを復元して <strong>続きから遊ぶ</strong> ことができます。` +
            `一部の状態（世話の履歴や進み具合）は失われているかもしれません。</p>`
          : `<p>復元できる部分がありませんでした。<strong>新しく始める</strong>ことになります。</p>`),
      actions: canRecover
        ? [
            { label: '新しく始める', value: 'new', kind: 'ghost' },
            { label: '復元して続ける', value: 'recover', kind: 'primary', cancel: true },
          ]
        : [{ label: '新しく始める', value: 'new', kind: 'primary', cancel: true }],
    });
    if (choice === 'recover' && result.recovered) {
      state = result.recovered;
      toast('読み取れたところまで復元しました。', 'warn', 5000);
    } else {
      state = newGame();
      toast('新しく始めました。', 'info');
    }
  }

  refreshUnlocks(state);

  const app = new App(root, state);
  app.dev = devFromUrl();
  app.start();

  if (app.dev) toast('開発者モードが有効です。', 'info');
  return app;
}

/** 画面から使う共通のヘッダ部品（各画面の先頭に置く見出し）。 */
export function pageHeader(title: string, lead?: string, ico?: string): string {
  return (
    `<h1 class="page-title">${ico ? `<span aria-hidden="true">${iconOrText(ico)}</span>` : ''}${esc(title)}</h1>` +
    (lead ? `<p class="page-lead">${esc(lead)}</p>` : '')
  );
}

/** 画面の入れ物（section）。 */
export function section(title: string, inner: string, note?: string, ico?: string): string {
  return (
    `<section class="section">` +
    `<div class="section__head"><h2 class="section__title">${ico ? `<span aria-hidden="true">${iconOrText(ico)}</span>` : ''}${esc(title)}</h2></div>` +
    (note ? `<p class="section__note">${esc(note)}</p>` : '') +
    inner +
    `</section>`
  );
}

export { el };
