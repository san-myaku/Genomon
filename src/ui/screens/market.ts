/**
 * 公認ブリーダー販売所。
 *
 * 売却額は game/market.ts の quote を唯一の正本とし、ここでは内訳の説明と
 * 確認操作だけを担当する。確認前に状態を変更しないので、画面更新や二重クリック
 * があっても「見積もりと実際の入金がずれる」事故を避けられる。
 *
 * 未鑑定の見積もりには遺伝的な希少度が **1 コインも入っていない**
 * （`game/market.ts`）。入っていないので、内訳もぼかさずそのまま出せる。
 * 以前は価格に混ぜたうえで表示だけまとめていたが、他の項が全部見えている
 * 以上、引き算で復元できてしまっていた。
 */

import type { Creature, SaleRecord } from '../../core/types.ts';
import type { App, Screen } from '../app.ts';
import { pageHeader, section } from '../app.ts';
import { delegate, esc, setHtml } from '../dom.ts';
import { confirmDialog } from '../components/dialog.ts';
import { emptyState, stagePill } from '../components/bits.ts';
import { toast } from '../components/toast.ts';
import { sfx } from '../../audio/index.ts';
import { generationLabel, num, STAGE_LABEL } from '../format.ts';
import { thumbSvg } from '../creatureView.ts';
import { capacityUsed, getPhenotype, isAppraised, saleQuote, sellCreature, unlockHint } from '../gameApi.ts';
import type { SaleQuote } from '../gameApi.ts';

function quoteRow(label: string, value: number): string {
  return `<div class="market-quote__row"><dt>${esc(label)}</dt><dd>${value >= 0 ? '+' : ''}${num(value)} コイン</dd></div>`;
}

function saleDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '記録日不明';
  return new Date(ms).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
}

function historyRow(record: SaleRecord): string {
  const parents = record.parentNames ? `親：${record.parentNames[0]} × ${record.parentNames[1]}` : '親情報なし';
  const datetime = Number.isFinite(record.soldAt) && record.soldAt > 0 ? new Date(record.soldAt).toISOString() : '';
  return (
    `<li class="market-history__row">` +
    `<span class="market-history__main"><strong>${esc(record.creatureName)}</strong>` +
    `<span>${esc(STAGE_LABEL[record.stage])}・${esc(generationLabel(record.generation))} ／ ${esc(parents)}</span></span>` +
    `<span class="market-history__price">+${num(record.price)}<small> コイン</small></span>` +
    `<time datetime="${esc(datetime)}">${esc(saleDate(record.soldAt))}</time>` +
    `</li>`
  );
}

export function screenMarket(app: App, host: HTMLElement): Screen {
  function quoteBreakdown(quote: SaleQuote): string {
    return (
      `<dl class="market-quote">` +
      quoteRow('基本価格', quote.base) +
      quoteRow('見た目の評価', quote.observedBonus) +
      quoteRow('コンディション', quote.conditionBonus) +
      quoteRow('展示実績', quote.exhibitionBonus) +
      quoteRow('世代ボーナス', quote.generationBonus) +
      // 鑑定書つきのときだけ現れる行。未鑑定では 0 なので、行ごと出さない
      // （「0 コイン」と出すと、鑑定すれば必ず上がる額があると読める）。
      (quote.appraised ? quoteRow('鑑定書つきの遺伝的希少価値', quote.rarityBonus) : '') +
      `</dl>`
    );
  }

  function candidateCard(c: Creature): string {
    const result = saleQuote(app.state, c.id);
    const pheno = getPhenotype(c, c.life.stage);
    const favorite = c.favorite ? `<span class="pill pill--brass">お気に入り</span>` : '';
    const appraisal = isAppraised(c) ? `<span class="pill pill--brass">鑑定済み</span>` : `<span class="pill">未鑑定</span>`;
    const art = thumbSvg(pheno, c.life, `${c.name}（${STAGE_LABEL[c.life.stage]}）`);

    if (!result.ok) {
      return (
        `<article class="market-candidate market-candidate--blocked">` +
        `<div class="market-candidate__head"><span class="market-candidate__name">${esc(c.name)}</span>${stagePill(c.life.stage)}${favorite}${appraisal}</div>` +
        `<div class="market-candidate__body"><div class="market-candidate__art" aria-hidden="true">${art}</div>` +
        `<div class="market-candidate__info"><p class="market-candidate__meta">${esc(generationLabel(c.generation))}</p>` +
        `<p class="market-candidate__blocked">${esc(result.reason)}</p></div></div>` +
        `</article>`
      );
    }

    const quote = result.quote;
    const appraised = isAppraised(c);
    return (
      `<article class="market-candidate">` +
      `<div class="market-candidate__head"><span class="market-candidate__name">${esc(c.name)}</span>${stagePill(c.life.stage)}${favorite}${appraisal}</div>` +
      `<div class="market-candidate__body"><div class="market-candidate__art" aria-hidden="true">${art}</div>` +
      `<div class="market-candidate__info"><p class="market-candidate__meta">${esc(generationLabel(c.generation))} ／ 展示 ${c.exhibitionCount} 回</p>` +
      `<div class="market-candidate__price"><span>見積もり</span><strong>${num(quote.price)}</strong><small>コイン</small></div>` +
      `</div></div>` +
      quoteBreakdown(quote) +
      (!appraised
        ? `<p class="section__note" style="margin:var(--sp-2) 0">鑑定書が ないので、市場は 見た目・体調・実績だけで 値を付けています。鑑定すると 遺伝的な めずらしさが 評価に 加わります。</p>`
        : '') +
      `<button type="button" class="btn btn--brass market-candidate__sell" data-sell="${esc(c.id)}">この子を 売る</button>` +
      `</article>`
    );
  }

  function render(): void {
    if (!app.state.unlocks.breeder || !app.state.breeder.licensed) {
      setHtml(
        host,
        pageHeader('販売所', '公認ブリーダーの資格が必要です。', 'coin') +
          `<section class="section">${emptyState('lock', [unlockHint(app.state, 'breeder')])}</section>`,
      );
      return;
    }

    const used = capacityUsed(app.state);
    const candidates = app.state.creatures.slice().sort((a, b) => {
      const aq = saleQuote(app.state, a.id);
      const bq = saleQuote(app.state, b.id);
      const ap = aq.ok ? aq.quote.price : -1;
      const bp = bq.ok ? bq.quote.price : -1;
      return bp - ap || a.name.localeCompare(b.name, 'ja');
    });
    const cards = candidates.length > 0
      ? candidates.map(candidateCard).join('')
      : emptyState('sprout', ['販売できる個体が いません。']);
    const history = app.state.breeder.history.length > 0
      ? `<ol class="market-history">${app.state.breeder.history.map(historyRow).join('')}</ol>`
      : emptyState('book', ['まだ販売履歴は ありません。']);

    setHtml(
      host,
      pageHeader(
        '公認ブリーダー販売所',
        `売上 ${num(app.state.breeder.earnings)} コイン ／ ${app.state.breeder.sales} 件 ／ 飼育中 ${app.state.creatures.length} 体（卵 ${used.egg}・幼体 ${used.juvenile}・成体 ${used.adult}）`,
        'coin',
      ) +
        section(
          '販売する個体を 選ぶ',
          `<p class="section__note">市場価格は 見た目・体調・展示実績・世代から 算出します。遺伝的な めずらしさが 評価に 加わるのは、鑑定書の ある子だけです。</p>` +
            `<div class="market-candidates">${cards}</div>`,
          '販売後も 2 体は残るように保護されています。',
          'sprout',
        ) +
        section('販売履歴', history, '直近 50 件まで保存します。', 'book'),
    );
  }

  async function doSell(creatureId: string): Promise<void> {
    const result = saleQuote(app.state, creatureId);
    if (!result.ok) {
      sfx.play('deny');
      toast(result.reason, 'warn');
      return;
    }
    const c = result.creature;
    const q = result.quote;
    const favoriteNote = c.favorite
      ? `<p style="color:var(--bad);font-weight:700">この子はお気に入りに 登録されています。</p>`
      : '';
    const appraisalNote = isAppraised(c)
      ? '<p>この個体は鑑定済みです。市場価格には正式な希少度評価も反映されています。</p>'
      : '<p>この個体は未鑑定です。市場価格は提示されますが、希少度の正確な内訳は分かりません。</p>';
    const ok = await confirmDialog(
      `${c.name}を 販売しますか？`,
      `<p><strong>${esc(c.name)}</strong>（${esc(STAGE_LABEL[c.life.stage])}・${esc(generationLabel(c.generation))}）を ` +
        `<strong>${num(q.price)} コイン</strong>で 販売します。</p>` +
        `<dl class="market-quote">${quoteRow('各種評価を反映', q.price - q.base)}${quoteRow('入金額', q.price)}</dl>` +
        appraisalNote +
        favoriteNote +
        `<p>販売した個体は育成室からいなくなり、販売履歴だけが残ります。</p>`,
      `販売する（${num(q.price)} コイン）`,
      true,
    );
    if (!ok) return;

    const sold = sellCreature(app.state, creatureId, Date.now());
    if (!sold.ok) {
      sfx.play('deny');
      toast(sold.reason, 'warn');
      render();
      return;
    }
    sfx.play('buy');
    app.save('個体販売');
    app.rerender();
    toast(`${sold.record.creatureName}を 販売し、${num(sold.record.price)} コインを受け取りました。`, 'good', 4600);
    render();
  }

  const off = delegate(host, 'click', '[data-sell]', (target) => {
    const id = target.dataset.sell;
    if (!id) return;
    sfx.play('tap');
    void doSell(id);
  });

  render();

  return {
    update: render,
    dispose() {
      off();
    },
  };
}
