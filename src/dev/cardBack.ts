/**
 * カードの裏面 —— 自然史標本 × 正式鑑定書 × 血統証明。
 *
 * 【表と裏の役割分担】
 *   表は「見るカード」。裏は「読むカード」。
 *   表に出すのは姿から読める特徴と格だけで、
 *   **全遺伝子座・保因・接合状態・血統・交配記録・展示記録はこちら**。
 *
 * 【遺伝の欄だけはダミーにしない】
 *   親も展示成績も Lab の作りもの（cardHistory.ts）だが、遺伝情報は
 *   `deriveGeneticReportOf`（本編とまったく同じ計算）を通す。ここを
 *   仮の数字にすると、「この裏面で本当に次世代を設計できるか」という
 *   いちばん大事な判断ができなくなる。図表も同じで、**すべて実データ**。
 *
 * 【全座をベタで並べない】
 *   カード裏に全部の座を出すと 4px の表になって誰も読まない。
 *   出すのは **要約（数と図）** と **特に重要な数座** まで。完全な報告は
 *   将来 QR から本編の詳細画面へ飛ばす。
 *   座の数は `CAT_LOCI` / `NUM_LOCI` の実データから取る（手書きしない）。
 *
 * ─────────────────────────────────────────────────────────
 * 【同じカードに見えること — ここを一度やり直した】
 *   初版は「黒い紙の上に明るい羊皮紙の書類」で組んだ。コントラストが強すぎて
 *   **別の紙を貼り付けたように見え**、めくった瞬間に別のカードになっていた。
 *   いまは書類そのものもカードと同じ暗い世界の素材で作り、
 *   明るい象牙色は **文字と細い罫だけ** に使う。
 *
 * 【図表はダッシュボードにしない】
 *   目指すのは museum label / 標本カード / 証券。
 *   線は細く、色数は抑え、面で塗らない。棒グラフも「バー」ではなく
 *   **目盛りの上の帯**として置く。色だけで意味を伝えず、必ず数字を添える。
 * ─────────────────────────────────────────────────────────
 */

import type { Phenotype } from '../core/types.ts';
import { deriveGeneticReportOf, type CategoricalGeneReport } from '../game/grading.ts';
import { esc } from '../ui/dom.ts';
import { qrPlaceholderSvg } from './cardArt.ts';
import type { CardSpec } from './cardDesign.ts';
import { pipHtml, scorePercentile, topPercentText } from './cardRarity.ts';
import { sealBlock, sealStamp, sealUid } from './cardSeal.ts';

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

const pct = (v: number): string => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(2)}%`;

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

// ─────────────────────────────────────────────────────────
//  図表
// ─────────────────────────────────────────────────────────

/**
 * 遺伝子構成の積み上げ帯。
 *
 * 【色だけで意味を伝えない】
 *   HOMO と HET を色分けするが、**必ずラベルと数を添える**。
 *   色覚や小さな画面では帯の差が読めないことがある。
 *   帯は「ぱっと見の比率」だけを担い、正確な情報は数字が持つ。
 */
function compositionBar(homo: number, het: number, carrier: number, notable: number, total: number): string {
  const h = total > 0 ? homo / total : 0;
  const t = total > 0 ? het / total : 0;
  return (
    `<div class="gmc-g-bar" role="img" ` +
    `aria-label="ホモ ${homo} ヘテロ ${het}（全 ${total} 座）">` +
    `<i class="gmc-g-homo" style="width:${pct(h)}"></i>` +
    `<i class="gmc-g-het" style="width:${pct(t)}"></i>` +
    `</div>` +
    `<div class="gmc-g-legend">` +
    `<span class="gmc-g-k-homo"><b>HOMO</b>${homo}</span>` +
    `<span class="gmc-g-k-het"><b>HET</b>${het}</span>` +
    `<span><b>CARRIER</b>${carrier}</span>` +
    `<span><b>NOTABLE</b>${notable}</span>` +
    `</div>`
  );
}

/**
 * 分布の中での位置。
 *
 * 実測した累積分布（`scorePercentile`）から出す。目分量の目盛りではない。
 * 目盛りは中央値と上位 10% / 1% に置いてあるので、
 * 「真ん中より右」「上位 10% の線を越えた」が一目で分かる。
 */
function rarityGauge(score: number): string {
  const p = scorePercentile(score);
  return (
    // 【値と目盛りを同じ行に混ぜない — 実際に読み違えた】
    //   初版は「MEDIAN / TOP 0.1% / TOP 1%」を 1 行に並べていたので、
    //   **真ん中の目盛りが 0.1% だと読めてしまった**（実際は個体の値）。
    //   この個体の値は上の行へ独立させ、下の行は目盛りの名前だけにする。
    `<div class="gmc-g-gaugewrap" role="img" ` +
    `aria-label="希少度は分布の ${topPercentText(score)}">` +
    `<div class="gmc-g-gauge-top"><span>POSITION</span><b>${esc(topPercentText(score))}</b></div>` +
    `<div class="gmc-g-gauge">` +
    `<i class="gmc-g-track"></i>` +
    // 目盛り（中央値 / 上位 10% / 上位 1%）。位置も実測 CDF から引く。
    `<i class="gmc-g-tick" style="left:50%"></i>` +
    `<i class="gmc-g-tick" style="left:90%"></i>` +
    `<i class="gmc-g-tick" style="left:99%"></i>` +
    `<i class="gmc-g-pin" style="left:${pct(p)}"></i>` +
    `</div>` +
    `<div class="gmc-g-scale"><i style="left:50%">MEDIAN</i><i style="left:99%">TOP 1%</i></div>` +
    `</div>`
  );
}

/**
 * 数値形質の横棒。
 *
 * 【全 24 座は出さない】
 *   カードとして意味のある 6 つだけ。どれも **実際の Phenotype の値**で、
 *   架空の固定値は 1 つも無い。`size` だけ 0..1 ではなく 0.8..1.25 の
 *   実寸倍率なので、その範囲で正規化してから帯にする。
 *
 * 【左右差ではなく「揃い」を出す】
 *   希少度がそちらを評価するようになった（D-043）ので、
 *   カードの表記も揃っている側を上に取る。
 */
function numericProfile(p: Phenotype): string {
  const rows: { key: string; v: number; text: string }[] = [
    { key: 'SIZE', v: (p.size - 0.8) / (1.25 - 0.8), text: `${p.size.toFixed(2)}×` },
    { key: 'SYMMETRY', v: 1 - p.asymmetry, text: (1 - p.asymmetry).toFixed(2) },
    { key: 'LUMINANCE', v: p.glow, text: p.glow.toFixed(2) },
    { key: 'TRANSLUCENCY', v: p.translucency, text: p.translucency.toFixed(2) },
    { key: 'PATTERN', v: p.patDensity, text: p.patDensity.toFixed(2) },
    { key: 'ORNAMENT', v: p.decorAmount, text: p.decorAmount.toFixed(2) },
  ];
  return (
    `<div class="gmc-g-traits">` +
    rows
      .map(
        (r) =>
          `<div class="gmc-g-trait">` +
          `<b>${esc(r.key)}</b>` +
          `<i class="gmc-g-tbar"><span style="width:${pct(r.v)}"></span></i>` +
          `<em>${esc(r.text)}</em>` +
          `</div>`,
      )
      .join('') +
    `</div>`
  );
}

/**
 * 血統の括弧。
 *
 * 大きな家系図は作らない。「2 体から 1 体が出た」という関係だけを
 * 線 1 本で示し、名前は普通の文字として置く（カード幅では図の中の
 * 文字が真っ先に潰れる）。
 */
function pedigreeTree(
  parents: CardSpec['history']['parents'],
  selfCode: string,
  selfName: string,
): string {
  const line = (p: (typeof parents)[number]): string =>
    `<div class="gmc-g-parent">` +
    `<b>${p.role === 'sire' ? 'SIRE' : 'DAM'}</b>` +
    `<span>${esc(p.name)}<i>${esc(p.code)}</i></span>` +
    `</div>`;
  return (
    `<div class="gmc-g-ped">` +
    `<div class="gmc-g-ped-parents">${line(parents[0])}${line(parents[1])}</div>` +
    `<svg class="gmc-g-ped-brace" viewBox="0 0 24 40" preserveAspectRatio="none" aria-hidden="true">` +
    `<path d="M1 8 H12 V20 H23" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
    `<path d="M1 32 H12 V20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
    `</svg>` +
    `<div class="gmc-g-ped-self"><b>${esc(selfCode)}</b><span>${esc(selfName)}</span></div>` +
    `</div>`
  );
}

// ─────────────────────────────────────────────────────────
//  裏面
// ─────────────────────────────────────────────────────────

export function cardBackHtml(spec: CardSpec): string {
  const f = spec.facts;
  const h = spec.history;
  const rank = spec.rank;
  // 表と同じレポートを使う（cardLab が 1 枚につき 1 回だけ計算している）。
  // spec.report が無い経路から呼ばれても壊れないよう、そのときだけ計算する。
  const report = spec.report ?? deriveGeneticReportOf(spec.genotype, f.seed);
  const s = report.summary;

  const suppressed = report.categorical.filter((g) => g.suppressed).length;
  const coExpressed = report.categorical.filter((g) => g.coExpressed).length;
  const notableGenes = pickNotableGenes(report.categorical, 5);

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
      `<span class="gmc-b-rank-pips">${pipHtml(rank.def)}</span>` +
      `</div>` +
      rarityGauge(rank.score) +
      (reasons.length
        ? `<ul class="gmc-b-reasons">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
        : ''),
  );

  const genetics = section(
    'GENETIC COMPOSITION',
    compositionBar(s.homozygous, s.heterozygous, s.hiddenAlleles, s.notableAlleles, s.categoricalLoci) +
      `<div class="gmc-b-substats">` +
      // 座の数はカタログの実データ。固定値を手書きしない。
      `<span><b>LOCI</b>${s.categoricalLoci} cat · ${s.numericLoci} num</span>` +
      `<span><b>SUPPRESSED</b>${suppressed}</span>` +
      `<span><b>CO-EXPRESSED</b>${coExpressed}</span>` +
      `</div>`,
  );

  const traits = section('TRAIT PROFILE', numericProfile(spec.pheno));

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

  const pedigree = section('PEDIGREE', pedigreeTree(h.parents, f.code, f.name));

  const breeding = section(
    'BREEDING RECORD',
    row('MATINGS', String(h.matings)) +
      row('OFFSPRING', String(h.offspring)) +
      (h.proven ? row('PROVEN', h.proven === 'sire' ? 'PROVEN SIRE' : 'PROVEN DAM', 'on') : ''),
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
        (h.titles.length ? row('TITLES', h.titles.join(' / '), 'on') : row('EXHIBITED', `${h.shows.length}`))
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
    // 書類も **カードと同じ暗い素材**。明るい面を貼ると別の紙に見える。
    `<div class="gmc-b-doc">` +
    identification +
    rarity +
    genetics +
    traits +
    genes +
    pedigree +
    `<div class="gmc-b-cols">${breeding}${show}</div>` +
    `</div>` +
    `<footer class="gmc-b-foot">` +
    `<div class="gmc-b-qr">${qrPlaceholderSvg(f.qrPayload, '#0d1214', '#9fb0ad')}</div>` +
    // 【実 URL はまだ繋がない】
    //   「完全な遺伝子レポートはここから」という場所だけ押さえておく。
    //   押せる見た目にすると押せると誤解されるので、リンクにはしない。
    `<div class="gmc-b-fulltext"><b>FULL GENETIC REPORT</b>` +
    `<span>${esc(f.qrPayload)}</span>` +
    `<i>${s.categoricalLoci + s.numericLoci} LOCI · ARCHIVED</i></div>` +
    // 【裏の印は「正式な証明書の印」（§17）】
    //   表は人があとから押した実物感、裏は公的証明書の正式 seal。
    //   角度と押しムラは表より控えめにする（stamp を渡さない＝版面どおり）。
    sealBlock({
      material: sealMaterial,
      certId: f.certId,
      certifiedOn: h.certifiedOn,
      uid: sealUid(f.seed, 'back'),
      security: rank.def.security,
      ink: { seed: sealStamp(f.seed, sealMaterial).inkSeed, fade: 0.18 },
      className: 'gmc-b-seal',
    }) +
    `</footer>` +
    `</div>` +
    `</div>`
  );
}
