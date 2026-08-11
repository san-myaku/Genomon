/**
 * 個体詳細。
 *
 * 【要件】
 *   - 遺伝情報の概要、性格、希少度と理由、特徴一覧。
 *   - 親がいる個体は親子比較（explainInheritance の日本語説明を使う）。
 *
 * 【ネタバレ防止（最重要）】
 *   rarity / traits は **成体基準** で計算されている。
 *   幼体・卵にそのまま出すと「成体で羽が生える」ことが先に分かってしまうので、
 *   特徴は genetics の visibleTraits(pheno, stage)、
 *   希少度は ui/traits.ts の visibleRarity(pheno, stage) を必ず通す。
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
import { capacityUsed, creaturesByStage, findCreature, getPhenotype, releaseCreature } from '../gameApi.ts';

/** 親を 1 体ぶん解決した結果。手もとに いる／記録に のこっている／たどれない の 3 通り。 */
interface ParentView {
  name: string;
  /** 姿を出せるなら個体（記録から組み直したものを含む）。 */
  creature: Creature | null;
  where: 'here' | 'released' | 'gone';
}

/**
 * 見える特徴どうしを突き合わせた比較文（UI 側で組み立てる版）。
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

    // ── 遺伝情報の概要 ──
    const notableCount = traits.filter((t) => t.notable).length;
    const carrierCount = traits.filter((t) => t.carrier).length;
    const overview = [
      { k: '素体', v: pheno.baseLabel },
      { k: '配色', v: pheno.palette.family ? `${pheno.palette.family}系` : '—' },
      { k: '世代', v: generationLabel(c.generation) },
      { k: 'seed', v: c.seed },
      { k: 'めずらしい形質', v: stage === 'adult' ? `${notableCount} か所` : '？' },
      { k: 'かくれて持つ形質', v: `${carrierCount} か所` },
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
    const rarityHtml = rarity
      ? `<div class="row" style="margin-bottom:var(--sp-2)">` +
        `<span class="pill rar rar--${rarity.tier}">${icon('spark')} ${esc(RARITY_LABEL[rarity.tier])}</span>` +
        `<span class="pill">${Math.round(rarity.score)} 点</span></div>` +
        (rarity.reasons.length > 0
          ? `<ul class="lines">${rarity.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
          : `<p class="section__note" style="margin:0">${esc(rarityMaskNote(stage))}</p>`)
      : `<p class="section__note" style="margin:0">${esc(rarityMaskNote(stage))}</p>`;

    // ── 特徴一覧 ──
    const traitsHtml =
      traits.length > 0
        ? `<div class="traits">` +
          traits
            .map(
              (t) =>
                `<div class="trait${t.notable ? ' trait--notable' : ''}">` +
                `<div class="trait__k">${esc(t.label)}${t.notable ? ` ${icon('spark', { scale: 0.8, label: 'めずらしい特徴' })}` : ''}</div>` +
                `<div class="trait__v">${esc(t.value)}</div>` +
                (t.carrier ? `<div class="trait__c">かくれて持つ：${esc(t.carrier)}</div>` : '') +
                `</div>`,
            )
            .join('') +
          `</div>`
        : emptyState('egg', ['まだ 分かることが ありません。']);

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
      //   両親そろっていて この子も成体 … genetics の explainInheritance（いちばん読み応えがある）
      //   それ以外                       … UI 側の突き合わせ（片親でも成立し、ネタバレもしない）
      const known = [pa, pb].filter((v) => v.creature !== null);
      let lines: string[] = [];
      if (known.length === 2 && stage === 'adult') {
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

    setHtml(
      host,
      pageHeader(c.name, `${STAGE_LABEL[stage]}・${generationLabel(c.generation)}`, 'glass') +
        `<div class="row" style="margin-bottom:var(--sp-3)">${stagePill(stage)}${rarityPill(rarity, stage)}` +
        (c.bestScore > 0 ? `<span class="pill pill--brass">${icon('medal')} 最高 ${Math.round(c.bestScore)} 点</span>` : '') +
        (c.exhibitionCount > 0 ? `<span class="pill">展示 ${c.exhibitionCount} 回</span>` : '') +
        `</div>` +
        // 手放す操作はここにしか無いので、スクロールせずに届く位置に置く。
        // 枠が満杯で進行が止まったとき、目標行のボタンがこの画面へ直接飛ばしてくる。
        `<div class="row" style="margin-bottom:var(--sp-3)">` +
        `<button type="button" class="btn btn--sm" data-act="care">育成室で 世話する</button>` +
        `<span class="grow"></span>` +
        `<button type="button" class="btn btn--ghost btn--sm btn--release" data-act="release">この子を 手放す</button>` +
        `</div>` +
        switchHtml +
        `<div class="stage stage--detail" style="margin-bottom:var(--sp-4)"><div class="stage__art" data-art></div></div>` +
        // 親子の比べっこは本作でいちばん面白いところなので、絵のすぐ下に置く。
        // （以前は全高 5000px 超のいちばん下にあり、ほぼ誰も辿り着けなかった）
        (compareHtml ? section('親子の 比べっこ', compareHtml, undefined, 'pair') : '') +
        section('いまの ようす', `<div class="card card--tight">${gaugesFor(c)}</div>`, undefined, 'chart') +
        section('遺伝情報の 概要', `<div class="traits">${overview}</div>`, undefined, 'helix') +
        section('性格', `<div class="card card--tight"><div class="persona">${persona}</div>` +
          `<p class="section__note" style="margin:var(--sp-2) 0 0">この子は「${esc(pheno.personality.label)}」。${esc(pheno.personality.subLabel)}。</p></div>`, undefined, 'mask') +
        section('めずらしさ', `<div class="card card--tight">${rarityHtml}</div>`, undefined, 'spark') +
        section('特徴', traitsHtml, traitMaskNote(stage) || undefined, 'leaf') +
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
    if (act === 'release') {
      const c = findCreature(app.state, id);
      if (!c) return;
      sfx.play('tap');
      void doRelease(c);
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
