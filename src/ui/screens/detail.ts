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
import type { CategoricalGeneReport } from '../gameApi.ts';
import { icon } from '../icons.ts';
import { inheritanceHighlights } from '../../genetics/similarity.ts';
import { sfx } from '../../audio/index.ts';
import type { App, Screen } from '../app.ts';
import { pageHeader, section } from '../app.ts';
import { $, confetti, delegate, esc, setHtml } from '../dom.ts';
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
  deriveFlavorText,
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
 *
 * genetics の explainInheritance を使えないのは 2 つの場合:
 *   1. 親が 1 体しか たどれない
 *      … あちらは **両親そろっている前提**の文（「両親そろって同じ」）を作るので、
 *        片親に流用すると嘘になる。
 *   2. この子が まだ 成体でない
 *      … あちらは Phenotype.parts を直接読む。卵・幼体の Phenotype は
 *        器官の値を **成体基準のまま持っている**（孵化後にそのまま使うため）ので、
 *        そのまま文にすると「成体になると羽が生える」が先に分かってしまう。
 *        ここは必ず visibleTraits(child, stage) を通し、伏せるべきものは比較しない。
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

/**
 * レポートの並び順。
 *
 * 【なぜ並べ替えるのか】
 *   26 座を カタログ順に そのまま出すと、`結晶 HOMO なし/なし` のような
 *   「何も起きていない行」と、`耳先色 HET なし/みみさき色` のような
 *   **次の世代に効く行** が同じ重さで並ぶ。260 行ぶん目で探すのは
 *   レポートではなく資料。読む順を、育種に効く順にする。
 */
function rowRank(g: CategoricalGeneReport): number {
  if (g.hiddenAllele?.notable) return 0; // 珍しい形質を隠して持っている＝いちばん価値がある
  if (g.suppressed) return 1;            // 持っているのに姿に出ていない
  if (g.coExpressed) return 2;           // 両方が混ざって出ている
  if (g.hiddenAllele) return 3;          // ふつうの保因
  return 4;                              // ホモ接合＝この座はもう固定されている
}

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
    // 【フレーバーは鑑定と関係なく出す】
    //   これは遺伝情報ではなく、その個体の外側に世界が続いていることを見せる
    //   観察記録。鑑定の報酬にしてしまうと、いちばん character の出る一文が
    //   「お金を払うまで読めないもの」になり、育てている間の画面が乾いてしまう。
    //   成体だけに限るのは、文が成体の姿（毛・発光・大きさ）を前提にしているため。
    const flavor = stage === 'adult' ? deriveFlavorText(pheno) : null;

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
        `<span class="pill">遺伝子座 ${report.summary.categoricalLoci + report.summary.numericLoci}</span>` +
        `<span class="pill">かくれて持つ形質 ${report.summary.hiddenAlleles}</span></div>` +
        `<p class="section__note" style="margin:var(--sp-3) 0 0">` +
        `鑑定によって遺伝子が変わったわけではありません。この子が最初から持っていた情報を読み取った記録です。</p>` +
        `</div>`
      : stage === 'adult'
        ? `<div class="card card--tight">` +
          `<p style="margin-top:0"><strong>この子が かくれて持っている ものを 調べます。</strong></p>` +
          `<p class="section__note">見た目に出ている形質は、この子が持つ遺伝子の半分でしかありません。` +
          `鑑定すると、もう半分（かくれて持つ形質）・ホモ/ヘテロ・正確な希少度と内訳が、永久に開示されます。</p>` +
          `<p class="section__note">交配の 遺伝予測も、両親を 鑑定して はじめて 出せます。</p>` +
          `<div class="row"><span class="pill">鑑定料 ${APPRAISAL_COST} コイン</span>` +
          `<button type="button" class="btn btn--brass" data-act="appraise"${availability.ok ? '' : ' disabled'}>` +
          `${icon('helix')} 鑑定に出す</button></div>` +
          (!availability.ok && availability.reason
            ? `<p class="section__note" style="margin:var(--sp-2) 0 0">${esc(availability.reason)}</p>`
            : '') +
          `</div>`
        : `<div class="card card--tight"><p class="section__note" style="margin:0">鑑定できるのは 成体になってからです。</p></div>`;

    const flavorHtml = flavor
      ? `<div class="card card--tight">` +
        `<blockquote style="margin:0;padding:var(--sp-3);border-left:3px solid var(--brass);background:var(--paper-2)">` +
        `<small style="display:block;margin-bottom:var(--sp-1);letter-spacing:.12em;color:var(--mid)">${esc(flavor.kind)}</small>` +
        `${esc(flavor.text)}</blockquote></div>`
      : '';

    // ── 全遺伝子レポート ───────────────────────────────
    //
    // 【読む順を、育種に効く順にする】
    //   26 + 24 座をカタログ順に並べると、`結晶 HOMO なし/なし` のような
    //   何も起きていない行と、`耳先色 HET なし/みみさき色` のような
    //   次の世代に効く行が同じ重さで並ぶ。まず「見どころ」を数行にまとめ、
    //   そのあと全座を注目順で出す。数値座は既定で畳む（読む頻度が低い）。
    const notableHidden = report ? report.categorical.filter((g) => g.hiddenAllele?.notable) : [];
    const suppressedRows = report ? report.categorical.filter((g) => g.suppressed) : [];

    const highlights: string[] = [];
    if (notableHidden.length > 0) {
      highlights.push(
        `<strong>めずらしい形質を ${notableHidden.length} つ かくれて持っています。</strong>` +
          notableHidden.map((g) => `${esc(g.label)}の「${esc(g.hiddenAllele!.label)}」`).join('、') +
          '。いまは姿に出ていませんが、交配で子に出ることがあります。',
      );
    }
    for (const g of suppressedRows) {
      highlights.push(
        `${esc(g.label)}は「${esc(g.expressedLabel)}」が出ているはずですが、` +
          `姿は「${esc(g.suppressed!.label)}」です。${esc(g.suppressed!.note)}`,
      );
    }
    if (report && report.summary.heterozygous === 0) {
      highlights.push('すべての座がホモ接合です。この子の形質は、そのまま子へ伝わりやすい系統です。');
    }

    const geneticReportHtml = report
      ? `<div class="card card--tight">` +
        `<p class="section__note" style="margin:0 0 var(--sp-3)">` +
        `<strong>HOMO</strong>＝同じ形質を 2 つ持っている（子にも必ず渡す）。` +
        `<strong>HET</strong>＝ちがう形質を 1 つずつ持っていて、片方だけが姿に出ている。` +
        `出ていない方が「かくれて持つ形質」で、交配で子に出ることがあります。</p>` +
        (highlights.length > 0
          ? `<ul class="lines" style="margin:0 0 var(--sp-3)">${highlights.map((h) => `<li>${h}</li>`).join('')}</ul>`
          : `<p class="section__note" style="margin:0 0 var(--sp-3)">かくれて持つ めずらしい形質は ありませんでした。</p>`) +
        `<details open><summary><strong>すべての形質 ${report.categorical.length} 座</strong>` +
        `（HOMO ${report.summary.homozygous} ／ HET ${report.summary.heterozygous}）</summary>` +
        `<div class="traits" style="margin-top:var(--sp-3)">` +
        [...report.categorical]
          .map((g, i) => ({ g, i }))
          .sort((a, b) => rowRank(a.g) - rowRank(b.g) || a.i - b.i)
          .map(({ g }) =>
            `<div class="trait${g.hiddenAllele?.notable ? ' trait--notable' : ''}">` +
            `<div class="trait__k">${esc(g.label)} <span class="pill">${zygosityLabel(g.zygosity)}</span></div>` +
            `<div class="trait__v">${esc(g.alleles[0].label)} / ${esc(g.alleles[1].label)}</div>` +
            `<div class="trait__c">出ている：${esc(g.expressedLabel)}` +
            (g.hiddenAllele
              ? ` ／ かくれて持つ：${esc(g.hiddenAllele.label)}${g.hiddenAllele.notable ? '（めずらしい）' : ''}`
              : '') +
            (g.coExpressed ? ' ／ 両方が混ざって出ている' : '') +
            (g.suppressed ? `<br>姿には出ていません：${esc(g.suppressed.note)}` : '') +
            `</div></div>`,
          )
          .join('') +
        `</div></details>` +
        `<details style="margin-top:var(--sp-3)"><summary><strong>数で決まる形質 ${report.numeric.length} 座</strong>` +
        `（大きさ・色あい・性格など。2 つの値の平均が姿に出ます）</summary>` +
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
    //
    // 以前は「両親そろっているときだけ」比較を組んでいたので、
    // 親を 1 体 手放しただけで、本作でいちばん面白いところが丸ごと消えていた。
    // いまは 手もとの個体 → 森へかえした子の記録 の順にたどり、
    // 片方しか たどれなくても、たどれた側の列と比較文は必ず出す。
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

      // 比較文の作り分け。
      //   両親そろっていて この子も成体で **鑑定済み** … genetics の explainInheritance
      //   それ以外 … UI 側の突き合わせ（片親でも成立し、遺伝型も漏らさない）
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
      // 成体になる前は、伏せている器官のぶんだけ比べられることが少ない。
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
    //
    // 枠が満杯のとき、目標行は「手放す子を えらぶ」でこの画面へ飛ばしてくるが、
    // 飛び先はその段階の先頭 1 体で固定されていた。
    // 別の子にするには標本帳を経由するしかなかったので、ここに並べて置く。
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
        // 手放す操作はここにしか無いので、スクロールせずに届く位置に置く。
        // 枠が満杯で進行が止まったとき、目標行のボタンがこの画面へ直接飛ばしてくる。
        `<div class="row" style="margin-bottom:var(--sp-3)">` +
        `<button type="button" class="btn btn--sm" data-act="care">育成室で 世話する</button>` +
        `<button type="button" class="btn btn--ghost btn--sm" data-act="rename">名前を 変える</button>` +
        `<span class="grow"></span>` +
        `<button type="button" class="btn btn--ghost btn--sm btn--release" data-act="release">この子を 手放す</button>` +
        `</div>` +
        switchHtml +
        `<div class="stage stage--detail" style="margin-bottom:var(--sp-4)"><div class="stage__art" data-art></div></div>` +
        // 親子の比べっこは本作でいちばん面白いところなので、絵のすぐ下に置く。
        // （以前は全高 5000px 超のいちばん下にあり、ほぼ誰も辿り着けなかった）
        (compareHtml ? section('親子の 比べっこ', compareHtml, undefined, 'pair') : '') +
        section('いまの ようす', `<div class="card card--tight">${gaugesFor(c)}</div>`, undefined, 'chart') +
        (flavorHtml ? section('観察ノート', flavorHtml, undefined, 'book') : '') +
        section(appraised ? '鑑定記録' : '鑑定', appraisalHtml, undefined, 'helix') +
        section('観察情報の 概要', `<div class="traits">${overview}</div>`, undefined, 'chart') +
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
    app.rerender();
    render();

    // ── 開示の瞬間を作る ────────────────────────────────
    //
    // 【トーストだけでは足りない】
    //   鑑定は 160 コインを払う・一度きり・取り消せない操作で、この機能の中心。
    //   それがトースト 1 行で終わると、押した瞬間には何も起きず、
    //   下へスクロールして初めて表が増えていることに気づく。
    //   払ったものが何に化けたのかを、その場で 1 枚に見せる。
    const r = result.report;
    if (r) {
      const notable = r.categorical.filter((g) => g.hiddenAllele?.notable);
      const lines: string[] = [];
      lines.push(
        `<div class="row" style="margin-bottom:var(--sp-3)">` +
          `<span class="pill rar rar--${r.exactRarity.tier}">${esc(RARITY_LABEL[r.exactRarity.tier])}</span>` +
          `<span class="pill">めずらしさ ${r.exactRarity.score.toFixed(1)} / 100</span>` +
          `<span class="pill">かくれて持つ形質 ${r.summary.hiddenAlleles}</span></div>`,
      );
      lines.push(
        notable.length > 0
          ? `<p><strong>めずらしい形質を ${notable.length} つ、かくれて持っていました。</strong><br>` +
            notable.map((g) => `${esc(g.label)}の「${esc(g.hiddenAllele!.label)}」`).join('、') +
            `</p>`
          : `<p>かくれて持つ めずらしい形質は ありませんでした。姿に出ているものが、この子のすべてです。</p>`,
      );
      if (r.exactRarity.reasons.length > 0) {
        lines.push(`<ul class="lines">${r.exactRarity.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
      }
      lines.push(
        `<p class="section__note">この記録は永久に残ります。交配の相手も鑑定すれば、子に出る形質を予測できます。</p>`,
      );
      // 紙吹雪はランクの高い個体だけ（毎回だと「特別」が薄まる）。
      if (r.exactRarity.tier === 'rare' || r.exactRarity.tier === 'precious') confetti(2200);
      await openDialog({
        title: `${c.name} の 鑑定結果`,
        bodyHtml: lines.join(''),
        icon: 'helix',
        actions: [{ label: 'レポートを見る', value: 'ok', kind: 'primary', cancel: true }],
      });
    }
    toast(`${c.name} の 鑑定が完了しました。`, 'good', 3600);
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

  /**
   * この子を手放す。
   *
   * 枠（各段階 3 体）が満杯になると孵化・成体化が止まり、
   * 手放す以外に抜ける道が無い。その唯一の操作がここ。
   * 拒否の条件（残り 2 体以下では手放せない）は game 側が持っているので、
   * 判定は releaseCreature に任せ、返ってきた理由をそのまま見せる。
   */
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

    // 記録は「手放す前」に取る。releaseCreature を通ると state から消えてしまう。
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
    // 観察帳から消さない。姿（遺伝情報）ごと UI 側の記録に残す。
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
