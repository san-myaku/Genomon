/**
 * 時間経過（tick）。
 *
 * UI は config.TIMING.tickMs（250ms）ごとに applyTick を呼ぶ。
 * オフライン復帰時は「前回 tick からの差」がそのまま大きな値になるので、
 * 同じ関数がオフライン分の一括適用も兼ねる。
 *
 * 【オフラインの扱い（指示書 §5「放置で全部終わらない」）】
 *   1. 経過を config.TIMING.maxOfflineMs（2 時間）で切る。
 *   2. 減衰は offlineDecayScale（0.5）。留守にした罰で瀕死にしない。
 *   3. 進行は offlineProgressScale（0.6）。放置が最適解にならない程度に効かせる。
 *
 * 【所持枠が満杯のときの孵化】
 *   孵化・成体化は growth.ts が保留する（進捗は 100 で止まる）。
 *   ここでは何もせず、nextObjective が「手放すか育ててください」と案内する。
 *   卵を消したり、無理に上書きしたりしないこと。
 */

import type { Creature, GameState } from '../core/types.ts';
import { DECAY, TIMING } from './config.ts';
import { advanceStageIfReady } from './growth.ts';
import { ownedPassives, passiveMultiplier } from './shop.ts';
import { healBrokenStats, noteNow } from './state.ts';
import { refreshUnlocks } from './unlocks.ts';

export interface TickReport {
  /** この tick で孵化した個体 ID。 */
  hatched: string[];
  /** この tick で成体になった個体 ID。 */
  grownUp: string[];
  /** 新たに解放された機能 ID。 */
  unlocked: string[];
  /** オフライン分をまとめて適用したときの経過ミリ秒（0 なら通常 tick）。 */
  offlineMs: number;
}

/**
 * 「オフラインだった」とみなす境界。
 * 通常 tick は 250ms なので、その 8 倍（2 秒）を超えたら
 * タブが止まっていた／アプリを閉じていたと判断する。
 * ブラウザのタブ非アクティブ時に setInterval が間引かれる程度では反応しない幅。
 */
const OFFLINE_THRESHOLD_MS = TIMING.tickMs * 8;

/** 個体ごとの成長の速さ（0.85〜1.15）。遺伝子の growthSpeed から直に取る。 */
function growthSpeedOf(c: Creature): number {
  const pair = c.genotype.num.growthSpeed;
  const avg = pair ? (pair[0] + pair[1]) / 2 : 0.5;
  return 0.85 + avg * 0.3;
}

/**
 * 体質（0..1）。遺伝子から直に取る。
 * ここで表現型を引くと 4Hz × 個体数ぶんのキャッシュ照合が走るので、遺伝子を直接読む。
 */
function healthTendOf(c: Creature): number {
  const pair = c.genotype.num.healthTend;
  return pair ? (pair[0] + pair[1]) / 2 : 0.5;
}

/**
 * 0..100 に収める。DECAY.floor / DECAY.ceil が正本。
 * NaN / Infinity は比較がすべて false になってすり抜けるので、明示的に弾く。
 */
function clampStat(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return v < DECAY.floor ? DECAY.floor : v > DECAY.ceil ? DECAY.ceil : v;
}

/** 時間経過を適用（オフライン分も含む）。 */
export function applyTick(state: GameState, now: number): TickReport {
  noteNow(now);

  const report: TickReport = { hatched: [], grownUp: [], unlocked: [], offlineMs: 0 };

  // 設備の永続効果（API.md 規約 1: 倍率 = 1 + Σpassive、下限 0.1）。
  const passives = ownedPassives(state);
  const growthMul = passiveMultiplier(passives.growthRate);
  const hatchMul = passiveMultiplier(passives.hatchRate);
  const hungerDecayMul = passiveMultiplier(passives.hungerDecay);
  const moodDecayMul = passiveMultiplier(passives.moodDecay);
  const healthRegenMul = passiveMultiplier(passives.healthRegen);

  for (const c of state.creatures) {
    const life = c.life;
    const raw = now - life.lastTickAt;

    // 時計が巻き戻った（端末の時刻変更など）ときは、そこを起点に取り直すだけ。
    if (raw <= 0) {
      life.lastTickAt = now;
      continue;
    }

    // 壊れた値が入っていたら、計算に混ぜる前に直す（NaN は保存で null になる）。
    healBrokenStats(life);

    const offline = raw > OFFLINE_THRESHOLD_MS;
    const elapsed = offline ? Math.min(raw, TIMING.maxOfflineMs) : raw;
    if (offline) report.offlineMs = Math.max(report.offlineMs, elapsed);

    const sec = elapsed / 1000;
    const windowStart = now - elapsed;

    // ── 休息していた割合（休息中は減衰が restDecayScale 倍）──
    const restMs = Math.max(0, Math.min(life.restingUntil, now) - windowStart);
    const restFrac = elapsed > 0 ? Math.min(1, restMs / elapsed) : 0;
    const restFactor = restFrac * TIMING.restDecayScale + (1 - restFrac);

    const decayScale = (offline ? TIMING.offlineDecayScale : 1) * restFactor;
    const progressScale = offline ? TIMING.offlineProgressScale : 1;
    // 卵は代謝が低い（config.DECAY.eggScale）。
    const stageScale = life.stage === 'egg' ? DECAY.eggScale : 1;

    // ── 自然減衰 ──
    const d = sec * stageScale * decayScale;
    life.hunger = clampStat(life.hunger - DECAY.hunger * d * hungerDecayMul, life.hunger);
    life.hydration = clampStat(life.hydration - DECAY.hydration * d, life.hydration);
    life.cleanliness = clampStat(life.cleanliness - DECAY.cleanliness * d, life.cleanliness);
    life.mood = clampStat(life.mood - DECAY.mood * d * moodDecayMul, life.mood);

    // ── 健康（世話の質の「遅れた鏡」。config.DECAY の健康モデルを参照）──
    //
    // 目安値へ指数的に近づける。差分に (1 - e^(-t/τ)) を掛けるので、
    // オフラインで一気に 2 時間ぶん進めても目安値を通り越さない（発散しない）。
    const avgCare = (life.hunger + life.hydration + life.cleanliness + life.mood) / 4;
    const tendBonus = (healthTendOf(c) - 0.5) * DECAY.healthTendSpan;
    const target = clampStat(DECAY.healthFloor + DECAY.healthSpan * (avgCare / 100) + tendBonus, DECAY.healthFloor);

    const rising = target > life.health;
    // 上がるときだけ設備の healthRegen が効く（API.md 規約 1: 倍率 = 1 + Σpassive）。
    const tau = rising ? DECAY.healthRiseMs / healthRegenMul : DECAY.healthFallMs;
    life.health = clampStat(life.health + (target - life.health) * (1 - Math.exp(-elapsed / tau)), target);

    // ── 進行（孵化・成長）──
    // 体調が悪いと進みが鈍る。世話をする理由がここにも要る。
    const healthFactor = life.health < DECAY.lowThreshold ? 0.6 : 1;
    const speed = growthSpeedOf(c) * healthFactor * progressScale;

    if (life.stage === 'egg') {
      life.hatchProgress = Math.min(
        TIMING.hatchTarget,
        life.hatchProgress + TIMING.hatchPassivePerSec * sec * hatchMul * speed,
      );
    } else if (life.stage === 'juvenile') {
      life.growth = Math.min(
        TIMING.growthTarget,
        life.growth + TIMING.growthPassivePerSec * sec * growthMul * speed,
      );
    } else {
      // 成体は伸びない（config.TIMING.adultGrowthPerSec = 0）。満タン表示のため 100 で固定。
      life.growth = TIMING.growthTarget;
    }

    life.ageMs += elapsed;
    life.lastTickAt = now;
    if (life.restingUntil !== 0 && life.restingUntil <= now) life.restingUntil = 0;

    // ── 段階遷移（枠が満杯なら growth.ts 側で保留される）──
    const change = advanceStageIfReady(state, c, now);
    if (change.evolved === 'juvenile') report.hatched.push(c.id);
    else if (change.evolved === 'adult') report.grownUp.push(c.id);
  }

  report.unlocked = refreshUnlocks(state);
  state.updatedAt = now;
  return report;
}
