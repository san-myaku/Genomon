/**
 * 機能の解放と「次に何をすればよいか」の案内。
 *
 * 【解放の考え方（config.UNLOCK_RULES が正本）】
 *   一度開いた機能は閉じない。閉じると「さっきできたのに」が起きて混乱するため。
 *
 * 【nextObjective（指示書 §25）】
 *   このゲームで最も重要な 1 行。プレイヤーが画面を見て 3 秒以内に
 *   「次に何をすればいいか」が分かるかどうかは、ここが決めている。
 *   どんな状態でも **必ず** 具体的な行き先を返す（null を返さない）。
 *   詰みかけている状態（枠が満杯・コイン不足・機嫌不足）でも、
 *   「どうすれば抜けられるか」を返すのが役目。
 */

import type { GameState } from '../core/types.ts';
import { BREEDING, DECAY, EXHIBITION, SHOP_CHEAPEST_PRICE, UNLOCK_RULES } from './config.ts';
import { canBreed, findBreedablePair } from './breeding.ts';
import { blockedCreatures } from './growth.ts';
import { capacityUsed, creaturesByStage } from './state.ts';

export type Feature = keyof GameState['unlocks'];

// ─────────────────────────────────────────────────────────
//  解放
// ─────────────────────────────────────────────────────────

/** その機能の解放条件を満たしているか。 */
function meetsCondition(state: GameState, feature: Feature): boolean {
  const adults = creaturesByStage(state, 'adult').length;
  switch (feature) {
    case 'nursery':
      return true;
    case 'collection':
      return state.stats.hatched >= UNLOCK_RULES.collection.minHatched;
    case 'exhibition':
      return adults >= UNLOCK_RULES.exhibition.minAdults;
    case 'shop':
      return state.stats.exhibitions >= UNLOCK_RULES.shop.minExhibitions;
    case 'breeding':
      return (
        (!UNLOCK_RULES.breeding.requiresShop || state.unlocks.shop) &&
        adults >= UNLOCK_RULES.breeding.minAdults
      );
    case 'breeder':
      return (
        state.stats.exhibitions >= UNLOCK_RULES.breeder.minExhibitions &&
        state.stats.bred >= UNLOCK_RULES.breeder.minBred &&
        adults >= UNLOCK_RULES.breeder.minAdults
      );
    case 'staff':
      return state.stats.exhibitions >= UNLOCK_RULES.staff.minExhibitions;
    default:
      return false;
  }
}

const FEATURES: readonly Feature[] = ['nursery', 'collection', 'exhibition', 'shop', 'breeding', 'staff', 'breeder'];

/**
 * 解放条件を再評価し、**新たに** 解放された機能 ID を返す。
 * 既に開いているものは返さない（UI が同じ演出を二度出さないため）。
 */
export function refreshUnlocks(state: GameState): string[] {
  const opened: string[] = [];
  for (const f of FEATURES) {
    if (!state.unlocks[f] && meetsCondition(state, f)) {
      state.unlocks[f] = true;
      opened.push(f);
      if (f === 'breeder') state.breeder.licensed = true;
    }
  }
  // v5 より前のセーブや手動復元で、フラグと実体が片方だけ残っても矛盾させない。
  if (state.unlocks.breeder) state.breeder.licensed = true;
  return opened;
}

/** 未解放機能の解放条件を日本語で説明する（現在の進み具合つき）。 */
export function unlockHint(state: GameState, feature: Feature): string {
  const adults = creaturesByStage(state, 'adult').length;
  switch (feature) {
    case 'nursery':
      return UNLOCK_RULES.nursery.desc;
    case 'collection':
      return state.unlocks.collection
        ? '解放済みです。'
        : `${UNLOCK_RULES.collection.desc}（孵化 ${state.stats.hatched} / ${UNLOCK_RULES.collection.minHatched}）`;
    case 'exhibition':
      return state.unlocks.exhibition
        ? '解放済みです。'
        : `${UNLOCK_RULES.exhibition.desc}（成体 ${adults} / ${UNLOCK_RULES.exhibition.minAdults}）`;
    case 'shop':
      return state.unlocks.shop
        ? '解放済みです。'
        : `${UNLOCK_RULES.shop.desc}（参加 ${state.stats.exhibitions} / ${UNLOCK_RULES.shop.minExhibitions}）`;
    case 'breeding':
      if (state.unlocks.breeding) return '解放済みです。';
      if (!state.unlocks.shop) return `${UNLOCK_RULES.breeding.desc}（まず ショップを 解放しましょう）`;
      return `${UNLOCK_RULES.breeding.desc}（成体 ${adults} / ${UNLOCK_RULES.breeding.minAdults}）`;
    case 'breeder':
      if (state.unlocks.breeder) return '資格取得済みです。販売所を 利用できます。';
      return `${UNLOCK_RULES.breeder.desc}（展示会 ${state.stats.exhibitions}/${UNLOCK_RULES.breeder.minExhibitions}・交配 ${state.stats.bred}/${UNLOCK_RULES.breeder.minBred}・成体 ${adults}/${UNLOCK_RULES.breeder.minAdults}）`;
    case 'staff':
      return state.unlocks.staff
        ? '募集できます。候補者の プロフィールを 比べてください。'
        : `${UNLOCK_RULES.staff.desc}（参加 ${state.stats.exhibitions} / ${UNLOCK_RULES.staff.minExhibitions}）`;
    default:
      return '';
  }
}

// ─────────────────────────────────────────────────────────
//  次の目標
// ─────────────────────────────────────────────────────────

export interface Objective {
  /** ヘッダに出す 1 行。 */
  text: string;
  /** 行き先の画面 ID（ScreenId 相当）。行き先が無い案内では null。 */
  screen: string | null;
  /** 対象の個体（あれば UI が選択状態にする）。 */
  creatureId?: string;
}

/** 世話が必要な状態のうち、いちばん深刻なものを 1 つ返す。 */
function urgentCare(state: GameState): Objective | null {
  const checks: readonly { key: 'health' | 'hunger' | 'hydration' | 'cleanliness' | 'mood'; text: string }[] = [
    { key: 'health', text: 'の 元気が ありません。やすませて あげましょう。' },
    { key: 'hunger', text: 'の おなかが すいています。ごはんを あげましょう。' },
    { key: 'hydration', text: 'が のどを かわかせています。みずを あげましょう。' },
    { key: 'mood', text: 'の 機嫌が わるいようです。なでたり あそんだり しましょう。' },
    { key: 'cleanliness', text: 'が よごれています。きれいに して あげましょう。' },
  ];

  for (const check of checks) {
    let worst = null as null | { id: string; name: string; v: number };
    for (const c of state.creatures) {
      const v = c.life[check.key];
      if (v < DECAY.lowThreshold && (!worst || v < worst.v)) {
        worst = { id: c.id, name: c.name, v };
      }
    }
    if (worst) {
      return { text: `${worst.name}${check.text}`, screen: 'nursery', creatureId: worst.id };
    }
  }
  return null;
}

/**
 * 「次に何をすればよいか」の 1 行ガイド。
 * 上から順に「詰まりかけているもの」→「新しく開いたもの」→「日々の世話」の優先度。
 */
export function nextObjective(state: GameState): Objective {
  // ── 0) 個体がいない：卵を選ぶところから ──
  if (state.creatures.length === 0) {
    return state.pendingEggs && state.pendingEggs.length > 0
      ? { text: `${state.pendingEggs.length} つの 卵から 育てる子を えらびましょう。`, screen: 'eggSelect' }
      : { text: 'まずは 育てる 卵を えらびましょう。', screen: 'eggSelect' };
  }

  // ── 1) 枠が満杯で進行が止まっている：いちばん優先して知らせる ──
  const blocked = blockedCreatures(state);
  const first = blocked[0];
  if (first) {
    return {
      text: `${first.reason} どれかを 手放すか、先に 育ててください。`,
      screen: 'nursery',
      creatureId: first.creature.id,
    };
  }

  // ── 2) 危険な状態の子がいる ──
  const urgent = urgentCare(state);
  if (urgent) return urgent;

  const eggs = creaturesByStage(state, 'egg');
  const juveniles = creaturesByStage(state, 'juvenile');
  const adults = creaturesByStage(state, 'adult');

  // ── 3) はじめての展示会（ショップ解放の鍵）──
  if (adults.length > 0 && state.unlocks.exhibition && state.stats.exhibitions === 0) {
    const best = adults.slice().sort((a, b) => b.life.mood - a.life.mood)[0];
    return {
      text: `${best?.name ?? '成体'} を 展示会に つれて いきましょう。コインが もらえます。`,
      screen: 'exhibition',
      creatureId: best?.id,
    };
  }

  // ── 4) はじめての買い物 ──
  // 展示会でショップが開いた直後は、まず買い物を案内する（開いたばかりの機能を素通りさせない）。
  // 「まだ一度もコインを使っていない」は stats.coinsEarned との差で判定する
  // （購入フラグを別に持たなくても、使った瞬間に coins < coinsEarned になる）。
  const neverSpent = state.stats.coinsEarned <= state.coins;
  if (
    state.unlocks.shop &&
    neverSpent &&
    state.owned.length === 0 &&
    Object.keys(state.inventory).length === 0 &&
    state.coins >= SHOP_CHEAPEST_PRICE
  ) {
    return {
      text: `コインが ${state.coins} まいあります。ショップで 道具を 買って みましょう。`,
      screen: 'shop',
    };
  }

  // ── 5) 交配できる ──
  if (state.unlocks.breeding) {
    const pair = findBreedablePair(state);
    if (pair) {
      return {
        text: `${pair[0].name} と ${pair[1].name} を 交配させて みましょう。`,
        screen: 'breeding',
        creatureId: pair[0].id,
      };
    }
  }

  // ── 6) 交配は解放済みなのに組めない：理由を具体的に返す ──
  // （ここが「詰んだ」と誤解される一歩手前なので、必ず抜け道を示す）
  if (state.unlocks.breeding) {
    if (adults.length >= 2 && adults[0] && adults[1]) {
      const why = canBreed(state, adults[0].id, adults[1].id);
      if (!why.ok && why.reason) {
        const screen = state.coins < BREEDING.costCoins ? 'exhibition' : 'nursery';
        return { text: `交配の じゅんび: ${why.reason}`, screen, creatureId: adults[0].id };
      }
    }
  }

  // 公認資格は「交配を 1 回した後に展示会を 3 回」の順で案内する。
  // 交配可能なときは上の具体的なペア案内を優先し、次の行動が無いときだけ
  // 資格の残り条件を出すことで、目標が抽象的なチェックリストにならないようにする。
  if (state.unlocks.breeding && !state.unlocks.breeder) {
    if (
      state.stats.bred >= UNLOCK_RULES.breeder.minBred &&
      state.stats.exhibitions < UNLOCK_RULES.breeder.minExhibitions
    ) {
      return {
        text: `公認ブリーダーまで、展示会が あと ${UNLOCK_RULES.breeder.minExhibitions - state.stats.exhibitions} 回です。`,
        screen: 'exhibition',
        creatureId: adults[0]?.id,
      };
    }
    if (
      state.stats.exhibitions >= UNLOCK_RULES.breeder.minExhibitions &&
      state.stats.bred < UNLOCK_RULES.breeder.minBred
    ) {
      return {
        text: '公認ブリーダーの資格に向けて、成体 2 体を 交配させましょう。',
        screen: 'breeding',
        creatureId: adults[0]?.id,
      };
    }
  }

  // 飼育員は、展示会 2 回を達成した直後に存在を知らせる。
  if (state.unlocks.staff && state.staff.hiredId === null && state.staff.candidates.length === 0) {
    return { text: '飼育員の 募集が はじまりました。候補者を 比べてみましょう。', screen: 'staff' };
  }

  // ── 7) まだ成体がいない：いちばん育っている子を育てる ──
  if (adults.length === 0) {
    if (juveniles.length > 0) {
      const best = juveniles.slice().sort((a, b) => b.life.growth - a.life.growth)[0];
      return {
        text: `${best?.name ?? '幼体'} を 世話して 成体まで 育てましょう（成長 ${Math.floor(best?.life.growth ?? 0)}%）。`,
        screen: 'nursery',
        creatureId: best?.id,
      };
    }
    const best = eggs.slice().sort((a, b) => b.life.hatchProgress - a.life.hatchProgress)[0];
    return {
      text: `${best?.name ?? '卵'} を 世話して 孵しましょう（孵化 ${Math.floor(best?.life.hatchProgress ?? 0)}%）。`,
      screen: 'nursery',
      creatureId: best?.id,
    };
  }

  // ── 8) 交配の解放まであと少し ──
  if (!state.unlocks.breeding) {
    if (!state.unlocks.shop) {
      return { text: `展示会に 参加すると ショップが 開きます。`, screen: 'exhibition' };
    }
    if (adults.length < UNLOCK_RULES.breeding.minAdults) {
      if (juveniles.length > 0 || eggs.length > 0) {
        const next = juveniles[0] ?? eggs[0];
        return {
          text: `もう 1 体 成体に すると 交配が 開きます。${next?.name ?? ''} を 育てましょう。`,
          screen: 'nursery',
          creatureId: next?.id,
        };
      }
      return {
        text: '交配には 成体が 2 体 ひつようです。展示会で コインを ためましょう。',
        screen: 'exhibition',
      };
    }
  }

  // ── 9) 育てるものがある ──
  if (eggs.length > 0 || juveniles.length > 0) {
    const target =
      juveniles.slice().sort((a, b) => b.life.growth - a.life.growth)[0] ??
      eggs.slice().sort((a, b) => b.life.hatchProgress - a.life.hatchProgress)[0];
    return {
      text: `${target?.name ?? 'ゲノモン'} を 世話して 育てましょう。`,
      screen: 'nursery',
      creatureId: target?.id,
    };
  }

  // ── 10) 平常運転：展示会でコインを稼ぐ ──
  const used = capacityUsed(state);
  const best = adults.slice().sort((a, b) => b.bestScore - a.bestScore)[0];
  if (used.egg === 0 && state.coins < BREEDING.costCoins) {
    return {
      text: `展示会に 出て コインを ためましょう（交配には ${BREEDING.costCoins} コイン）。`,
      screen: 'exhibition',
      creatureId: best?.id,
    };
  }
  return {
    text: `${best?.name ?? '成体'} を 世話して、また 展示会に 出て みましょう（再参加は ${Math.round(
      EXHIBITION.cooldownMs / 60000,
    )} 分ごと）。`,
    screen: 'exhibition',
    creatureId: best?.id,
  };
}
