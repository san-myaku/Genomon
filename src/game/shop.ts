/**
 * ショップ（購入とアイテム使用）。
 *
 * 【消耗品と設備の違い】
 *   consumable: true  … 買うと inventory に入り、個体に使って消える。
 *   consumable: false … 買った時点で owned に入り、以後ずっと効く（装飾・設備）。
 *   API.md の規約どおり、設備は useItem を通さない。
 *
 * 【アイテムの効果に「飽き」を掛けない理由】
 *   飽き・満足は「無料の世話ボタンを連打させない」ための仕組み。
 *   アイテムはコインという別の制限がすでに掛かっているので、二重に絞ると
 *   「買ったのに効かない」という最悪の体験になる。よって効果は満額で入れる。
 *   ただし性格による反応倍率は掛かる（食いしんぼうは よりよく食べる）。
 */

import type { CareAction, CareResult, GameState, ShopItemDef } from '../core/types.ts';
import { SHOP_ITEMS, SHOP_ITEM_BY_ID } from './config.ts';
import { applyEffects, pickSpeech, reactionFor } from './care.ts';
import { advanceStageIfReady } from './growth.ts';
import { getPhenotype } from './phenoCache.ts';
import { findCreature, gameNow, noteNow } from './state.ts';

/**
 * アイテム用の反応倍率。care.ts の表とほぼ同じだが、'full' だけ甘くしてある。
 * 無料の世話なら「満腹だから効かない」でよいが、コインを払った品が
 * ほぼ無駄になるのは理不尽なので 6 割は残す。
 */
const REACTION_MULT: Readonly<Record<CareResult['reaction'], number>> = {
  delighted: 1.18,
  happy: 1.0,
  neutral: 0.92,
  sleepy: 0.85,
  dislike: 0.72,
  // アイテムは「満腹でも無駄にならない」。買ったものが消えるだけ、は理不尽なので 6 割は残す。
  full: 0.6,
};

/** その商品の解放条件（展示会の参加回数）を満たしているか。 */
function meetsRequirement(state: GameState, item: ShopItemDef): boolean {
  const need = item.requires?.exhibitions ?? 0;
  return state.stats.exhibitions >= need;
}

/**
 * 現在購入可能な商品。
 * 買い切りの装飾・設備は、購入済みなら一覧から消す（二重購入を防ぐ）。
 */
export function availableItems(state: GameState): ShopItemDef[] {
  return SHOP_ITEMS.filter((item) => {
    if (!meetsRequirement(state, item)) return false;
    if (!item.consumable && state.owned.includes(item.id)) return false;
    return true;
  });
}

/** まだ解放されていない商品（「もうすぐ入荷」表示用）。 */
export function lockedItems(state: GameState): { item: ShopItemDef; hint: string }[] {
  return SHOP_ITEMS.filter((item) => !meetsRequirement(state, item)).map((item) => ({
    item,
    hint: `展示会に あと ${(item.requires?.exhibitions ?? 0) - state.stats.exhibitions} 回 出ると 入荷します。`,
  }));
}

export function buyItem(state: GameState, itemId: string): { ok: boolean; reason?: string } {
  const item = SHOP_ITEM_BY_ID[itemId];
  if (!item) return { ok: false, reason: 'その商品は ありません。' };

  if (!state.unlocks.shop) {
    return { ok: false, reason: 'ショップは まだ 解放されていません。展示会に 参加しましょう。' };
  }
  if (!meetsRequirement(state, item)) {
    const need = (item.requires?.exhibitions ?? 0) - state.stats.exhibitions;
    return { ok: false, reason: `まだ 入荷していません（展示会に あと ${need} 回）。` };
  }
  if (!item.consumable && state.owned.includes(item.id)) {
    return { ok: false, reason: `「${item.name}」は すでに 持っています。` };
  }
  if (state.coins < item.price) {
    return {
      ok: false,
      reason: `コインが ${item.price - state.coins} まい たりません（所持 ${state.coins} / 価格 ${item.price}）。`,
    };
  }

  state.coins -= item.price;
  if (item.consumable) {
    state.inventory[item.id] = (state.inventory[item.id] ?? 0) + 1;
  } else {
    state.owned.push(item.id);
  }
  state.updatedAt = gameNow();
  return { ok: true };
}

/** 商品の効果から、反応と台詞に使う「世話の種類」を決める。 */
function proxyAction(item: ShopItemDef): CareAction {
  const e = item.effect ?? {};
  if (e.hunger) return 'feed';
  if (e.hydration) return 'water';
  if (e.cleanliness) return 'clean';
  if (e.health) return 'rest';
  if (e.mood) return 'pet';
  return 'talk';
}

/** 消耗品を個体に使う。 */
export function useItem(
  state: GameState,
  creatureId: string,
  itemId: string,
  now: number,
): CareResult {
  noteNow(now);

  const fail = (reason: string): CareResult => ({
    ok: false,
    reason,
    reaction: 'neutral',
    speech: '',
    deltas: {},
  });

  const item = SHOP_ITEM_BY_ID[itemId];
  if (!item) return fail('その道具は ありません。');
  if (!item.consumable) return fail(`「${item.name}」は 育成室に かざるものです。`);

  const have = state.inventory[itemId] ?? 0;
  if (have <= 0) return fail(`「${item.name}」を 持っていません。`);

  const c = findCreature(state, creatureId);
  if (!c) return fail('その子が 見つかりません。');

  if (item.target !== 'any' && item.target !== c.life.stage) {
    return fail(`「${item.name}」は ${item.target === 'egg' ? 'たまご' : item.target === 'juvenile' ? '幼体' : '成体'} 専用です。`);
  }

  const action = proxyAction(item);
  const reaction = reactionFor(action, getPhenotype(c).personality, c.life);
  const deltas = applyEffects(c, item.effect ?? {}, REACTION_MULT[reaction]);

  // 在庫を減らす。0 になったキーは残さない（セーブが太らない）。
  const left = have - 1;
  if (left > 0) state.inventory[itemId] = left;
  else delete state.inventory[itemId];

  c.life.careCount += 1;
  const speech = pickSpeech(c, action, reaction, c.life.careCount);

  const change = advanceStageIfReady(state, c, now);
  state.updatedAt = now;

  const result: CareResult = { ok: true, reaction, speech, deltas };
  if (change.evolved) result.evolved = change.evolved;
  if (change.blocked) result.reason = change.blocked;
  return result;
}

/** 所持している設備・装飾の passive をまとめる（tick が使う）。 */
export function ownedPassives(state: GameState): {
  growthRate: number;
  moodDecay: number;
  hungerDecay: number;
  hatchRate: number;
  healthRegen: number;
} {
  const sum = { growthRate: 0, moodDecay: 0, hungerDecay: 0, hatchRate: 0, healthRegen: 0 };
  for (const id of state.owned) {
    const p = SHOP_ITEM_BY_ID[id]?.passive;
    if (!p) continue;
    sum.growthRate += p.growthRate ?? 0;
    sum.moodDecay += p.moodDecay ?? 0;
    sum.hungerDecay += p.hungerDecay ?? 0;
    sum.hatchRate += p.hatchRate ?? 0;
    sum.healthRegen += p.healthRegen ?? 0;
  }
  return sum;
}

/**
 * passive の合計を倍率に変える（API.md 規約 1）。
 *   倍率 = 1 + Σpassive、下限 0.1。
 */
export function passiveMultiplier(sum: number): number {
  return Math.max(0.1, 1 + sum);
}
