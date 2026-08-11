/**
 * 開発ツールの入口（lab.html から読まれる）。
 *
 * ゲーム本体（index.html → src/main.ts）とは完全に独立したエントリなので、
 * 本体の画面には開発者機能が一切露出しない。
 * vite.config.ts（変更禁止）の入口は index.html だけなので、
 * 本番ビルドにこのページは含まれない ＝ 配布物に開発ツールが混ざらない。
 *
 * URL パラメータ:
 *   ?tab=lab|dev   開くタブ（既定 lab）
 *   ?seed=XXXX     Visual Lab の seed を上書きして開く
 *   ?stage=egg|juvenile|adult
 *   ?bg=light|dark
 */

import { installLabStyles } from './labStyles.ts';
import { mountDevTools, type DevTab } from './index.ts';
import { loadPrefs, savePrefs } from './labStore.ts';

installLabStyles();

const qs = new URLSearchParams(location.search);

// URL で指定された初期値を prefs に反映してから載せる
// （Visual Lab は prefs を正本にしているので、ここで上書きしておくのが素直）。
const seed = qs.get('seed');
const stage = qs.get('stage');
const bg = qs.get('bg');
if (seed || stage || bg) {
  const prefs = loadPrefs<Record<string, unknown>>({});
  if (seed) prefs.seed = seed;
  if (stage === 'egg' || stage === 'juvenile' || stage === 'adult') prefs.stage = stage;
  if (bg === 'light' || bg === 'dark') prefs.dark = bg === 'dark';
  savePrefs(prefs);
}

const tabParam = qs.get('tab');
const tab: DevTab = tabParam === 'dev' ? 'dev' : 'lab';

const root = document.getElementById('lab');
if (root) {
  mountDevTools(root, { tab });
  document.title = tab === 'dev' ? 'ゲノモン 開発者モード' : 'ゲノモン Visual Lab';
}
