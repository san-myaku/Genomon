/**
 * 卵選択画面。
 *
 * 【要件（指示書 §4）】
 *   - 9 個から 3 個。確定するまで何度でも選び直せる。
 *   - 選択中がひと目で分かる（枠・番号・チェック）。
 *   - 触ると小さく揺れる・光る・音が鳴る・粒子が出る。
 *   - 長い説明文を読ませない。短いガイドとボタンの強調で導く。
 */

import type { Genotype } from '../../core/types.ts';
import { icon } from '../icons.ts';
import { phenotypeOf } from '../../genetics/phenotype.ts';
import { sfx } from '../../audio/index.ts';
import type { App, Screen } from '../app.ts';
import { $, $$, burstSparkles, delegate, esc, playOnce, setText } from '../dom.ts';
import { creatureSvg } from '../creatureView.ts';
import { toast } from '../components/toast.ts';
import { pageHeader } from '../app.ts';
import { chooseEggs, rollEggChoices } from '../gameApi.ts';

const PICK_COUNT = 3;

export function screenEggSelect(app: App, host: HTMLElement): Screen {
  // 決定論的な 9 個。リロードしても同じものが出る（API.md 規約 5）。
  const choices: { seed: string; genotype: Genotype }[] =
    app.state.pendingEggs && app.state.pendingEggs.length > 0
      ? app.state.pendingEggs
      : rollEggChoices(app.state);

  const picked: string[] = [];

  const eggsHtml = choices
    .map((c, i) => {
      const pheno = phenotypeOf(c.genotype, 'egg');
      const art = creatureSvg(pheno, null, {
        detail: 'full',
        animatable: false,
        title: `${i + 1} 番目の たまご`,
      });
      return (
        `<button type="button" class="egg" data-egg="${esc(c.seed)}" data-idx="${i}"` +
        ` aria-pressed="false" aria-label="${i + 1} 番目の たまごを えらぶ">` +
        `<span class="egg__num" data-num aria-hidden="true"></span>` +
        `<span class="egg__check" aria-hidden="true">${icon('check')}</span>` +
        // 絵は aria-hidden。SVG 内の <style> がボタンの textContent に混じって
        // 読み上げソフトが CSS を読んでしまうのを防ぐ（ボタンには aria-label がある）。
        `<span class="egg__art" aria-hidden="true">${art}</span>` +
        `<span class="egg__cap">${i + 1}</span>` +
        `</button>`
      );
    })
    .join('');

  host.innerHTML =
    pageHeader('たまごを えらぶ', 'この 9 つから 3 つ。どれを 選んでも、育てかたで 姿は 変わります。', 'egg') +
    `<div class="eggs" role="group" aria-label="たまごの候補">${eggsHtml}</div>` +
    `<div class="confirmbar">` +
    `<span class="confirmbar__text" data-count aria-live="polite"></span>` +
    `<button type="button" class="btn btn--ghost btn--sm" data-act="clear">えらび直す</button>` +
    `<button type="button" class="btn" data-act="confirm" disabled>これで はじめる</button>` +
    `</div>`;

  const countEl = $('[data-count]', host);
  const confirmBtn = $<HTMLButtonElement>('[data-act="confirm"]', host);
  /** 一時的な注意書きを出しているタイマー。 */
  let noticeTimer = 0;

  /**
   * 確定バーに一時的な注意書きを出す。
   * トーストは画面下に固定されていて確定バーを覆ってしまうため、ここに出す。
   */
  function notice(text: string): void {
    setText(countEl, text);
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => refresh(), 2600);
  }

  function refresh(): void {
    window.clearTimeout(noticeTimer);
    setText(countEl, `${picked.length} / ${PICK_COUNT} えらびました`);
    if (confirmBtn) confirmBtn.disabled = picked.length !== PICK_COUNT;

    for (const btn of $$('.egg', host)) {
      const seed = btn.dataset.egg ?? '';
      const idx = picked.indexOf(seed);
      const on = idx >= 0;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      const numEl = $('[data-num]', btn);
      if (numEl) numEl.textContent = on ? String(idx + 1) : '';
    }
  }

  const off = delegate(host, 'click', '[data-egg],[data-act]', (t) => {
    const act = t.dataset.act;
    if (act === 'clear') {
      sfx.play('back');
      picked.length = 0;
      refresh();
      return;
    }
    if (act === 'confirm') {
      confirm();
      return;
    }

    const seed = t.dataset.egg;
    if (!seed) return;
    const at = picked.indexOf(seed);
    if (at >= 0) {
      // もう一度押すと選択解除。確定前は何度でも選び直せる。
      picked.splice(at, 1);
      sfx.play('back');
    } else {
      if (picked.length >= PICK_COUNT) {
        sfx.play('deny');
        notice('3 つまでです。えらび直すには もう一度 押してください。');
        playOnce(t, 'egg--picked', 460);
        return;
      }
      picked.push(seed);
      sfx.play('eggPick');
      sfx.play('eggWobble');
      playOnce(t, 'egg--picked', 460);
      burstSparkles(t, 8);
    }
    refresh();
  });

  function confirm(): void {
    if (picked.length !== PICK_COUNT) return;
    const r = chooseEggs(app.state, picked.slice(), Date.now());
    if (!r.ok) {
      sfx.play('deny');
      toast(r.reason ?? 'この 組み合わせでは 始められません。', 'bad');
      return;
    }
    sfx.play('eggConfirm');
    app.save('卵選択');
    toast('3 つの たまごを 迎えました。育成室で 世話を しましょう。', 'good');
    app.go('/nursery');
  }

  refresh();

  return {
    dispose() {
      off();
      window.clearTimeout(noticeTimer);
    },
  };
}
