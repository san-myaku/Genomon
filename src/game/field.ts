/**
 * 飼育フィールドの生活シミュレーション。
 *
 * 個体の見た目は render 層に任せ、このファイルは「いつ排泄したか」「どれだけ汚れたか」
 * 「どの遊具をどこへ置いたか」だけを決定論的に管理する。Math.random() は使わない。
 */

import type { Creature, FieldPlacement, FieldState, GameState } from '../core/types.ts';
import { FIELD, SHOP_ITEM_BY_ID, TIMING } from './config.ts';
import { getPhenotype } from './phenoCache.ts';
import { ownedPassives, passiveMultiplier } from './shop.ts';
import { noteNow } from './state.ts';

export interface FieldTickReport {
  addedDroppings: number;
  removedDroppings: number;
  changed: boolean;
}

export type FieldGait = 'rest' | 'walk' | 'run';

export type FieldBehaviorKind = 'wander' | 'sleep' | 'eat' | 'drink' | 'play';

export interface FieldBehavior {
  kind: FieldBehaviorKind;
  /** 家具や仲間へ向かう行動だけが持つ、床上の目標座標。 */
  target?: { x: number; y: number };
  peerId?: string;
}

export interface FieldMotion {
  x: number;
  y: number;
  scale: number;
  phase: number;
  /** 進行方向。SVGを左右反転して、向いている方向を表す。 */
  facing: -1 | 1;
  /** 歩行アニメーションの種類。 */
  gait: FieldGait;
  /** CSSアニメーションを個体ごとにずらすための位相（ms）。 */
  gaitPhaseMs: number;
}

const UINT32 = 0x1_0000_0000;
const FIELD_COLUMNS = 4;

/** 文字列から安定した 32bit 値を作る。seed 由来の配置・揺れにだけ使う。 */
function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unit(input: string): number {
  return hash32(input) / UINT32;
}

/** UI の配置グリッドと生活行動が同じ家具座標を使うための正本。 */
export function fieldSlotPosition(slot: number): { x: number; y: number } {
  const col = slot % FIELD_COLUMNS;
  const row = Math.floor(slot / FIELD_COLUMNS);
  return { x: 14 + col * 24, y: 55 + row * 18 };
}

/**
 * 現在フィールドで何をしようとしているかを、保存項目を増やさず再構成する。
 * 同じ世界・個体・時刻なら同じ結果になり、リロード後も生活リズムが飛ばない。
 */
export function fieldBehaviorFor(state: GameState, c: Creature, now: number, index = 0): FieldBehavior {
  if (c.life.stage === 'egg') return { kind: 'wander' };
  const pheno = getPhenotype(c);
  const p = pheno.personality;
  const wellbeing = (c.life.health + c.life.mood + c.life.hunger + c.life.hydration + c.life.cleanliness) / 500;
  const cycleMs = 72_000;
  const phase = positiveModulo(now + unit(`${c.seed}:field-behavior-phase`) * cycleMs, cycleMs) / cycleMs;

  // 明示的な休息中と、体力の落ちた子／おとなしい子の周期的な睡眠。
  if (c.life.restingUntil > now || (wellbeing < 0.42 && phase >= 0.3) || (p.energy < 0.3 && phase >= 0.72)) {
    return {
      kind: 'sleep',
      target: {
        x: 20 + unit(`${c.seed}:sleep-x`) * 60,
        y: 58 + unit(`${c.seed}:sleep-y`) * 28,
      },
    };
  }

  const placementByKind = (kind: 'food' | 'water'): FieldPlacement | undefined =>
    state.field.placements.find((placement) => SHOP_ITEM_BY_ID[placement.itemId]?.fieldObject === kind);
  const food = placementByKind('food');
  const water = placementByKind('water');
  const needsWater = water && c.life.hydration < 92;
  const needsFood = food && c.life.hunger < 92;
  if (phase >= 0.5 && phase < 0.78 && (needsWater || needsFood)) {
    const chooseWater = !!needsWater && (!needsFood || c.life.hydration <= c.life.hunger);
    const placement = chooseWater ? water! : food!;
    const pos = fieldSlotPosition(placement.slot);
    return { kind: chooseWater ? 'drink' : 'eat', target: { x: pos.x, y: Math.min(92, pos.y + 3) } };
  }

  // 同じ世界の全個体に共通する遊び時間。隣の個体と同じ集合地点へ向かう。
  const live = state.creatures.filter((other) => other.life.stage !== 'egg');
  const socialPhase = positiveModulo(now + unit(`${state.worldSeed}:field-social`) * 96_000, 96_000) / 96_000;
  if (live.length >= 2 && socialPhase >= 0.58 && socialPhase < 0.82 && wellbeing >= 0.5) {
    const self = Math.max(0, live.findIndex((other) => other.id === c.id));
    const peer = live[(self + (self % 2 === 0 ? 1 : live.length - 1)) % live.length]!;
    const pairKey = [c.id, peer.id].sort().join(':');
    return {
      kind: 'play',
      peerId: peer.id,
      target: { x: 36 + unit(`${state.worldSeed}:${pairKey}:play-x`) * 28, y: 60 + (index % 3) * 9 },
    };
  }

  return { kind: 'wander' };
}

function clamp100(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, v));
}

function hasPlacedKind(state: GameState, kind: 'food' | 'water'): boolean {
  return state.field.placements.some((placement) => SHOP_ITEM_BY_ID[placement.itemId]?.fieldObject === kind);
}

function droppingInterval(c: Creature): number {
  return FIELD.droppingIntervalMs + Math.floor(unit(`${c.seed}:dropping-interval`) * FIELD.droppingJitterMs);
}

/** 壁・家具の印象を避けた、床上の散らばり用アンカー。斜め列にならないよう配置を固定する。 */
const DROP_SPOTS = [
  { x: 14, y: 62 }, { x: 30, y: 68 }, { x: 48, y: 60 }, { x: 67, y: 70 }, { x: 84, y: 63 },
  { x: 21, y: 77 }, { x: 40, y: 83 }, { x: 58, y: 75 }, { x: 77, y: 84 }, { x: 90, y: 77 },
  { x: 13, y: 87 }, { x: 31, y: 89 }, { x: 50, y: 86 }, { x: 69, y: 90 }, { x: 86, y: 88 },
] as const;

function dropPosition(
  c: Creature,
  occurrence: number,
  occupied: readonly { x: number; y: number }[] = [],
): { x: number; y: number } {
  const prefix = `${c.seed}:dropping:${occurrence}`;
  const primary = (hash32(`${prefix}:spot`) + occurrence * 5) % DROP_SPOTS.length;
  for (let offset = 0; offset < DROP_SPOTS.length; offset++) {
    const spot = DROP_SPOTS[(primary + offset) % DROP_SPOTS.length]!;
    const candidate = {
      x: Math.max(9, Math.min(91, spot.x + (unit(`${prefix}:x:${offset}`) - 0.5) * 8)),
      y: Math.max(56, Math.min(91, spot.y + (unit(`${prefix}:y:${offset}`) - 0.5) * 4)),
    };
    const farEnough = occupied.every((other) => {
      const dx = candidate.x - other.x;
      const dy = candidate.y - other.y;
      return dx * dx + dy * dy >= 8 * 8;
    });
    if (farEnough) return candidate;
  }
  const spot = DROP_SPOTS[primary]!;
  return {
    x: Math.max(9, Math.min(91, spot.x + (unit(`${prefix}:x:fallback`) - 0.5) * 8)),
    y: Math.max(56, Math.min(91, spot.y + (unit(`${prefix}:y:fallback`) - 0.5) * 4)),
  };
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function smoothStep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/** 歩行区間の一部だけ速度を上げ、始点と終点は必ず同じ位置へ戻す。 */
function pacedProgress(value: number, runStart: number, runLength: number, runBoost: number): number {
  const t = Math.max(0, Math.min(1, value));
  const start = Math.max(0, Math.min(1, runStart));
  const length = Math.max(0, Math.min(1 - start, runLength));
  const end = start + length;
  const total = 1 + length * (runBoost - 1);
  if (t <= start) return t / total;
  if (t <= end) return (start + (t - start) * runBoost) / total;
  return (start + length * runBoost + (t - end)) / total;
}

/**
 * フィールド上の暮らしの位置と足取り。
 *
 * 常時移動ではなく、個体ごとに「休む→歩く→休む→戻る」を繰り返す。
 * 性格の energy / curiosity と、現在の健康・機嫌・満腹・水分を活動量へ反映し、
 * 元気な子ほど歩く時間が長く、走る時間も少し増える。値は seed と時刻から
 * 再構成でき、保存データには追加しない。
 */
export function fieldMotionFor(c: Creature, now: number, index = 0, total = 1): FieldMotion {
  const seed = `${c.seed}:field-motion`;
  const phase = unit(`${seed}:phase`) * Math.PI * 2;
  const phaseMs = phase * 1000;

  // 卵は床を歩かず、既存の卵側の呼吸・揺れだけを見せる。
  if (c.life.stage === 'egg') {
    return {
      x: 18 + unit(`${seed}:egg-x`) * 64,
      y: 62 + unit(`${seed}:egg-y`) * 20,
      scale: 0.94 + unit(`${seed}:scale`) * 0.08,
      phase,
      facing: 1,
      gait: 'rest',
      gaitPhaseMs: 0,
    };
  }

  // 個体数が多いときは床のレーンを分け、互いの輪郭を見失わないようにする。
  const laneCount = Math.max(1, Math.min(total, 3));
  const lane = Math.max(0, index) % laneCount;
  const laneY = laneCount === 1 ? 70 : laneCount === 2 ? [52, 84][lane]! : [36, 64, 92][lane]!;
  const baseY = total > 1 ? laneY + (unit(`${seed}:lane-y`) - 0.5) * 5 : 56 + unit(`${seed}:y`) * 25;
  const routeStart = total > 1 ? 11 + unit(`${seed}:route-start`) * 7 : 14 + unit(`${seed}:route-start`) * 7;
  const routeWidth = total > 1 ? 68 + unit(`${seed}:route-width`) * 12 : 70 + unit(`${seed}:route-width`) * 10;
  const routeEnd = Math.min(91, routeStart + routeWidth);

  const pheno = getPhenotype(c);
  const p = pheno.personality;
  const wellbeing = Math.max(
    0,
    Math.min(
      1,
      (c.life.health * 0.4
        + c.life.mood * 0.24
        + c.life.hunger * 0.12
        + c.life.hydration * 0.12
        + c.life.cleanliness * 0.12) / 100,
    ),
  );
  const vitality = 0.18 + wellbeing * 0.82;
  const personalityDrive = Math.max(0, Math.min(1, p.energy * 0.62 + p.curiosity * 0.23 + p.affection * 0.1 + p.dependence * 0.05));
  const activity = Math.max(0.12, Math.min(1, personalityDrive * 0.58 + vitality * 0.42));

  // 片道 18〜42 秒、端で 12〜38 秒休む。元気がない子ほど長く止まり、移動も遅い。
  const moveMs = Math.round(Math.max(18_000, Math.min(42_000, 18_000 + (1 - activity) * 10_000 + (1 - vitality) * 14_000)));
  const restMs = Math.round(Math.max(12_000, Math.min(38_000, 12_000 + (1 - activity) * 10_000 + (1 - vitality) * 16_000)));
  const cycleMs = restMs * 2 + moveMs * 2;
  const cycleTime = positiveModulo(now + phaseMs + unit(`${seed}:schedule`) * cycleMs, cycleMs);
  const runAllowed = vitality >= 0.58 && p.energy >= 0.54 && activity >= 0.5;
  const runDirection: -1 | 1 = unit(`${seed}:run-direction`) < 0.5 ? 1 : -1;
  const runStart = 0.28 + unit(`${seed}:run-window`) * 0.28;
  const runLength = 0.07 + activity * 0.1;

  let routeProgress = 0;
  let facing: -1 | 1 = 1;
  let gait: FieldGait = 'rest';
  let gaitProgress = 0;
  if (cycleTime < restMs) {
    // 左端で休む。
    routeProgress = 0;
    facing = 1;
  } else if (cycleTime < restMs + moveMs) {
    // 左から右へゆっくり進む。
    gaitProgress = (cycleTime - restMs) / moveMs;
    facing = 1;
    gait = runAllowed && runDirection === 1 && gaitProgress >= runStart && gaitProgress <= runStart + runLength ? 'run' : 'walk';
    const paced = runAllowed && runDirection === 1
      ? pacedProgress(gaitProgress, runStart, runLength, 1.8 + activity * 0.7)
      : gaitProgress;
    routeProgress = smoothStep(paced);
  } else if (cycleTime < restMs + moveMs + restMs) {
    // 右端で休む。
    routeProgress = 1;
    facing = -1;
  } else {
    // 右から左へ戻る。
    gaitProgress = (cycleTime - restMs - moveMs - restMs) / moveMs;
    facing = -1;
    gait = runAllowed && runDirection === -1 && gaitProgress >= runStart && gaitProgress <= runStart + runLength ? 'run' : 'walk';
    const paced = runAllowed && runDirection === -1
      ? pacedProgress(gaitProgress, runStart, runLength, 1.8 + activity * 0.7)
      : gaitProgress;
    routeProgress = 1 - smoothStep(paced);
  }

  const routeX = routeStart + (routeEnd - routeStart) * routeProgress;
  const laneWave = gait === 'rest' ? 0 : Math.sin(gaitProgress * Math.PI + phase) * (1.1 + activity * 1.1);

  // 走る時間を個体ごとにずらす。走行中はSVG側の足取りも速くなる。
  const gaitCycleMs = gait === 'run' ? 420 : 720;
  const gaitPhaseMs = ((now + phaseMs) % gaitCycleMs + gaitCycleMs) % gaitCycleMs;
  return {
    x: Math.max(8, Math.min(92, routeX)),
    y: Math.max(40, Math.min(96, baseY + laneWave)),
    scale: 0.94 + unit(`${seed}:scale`) * 0.08,
    phase,
    facing,
    gait,
    gaitPhaseMs,
  };
}

/** 次に排泄するまでの目安。UI の説明用で、state は変更しない。 */
export function nextDroppingIn(state: GameState, c: Creature, now: number): number | null {
  if (c.life.stage === 'egg') return null;
  // lastDroppingAge は tick が実際に消化した年齢。表示側でもここを使うと、
  // タブ復帰直後に「次の排泄まで」が一瞬だけ巻き戻って見えるのを防げる。
  const tracked = state.field.lastDroppingAge[c.id];
  const age = Math.max(0, Number.isFinite(tracked) ? tracked : c.life.ageMs);
  const interval = droppingInterval(c);
  const nextAge = (Math.floor(age / interval) + 1) * interval;
  // now は API の対称性と将来のリアルタイム表示用に受け取る。現在の表示は
  // 「最後に tick した時点から次まで」の安定した値を返す。
  void now;
  return Math.max(0, nextAge - age);
}

function liveCreatures(state: GameState): Creature[] {
  return state.creatures.filter((c) => c.life.stage !== 'egg');
}

function remapDroppingPositions(state: GameState, report: FieldTickReport): void {
  const creatures = new Map(state.creatures.map((c) => [c.id, c]));
  const occupied: { x: number; y: number }[] = [];
  for (const drop of [...state.field.droppings].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    const creature = creatures.get(drop.creatureId);
    const prefix = creature ? `dropping-${creature.id}-` : '';
    if (creature && drop.id.startsWith(prefix)) {
      const occurrence = Number(drop.id.slice(prefix.length));
      if (Number.isInteger(occurrence) && occurrence >= 1) {
        const position = dropPosition(creature, occurrence, occupied);
        if (Math.abs(drop.x - position.x) >= 0.01 || Math.abs(drop.y - position.y) >= 0.01) {
          // 旧バージョンの斜め配置や壁座標を、現行の床アンカーへ一度だけ移行する。
          drop.x = position.x;
          drop.y = position.y;
          report.changed = true;
        }
      }
    }
    occupied.push({ x: drop.x, y: drop.y });
  }
}

function validSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < FIELD.slotCount;
}

/** フィールドの時間を一度だけ進める。applyTick から毎回呼ぶ。 */
export function advanceField(state: GameState, now: number): FieldTickReport {
  noteNow(now);
  const field = state.field;
  const report: FieldTickReport = { addedDroppings: 0, removedDroppings: 0, changed: false };

  // 設定変更前のセーブに大量の排泄物が残っていても、新しい上限へ自然に収める。
  // 配列は古い順に追加されるため、古いものから落として最近のものを残す。
  if (field.droppings.length > FIELD.maxDroppings) {
    const excess = field.droppings.length - FIELD.maxDroppings;
    field.droppings.splice(0, excess);
    report.removedDroppings += excess;
    report.changed = true;
  }
  remapDroppingPositions(state, report);

  if (!Number.isFinite(field.lastTickAt) || field.lastTickAt <= 0) {
    field.lastTickAt = now;
    for (const c of state.creatures) field.lastDroppingAge[c.id] = Math.max(0, c.life.ageMs);
    if (state.owned.includes('cleaningRobot')) field.lastRobotCleanAt = now;
    return report;
  }

  const raw = now - field.lastTickAt;
  if (raw <= 0) {
    field.lastTickAt = now;
    return report;
  }

  const elapsed = Math.min(raw, TIMING.maxOfflineMs);
  const sec = elapsed / 1000;
  const passives = ownedPassives(state);
  const cleanlinessMul = passiveMultiplier(passives.cleanlinessDecay);
  const beforeCleanliness = field.cleanliness;
  const baseDecay = FIELD.cleanlinessDecayPerSec * sec * cleanlinessMul;
  const droppingDecay = field.droppings.length * FIELD.droppingDirtPerSec * sec * cleanlinessMul;
  field.cleanliness = clamp100(field.cleanliness - baseDecay - droppingDecay, 100);
  if (Math.abs(beforeCleanliness - field.cleanliness) > 0.0001) report.changed = true;

  // 配置したごはん箱・水飲み場は、眺めるだけでなく生活設備として働く。
  // 2分ごとの境界を seed でずらして判定するため、tick 頻度や再読み込みに依存しない。
  const serviceInterval = 120_000;
  for (const c of liveCreatures(state)) {
    const offset = Math.floor(unit(`${c.seed}:field-service`) * serviceInterval);
    const beforeService = Math.floor((field.lastTickAt + offset) / serviceInterval);
    const afterService = Math.floor((field.lastTickAt + elapsed + offset) / serviceInterval);
    const services = Math.min(3, Math.max(0, afterService - beforeService));
    if (services <= 0) continue;
    if (hasPlacedKind(state, 'food') && c.life.hunger < 96) {
      c.life.hunger = clamp100(c.life.hunger + services * 8, c.life.hunger);
      report.changed = true;
    }
    if (hasPlacedKind(state, 'water') && c.life.hydration < 96) {
      c.life.hydration = clamp100(c.life.hydration + services * 8, c.life.hydration);
      report.changed = true;
    }
  }

  const liveIds = new Set(liveCreatures(state).map((c) => c.id));
  for (const key of Object.keys(field.lastDroppingAge)) {
    if (!state.creatures.some((c) => c.id === key)) delete field.lastDroppingAge[key];
  }

  for (const c of state.creatures) {
    const currentAge = Math.max(0, c.life.ageMs);
    const previousAge = Number.isFinite(field.lastDroppingAge[c.id])
      ? Math.max(0, field.lastDroppingAge[c.id]!)
      : currentAge;

    // 卵の期間は排泄しない。孵化した瞬間に過去の卵期間ぶんをまとめて出さない。
    if (c.life.stage === 'egg') {
      field.lastDroppingAge[c.id] = currentAge;
      continue;
    }

    const interval = droppingInterval(c);
    const from = Math.floor(previousAge / interval);
    const to = Math.floor(currentAge / interval);
    const crossings = Math.max(0, to - from);
    // 長時間放置でも一回の復帰で大量に増やさず、直近の出来事だけ残す。
    const first = Math.max(from + 1, to - Math.min(crossings, 3) + 1);
    for (let occurrence = first; occurrence <= to; occurrence++) {
      if (field.droppings.length >= FIELD.maxDroppings) break;
      const pos = dropPosition(c, occurrence, field.droppings);
      field.droppings.push({
        id: `dropping-${c.id}-${occurrence}`,
        creatureId: c.id,
        x: pos.x,
        y: pos.y,
        createdAt: c.bornAt + Math.max(0, occurrence * interval),
      });
      report.addedDroppings += 1;
      report.changed = true;
    }
    if (field.lastDroppingAge[c.id] !== currentAge) {
      field.lastDroppingAge[c.id] = currentAge;
    }
  }

  // ロボットは一定間隔で最も古い汚れから一つずつ片付ける。買った直後の過去分は遡及しない。
  if (state.owned.includes('cleaningRobot')) {
    if (!Number.isFinite(field.lastRobotCleanAt) || field.lastRobotCleanAt <= 0) field.lastRobotCleanAt = now;
    const robotElapsed = Math.max(0, now - field.lastRobotCleanAt);
    const cleanCount = Math.min(field.droppings.length, Math.floor(robotElapsed / FIELD.robotCleanIntervalMs));
    if (cleanCount > 0) {
      field.droppings.splice(0, cleanCount);
      field.lastRobotCleanAt += cleanCount * FIELD.robotCleanIntervalMs;
      report.removedDroppings += cleanCount;
      report.changed = true;
    }
  } else if (field.lastRobotCleanAt !== 0) {
    field.lastRobotCleanAt = 0;
  }

  // 汚れは個体の清潔度にもゆっくり伝わる。清掃すれば自然に回復できるが、
  // フィールドを放置しても即座に瀕死にはならないよう小さく設定する。
  if (field.droppings.length > 0) {
    const dirt = FIELD.creatureDirtPerSec * sec * Math.min(3, field.droppings.length / 4) * cleanlinessMul;
    for (const c of state.creatures) {
      const before = c.life.cleanliness;
      c.life.cleanliness = clamp100(c.life.cleanliness - dirt, c.life.cleanliness);
      if (Math.abs(before - c.life.cleanliness) > 0.0001) report.changed = true;
    }
  }

  field.lastTickAt = now;
  // 売却・手放し後の個体を古いマップに残さない。
  for (const id of Object.keys(field.lastDroppingAge)) {
    if (!liveIds.has(id) && !state.creatures.some((c) => c.id === id)) delete field.lastDroppingAge[id];
  }
  return report;
}

/** フィールドをプレイヤーが掃除する。 */
export function cleanField(state: GameState, now: number): { ok: boolean; cleaned: number; reason?: string } {
  noteNow(now);
  const count = state.field.droppings.length;
  if (count === 0 && state.field.cleanliness >= 99) {
    return { ok: false, cleaned: 0, reason: 'フィールドは もう きれいです。' };
  }

  state.field.droppings = [];
  state.field.cleanliness = clamp100(state.field.cleanliness + FIELD.cleanRecovery + count * 4, 100);
  for (const c of state.creatures) {
    c.life.cleanliness = clamp100(c.life.cleanliness + Math.min(14, 4 + count), c.life.cleanliness);
  }
  state.field.lastRobotCleanAt = state.owned.includes('cleaningRobot') ? now : state.field.lastRobotCleanAt;
  state.updatedAt = now;
  return { ok: true, cleaned: count };
}

/** フィールド上の排泄物を一つだけ掃除する。クリック操作用。 */
export function cleanDropping(
  state: GameState,
  droppingId: string,
  now: number,
): { ok: boolean; cleaned: number; reason?: string } {
  noteNow(now);
  const index = state.field.droppings.findIndex((drop) => drop.id === droppingId);
  if (index < 0) return { ok: false, cleaned: 0, reason: 'その汚れは もうありません。' };

  const [drop] = state.field.droppings.splice(index, 1);
  state.field.cleanliness = clamp100(state.field.cleanliness + 5, 100);
  const creature = state.creatures.find((c) => c.id === drop?.creatureId);
  if (creature) creature.life.cleanliness = clamp100(creature.life.cleanliness + 2, creature.life.cleanliness);
  state.updatedAt = now;
  return { ok: true, cleaned: 1 };
}

/** フィールド配置モードから遊具を置く。配置先は 12 スロットのいずれか。 */
export function placeFieldItem(
  state: GameState,
  itemId: string,
  slot: number,
  now: number,
): { ok: boolean; reason?: string; placement?: FieldPlacement } {
  const item = SHOP_ITEM_BY_ID[itemId];
  if (!item || item.target !== 'field' || !item.fieldObject) {
    return { ok: false, reason: 'その品は フィールドに 置けません。' };
  }
  if (!state.owned.includes(itemId)) return { ok: false, reason: '先に ショップで 買ってください。' };
  if (!validSlot(slot)) return { ok: false, reason: 'そこには 置けません。' };
  if (state.field.placements.some((p) => p.itemId === itemId)) {
    return { ok: false, reason: 'その品は もう 配置ずみです。' };
  }
  if (state.field.placements.some((p) => p.slot === slot)) {
    return { ok: false, reason: 'そこには ほかの品が 置かれています。' };
  }
  const placement: FieldPlacement = { itemId, slot, placedAt: now };
  state.field.placements.push(placement);
  state.updatedAt = now;
  return { ok: true, placement };
}

/** 配置済みの遊具を外す。ショップの所有権は失わない。 */
export function removeFieldItem(
  state: GameState,
  itemId: string,
  now: number,
): { ok: boolean; reason?: string } {
  const index = state.field.placements.findIndex((p) => p.itemId === itemId);
  if (index < 0) return { ok: false, reason: 'その品は 配置されていません。' };
  state.field.placements.splice(index, 1);
  state.updatedAt = now;
  return { ok: true };
}

/** 壊れたセーブからも安全に使えるフィールド状態の初期値。 */
export function emptyFieldState(now = 0): FieldState {
  return {
    cleanliness: 100,
    droppings: [],
    placements: [],
    lastDroppingAge: {},
    lastTickAt: now,
    lastRobotCleanAt: 0,
  };
}

/** 現在の個体の状態を、フィールド表示用に一度に取得する補助関数。 */
export function fieldCreatureIds(state: GameState): string[] {
  return state.creatures.map((c) => c.id);
}
