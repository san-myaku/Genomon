/**
 * コンタクトシート（sheet.html の入口）。
 *
 * 100 体を一望して「全部が似ていないか」「3 系統の素体が違って見えるか」
 * 「装飾が顔を隠していないか」を人の目で判断するための開発用ページ。
 * ゲーム本体（index.html）とは独立したエントリ。
 *
 * URL パラメータ:
 *   ?n=100                 体数（既定 100・10×10）
 *   ?stage=egg|juvenile|adult
 *   ?base=maru|yurei|slime  素体で絞り込む
 *   ?bg=light|dark
 *   ?size=small|large
 *   ?zoom=3                表示だけを N 倍に拡大する（色の判断用・既定 1）
 *   ?only=W965-2FBS,...    名指しの seed だけを並べる
 *   ?seed=XXXX             起点 seed
 *   ?detail=full|lite      描画品質（既定: n<=49 なら full）
 *   ?debug=1               bodyBox / faceBox / アンカーを重ねる
 *   ?issues=1              inspectModel で問題のあった個体だけ表示
 *   ?force=pattern:cow,lumin:mote
 *                          指定した遺伝子座をホモ接合に強制する（開発確認用）。
 *                          出現率の低い形質（ヤドクガエル系・発光・2色など）を
 *                          まとめて並べて美術品質を見るために要る。
 *                          Visual Lab の同機能と同じ細工で、ゲーム本体には影響しない。
 *   ?group=ears             指定した遺伝子座の値で並べ替え、同じ種類ごとに
 *                          見出しを挟んでまとめる（強制はしない＝自然な分布のまま）。
 *
 * 画面上部の操作パネルは、上の URL パラメータを GUI で組み立てるだけの薄い層。
 * 「部位を選ぶ→種類を選ぶ」の 2 段を選ぶと、種類を選べば絞り込み（force）、
 * 「すべて（並び替え）」のままなら並び替え（group）としてページを再読込する。
 * 非エンジニアのユーザーが URL を手で書かずに使えるようにするためのもの。
 */

import type {
  BodyBase,
  CatLocus,
  CatPair,
  Genotype,
  Phenotype,
  RenderDetail,
  Stage,
} from './core/types.ts';
import { PAPER, PAPER_DARK } from './core/color.ts';
import { makeSeed } from './core/rng.ts';
import { randomGenotype } from './genetics/genotype.ts';
import { CAT_LOCI } from './genetics/loci.ts';
import { phenotypeOf, visibleTraits } from './genetics/phenotype.ts';
import { buildRenderModel } from './render/model.ts';
import { moodOf } from './render/ctx.ts';
import { renderCreatureSvg, renderDebugOverlay } from './render/creature.ts';
import { inspectModel } from './render/inspect.ts';
import { makeUid } from './render/svg.ts';

const qs = new URLSearchParams(location.search);

const num = (k: string, d: number): number => {
  const v = Number(qs.get(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};

// 自動検査を 500 体規模で回せるよう上限を引き上げた（描画は重いが検査は速い）。
const N = Math.min(1000, Math.round(num('n', 100)));
const STAGE = ((): Stage => {
  const s = qs.get('stage');
  return s === 'egg' || s === 'juvenile' || s === 'adult' ? s : 'adult';
})();
const BASE = ((): BodyBase | null => {
  const b = qs.get('base');
  return b === 'maru' || b === 'yurei' || b === 'slime' ? b : null;
})();
const DARK = qs.get('bg') === 'dark';
const SIZE = qs.get('size') === 'large' ? 200 : qs.get('size') === 'small' ? 96 : 140;
/**
 * `?zoom=3` … 表示だけを N 倍に拡大する（既定 1・上限 6）。
 *
 * 【なぜ要るか】
 *   色や目の中の意匠は 140〜200px のセルでは「小さな模様」にしか見えず、
 *   スクリーンショットを撮っても後から拡大できない（元画素が無いため）。
 *   `?only=` で名指しした数体を大きく描いて撮れば、
 *   色そのものの良し悪しを実物で判断できる。`size=small` の 96px 検証とは
 *   別の用途で、**描画寸法は変えず**（`SIZE` はそのまま）
 *   CSS の拡大だけを掛けるので、96px 特有の潰れは再現しない。
 */
const ZOOM = Math.min(6, Math.max(1, Number(qs.get('zoom')) || 1));
const SEED0 = qs.get('seed') || 'GENOMON-SHEET';
const DETAIL: RenderDetail = ((): RenderDetail => {
  const d = qs.get('detail');
  if (d === 'full' || d === 'lite') return d;
  return N <= 49 ? 'full' : 'lite';
})();
const DEBUG = qs.get('debug') === '1';
const ONLY_ISSUES = qs.get('issues') === '1';

/** `?force=pattern:cow,lumin:mote` を解釈する。 */
const FORCE: Partial<Record<CatLocus, string>> = (() => {
  const out: Partial<Record<CatLocus, string>> = {};
  for (const part of (qs.get('force') ?? '').split(',')) {
    const [locus, allele] = part.split(':');
    if (locus && allele) out[locus.trim() as CatLocus] = allele.trim();
  }
  return out;
})();
const FORCE_KEYS = Object.keys(FORCE) as CatLocus[];

/** 指定した遺伝子座をホモ接合に固定する（元の Genotype は変更しない）。 */
function forceCat(g: Genotype): Genotype {
  if (FORCE_KEYS.length === 0) return g;
  const cat = { ...g.cat } as Record<CatLocus, CatPair>;
  for (const k of FORCE_KEYS) cat[k] = [FORCE[k]!, FORCE[k]!] as CatPair;
  return { seed: g.seed, cat, num: g.num };
}

/**
 * `?group=ears` — 指定した遺伝子座で並べ替え、種類ごとに見出しを挟む。
 *
 * 【`force` と役割を分けた理由】
 *   `force` は「全員をこの種類にする」（絞り込み）。
 *   `group` は「種類は自然な分布のまま、並び順だけ揃える」（見比べ）。
 *   両方を 1 つのパラメータにすると「force しつつ group」を表現できず、
 *   「今出ている種類を一望してから 1 つに絞り込む」という
 *   操作パネルの 2 段階（部位→種類、種類が「すべて」なら group）に合わない。
 */
const GROUP = ((): CatLocus | null => {
  const g = qs.get('group');
  return g && CAT_LOCI.some((l) => l.locus === g) ? (g as CatLocus) : null;
})();

/**
 * 表現型からその遺伝子座の対立遺伝子 ID を読む（`group` 用の汎用アクセサ）。
 *
 * 【`base` と `palette` だけ特別扱いする理由】
 *   ほとんどの遺伝子座は `pheno.parts.<locus>` にそのまま入っているが、
 *   `base`（素体）は `pheno.base` に、`palette`（配色）は
 *   `pheno.palette.family` に出る（構造が違うのは types.ts の設計）。
 */
function alleleOf(pheno: Phenotype, locus: CatLocus): string {
  if (locus === 'base') return pheno.base;
  if (locus === 'palette') return pheno.palette.family;
  return String((pheno.parts as unknown as Record<string, unknown>)[locus] ?? '');
}

const paper = DARK ? PAPER_DARK : PAPER;
const fg = DARK ? '#e9dcc6' : '#5a463c';

document.documentElement.style.background = DARK ? '#1a161d' : '#efe3cd';
// 接地影のテーマ切り替え（render/creature.ts の SHADOW_THEME_CSS）に合わせる。
// これが無いと ?bg=dark のシートだけ明背景用の影が出て、暗背景の検証にならない。
document.documentElement.dataset.theme = DARK ? 'dark' : 'light';

const style = document.createElement('style');
style.textContent = `
  *{box-sizing:border-box}
  body{margin:0;font-family:"Hiragino Maru Gothic ProN","Segoe UI",system-ui,sans-serif;
       background:${DARK ? '#1a161d' : '#efe3cd'};color:${fg};}
  header{position:sticky;top:0;z-index:5;padding:8px 14px;font-size:13px;font-weight:700;
         background:${DARK ? '#241f2a' : '#e2d2b6'};border-bottom:2px solid ${DARK ? '#3a3242' : '#cbb694'};
         display:flex;gap:14px;flex-wrap:wrap;align-items:center}
  header .warn{color:${DARK ? '#ffb0a0' : '#a83c22'}}
  #grid{display:grid;gap:6px;padding:10px}
  .cell{background:${paper};border-radius:12px;padding:4px 2px 2px;text-align:center;
        border:1.5px solid ${DARK ? '#3a3242' : '#e0cfb0'};cursor:pointer;transition:transform .08s}
  .cell:hover{transform:translateY(-2px);border-color:${DARK ? '#5c4f70' : '#b89a68'}}
  .cell.bad{border-color:#e2604a;box-shadow:0 0 0 2px rgba(226,96,74,.35)}
  .cell svg{display:block;width:100%;height:auto}
  .lbl{font-size:9px;line-height:1.25;color:${DARK ? '#9b8c7a' : '#8a7660'};
       font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all;padding:1px 2px 2px}
  .tag{font-size:8px;opacity:.75}
  .grouphead{grid-column:1/-1;font-size:13px;font-weight:700;padding:10px 4px 2px;
             color:${fg};border-bottom:2px solid ${DARK ? '#3a3242' : '#cbb694'};margin-top:6px}
  .grouphead:first-child{margin-top:0}
  .grouphead .tag{font-weight:400;margin-left:6px}

  /* ── 操作パネル ────────────────────────────────────── */
  #panel{position:sticky;top:37px;z-index:4;padding:8px 14px 10px;
         background:${DARK ? '#1e1a24' : '#f3e7cf'};border-bottom:2px solid ${DARK ? '#3a3242' : '#cbb694'};
         font-size:12px}
  #panel .row{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:4px 0}
  #panel label{display:inline-flex;flex-direction:column;gap:2px;font-size:10px;
               color:${DARK ? '#9b8c7a' : '#8a7660'}}
  #panel select,#panel input{font:inherit;font-size:12px;padding:4px 6px;border-radius:6px;
             border:1.5px solid ${DARK ? '#443b52' : '#cbb694'};
             background:${DARK ? '#2c2536' : '#fffaf0'};color:${fg};min-width:88px}
  #panel input[type=number]{min-width:56px}
  #panel .pickrow{display:flex;gap:4px;align-items:center;background:${DARK ? '#241f2e' : '#e9dcc0'};
                   padding:4px 6px;border-radius:8px}
  #panel .pickrow .clear{cursor:pointer;font-size:11px;opacity:.6;padding:0 4px;user-select:none}
  #panel .pickrow .clear:hover{opacity:1}
  #panel .hint{font-size:10.5px;opacity:.7;margin-top:2px}
`;
document.head.appendChild(style);

interface Item {
  seed: string;
  genotype: Genotype;
  pheno: Phenotype;
  svg: string;
  issues: string[];
}

/**
 * `?only=V2XQ-HFWE,WLZX-HB49` で **名指しの seed だけ**を並べる。
 *
 * 【なぜ要るか】
 *   ビジュアル批評は個体を seed で名指しする。100 体のシートから
 *   その 1 体を目で探すのは非現実的で、拡大して確認することもできない。
 *   seed は `randomGenotype(seed)` の入力そのものなので、
 *   ここへ直接渡せば同じ個体が再現できる（`?seed=` の連番と同じ結果）。
 *   検証専用の入口で、ゲーム本体には影響しない。
 */
const ONLY_SEEDS = (qs.get('only') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

function collect(): Item[] {
  const items: Item[] = [];
  if (ONLY_SEEDS.length > 0) {
    for (const seed of ONLY_SEEDS) {
      const genotype = forceCat(randomGenotype(seed));
      const pheno = phenotypeOf(genotype, STAGE);
      const model = buildRenderModel(pheno, null, {
        detail: DETAIL,
        uid: makeUid(seed, `${STAGE}:${DETAIL}:sheet`),
        genotype,
      });
      const res = inspectModel(model);
      let svg = renderCreatureSvg(model, { background: paper, animatable: false });
      if (DEBUG) svg = svg.replace('</svg>', `${renderDebugOverlay(model)}</svg>`);
      items.push({ seed, genotype, pheno, svg, issues: res.issues });
    }
    return items;
  }
  const maxTries = BASE ? N * 40 + 200 : N + 8;
  for (let i = 0; items.length < N && i < maxTries; i++) {
    const seed = makeSeed(SEED0, i);
    const genotype = forceCat(randomGenotype(seed));
    const pheno = phenotypeOf(genotype, STAGE);
    if (BASE && pheno.base !== BASE) continue;
    const model = buildRenderModel(pheno, null, {
      detail: DETAIL,
      uid: makeUid(seed, `${STAGE}:${DETAIL}:sheet`),
      genotype,
    });
    const res = inspectModel(model);
    let svg = renderCreatureSvg(model, { background: paper, animatable: false });
    if (DEBUG) svg = svg.replace('</svg>', `${renderDebugOverlay(model)}</svg>`);
    if (ONLY_ISSUES && res.ok) continue;
    items.push({ seed, genotype, pheno, svg, issues: res.issues });
  }
  return items;
}

const t0 = performance.now();
const items = collect();
const t1 = performance.now();

/** `group` の遺伝子座定義（見出し用のラベル引きにも使う）。 */
const GROUP_DEF = GROUP ? CAT_LOCI.find((l) => l.locus === GROUP) ?? null : null;

/** 対立遺伝子 ID → 日本語ラベル。カタログに無い ID（共優性の合成表現など）はそのまま返す。 */
function alleleLabel(locus: CatLocus, alleleId: string): string {
  const def = CAT_LOCI.find((l) => l.locus === locus);
  return def?.alleles.find((a) => a.id === alleleId)?.label ?? alleleId;
}

if (GROUP_DEF) {
  const groupLocus = GROUP_DEF.locus;
  // カタログに載っている順（＝優性度で並べた意味のある順）を並び順の基準にする。
  // 五十音順だと「まるめ・たまご・ぱっちり…」のような設計意図の順序が失われる。
  const order = new Map(GROUP_DEF.alleles.map((a, i) => [a.id, i]));
  const rank = (v: string): number => order.get(v) ?? 999;
  // 安定ソート（Array#sort は ES2019 以降で安定）。同じ種類の中の順番は
  // 生成順（＝ seed 連番）のまま保たれるので、group していないときの並びと
  // 極端に印象が変わらない。
  items.sort((a, b) => rank(alleleOf(a.pheno, groupLocus)) - rank(alleleOf(b.pheno, groupLocus)));
}

const cols = Math.max(1, Math.round(Math.sqrt(items.length)) || 1);
const badCount = items.filter((it) => it.issues.length > 0).length;
const byKind: Record<string, number> = {};
for (const it of items) {
  for (const iss of it.issues) {
    const k = iss.split(':')[0]!;
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
}
const baseCount: Record<string, number> = {};
for (const it of items) baseCount[it.pheno.base] = (baseCount[it.pheno.base] ?? 0) + 1;
// 配色ファミリーの分布と実際の HSL。指示書 §25「十分な多様性」の実測用。
const famCount: Record<string, number> = {};
const famHsl: Record<string, { h: number; s: number; l: number }[]> = {};
for (const it of items) {
  const f = it.pheno.palette.family ?? '?';
  famCount[f] = (famCount[f] ?? 0) + 1;
  (famHsl[f] ??= []).push({
    h: Math.round(it.pheno.palette.hsl.h),
    s: Math.round(it.pheno.palette.hsl.s),
    l: Math.round(it.pheno.palette.hsl.l),
  });
}

const header = document.createElement('header');
header.innerHTML =
  `<span>ゲノモン コンタクトシート</span>` +
  `<span>n=${items.length} / stage=${STAGE} / detail=${DETAIL}${BASE ? ` / base=${BASE}` : ''}</span>` +
  (FORCE_KEYS.length ? `<span>強制: ${FORCE_KEYS.map((k) => `${k}=${FORCE[k]}`).join(' ')}</span>` : '') +
  (GROUP_DEF ? `<span>並び替え: ${GROUP_DEF.label}</span>` : '') +
  `<span>seed=${SEED0}</span>` +
  `<span>素体: ${Object.entries(baseCount).map(([k, v]) => `${k}=${v}`).join(' ')}</span>` +
  `<span>配色: ${Object.entries(famCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')}</span>` +
  `<span class="${badCount ? 'warn' : ''}" id="issueline">問題個体 ${badCount} / ${items.length}` +
  `${badCount ? ` （${Object.entries(byKind).map(([k, v]) => `${k}:${v}`).join(', ')}）` : ''}</span>` +
  `<span>${Math.round(t1 - t0)}ms</span>`;
document.body.appendChild(header);

// ═════════════════════════════════════════════════════════
//  操作パネル — URL を手で書かずに絞り込み・並び替えができるようにする
// ═════════════════════════════════════════════════════════
//
// 【設計】
//   ・基本設定（体数・段階・サイズ・背景・seed・素体）は 1 行のセレクト/入力。
//   ・「並び替え」は 1 個だけ（`?group=`）。部位を選ぶと、その部位の種類ごとに
//     まとめて並べ替える。何も絞り込まない＝自然な分布のまま一望できる。
//   ・「絞り込み」は 3 組まで（`?force=` に相当）。部位を選んでから種類を選ぶと
//     全個体をその種類に固定する。種類が「（すべて）」のままなら絞り込まない。
//   ・どれか 1 つでも変更したら、その場でクエリを組み立てて再読み込みする
//     （このページはそもそも URL パラメータだけで完全に決まる作りなので、
//     部分的な差し替えより「作り直して読み直す」ほうが単純で確実）。
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const LOCUS_OPTIONS = CAT_LOCI.map((l) => `<option value="${l.locus}">${esc(l.label)}</option>`).join('');

/** パネル内の小さいボタン共通の見た目（1000体ボタン・再生成ボタンで使う）。 */
const smallBtnStyle =
  `font:inherit;font-size:11px;padding:3px 8px;border-radius:6px;` +
  `border:1.5px solid ${DARK ? '#443b52' : '#cbb694'};` +
  `background:${DARK ? '#2c2536' : '#fffaf0'};color:${fg};cursor:pointer;white-space:nowrap`;

const FILTER_ROWS = 3;
const forceEntries = FORCE_KEYS.slice(0, FILTER_ROWS);

const panel = document.createElement('div');
panel.id = 'panel';
panel.innerHTML =
  `<div class="row">` +
  // 【「最大1000」をラベルに出す理由】
  //   上限そのものは以前から 1000（`N = Math.min(1000, ...)`）だったが、
  //   入力欄にその情報が出ていなかったので、製品オーナーから
  //   「1000体まで表示できるように」と言われた（実際にはすでに動いていた）。
  //   機能ではなく発見しやすさの問題だったので、上限を明記し、
  //   ワンクリックで 1000 にできるボタンも添える。
  `<label>体数（最大 1000）<span style="display:flex;gap:4px">` +
  `<input type="number" id="p-n" min="1" max="1000" value="${items.length}" style="width:6ch">` +
  `<button type="button" id="p-n-max" style="${smallBtnStyle}">1000体</button>` +
  `</span></label>` +
  `<label>段階<select id="p-stage">` +
  `<option value="egg">たまご</option><option value="juvenile">ようたい</option><option value="adult">せいたい</option>` +
  `</select></label>` +
  `<label>表示サイズ<select id="p-size">` +
  `<option value="">ふつう</option><option value="small">小さい（96px）</option><option value="large">大きい</option>` +
  `</select></label>` +
  `<label>背景<select id="p-bg"><option value="light">明るい</option><option value="dark">暗い</option></select></label>` +
  `<label>素体<select id="p-base"><option value="">（すべて）</option>` +
  `<option value="maru">まる型</option><option value="yurei">幽霊型</option><option value="slime">スライム型</option>` +
  `</select></label>` +
  `<label>seed<span style="display:flex;gap:4px">` +
  `<input type="text" id="p-seed" value="${esc(SEED0)}" style="width:11ch">` +
  `<button type="button" id="p-reseed" style="${smallBtnStyle}" title="新しい顔ぶれをランダムに生成する">↻ 再生成</button>` +
  `</span></label>` +
  `</div>` +
  `<div class="row">` +
  `<label>並び替え（同じ種類でまとめて表示）<select id="p-group"><option value="">（しない）</option>${LOCUS_OPTIONS}</select></label>` +
  `</div>` +
  `<div class="row" id="p-filters">` +
  Array.from({ length: FILTER_ROWS })
    .map(
      (_, i) =>
        `<span class="pickrow" data-i="${i}">` +
        `<select class="f-locus"><option value="">（絞り込む部位）</option>${LOCUS_OPTIONS}</select>` +
        `<select class="f-value" disabled><option value="">（すべて）</option></select>` +
        `<span class="clear" title="この絞り込みを外す">✕</span>` +
        `</span>`,
    )
    .join('') +
  `</div>` +
  `<p class="hint">「絞り込み」で種類を選ぶとその種類だけを表示。「並び替え」は種類ごとに見出しを挟んで一覧にします（絞り込みはしません）。</p>`;
document.body.appendChild(panel);

// ── 初期値をいまの URL 状態に合わせる ──────────────────────
(panel.querySelector('#p-stage') as HTMLSelectElement).value = STAGE;
(panel.querySelector('#p-size') as HTMLSelectElement).value = qs.get('size') === 'small' || qs.get('size') === 'large' ? qs.get('size')! : '';
(panel.querySelector('#p-bg') as HTMLSelectElement).value = DARK ? 'dark' : 'light';
(panel.querySelector('#p-base') as HTMLSelectElement).value = BASE ?? '';
(panel.querySelector('#p-group') as HTMLSelectElement).value = GROUP ?? '';

/** 「部位」セレクトの現在値に応じて、隣の「種類」セレクトの選択肢を作り直す。 */
function populateValueSelect(row: HTMLElement, presetValue?: string): void {
  const locusSel = row.querySelector('.f-locus') as HTMLSelectElement;
  const valueSel = row.querySelector('.f-value') as HTMLSelectElement;
  const def = CAT_LOCI.find((l) => l.locus === locusSel.value);
  if (!def) {
    valueSel.innerHTML = '<option value="">（すべて）</option>';
    valueSel.disabled = true;
    valueSel.value = '';
    return;
  }
  valueSel.disabled = false;
  valueSel.innerHTML =
    `<option value="">（すべて）</option>` +
    def.alleles.map((a) => `<option value="${a.id}">${esc(a.label)}</option>`).join('');
  if (presetValue) valueSel.value = presetValue;
}

// 既存の force（最大 3 件）を絞り込み行へ割り当てる。
const rows = Array.from(panel.querySelectorAll<HTMLElement>('.pickrow'));
rows.forEach((row, i) => {
  const entry = forceEntries[i];
  if (entry) {
    (row.querySelector('.f-locus') as HTMLSelectElement).value = entry;
    populateValueSelect(row, FORCE[entry as CatLocus]);
  }
  row.querySelector('.f-locus')!.addEventListener('change', () => populateValueSelect(row));
  row.querySelector('.clear')!.addEventListener('click', () => {
    (row.querySelector('.f-locus') as HTMLSelectElement).value = '';
    populateValueSelect(row);
    applyPanel();
  });
});

/** パネルの現在値からクエリ文字列を組み立てて再読み込みする。 */
function applyPanel(): void {
  const g = (id: string): string => (panel.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement).value;
  const params = new URLSearchParams();
  params.set('n', String(Math.max(1, Math.min(1000, Number(g('p-n')) || items.length))));
  params.set('stage', g('p-stage'));
  if (g('p-size')) params.set('size', g('p-size'));
  if (g('p-bg') === 'dark') params.set('bg', 'dark');
  if (g('p-base')) params.set('base', g('p-base'));
  if (g('p-seed').trim()) params.set('seed', g('p-seed').trim());
  if (g('p-group')) params.set('group', g('p-group'));
  const forces: string[] = [];
  for (const row of rows) {
    const locus = (row.querySelector('.f-locus') as HTMLSelectElement).value;
    const value = (row.querySelector('.f-value') as HTMLSelectElement).value;
    if (locus && value) forces.push(`${locus}:${value}`);
  }
  if (forces.length) params.set('force', forces.join(','));
  // このパネルが扱わないパラメータ（detail・debug・issues・zoom・only）は
  // 既存の値をそのまま引き継ぐ。手で組み立てた URL からパネルを開いても、
  // 検証条件を黙って消さないようにするため。
  for (const k of ['detail', 'debug', 'issues', 'zoom', 'only']) {
    const v = qs.get(k);
    if (v) params.set(k, v);
  }
  location.href = `${location.pathname}?${params.toString()}`;
}

// 【`.f-locus` だけ除外する理由 — 実機で確認したバグ】
//   `.f-locus`（部位セレクト）には「隣の種類セレクトを作り直す」専用の
//   change リスナーを既に付けてある（populateValueSelect）。ここで
//   同じ要素にもう 1 つ change リスナーを足すと、**部位を選んだ瞬間に
//   種類を選ぶ前でページが再読み込みされ**、二段階選択が成立しなかった
//   （Playwright での自動操作チェックで実際に再現・確認した）。
//   即時反映してよいのは「種類」セレクト（絞り込みが確定した瞬間）と、
//   その他の設定だけ。
panel.querySelectorAll('select, input').forEach((el) => {
  if (el.classList.contains('f-locus')) return;
  el.addEventListener('change', applyPanel);
});
// seed とnはEnterでも即反映する（フォーカスを外さないと変わらないと分かりにくいため）。
panel.querySelectorAll('input').forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') applyPanel();
  });
});
panel.querySelector('#p-n-max')!.addEventListener('click', () => {
  (panel.querySelector('#p-n') as HTMLInputElement).value = '1000';
  applyPanel();
});
panel.querySelector('#p-reseed')!.addEventListener('click', () => {
  // 【ここだけ Math.random() を使ってよい理由】
  //   これは特定の個体を再現可能に決める処理ではなく、「まったく新しい
  //   顔ぶれの一覧を見せる」ための起点を選ぶだけ。ゲーム本体で
  //   `Math.random()` が唯一許されている `makeWorldSeed()` と同じ立ち位置
  //   （新しい世界を始める側）で、描画の決定性には影響しない。
  const fresh = Math.random().toString(36).slice(2, 10).toUpperCase();
  (panel.querySelector('#p-seed') as HTMLInputElement).value = fresh;
  applyPanel();
});

const grid = document.createElement('div');
grid.id = 'grid';
grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
grid.style.maxWidth = `${cols * (SIZE + 8) + 24}px`;
// `transform: scale()` ではなくCSS の `zoom` を使う。
// transform は元のレイアウト高さを変えないので、全ページ撮影で
// 上下に空白ができたり絵が切れたりする。zoom はレイアウトごと拡大する。
if (ZOOM !== 1) grid.style.zoom = String(ZOOM);
document.body.appendChild(grid);

// `group` 中は種類が変わるたびに見出し行を挟む。見出しは grid-column を
// フルスパンにしてグリッドの列数と無関係に 1 行を占める。
let lastGroupVal: string | null = null;
grid.innerHTML = items
  .map((it) => {
    const p = it.pheno;
    const tag = STAGE === 'egg' ? p.palette.family : `${p.base}/${p.parts.silhouette} ${p.palette.family}`;
    let divider = '';
    if (GROUP_DEF) {
      const locus = GROUP_DEF.locus;
      const v = alleleOf(p, locus);
      if (v !== lastGroupVal) {
        lastGroupVal = v;
        const n = items.filter((x) => alleleOf(x.pheno, locus) === v).length;
        divider =
          `<div class="grouphead">${GROUP_DEF.label}: ${alleleLabel(locus, v)}` +
          `<span class="tag">（${n} 体）</span></div>`;
      }
    }
    // 顔（目・口）の計測用に、表情を決めている値をそのまま DOM へ出す。
    // 「目幅・口幅・目口間隔」を getBBox で測るとき、どの遺伝子・どの機嫌の
    // 個体がどう出ているのかを後から突き合わせられないと、
    // 「口を小さくしたら表情の幅が消えた」といった副作用に気づけない。
    // 開発用ページ限定の属性で、ゲーム本体（index.html）には影響しない。
    const md = moodOf(null, p);
    return (
      divider +
      `<div class="cell${it.issues.length ? ' bad' : ''}"` +
      ` data-seed="${it.seed}" data-eyeshape="${p.parts.eyeShape}" data-pupil="${p.parts.pupil}"` +
      ` data-mouth="${p.parts.mouth}" data-eyecount="${p.parts.eyeCount}"` +
      ` data-smile="${md.smile.toFixed(3)}" data-droop="${md.droop.toFixed(3)}">` +
      it.svg +
      `<div class="lbl">${it.seed}<br><span class="tag">${tag}</span>` +
      (it.issues.length ? `<br><span class="tag" style="color:#e2604a">${it.issues.join(' ')}</span>` : '') +
      `</div></div>`
    );
  })
  .join('');

// 自動検査の結果をコンソールにも出す（Playwright から拾えるように）
const summary = {
  total: items.length,
  bad: badCount,
  byKind,
  baseCount,
  famCount,
  famHsl: Object.fromEntries(
    Object.entries(famHsl).map(([k, v]) => [
      k,
      {
        n: v.length,
        h: `${Math.min(...v.map((x) => x.h))}..${Math.max(...v.map((x) => x.h))}`,
        s: `${Math.min(...v.map((x) => x.s))}..${Math.max(...v.map((x) => x.s))}`,
        l: `${Math.min(...v.map((x) => x.l))}..${Math.max(...v.map((x) => x.l))}`,
      },
    ]),
  ),
  ms: Math.round(t1 - t0),
  badSeeds: items.filter((i) => i.issues.length).slice(0, 40).map((i) => ({ seed: i.seed, issues: i.issues })),
};
// eslint-disable-next-line no-console
console.log('GENOMON_SHEET_SUMMARY', JSON.stringify(summary));
(window as unknown as { __sheetSummary: unknown }).__sheetSummary = summary;
document.title = `ゲノモン シート n=${items.length} 問題${badCount}`;

// ═════════════════════════════════════════════════════════
//  個体クリック → 拡大＋詳細情報
// ═════════════════════════════════════════════════════════
//
// 【グリッドが lite でも、詳細表示だけは full で描き直す理由】
//   大量表示（500〜1000体）は detail=lite で軽く保っているが、
//   1 体をじっくり見たいときにその粗さのまま拡大するのは本末転倒。
//   クリックされた 1 体だけ、既に持っている genotype から
//   detail:'full' で再描画する（1 体分なので負荷は無視できる）。
const detailStyle = document.createElement('style');
detailStyle.textContent = `
  #overlay{position:fixed;inset:0;background:rgba(20,16,12,.6);z-index:20;
           display:none;align-items:flex-start;justify-content:center;
           overflow:auto;padding:min(6vh,60px) 16px}
  #overlay.open{display:flex}
  #detailBox{background:${DARK ? '#241f2a' : '#fffaf0'};color:${fg};border-radius:16px;
             max-width:920px;width:100%;padding:20px 22px 26px;position:relative;
             box-shadow:0 12px 40px rgba(0,0,0,.35)}
  #detailBox .close{position:absolute;top:12px;right:14px;font:inherit;font-size:13px;
                     cursor:pointer;background:none;border:none;color:${fg};opacity:.7;padding:6px}
  #detailBox .close:hover{opacity:1}
  #detailLayout{display:flex;gap:24px;flex-wrap:wrap}
  #detailArt{flex:0 0 auto;width:280px}
  #detailArt svg{width:100%;height:auto;display:block;
                  background:${paper};border-radius:14px;border:1.5px solid ${DARK ? '#3a3242' : '#e0cfb0'}}
  #detailInfo{flex:1 1 320px;min-width:280px;max-height:76vh;overflow:auto}
  #detailInfo h2{margin:0 0 2px;font-size:17px;font-family:ui-monospace,Menlo,Consolas,monospace}
  #detailInfo .sub{margin:0 0 14px;font-size:12px;opacity:.75}
  .dsec{margin-bottom:14px}
  .dsec h3{font-size:11px;margin:0 0 6px;opacity:.65;font-weight:700;letter-spacing:.04em}
  .drow{display:flex;gap:8px;justify-content:space-between;font-size:12.5px;
        padding:3px 0;border-bottom:1px solid ${DARK ? '#332c3c' : '#eaddc4'}}
  .drow .dk{opacity:.75;flex:0 0 auto}
  .drow .dv{text-align:right;word-break:break-word}
  .swatches{display:flex;gap:5px;flex-wrap:wrap;margin-top:2px}
  .swatch{width:22px;height:22px;border-radius:6px;border:1.5px solid ${DARK ? '#3a3242' : '#e0cfb0'}}
`;
document.head.appendChild(detailStyle);

const overlay = document.createElement('div');
overlay.id = 'overlay';
overlay.innerHTML = `<div id="detailBox"><button type="button" class="close">✕ 閉じる</button><div id="detailLayout"></div></div>`;
document.body.appendChild(overlay);

function closeDetail(): void {
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeDetail(); // 背景クリックで閉じる。箱の中は素通し。
});
overlay.querySelector('.close')!.addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay.classList.contains('open')) closeDetail();
});

/** 0..1 の値を小数2桁で表示する。 */
const numRow = (label: string, v: number): string =>
  `<div class="drow"><span class="dk">${esc(label)}</span><span class="dv">${v.toFixed(2)}</span></div>`;

function openDetail(it: Item): void {
  const p = it.pheno;
  const model = buildRenderModel(p, null, {
    detail: 'full',
    uid: makeUid(it.seed, `${STAGE}:full:detail`),
    genotype: it.genotype,
  });
  const bigSvg = renderCreatureSvg(model, { background: paper, animatable: false });

  // 遺伝形質は visibleTraits() をそのまま使う。ゲーム本体の個体詳細画面
  // （src/ui/screens/detail.ts）と同じ「その段階で見せてよい特徴」の判定を
  // 通しているので、ここだけ別基準で作り直さずに済む。
  const traitsHtml = visibleTraits(p, STAGE)
    .map(
      (t) =>
        `<div class="drow"><span class="dk">${esc(t.label)}${t.notable ? ' ✦' : ''}</span>` +
        `<span class="dv">${esc(t.value)}${t.carrier ? `<br><span style="opacity:.6;font-size:10.5px">保因: ${esc(t.carrier)}</span>` : ''}</span></div>`,
    )
    .join('');

  // 【size・translucency・glow をここに含めない理由】
  //   この 3 つは `visibleTraits()` の「遺伝形質」側に「ふつう」「しっかり」
  //   のような日本語の説明つきで既に出る（ゲーム本体の個体詳細画面と同じ元）。
  //   ここにも生の小数として重ねて出すと、同じ項目が 2 通りの表現で
  //   2 回出てしまい紛らわしい。ここには「遺伝形質」に出ない、
  //   より細かい数値だけを置く。
  const numHtml =
    numRow('縦横比 (ratio)', p.ratio) +
    numRow('ふくよかさ (plump)', p.plump) +
    numRow('左右差 (asymmetry)', p.asymmetry) +
    numRow('目の大きさ (eyeSize)', p.eyeSize) +
    numRow('目の間隔 (eyeSpacing)', p.eyeSpacing) +
    numRow('模様の濃さ (patDensity)', p.patDensity) +
    numRow('模様の大きさ (patScale)', p.patScale) +
    numRow('装飾の量 (decorAmount)', p.decorAmount);

  const sw = (label: string, hex: string): string =>
    `<span class="swatch" style="background:${hex}" title="${esc(label)}: ${hex}"></span>`;
  const paletteHtml =
    `<div class="drow"><span class="dk">配色ファミリー</span><span class="dv">${esc(p.palette.family)}</span></div>` +
    `<div class="drow"><span class="dk">HSL</span><span class="dv">h${Math.round(p.palette.hsl.h)} s${Math.round(p.palette.hsl.s)} l${Math.round(p.palette.hsl.l)}</span></div>` +
    `<div class="swatches">` +
    sw('本体', p.palette.body) +
    sw('陰', p.palette.bodyDark) +
    sw('明', p.palette.bodyLight) +
    sw('腹', p.palette.belly) +
    sw('模様', p.palette.pattern) +
    sw('装飾', p.palette.accent) +
    sw('虹彩', p.palette.iris) +
    sw('頬', p.palette.cheek) +
    sw('インク', p.palette.ink) +
    `</div>`;

  const pr = p.personality;
  const persHtml =
    `<div class="drow"><span class="dk">性格</span><span class="dv">${esc(pr.label)}・${esc(pr.subLabel)}</span></div>` +
    numRow('活発さ', pr.energy) +
    numRow('人懐こさ', pr.affection) +
    numRow('好奇心', pr.curiosity) +
    numRow('甘えん坊', pr.dependence) +
    numRow('食いしんぼう', pr.appetite) +
    numRow('きれい好き', pr.tidiness);

  const rarityHtml =
    `<div class="drow"><span class="dk">希少度</span><span class="dv">${esc(p.rarity.tier)}（${Math.round(p.rarity.score)} 点）</span></div>` +
    (p.rarity.reasons.length
      ? `<div class="drow"><span class="dk">理由</span><span class="dv">${p.rarity.reasons.map(esc).join('・')}</span></div>`
      : '');

  const issuesHtml = it.issues.length
    ? `<div class="dsec"><h3>自動検査</h3><div class="drow"><span class="dk" style="color:#e2604a">問題あり</span><span class="dv">${it.issues.map(esc).join(' / ')}</span></div></div>`
    : '';

  overlay.querySelector('#detailLayout')!.innerHTML =
    `<div id="detailArt">${bigSvg}</div>` +
    `<div id="detailInfo">` +
    `<h2>${esc(it.seed)}</h2>` +
    `<p class="sub">${esc(p.baseLabel)} ・ ${STAGE === 'egg' ? 'たまご' : STAGE === 'juvenile' ? 'ようたい' : 'せいたい'}</p>` +
    issuesHtml +
    `<div class="dsec"><h3>遺伝形質</h3>${traitsHtml}</div>` +
    `<div class="dsec"><h3>希少度</h3>${rarityHtml}</div>` +
    `<div class="dsec"><h3>配色</h3>${paletteHtml}</div>` +
    `<div class="dsec"><h3>性格</h3>${persHtml}</div>` +
    `<div class="dsec"><h3>その他の数値（遺伝形質に出ないもの）</h3>${numHtml}</div>` +
    `</div>`;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  overlay.scrollTop = 0;
}

const itemBySeed = new Map(items.map((it) => [it.seed, it]));
grid.style.cursor = 'default';
grid.addEventListener('click', (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>('.cell');
  if (!cell) return;
  const seed = cell.dataset.seed;
  const it = seed ? itemBySeed.get(seed) : undefined;
  if (it) openDetail(it);
});
