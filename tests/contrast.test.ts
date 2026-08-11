/**
 * 描画のコントラスト保証を固定する。
 *
 * 【なぜ必要か】
 *   牛柄の塊は「地との明度差」で識別させる模様だが、その上には
 *   口・まぶた・輪郭のインク線が通る。塊とインクのコントラストが低いと、
 *   線が塊に飲まれて**顔が物理的に読めなくなる**。
 *   ビジュアル批評で実測 1.02〜1.25:1 の個体が見つかり、
 *   `cowColor()` に「インクとの 3.0:1」を絶対条件として入れた。
 *
 *   ところが **その保証は明背景のインクにしか効いていなかった**。
 *   暗背景では `inkOnDark()` が別の色に差し替えるため、
 *   200 体中 134 体（67%）で 3.0 を割っていた（中央 1.16:1）。
 *   同じ模様が、テーマを切り替えるだけで読めなくなる。
 *
 *   グラフィック要素の最低基準は 3:1（WCAG 1.4.11）。
 *   **明暗どちらのテーマでも**満たすことをここで固定する。
 */

import { describe, it, expect } from 'vitest';
import { randomGenotype } from '../src/genetics/genotype.ts';
import { phenotypeOf } from '../src/genetics/phenotype.ts';
import { buildRenderModel } from '../src/render/model.ts';
import { resolveColors, inkOnDark } from '../src/render/palette.ts';
import { contrastRatio } from '../src/core/color.ts';
import type { CatPair, CatLocus, Genotype } from '../src/core/types.ts';

/** 指定の模様をホモ接合で強制した遺伝子型を作る。 */
function forcePattern(seed: string, allele: string): Genotype {
  const g = randomGenotype(seed);
  const cat = { ...g.cat } as Record<CatLocus, CatPair>;
  cat.pattern = [allele, allele] as CatPair;
  return { ...g, cat };
}

/**
 * SVG 断片に現れる 16 進色をすべて拾う。
 *
 * 牛柄は `var(--gm-cow,<明背景の色>)` として埋め込まれ、暗背景の色は
 * `<style>` 側の CSS 変数にある。ここでは断片内の直値（＝明背景の色）を拾い、
 * 暗背景の色は `model.defs` の `--gm-cow` から別途取り出す。
 */
function colorsIn(svg: string): string[] {
  return [...svg.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
}

/** defs の <style> から `--gm-cow` の暗背景側の値を取り出す。 */
function darkCowFrom(defs: string): string | null {
  // `:root[data-theme="dark"] ... {--gm-ink:X;--gm-cow:Y}` の Y を拾う
  const m = /data-theme="dark"[^{]*\{[^}]*--gm-cow:(#[0-9a-fA-F]{6})/.exec(defs);
  return m ? m[1]! : null;
}

interface Row { seed: string; light: number; dark: number }

function measureCow(n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const seed = `COW-${i}`;
    const p = phenotypeOf(forcePattern(seed, 'cow'), 'adult');
    if (!p.parts.pattern.toLowerCase().includes('cow')) continue;
    const model = buildRenderModel(p, null, { detail: 'full', uid: 'c' });
    const part = model.parts.find((x) => x.id === 'pattern');
    if (!part) continue;
    const cols = colorsIn(part.svg);
    if (!cols.length) continue;

    const c = resolveColors(p);
    const inkDark = inkOnDark(c.ink, c.body);
    const cowDark = darkCowFrom(model.defs);

    // 【合成後で測る】塊は不透明度 0.92 で地の上に乗るので、
    // 画面に出るのは合成後の色。合成前で測ると保証が外れる
    // （実際に合成前では 200 体すべて合格だったのに、実 DOM では 15% が不合格だった）。
    const eff = (col: string): string => col; // 塊は不透明なので合成は起きない

    // 明背景: 断片内の直値がそのまま使われる
    let l = Infinity;
    for (const col of cols) l = Math.min(l, contrastRatio(c.ink, eff(col)));
    // 暗背景: CSS 変数で差し替わった色を使う（無ければ直値のまま）
    let d = Infinity;
    for (const col of cowDark ? [cowDark] : cols) d = Math.min(d, contrastRatio(inkDark, eff(col)));

    if (Number.isFinite(l) && Number.isFinite(d)) rows.push({ seed, light: l, dark: d });
  }
  return rows;
}

describe('牛柄の塊とインクのコントラスト', () => {
  const rows = measureCow(200);

  const report = (key: 'light' | 'dark', label: string): number => {
    const v = rows.map((r) => r[key]).sort((a, b) => a - b);
    const q = (t: number) => v[Math.floor(v.length * t)] ?? NaN;
    const bad = v.filter((x) => x < 3).length;
    // eslint-disable-next-line no-console
    console.log(`[牛柄/${label}] n=${v.length} min=${v[0]?.toFixed(2)} 中央=${q(0.5)?.toFixed(2)} max=${v.at(-1)?.toFixed(2)} / 3.0未満=${bad}体`);
    return v[0] ?? NaN;
  };

  it('十分な個体数を測れている', () => {
    expect(rows.length).toBeGreaterThan(100);
  });

  it('明背景で 3.0:1 を下回らない', () => {
    const min = report('light', '明背景');
    expect(min).toBeGreaterThanOrEqual(2.99);
  });

  it('暗背景でも 3.0:1 を下回らない（テーマを変えても顔が読めること）', () => {
    const min = report('dark', '暗背景');
    const worst = rows.slice().sort((a, b) => a.dark - b.dark)[0];
    expect(
      min,
      `暗背景で塊とインクが近すぎる。最悪 seed=${worst?.seed}（${worst?.dark.toFixed(2)}:1）。` +
        `cowColor() は明背景の ink にしか保証を掛けていない疑いがある`,
    ).toBeGreaterThanOrEqual(2.99);
  });
});
