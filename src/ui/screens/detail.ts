/**
 * 個体詳細。
 *
 * 【鑑定前後の情報差】
 *   通常の観察で分かるのは、表現型として外から見える特徴と大まかな印象だけ。
 *   保因・接合状態・全遺伝子座・正確な希少度と理由は鑑定後に初めて開示する。
 *   これは単なる UI の伏せ字ではなく、「見た目から推測して育種する」期間と
 *   「検査して設計する」期間を分けるゲームルール。
 *
 * 【成長段階のネタバレ防止】
 *   幼体・卵の特徴は genetics の visibleTraits(pheno, stage) を必ず通す。
 *   鑑定そのものも成体限定なので、未発達器官を先に知る経路を作らない。
 */

import type { Creature, Phenotype, Stage } from '../../core/types.ts';
import { icon } from '../icons.ts';
import { inheritanceHighlights } from '../../genetics/similarity.ts';
import { sfx } from '../../audio/index.ts';
import type { App, Screen } from '../app.ts';
import { pageHeader, section } from '../app.ts';
import { $, delegate, esc, setHtml } from '../dom.ts';
import { mountCreature, thumbSvg } from '../creatureView.ts';
import { gaugesFor, emptyState, rarityPill, stagePill } from '../components/bits.ts';
import { confirmDialog, openDialog } from '../components/dialog.ts';
import { toast } from '../components/toast.ts';
import { PERSONALITY_AXES, RARITY_LABEL, STAGE_LABEL, generationLabel } from '../format.ts';
import { rarityMaskNote, traitMaskNote, visibleRarity, visibleTraits } from '../traits.ts';
import { findReleasedById, recordRelease, releasedAsCreature } from '../releasedLog.ts';
import {
  APPRAISAL_COST,
  appraiseCreature,
  canAppraise,
  capacityUsed,
  creaturesByStage,
  deriveGeneticReport,
  findCreature,
  getPhenotype,
  isAppraised,
  observedRarity,
  releaseCreature,
  renameCreature,
  CREATURE_NAME_MAX_LENGTH,
} from '../gameApi.ts';

/** 親を 1 体ぶん解決した結果。手もとに いる／記録に のこっている／たどれない の 3 通り。 */
interface ParentView {
  name: string;
  /** 姿を出せるなら個体（記録から組み直したものを含む）。 */
  creature: Creature | null;
  where: 'here' | 'released' | 'gone';
}

/**
 * 見える特徴どうしを突き合わせた比較文（UI 側で組み立てる版）。
 * 鑑定前はこちらだけを使い、遺伝型を推測できる文を出さない。
 */
function traitCompareLines(
  child: Phenotype,
  stage: Stage,
  parents: { name: string; pheno: Phenotype }[],
  max = 6,
): string[] {
  const maps = parents.map((p) => ({
    name: p.name,
    map: new Map(visibleTraits(p.pheno, 'adult').map((t) => [String(t.locus), t])),
  }));
  const same: string[] = [];
  const diff: string[] = [];

  for (const t of visibleTraits(child, stage)) {
    const hits = maps.filter((m) => m.map.get(String(t.locus))?.value === t.value);
    const known = maps.filter((m) => m.map.has(String(t.locus)));
    if (known.length === 0) continue;

    if (hits.length === known.length && known.length === 2) {
      same.push(`${t.label}『${t.value}』は 両親そろって 同じ。この家系の しるし。`);
    } else if (hits.length > 0) {
      same.push(`${t.label}『${t.value}』は ${hits.map((h) => h.name).join('・')} ゆずり。`);
    } else {
      const others = known.map((m) => `${m.name}は『${m.map.get(String(t.locus))!.value}』`).join('、');
      diff.push(`${t.label}は『${t.value}』。${others}。`);
    }
  }
  return [...same, ...diff].slice(0, max);
}

const zygosityLabel = (z: 'homozygous' | 'heterozygous'): string =>
  z === 'homozygous' ? 'HOMO' : 'HET';

export function screenDetail(app: App, host: HTMLElement, params: string[]): Screen {
  const id = params[0] ? decodeURIComponent(params[0]) : (app.state.activeCreatureId ?? '');
  let stopMotion: () => void = () => {};

  function render(): void {
    stopMotion();
    const c: Creature | undefined = findCreature(app.state, id);
    if (!c) {
      setHtml(
        host,
        pageHeader('個体の記録', undefined, 'glass') +
          emptyState('question', ['その子は 見つかりませんでした。', '標本帳から えらび直してください。']) +
          `<div class="row row--end"><a class="btn btn--ghost" href="#/collection">標本帳へ</a></div>`,
      );
      return;
    }

    const stage = c.life.stage;
    const pheno = getPhenotype(c, stage);
    const traits = visibleTraits(pheno, stage);
    const rarity = visibleRarity(pheno, stage);
    const appraised = isAppraised(c);
    const observed = observedRarity(pheno);
    const report = appraised && stage === 'adult' ? deriveGeneticReport(c) : null;

    // ── 観察／鑑定の概要 ──
    const notableCount = traits.filter((t) => t.notable).length;
    const carrierCount = report?.summary.hiddenAlleles ?? 0;
    const overview = [
      { k: '素体', v: pheno.baseLabel },
      { k: '配色', v: pheno.palette.family ? `${pheno.palette.family}系` : '—' },
      { k: '世代', v: generationLabel(c.generation) },
      { k: 'seed', v: c.seed },
      { k: '見えている珍しい形質', v: stage === 'adult' ? `${notableCount} か所` : '？' },
      { k: '潜在形質', v: report ? `${carrierCount} か所` : '未鑑定' },
    ]
      .map(
        (o) =>
          `<div class="trait"><div class="trait__k">${esc(o.k)}</div><div class="trait__v">${esc(o.v)}</div></div>`,
      )
      .join('');

    // ── 性格 ──
    const persona = PERSONALITY_AXES.map((ax) => {
      const v = Math.round(Math.max(0, Math.min(1, pheno.personality[ax.key])) * 100);
      return (
        `<div class="persona__row">` +
        `<span class="persona__l">${esc(ax.lo)}</span>` +
        `<span class="persona__bar" role="meter" aria-label="${esc(ax.lo)}から${esc(ax.hi)}" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100">` +
        `<i class="persona__dot" style="left:${v}%"></i></span>` +
        `<span>${esc(ax.hi)}</span></div>`
      );
    }).join('');

    // ── 希少度 ──
    // 未鑑定では score / tier / reasons を一切出さない。
    const rarityHtml =
      report && rarity
        ? `<div class="row" style="margin-bottom:var(--sp-2)">` +
          `<span class="pill rar rar--${rarity.tier}">${icon('spark')} ${esc(RARITY_LABEL[rarity.tier])}</span>` +
          `<span class="pill">${report.exactRarity.score.toFixed(1)} / 100</span>` +
          `<span class="pill pill--brass">鑑定済み</span></div>` +
          (report.exactRarity.reasons.length > 0
            ? `<ul class="lines">${report.exactRarity.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
            : `<p class="section__note" style="margin:0">希少度を押し上げる特別な要因は記録されていません。</p>`)
        : stage === 'adult'
          ? `<div class="row" style="margin-bottom:var(--sp-2)"><span class="pill">${icon('spark')} ${esc(observed.label)}</span></div>` +
            `<p class="section__note" style="margin:0">${esc(observed.note)} 正確な点数と内訳は鑑定後に開示されます。</p>`
          : `<p class="section__note" style="margin:0">${esc(rarityMaskNote(stage))}</p>`;

    // ── 特徴一覧 ──
    // carrier は鑑定後だけ。発現している特徴そのものは今までどおり観察できる。
    const traitsHtml =
      traits.length > 0
        ? `<div class="traits">` +
          traits
            .map(
              (t) =>
                `<div class="trait${t.notable ? ' trait--notable' : ''}">` +
                `<div class="trait__k">${esc(t.label)}${t.notable ? ` ${icon('spark', { scale: 0.8, label: 'めずらしい特徴' })}` : ''}</div>` +
                `<div class="trait__v">${esc(t.value)}</div>` +
                (report && t.carrier ? `<div class="trait__c">かくれて持つ：${esc(t.carrier)}</div>` : '') +
                `</div>`,
            )
            .join('') +
          `</div>`
        : emptyState('egg', ['まだ 分かることが ありません。']);

    // ── 鑑定 ──
    const availability = canAppraise(app.state, c);
    const appraisalHtml = report
      ? `<div class="card card--tight">` +
        `<div class="row"><span class="pill pill--brass">${icon('helix')} 鑑定済み</span>` +
        `<span class="pill">CAT ${report.summary.categoricalLoci}</span>` +
        `<span class="pill">NUM ${report.summary.numericLoci}</span>` +
        `<span class="pill">HOMO ${report.summary.homozygous}</span>` +
        `<span class="pill">HET ${report.summary.heterozygous}</span></div>` +
        `<p class="section__note" style="margin:var(--sp-3) 0 var(--sp-2)">` +
        `鑑定によって遺伝子が変わったわけではありません。この子が最初から持っていた情報を読み取った記録です。</p>` +
        `<blockquote style="margin:var(--sp-3) 0 0;padding:var(--sp-3);border-left:3px solid var(--brass);background:var(--paper-2)">` +
        `<small style="display:block;margin-bottom:var(--sp-1);letter-spacing:.12em">${esc(report.flavor.kind)}</small>` +
        `${esc(report.flavor.text)}</blockquote>` +
        `</div>`
      : stage === 'adult'
        ? `<div class="card card--tight">` +
          `<p style="margin-top:0"><strong>外から見えない遺伝情報を調べます。</strong></p>` +
          `<p class="section__note">鑑定すると、全遺伝子座・ホモ/ヘテロ・潜在形質・正確な希少度と内訳が永久に開示されます。</p>` +
          `<div class="row"><span class="pill">鑑定料 ${APPRAISAL_COST} コイン</span>` +
          `<button type="button" class="btn" data-act="appraise"${availability.ok ? '' : ' disabled'}>鑑定に出す</button></div>` +
          (!availability.ok && availability.reason
            ? `<p class="section__note" style="margin:var(--sp-2) 0 0">${esc(availability.reason)}</p>`
            : '') +
          `</div>`
        : `<div class="card card--tight"><p class="section__note" style="margin:0">鑑定できるのは 成体になってからです。</p></div>`;

    const geneticReportHtml = report
      ? `<div class="card card--tight">` +
        `<details open><summary><strong>カテゴリ遺伝子 ${report.categorical.length} 座</strong> — 両アレルと発現状態</summary>` +
        `<div class="traits" style="margin-top:var(--sp-3)">` +
        report.categorical
          .map((g) =>
            `<div class="trait${g.hiddenAllele?.notable ? ' trait--notable' : ''}">` +
            `<div class="trait__k">${esc(g.label)} <span class="pill">${zygosityLabel(g.zygosity)}</span></div>` +
            `<div class="trait__v">${esc(g.alleles[0].label)} / ${esc(g.alleles[1].label)}</div>` +
            `<div class="trait__c">発現：${esc(g.expressedLabel)}` +
            (g.hiddenAllele ? ` ／ 非発現：${esc(g.hiddenAllele.label)}` : '') +
            (g.coExpressed ? ' ／ 共優性' : '') +
            `</div></div>`,
          )
          .join('') +
        `</div></details>` +
        `<details style="margin-top:var(--sp-3)"><summary><strong>数値遺伝子 ${report.numeric.length} 座</strong> — 2値と平均</summary>` +
        `<div class="traits" style="margin-top:var(--sp-3)">` +
        report.numeric
          .map((g) =>
            `<div class="trait"><div class="trait__k">${esc(g.label)}</div>` +
            `<div class="trait__v">${g.alleles[0].toFixed(3)} / ${g.alleles[1].toFixed(3)}</div>` +
            `<div class="trait__c">平均 ${g.mean.toFixed(3)}</div></div>`,
          )
          .join('') +
        `</div></details>` +
        `</div>`
      : '';

    // ── 親子比較 ──
    let compareHtml = '';
    if (c.parents) {
      const names = c.parentNames ?? ['親A', '親B'];

      const resolve = (pid: string, fallback: string): ParentView => {
        const here = findCreature(app.state, pid);
        if (here) return { name: here.name, creature: here, where: 'here' };
        const rec = findReleasedById(pid);
        if (rec) return { name: rec.name, creature: releasedAsCreature(rec), where: 'released' };
        return { name: fallback, creature: null, where: 'gone' };
      };

      const pa = resolve(c.parents[0], names[0]);
      const pb = resolve(c.parents[1], names[1]);

      const col = (role: string, v: ParentView): string => {
        const art = v.creature
          ? `<div class="compare__art">${thumbSvg(getPhenotype(v.creature, 'adult'), v.creature.life)}</div>`
          : `<div class="compare__art compare__art--gone" aria-hidden="true"><span>${icon('leaf')}</span></div>`;
        const tag =
          v.where === 'released'
            ? `<span class="compare__tag">森へ かえした子</span>`
            : v.where === 'gone'
              ? `<span class="compare__tag">記録が ありません</span>`
              : '';
        return (
          `<div class="compare__col">${art}` +
          `<div class="compare__lbl">${esc(role)}：${esc(v.name)}</div>${tag}</div>`
        );
      };

      const known = [pa, pb].filter((v) => v.creature !== null);
      let lines: string[] = [];
      // 鑑定前は「似ている」を観察するだけ。鑑定後だけ遺伝説明へ進む。
      if (appraised && known.length === 2 && stage === 'adult') {
        lines = inheritanceHighlights(
          pheno,
          getPhenotype(pa.creature!, 'adult'),
          getPhenotype(pb.creature!, 'adult'),
          6,
        );
      } else if (known.length > 0) {
        lines = traitCompareLines(
          pheno,
          stage,
          known.map((v) => ({ name: v.name, pheno: getPhenotype(v.creature!, 'adult') })),
          6,
        );
      }

      const notes = [pa, pb]
        .filter((v) => v.where !== 'here')
        .map((v) =>
          v.where === 'released'
            ? `${v.name} は 森へ かえした子。姿は 標本帳の 記録から よみがえらせています。`
            : `${v.name} は 記録が のこっていないので、姿を 出せません。`,
        );
      if (stage !== 'adult') notes.push('成体に なると、比べられる ところが もっと 増えます。');
      if (stage === 'adult' && !appraised) notes.push('鑑定すると、見た目の比較だけでは分からない遺伝情報まで調べられます。');
      const note =
        notes.length === 0
          ? ''
          : `<p class="section__note" style="margin:var(--sp-2) 0 0">${notes.map((n) => esc(n)).join(' ')}</p>`;

      compareHtml =
        `<div class="compare">` +
        col('親A', pa) +
        `<div class="compare__col"><div class="compare__art">${thumbSvg(pheno, c.life)}</div>` +
        `<div class="compare__lbl">この子：${esc(c.name)}</div></div>` +
        col('親B', pb) +
        `</div>` +
        (lines.length > 0
          ? `<ul class="lines" style="margin-top:var(--sp-3)">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
          : '') +
        note;
    }

    // ── 手放す候補の切り替え ──
    const used = capacityUsed(app.state);
    const full = used[stage] >= app.state.capacity[stage];
    const others = full ? creaturesByStage(app.state, stage).filter((o) => o.id !== c.id) : [];
    const switchHtml =
      others.length > 0
        ? `<div class="row" style="margin-bottom:var(--sp-3)">` +
          `<span class="pill">ほかの ${esc(STAGE_LABEL[stage])} を 見る</span>` +
          others
            .map(
              (o) =>
                `<a class="btn btn--ghost btn--sm" href="#/detail/${encodeURIComponent(o.id)}">${esc(o.name)}</a>`,
            )
            .join('') +
          `</div>`
        : '';

    const topRarity = appraised && rarity
      ? rarityPill(rarity, stage)
      : stage === 'adult'
        ? `<span class="pill">${icon('spark')} ${esc(observed.label)}</span>`
        : rarityPill(null, stage);

    setHtml(
      host,
      pageHeader(c.name, `${STAGE_LABEL[stage]}・${generationLabel(c.generation)}`, 'glass') +
        `<div class="row" style="margin-bottom:var(--sp-3)">${stagePill(stage)}${topRarity}` +
        (appraised ? `<span class="pill pill--brass">${icon('helix')} 鑑定済み</span>` : '') +
        (c.bestScore > 0 ? `<span class="pill pill--brass">${icon('medal')} 最高 ${Math.round(c.bestScore)} 点</span>` : '') +
        (c.exhibitionCount > 0 ? `<span class="pill">展示 ${c.exhibitionCount} 回</span>` : '') +
        `</div>` +
        `<div class="row" style="margin-bottom:var(--sp-3)">` +
        `<button type="button" class="btn btn--sm" data-act="care">育成室で 世話する</button>` +
        `<button type="button" class="btn btn--ghost btn--sm" data-act="rename">名前を 変える</button>` +
        `<span class="grow"></span>` +
        `<button type="button" class="btn btn--ghost btn--sm btn--release" data-act="release">この子を 手放す</button>` +
        `</div>` +
        switchHtml +
        `<div class="stage stage--detail" style="margin-bottom:var(--sp-4)"><div class="stage__art" data-art></div></div>` +
        (compareHtml ? section('親子の 比べっこ', compareHtml, undefined, 'pair') : '') +
        section('いまの ようす', `<div class="card card--tight">${gaugesFor(c)}</div>`, undefined, 'chart') +
        section(appraised ? '鑑定記録' : '鑑定', appraisalHtml, undefined, 'helix') +
        section('観察情報の 概要', `<div class="traits">${overview}</div>`, undefined, 'book') +
        section('性格', `<div class="card card--tight"><div class="persona">${persona}</div>` +
          `<p class="section__note" style="margin:var(--sp-2) 0 0">この子は「${esc(pheno.personality.label)}」。${esc(pheno.personality.subLabel)}。</p></div>`, undefined, 'mask') +
        section(appraised ? '正確な めずらしさ' : '見た目から分かる めずらしさ', `<div class="card card--tight">${rarityHtml}</div>`, undefined, 'spark') +
        section('見えている 特徴', traitsHtml, traitMaskNote(stage) || undefined, 'leaf') +
        (report ? section('全遺伝子レポート', geneticReportHtml, 'この情報は鑑定後だけ表示されます。', 'helix') : '') +
        `<div class="row row--end"><a class="btn btn--ghost" href="#/collection">標本帳へ</a>` +
        `<button type="button" class="btn" data-act="care">育成室で 世話する</button></div>`,
    );

    const artEl = $('[data-art]', host);
    stopMotion = mountCreature(artEl, pheno, c.life, {
      detail: 'full',
      title: `${c.name}（${STAGE_LABEL[stage]}）`,
      creature: c,
      reducedMotion: app.reducedMotion,
    });
  }

  async function doAppraise(c: Creature): Promise<void> {
    const availability = canAppraise(app.state, c);
    if (!availability.ok) {
      sfx.play('deny');
      toast(availability.reason ?? 'いまは 鑑定できません。', 'warn');
      return;
    }

    const ok = await confirmDialog(
      `${c.name} を 鑑定に出しますか？`,
      `<p><strong>${esc(c.name)}</strong> の遺伝情報を正式に調べます。</p>` +
        `<p>鑑定料は <strong>${APPRAISAL_COST} コイン</strong>です。</p>` +
        `<p>鑑定後は、全遺伝子座・ホモ/ヘテロ・潜在形質・正確な希少度と内訳が、この個体の記録として永久に開示されます。</p>`,
      '鑑定する',
    );
    if (!ok) return;

    const result = appraiseCreature(app.state, c.id);
    if (!result.ok) {
      sfx.play('deny');
      toast(result.reason ?? '鑑定できませんでした。', 'warn');
      return;
    }

    sfx.play('success');
    app.save('個体鑑定');
    toast(`${c.name} の 鑑定が完了しました。遺伝情報が開示されました。`, 'good', 4600);
    app.rerender();
    render();
  }

  async function doRename(c: Creature): Promise<void> {
    const picked = await openDialog({
      title: `${c.name} の 名前を 変える`,
      icon: 'patch',
      bodyHtml:
        `<label class="field"><span class="field__label">新しい名前</span>` +
        `<input class="input" data-rename type="text" value="${esc(c.name)}" maxlength="${CREATURE_NAME_MAX_LENGTH}" ` +
        `autocomplete="off" autocapitalize="none" autofocus aria-describedby="rename-help">` +
        `</label>` +
        `<p id="rename-help" class="section__note" style="margin:var(--sp-2) 0 0">` +
        `${CREATURE_NAME_MAX_LENGTH} 文字以内。同じ名前は 付けられません。</p>`,
      actions: [
        { label: 'やめる', value: 'cancel', kind: 'ghost', cancel: true },
        { label: '保存する', value: 'save', kind: 'primary' },
      ],
    });
    if (picked !== 'save') return;

    const dialog = document.querySelector<HTMLDialogElement>('.dlg');
    const input = dialog?.querySelector<HTMLInputElement>('[data-rename]');
    const result = renameCreature(app.state, c.id, input?.value ?? '');
    if (!result.ok) {
      sfx.play('deny');
      toast(result.reason ?? '名前を 変えられませんでした。', 'warn');
      return;
    }

    sfx.play('tap');
    app.save('名前変更');
    toast(`名前を「${result.name}」に 変えました。`, 'good');
    app.rerender();
    render();
  }

  async function doRelease(c: Creature): Promise<void> {
    const ok = await confirmDialog(
      `${c.name} を 手放しますか？`,
      `<p><strong>${esc(c.name)}</strong>（${esc(STAGE_LABEL[c.life.stage])}・${esc(generationLabel(c.generation))}）を ` +
        `そっと 森へ かえします。</p>` +
        `<p>枠が ひとつ 空くので、待っている 卵や 幼体が 育てるように なります。</p>` +
        `<p style="color:var(--bad);font-weight:700">この子は もう 戻ってきません。</p>` +
        `<p>ただし <strong>標本帳の「森へ かえした子」</strong>に、姿と 記録は のこります。</p>`,
      '森へ かえす',
      true,
    );
    if (!ok) return;

    const snapshot = { ...c };
    const r = releaseCreature(app.state, c.id);
    if (!r.ok) {
      sfx.play('deny');
      await openDialog({
        title: '手放せませんでした',
        icon: 'sprout',
        bodyHtml: `<p>${esc(r.reason ?? 'いまは 手放せません。')}</p>`,
      });
      return;
    }

    sfx.play('back');
    recordRelease(snapshot);
    app.save('手放し');
    toast(`${c.name} を 森へ かえしました。記録は 標本帳に のこります。`, 'info', 4600);
    app.go('/nursery');
  }

  const off = delegate(host, 'click', '[data-act]', (t) => {
    const act = t.dataset.act;
    if (act === 'care') {
      sfx.play('tap');
      app.state.activeCreatureId = id;
      app.markDirty();
      app.go('/nursery');
      return;
    }
    if (act === 'appraise') {
      const c = findCreature(app.state, id);
      if (!c) return;
      sfx.play('tap');
      void doAppraise(c);
      return;
    }
    if (act === 'release') {
      const c = findCreature(app.state, id);
      if (!c) return;
      sfx.play('tap');
      void doRelease(c);
      return;
    }
    if (act === 'rename') {
      const c = findCreature(app.state, id);
      if (!c) return;
      sfx.play('tap');
      void doRename(c);
    }
  });

  render();

  return {
    update: render,
    dispose() {
      off();
      stopMotion();
    },
  };
}
