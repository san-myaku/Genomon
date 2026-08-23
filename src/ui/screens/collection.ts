/**
 * 標本帳（コレクション）。
 *
 * 【要件】
 *   - 所持個体の一覧。
 *   - 並べ替えができること。
 *   - 親子・兄弟の関係が分かること。
 *
 * 【親子関係の見せ方】
 *   Creature.parents（ID）と parentNames（名前のスナップショット）の両方を使う。
 *   親を手放していても parentNames が残るので、系譜の表示は途切れない。
 *   兄弟は「親の組み合わせが同じ個体」として求める。
 *
 * 【森へ かえした子】
 *   枠は各段階 3 体しかなく、交配のたびに親を手放すことになる。
 *   手放した子が観察帳から消えると「続けるほど記録が減る観察帳」になってしまうので、
 *   UI 側の記録（releasedLog）をタブで並べる。姿は保存した遺伝情報から描き直す。
 *
 * 【鑑定前は伏せる】
 *   正確な希少度で並べ替えたり rarity tier を表示したりしない。
 *   並び順から exact score を逆算されるのも漏れなので、
 *   「めずらしさ」の並べ替えは鑑定済み個体どうしだけで比べる。
 */

import type { Creature } from '../../core/types.ts';
import { icon } from '../icons.ts';
import { sfx } from '../../audio/index.ts';
import type { App, Screen } from '../app.ts';
import { pageHeader } from '../app.ts';
import { delegate, esc, setHtml } from '../dom.ts';
import { creatureCard, emptyState, rarityPill, stagePill } from '../components/bits.ts';
import { thumbSvg } from '../creatureView.ts';
import { STAGE_LABEL, generationLabel } from '../format.ts';
import { visibleRarity } from '../traits.ts';
import { loadReleased, releasedAsCreature, releasedDateLabel } from '../releasedLog.ts';
import type { ReleasedRecord } from '../releasedLog.ts';
import { getPhenotype, isAppraised, observedRarity } from '../gameApi.ts';

type SortKey = 'born' | 'stage' | 'rarity' | 'score' | 'name';

const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: 'born', label: '生まれた順' },
  { key: 'stage', label: '育ち順' },
  { key: 'rarity', label: '鑑定済みの希少度' },
  { key: 'score', label: '展示会の点' },
  { key: 'name', label: '名前' },
];

const STAGE_ORDER: Record<string, number> = { egg: 0, juvenile: 1, adult: 2 };

/** 親の組が同じなら兄弟。順序は問わないので並べ替えてから比べる。 */
function familyKey(c: Creature): string | null {
  if (!c.parents) return null;
  return [...c.parents].sort().join('|');
}

type Tab = 'here' | 'released';

export function screenCollection(app: App, host: HTMLElement): Screen {
  let sort: SortKey = 'born';
  let tab: Tab = 'here';

  function sorted(): Creature[] {
    const list = app.state.creatures.slice();
    switch (sort) {
      case 'stage':
        return list.sort(
          (a, b) =>
            (STAGE_ORDER[b.life.stage] ?? 0) - (STAGE_ORDER[a.life.stage] ?? 0) || b.bornAt - a.bornAt,
        );
      case 'rarity':
        // 未鑑定個体の exact score を並び順から逆算できないよう、鑑定済みだけ比較する。
        return list.sort((a, b) => {
          const ra = a.life.stage === 'adult' && isAppraised(a) ? getPhenotype(a, 'adult').rarity.score : -1;
          const rb = b.life.stage === 'adult' && isAppraised(b) ? getPhenotype(b, 'adult').rarity.score : -1;
          return rb - ra || b.bornAt - a.bornAt;
        });
      case 'score':
        return list.sort((a, b) => b.bestScore - a.bestScore || b.bornAt - a.bornAt);
      case 'name':
        return list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      default:
        return list.sort((a, b) => a.bornAt - b.bornAt);
    }
  }

  function relationText(c: Creature): string {
    const bits: string[] = [];
    if (c.parentNames) bits.push(`親：${c.parentNames[0]} × ${c.parentNames[1]}`);
    const key = familyKey(c);
    if (key) {
      const sibs = app.state.creatures.filter((o) => o.id !== c.id && familyKey(o) === key);
      if (sibs.length > 0) bits.push(`兄弟：${sibs.map((s) => s.name).join('・')}`);
    }
    const children = app.state.creatures.filter((o) => o.parents?.includes(c.id));
    if (children.length > 0) bits.push(`子：${children.map((s) => s.name).join('・')}`);
    if (bits.length > 0) return bits.join(' / ');
    // カードの世代表示と食い違わせない（generation は 1 始まり＝初代）。
    return c.generation <= 1 ? '初代（親の いない子）' : '親の 記録が のこっていません';
  }

  /**
   * 森へ かえした子の 1 枚。
   *
   * 記録はもう state に無いので、押しても開ける詳細画面が無い。
   * リンクに見せて行き止まりにするより、そこで完結する札にする。
   */
  function releasedCard(r: ReleasedRecord): string {
    const c = releasedAsCreature(r);
    const pheno = getPhenotype(c, r.stage);
    const appraised = isAppraised(c);
    const observed = observedRarity(pheno);
    const bits = [
      `${STAGE_LABEL[r.stage]}・${generationLabel(r.generation)}`,
      r.parentNames ? `親：${r.parentNames[0]} × ${r.parentNames[1]}` : '初代（親の いない子）',
      r.bestScore > 0 ? `展示会の 最高 ${Math.round(r.bestScore)} 点（${r.exhibitionCount} 回）` : '展示会には 出ていません',
      appraised ? '鑑定済み' : '未鑑定',
      `世話 ${r.careCount} 回`,
      `${releasedDateLabel(r.releasedAt)} に 森へ`,
    ];
    const rough = r.stage === 'adult' && !appraised ? `<span class="pill">${icon('spark')} ${esc(observed.label)}</span>` : '';
    return (
      `<div class="stack stack--s">` +
      `<div class="ccard ccard--released">` +
      `<span class="ccard__art" aria-hidden="true">${thumbSvg(pheno, c.life, `${r.name}`)}</span>` +
      `<span class="ccard__name">${esc(r.name)}</span>` +
      `<span class="ccard__meta">${icon('leaf')} 森へ かえした子</span>` +
      `<span class="ccard__pills">${stagePill(r.stage)}` +
      `${rarityPill(appraised ? visibleRarity(pheno, r.stage) : null, r.stage)}${rough}</span>` +
      `</div>` +
      `<p class="section__note" style="margin:0;font-size:.76rem">${bits.map((b) => esc(b)).join('<br>')}</p>` +
      `</div>`
    );
  }

  function renderReleased(): string {
    const list = loadReleased();
    return (
      pageHeader('標本帳', `森へ かえした子 ${list.length} 体の 記録です。`, 'book') +
        tabsHtml() +
        (list.length === 0
          ? emptyState('leaf', ['まだ 森へ かえした子は いません。', '手放した子は ここに 記録として のこります。'])
          : `<div class="grid-auto">${list.map((r) => releasedCard(r)).join('')}</div>`) +
        `<p class="section__note" style="margin-top:var(--sp-4)">` +
        `手放した子は もう 育てられませんが、姿と 記録は ここに のこります。` +
        `鑑定してから手放した子は、鑑定済みの記録も残ります。</p>`
    );
  }

  function tabsHtml(): string {
    const n = loadReleased().length;
    const item = (k: Tab, label: string): string =>
      `<button type="button" class="btn btn--ghost btn--sm" data-tab="${k}"` +
      ` aria-pressed="${k === tab ? 'true' : 'false'}"` +
      (k === tab ? ' style="border-color:var(--accent-deep);color:var(--accent-deep)"' : '') +
      `>${esc(label)}</button>`;
    return (
      `<div class="row" role="group" aria-label="表示の 切り替え" style="margin-bottom:var(--sp-3)">` +
      item('here', `いま 育てている子（${app.state.creatures.length}）`) +
      item('released', `森へ かえした子（${n}）`) +
      `</div>`
    );
  }

  function render(): void {
    if (tab === 'released') {
      setHtml(host, renderReleased());
      return;
    }
    const list = sorted();
    const cards = list
      .map((c) => {
        const pheno = getPhenotype(c, c.life.stage);
        const appraised = isAppraised(c);
        const observed = observedRarity(pheno);
        const rough = c.life.stage === 'adult' && !appraised
          ? [`<span class="pill">${icon('spark')} ${esc(observed.label)}</span>`]
          : appraised
            ? [`<span class="pill pill--brass">${icon('helix')} 鑑定済み</span>`]
            : [];
        return (
          `<div class="stack stack--s">` +
          creatureCard(c, pheno, {
            href: `#/detail/${encodeURIComponent(c.id)}`,
            rarity: appraised ? visibleRarity(pheno, c.life.stage) : null,
            extraPills: rough,
            // 卵・幼体は観察の札を出さないので、「？」の札はそのまま残す
            // （札が 1 枚も無いと、伏せていることすら伝わらない）。
            hideRarity: rough.length > 0,
            meta: `${STAGE_LABEL[c.life.stage]}・${generationLabel(c.generation)}${c.bestScore > 0 ? `・最高${Math.round(c.bestScore)}点` : ''}`,
          }) +
          `<p class="section__note" style="margin:0;font-size:.76rem">${esc(relationText(c))}</p>` +
          `</div>`
        );
      })
      .join('');

    const sortBtns = SORTS.map(
      (s) =>
        `<button type="button" class="btn btn--ghost btn--sm" data-sort="${s.key}"` +
        ` aria-pressed="${s.key === sort ? 'true' : 'false'}"` +
        (s.key === sort ? ' style="border-color:var(--accent-deep);color:var(--accent-deep)"' : '') +
        `>${esc(s.label)}</button>`,
    ).join('');

    const total = app.state.creatures.length;
    const adults = app.state.creatures.filter((c) => c.life.stage === 'adult').length;

    setHtml(
      host,
      pageHeader('標本帳', `いま ${total} 体（成体 ${adults} 体）を 育てています。`, 'book') +
        tabsHtml() +
        `<div class="row" role="group" aria-label="並べ替え" style="margin-bottom:var(--sp-3)">` +
        `<span class="pill">並べ替え</span>${sortBtns}</div>` +
        (total === 0
          ? emptyState('egg', ['まだ 記録が ありません。', '育成室で ゲノモンを 育てましょう。'])
          : `<div class="grid-auto">${cards}</div>`) +
        `<p class="section__note" style="margin-top:var(--sp-4)">` +
        `鑑定前は見た目からの印象だけを表示します。正確な希少度・潜在形質・全遺伝子は、個体の記録から鑑定すると開示されます。</p>`,
    );
  }

  const off = delegate(host, 'click', '[data-sort],[data-tab]', (t) => {
    sfx.play('tap');
    const nextTab = t.dataset.tab as Tab | undefined;
    if (nextTab) {
      tab = nextTab;
      render();
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    sort = (t.dataset.sort as SortKey) ?? 'born';
    render();
  });

  render();

  return {
    update: render,
    dispose() {
      off();
    },
  };
}
