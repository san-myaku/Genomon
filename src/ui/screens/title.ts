/**
 * タイトル画面。
 *
 * 長い説明は読ませない。「はじめる」を押せば卵選びに入れる、それだけ分かればよい。
 * 背景のゲノモンは固定 seed の飾りで、セーブとは無関係（毎回同じ子が出迎える）。
 */

import { randomGenotype } from '../../genetics/genotype.ts';
import { phenotypeOf } from '../../genetics/phenotype.ts';
import { sfx } from '../../audio/index.ts';
import type { App, Screen } from '../app.ts';
import { $, delegate, esc } from '../dom.ts';
import { mountCreature } from '../creatureView.ts';
import { APP_VERSION } from '../version.ts';

/**
 * 看板ゲノモン。世界観を 1 秒で伝える役なので、固定 seed から厳選する。
 *
 * 【選び直した経緯】
 *   旧 seed（`GENOMON-TITLE-2`）は `loci.ts` に無彩色（`ash`）を足した影響で
 *   **灰色の体＋顔幅いっぱいの W 字口**になり、ビジュアル批評に
 *   「むっつりしたセイウチ」と評された。タイトルは 1 枚で第一印象を決めるので
 *   ランダム任せにせず、候補 24 体を並べて選ぶ。
 *
 * 【この個体を選んだ理由】
 *   淡い緑の体に双葉（「育てて観察する」という誘い文句をそのまま絵にしている）／
 *   大きく澄んだ目と穏やかな笑み／装飾が少なく小さく表示しても崩れない。
 *
 * 【選定は描画が確定してから行うこと】
 *   一度、描画担当が `src/render` を編集している最中に候補シートから選び、
 *   確定させたら**まったく違う顔**（重いまぶた＋歯を見せた笑い）が出た。
 *   seed は同じでも、遺伝子カタログや描画規則を変えれば絵は変わる。
 *   **カタログ・描画を触ったら必ずタイトル画面を目視し直すこと。**
 */
const MASCOT_SEED = 'CVXM-TMLT';

export function screenTitle(app: App, host: HTMLElement): Screen {
  const hasGame = app.state.creatures.length > 0 || app.state.pendingEggs !== null;

  host.innerHTML =
    `<div class="title-screen"><div class="title-inner">` +
    `<h1 class="title-logo">ゲノモン</h1>` +
    `<p class="title-sub">小さな生きものを 育てて、かたちの ちがいを 観察する。<br>あなたの手もとで、遺伝の いたずらを 見つけてください。</p>` +
    `<div class="title-art" data-mascot aria-hidden="true"></div>` +
    `<div class="title-actions">` +
    (hasGame
      ? `<button type="button" class="btn btn--lg" data-act="continue">つづきから</button>` +
        `<button type="button" class="btn btn--ghost" data-act="settings">設定</button>`
      : `<button type="button" class="btn btn--lg" data-act="start">はじめる</button>` +
        `<button type="button" class="btn btn--ghost" data-act="settings">設定</button>`) +
    `</div>` +
    `<p class="title-sub" style="font-size:.78rem;opacity:.75">ver ${esc(APP_VERSION)}</p>` +
    `</div></div>`;

  const mascot = $('[data-mascot]', host);
  const pheno = phenotypeOf(randomGenotype(MASCOT_SEED), 'adult');
  const stopMotion = mountCreature(mascot, pheno, null, {
    detail: 'full',
    reducedMotion: app.reducedMotion,
  });

  const off = delegate(host, 'click', '[data-act]', (t) => {
    sfx.unlock();
    sfx.play('tap');
    const act = t.dataset.act;
    if (act === 'start') app.go('/eggSelect');
    else if (act === 'continue') app.go('/nursery');
    else if (act === 'settings') app.go('/settings');
  });

  return {
    dispose() {
      off();
      stopMotion();
    },
  };
}
