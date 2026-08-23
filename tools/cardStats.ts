/**
 * カードに載る「分布」を実測する道具。
 *
 *   npx vite-node tools/cardStats.ts            # 既定 1000 体
 *   npx vite-node tools/cardStats.ts -- 4000    # 体数を指定
 *
 * 【何のためにあるか】
 *   フレーバーの重複感と希少度ランクの出現率は、**読んだ印象では判断できない**。
 *   「またこの文だ」は数百枚めくって初めて出るし、MYTHIC が当たりに感じるかは
 *   出現率そのもので決まる。実装を変えたら必ずここで測り直す。
 *
 * 【テストとの役割分担】
 *   `tests/grading.test.ts` は回帰を止めるための下限（最頻 x% 未満など）を見る。
 *   こちらは **数字を読んで判断する** ための道具なので、閾値を持たない。
 *   サンプル文も出すので、機械的な組み合わせが混ざっていないか目でも読める。
 */

import { randomGenotype } from '../src/genetics/genotype.ts';
import { phenotypeOf } from '../src/genetics/phenotype.ts';
import { deriveFlavorText, flavorCandidateCount } from '../src/game/flavor.ts';
import { CARD_RANKS, rankOfScore } from '../src/dev/cardRarity.ts';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 1000);

const flavorCounts = new Map<string, number>();
const kindCounts = new Map<string, number>();
const rankCounts = new Map<string, number>();
const samples: string[] = [];
let minCandidates = Infinity;
let minCandidateSeed = '';
let lenSum = 0;
let lenMax = 0;

for (let i = 0; i < N; i++) {
  const seed = `stats-${i}`;
  const pheno = phenotypeOf(randomGenotype(seed), 'adult');
  const flavor = deriveFlavorText(pheno);

  flavorCounts.set(flavor.text, (flavorCounts.get(flavor.text) ?? 0) + 1);
  kindCounts.set(flavor.kind, (kindCounts.get(flavor.kind) ?? 0) + 1);
  rankCounts.set(rankOfScore(pheno.rarity.score).id, (rankCounts.get(rankOfScore(pheno.rarity.score).id) ?? 0) + 1);

  const { specific } = flavorCandidateCount(pheno);
  if (specific < minCandidates) {
    minCandidates = specific;
    minCandidateSeed = seed;
  }
  lenSum += flavor.text.length;
  lenMax = Math.max(lenMax, flavor.text.length);
  if (i % Math.max(1, Math.floor(N / 60)) === 0 && samples.length < 60) {
    samples.push(`[${flavor.kind}] ${flavor.text}`);
  }
}

const sorted = [...flavorCounts.entries()].sort((a, b) => b[1] - a[1]);
const pct = (n: number): string => `${((n / N) * 100).toFixed(2)}%`;

console.log(`\n══ フレーバー（${N} 体）══`);
console.log(`  ユニーク文数        ${flavorCounts.size}`);
console.log(`  最頻の 1 文         ${pct(sorted[0]![1])}  「${sorted[0]![0]}」`);
console.log(`  上位 10 文の占有率  ${pct(sorted.slice(0, 10).reduce((a, x) => a + x[1], 0))}`);

let acc = 0;
let half = 0;
for (const [, n] of sorted) {
  acc += n;
  half++;
  if (acc >= N / 2) break;
}
console.log(`  半数を占める文の数  ${half} 種類`);
console.log(`  1 回だけ出た文      ${sorted.filter(([, n]) => n === 1).length} 種類`);
console.log(`  平均の長さ          ${(lenSum / N).toFixed(1)} 文字（最長 ${lenMax}）`);
console.log(`  候補が最も少ない個体 ${minCandidates} 本（seed ${minCandidateSeed}）`);

console.log(`\n── 見出しの分布 ──`);
for (const [k, n] of [...kindCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(14)} ${pct(n)}`);
}

console.log(`\n══ 希少度ランク（${N} 体）══`);
for (const def of CARD_RANKS) {
  console.log(`  ${def.label.padEnd(12)} ${pct(rankCounts.get(def.id) ?? 0).padStart(7)}  (score >= ${def.minScore})`);
}

console.log(`\n══ サンプル（目で読む用）══`);
for (const s of samples) console.log(`  ${s}`);
console.log('');
