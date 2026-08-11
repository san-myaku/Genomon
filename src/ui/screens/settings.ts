/**
 * 設定。
 *
 * 【要件】
 *   音量スライダー・ミュート・演出スキップ・モーション軽減・
 *   セーブの書き出し／読み込み／初期化（初期化は確認ダイアログ必須）。
 *   バージョン表記を 7 回連続タップで開発者モードが有効になる導線（`?dev=1` も有効）。
 *
 * 【テーマ】
 *   core の Settings 型は変更できない（リード所有）ため、
 *   明暗テーマの好みだけは UI 固有設定として localStorage に持つ（app.ts の themePref）。
 */

import { sfx } from '../../audio/index.ts';
import type { App, Screen } from '../app.ts';
import { pageHeader, section } from '../app.ts';
import { $, delegate, esc, setHtml } from '../dom.ts';
import { confirmDialog, openDialog } from '../components/dialog.ts';
import { toast } from '../components/toast.ts';
import { clearModelCache } from '../creatureView.ts';
import { APP_VERSION } from '../version.ts';
import { clearSave, exportSave, importSave } from '../../save/index.ts';
import { newGame, refreshUnlocks } from '../gameApi.ts';

/** 開発者モードが開くまでのタップ回数。 */
const DEV_TAPS = 7;
/** 連続タップとみなす間隔。 */
const DEV_TAP_WINDOW_MS = 1200;

export function screenSettings(app: App, host: HTMLElement): Screen {
  let tapCount = 0;
  let lastTapAt = 0;

  function toggle(label: string, hint: string, on: boolean, action: string): string {
    return (
      `<div class="field"><span class="field__label">${esc(label)}` +
      `<span class="field__hint">${esc(hint)}</span></span>` +
      `<span class="field__ctl">` +
      `<button type="button" class="switch" role="switch" aria-checked="${on ? 'true' : 'false'}"` +
      ` aria-label="${esc(label)}" data-toggle="${esc(action)}"></button></span></div>`
    );
  }

  function render(): void {
    const s = app.state.settings;
    const theme = app.themePref;

    setHtml(
      host,
      pageHeader('設定', '音・演出・セーブの あつかいを 決められます。', 'gear') +
        section(
          '音',
          `<div class="card">` +
            `<div class="field"><span class="field__label">音量` +
            `<span class="field__hint">はじめは 控えめです。急に 大きな音は 鳴りません。</span></span>` +
            `<span class="field__ctl">` +
            `<input type="range" min="0" max="100" step="5" value="${Math.round(s.volume * 100)}"` +
            ` data-vol aria-label="音量">` +
            `<span class="pill" data-volval>${Math.round(s.volume * 100)}</span></span></div>` +
            toggle('ミュート', 'すべての 音を 止めます。', s.muted, 'muted') +
            `<div class="field"><span class="field__label">音を ためす` +
            `<span class="field__hint">いまの 音量で 効果音を 鳴らします。</span></span>` +
            `<span class="field__ctl"><button type="button" class="btn btn--ghost btn--sm" data-act="testsound">鳴らす</button></span></div>` +
            `</div>`,
          undefined,
          'sound',
        ) +
        section(
          '見た目・演出',
          `<div class="card">` +
            toggle('演出を とばす', '展示会などの 長い演出を 省きます。', s.skipCutscenes, 'skip') +
            toggle('モーション軽減', 'ゆれ・浮遊などの 動きを 止めます。', s.reducedMotion, 'motion') +
            `<div class="field"><span class="field__label">テーマ` +
            `<span class="field__hint">「自動」は 端末の 設定に あわせます。</span></span>` +
            `<span class="field__ctl">` +
            (['auto', 'light', 'dark'] as const)
              .map(
                (t) =>
                  `<button type="button" class="btn btn--ghost btn--sm" data-theme="${t}"` +
                  ` aria-pressed="${theme === t ? 'true' : 'false'}"` +
                  (theme === t ? ' style="border-color:var(--accent-deep);color:var(--accent-deep)"' : '') +
                  `>${t === 'auto' ? '自動' : t === 'light' ? '明るい' : '暗い'}</button>`,
              )
              .join('') +
            `</span></div>` +
            `</div>`,
          undefined,
          'palette',
        ) +
        section(
          'セーブデータ',
          `<div class="card stack">` +
            `<div class="row"><span class="grow"><strong>書き出し</strong>` +
            `<p class="section__note" style="margin:0">いまの データを 文字列で 取り出します。</p></span>` +
            `<button type="button" class="btn btn--ghost btn--sm" data-act="export">書き出す</button></div>` +
            `<div class="row"><span class="grow"><strong>読み込み</strong>` +
            `<p class="section__note" style="margin:0">書き出した 文字列から 復元します。いまの データは 上書きされます。</p></span>` +
            `<button type="button" class="btn btn--ghost btn--sm" data-act="import">読み込む</button></div>` +
            `<div class="row"><span class="grow"><strong>はじめから やり直す</strong>` +
            `<p class="section__note" style="margin:0">すべての ゲノモンと コインが 消えます。もとには もどせません。</p></span>` +
            `<button type="button" class="btn btn--danger btn--sm" data-act="reset">初期化</button></div>` +
            `</div>`,
          undefined,
          'save',
        ) +
        section(
          'このゲームについて',
          `<div class="card">` +
            `<div class="field"><span class="field__label">バージョン` +
            // 開発者モードの開きかたは製品 UI に書かない（プレイヤーには不要な情報）。
            // 7 回タップの導線そのものは残してある。
            `<span class="field__hint">${app.dev ? '開発者モードは 有効です。' : 'このゲームの 版番号です。'}</span></span>` +
            `<span class="field__ctl"><button type="button" class="version-tap" data-act="version">ver ${esc(APP_VERSION)}${app.dev ? '（DEV）' : ''}</button></span></div>` +
            `<p class="section__note" style="margin:var(--sp-2) 0 0">` +
            `効果音は すべて この場で 合成しています（外部の 音源は 使っていません）。</p>` +
            `</div>`,
          undefined,
          'info',
        ),
    );
  }

  async function doExport(): Promise<void> {
    const text = exportSave(app.state);
    await openDialog({
      title: 'セーブデータの 書き出し',
      icon: 'upload',
      bodyHtml:
        `<p>下の 文字列を コピーして 保管してください。</p>` +
        `<textarea class="io-area" readonly data-export>${esc(text)}</textarea>`,
    });
  }

  async function doImport(): Promise<void> {
    const v = await openDialog({
      title: 'セーブデータの 読み込み',
      icon: 'download',
      bodyHtml:
        `<p>書き出した 文字列を 貼りつけてください。</p>` +
        `<textarea class="io-area" data-import placeholder="ここに 貼りつけ"></textarea>` +
        `<p style="color:var(--bad);font-size:.84rem;margin-top:8px">いまの データは 上書きされます。</p>`,
      actions: [
        { label: 'やめる', value: 'cancel', kind: 'ghost', cancel: true },
        { label: '読み込む', value: 'ok', kind: 'primary' },
      ],
    });
    if (v !== 'ok') return;

    // ダイアログは閉じているので、閉じる直前に値を拾えるよう再度探す
    const area = document.querySelector<HTMLTextAreaElement>('[data-import]');
    const text = area?.value ?? '';
    const r = importSave(text);
    if (!r.ok) {
      sfx.play('deny');
      toast(
        r.reason === 'empty' ? '文字列が 空でした。' : `読み込めませんでした：${r.detail}`,
        'bad',
      );
      return;
    }
    app.state = r.state;
    refreshUnlocks(app.state);
    clearModelCache();
    app.applySettings();
    app.save('読み込み');
    app.rerender();
    toast('セーブデータを 読み込みました。', 'good');
    app.go('/nursery');
  }

  async function doReset(): Promise<void> {
    const ok = await confirmDialog(
      'はじめから やり直しますか？',
      `<p>いま 育てている ゲノモンと コインは <strong>すべて 消えます</strong>。` +
        `もとに もどすことは できません。</p>`,
      '消して やり直す',
      true,
    );
    if (!ok) return;
    clearSave();
    app.state = newGame();
    refreshUnlocks(app.state);
    clearModelCache();
    app.applySettings();
    app.save('初期化');
    app.rerender();
    toast('はじめから やり直します。', 'info');
    app.go('/title');
  }

  function onVersionTap(): void {
    const now = Date.now();
    tapCount = now - lastTapAt < DEV_TAP_WINDOW_MS ? tapCount + 1 : 1;
    lastTapAt = now;

    if (app.dev) return;
    if (tapCount >= DEV_TAPS) {
      app.dev = true;
      tapCount = 0;
      sfx.play('unlock');
      toast('開発者モードが 有効に なりました。', 'good');
      app.rerender();
      render();
    } else if (tapCount >= DEV_TAPS - 3) {
      toast(`あと ${DEV_TAPS - tapCount} 回`, 'info', 900);
    }
  }

  const offClick = delegate(host, 'click', '[data-toggle],[data-act],[data-theme]', (t) => {
    const s = app.state.settings;
    const tg = t.dataset.toggle;
    if (tg) {
      sfx.play('tap');
      if (tg === 'muted') s.muted = !s.muted;
      else if (tg === 'skip') s.skipCutscenes = !s.skipCutscenes;
      else if (tg === 'motion') s.reducedMotion = !s.reducedMotion;
      app.applySettings();
      app.save('設定変更');
      render();
      return;
    }

    const theme = t.dataset.theme as 'auto' | 'light' | 'dark' | undefined;
    if (theme) {
      sfx.play('tap');
      app.setTheme(theme);
      render();
      return;
    }

    switch (t.dataset.act) {
      case 'testsound':
        sfx.unlock();
        sfx.play('coin');
        break;
      case 'export':
        sfx.play('tap');
        void doExport();
        break;
      case 'import':
        sfx.play('tap');
        void doImport();
        break;
      case 'reset':
        sfx.play('tap');
        void doReset();
        break;
      case 'version':
        sfx.play('tap');
        onVersionTap();
        break;
    }
  });

  const offInput = delegate(host, 'input', '[data-vol]', (t) => {
    const v = Number((t as HTMLInputElement).value) / 100;
    app.state.settings.volume = Math.max(0, Math.min(1, v));
    sfx.unlock();
    sfx.setVolume(app.state.settings.volume);
    const label = $('[data-volval]', host);
    if (label) label.textContent = String(Math.round(app.state.settings.volume * 100));
  });

  const offChange = delegate(host, 'change', '[data-vol]', () => {
    // つまみを 離したときだけ 音を 出す（動かすたびに 鳴ると うるさい）。
    sfx.play('tap');
    app.save('設定変更');
  });

  render();

  return {
    update: render,
    dispose() {
      offClick();
      offInput();
      offChange();
    },
  };
}
