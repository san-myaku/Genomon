/**
 * カードの裏面 —— 自然史標本 × 正式鑑定書 × 血統証明。
 *
 * 【表と裏の役割分担（§12・§13）】
 *   表は「見るカード」。裏は「読むカード」。
 *   表に出すのは姿から読める特徴と格だけで、
 *   **全遺伝子座・保因・接合状態・血統・交配記録・展示記録はこちら**。
 *
 * 【遺伝の欄だけはダミーにしない】
 *   親も展示成績も Lab の作りもの（cardHistory.ts）だが、遺伝情報は
 *   `deriveGeneticReportOf`（本編とまったく同じ計算）を通す。ここを
 *   仮の数字にすると、「この裏面で本当に次世代を設計できるか」という
 *   いちばん大事な判断ができなくなる。
 *
 * 【全 24 座をベタで並べない（§14）】
 *   カード裏に全座を出すと 4px の表になって誰も読まない。
 *   出すのは **要約（数）** と **特に重要な数座** まで。完全な報告は
 *   将来 QR から本編の詳細画面へ飛ばす。
 *   座の数は `CAT_LOCI` / `NUM_LOCI` の実データから取る（手書きしない）。
 *
 * 【同じカードに見えること（§12）】
 *   紙は表と同じ黒。その上に **書類そのものだけを羊皮紙の面**として置く。
 *   全面を明るくすると、表から裏返した瞬間に別のカードに見える。
 *   縁・ロゴ・認証印・格の記号が表と共通なので、めくっても同じ一枚に読める。
 */

import { deriveGeneticReportOf, type CategoricalGeneReport } from '../game/grading.ts';
import { esc } from '../ui/dom.ts';
import { qrPlaceholderSvg } from './cardArt.ts';
import type { CardSpec } from './cardDesign.ts';
import { pipHtml, pipText } from './cardRarity.ts';
import { sealBlock, sealUid } from './cardSeal.ts';

/** 節の見出し + 中身。 */
function section(title: string, body: string, extraClass = ''): string {
  return (
    `<section class="gmc-b-sec ${extraClass}">` +
    `<h4>${esc(title)}</h4>${body}</section>`
  );
}

/** 「名前 → 値」の 1 行。 */
function row(key: string, value: string, extraClass = ''): string {
  return `<div class="gmc-b-row ${extraClass}"><b>${esc(key)}</b><span>${esc(value)}</span></div>`;
}

/**
 * 裏面に載せる「特に重要な座」を選ぶ。
 *
 * 育種家にとって価値がある順に並べる:
 *   1. 姿に出ているのに、実際には描かれていない座（suppressed）
 *      … 「持っているのに出ていない」はいちばん誤解しやすく、いちばん重要
 *   2. 共優性で両方が出ている座（coExpressed）
 *   3. 珍しい対立遺伝子を隠して持っている座（保因）
 *   4. 珍しい対立遺伝子が出ている座
 *   5. ふつうのヘテロ
 * 同点のときはカタログ順（＝ CAT_LOCI の並び）を保つので、
 * 同じ個体なら毎回まったく同じ並びになる。
 */
function pickNotableGenes(genes: readonly CategoricalGeneReport[], limit: number): CategoricalGeneReport[] {
  const weight = (g: CategoricalGeneReport): number => {
    if (g.suppressed) return 5;
    if (g.coExpressed) return 4;
    if (g.hiddenAllele?.notable) return 3;
    if (g.alleles.some((a) => a.notable)) return 2;
    if (g.zygosity === 'heterozygous') return 1;
    return 0;
  };
  return genes
    .map((g, i) => ({ g, i, w: weight(g) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.g);
}

/** 接合状態の表記。共優性は「両方出ている」ことが分かる書きかたにする。 */
function zygosityText(g: CategoricalGeneReport): string {
  if (g.coExpressed) return 'CO-EXP';
  return g.zygosity === 'homozygous' ? 'HOMO' : 'HET';
}

export function cardBackHtml(spec: CardSpec): string {
  const f = spec.facts;
  const h = spec.history;
  const rank = spec.rank;
  const report = deriveGeneticReportOf(spec.genotype, f.seed);
  const s = report.summary;

  const suppressed = report.categorical.filter((g) => g.suppressed).length;
  const coExpressed = report.categorical.filter((g) => g.coExpressed).length;
  const notableGenes = pickNotableGenes(report.categorical, 6);

  const sealMaterial = spec.sealStyle === 'auto' ? rank.def.seal : spec.sealStyle;

  // ── RARITY ──
  //   カード裏は鑑定済みの記録なので、正確な点数と理由を出してよい
  //   （AGENTS.md §2.8 の「鑑定前に出さない」はここには掛からない）。
  const reasons = f.rarityReasons.slice(0, 2);

  const identification = section(
    'IDENTIFICATION',
    row('NAME', `${f.name}　${f.code}`) +
      row('REGISTRATION', f.certId) +
      row('LINEAGE', `HOUSE OF ${f.lineage}`) +
      row('GENERATION', `${h.generationRoman}　·　CERTIFIED ${h.certifiedOn}`),
  );

  const rarity = section(
    'RARITY',
    `<div class="gmc-b-rank">` +
      `<b>${esc(rank.def.label)}</b>` +
      `<span class="gmc-b-rank-score">${rank.score.toFixed(1)}</span>` +
      `<span class="gmc-b-rank-pips">${pipText(rank.def)}</span>` +
      `</div>` +
      (reasons.length
        ? `<ul class="gmc-b-reasons">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
        : ''),
  );

  const genetics = section(
    'GENETIC SUMMARY',
    `<div class="gmc-b-stats">` +
      // 座の数はカタログの実データ。固定値を手書きしない（§14）。
      `<div><b>LOCI</b><span>${s.categoricalLoci}<i>cat</i>${s.numericLoci}<i>num</i></span></div>` +
      `<div><b>HOMO</b><span>${s.homozygous}</span></div>` +
      `<div><b>HET</b><span>${s.heterozygous}</span></div>` +
      `<div><b>CARRIER</b><span>${s.hiddenAlleles}</span></div>` +
      `<div><b>NOTABLE</b><span>${s.notableAlleles}</span></div>` +
      `<div><b>SUPPRESSED</b><span>${suppressed}</span></div>` +
      `<div><b>CO-EXPRESSED</b><span>${coExpressed}</span></div>` +
      `</div>`,
  );

  const genes = section(
    'NOTABLE GENES',
    notableGenes.length
      ? `<table class="gmc-b-genes"><tbody>` +
        notableGenes
          .map(
            (g) =>
              `<tr>` +
              `<th>${esc(g.label)}</th>` +
              `<td>${esc(g.alleles[0].label)} / ${esc(g.alleles[1].label)}</td>` +
              `<td class="z">${esc(zygosityText(g))}</td>` +
              `<td class="e">${esc(g.suppressed ? g.suppressed.label : g.expressedLabel)}</td>` +
              `</tr>`,
          )
          .join('') +
        `</tbody></table>`
      : `<p class="gmc-b-none">ALL LOCI HOMOZYGOUS · NO HIDDEN ALLELE</p>`,
  );

  const pedigree = section(
    'PEDIGREE',
    h.parents
      .map(
        (p) =>
          `<div class="gmc-b-row"><b>${p.role === 'sire' ? 'SIRE' : 'DAM'}</b>` +
          `<span>${esc(p.name)}　${esc(p.code)}<i>${esc(p.regId)}</i></span></div>`,
      )
      .join(''),
  );

  const breeding = section(
    'BREEDING RECORD',
    row('MATINGS', String(h.matings)) +
      row('OFFSPRING', String(h.offspring)) +
      (h.proven ? row('PROVEN', h.proven === 'sire' ? 'PROVEN SIRE' : 'PROVEN DAM', 'on') : '') +
      (h.notableDescendants.length
        ? row(
            'NOTABLE',
            h.notableDescendants.map((d) => `${d.code}（${d.note}）`).join(' / '),
          )
        : ''),
    'gmc-b-sec--half',
  );

  const show = section(
    'SHOW RECORD',
    // 【1 行に詰め込まない — 実測で大会名が切れた】
    //   点数・大会名・年・順位を 1 行にすると、半分の幅では
    //   「60.9 VERDANT S…」で切れる。行を分けたほうが読める。
    h.bestShow
      ? row('BEST', `${h.bestShow.score.toFixed(1)}　${h.bestShow.place}`) +
        row('EVENT', `${h.bestShow.event} ${h.bestShow.year}`) +
        row('EXHIBITED', `${h.shows.length}`) +
        (h.titles.length ? row('TITLES', h.titles.join(' / '), 'on') : '')
      : `<p class="gmc-b-none">NO RECORD ON FILE</p>`,
    'gmc-b-sec--half',
  );

  return (
    `<div class="gmc gmc--back gmc-back--${spec.design}">` +
    `<div class="gmc-paper"></div>` +
    `<div class="gmc-v-edge" aria-hidden="true"></div>` +
    `<div class="gmc-body gmc-b-body">` +
    `<header class="gmc-b-head">` +
    `<div class="gmc-b-office"><b class="gmc-wordmark">GENOMON</b><span>APPRAISAL OFFICE</span></div>` +
    `<div class="gmc-v-pips" role="img" aria-label="希少度 ${esc(rank.def.label)}">${pipHtml(rank.def)}</div>` +
    `</header>` +
    `<div class="gmc-b-title">CERTIFICATE OF APPRAISAL</div>` +
    // 書類そのものは羊皮紙の面。カードの縁は表と同じ黒のまま残す。
    `<div class="gmc-b-doc">` +
    identification +
    rarity +
    genetics +
    genes +
    pedigree +
    `<div class="gmc-b-cols">${breeding}${show}</div>` +
    `</div>` +
    `<footer class="gmc-b-foot">` +
    `<div class="gmc-b-qr">${qrPlaceholderSvg(f.qrPayload, '#241d16', '#e8dfc8')}</div>` +
    // 【実 URL はまだ繋がない（§14・§26）】
    //   「完全な遺伝子レポートはここから」という場所だけ押さえておく。
    //   押せる見た目にすると押せると誤解されるので、リンクにはしない。
    `<div class="gmc-b-fulltext"><b>FULL GENETIC REPORT</b>` +
    `<span>${esc(f.qrPayload)}</span>` +
    `<i>${s.categoricalLoci + s.numericLoci} LOCI · ARCHIVED</i></div>` +
    sealBlock({
      material: sealMaterial,
      certId: f.certId,
      certifiedOn: h.certifiedOn,
      uid: sealUid(f.seed, 'back'),
      security: rank.def.security,
      className: 'gmc-b-seal',
    }) +
    `</footer>` +
    `</div>` +
    `</div>`
  );
}
