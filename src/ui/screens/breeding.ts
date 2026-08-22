/**
 * 交配。
 *
 * 見た目の特徴は誰でも比較できるが、子に出る形質の遺伝予測は
 * 両親を鑑定したときだけ開く。未鑑定の親から保因情報を逆算できないようにする。
 */

import type { Creature } from '../../core/types.ts';
import { icon } from '../icons.ts';
import { sfx } from '../../audio/index.ts';
import type { App, Screen } from '../app.ts';
import { pageHeader, section } from '../app.ts';
import { $, burstSparkles, delegate, esc, setHtml } from '../dom.ts';
import { thumbSvg } from '../creatureView.ts';
import { creatureCard, emptyState, lockedNotice } from '../components/bits.ts';
import { toast } from '../components/toast.ts';
import { BREEDING_UI, STAGE_LABEL, generationLabel, num } from '../format.ts';
import { visibleRarity, visibleTraits } from '../traits.ts';
import {
  breedCooldownLeft,
  breedingPreview,
  canBreed,
  creaturesByStage,
  doBreed,
  findCreature,
  getPhenotype,
  isAppraised,
  observedRarity,
  roomLeft,
  unlockHint,
} from '../gameApi.ts';

export function screenBreeding(app: App, host: HTMLElement): Screen {
  let aId: string | null = null;
  let bId: string | null = null;
  /** 直近に生まれた卵（生まれた卵を画面に出すため）。 */
  let bornEggId: string | null = null;
  /** 直前の操作で交配が成功したか（成功をはっきり見せるため）。 */
  let justBred = false;
  /** 成功直後に生まれた卵まで自動スクロールする、の 1 回きりフラグ。 */
  let scrollToBorn = false;
  /**
   * 成功カードを見せているあいだ「次の目標」を据え置くための解除関数。
   *
   * 交配すると両親の機嫌が下がるので、放っておくと成功した次の瞬間に
   * 目標行が「交配の じゅんび: ○○ の 機嫌が たりません（59 / 60）」へ変わる。
   * せっかくの成功が、失敗しているように見える文で一瞬にして塗りつぶされる。
   */
  let releaseObjective: (() => void) | null = null;
  let objectiveTimer = 0;

  function resumeObjective(): void {
    window.clearTimeout(objectiveTimer);
    objectiveTimer = 0;
    const fn = releaseObjective;
    releaseObjective = null;
    fn?.();
  }

  /** 成功の余韻のあいだだけ目標行を止める（自動で戻す）。 */
  function holdObjectiveFor(ms: number): void {
    resumeObjective();
    releaseObjective = app.holdObjective();
    objectiveTimer = window.setTimeout(() => resumeObjective(), ms);
  }

  /** 親カードの主な特徴（3 つまで）。 */
  function mainTraits(c: Creature): string {
    const pheno = getPhenotype(c, 'adult');
    const list = visibleTraits(pheno, 'adult')
      .filter((t) => t.notable)
      .slice(0, 3);
    const fallback = visibleTraits(pheno, 'adult').slice(0, 3);
    return (list.length > 0 ? list : fallback)
      .map((t) => `<span class="pill${t.notable ? ' pill--notable' : ''}">${esc(t.label)}：${esc(t.value)}</span>`)
      .join('');
  }

  function parentPanel(role: 'A' | 'B', id: string | null): string {
    const c = id ? findCreature(app.state, id) : undefined;
    if (!c) {
      return (
        `<div class="card card--sunk" style="text-align:center">` +
        `<p class="section__note" style="margin:0">親${role} を えらんでください</p></div>`
      );
    }
    const pheno = getPhenotype(c, 'adult');
    const appraised = isAppraised(c);
    const rarityText = appraised
      ? `${pheno.rarity.score.toFixed(1)} / 100`
      : observedRarity(pheno).label;
    return (
      `<div class="card">` +
      `<div class="row"><span class="pill pill--accent">親${role}</span>` +
      `<strong style="color:var(--head)">${esc(c.name)}</strong>` +
      (appraised ? `<span class="pill pill--brass">${icon('helix')} 鑑定済み</span>` : '') +
      `</div>` +
      `<div class="compare__art" style="margin:var(--sp-2) 0">${thumbSvg(pheno, c.life)}</div>` +
      `<div class="row" style="gap:4px">${mainTraits(c)}</div>` +
      `<p class="section__note" style="margin:var(--sp-2) 0 0;font-size:.78rem">` +
      `性格：${esc(pheno.personality.label)}／配色：${esc(pheno.palette.family)}系／` +
      `めずらしさ：${esc(rarityText)}</p>` +
      `</div>`
    );
  }

  /**
   * 必要な条件を **全部** 並べる。
   *
   * `canBreed` は最初に引っかかった 1 つしか返さないので、
   * コインが 0 でも「機嫌が たりません」としか出ず、何を揃えれば動くのかが分からない。
   * 判定の正本は canBreed のままにしたうえで、表示だけ UI 側で列挙する。
   * しきい値は format.ts の BREEDING_UI（game/config.ts の写し）を使う。
   */
  function conditions(a: Creature | undefined, b: Creature | undefined): { ok: boolean; text: string }[] {
    const now = Date.now();
    const rows: { ok: boolean; text: string }[] = [];
    const bothPicked = !!a && !!b && a.id !== b.id;

    rows.push({ ok: bothPicked, text: '成体を 2 体 えらぶ' });

    for (const c of [a, b]) {
      if (!c) continue;
      if (c.life.stage !== 'adult') rows.push({ ok: false, text: `${c.name} が 成体である` });
      rows.push({
        ok: c.life.mood >= BREEDING_UI.minMood,
        text: `${c.name} の 機嫌 ${Math.floor(c.life.mood)} / ${BREEDING_UI.minMood}`,
      });
      rows.push({
        ok: c.life.health >= BREEDING_UI.minHealth,
        text: `${c.name} の 健康 ${Math.floor(c.life.health)} / ${BREEDING_UI.minHealth}`,
      });
      const left = breedCooldownLeft(c, now);
      if (left > 0) rows.push({ ok: false, text: `${c.name} の 休息あけ まで あと ${Math.ceil(left / 1000)} 秒` });
    }

    rows.push({
      ok: app.state.coins >= BREEDING_UI.costCoins,
      text: `コイン ${num(app.state.coins)} / ${BREEDING_UI.costCoins}`,
    });
    const eggRoom = roomLeft(app.state, 'egg');
    rows.push({ ok: eggRoom > 0, text: `たまごの 空き枠 ${eggRoom} / ${app.state.capacity.egg}` });
    return rows;
  }

  function conditionsHtml(rows: { ok: boolean; text: string }[]): string {
    return (
      `<ul class="cond">` +
      rows
        .map(
          (r) =>
            `<li class="cond__row" data-ok="${r.ok ? '1' : '0'}">` +
            `<span class="cond__mark" aria-hidden="true">${r.ok ? icon('check') : '・'}</span>` +
            `<span>${esc(r.text)}</span>` +
            `<span class="sr-only">${r.ok ? '（そろっています）' : '（まだ たりません）'}</span></li>`,
        )
        .join('') +
      `</ul>`
    );
  }

  function render(): void {
    if (!app.state.unlocks.breeding) {
      setHtml(
        host,
        pageHeader('交配', undefined, 'helix') + lockedNotice('交配', unlockHint(app.state, 'breeding')),
      );
      return;
    }

    const adults = creaturesByStage(app.state, 'adult');
    const chk = aId && bId ? canBreed(app.state, aId, bId) : { ok: false, reason: '成体を 2 体 えらんでください。' };
    const parentA = aId ? findCreature(app.state, aId) : undefined;
    const parentB = bId ? findCreature(app.state, bId) : undefined;
    const bothAppraised = Boolean(parentA && parentB && isAppraised(parentA) && isAppraised(parentB));

    const preview = bothAppraised && parentA && parentB ? breedingPreview(parentA, parentB) : [];

    const cards = adults
      .map((c) => {
        const pheno = getPhenotype(c, 'adult');
        const picked = c.id === aId || c.id === bId;
        const role = c.id === aId ? '親A' : c.id === bId ? '親B' : '';
        const appraised = isAppraised(c);
        const extra = appraised
          ? [`<span class="pill pill--brass">${icon('helix')} 鑑定済み</span>`]
          : [`<span class="pill">${icon('spark')} ${esc(observedRarity(pheno).label)}</span>`];
        return creatureCard(c, pheno, {
          action: 'pickparent',
          pressed: picked,
          rarity: appraised ? visibleRarity(pheno, 'adult') : null,
          extraPills: extra,
          meta: role
            ? `えらばれています（${role}）`
            : `${STAGE_LABEL[c.life.stage]}・${generationLabel(c.generation)}`,
        });
      })
      .join('');

    const egg = bornEggId ? findCreature(app.state, bornEggId) : undefined;
    const condRows = conditions(parentA, parentB);

    const geneticsSection =
      aId && bId
        ? bothAppraised
          ? preview.length > 0
            ? section(
                '鑑定データから見る 遺伝予測',
                `<ul class="lines">${preview.map((p) => `<li><strong>${esc(p.label)}</strong>：${esc(p.detail)}</li>`).join('')}</ul>`,
                '両親の全遺伝子を使った予測です。実際の子では減数分裂と突然変異が起こります。',
                'helix',
              )
            : ''
          : section(
              '遺伝予測は 未開示です',
              `<div class="card card--tight"><p style="margin:0"><strong>両親を鑑定すると、ここに詳しい遺伝予測が出ます。</strong></p>` +
                `<p class="section__note" style="margin:var(--sp-2) 0 0">` +
                `いま分かるのは見た目の特徴だけです。未鑑定の個体が持つ潜在形質は交配画面からは分かりません。</p></div>`,
              undefined,
              'lock',
            )
        : '';

    setHtml(
      host,
      pageHeader('交配', '成体を 2 体 えらぶと、その子の たまごが 生まれます。', 'helix') +
        `<div class="compare" style="grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);margin-bottom:var(--sp-4)">` +
        parentPanel('A', aId) +
        `<div class="compare__mid" style="font-size:1.6rem" aria-hidden="true">${icon('cross')}</div>` +
        parentPanel('B', bId) +
        `</div>` +
        (justBred
          ? `<div class="card card--tight card--done" style="margin-bottom:var(--sp-4)">` +
            `<div class="row"><span class="pill pill--leaf">${icon('check')} 交配できました</span>` +
            `<span class="grow"><p class="section__note" style="margin:2px 0 0">` +
            `${esc(egg ? `${egg.name} の たまごが 生まれました。` : 'あたらしい たまごが 生まれました。')}` +
            `つづけて 交配するには、下から 成体を えらび直してください。</p></span>` +
            `<a class="btn btn--sm" href="#/nursery" data-act="tonursery">育成室へ</a></div>` +
            `</div>`
          : '') +
        `<div class="card card--tight" style="margin-bottom:var(--sp-4)">` +
        `<div class="row"><span class="grow"><strong style="color:var(--head)">必要な 条件</strong>` +
        `<p class="section__note" style="margin:2px 0 4px">${esc(chk.ok ? 'そろっています。交配できます。' : (chk.reason ?? ''))}</p>` +
        conditionsHtml(condRows) +
        `</span>` +
        `<button type="button" class="btn btn--cost" data-act="breed"${chk.ok ? '' : ' disabled'}>` +
        // 交配は 80 コインかかる。押してから減るのでは事後報告なので、ボタンに併記する。
        `<span>交配する</span><span class="btn__cost">${icon('coin')} ${BREEDING_UI.costCoins}</span></button></div>` +
        `</div>` +
        geneticsSection +
        (egg
          ? `<div data-born>` +
            section(
              '生まれた たまご',
              `<div class="card" style="text-align:center">` +
                `<div class="compare__art" style="max-width:200px;margin:0 auto">${thumbSvg(getPhenotype(egg, 'egg'), egg.life)}</div>` +
                `<p style="font-weight:800;color:var(--head);margin-top:var(--sp-2)">${esc(egg.name)}</p>` +
                `<p class="section__note" style="margin:0">育成室で 世話を すると 孵ります。</p>` +
                `<div class="row row--end" style="margin-top:var(--sp-2)">` +
                `<a class="btn btn--sm" href="#/nursery" data-act="tonursery">育成室へ</a></div>` +
                `</div>`,
              undefined,
              'egg',
            ) +
            `</div>`
          : '') +
        section(
          '成体の 一覧',
          adults.length > 0 ? `<div class="grid-auto">${cards}</div>` : emptyState('sprout', ['成体が いません。']),
          'カードを 押すと 親A → 親B の 順で えらばれます。鑑定済みの親どうしなら詳しい遺伝予測も見られます。',
          'leaf',
        ),
    );

    // 成功したときは、生まれた卵まで自動で送る（成功が画面外だと気付けない）。
    if (scrollToBorn) {
      scrollToBorn = false;
      const born = $('[data-born]', host);
      born?.scrollIntoView({ behavior: app.reducedMotion ? 'auto' : 'smooth', block: 'center' });
    }
  }

  const off = delegate(host, 'click', '[data-pickparent],[data-act]', (t) => {
    const act = t.dataset.act;
    if (act === 'breed') {
      if (!aId || !bId) return;
      const r = doBreed(app.state, aId, bId, Date.now());
      if (!r.ok) {
        sfx.play('deny');
        toast(r.reason ?? '交配できませんでした。', 'warn');
        return;
      }
      bornEggId = r.eggId ?? null;
      sfx.play('breed');
      burstSparkles($('.compare', host), 16);
      // 交配すると両親の機嫌が下がるので、選択を残したままだと
      // 成功直後に「機嫌が たりません」＋灰色のボタンが出て、失敗に見える。
      // 成功をはっきり見せて、親の選択は解除する。
      justBred = true;
      scrollToBorn = true;
      aId = null;
      bId = null;
      holdObjectiveFor(8000);
      app.save('交配');
      app.rerender();
      toast('あたらしい たまごが 生まれました。', 'good', 4200);
      return;
    }
    if (act === 'tonursery') return; // 通常のリンクとして遷移させる

    const id = t.dataset.pickparent;
    if (!id) return;
    sfx.play('tap');
    // 次の交配へ進んだ＝余韻は終わり。目標行を動かしてよい。
    if (justBred) resumeObjective();
    justBred = false;
    if (id === aId) aId = null;
    else if (id === bId) bId = null;
    else if (!aId) aId = id;
    else if (!bId) bId = id;
    // 2 体そろっているときは、押した子を親B に入れ替える（選び直しやすくする）。
    else bId = id;
    render();
  });

  render();

  return {
    update: render,
    dispose() {
      off();
      // 止めっぱなしにすると、他の画面で目標行が固まってしまう。
      resumeObjective();
    },
  };
}
