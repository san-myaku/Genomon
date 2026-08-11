/**
 * ショップ。
 *
 * 【要件（指示書 §8）】
 *   名前・価格・効果・短い説明・所持数・使用対象を表示し、購入と使用が実際に動くこと。
 *   未入荷の品は「今後解放」として条件を明示する（反応しないダミーは置かない）。
 *
 * 【使用対象の扱い】
 *   消耗品は「誰に使うか」を選ばせる必要がある。
 *   対象になり得る個体が 1 体しかいないときは選ばせず、そのまま使う（余計な一手を増やさない）。
 */

import type { ShopItemDef } from '../../core/types.ts';
import { icon, iconOrText } from '../icons.ts';
import { sfx } from '../../audio/index.ts';
import type { App, Screen } from '../app.ts';
import { pageHeader, section } from '../app.ts';
import { delegate, esc, setHtml } from '../dom.ts';
import { emptyState, lockedNotice } from '../components/bits.ts';
import { openDialog } from '../components/dialog.ts';
import { toast } from '../components/toast.ts';
import { ITEM_ICON, STAGE_LABEL, num } from '../format.ts';
import { thumbSvg } from '../creatureView.ts';
import {
  SHOP_ITEM_BY_ID,
  availableItems,
  buyItem,
  getPhenotype,
  lockedItems,
  unlockHint,
  useItem,
} from '../gameApi.ts';

const TARGET_LABEL: Readonly<Record<string, string>> = {
  egg: 'たまごに 使う',
  juvenile: 'ようたいに 使う',
  adult: 'せいたいに 使う',
  any: 'どの子にも 使える',
  room: '育成室に 置く',
};

export function screenShop(app: App, host: HTMLElement): Screen {
  function itemCard(it: ShopItemDef, owned: boolean): string {
    const afford = app.state.coins >= it.price;
    return (
      `<div class="item${owned ? ' item--owned' : ''}">` +
      `<span class="item__ico" aria-hidden="true">${iconOrText(ITEM_ICON[it.kind] ?? 'box')}</span>` +
      `<span class="item__main">` +
      `<span class="item__name">${esc(it.name)}</span>` +
      `<span class="item__eff">${esc(it.effectText)}</span>` +
      `<span class="item__desc">${esc(it.desc)}</span>` +
      `</span>` +
      `<span class="item__foot">` +
      `<span class="pill">${esc(TARGET_LABEL[it.target] ?? it.target)}</span>` +
      `<span class="pill">${it.consumable ? '消耗品' : '永続'}</span>` +
      `<span class="grow"></span>` +
      `<span class="item__price">${icon('coin')} ${num(it.price)}</span>` +
      (owned
        ? `<span class="pill pill--leaf">設置ずみ</span>`
        : `<button type="button" class="btn btn--sm" data-buy="${esc(it.id)}"${afford ? '' : ' disabled'}>` +
          `${afford ? '買う' : 'コイン不足'}</button>`) +
      `</span></div>`
    );
  }

  function render(): void {
    if (!app.state.unlocks.shop) {
      setHtml(
        host,
        pageHeader('ショップ', undefined, 'pot') + lockedNotice('ショップ', unlockHint(app.state, 'shop')),
      );
      return;
    }

    const items = availableItems(app.state);
    const locked = lockedItems(app.state);
    const consumables = items.filter((i) => i.consumable);
    const permanents = items.filter((i) => !i.consumable);
    const ownedItems = app.state.owned
      .map((id) => SHOP_ITEM_BY_ID[id])
      .filter((i): i is ShopItemDef => !!i);

    // 手持ちの消耗品
    const invRows = Object.entries(app.state.inventory)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => {
        const it = SHOP_ITEM_BY_ID[id];
        if (!it) return '';
        return (
          `<div class="inv__row">` +
          `<span aria-hidden="true">${iconOrText(ITEM_ICON[it.kind] ?? 'box')}</span>` +
          `<span class="inv__name">${esc(it.name)}</span>` +
          `<span class="pill">${n} 個</span>` +
          `<button type="button" class="btn btn--sm btn--leaf" data-use="${esc(id)}">使う</button>` +
          `</div>`
        );
      })
      .join('');

    // 「手持ちの 品」は、空のときに大きな空状態を最上部へ置くと
    // スマホ画面の 6 割を占めて商品が 1 つも見えなくなる。
    // 中身があるときだけ先頭に出し、無いときは短い一行にして商品の下へ回す。
    const invSection = invRows
      ? section('手持ちの 品', `<div class="inv">${invRows}</div>`, undefined, 'basket')
      : '';
    const invNote = invRows
      ? ''
      : `<p class="section__note" style="margin-top:var(--sp-4)">` +
        `手持ちの 品：まだ 何も ありません。買った 消耗品は ここに たまります。</p>`;

    setHtml(
      host,
      pageHeader('ショップ', `いまの 所持コイン：${num(app.state.coins)} 枚`, 'pot') +
        invSection +
        section(
          '消耗品',
          consumables.length > 0
            ? `<div class="shop">${consumables.map((i) => itemCard(i, false)).join('')}</div>`
            : emptyState('box', ['いまは 何も ありません。']),
          '一度 使うと なくなります。世話の 効果を 大きく 上げられます。',
          'jar',
        ) +
        section(
          '装飾・設備',
          permanents.length > 0 || ownedItems.length > 0
            ? `<div class="shop">${permanents.map((i) => itemCard(i, false)).join('')}` +
              `${ownedItems.map((i) => itemCard(i, true)).join('')}</div>`
            : emptyState('vase', ['いまは 何も ありません。']),
          '買うと ずっと 効きます。育成室の 見た目にも 出ます。',
          'vase',
        ) +
        (locked.length > 0
          ? section(
              'これから 入荷する 品',
              locked
                .map((l) =>
                  lockedNotice(
                    l.item.name,
                    `${l.item.effectText}｜${num(l.item.price)} コイン｜${l.hint}`,
                    ITEM_ICON[l.item.kind] ?? 'box',
                  ),
                )
                .join(''),
              '条件を みたすと 買えるようになります。',
              'lock',
            )
          : '') +
        invNote,
    );
  }

  /** 消耗品を使う対象を選ばせる。 */
  async function chooseTargetAndUse(itemId: string): Promise<void> {
    const it = SHOP_ITEM_BY_ID[itemId];
    if (!it) return;

    const candidates = app.state.creatures.filter(
      (c) => it.target === 'any' || it.target === c.life.stage,
    );
    if (candidates.length === 0) {
      sfx.play('deny');
      toast(`「${it.name}」を 使える子が いません。`, 'warn');
      return;
    }

    let targetId = candidates[0]!.id;
    if (candidates.length > 1) {
      const body =
        `<div class="grid-auto">` +
        candidates
          .map(
            (c) =>
              `<button type="button" class="ccard" data-val="${esc(c.id)}" style="border:2px solid var(--line)">` +
              // 絵は aria-hidden（SVG 内の <style> がボタンの読み上げに混じらないように）
              `<span class="ccard__art" aria-hidden="true">${thumbSvg(getPhenotype(c, c.life.stage), c.life)}</span>` +
              `<span class="ccard__name">${esc(c.name)}</span>` +
              `<span class="ccard__meta">${esc(STAGE_LABEL[c.life.stage])}</span></button>`,
          )
          .join('') +
        `</div>`;
      const picked = await openDialog({
        title: `「${it.name}」を だれに 使いますか？`,
        icon: 'gift',
        bodyHtml: body,
        actions: [{ label: 'やめる', value: 'cancel', kind: 'ghost', cancel: true }],
      });
      if (picked === 'cancel') return;
      targetId = picked;
    }

    const result = useItem(app.state, targetId, itemId, Date.now());
    if (!result.ok) {
      sfx.play('deny');
      toast(result.reason ?? '使えませんでした。', 'warn');
      return;
    }
    const target = app.state.creatures.find((c) => c.id === targetId);
    sfx.play('buy');
    if (target && target.life.stage !== 'egg') {
      window.setTimeout(
        () => sfx.voice(target.seed, getPhenotype(target, target.life.stage).personality, result.reaction),
        160,
      );
    }
    toast(result.speech || `「${it.name}」を 使いました。`, 'good');
    app.save('アイテム使用');
    app.rerender();
    render();
  }

  const off = delegate(host, 'click', '[data-buy],[data-use]', (t) => {
    const buy = t.dataset.buy;
    if (buy) {
      const r = buyItem(app.state, buy);
      if (!r.ok) {
        sfx.play('deny');
        toast(r.reason ?? '買えませんでした。', 'warn');
        return;
      }
      const it = SHOP_ITEM_BY_ID[buy];
      sfx.play('buy');
      toast(`「${it?.name ?? buy}」を 買いました。`, 'good');
      app.save('購入');
      app.rerender();
      render();
      return;
    }
    const use = t.dataset.use;
    if (use) {
      sfx.play('tap');
      void chooseTargetAndUse(use);
    }
  });

  render();

  return {
    update: render,
    dispose() {
      off();
    },
  };
}
