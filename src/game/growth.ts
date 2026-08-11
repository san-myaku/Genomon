/**
 * 孵化と成長（段階遷移）。
 *
 * 【設計方針】
 *   - 段階が変わるのは「しきい値に達したとき」だけ。tick と世話・アイテムの
 *     どちらから呼ばれても同じ関数を通るので、遷移処理が二重化しない。
 *   - 所持枠が満杯のときは **遷移を保留する**（進捗は 100 で止める）。
 *     ここで無理に上書きしたり、個体を消したりすると詰みや事故になる。
 *     保留の理由は文字列で返し、nextObjective が「手放すか育てましょう」と案内する。
 */

import type { Creature, GameState, Stage } from '../core/types.ts';
import { INITIAL_LIFE, TIMING } from './config.ts';
import { advanceTutorial, hasRoomFor } from './state.ts';

export interface StageChange {
  /** 段階が変わったならその段階。変わらなければ null。 */
  evolved: Stage | null;
  /** 変わる準備はできているのに保留されている理由（枠が満杯など）。 */
  blocked: string | null;
}

const NO_CHANGE: StageChange = { evolved: null, blocked: null };

/** 孵化の準備ができているか。 */
export function isReadyToHatch(c: Creature): boolean {
  return c.life.stage === 'egg' && c.life.hatchProgress >= TIMING.hatchTarget;
}

/** 成体になる準備ができているか。 */
export function isReadyToGrowUp(c: Creature): boolean {
  return c.life.stage === 'juvenile' && c.life.growth >= TIMING.growthTarget;
}

/**
 * 段階を進められるなら進める。
 * 呼び出し側（tick / doCare / useItem）はこれを呼ぶだけでよい。
 */
export function advanceStageIfReady(state: GameState, c: Creature, now: number): StageChange {
  if (isReadyToHatch(c)) {
    // 進捗はしきい値で止める（オーバーフローした値を保存しない）。
    c.life.hatchProgress = TIMING.hatchTarget;
    if (!hasRoomFor(state, 'juvenile')) {
      return {
        evolved: null,
        blocked: `${c.name} は もう 孵りそうですが、幼体の枠が いっぱいです。どれかを 手放すか 成体まで 育ててください。`,
      };
    }
    hatch(state, c, now);
    return { evolved: 'juvenile', blocked: null };
  }

  if (isReadyToGrowUp(c)) {
    c.life.growth = TIMING.growthTarget;
    if (!hasRoomFor(state, 'adult')) {
      return {
        evolved: null,
        blocked: `${c.name} は もう 成体に なれますが、成体の枠が いっぱいです。どれかを 手放してください。`,
      };
    }
    growUp(state, c, now);
    return { evolved: 'adult', blocked: null };
  }

  return NO_CHANGE;
}

/**
 * 卵 → 幼体。
 * LifeState は config.INITIAL_LIFE.juvenile を土台に組み直す
 * （卵のときの満腹・清潔をそのまま持ち越すと「孵った瞬間に瀕死」が起こり得るため）。
 * ただし ageMs・careCount・lastCareAt は個体の履歴なので引き継ぐ。
 */
function hatch(state: GameState, c: Creature, now: number): void {
  const base = INITIAL_LIFE.juvenile;
  c.life.stage = 'juvenile';
  c.life.growth = base.growth;
  c.life.hunger = base.hunger;
  c.life.hydration = base.hydration;
  c.life.cleanliness = base.cleanliness;
  c.life.mood = base.mood;
  // 健康だけは卵のときの世話の結果を引き継ぐ（放置された卵は弱い子で孵る）。
  c.life.health = Math.max(base.health * 0.5, c.life.health);
  c.life.hatchProgress = base.hatchProgress;
  c.life.restingUntil = 0;
  c.life.lastTickAt = now;

  state.stats.hatched += 1;
  state.updatedAt = now;
  advanceTutorial(state, 'care', 'grow');
}

/**
 * 幼体 → 成体。
 * growth は 100 で止める（成体は伸びない：config.TIMING.adultGrowthPerSec = 0）。
 * 孵化直後のようなリセットはしない。育てた状態のまま大人になるのが自然なため。
 */
function growUp(state: GameState, c: Creature, now: number): void {
  c.life.stage = 'adult';
  c.life.growth = TIMING.growthTarget;
  c.life.hatchProgress = 100;
  c.life.restingUntil = 0;
  c.life.lastTickAt = now;
  // 大人になれた達成感を数値でも返す。機嫌を少しだけ上げる。
  c.life.mood = Math.min(100, c.life.mood + 8);

  state.stats.grownUp += 1;
  state.updatedAt = now;
  advanceTutorial(state, 'grow', 'exhibition');
}

/**
 * 段階遷移が保留されている個体の理由（なければ null）。
 * nextObjective が「詰んでいないこと」を案内するために使う。
 */
export function stageBlockReason(state: GameState, c: Creature): string | null {
  if (isReadyToHatch(c) && !hasRoomFor(state, 'juvenile')) {
    return `${c.name} が 孵るのを 待っています。幼体の枠が いっぱいです。`;
  }
  if (isReadyToGrowUp(c) && !hasRoomFor(state, 'adult')) {
    return `${c.name} が 成体に なるのを 待っています。成体の枠が いっぱいです。`;
  }
  return null;
}

/** 保留されている個体をまとめて拾う（UI のバッジ表示用）。 */
export function blockedCreatures(state: GameState): { creature: Creature; reason: string }[] {
  const out: { creature: Creature; reason: string }[] = [];
  for (const c of state.creatures) {
    const reason = stageBlockReason(state, c);
    if (reason) out.push({ creature: c, reason });
  }
  return out;
}
