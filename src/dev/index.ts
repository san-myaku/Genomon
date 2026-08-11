/**
 * 開発者機能の公開窓口。
 *
 * 【通常画面へ露出しないこと（指示書 §20）】
 *   このモジュールは `lab.html` → `src/dev/labMain.ts` からしか読み込まれない。
 *   ゲーム本体（index.html → src/main.ts → src/ui/**）はここを import していないので、
 *   本番ビルドの成果物に src/dev/** のコードは 1 バイトも入らない
 *   （vite.config.ts の入口は index.html のみ。lab.html は開発サーバ専用）。
 *
 * 【将来 UI から呼びたくなったら】
 *   `const { mountDevTools } = await import('../dev/index.ts');` の 1 行で載る形にしてある。
 *   動的 import なので、開発者モードが無効な間はこのチャンクが取得されない。
 */

import { installLabStyles } from './labStyles.ts';
import { mountVisualLab } from './visualLab.ts';
import { mountDevMode } from './devMode.ts';
import type { Mounted } from './visualLab.ts';

export { mountVisualLab } from './visualLab.ts';
export { mountDevMode } from './devMode.ts';
export type { Mounted } from './visualLab.ts';

export type DevTab = 'lab' | 'dev';

export interface DevToolsOpts {
  /** 最初に開くタブ。 */
  tab?: DevTab;
  /** ヘッダを出すか（ゲーム内に埋め込むときは false にする）。 */
  chrome?: boolean;
}

/**
 * Visual Lab と開発者モードをまとめて host に載せる。
 * 戻り値の dispose() でイベントを外せる。
 */
export function mountDevTools(host: HTMLElement, opts: DevToolsOpts = {}): Mounted {
  installLabStyles();
  const showChrome = opts.chrome !== false;

  host.innerHTML =
    (showChrome
      ? `<header class="lab-hdr">` +
        `<h1>ゲノモン 開発ツール</h1><span class="badge">DEV</span>` +
        `<span class="hint" style="margin:0">本体セーブへは明示操作でのみ書き込みます</span>` +
        `<nav class="lab-tabs" role="tablist">` +
        `<button class="lab-tab" role="tab" data-tab="lab">Visual Lab</button>` +
        `<button class="lab-tab" role="tab" data-tab="dev">開発者モード</button>` +
        `</nav></header>`
      : '') +
    `<div class="lab-body">` +
    `<div class="lab-panel" id="lab-panel-lab" role="tabpanel"></div>` +
    `<div class="lab-panel" id="lab-panel-dev" role="tabpanel" hidden></div>` +
    `</div>` +
    `<div id="lab-toast" aria-live="polite"></div>`;

  const toastHost = host.querySelector<HTMLElement>('#lab-toast');
  const toast = (msg: string, kind: 'ok' | 'bad' | 'info' = 'info'): void => {
    if (!toastHost) return;
    const node = document.createElement('div');
    node.className = `t ${kind === 'info' ? '' : kind}`.trim();
    node.textContent = msg;
    toastHost.appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
  };

  const setDark = (dark: boolean): void => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  };

  const panels: Record<DevTab, HTMLElement | null> = {
    lab: host.querySelector<HTMLElement>('#lab-panel-lab'),
    dev: host.querySelector<HTMLElement>('#lab-panel-dev'),
  };
  const mounts: Partial<Record<DevTab, Mounted>> = {};

  function activate(tab: DevTab): void {
    for (const key of ['lab', 'dev'] as DevTab[]) {
      const p = panels[key];
      if (p) p.hidden = key !== tab;
    }
    for (const b of host.querySelectorAll<HTMLElement>('[data-tab]')) {
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    }
    // 初回に開いたときだけ作る（開かないタブの重い生成を走らせない）。
    const panel = panels[tab];
    if (panel && !mounts[tab]) {
      mounts[tab] = tab === 'lab' ? mountVisualLab(panel, { toast, setDark }) : mountDevMode(panel, { toast });
    }
  }

  const onTabClick = (ev: Event): void => {
    const t = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-tab]');
    if (!t) return;
    const tab = t.dataset.tab;
    if (tab === 'lab' || tab === 'dev') activate(tab);
  };
  host.addEventListener('click', onTabClick);

  activate(opts.tab ?? 'lab');

  return {
    dispose() {
      host.removeEventListener('click', onTabClick);
      for (const m of Object.values(mounts)) m?.dispose();
    },
  };
}
