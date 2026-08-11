/**
 * ゲーム状態の生成・卵選択・所持枠まわり。
 *
 * 【この層の責務】
 *   GameState を「その場で変更（mutate）」する（API.md 前文）。
 *   保存は UI の責務なので、ここで localStorage には一切触らない。
 *
 * 【数値の出どころ】
 *   バランス定数はすべて game/config.ts から import する。ここには定数を書かない。
 */

import { makeSeed, makeWorldSeed } from '../core/rng.ts';
import type { Creature, GameState, Genotype, LifeState, Stage } from '../core/types.ts';
import { makeName, randomGenotype } from '../genetics/index.ts';
import { createNewGameState } from '../save/index.ts';
import { INITIAL_LIFE } from './config.ts';

// ─────────────────────────────────────────────────────────
//  新規ゲーム
// ─────────────────────────────────────────────────────────

/**
 * 卵選択画面に出す候補の数（指示書 §4「9 個の卵から 3 個を選ぶ」）。
 * 3×3 のグリッドで一画面に収まる数でもある。
 */
export const EGG_CHOICE_COUNT = 9;

/** プレイヤーが確定できる卵の数。所持枠（config.CAPACITY_DEFAULT.egg）を超えない。 */
export const EGG_PICK_COUNT = 3;

/** 新規ゲーム。worldSeed 省略時は実時間から生成する。 */
export function newGame(worldSeed?: string): GameState {
  return createNewGameState(worldSeed ?? makeWorldSeed());
}

// ─────────────────────────────────────────────────────────
//  卵候補
// ─────────────────────────────────────────────────────────

/**
 * 卵候補 1 個ぶんの seed。
 *
 * seedCounter を使わないのが要点（API.md 規約 5「rollEggChoices は決定論的」）。
 * seedCounter 由来にすると、呼ぶたびにカウンタが進んで候補が入れ替わり、
 * リロードで「さっき見た卵」が消える。worldSeed だけから決まる別名前空間にしてある。
 */
function eggChoiceSeed(worldSeed: string, index: number): string {
  return makeSeed(`${worldSeed}/eggChoice`, index);
}

/**
 * 卵選択画面に出す 9 個の候補を作り、state.pendingEggs に入れて返す。
 * 同じ state から何度呼んでも同じ 9 個が出る。
 */
export function rollEggChoices(state: GameState): { seed: string; genotype: Genotype }[] {
  const eggs: { seed: string; genotype: Genotype }[] = [];
  for (let i = 0; i < EGG_CHOICE_COUNT; i++) {
    const seed = eggChoiceSeed(state.worldSeed, i);
    eggs.push({ seed, genotype: randomGenotype(seed) });
  }
  state.pendingEggs = eggs;
  return eggs;
}

/** 実際に選べる個数（所持枠が縮んでいる場合に備えて枠と突き合わせる）。 */
function pickCount(state: GameState): number {
  return Math.min(EGG_PICK_COUNT, state.capacity.egg);
}

/**
 * 選んだ seed を確定し、卵の Creature を作る。pendingEggs は null に戻す。
 * 候補外の seed・重複・個数違いはすべて理由付きで拒否する。
 */
export function chooseEggs(
  state: GameState,
  seeds: string[],
  now: number,
): { ok: boolean; reason?: string } {
  const pending = state.pendingEggs;
  if (!pending || pending.length === 0) {
    return { ok: false, reason: '卵の候補が ありません。もう一度 えらび直してください。' };
  }

  const want = pickCount(state);
  if (seeds.length !== want) {
    return { ok: false, reason: `卵は ${want} つ えらんでください。（いま ${seeds.length} つ）` };
  }

  const unique = new Set(seeds);
  if (unique.size !== seeds.length) {
    return { ok: false, reason: 'おなじ卵を 2 回 えらぶことは できません。' };
  }

  const chosen: { seed: string; genotype: Genotype }[] = [];
  for (const seed of seeds) {
    const found = pending.find((e) => e.seed === seed);
    if (!found) return { ok: false, reason: `その卵は 候補に ありません（${seed}）。` };
    chosen.push(found);
  }

  const room = state.capacity.egg - capacityUsed(state).egg;
  if (chosen.length > room) {
    return { ok: false, reason: `卵の枠が たりません（空き ${room} / 必要 ${chosen.length}）。` };
  }

  for (const egg of chosen) {
    const c = createCreature(state, egg.genotype, now, {
      parents: null,
      parentNames: null,
      generation: 1,
      fromBreeding: false,
    });
    state.creatures.push(c);
  }

  state.pendingEggs = null;
  // 最初に選んだ卵を育成室の選択個体にしておく（UI が空の詳細画面を出さないように）。
  state.activeCreatureId = state.creatures[state.creatures.length - chosen.length]?.id ?? null;
  state.updatedAt = now;
  advanceTutorial(state, 'chooseEgg', 'care');

  return { ok: true };
}

// ─────────────────────────────────────────────────────────
//  個体の生成
// ─────────────────────────────────────────────────────────

/** 卵の LifeState を作る（config.INITIAL_LIFE.egg が正本）。 */
export function freshEggLife(now: number): LifeState {
  const base = INITIAL_LIFE.egg;
  return {
    stage: 'egg',
    ageMs: 0,
    growth: base.growth,
    hunger: base.hunger,
    hydration: base.hydration,
    cleanliness: base.cleanliness,
    mood: base.mood,
    health: base.health,
    hatchProgress: base.hatchProgress,
    careCount: 0,
    lastCareAt: {},
    lastTickAt: now,
    restingUntil: 0,
  };
}

/** LifeState 上の 0..100 の数値キー。 */
const GAUGE_KEYS = [
  'growth', 'hunger', 'hydration', 'cleanliness', 'mood', 'health', 'hatchProgress',
] as const satisfies readonly (keyof LifeState)[];

/**
 * 壊れた数値（NaN / Infinity）を水際で直す。
 *
 * 【なぜ要るか】
 *   NaN は JSON.stringify で **null になる**。ステータスが 1 つでも NaN のまま保存されると
 *   次回起動で「セーブデータが読めませんでした」になる
 *   （開発中に実際に発生した。3 体とも life.health: null で保存されていた）。
 *   健康は 4 つのゲージの平均から決まるので、**どれか 1 つが NaN になると全部に伝染する**。
 *   原因（開発中のホットリロード、外部から壊されたセーブ など）が何であれ、
 *   時間や世話を進める前にここで潰しておけば、保存されるデータは常に有限値になる。
 *
 *   復元先は config.INITIAL_LIFE（その段階の「ふつうの状態」）。
 */
export function healBrokenStats(life: LifeState): void {
  const base = life.stage === 'egg' ? INITIAL_LIFE.egg : INITIAL_LIFE.juvenile;
  for (const key of GAUGE_KEYS) {
    if (!Number.isFinite(life[key])) (life[key] as number) = base[key];
  }
  if (!Number.isFinite(life.ageMs)) life.ageMs = 0;
  if (!Number.isFinite(life.careCount)) life.careCount = 0;
  if (!Number.isFinite(life.restingUntil)) life.restingUntil = 0;
  if (!Number.isFinite(life.lastTickAt)) life.lastTickAt = gameNow();
}

/** id が衝突しないことを保証する（理屈上は起きないが、seed 手入力の開発者モードに備える）。 */
function uniqueId(state: GameState, seed: string): string {
  const base = `c-${seed}`;
  if (!state.creatures.some((c) => c.id === base)) return base;
  for (let i = 2; i < 999; i++) {
    const cand = `${base}#${i}`;
    if (!state.creatures.some((c) => c.id === cand)) return cand;
  }
  return `${base}#${state.creatures.length}`;
}

export interface CreatureOrigin {
  parents: readonly [string, string] | null;
  parentNames: readonly [string, string] | null;
  generation: number;
  fromBreeding: boolean;
}

/**
 * 卵の Creature を作る（state には push しない）。
 * 初期卵・交配で生まれた卵の両方がここを通るので、初期値のずれが起きない。
 */
export function createCreature(
  state: GameState,
  genotype: Genotype,
  now: number,
  origin: CreatureOrigin,
): Creature {
  return {
    id: uniqueId(state, genotype.seed),
    seed: genotype.seed,
    name: makeName(genotype.seed),
    genotype,
    life: freshEggLife(now),
    parents: origin.parents,
    parentNames: origin.parentNames,
    generation: origin.generation,
    bornAt: now,
    bestScore: 0,
    exhibitionCount: 0,
    favorite: false,
    fromBreeding: origin.fromBreeding,
    // クールダウンの起点。0 は「まだ一度もしていない」を表す（時刻 0 と衝突しない運用）。
    lastExhibitAt: 0,
    lastBredAt: 0,
  };
}

// ─────────────────────────────────────────────────────────
//  参照系
// ─────────────────────────────────────────────────────────

export function findCreature(state: GameState, id: string): Creature | undefined {
  return state.creatures.find((c) => c.id === id);
}

export function creaturesByStage(state: GameState, stage: Stage): Creature[] {
  return state.creatures.filter((c) => c.life.stage === stage);
}

/** 段階ごとの所持数。 */
export function capacityUsed(state: GameState): { egg: number; juvenile: number; adult: number } {
  const out = { egg: 0, juvenile: 0, adult: 0 };
  for (const c of state.creatures) out[c.life.stage]++;
  return out;
}

/** その段階に空きがあるか。 */
export function hasRoomFor(state: GameState, stage: Stage): boolean {
  return capacityUsed(state)[stage] < state.capacity[stage];
}

/** 空き枠数（0 以上）。UI の「あと N 体」表示と、詰み回避の案内文で使う。 */
export function roomLeft(state: GameState, stage: Stage): number {
  return Math.max(0, state.capacity[stage] - capacityUsed(state)[stage]);
}

/**
 * 手放したあとに最低限のこす個体数。
 *
 * 新しい卵を得る手段は「交配」だけで、交配には成体が 2 体いる（config.BREEDING）。
 * つまり **手持ちが 1 体になった時点で、二度と個体を増やせない＝詰み** になる。
 * 2 体のこっていれば、両方が成体になれば必ず交配に届くので、ここが最後の砦。
 */
export const MIN_KEEP_CREATURES = 2;

/**
 * 個体を手放す。
 * 枠が満杯で孵化・成体化が止まったときの逃げ道。
 * ただし詰みにつながる最後の 1 体は手放せない（理由を返す）。
 */
export function releaseCreature(state: GameState, id: string): { ok: boolean; reason?: string } {
  const idx = state.creatures.findIndex((c) => c.id === id);
  if (idx < 0) return { ok: false, reason: 'その子は 見つかりませんでした。' };

  if (state.creatures.length <= MIN_KEEP_CREATURES) {
    return {
      ok: false,
      reason: `いま ${state.creatures.length} 体しか いません。これ以上 手放すと あたらしい 卵を 産めなく なります。`,
    };
  }

  const [removed] = state.creatures.splice(idx, 1);

  // 親として参照されている個体が消えても、子の parentNames が残るので系譜表示は壊れない。
  if (state.activeCreatureId === id) {
    state.activeCreatureId = state.creatures[0]?.id ?? null;
  }
  state.updatedAt = gameNow();
  return { ok: true, reason: `${removed?.name ?? 'その子'} を そっと 森へ かえしました。` };
}

// ─────────────────────────────────────────────────────────
//  チュートリアル進行（UI が current を見てガイドを出す）
// ─────────────────────────────────────────────────────────

/** ステップを完了にして、次のガイドへ進める。同じステップを二重に積まない。 */
export function advanceTutorial(state: GameState, done: string, next: string | null): void {
  if (!state.tutorial.done.includes(done)) state.tutorial.done.push(done);
  // すでに先へ進んでいる場合は巻き戻さない。
  if (state.tutorial.current === done || state.tutorial.current === null) {
    state.tutorial.current = next;
  }
}

// ─────────────────────────────────────────────────────────
//  ゲーム内時刻の共有
// ─────────────────────────────────────────────────────────

/**
 * 「ゲームが最後に見た時刻」。
 *
 * API.md の canBreed は now を受け取らないので、クールダウン判定に使う時刻が要る。
 * applyTick / doCare / runExhibition など now を持つ関数が通るたびにここへ書き込み、
 * now を持たない参照系はこれを読む。テストの仮想時間でもそのまま成立する。
 */
let lastKnownNow = Date.now();

export function noteNow(now: number): void {
  if (Number.isFinite(now)) lastKnownNow = now;
}

export function gameNow(): number {
  return lastKnownNow;
}
