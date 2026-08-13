import { describe, expect, it } from 'vitest';

import type { Creature, GameState, Genotype } from '../src/core/types.ts';
import {
  CREATURE_NAME_MAX_LENGTH,
  applyTick,
  buyItem,
  newGame,
  refreshUnlocks,
  renameCreature,
  saleQuote,
  sellCreature,
} from '../src/game/index.ts';
import { createCreature } from '../src/game/state.ts';
import { randomGenotype } from '../src/genetics/index.ts';

const T0 = 1_700_000_000_000;

function adult(state: GameState, seed: string): Creature {
  const genotype: Genotype = randomGenotype(seed);
  const c = createCreature(state, genotype, T0, {
    parents: null,
    parentNames: null,
    generation: 1,
    fromBreeding: false,
  });
  c.life.stage = 'adult';
  c.life.growth = 100;
  c.life.hatchProgress = 100;
  c.life.hunger = 80;
  c.life.hydration = 80;
  c.life.cleanliness = 80;
  c.life.mood = 80;
  c.life.health = 90;
  state.creatures.push(c);
  return c;
}

function readyForBreeder(state: GameState): void {
  state.stats.exhibitions = 3;
  state.stats.bred = 1;
  refreshUnlocks(state);
}

describe('非ビジュアル機能', () => {
  it('名前変更を正規化し、重複・危険な入力を拒否する', () => {
    const state = newGame('rename-test');
    const one = adult(state, 'rename-one');
    const two = adult(state, 'rename-two');

    expect(renameCreature(state, one.id, '  こけ　まる  ', T0 + 1)).toEqual({ ok: true, name: 'こけ まる' });
    expect(one.name).toBe('こけ まる');
    expect(state.updatedAt).toBe(T0 + 1);

    expect(renameCreature(state, two.id, 'こけ まる')).toMatchObject({ ok: false });
    expect(renameCreature(state, two.id, '   ')).toMatchObject({ ok: false });
    expect(renameCreature(state, two.id, 'あ'.repeat(CREATURE_NAME_MAX_LENGTH + 1))).toMatchObject({ ok: false });
    expect(renameCreature(state, two.id, 'ok\u0000name')).toMatchObject({ ok: false });
    expect(renameCreature(state, two.id, 42 as unknown as string)).toMatchObject({ ok: false });
  });

  it('許可証を買うと段階別の枠が増え、同じ設備は二重購入できない', () => {
    const state = newGame('capacity-test');
    state.unlocks.shop = true;
    state.stats.exhibitions = 7;
    state.coins = 10_000;

    expect(buyItem(state, 'nurseryPermit2').ok).toBe(true);
    expect(state.capacity).toEqual({ egg: 4, juvenile: 4, adult: 4 });
    expect(buyItem(state, 'nurseryPermit2').ok).toBe(false);
    expect(buyItem(state, 'nurseryPermit3').ok).toBe(true);
    expect(buyItem(state, 'nurseryPermit4').ok).toBe(true);
    expect(state.capacity).toEqual({ egg: 6, juvenile: 6, adult: 6 });
  });

  it('おそうじロボットは清潔度の減少だけを軽減し、他の状態を改変しない', () => {
    const plain = newGame('robot-plain');
    const equipped = newGame('robot-equipped');
    const a = adult(plain, 'robot-shared');
    const b = adult(equipped, 'robot-shared');
    equipped.owned = ['cleaningRobot'];

    applyTick(plain, T0 + 60_000);
    applyTick(equipped, T0 + 60_000);

    expect(b.life.cleanliness).toBeGreaterThan(a.life.cleanliness);
    expect(b.life.hunger).toBe(a.life.hunger);
    expect(b.life.hydration).toBe(a.life.hydration);
    expect(b.life.mood).toBe(a.life.mood);
  });

  it('資格条件を満たすと販売所が開き、売却額の内訳と履歴が保存される', () => {
    const state = newGame('market-test');
    const first = adult(state, 'market-first');
    adult(state, 'market-second');
    adult(state, 'market-third');
    state.activeCreatureId = first.id;
    readyForBreeder(state);

    expect(state.unlocks.breeder).toBe(true);
    expect(state.breeder.licensed).toBe(true);

    const quoted = saleQuote(state, first.id);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) throw new Error(quoted.reason);
    expect(quoted.quote.price).toBeGreaterThan(0);
    expect(quoted.quote.base).toBeGreaterThan(0);
    expect(quoted.quote.conditionBonus).toBeGreaterThanOrEqual(0);

    const beforeCoins = state.coins;
    const sold = sellCreature(state, first.id, T0 + 10_000);
    expect(sold.ok).toBe(true);
    expect(state.creatures).toHaveLength(2);
    expect(state.coins).toBe(beforeCoins + quoted.quote.price);
    expect(state.breeder.sales).toBe(1);
    expect(state.breeder.earnings).toBe(quoted.quote.price);
    expect(state.breeder.history[0]?.creatureName).toBe(first.name);
    expect(state.activeCreatureId).not.toBe(first.id);

    const blocked = sellCreature(state, state.creatures[0]!.id, T0 + 20_000);
    expect(blocked.ok).toBe(false);
    expect(state.creatures).toHaveLength(2);
  });
});
