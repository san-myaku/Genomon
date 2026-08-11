/**
 * 交配。
 *
 * 【要件（指示書 §9）】
 *   親A・親B・親の主な特徴・遺伝情報の概要・子に受け継がれる可能性がある特徴（breedingPreview）・
 *   必要条件・生まれた卵 を表示する。
 *
 * 【設計】
 *   2 体を選ぶまでは条件（canBreed の reason）を出し続け、
 *   「なぜ交配できないのか」が常に画面上で分かるようにする。
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
    return (
      `<div class="card">` +
      `<div class="row"><span class="pill pill--accent">親${role}</span>` +
      `<strong style="color:var(--head)">${esc(c.name)}</strong></div>` +
      `<div class="compare__art" style="margin:var(--sp-2) 0">${thumbSvg(pheno, c.life)}</div>` +
      `<div class="row" style="gap:4px">${mainTraits(c)}</div>` +
      `<p class="section__note" style="margin:var(--sp-2) 0 0;font-size:.78rem">` +
      `性格：${esc(pheno.personality.label)}／配色：${esc(pheno.palette.family)}系／` +
      `めずらしさ：${pheno.rarity.tier === 'common' ? 'ふつう' : `${Math.round(pheno.rarity.score)} 点`}</p>` +
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
      if (c.life.stage !== 'adult') {
        rows.push({ ok: false, text: `${c.name} が 成体である` });
      }
      rows.push({
        ok: c.life.mood >= BREEDING_UI.minMood,
        text: `${c.name} の 機嫌 ${Math.floor(c.life.mood)} / ${BREEDING_UI.minMood}`,
      });
      rows.push({
        ok: c.life.health >= BREEDING_UI.minHealth,
        text: `${c.name} の 健康 ${Math.floor(c.life.health)} / ${BREEDING_UI.minHealth}`,
      });
      const left = breedCooldownLeft(c, now);
      if (left > 0) {
        rows.push({ ok: false, text: `${c.name} の 休息あけ まで あと ${Math.ceil(left / 1000)} 秒` });
      }
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

    const preview =
      aId && bId
        ? (() => {
            const a = findCreature(app.state, aId);
            const b = findCreature(app.state, bId);
            if (!a || !b) return [];
            return breedingPreview(a, b);
          })()
        : [];

    const cards = adults
      .map((c) => {
        const pheno = getPhenotype(c, 'adult');
        const picked = c.id === aId || c.id === bId;
        const role = c.id === aId ? '親A' : c.id === bId ? '親B' : '';
        return creatureCard(c, pheno, {
          action: 'pickparent',
          pressed: picked,
          rarity: visibleRarity(pheno, 'adult'),
          meta: role
            ? `えらばれています（${role}）`
            : `${STAGE_LABEL[c.life.stage]}・${generationLabel(c.generation)}`,
        });
      })
      .join('');

    const egg = bornEggId ? findCreature(app.state, bornEggId) : undefined;
    const condRows = conditions(
      aId ? findCreature(app.state, aId) : undefined,
      bId ? findCreature(app.state, bId) : undefined,
    );

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
        `<p class="section__note" style="margin:2px 0 4px">` +
        `${esc(chk.ok ? 'そろっています。交配できます。' : (chk.reason ?? ''))}</p>` +
        conditionsHtml(condRows) +
        `</span>` +
        // 交配は 80 コインかかる。押してから減るのでは事後報告なので、ボタンに併記する。
        `<button type="button" class="btn btn--cost" data-act="breed"${chk.ok ? '' : ' disabled'}>` +
        `<span>交配する</span>` +
        `<span class="btn__cost">${icon('coin')} ${BREEDING_UI.costCoins}</span></button></div>` +
        `</div>` +
        (preview.length > 0
          ? section(
              '子に 受けつがれる かもしれない 特徴',
              `<ul class="lines">` +
                preview
                  .map((p) => `<li><strong>${esc(p.label)}</strong>：${esc(p.detail)}</li>`)
                  .join('') +
                `</ul>`,
              'どちらの 形質が 出るかは 生まれるまで 分かりません。かくれていた 形質が 出ることも あります。',
              'sprout',
            )
          : '') +
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
          adults.length > 0
            ? `<div class="grid-auto">${cards}</div>`
            : emptyState('sprout', ['成体が いません。']),
          'カードを 押すと 親A → 親B の 順で えらばれます。もう一度 押すと 外れます。',
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
      // 成功カードを読むあいだ、目標行を据え置く。
      holdObjectiveFor(8000);
      app.save('交配');
      app.rerender(); // update() = render()
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
    else {
      // 2 体そろっているときは、押した子を親B に入れ替える（選び直しやすくする）。
      bId = id;
    }
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
