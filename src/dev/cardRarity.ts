/**
 * 希少度 → カードの「格」と素材。
 *
 * 【この層が独立している理由】
 *   「RARITY 92.4」という数字だけでは、カードを見た瞬間の「うわ、これ」に
 *   ならない。格は **4 層** で伝える:
 *
 *     1. ランク名        MYTHIC
 *     2. 正確な点数      92.4
 *     3. 一目で読む記号  ◆◆◆◆◆
 *     4. 素材そのもの    箔・認証印・縁・地紋が段ごとに違う
 *
 *   4 のために、rarity → 見た目の対応表を **1 か所** に閉じ込める。
 *   文字色だけを変える実装にすると、並べたときに段の差が出ない。
 *
 * 【名前を差し替えやすくしてある】
 *   ランク名は仮のもの（製品オーナーの決定待ち）。`CARD_RANKS` の `label` /
 *   `labelJa` を書き換えるだけで、画面・カード・テストのすべてが追随する。
 *   コード中に 'MYTHIC' という文字列を散らさないこと。
 *
 * 【しきい値の出どころ — 実測して決めた】
 *   `pheno.rarity.score` を 4000 体で測った分布（中央値 22 / p90 37 /
 *   p95 46 / p99 61 / p99.9 79）に対して、
 *   おおよそ 50% / 40% / 6% / 2.5% / 0.6% になるよう置いてある。
 *   MYTHIC が 100 体に 1 体も出ないことが、当たりの手ざわりを作る。
 *   実際の出現率は `npx vite-node tools/cardStats.ts` で測り直せる。
 *
 * 【Cards Lab の強制表示について】
 *   美術研究のため、Lab では段を強制できる（§19）。強制は
 *   **見た目の指定でしかなく、遺伝データには一切触れない**。
 *   `forcedRankPreviewScore()` が返すのも「その段らしい点数」であって、
 *   個体の本当の `rarity.score` は別に保持したまま画面へ出す。
 */

import { Rng } from '../core/rng.ts';
import type { CardFinish } from './cardModel.ts';

// ─────────────────────────────────────────────────────────
//  段
// ─────────────────────────────────────────────────────────

export type CardRank = 'standard' | 'notable' | 'rare' | 'exceptional' | 'mythic';

/**
 * 認証印の素材。紙に押したインク → 箔押し → ホロ箔押し、と進化する。
 * この並びそのものが「格」の視覚言語になっている（§8）。
 */
export type SealMaterial = 'ink' | 'inkFoil' | 'silver' | 'gold' | 'holo';

/** 箔を掛けてよい場所。ここに無いもの（ゲノモン本体・本文）へは掛けない。 */
export type FoilZone = 'border' | 'logo' | 'rank' | 'seal' | 'security' | 'background';

export interface CardRankDef {
  id: CardRank;
  /** カードに刷る名前。差し替え可（コード中に直書きしないこと）。 */
  label: string;
  /** Cards Lab の操作パネルに出す日本語。 */
  labelJa: string;
  /** この段の下限スコア（含む）。 */
  minScore: number;
  /** 一目で読む記号の数（◆ の数）。1..5。 */
  pips: number;
  /** Finish を AUTO にしたときの仕上げ。 */
  finish: CardFinish;
  /** 箔の総量。デザイン側の遠慮係数に掛ける。 */
  foil: number;
  seal: SealMaterial;
  /** 箔を許す場所。 */
  zones: readonly FoilZone[];
  /** 地紋（DNA）の濃さ 0..1。0 なら層そのものを作らない。 */
  security: number;
  /** 背景（後光・粒）の押し出し 0..1。 */
  backdrop: number;
  /** 縁の材質。 */
  edge: 'flat' | 'hairline' | 'metal' | 'metalDouble' | 'prism';
  /** ランク帯の質感。 */
  band: 'flat' | 'shine' | 'metal' | 'metalGlow' | 'spectral';
  /** Cards Lab の説明文（この段で何が変わるか）。 */
  note: string;
}

/**
 * 段の定義。**並び順が段の順序**（上へ行くほど高い）。
 * `minScore` は降順でなく昇順に並べ、`rankOfScore` は後ろから見る。
 */
export const CARD_RANKS: readonly CardRankDef[] = [
  {
    id: 'standard',
    label: 'STANDARD',
    labelJa: '標準',
    minScore: 0,
    pips: 1,
    finish: 'standard',
    foil: 0,
    seal: 'ink',
    zones: [],
    security: 0,
    backdrop: 0.5,
    edge: 'flat',
    band: 'flat',
    note: 'つや消しの黒。箔はゼロ、認証印は紙に押したインク。ここが基準の手ざわり。',
  },
  {
    id: 'notable',
    label: 'NOTABLE',
    labelJa: '注目',
    minScore: 24,
    pips: 2,
    finish: 'silver',
    foil: 0.3,
    seal: 'inkFoil',
    zones: ['logo', 'rank'],
    security: 0,
    backdrop: 0.68,
    edge: 'hairline',
    band: 'shine',
    note: 'ロゴと段の帯だけがわずかに光る。縁は髪の毛ほどの線。印はインクのまま、縁だけ箔。',
  },
  {
    id: 'rare',
    label: 'RARE',
    labelJa: '希少',
    minScore: 38,
    pips: 3,
    finish: 'silver',
    foil: 0.62,
    seal: 'silver',
    zones: ['border', 'logo', 'rank', 'seal'],
    security: 0.4,
    backdrop: 0.85,
    edge: 'metal',
    band: 'metal',
    note: '銀箔。縁・ロゴ・段の帯・認証印まで金属になる。地紋がうっすら入る。',
  },
  {
    id: 'exceptional',
    label: 'EXCEPTIONAL',
    labelJa: '傑出',
    minScore: 50,
    pips: 4,
    finish: 'gold',
    // 【MYTHIC より派手にしない】
    //   金は color-dodge で面ごと持ち上がるので、prism より強く出やすい。
    //   0.85 では EXCEPTIONAL のほうが「当たり」に見えて段が逆転した。
    foil: 0.68,
    seal: 'gold',
    zones: ['border', 'logo', 'rank', 'seal', 'security', 'background'],
    security: 0.7,
    backdrop: 1,
    edge: 'metalDouble',
    band: 'metalGlow',
    note: '金／オーロラ。背景にも箔が回り、地紋がはっきり出る。認証印は金属箔。',
  },
  {
    id: 'mythic',
    label: 'MYTHIC',
    labelJa: '神話級',
    minScore: 65,
    pips: 5,
    finish: 'prism',
    foil: 1,
    seal: 'holo',
    zones: ['border', 'logo', 'rank', 'seal', 'security', 'background'],
    security: 1,
    backdrop: 1.15,
    edge: 'prism',
    band: 'spectral',
    note: 'プリズム。地紋が多層になり、認証印そのものがホログラム箔になる。',
  },
];

export const CARD_RANK_BY_ID: Readonly<Record<CardRank, CardRankDef>> = Object.fromEntries(
  CARD_RANKS.map((r) => [r.id, r]),
) as Record<CardRank, CardRankDef>;

/** 実データの点数から段を決める。 */
export function rankOfScore(score: number): CardRankDef {
  for (let i = CARD_RANKS.length - 1; i >= 0; i--) {
    const def = CARD_RANKS[i]!;
    if (score >= def.minScore) return def;
  }
  return CARD_RANKS[0]!;
}

/** その段の上限（次の段の下限 - 1）。最上段は 100。 */
export function rankMaxScore(rank: CardRank): number {
  const i = CARD_RANKS.findIndex((r) => r.id === rank);
  const next = CARD_RANKS[i + 1];
  return next ? next.minScore - 1 : 100;
}

/**
 * 強制表示のときにカードへ出す「その段らしい点数」。
 *
 * 【遺伝データには触れない】
 *   個体の本当の `rarity.score` は呼び出し側がそのまま保持する。
 *   ここが返すのは **カード面に刷る数字** だけで、Phenotype も Genotype も
 *   一切変わらない。`tests/cards.test.ts` がそれを機械的に見ている。
 */
export function forcedRankPreviewScore(rank: CardRank, seed: string): number {
  const def = CARD_RANK_BY_ID[rank];
  const hi = rankMaxScore(rank);
  // 段の中で下寄り〜中ほどに置く（毎回上限だと、段の差が点数で読めない）。
  const rng = new Rng(`${seed}#card:rankpreview:${rank}`);
  return Math.round(def.minScore + (hi - def.minScore) * rng.float(0.25, 0.85));
}

// ─────────────────────────────────────────────────────────
//  段 → 実際に使う値
// ─────────────────────────────────────────────────────────

/** 画面へ出すために解決済みの「このカードの格」。 */
export interface RankTreatment {
  def: CardRankDef;
  /** カードに刷る点数（強制表示なら仮の点数）。 */
  score: number;
  /** 強制表示か（Cards Lab の視覚オーバーライド）。 */
  forced: boolean;
  /** 個体の本当の点数。強制していてもここは実データのまま。 */
  trueScore: number;
}

export function resolveRank(trueScore: number, override: CardRank | 'auto', seed: string): RankTreatment {
  if (override === 'auto') {
    return { def: rankOfScore(trueScore), score: trueScore, forced: false, trueScore };
  }
  return {
    def: CARD_RANK_BY_ID[override],
    score: forcedRankPreviewScore(override, seed),
    forced: true,
    trueScore,
  };
}

export function hasZone(def: CardRankDef, zone: FoilZone): boolean {
  return def.zones.includes(zone);
}

/** 記号の並び（◆◆◆◇◇）。埋まっている数が段そのもの。 */
export function pipText(def: CardRankDef): string {
  return '◆'.repeat(def.pips) + '◇'.repeat(CARD_RANKS.length - def.pips);
}

/**
 * 記号の並びを、埋まっている側だけ光らせられる形にしたもの。
 *
 * 【ここに markup があることについて】
 *   この層は本来データだけを持つが、記号の「埋まり／空き」は
 *   段そのものの表現なので、表・裏・比較のどこで出しても同じ形に
 *   なってほしい。表示側で数え直すと、片方だけ数を間違える。
 *   `pipText` は読み上げ・素の文字が要る場所（裏面の要約）用に残してある。
 */
export function pipHtml(def: CardRankDef): string {
  const on = '<i class="on" aria-hidden="true">◆</i>'.repeat(def.pips);
  const off = '<i aria-hidden="true">◇</i>'.repeat(CARD_RANKS.length - def.pips);
  return on + off;
}
