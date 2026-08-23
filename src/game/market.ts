/**
 * 公認ブリーダーの販売所。
 *
 * オンライン市場（GameState.future）とは分けた、ローカルゲーム内の売買。
 * 売却額は seed 由来の見た目を再抽選せず、現在の段階・状態・展示実績から
 * 決定論的に見積もる。売る前に内訳を返すので、プレイヤーが「なぜこの額か」
 * を確認でき、ゲーム内経済のテストも純粋な参照として行える。
 *
 * 【鑑定していない個体の値づけ】
 *   未鑑定のあいだ、市場は **観察できる情報だけ** で値を付ける
 *   （姿・体調・展示実績・世代）。`rarity.score` のような、鑑定して初めて
 *   分かる遺伝的な希少度は 1 コインも混ぜない。混ぜると、価格から他の項を
 *   引くだけで隠したはずの希少度が復元できてしまう。詳しくは `saleQuote`
 *   の中のコメントと DESIGN_DECISIONS の D-041。
 */

import type { Creature, GameState, SaleRecord, Stage } from '../core/types.ts';
import { MARKET, UNLOCK_RULES } from './config.ts';
import { isAppraised, observedSignal } from './grading.ts';
import { getPhenotype } from './phenoCache.ts';
import { findCreature, MIN_KEEP_CREATURES, noteNow } from './state.ts';

export interface SaleQuote {
  creatureId: string;
  creatureName: string;
  stage: Stage;
  price: number;
  base: number;
  conditionBonus: number;
  /** 姿から見て取れる目立つ点への上乗せ。鑑定の有無によらず付く。 */
  observedBonus: number;
  /** 遺伝的な希少度への上乗せ。**未鑑定では必ず 0**。 */
  rarityBonus: number;
  exhibitionBonus: number;
  generationBonus: number;
  /** この見積もりが鑑定書つきの評価かどうか。UI が内訳を出し分けるのに使う。 */
  appraised: boolean;
}

export type SaleQuoteResult =
  | { ok: true; quote: SaleQuote; creature: Creature }
  | { ok: false; reason: string };

export type SellResult =
  | { ok: true; quote: SaleQuote; record: SaleRecord }
  | { ok: false; reason: string };

/**
 * 売却の可否と査定内訳を返す。state を変更しない。
 */
export function saleQuote(state: GameState, creatureId: string): SaleQuoteResult {
  if (!state.unlocks.breeder || !state.breeder.licensed) {
    return {
      ok: false,
      reason: `${UNLOCK_RULES.breeder.label}の資格が まだありません。条件を 満たしてから 申請できます。`,
    };
  }

  const creature = findCreature(state, creatureId);
  if (!creature) return { ok: false, reason: 'その子は 見つかりませんでした。' };

  // 2 体を残す。ここを販売経路でも共有しないと、標本帳の「手放す」と別の
  // ルートだけが最後の 1 体を消せる進行不能が生まれる。
  if (state.creatures.length <= MIN_KEEP_CREATURES) {
    return {
      ok: false,
      reason: `販売後も ${MIN_KEEP_CREATURES} 体は 残してください。交配を 続けるための 最低数です。`,
    };
  }

  const stage = creature.life.stage;
  const pheno = getPhenotype(creature, stage);
  const base = MARKET.basePrice[stage];
  const conditionValue =
    stage === 'egg'
      ? (creature.life.hatchProgress + creature.life.cleanliness) / 2
      : stage === 'juvenile'
        ? (creature.life.growth + creature.life.health + creature.life.cleanliness) / 3
        : (creature.life.health + creature.life.cleanliness + creature.life.mood) / 3;
  const conditionBonus = Math.round(conditionValue * 0.6);

  // ── 鑑定書が無いと、市場も潜在的な遺伝価値を評価できない（D-041） ──
  //
  //   以前は `rarity.score`（保因・接合状態まで含んだ、鑑定して初めて
  //   分かる値）を常に価格へ入れ、**表示上の内訳だけ** 1 本にまとめて
  //   隠していた。これでは足りない。価格そのものが rarity の単調増加
  //   関数なので、他の項（段階・体調ゲージ・最高得点・世代）はすべて
  //   画面に出ており、引き算すれば希少度が復元できる。
  //
  //   計算そのものを分ける。未鑑定のあいだ市場が見るのは、
  //   プレイヤーと同じく **姿・体調・展示実績・世代** だけ。
  const appraised = isAppraised(creature);
  const observedBonus = Math.round(observedSignal(pheno) * MARKET.observedRate);
  const rarityBonus = appraised
    ? Math.round(Math.max(0, pheno.rarity.score) * MARKET.rarityRate)
    : 0;

  const exhibitionBonus = Math.round(Math.max(0, creature.bestScore) * MARKET.bestScoreRate);
  const generationBonus = Math.min(80, Math.max(0, creature.generation - 1) * MARKET.generationBonus);
  const price = Math.max(
    40,
    Math.round(
      (base + conditionBonus + observedBonus + rarityBonus + exhibitionBonus + generationBonus) / 10,
    ) * 10,
  );

  return {
    ok: true,
    creature,
    quote: {
      creatureId,
      creatureName: creature.name,
      stage,
      price,
      base,
      conditionBonus,
      observedBonus,
      rarityBonus,
      exhibitionBonus,
      generationBonus,
      appraised,
    },
  };
}

/** 個体を売却し、最低限の履歴とコインを state に反映する。 */
export function sellCreature(state: GameState, creatureId: string, now: number): SellResult {
  noteNow(now);
  const quoted = saleQuote(state, creatureId);
  if (!quoted.ok) return quoted;

  const { creature, quote } = quoted;
  const index = state.creatures.findIndex((c) => c.id === creatureId);
  if (index < 0) return { ok: false, reason: 'その子は すでに いなくなっています。' };

  const record: SaleRecord = {
    id: `sale-${state.breeder.sales + 1}-${creature.id}`,
    creatureName: creature.name,
    seed: creature.seed,
    stage: creature.life.stage,
    generation: creature.generation,
    parentNames: creature.parentNames ? [creature.parentNames[0], creature.parentNames[1]] : null,
    bestScore: creature.bestScore,
    exhibitionCount: creature.exhibitionCount,
    price: quote.price,
    soldAt: now,
  };

  state.creatures.splice(index, 1);
  state.coins += quote.price;
  state.breeder.sales += 1;
  state.breeder.earnings += quote.price;
  state.breeder.history.unshift(record);
  if (state.breeder.history.length > MARKET.historyLimit) {
    state.breeder.history.length = MARKET.historyLimit;
  }
  if (state.activeCreatureId === creatureId) {
    state.activeCreatureId = state.creatures[0]?.id ?? null;
  }
  state.updatedAt = now;

  return { ok: true, quote, record };
}
