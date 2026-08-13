import { describe, expect, it } from 'vitest';
import {
  FIELD,
  applyTick,
  buyItem,
  chooseEggs,
  cleanDropping,
  cleanField,
  fieldBehaviorFor,
  fieldMotionFor,
  newGame,
  nextDroppingIn,
  placeFieldItem,
  removeFieldItem,
  rollEggChoices,
} from '../src/game/index.ts';

const T0 = 1_700_000_000_000;

function fieldState() {
  const state = newGame('field-test-world');
  const eggs = rollEggChoices(state);
  expect(chooseEggs(state, eggs.slice(0, 3).map((egg) => egg.seed), T0).ok).toBe(true);
  state.field.lastTickAt = T0;
  for (const c of state.creatures) {
    c.life.stage = 'adult';
    c.life.growth = 100;
    c.life.lastTickAt = T0;
    state.field.lastDroppingAge[c.id] = 0;
  }
  return state;
}

describe('飼育フィールド', () => {
  it('複数個体の生活から排泄物が決定論的に生成される', () => {
    const state = fieldState();
    const first = state.creatures[0]!;
    const before = nextDroppingIn(state, first, T0);
    const report = applyTick(state, T0 + FIELD.droppingIntervalMs + FIELD.droppingJitterMs + 1_000);

    expect(report.fieldEvent).toBe(true);
    expect(state.field.droppings.length).toBeGreaterThan(0);
    expect(state.field.droppings.every((drop) => drop.creatureId.length > 0)).toBe(true);
    expect(before).toBeGreaterThan(0);
    expect(state.field.droppings.length).toBeLessThanOrEqual(FIELD.maxDroppings);
    expect(new Set(state.field.droppings.map((drop) => drop.x.toFixed(1))).size).toBeGreaterThan(1);
    expect(new Set(state.field.droppings.map((drop) => drop.y.toFixed(1))).size).toBeGreaterThan(1);
  });

  it('旧セーブの斜め配置を床上の散らばりへ移行する', () => {
    const state = fieldState();
    const first = state.creatures[0]!;
    const second = state.creatures[1]!;
    state.field.droppings = [
      { id: `dropping-${first.id}-1`, creatureId: first.id, x: 18, y: 28, createdAt: T0 },
      { id: `dropping-${second.id}-1`, creatureId: second.id, x: 42, y: 35, createdAt: T0 + 1 },
    ];

    applyTick(state, T0 + 1_000);
    expect(state.field.droppings.every((drop) => drop.x >= 9 && drop.x <= 91)).toBe(true);
    expect(state.field.droppings.every((drop) => drop.y >= 56 && drop.y <= 91)).toBe(true);
    const [a, b] = state.field.droppings;
    expect(a && b).toBeTruthy();
    expect((a!.x - b!.x) ** 2 + (a!.y - b!.y) ** 2).toBeGreaterThanOrEqual(64);
  });

  it('掃除すると排泄物と個体の汚れが回復する', () => {
    const state = fieldState();
    state.field.cleanliness = 36;
    state.field.droppings = [
      { id: 'drop-1', creatureId: state.creatures[0]!.id, x: 20, y: 30, createdAt: T0 },
      { id: 'drop-2', creatureId: state.creatures[1]!.id, x: 70, y: 60, createdAt: T0 },
    ];
    for (const c of state.creatures) c.life.cleanliness = 40;

    const result = cleanField(state, T0 + 1_000);
    expect(result).toMatchObject({ ok: true, cleaned: 2 });
    expect(state.field.droppings).toHaveLength(0);
    expect(state.field.cleanliness).toBeGreaterThan(36);
    expect(state.creatures.every((c) => c.life.cleanliness > 40)).toBe(true);
  });

  it('排泄物を一つだけクリック掃除できる', () => {
    const state = fieldState();
    state.field.cleanliness = 60;
    state.field.droppings = [
      { id: 'drop-click', creatureId: state.creatures[0]!.id, x: 20, y: 30, createdAt: T0 },
      { id: 'drop-keep', creatureId: state.creatures[1]!.id, x: 70, y: 60, createdAt: T0 },
    ];
    const result = cleanDropping(state, 'drop-click', T0 + 1_000);
    expect(result).toMatchObject({ ok: true, cleaned: 1 });
    expect(state.field.droppings.map((drop) => drop.id)).toEqual(['drop-keep']);
    expect(state.field.cleanliness).toBeGreaterThan(60);
  });

  it('おそうじロボットは古い排泄物から自動で片づける', () => {
    const state = fieldState();
    state.owned.push('cleaningRobot');
    state.field.droppings = [
      { id: 'drop-1', creatureId: state.creatures[0]!.id, x: 20, y: 30, createdAt: T0 },
      { id: 'drop-2', creatureId: state.creatures[1]!.id, x: 70, y: 60, createdAt: T0 },
    ];
    state.field.lastRobotCleanAt = T0;

    const report = applyTick(state, T0 + 60_000);
    expect(report.fieldEvent).toBe(true);
    expect(state.field.droppings).toHaveLength(0);
  });

  it('ショップで買った遊具を空きマスへ置き、外せる', () => {
    const state = fieldState();
    state.unlocks.shop = true;
    state.stats.exhibitions = 1;
    state.coins = 500;

    expect(buyItem(state, 'fieldLog').ok).toBe(true);
    expect(placeFieldItem(state, 'fieldLog', 3, T0 + 2_000).ok).toBe(true);
    expect(placeFieldItem(state, 'fieldLog', 4, T0 + 3_000).ok).toBe(false);
    expect(placeFieldItem(state, 'fieldPond', 3, T0 + 4_000).ok).toBe(false);
    expect(state.field.placements).toHaveLength(1);
    expect(removeFieldItem(state, 'fieldLog', T0 + 5_000).ok).toBe(true);
    expect(state.field.placements).toHaveLength(0);
  });

  it('同じ seed と時刻ならフィールド上の歩行位置も同じ', () => {
    const state = fieldState();
    const c = state.creatures[0]!;
    const atStart = fieldMotionFor(c, T0, 0, state.creatures.length);
    const later = fieldMotionFor(c, T0 + 60_000, 0, state.creatures.length);
    expect(atStart).toEqual(fieldMotionFor(c, T0, 0, state.creatures.length));
    expect(atStart).not.toEqual(later);
    expect(['rest', 'walk', 'run']).toContain(atStart.gait);
    expect([-1, 1]).toContain(atStart.facing);
    expect(atStart.gaitPhaseMs).toBeGreaterThanOrEqual(0);
    expect(atStart.gaitPhaseMs).toBeLessThan(720);

    const routeSamples = [0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000]
      .map((delta) => fieldMotionFor(c, T0 + delta, 0, state.creatures.length).x);
    expect(new Set(routeSamples.map((x) => x.toFixed(2))).size).toBeGreaterThan(2);
  });

  it('同じ体調の連続フレームで歩行位置が瞬間移動しない', () => {
    const state = fieldState();
    const creature = state.creatures[0]!;
    creature.life.health = 40;
    creature.life.mood = 40;
    creature.life.hunger = 40;
    creature.life.hydration = 40;
    creature.life.cleanliness = 40;

    let previous = fieldMotionFor(creature, T0, 0, state.creatures.length);
    let maxStep = 0;
    for (let delta = 250; delta <= 120_000; delta += 250) {
      const next = fieldMotionFor(creature, T0 + delta, 0, state.creatures.length);
      maxStep = Math.max(maxStep, Math.hypot(next.x - previous.x, next.y - previous.y));
      previous = next;
    }

    expect(maxStep).toBeLessThan(5);
  });

  it('家具へ向かう飲食・睡眠・仲間遊びを決定論的に再構成する', () => {
    const state = fieldState();
    state.unlocks.shop = true;
    state.stats.exhibitions = 1;
    state.coins = 100_000;
    expect(buyItem(state, 'fieldFeeder').ok).toBe(true);
    expect(buyItem(state, 'fieldWater').ok).toBe(true);
    expect(placeFieldItem(state, 'fieldFeeder', 2, T0).ok).toBe(true);
    expect(placeFieldItem(state, 'fieldWater', 3, T0).ok).toBe(true);
    const creature = state.creatures[0]!;
    creature.life.hunger = 20;
    creature.life.hydration = 10;

    const behaviors = Array.from({ length: 100 }, (_, i) => fieldBehaviorFor(state, creature, T0 + i * 2_000, 0));
    expect(behaviors.some((behavior) => behavior.kind === 'drink' && behavior.target)).toBe(true);
    expect(behaviors).toEqual(Array.from({ length: 100 }, (_, i) => fieldBehaviorFor(state, creature, T0 + i * 2_000, 0)));

    creature.life.health = 10;
    creature.life.mood = 10;
    expect(Array.from({ length: 100 }, (_, i) => fieldBehaviorFor(state, creature, T0 + i * 2_000, 0))
      .some((behavior) => behavior.kind === 'sleep')).toBe(true);

    for (const c of state.creatures) {
      c.life.health = 100;
      c.life.mood = 100;
      c.life.hunger = 100;
      c.life.hydration = 100;
      c.life.cleanliness = 100;
    }
    expect(Array.from({ length: 150 }, (_, i) => fieldBehaviorFor(state, creature, T0 + i * 2_000, 0))
      .some((behavior) => behavior.kind === 'play' && behavior.peerId)).toBe(true);
  });

  it('ごはん箱と水飲み場が時間経過で空腹・水分を回復する', () => {
    const state = fieldState();
    state.unlocks.shop = true;
    state.stats.exhibitions = 1;
    state.coins = 100_000;
    expect(buyItem(state, 'fieldFeeder').ok).toBe(true);
    expect(buyItem(state, 'fieldWater').ok).toBe(true);
    expect(placeFieldItem(state, 'fieldFeeder', 2, T0).ok).toBe(true);
    expect(placeFieldItem(state, 'fieldWater', 3, T0).ok).toBe(true);
    for (const c of state.creatures) {
      c.life.hunger = 30;
      c.life.hydration = 30;
    }
    applyTick(state, T0 + 6 * 60_000);
    expect(state.creatures.every((c) => c.life.hunger > 30)).toBe(true);
    expect(state.creatures.every((c) => c.life.hydration > 30)).toBe(true);
  });

  it('元気がない個体は止まる時間が長く、性格の活発さで活動量が変わる', () => {
    const state = fieldState();
    const tired = state.creatures[0]!;
    tired.life.health = 20;
    tired.life.mood = 20;
    tired.life.hunger = 20;
    tired.life.hydration = 20;

    const sampleTimes = Array.from({ length: 90 }, (_, i) => T0 + i * 2_000);
    const tiredRestCount = sampleTimes.filter((time) => fieldMotionFor(tired, time, 0, 3).gait === 'rest').length;

    tired.life.health = 100;
    tired.life.mood = 100;
    tired.life.hunger = 100;
    tired.life.hydration = 100;
    const healthyRestCount = sampleTimes.filter((time) => fieldMotionFor(tired, time, 0, 3).gait === 'rest').length;
    const healthyMotion = fieldMotionFor(tired, T0, 0, 3);

    expect(tiredRestCount).toBeGreaterThan(healthyRestCount);
    expect(healthyMotion.x).toBeGreaterThanOrEqual(8);
    expect(healthyMotion.x).toBeLessThanOrEqual(92);
    expect(['rest', 'walk', 'run']).toContain(healthyMotion.gait);

    const healthyGaits = new Set<string>();
    const runSteps: number[] = [];
    const walkSteps: number[] = [];
    for (const [index, creature] of state.creatures.entries()) {
      creature.life.health = 100;
      creature.life.mood = 100;
      creature.life.hunger = 100;
      creature.life.hydration = 100;
      creature.life.cleanliness = 100;
      let previousHealthy = fieldMotionFor(creature, T0, index, state.creatures.length);
      for (let delta = 500; delta <= 240_000; delta += 500) {
        const nextHealthy = fieldMotionFor(creature, T0 + delta, index, state.creatures.length);
        healthyGaits.add(nextHealthy.gait);
        const step = Math.abs(nextHealthy.x - previousHealthy.x);
        if (nextHealthy.gait === 'run') runSteps.push(step);
        else if (nextHealthy.gait === 'walk') walkSteps.push(step);
        previousHealthy = nextHealthy;
      }
    }
    expect(healthyGaits).toContain('run');
    const averageRunStep = runSteps.reduce((sum, value) => sum + value, 0) / runSteps.length;
    const averageWalkStep = walkSteps.reduce((sum, value) => sum + value, 0) / walkSteps.length;
    console.log(`[motion] run=${averageRunStep.toFixed(3)} walk=${averageWalkStep.toFixed(3)}`);
    expect(averageRunStep).toBeGreaterThan(averageWalkStep * 1.1);
  });
});
