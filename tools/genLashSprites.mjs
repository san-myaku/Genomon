/**
 * `art/eyelashes_sprite.svg`（製品オーナーが用意したまつげの原画）から
 * `src/render/parts/lashSprites.ts` を生成する。
 *
 *   node tools/genLashSprites.mjs
 *
 * 【なぜ原画をそのまま読み込まないのか】
 *   原画は 1px 刻みの直線（M/L/Z）で描かれた 63,698 文字のポリラインで、
 *   これを 100 体分の SVG へそのまま流し込むと DOM が肥大する。
 *   Douglas-Peucker で間引くと **7% まで落ちる**（誤差は幅の 0.13%＝
 *   拡大表示でも 1px 未満）ので、間引いた結果を TypeScript の定数として
 *   焼き込む。ビルド時に SVG を import しないので `dist/` にも混ざらない。
 *
 * 【原画を差し替えたら】
 *   `art/eyelashes_sprite.svg` を置き換えて、このスクリプトを再実行する。
 *   `<symbol id="NN_name" viewBox="0 0 W H">` の中に
 *   `<g id="eyelash">` と（あれば）`<g id="highlight">` がある形を前提にしている。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN_FILE = path.join(ROOT, 'art', 'eyelashes_sprite.svg');
const OUT_FILE = path.join(ROOT, 'src', 'render', 'parts', 'lashSprites.ts');

/** 間引きのしきい値（原画の座標系＝幅 900〜1100 のうち何単位ずれてよいか）。 */
const TOL = 1.2;

// ── M/L/Z だけのパスを点列へ ────────────────────────────────
function parsePolys(d) {
  const polys = [];
  let cur = null;
  const re = /([MLZ])([^MLZ]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const nums = (m[2].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (m[1] === 'M') {
      if (cur && cur.length > 2) polys.push(cur);
      cur = [];
      for (let i = 0; i + 1 < nums.length; i += 2) cur.push({ x: nums[i], y: nums[i + 1] });
    } else if (m[1] === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) cur.push({ x: nums[i], y: nums[i + 1] });
    } else {
      if (cur && cur.length > 2) polys.push(cur);
      cur = null;
    }
  }
  if (cur && cur.length > 2) polys.push(cur);
  return polys;
}

// ── Douglas-Peucker ─────────────────────────────────────────
function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  let maxD = -1;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  return simplify(pts.slice(0, idx + 1), tol).slice(0, -1).concat(simplify(pts.slice(idx), tol));
}

// ── 点列 → 相対コマンドのパス文字列（幅を 1 に正規化）────────
function toPath(polys, scale) {
  const r = (v) => String(Math.round(v * 1000) / 1000);
  let out = '';
  for (const poly of polys) {
    let px = 0;
    let py = 0;
    poly.forEach((p, i) => {
      const x = p.x * scale;
      const y = p.y * scale;
      out += i === 0 ? `M${r(x)} ${r(y)}` : `l${r(x - px)} ${r(y - py)}`;
      px = x;
      py = y;
    });
    out += 'Z';
  }
  // "l-0.5" のような並びで区切り記号を省いて短くする
  return out.replace(/l(?=-)/g, 'l').replace(/ (?=-)/g, '');
}

const bboxOf = (polys) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polys) for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
};

/** 幅に対する比 `xFrac` の位置での上端 / 下端 y。まぶたへ載せる基準線に使う。 */
function edgesAt(polys, bb, xFrac) {
  const w = bb.x1 - bb.x0;
  const cx = bb.x0 + w * xFrac;
  const win = w * 0.04;
  let top = Infinity;
  let bot = -Infinity;
  for (const poly of polys) for (const p of poly) {
    if (Math.abs(p.x - cx) > win) continue;
    if (p.y < top) top = p.y;
    if (p.y > bot) bot = p.y;
  }
  return { top, bot };
}

/**
 * インク幅を `PROFILE_N - 1` 等分した位置での上端 / 下端 y の列。
 *
 * 描画側が「目の曲がり」から「原画自身の反り」を差し引くために使う。
 * 引かずに目の曲がりをそのまま与えると、原画の反りと足し合わさって
 * まつげが目を抱え込む（実際にそうなった）。
 */
const PROFILE_N = 9;
function profileOf(polys, bb) {
  const top = [];
  const bot = [];
  for (let i = 0; i < PROFILE_N; i++) {
    const e = edgesAt(polys, bb, i / (PROFILE_N - 1));
    // 端では窓に点が入らないことがある。その場合は隣を引き継ぐ。
    top.push(Number.isFinite(e.top) ? e.top : (top[i - 1] ?? bb.y0));
    bot.push(Number.isFinite(e.bot) ? e.bot : (bot[i - 1] ?? bb.y1));
  }
  return { top, bot };
}

// ── 生成 ────────────────────────────────────────────────────
const src = fs.readFileSync(IN_FILE, 'utf8');
const symRe = /<symbol id="([^"]+)" viewBox="0 0 (\d+) (\d+)">([\s\S]*?)<\/symbol>/g;

const out = [];
let rawTotal = 0;
let newTotal = 0;
let m;
while ((m = symRe.exec(src))) {
  const [, id, wS, , body] = m;
  const w = Number(wS);
  const grab = (gid) => {
    const g = new RegExp(`<g id="${gid}"[^>]*>\\s*<path d="([^"]+)"`).exec(body);
    return g ? g[1] : null;
  };
  const lashD = grab('eyelash');
  const hiD = grab('highlight');
  if (!lashD) throw new Error(`${id}: <g id="eyelash"> が見つからない`);
  rawTotal += lashD.length + (hiD?.length ?? 0);

  const scale = 1 / w;
  const lashPolys = parsePolys(lashD).map((p) => simplify(p, TOL));
  const hiPolys = hiD ? parsePolys(hiD).map((p) => simplify(p, TOL * 0.5)) : [];
  const bb = bboxOf(lashPolys);
  const e35 = edgesAt(lashPolys, bb, 0.35);
  const e50 = edgesAt(lashPolys, bb, 0.5);
  const prof = profileOf(lashPolys, bb);

  const bodyPath = toPath(lashPolys, scale);
  const hiPath = hiPolys.length ? toPath(hiPolys, scale) : '';
  newTotal += bodyPath.length + hiPath.length;

  out.push({
    id,
    box: { x0: bb.x0 * scale, y0: bb.y0 * scale, x1: bb.x1 * scale, y1: bb.y1 * scale },
    top: Math.min(e35.top, e50.top) * scale,
    bot: Math.max(e35.bot, e50.bot) * scale,
    profTop: prof.top.map((v) => v * scale),
    profBot: prof.bot.map((v) => v * scale),
    body: bodyPath,
    highlight: hiPath,
  });
}

const num = (v) => String(Math.round(v * 10000) / 10000);
const lines = out.map((s) => `  '${s.id}': {
    box: { x0: ${num(s.box.x0)}, y0: ${num(s.box.y0)}, x1: ${num(s.box.x1)}, y1: ${num(s.box.y1)} },
    top: ${num(s.top)},
    bot: ${num(s.bot)},
    profTop: [${s.profTop.map(num).join(", ")}],
    profBot: [${s.profBot.map(num).join(", ")}],
    body: '${s.body}',
    highlight: '${s.highlight}',
  },`).join('\n');

const ts = `/**
 * まつげの原画（製品オーナー作画）を焼き込んだ定数。
 *
 * **このファイルは手で編集しない。** \`art/eyelashes_sprite.svg\` を直して
 *
 *     node tools/genLashSprites.mjs
 *
 * で作り直す。生成の経緯と間引きの理由は \`tools/genLashSprites.mjs\` の
 * 冒頭コメントを参照。
 *
 * 座標系: **幅を 1 に正規化**してある（原画の viewBox 幅で割った値）。
 * 縦もその同じ倍率なので縦横比は保たれる。描画側は「このまつげを幅いくつで
 * 置くか」を決めて一様に拡大するだけでよい。
 */

export interface LashSprite {
  /** 幅を 1 としたときの外接矩形（しっぽの跳ねも含む全体）。 */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** 本体中ほどの **上端** y。とじ目型（下まつ毛・おねむ）の基準線に使う。 */
  top: number;
  /** 本体中ほどの **下端** y。上まつ毛をまぶたへ載せるときの基準線に使う。 */
  bot: number;
  /** インク幅を等分した位置での上端 y の列（原画自身の反り）。 */
  profTop: readonly number[];
  /** 同じく下端 y の列。 */
  profBot: readonly number[];
  /** 本体（インクで塗る）。 */
  body: string;
  /** まつげの上に置く白いつや。無い種類は空文字。 */
  highlight: string;
}

export const LASH_SPRITES: Readonly<Record<string, LashSprite>> = {
${lines}
};
`;

fs.writeFileSync(OUT_FILE, ts.replace(/\n/g, '\r\n'));
console.log(`原画 ${rawTotal} 文字 → ${newTotal} 文字 (${(100 * newTotal / rawTotal).toFixed(1)}%, TOL=${TOL})`);
for (const s of out) console.log(`  ${s.id.padEnd(18)} body=${String(s.body.length).padStart(4)}字 top=${num(s.top)} bot=${num(s.bot)} box.y1=${num(s.box.y1)}`);
console.log('wrote', path.relative(ROOT, OUT_FILE));
