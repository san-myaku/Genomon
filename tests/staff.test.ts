import { describe, expect, it } from 'vitest';
import { createCreature } from '../src/game/state.ts';
import { randomGenotype } from '../src/genetics/genotype.ts';
import {
  STAFF,
  applyTick,
  dismissStaff,
  hiredStaff,
  hireStaff,
  newGame,
  refreshStaffCandidates,
  staffConfig,
} from '../src/game/index.ts';

const T0 = 1_700_000_000_000;

function staffState() {
  const state = newGame('staff-test-world');
  state.unlocks.staff = true;
  state.coins = 1_000;
  for (let i = 0; i < 3; i++) {
    const c = createCreature(state, randomGenotype(`staff-creature-${i}`), T0, {
      parents: null,
      parentNames: null,
      generation: 1,
      fromBreeding: false,
    });
    c.life.stage = 'adult';
    c.life.growth = 100;
    c.life.hunger = 20 + i * 3;
    c.life.hydration = 25;
    c.life.cleanliness = 30;
    c.life.mood = 35;
    c.life.lastTickAt = T0;
    state.creatures.push(c);
  }
  state.staff.lastServiceAt = T0;
  state.staff.lastPaidAt = T0;
  return state;
}

describe('飼育員', () => {
  it('同じ worldSeed と募集回数から同じ候補が出る', () => {
    const a = staffState();
    const b = staffState();
    expect(refreshStaffCandidates(a, T0)).toEqual(refreshStaffCandidates(b, T0));
    expect(a.staff.candidates).toHaveLength(3);
    expect(new Set(a.staff.candidates.map((c) => c.role))).toEqual(new Set(['partTime', 'fullTime']));
  });

  it('採用費を払い、巡回で手の足りない子を世話し、給与も払う', () => {
    const state = staffState();
    const candidate = refreshStaffCandidates(state, T0)[1]!;
    const before = state.creatures.map((c) => c.life.hunger);
    const hired = hireStaff(state, candidate.id, T0);

    expect(hired.ok).toBe(true);
    expect(state.coins).toBe(1_000 - staffConfig(candidate.role).hiringFee);
    const report = applyTick(state, T0 + Math.max(staffConfig(candidate.role).serviceIntervalMs, STAFF.payIntervalMs) + 1);
    expect(report.staffEvent).toBe(true);
    expect(state.stats.staffCareActions).toBeGreaterThan(0);
    expect(state.creatures.some((c, i) => c.life.hunger > before[i]!)).toBe(true);
    expect(state.coins).toBe(1_000 - staffConfig(candidate.role).hiringFee - candidate.wage);
    expect(hiredStaff(state)?.id).toBe(candidate.id);
  });

  it('給与を払えない状態が猶予を超えると自動で雇用を終える', () => {
    const state = staffState();
    const candidate = refreshStaffCandidates(state, T0)[0]!;
    expect(hireStaff(state, candidate.id, T0).ok).toBe(true);
    state.coins = 0;

    applyTick(state, T0 + STAFF.payIntervalMs + 1);
    expect(state.staff.unpaidSince).toBeGreaterThan(0);
    applyTick(state, T0 + STAFF.payIntervalMs + STAFF.unpaidGraceMs + 2);
    expect(hiredStaff(state)).toBeNull();
    expect(state.staff.candidates).toHaveLength(0);
    expect(dismissStaff(state, T0 + 1).ok).toBe(false);
  });
});
