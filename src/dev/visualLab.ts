/**
 * Visual Lab（指示書 §19）。
 *
 * 「絵として良いか」は人の目でしか判断できない。このツールの役目は、
 * 人が目で見るべき個体を **すばやく・狙って・大量に** 目の前へ出すことに尽きる。
 *
 * 【できること】
 *   1. 任意 seed の生成 / 同じ seed の再生成 / ランダム seed
 *   2. 100 体一覧、500 体以上の自動検査（render/inspect.ts の inspectModel）
 *   3. 素体別・配色ファミリー別の生成（潜性の pearl / mineral をホモ接合で強制できる）
 *   4. 卵 / 幼体 / 成体の切り替え
 *   5. Genotype / Phenotype / RenderModel のデータ表示
 *   6. 親 A・親 B から兄弟をまとめて生成（mutationScale・force 付き）
 *   7. 背景（明/暗）・サイズ（小/大）・描画境界とアンカーの表示・描画順の 1 枚ずつ確認
 *   8. 問題 seed のコピー / 保存（保存先は開発ツール専用キー）
 *   9. PNG 出力
 *  10. 個体にコメントを付けて保存し、開発サーバー経由で
 *      `docs/lab-feedback.json` へ書き出す（製品オーナーと Claude の
 *      共有メモ。開発サーバーが動いていれば保存のたびに自動で反映される）。
 */

import type { BodyBase, CatLocus, RenderDetail, RenderModel, Stage } from '../core/types.ts';
import { BODY_BASES } from '../core/types.ts';
import { PALETTE_FAMILIES } from '../core/color.ts';
import { makeWorldSeed, normalizeSeed } from '../core/rng.ts';
import { randomGenotype } from '../genetics/genotype.ts';
import { phenotypeOf } from '../genetics/phenotype.ts';
import { breedMany } from '../genetics/breeding.ts';
import { CAT_LOCI } from '../genetics/loci.ts';
import { buildRenderModel } from '../render/model.ts';
import { inspectModel } from '../render/inspect.ts';
import { makeUid } from '../render/svg.ts';
import { $, $$, delegate, esc, setHtml } from '../ui/dom.ts';
import {
  drawSpecimen,
  makeSpecimen,
  makeSpecimenNear,
  rebuildSpecimen,
  seedAt,
  triesFor,
  withForcedCat,
  type GenSpec,
  type Specimen,
} from './gen.ts';
import {
  addSeed,
  clearSeeds,
  loadPrefs,
  loadSeeds,
  mergeSeeds,
  putSeeds,
  removeSeed,
  savePrefs,
  setResolved,
  updateSeedNote,
  type SavedSeed,
} from './labStore.ts';
import { svgToPngDataUrl } from './png.ts';
import { copyText, downloadText, fetchFeedbackFromServer, pretty, runChunked, syncFeedbackToServer, triggerDownload } from './util.ts';

// ─────────────────────────────────────────────────────────
//  画面の状態
// ─────────────────────────────────────────────────────────

/** 一覧（グリッド）の「絞り込み」1 行ぶん（部位 → 種類）。sheet.html の pickrow と同じ発想。 */
interface GridFilterRow {
  locus: string;
  allele: string;
}

interface LabPrefs {
  seed: string;
  stage: Stage;
  base: BodyBase | '';
  palette: string;
  force: boolean;
  dark: boolean;
  big: boolean;
  debug: boolean;
  detail: RenderDetail;
  gridN: number;
  gridOnlyIssues: boolean;
  /** 一覧だけに効く絞り込み（最大 3 件）。base/palette の force とは独立。 */
  gridFilters: GridFilterRow[];
  inspectN: number;
  parentA: string;
  parentB: string;
  kids: number;
  mutationScale: number;
  forceLocus: string;
  forceAllele: string;
}

/** 一覧の絞り込みピックローの数（sheet.html の FILTER_ROWS と揃える）。 */
const GRID_FILTER_ROWS = 3;

const DEFAULTS: LabPrefs = {
  seed: 'GENOMON-LAB',
  stage: 'adult',
  base: '',
  palette: '',
  force: true,
  dark: false,
  big: true,
  debug: false,
  detail: 'full',
  gridN: 100,
  gridOnlyIssues: false,
  gridFilters: Array.from({ length: GRID_FILTER_ROWS }, () => ({ locus: '', allele: '' })),
  inspectN: 500,
  parentA: 'PARENT-A',
  parentB: 'PARENT-B',
  kids: 8,
  mutationScale: 1,
  forceLocus: '',
  forceAllele: '',
};

const STAGE_LABEL: Record<Stage, string> = { egg: '卵', juvenile: '幼体', adult: '成体' };
const BASE_LABEL: Record<BodyBase, string> = { maru: 'まる型', yurei: '幽霊型', slime: 'スライム型' };

export interface LabDeps {
  toast(msg: string, kind?: 'ok' | 'bad' | 'info'): void;
  /** 背景（明/暗）が変わったとき。html の data-theme を切り替えてもらう。 */
  setDark(dark: boolean): void;
}

export interface Mounted {
  dispose(): void;
}

// ─────────────────────────────────────────────────────────
//  本体
// ─────────────────────────────────────────────────────────

export function mountVisualLab(host: HTMLElement, deps: LabDeps): Mounted {
  const st = loadPrefs<LabPrefs>(DEFAULTS);
  deps.setDark(st.dark);

  /** いま単体表示している個体（PNG 出力・データ表示の対象）。 */
  let current: Specimen | null = null;
  /** 単体表示の SVG 文字列とピクセルサイズ（PNG 出力に使う）。 */
  let currentSvg = '';
  let currentPx = 420;
  /** 描画順スライダーの位置（null なら全部描く）。 */
  let partLimit: number | null = null;
  /** 自動検査の結果。 */
  let inspectRows: { seed: string; issues: string[] }[] = [];
  /** 一覧で実際に生成した個体。クリック後の拡大表示でも同じ Genotype を使う。 */
  let gridItems = new Map<string, Specimen>();
  /** 一覧カードから選択中なら、その個体を単体表示の再生成元にする。 */
  let selectedGridItem: Specimen | null = null;

  const spec = (): GenSpec => ({
    stage: st.stage,
    base: st.base === '' ? null : st.base,
    palette: st.palette === '' ? null : st.palette,
    force: st.force,
    detail: st.detail,
  });

  /**
   * 一覧（グリッド）専用の生成条件。`spec()` に「絞り込み」ピックローの
   * 内容を `extraForce` として足す（sheet.html の `?force=locus:allele,...`
   * と同じ発想）。単体表示・自動検査には影響させない（一覧だけのスコープ）。
   */
  const gridSpec = (): GenSpec => {
    const extraForce: Partial<Record<CatLocus, string>> = {};
    for (const row of st.gridFilters) {
      if (row.locus && row.allele) extraForce[row.locus as CatLocus] = row.allele;
    }
    return { ...spec(), extraForce };
  };

  const persist = (): void => savePrefs(st);

  host.innerHTML = shell(st.gridFilters);

  // ── 単体表示 ───────────────────────────────────────────

  function buildCurrent(): void {
    const selected = selectedGridItem?.seed === normalizeSeed(st.seed) ? selectedGridItem : null;
    const s = selected
      ? rebuildSpecimen(selected, st.stage, st.detail)
      : makeSpecimenNear(normalizeSeed(st.seed), spec(), triesFor(1, spec()));
    current = s;
    if (!s) {
      currentSvg = '';
      return;
    }
    currentPx = st.big ? 420 : 190;
    currentSvg = drawSpecimen(s.model, {
      background: null,
      debug: st.debug,
      partLimit,
      width: currentPx,
      height: currentPx,
    });
  }

  function renderSingle(): void {
    buildCurrent();
    const box = $('#lab-single', host);
    if (!box) return;

    if (!current) {
      setHtml(
        box,
        `<p class="warn">条件に合う個体が見つかりませんでした。` +
          `絞り込みモードで潜性の配色を狙うと出現率が 1% 前後になります。` +
          `「強制」に切り替えてください。</p>`,
      );
      return;
    }

    const s = current;
    const p = s.pheno;
    const m = s.model;
    setHtml(
      box,
      `<div class="stage lab-specimen-stage">` +
        `<div class="lab-specimen-visual">` +
        `<div class="figure${s.issues.length ? ' bad' : ''}" id="lab-fig">${currentSvg}</div>` +
        partOrderUi(m) +
        `</div>` +
        `<div class="meta lab-specimen-meta">` +
        `<dl class="kv">` +
        kv('seed', s.seed) +
        kv('段階', `${STAGE_LABEL[p.stage]}（${p.stage}）`) +
        kv('素体', `${p.baseLabel}（${p.base}）／輪郭 ${p.parts.silhouette}`) +
        kv('配色', `${p.palette.family}　hsl(${Math.round(p.palette.hsl.h)}, ${Math.round(p.palette.hsl.s)}%, ${Math.round(p.palette.hsl.l)}%)`) +
        kv('本体色', `${p.palette.body} / 陰 ${p.palette.bodyDark} / 光 ${p.palette.bodyLight}`) +
        kv('質感・模様', `${p.parts.texture} / ${p.parts.pattern}`) +
        kv('希少度', `${p.rarity.tier}（${p.rarity.score.toFixed(1)}）`) +
        kv('性格', `${p.personality.label}・${p.personality.subLabel}`) +
        kv('パーツ数', `${m.parts.length}（アンカー ${m.anchors.length}）`) +
        kv('viewBox', boxStr(m.viewBox)) +
        kv('bodyBox', boxStr(m.bodyBox)) +
        kv('faceBox', boxStr(m.faceBox)) +
        `</dl>` +
        (s.issues.length
          ? `<p class="warn">検査 NG: ${esc(s.issues.join(' / '))}</p>`
          : `<p class="good">検査 OK（inspectModel で問題なし）</p>`) +
        `<div class="row lab-comment-row">` +
        `<input type="text" id="lab-comment-input" placeholder="コメント（任意。保存時にこの内容を添える）" ` +
        `>` +
        `<button data-act="save-seed">💬 コメントを付けて保存</button>` +
        `</div>` +
        `<div class="row lab-action-row">` +
        `<button data-act="copy-seed">seed をコピー</button>` +
        `<button data-act="png">PNG 出力</button>` +
        `<button data-act="copy-json">JSON をコピー</button>` +
        `</div>` +
        dataDetails(s) +
        `</div>` +
        `</div>`,
    );
  }

  /** 描画順（z 昇順）を 1 枚ずつ重ねて確認する UI。 */
  function partOrderUi(m: RenderModel): string {
    const max = m.parts.length;
    const cur = partLimit == null ? max : partLimit;
    const rows = m.parts
      .map(
        (p, i) =>
          `<div class="${i < cur ? 'on' : 'off'}"><span class="z">${p.z}</span>` +
          `<span class="grow">${esc(p.id)}</span>` +
          `<span>${p.anchor ? '⚓' : ''}${p.bbox ? '▢' : ''}</span></div>`,
      )
      .join('');
    return (
      `<div class="lab-parts-control">` +
      `<div class="row"><label class="f lab-parts-label">描画順 ${cur} / ${max}</label>` +
      `<input type="range" id="lab-partlimit" min="0" max="${max}" value="${cur}" style="flex:1">` +
      `<button data-act="parts-all">全部</button></div>` +
      `<div class="parts">${rows}</div>` +
      `</div>`
    );
  }

  function dataDetails(s: Specimen): string {
    // RenderModel は SVG 文字列を含むと数十 KB になり画面が固まる。
    // 構造（座標・z・bbox・アンカー）だけを抜き出して見せる。
    const modelView = {
      seed: s.model.seed,
      stage: s.model.stage,
      base: s.model.base,
      detail: s.model.detail,
      uid: s.model.uid,
      viewBox: s.model.viewBox,
      bodyBox: s.model.bodyBox,
      faceBox: s.model.faceBox,
      motion: s.model.motion,
      anchors: s.model.anchors,
      defsBytes: s.model.defs.length,
      parts: s.model.parts.map((p) => ({
        id: p.id,
        z: p.z,
        anchor: p.anchor ?? null,
        bbox: p.bbox ?? null,
        svgBytes: p.svg.length,
      })),
    };
    return (
      det('Genotype', pretty(s.genotype)) +
      det('Phenotype', pretty(s.pheno)) +
      det('RenderModel（SVG 本文は byte 数のみ）', pretty(modelView))
    );
  }

  // ── 一覧 ───────────────────────────────────────────────

  function renderGrid(): void {
    const wrap = $('#lab-grid-wrap', host);
    if (!wrap) return;
    const n = Math.max(1, Math.min(400, Math.round(st.gridN)));
    const sp = gridSpec();
    const base = normalizeSeed(st.seed);
    const maxTries = triesFor(n, sp);

    const t0 = performance.now();
    const items: Specimen[] = [];
    for (let i = 0; items.length < n && i < maxTries; i++) {
      const s = makeSpecimen(seedAt(base, i), sp);
      if (s) items.push(s);
    }
    gridItems = new Map(items.map((item) => [item.seed, item]));
    const ms = Math.round(performance.now() - t0);

    const shown = st.gridOnlyIssues ? items.filter((i) => i.issues.length) : items;
    const cols = Math.max(1, Math.round(Math.sqrt(Math.max(1, shown.length))));
    const px = st.big ? 150 : 100;
    const bad = items.filter((i) => i.issues.length).length;

    const fam: Record<string, number> = {};
    const bases: Record<string, number> = {};
    for (const it of items) {
      fam[it.pheno.palette.family] = (fam[it.pheno.palette.family] ?? 0) + 1;
      bases[it.pheno.base] = (bases[it.pheno.base] ?? 0) + 1;
    }

    const activeFilters = st.gridFilters.filter((f) => f.locus && f.allele);
    setHtml(
      wrap,
        `<p class="tagline lab-grid-summary"><span>生成 ${items.length} / 要求 ${n}（${ms}ms）</span>` +
        `<span class="${bad ? 'warn' : 'good'}">問題個体 ${bad}</span>` +
        `<span>素体 ${esc(countStr(bases))}</span>` +
        `<span>配色 ${esc(countStr(fam))}</span>` +
        (activeFilters.length
          ? `<span>絞り込み: ${esc(activeFilters.map((f) => `${localeLocusLabel(f.locus)}=${alleleLabel(f.locus, f.allele)}`).join(' '))}</span>`
          : '') +
        `</p>` +
        `<div id="lab-grid" class="lab-grid lab-grid--gallery" style="--lab-grid-cols:${cols};--lab-grid-max:${cols * (px + 8) + 20}px">` +
        (shown.length
          ? shown
              .map((it) => {
                const svg = drawSpecimen(it.model, {
                  background: null,
                  debug: st.debug,
                  partLimit: null,
                  width: px,
                  height: px,
                });
                const label = `${it.pheno.base}/${it.pheno.palette.family}`;
                return (
                  `<button type="button" class="cell${it.issues.length ? ' bad' : ''}" data-pick="${esc(it.seed)}" ` +
                  `aria-pressed="${normalizeSeed(st.seed) === it.seed ? 'true' : 'false'}" ` +
                  `title="${esc(it.seed)}" aria-label="個体 ${esc(it.seed)}、${esc(label)} を拡大表示">` +
                  `<span class="cell__art" aria-hidden="true">${svg}</span>` +
                  `<span class="cell__lbl"><span class="cell__id">${esc(it.seed)}</span>` +
                  `<span class="cell__meta">${esc(label)}</span>` +
                  (it.issues.length ? `<span class="iss">${esc(it.issues.join(' '))}</span>` : '') +
                  `</span></button>`
                );
              })
              .join('')
          : `<div class="lab-empty"><strong>表示できる個体はありません</strong><span>検査条件を変えるか、「問題個体だけ表示」を外して再生成してください。</span></div>`) +
        `</div>`,
    );
  }

  /** 一覧の「絞り込み」ピックロー部分だけを、いまの `st.gridFilters` で描き直す。 */
  function renderGridFilters(): void {
    const box = $('#lab-grid-filters', host);
    if (!box) return;
    setHtml(box, gridFilterRowsHtml(st.gridFilters));
  }

  /** 一覧から選んだ個体を、一覧上でもキーボード利用者に示す。 */
  function markGridSelection(seed: string): void {
    for (const cell of $$<HTMLButtonElement>('#lab-grid .cell', host)) {
      cell.setAttribute('aria-pressed', cell.dataset.pick === seed ? 'true' : 'false');
    }
  }

  /** 選択後は結果カードへ移動し、PCでもスマホでも次の確認を迷わせない。 */
  function focusSpecimen(): void {
    $('#lab-single-card', host)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── 自動検査 ───────────────────────────────────────────

  async function runInspect(): Promise<void> {
    const btn = $<HTMLButtonElement>('#lab-inspect-run', host);
    const out = $('#lab-inspect-out', host);
    const barI = $('#lab-inspect-bar > i', host);
    if (!out) return;
    if (btn) btn.disabled = true;

    const n = Math.max(1, Math.min(5000, Math.round(st.inspectN)));
    const sp = spec();
    const base = normalizeSeed(st.seed);
    // 検査は描画しないので detail は lite で十分（500 体でも数秒で終わる）。
    const inspSpec: GenSpec = { ...sp, detail: 'lite' };
    const tries = triesFor(n, inspSpec);

    const byKind: Record<string, number> = {};
    const rows: { seed: string; issues: string[] }[] = [];
    let made = 0;
    const t0 = performance.now();

    await runChunked(
      tries,
      50,
      (i) => {
        if (made >= n) return;
        const seed = seedAt(base, i);
        const forceMap: Partial<Record<CatLocus, string>> = {};
        if (inspSpec.base) forceMap.base = inspSpec.base;
        if (inspSpec.palette) forceMap.palette = inspSpec.palette;
        const g = inspSpec.force ? withForcedCat(randomGenotype(seed), forceMap) : randomGenotype(seed);
        const pheno = phenotypeOf(g, inspSpec.stage);
        if (!inspSpec.force) {
          if (inspSpec.base && pheno.base !== inspSpec.base) return;
          if (inspSpec.palette && pheno.palette.family !== inspSpec.palette) return;
        }
        const model = buildRenderModel(pheno, null, {
          detail: 'lite',
          uid: makeUid(seed, `${inspSpec.stage}:lite:lab`),
          genotype: g,
        });
        const r = inspectModel(model);
        made++;
        if (!r.ok) {
          rows.push({ seed, issues: r.issues });
          for (const iss of r.issues) {
            const kind = iss.split(':')[0] ?? '?';
            byKind[kind] = (byKind[kind] ?? 0) + 1;
          }
        }
      },
      (done) => {
        if (barI) (barI as HTMLElement).style.width = `${Math.round((Math.min(made / n, done / tries) * 100))}%`;
      },
    );

    const ms = Math.round(performance.now() - t0);
    inspectRows = rows;
    if (btn) btn.disabled = false;
    if (barI) (barI as HTMLElement).style.width = '100%';

    const kinds = Object.entries(byKind).sort((a, b) => b[1] - a[1]);
    setHtml(
      out,
      `<p class="tagline"><span><strong>検査 ${made} 体</strong>（要求 ${n} / 試行 ${tries}）</span>` +
        `<span class="${rows.length ? 'warn' : 'good'}">問題個体 ${rows.length}（${((rows.length / Math.max(1, made)) * 100).toFixed(2)}%）</span>` +
        `<span>${ms}ms</span>` +
        `<span>stage=${esc(inspSpec.stage)} base=${esc(inspSpec.base ?? '-')} palette=${esc(inspSpec.palette ?? '-')} ${inspSpec.force ? '強制' : '絞り込み'}</span></p>` +
        (kinds.length
          ? `<p class="tagline">${kinds.map(([k, v]) => `<span>${esc(k)}: ${v}</span>`).join('')}</p>`
          : `<p class="good">すべての個体が inspectModel を通過しました。</p>`) +
        (rows.length
          ? `<div class="row"><button data-act="insp-copy">問題 seed を全部コピー</button>` +
            `<button data-act="insp-save">問題 seed を全部 保存</button>` +
            `<button data-act="insp-dl">JSON で書き出す</button></div>` +
            `<div class="scroll" style="margin-top:6px"><table class="t"><thead><tr>` +
            `<th>#</th><th>seed</th><th>issues</th><th></th></tr></thead><tbody>` +
            rows
              .map(
                (r, i) =>
                  `<tr><td>${i + 1}</td><td>${esc(r.seed)}</td><td>${esc(r.issues.join(' '))}</td>` +
                  `<td><button data-act="insp-pick" data-seed="${esc(r.seed)}">開く</button></td></tr>`,
              )
              .join('') +
            `</tbody></table></div>`
          : ''),
    );
  }

  // ── 兄弟比較 ───────────────────────────────────────────

  function renderSiblings(): void {
    const out = $('#lab-sib-out', host);
    if (!out) return;
    const a = randomGenotype(normalizeSeed(st.parentA));
    const b = randomGenotype(normalizeSeed(st.parentB));
    const n = Math.max(1, Math.min(48, Math.round(st.kids)));
    const forced: Partial<Record<CatLocus, string>> | undefined =
      st.forceLocus && st.forceAllele
        ? ({ [st.forceLocus]: st.forceAllele } as Partial<Record<CatLocus, string>>)
        : undefined;

    const kids = breedMany(a, b, `${normalizeSeed(st.parentA)}x${normalizeSeed(st.parentB)}`, n, {
      mutationScale: st.mutationScale,
      force: forced,
    });

    const px = st.big ? 150 : 110;
    const cell = (seed: string, g: ReturnType<typeof randomGenotype>, label: string): string => {
      const pheno = phenotypeOf(g, st.stage);
      const model = buildRenderModel(pheno, null, {
        detail: st.detail,
        uid: makeUid(seed, `${st.stage}:${st.detail}:sib`),
        genotype: g,
      });
      const issues = inspectModel(model).issues;
      const svg = drawSpecimen(model, { background: null, debug: st.debug, partLimit: null, width: px, height: px });
      return (
        `<button type="button" class="cell${issues.length ? ' bad' : ''}" data-pick="${esc(seed)}" ` +
        `title="${esc(seed)}" aria-label="${esc(label)}、${esc(pheno.base)}/${esc(pheno.palette.family)}">` +
        `<span class="cell__art" aria-hidden="true">${svg}</span>` +
        `<span class="cell__lbl"><span class="cell__id">${esc(label)}</span>` +
        `<span class="cell__meta">${esc(pheno.base)}/${esc(pheno.palette.family)}</span></span></button>`
      );
    };

    const cols = Math.min(8, Math.max(2, Math.ceil(Math.sqrt(n + 2))));
    setHtml(
      out,
      `<p class="tagline lab-grid-summary"><span>親A=${esc(st.parentA)}</span><span>親B=${esc(st.parentB)}</span>` +
        `<span>子 ${n} 体</span><span>mutationScale=${st.mutationScale}</span>` +
        `<span>force=${esc(forced ? `${st.forceLocus}:${st.forceAllele}` : 'なし')}</span></p>` +
        `<div id="lab-sib-grid" class="lab-grid lab-grid--siblings" style="--lab-grid-cols:${cols};--lab-grid-max:${cols * (px + 8) + 20}px">` +
        cell(a.seed, a, `親A ${a.seed}`) +
        cell(b.seed, b, `親B ${b.seed}`) +
        kids.map((k, i) => cell(k.seed, k, `子${i + 1}`)).join('') +
        `</div>`,
    );
  }

  // ── 保存した seed ──────────────────────────────────────

  /** ファイルへの同期状況（画面表示用）。まだ一度も試していなければ null。 */
  let lastSync: { ok: boolean; detail: string; at: number } | null = null;
  /** 「対応済み」セクションを開いているか（既定は畳んでおく）。 */
  let showResolved = false;

  function syncStatusHtml(): string {
    if (!lastSync) {
      return `<span class="hint">まだ同期していません。「🔄 同期する」で最新の状態にすり合わせます。</span>`;
    }
    const time = new Date(lastSync.at).toLocaleTimeString('ja-JP');
    return lastSync.ok
      ? `<span class="good">✓ ${time} に ${esc(lastSync.detail)}</span>`
      : `<span class="warn">⚠ ${time} 同期できませんでした（${esc(lastSync.detail)}）。開発サーバーが動いているか確認してください。localStorage 側は無事です。</span>`;
  }

  /**
   * ファイル（`docs/lab-feedback.json`）と localStorage をすり合わせる。
   *
   * 【なぜ「送るだけ」ではなく「取ってくる→混ぜる→送る」なのか】
   *   ブラウザ側の変更をファイルへ一方的に上書きすると、Claude が
   *   ファイルを直接編集して「対応済み」にした内容が、ユーザーが
   *   ブラウザで何か 1 つ変えただけで消えてしまう（製品オーナー指摘）。
   *   `mergeSeeds` はレコードごとに `updatedAt` の新しい方を採用するので、
   *   同期するたびに双方の変更が両方とも生き残る。
   *   結果として、Claude がファイルを直接編集するだけで「対応済み」を
   *   付けられ、ユーザーは次にこのボタンを押す（または保存・削除・
   *   コメント編集をする＝そのたびに自動でこの関数が呼ばれる）だけで
   *   最新の状態が画面に反映される。
   *
   * `announce` が true の手動同期のときだけ toast で成否を伝える
   * （保存・削除のたびに毎回 toast すると煩わしいため、自動同期は静かに行う）。
   */
  async function syncAndReport(announce = false): Promise<void> {
    const remote = await fetchFeedbackFromServer();
    const merged = mergeSeeds(loadSeeds(), remote as SavedSeed[]);
    putSeeds(merged);
    renderSaved();
    const res = await syncFeedbackToServer(merged);
    lastSync = { ...res, at: Date.now() };
    const statusEl = $('#lab-sync-status', host);
    if (statusEl) setHtml(statusEl, syncStatusHtml());
    if (announce) deps.toast(res.ok ? `同期しました（${merged.length} 件）` : `同期に失敗: ${res.detail}`, res.ok ? 'ok' : 'bad');
  }

  function noteCell(s: SavedSeed): string {
    return (
      `<td data-label="コメント"><input type="text" class="note-input" value="${esc(s.note)}" ` +
      `data-seed="${esc(s.seed)}" data-stage="${esc(s.stage)}" placeholder="コメントを書く…" ` +
      `style="width:100%;box-sizing:border-box"></td>`
    );
  }

  function pendingRow(s: SavedSeed): string {
    return (
      `<tr class="saved-row"><td data-label="seed">${esc(s.seed)}</td><td data-label="段階">${esc(s.stage)}</td><td data-label="issues">${esc(s.issues.join(' '))}</td>` +
      noteCell(s) +
      `<td data-label="操作" class="row lab-row-actions">` +
      `<button data-act="saved-pick" data-seed="${esc(s.seed)}" data-stage="${esc(s.stage)}">開く</button>` +
      `<button class="good" data-act="saved-resolve" data-seed="${esc(s.seed)}" data-stage="${esc(s.stage)}" title="対応済みにする（消さずに残す）">✓ 対応済み</button>` +
      `<button data-act="saved-del" data-seed="${esc(s.seed)}" data-stage="${esc(s.stage)}" title="一覧から完全に削除する">×</button></td></tr>`
    );
  }

  function resolvedRow(s: SavedSeed): string {
    const who = s.resolvedBy === 'claude' ? 'Claude' : s.resolvedBy === 'user' ? '自分' : '?';
    const when = s.resolvedAt ? new Date(s.resolvedAt).toLocaleString('ja-JP') : '';
    return (
      `<tr class="saved-row saved-row--resolved"><td data-label="seed">${esc(s.seed)}</td><td data-label="段階">${esc(s.stage)}</td>` +
      `<td data-label="状態" class="hint">${esc(who)} が対応済み<br>${esc(when)}</td>` +
      `<td data-label="コメント">${esc(s.note)}</td>` +
      `<td data-label="操作" class="row lab-row-actions">` +
      `<button data-act="saved-pick" data-seed="${esc(s.seed)}" data-stage="${esc(s.stage)}">開く</button>` +
      `<button data-act="saved-unresolve" data-seed="${esc(s.seed)}" data-stage="${esc(s.stage)}" title="未対応に戻す">↺ 戻す</button>` +
      `<button data-act="saved-del" data-seed="${esc(s.seed)}" data-stage="${esc(s.stage)}">×</button></td></tr>`
    );
  }

  function renderSaved(): void {
    const out = $('#lab-saved-out', host);
    if (!out) return;
    const list = loadSeeds();
    const pending = list.filter((s) => !s.resolved);
    const resolved = list.filter((s) => s.resolved);
    const syncBar =
      `<div class="row lab-saved-toolbar">` +
      `<button data-act="saved-sync">🔄 同期する（Claude とすり合わせ）</button>` +
      `<span id="lab-sync-status">${syncStatusHtml()}</span></div>`;
    if (!list.length) {
      setHtml(out, syncBar + `<p class="hint">まだ保存されていません（保存先キー: genomon.dev.seeds.v1）。</p>`);
      return;
    }
    const theadRow = `<th>seed</th><th>段階</th><th>issues</th><th>コメント</th><th></th></tr>`;
    setHtml(
      out,
      syncBar +
        `<div class="row"><button data-act="saved-copy">全部コピー</button>` +
        `<button data-act="saved-dl">JSON で書き出す（手動ダウンロード）</button>` +
        `<button class="danger" data-act="saved-clear">全部消す</button></div>` +
        `<p class="hint" style="margin:6px 0 2px">未対応（${pending.length} 件）</p>` +
        (pending.length
          ? `<div class="scroll"><table class="t"><thead><tr>${theadRow}</thead><tbody>${pending.map(pendingRow).join('')}</tbody></table></div>`
          : `<p class="good" style="margin:2px 0">すべて対応済みです。</p>`) +
        `<p class="hint" style="margin:12px 0 2px">` +
        `<button data-act="saved-toggle-resolved" style="font-size:11px;padding:2px 8px">` +
        `${showResolved ? '▾' : '▸'} 対応済み（${resolved.length} 件）</button></p>` +
        (showResolved && resolved.length
          ? `<div class="scroll"><table class="t"><thead><tr>${theadRow}</thead><tbody>${resolved.map(resolvedRow).join('')}</tbody></table></div>`
          : ''),
    );
  }

  // コメント欄は「入力のたびに」ではなく「入力し終えて離れたとき」に反映する
  // （change イベント。keystroke ごとに保存すると seed の並び替えや toast が
  // うるさくなる上、日本語入力の変換中に確定させてしまう事故も避けられる）。
  const offNote = delegate(host, 'change', '.note-input', (t) => {
    const el = t as HTMLInputElement;
    const seed = el.dataset.seed;
    const stage = el.dataset.stage;
    if (!seed || !stage) return;
    updateSeedNote(seed, stage, el.value);
    void syncAndReport();
  });

  // 一覧の絞り込みピックロー。「部位」を変えたら「種類」の選択肢を作り直す
  // （sheetMain.ts の populateValueSelect と同じ理由。1 つの change リスナーに
  // まとめると「部位を選んだ瞬間に種類が空のまま確定してしまう」事故になる
  // ——実機で確認済みのバグなので、ここも 2 つに分けたままにすること）。
  const offGridLocus = delegate(host, 'change', '.gf-locus', (t) => {
    const i = Number((t as HTMLSelectElement).dataset.i);
    const row = st.gridFilters[i];
    if (!row) return;
    row.locus = (t as HTMLSelectElement).value;
    row.allele = '';
    renderGridFilters();
    persist();
  });
  const offGridAllele = delegate(host, 'change', '.gf-allele', (t) => {
    const i = Number((t as HTMLSelectElement).dataset.i);
    const row = st.gridFilters[i];
    if (!row) return;
    row.allele = (t as HTMLSelectElement).value;
    persist();
  });

  // ── PNG 出力 ───────────────────────────────────────────

  async function exportPng(): Promise<void> {
    if (!current || !currentSvg) return;
    try {
      const url = await svgToPngDataUrl(currentSvg, {
        width: currentPx,
        height: currentPx,
        scale: 2,
        // 透過だと暗背景の確認結果と見た目がずれるので、いま見ている背景を焼き込む。
        background: st.dark ? '#221d26' : '#f8efdf',
      });
      triggerDownload(`genomon-${current.seed}-${st.stage}.png`, url);
      deps.toast('PNG を書き出しました。', 'ok');
    } catch (err) {
      deps.toast(`PNG にできませんでした: ${String(err)}`, 'bad');
    }
  }

  // ── フォームの配線 ─────────────────────────────────────

  function syncForm(): void {
    const set = (sel: string, v: string): void => {
      const n = $<HTMLInputElement>(sel, host);
      if (n && n.value !== v) n.value = v;
    };
    set('#f-seed', st.seed);
    set('#f-stage', st.stage);
    set('#f-base', st.base);
    set('#f-palette', st.palette);
    set('#f-detail', st.detail);
    set('#f-gridn', String(st.gridN));
    set('#f-inspn', String(st.inspectN));
    set('#f-pa', st.parentA);
    set('#f-pb', st.parentB);
    set('#f-kids', String(st.kids));
    set('#f-mut', String(st.mutationScale));
    set('#f-flocus', st.forceLocus);
    const chk = (sel: string, v: boolean): void => {
      const n = $<HTMLInputElement>(sel, host);
      if (n) n.checked = v;
    };
    chk('#f-force', st.force);
    chk('#f-debug', st.debug);
    chk('#f-onlyissues', st.gridOnlyIssues);
    for (const b of $$('[data-toggle]', host)) {
      const key = b.dataset.toggle ?? '';
      const val = b.dataset.value ?? '';
      const on =
        (key === 'dark' && String(st.dark) === val) || (key === 'big' && String(st.big) === val);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    renderAlleleOptions();
  }

  function renderAlleleOptions(): void {
    const sel = $<HTMLSelectElement>('#f-fallele', host);
    if (!sel) return;
    const def = CAT_LOCI.find((l) => l.locus === st.forceLocus);
    const opts =
      `<option value="">（なし）</option>` +
      (def
        ? def.alleles.map((a) => `<option value="${esc(a.id)}">${esc(a.label)}（${esc(a.id)}）</option>`).join('')
        : '');
    if (sel.innerHTML !== opts) sel.innerHTML = opts;
    sel.value = st.forceAllele;
    if (sel.value !== st.forceAllele) st.forceAllele = sel.value;
  }

  const offInput = delegate(host, 'input', 'input,select,textarea', (t) => {
    const el = t as HTMLInputElement;
    switch (el.id) {
      case 'f-seed': st.seed = el.value; selectedGridItem = null; break;
      case 'f-stage': st.stage = el.value as Stage; break;
      case 'f-base': st.base = el.value as BodyBase | ''; selectedGridItem = null; break;
      case 'f-palette': st.palette = el.value; selectedGridItem = null; break;
      case 'f-detail': st.detail = el.value as RenderDetail; break;
      case 'f-force': st.force = el.checked; selectedGridItem = null; break;
      case 'f-debug': st.debug = el.checked; break;
      case 'f-onlyissues': st.gridOnlyIssues = el.checked; renderGrid(); persist(); return;
      case 'f-gridn': st.gridN = Number(el.value) || 100; persist(); return;
      case 'f-inspn': st.inspectN = Number(el.value) || 500; persist(); return;
      case 'f-pa': st.parentA = el.value; persist(); return;
      case 'f-pb': st.parentB = el.value; persist(); return;
      case 'f-kids': st.kids = Number(el.value) || 8; persist(); return;
      case 'f-mut': st.mutationScale = Number(el.value); syncMutLabel(); persist(); return;
      case 'f-flocus': st.forceLocus = el.value; st.forceAllele = ''; renderAlleleOptions(); persist(); return;
      case 'f-fallele': st.forceAllele = el.value; persist(); return;
      case 'lab-partlimit': {
        const max = current?.model.parts.length ?? 0;
        const v = Number(el.value);
        partLimit = v >= max ? null : v;
        renderSingle();
        return;
      }
      default: return;
    }
    partLimit = null;
    persist();
    renderSingle();
  });

  function syncMutLabel(): void {
    const o = $('#f-mut-out', host);
    if (o) o.textContent = `${st.mutationScale}×`;
  }

  const offClick = delegate(host, 'click', 'button,[data-pick]', (t) => {
    const pick = t.dataset.pick;
    if (pick) {
      st.seed = pick;
      selectedGridItem = gridItems.get(pick) ?? null;
      partLimit = null;
      persist();
      syncForm();
      renderSingle();
      markGridSelection(normalizeSeed(pick));
      focusSpecimen();
      return;
    }

    const toggle = t.dataset.toggle;
    if (toggle) {
      const v = t.dataset.value === 'true';
      if (toggle === 'dark') {
        st.dark = v;
        deps.setDark(v);
      } else if (toggle === 'big') {
        st.big = v;
      }
      persist();
      syncForm();
      renderSingle();
      return;
    }

    switch (t.dataset.act) {
      case 'regen':
        partLimit = null;
        renderSingle();
        deps.toast('同じ seed で作り直しました（決定論的なので同じ絵になります）。');
        break;
      case 'random':
        st.seed = makeWorldSeed().toUpperCase().replace(/^W-/, '');
        selectedGridItem = null;
        partLimit = null;
        persist();
        syncForm();
        renderSingle();
        break;
      case 'parts-all':
        partLimit = null;
        renderSingle();
        break;
      case 'copy-seed':
        if (current) void copyText(current.seed).then((ok) => deps.toast(ok ? `コピーしました: ${current?.seed}` : 'コピーできませんでした', ok ? 'ok' : 'bad'));
        break;
      case 'save-seed':
        if (current) {
          const input = $('#lab-comment-input', host) as HTMLInputElement | null;
          const note = input?.value.trim() ?? '';
          addSeed({ seed: current.seed, stage: st.stage, issues: current.issues, note, savedAt: Date.now() });
          if (input) input.value = '';
          renderSaved();
          deps.toast(note ? `コメント付きで保存しました: 「${note}」` : '保存しました（コメントなし）。', 'ok');
          void syncAndReport();
        }
        break;
      case 'copy-json':
        if (current) {
          void copyText(pretty({ seed: current.seed, genotype: current.genotype, phenotype: current.pheno })).then(
            (ok) => deps.toast(ok ? 'JSON をコピーしました。' : 'コピーできませんでした', ok ? 'ok' : 'bad'),
          );
        }
        break;
      case 'png':
        void exportPng();
        break;
      case 'grid':
        renderGrid();
        break;
      case 'grid-filter-clear': {
        const i = Number(t.dataset.i);
        const row = st.gridFilters[i];
        if (row) {
          row.locus = '';
          row.allele = '';
          renderGridFilters();
          persist();
        }
        break;
      }
      case 'inspect':
        void runInspect();
        break;
      case 'sib':
        renderSiblings();
        break;
      case 'insp-copy':
        void copyText(inspectRows.map((r) => r.seed).join('\n')).then((ok) =>
          deps.toast(ok ? `${inspectRows.length} 件の seed をコピーしました。` : 'コピーできませんでした', ok ? 'ok' : 'bad'),
        );
        break;
      case 'insp-save':
        for (const r of inspectRows) {
          addSeed({ seed: r.seed, stage: st.stage, issues: r.issues, note: '自動検査', savedAt: Date.now() });
        }
        renderSaved();
        deps.toast(`${inspectRows.length} 件を保存しました。`, 'ok');
        void syncAndReport();
        break;
      case 'insp-dl':
        downloadText(`genomon-lab-issues-${st.stage}.json`, pretty(inspectRows), 'application/json');
        break;
      case 'insp-pick':
      case 'saved-pick': {
        const seed = t.dataset.seed;
        if (seed) {
          st.seed = seed;
          const stage = t.dataset.stage;
          if (stage === 'egg' || stage === 'juvenile' || stage === 'adult') st.stage = stage;
          partLimit = null;
          persist();
          syncForm();
          renderSingle();
          markGridSelection(normalizeSeed(seed));
          focusSpecimen();
        }
        break;
      }
      case 'saved-del': {
        const seed = t.dataset.seed;
        if (seed) {
          removeSeed(seed, t.dataset.stage ?? '');
          renderSaved();
          void syncAndReport();
        }
        break;
      }
      case 'saved-resolve':
      case 'saved-unresolve': {
        const seed = t.dataset.seed;
        const stage = t.dataset.stage;
        if (seed && stage) {
          setResolved(seed, stage, t.dataset.act === 'saved-resolve', 'user');
          renderSaved();
          void syncAndReport();
        }
        break;
      }
      case 'saved-toggle-resolved':
        showResolved = !showResolved;
        renderSaved();
        break;
      case 'saved-copy':
        void copyText(loadSeeds().map((s) => s.seed).join('\n')).then((ok) =>
          deps.toast(ok ? 'コピーしました。' : 'コピーできませんでした', ok ? 'ok' : 'bad'),
        );
        break;
      case 'saved-dl':
        downloadText('genomon-lab-seeds.json', pretty(loadSeeds() as SavedSeed[]), 'application/json');
        break;
      case 'saved-sync':
        void syncAndReport(true);
        break;
      case 'saved-clear':
        clearSeeds();
        renderSaved();
        deps.toast('保存した seed を消しました。');
        void syncAndReport();
        break;
      default:
        break;
    }
  });

  syncForm();
  syncMutLabel();
  renderSingle();
  renderGrid();
  renderSaved();
  // 開いた瞬間に、Claude がファイルへ直接書いた「対応済み」を取り込む。
  // ユーザーが何も操作しなくても最新の状態が見えている状態にする。
  void syncAndReport();

  return {
    dispose() {
      offInput();
      offClick();
      offNote();
      offGridLocus();
      offGridAllele();
    },
  };
}

// ─────────────────────────────────────────────────────────
//  HTML の骨組み
// ─────────────────────────────────────────────────────────

function shell(gridFilters: GridFilterRow[]): string {
  const stageOpts = (['egg', 'juvenile', 'adult'] as Stage[])
    .map((s) => `<option value="${s}">${STAGE_LABEL[s]}</option>`)
    .join('');
  const baseOpts =
    `<option value="">（指定なし）</option>` +
    BODY_BASES.map((b) => `<option value="${b}">${BASE_LABEL[b]}（${b}）</option>`).join('');
  const palOpts =
    `<option value="">（指定なし）</option>` +
    PALETTE_FAMILIES.map(
      (p) => `<option value="${p.id}">${p.label}（${p.id}）${p.rare ? ' ★潜性' : ''}</option>`,
    ).join('');
  const locusOpts =
    `<option value="">（なし）</option>` +
    CAT_LOCI.map((l) => `<option value="${l.locus}">${l.label}（${l.locus}）</option>`).join('');

  return (
    `<nav class="lab-quicknav" aria-label="Visual Lab の移動">` +
    `<a href="#lab-settings">条件</a><a href="#lab-single-card">個体</a>` +
    `<a href="#lab-grid-card">一覧</a><a href="#lab-inspect-card">自動検査</a>` +
    `<a href="#lab-sib-card">兄弟比較</a><a href="#lab-saved-card">保存済み</a></nav>` +
    `<section class="card lab-card" id="lab-settings">` +
    `<div class="lab-card__head"><div><span class="lab-kicker">SETUP</span><h2>生成の条件</h2></div>` +
    `<p class="lab-card__desc">まずここで、観察したい個体の条件を決めます。</p></div>` +
    `<div class="lab-form-grid">` +
    `<label class="f lab-field lab-field--seed"><span class="lab-field__label">seed</span><input type="text" id="f-seed" size="18"></label>` +
    `<div class="lab-field lab-field--actions"><span class="lab-field__label">操作</span><span class="lab-inline-actions">` +
    `<button data-act="regen">同じ seed で再生成</button><button data-act="random">ランダム seed</button></span></div>` +
    `<label class="f lab-field"><span class="lab-field__label">段階</span><select id="f-stage">${stageOpts}</select></label>` +
    `<label class="f lab-field"><span class="lab-field__label">素体</span><select id="f-base">${baseOpts}</select></label>` +
    `<label class="f lab-field"><span class="lab-field__label">配色</span><select id="f-palette">${palOpts}</select></label>` +
    `<label class="f lab-field lab-field--check"><span class="lab-field__label">固定</span><span class="lab-checkbox"><input type="checkbox" id="f-force">強制（ホモ接合）</span></label>` +
    `<label class="f lab-field"><span class="lab-field__label">品質</span><select id="f-detail"><option value="full">full</option><option value="lite">lite</option></select></label>` +
    `</div>` +
    `<div class="lab-tool-row"><div class="lab-control-group"><span class="lab-control-label">背景</span>` +
    `<span class="seg"><button data-toggle="dark" data-value="false">明るい</button><button data-toggle="dark" data-value="true">暗い</button></span></div>` +
    `<div class="lab-control-group"><span class="lab-control-label">サイズ</span>` +
    `<span class="seg"><button data-toggle="big" data-value="false">小</button><button data-toggle="big" data-value="true">大</button></span></div>` +
    `<label class="lab-checkbox lab-debug-check"><input type="checkbox" id="f-debug">描画境界・アンカーを表示</label></div>` +
    `<p class="hint lab-hint">★潜性の <strong>しんじゅ(pearl)</strong> と <strong>こうせき(mineral)</strong> は自然出現が合計 2.5% 前後です。` +
    `「強制」を入れると palette 遺伝子座をホモ接合に固定して確実に出せます。外すと自然出現だけを絞り込みます（時間がかかります）。</p>` +
    `</section>` +
    `<section class="card lab-card" id="lab-single-card"><div class="lab-card__head"><div><span class="lab-kicker">SPECIMEN</span><h2>個体</h2></div>` +
    `<p class="lab-card__desc">一覧から選ぶと、ここで同じ個体を拡大して確認できます。</p></div><div id="lab-single"></div></section>` +
    `<section class="card lab-card" id="lab-grid-card">` +
    `<div class="lab-card__head"><div><span class="lab-kicker">GALLERY</span><h2>一覧</h2></div>` +
    `<p class="lab-card__desc">小さく並べて全体の傾向を見て、気になる1体をタップします。</p></div>` +
    `<div class="lab-grid-controls"><label class="f lab-inline-field">体数 <input type="number" id="f-gridn" min="1" max="400" step="1" style="width:5.5em"></label>` +
    `<label class="lab-checkbox"><input type="checkbox" id="f-onlyissues">問題個体だけ表示</label>` +
    `<button class="primary lab-generate-button" data-act="grid">一覧を生成</button></div>` +
    `<div class="lab-filter-box"><div class="lab-subhead"><strong>一覧だけの固定条件</strong><span>最大3件</span></div>` +
    `<div class="row" id="lab-grid-filters">${gridFilterRowsHtml(gridFilters)}</div>` +
    `<p class="hint">部位を選ぶと種類を選択できます。変更後に「一覧を生成」を押してください。</p></div>` +
    `<div id="lab-grid-wrap"></div>` +
    `</section>` +
    `<section class="card lab-card" id="lab-inspect-card">` +
    `<div class="lab-card__head"><div><span class="lab-kicker">CHECK</span><h2>自動検査</h2></div>` +
    `<p class="lab-card__desc">inspectModel で、描画のはみ出しや構造上の問題をまとめて確認します。</p></div>` +
    `<div class="lab-grid-controls"><label class="f lab-inline-field">体数 <input type="number" id="f-inspn" min="1" max="5000" step="50" style="width:6em"></label>` +
    `<button class="primary" id="lab-inspect-run" data-act="inspect">検査を実行</button><span class="bar grow" id="lab-inspect-bar"><i></i></span></div>` +
    `<div id="lab-inspect-out"></div></section>` +
    `<section class="card lab-card" id="lab-sib-card">` +
    `<div class="lab-card__head"><div><span class="lab-kicker">FAMILY</span><h2>兄弟比較</h2></div>` +
    `<p class="lab-card__desc">親Aと親Bを組み合わせ、子どものばらつきを見比べます。</p></div>` +
    `<div class="lab-form-grid lab-family-form">` +
    `<label class="f lab-field"><span class="lab-field__label">親A seed</span><input type="text" id="f-pa" size="12"></label>` +
    `<label class="f lab-field"><span class="lab-field__label">親B seed</span><input type="text" id="f-pb" size="12"></label>` +
    `<label class="f lab-field"><span class="lab-field__label">子の数</span><input type="number" id="f-kids" min="1" max="48" style="width:4.5em"></label>` +
    `<label class="f lab-field lab-field--range"><span class="lab-field__label">突然変異率 <output id="f-mut-out" class="mono"></output></span><input type="range" id="f-mut" min="0" max="20" step="0.5"></label>` +
    `<label class="f lab-field"><span class="lab-field__label">形質を強制</span><select id="f-flocus">${locusOpts}</select></label>` +
    `<label class="f lab-field"><span class="lab-field__label">種類</span><select id="f-fallele"></select></label>` +
    `</div><div class="lab-form-actions"><button class="primary" data-act="sib">兄弟を生成</button></div>` +
    `<div id="lab-sib-out"></div></section>` +
    `<section class="card lab-card" id="lab-saved-card"><div class="lab-card__head"><div><span class="lab-kicker">NOTES</span><h2>保存した seed</h2></div>` +
    `<p class="lab-card__desc">コメント付きの個体と、対応状況を確認します。</p></div><div id="lab-saved-out"></div></section>`
  );
}

/**
 * 一覧の「絞り込み」ピックロー（部位 → 種類）を最大 `GRID_FILTER_ROWS` 行ぶん作る。
 * sheetMain.ts の同名 UI と見た目・挙動を揃えた（部位を選ぶとその部位の
 * 対立遺伝子だけが「種類」に出る。両方選んだ行だけ実際に絞り込みへ使われる）。
 */
function gridFilterRowsHtml(rows: GridFilterRow[]): string {
  return Array.from({ length: GRID_FILTER_ROWS })
    .map((_, i) => {
      const row = rows[i] ?? { locus: '', allele: '' };
      const locusOpts =
        `<option value="">（絞り込む部位）</option>` +
        CAT_LOCI.map(
          (l) => `<option value="${l.locus}"${l.locus === row.locus ? ' selected' : ''}>${esc(l.label)}</option>`,
        ).join('');
      const def = CAT_LOCI.find((l) => l.locus === row.locus);
      const alleleOpts =
        `<option value="">（すべて）</option>` +
        (def
          ? def.alleles
              .map((a) => `<option value="${a.id}"${a.id === row.allele ? ' selected' : ''}>${esc(a.label)}</option>`)
              .join('')
          : '');
      return (
        `<span class="pickrow" data-i="${i}">` +
        `<select class="gf-locus" data-i="${i}">${locusOpts}</select>` +
        `<select class="gf-allele" data-i="${i}"${def ? '' : ' disabled'}>${alleleOpts}</select>` +
        `<button type="button" class="clear" data-act="grid-filter-clear" data-i="${i}" title="この絞り込みを外す">✕</button>` +
        `</span>`
      );
    })
    .join('');
}

function kv(k: string, v: string): string {
  return `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
}

function det(title: string, body: string): string {
  return (
    `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--fg-soft)">${esc(title)}</summary>` +
    `<div class="scroll" style="margin-top:4px"><pre class="mono" style="margin:0;padding:6px;font-size:11px">${esc(body)}</pre></div></details>`
  );
}

function boxStr(b: { x: number; y: number; w: number; h: number }): string {
  return `x=${b.x.toFixed(1)} y=${b.y.toFixed(1)} w=${b.w.toFixed(1)} h=${b.h.toFixed(1)}`;
}

/** 部位（遺伝子座）ID → 日本語ラベル。sheetMain.ts の同名ロジックと同じ発想。 */
function localeLocusLabel(locus: string): string {
  return CAT_LOCI.find((l) => l.locus === locus)?.label ?? locus;
}

/** 対立遺伝子 ID → 日本語ラベル。カタログに無ければそのまま返す。 */
function alleleLabel(locus: string, alleleId: string): string {
  const def = CAT_LOCI.find((l) => l.locus === locus);
  return def?.alleles.find((a) => a.id === alleleId)?.label ?? alleleId;
}

function countStr(rec: Record<string, number>): string {
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}
