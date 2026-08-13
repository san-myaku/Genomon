/**
 * 飼育員の募集・雇用・自動世話。
 *
 * 候補者は worldSeed と募集回数から決める。UI を開く順番や描画回数で候補が
 * 入れ替わらないよう、Math.random() と現在時刻由来の乱数は使わない。
 */

import type { Creature, GameState, StaffCandidate, StaffRole } from '../core/types.ts';
import { Rng, clamp } from '../core/rng.ts';
import { STAFF } from './config.ts';
import { gameNow, noteNow } from './state.ts';

export interface StaffTickReport {
  serviced: number;
  paid: number;
  wageDue: number;
  changed: boolean;
  event: boolean;
  dismissed: boolean;
}

const NAMES = [
  'こけだに まゆ',
  '水野 しずく',
  '葉山 つむぎ',
  '小石川 ねね',
  '森下 ルカ',
  '朝倉 すみれ',
] as const;

const PROFILES = [
  '温室の植物を 世話してきた。小さな変化を 見逃さない。',
  '動物病院の 受付経験がある。記録と 声かけが とくい。',
  'ゲノモンの 生態を 独学中。観察ノートが いつも分厚い。',
  '農園育ち。掃除と 水やりは 手早いが、少し大ざっぱ。',
  '標本整理の 手伝いをしていた。分類と 比較が すき。',
  '前職は おもちゃ職人。遊び相手になるのが いちばん得意。',
] as const;

const REASONS = [
  '生きものの そばで働きたい。',
  'いつか 自分の温室を 持ちたい。',
  '毎日の 変化を 記録したい。',
  '土と 苔のにおいが すき。',
  '世話を通じて 友だちを 増やしたい。',
  '「かわいい」を 仕事にしたい。',
] as const;

const QUIRKS = [
  '世話の前に 必ず名前を呼ぶ。',
  '掃除道具を きれいに並べる。',
  'たまに 独自の歌を うたいながら働く。',
  '記録に 小さな絵を 添える。',
  'おやつの減りを かなり気にする。',
  '遊びの時間だけ 急に元気になる。',
] as const;

function roleConfig(role: StaffRole) {
  return role === 'fullTime' ? STAFF.fullTime : STAFF.partTime;
}

function roleLabel(role: StaffRole): string {
  return role === 'fullTime' ? '正規雇用' : 'アルバイト';
}

function clampStat(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 100);
}

function addStat(c: Creature, key: 'hunger' | 'hydration' | 'cleanliness' | 'mood' | 'health', amount: number): void {
  c.life[key] = clampStat(c.life[key] + amount);
}

/** 現在の募集候補を作る。候補が残っている場合は入れ替えない。 */
export function refreshStaffCandidates(state: GameState, now = gameNow()): StaffCandidate[] {
  noteNow(now);
  if (!state.unlocks.staff || state.staff.hiredId !== null) return state.staff.candidates;
  if (state.staff.candidates.length > 0) return state.staff.candidates;

  const cycle = Math.max(0, Math.floor(state.staff.candidateCycle));
  const rng = new Rng(`${state.worldSeed}:staff:${cycle}`);
  const candidates: StaffCandidate[] = [];
  for (let i = 0; i < STAFF.candidateCount; i++) {
    const role: StaffRole = i === 1 ? 'fullTime' : i === 0 ? 'partTime' : rng.bool(0.42) ? 'fullTime' : 'partTime';
    const cfg = roleConfig(role);
    const skill = role === 'fullTime' ? rng.float(0.86, 1.28) : rng.float(0.72, 1.16);
    const reliability = rng.float(0.78, 0.98);
    const name = NAMES[rng.int(0, NAMES.length - 1)]!;
    candidates.push({
      id: `staff-${cycle}-${i}-${rng.int(100, 999)}`,
      name,
      role,
      wage: cfg.wage,
      skill: Math.round(skill * 100) / 100,
      reliability: Math.round(reliability * 100) / 100,
      profile: PROFILES[rng.int(0, PROFILES.length - 1)]!,
      reason: REASONS[rng.int(0, REASONS.length - 1)]!,
      quirk: QUIRKS[rng.int(0, QUIRKS.length - 1)]!,
    });
  }
  state.staff.candidates = candidates;
  state.updatedAt = now;
  return candidates;
}

/** 今回の候補を見送り、決定論的に次の募集を出す。 */
export function rerollStaffCandidates(
  state: GameState,
  now = gameNow(),
): { ok: boolean; reason?: string; candidates?: StaffCandidate[] } {
  noteNow(now);
  if (!state.unlocks.staff) return { ok: false, reason: '飼育員の 募集は まだ 解放されていません。' };
  if (state.staff.hiredId !== null) return { ok: false, reason: '雇用中は 新しい募集を 出せません。' };
  state.staff.candidates = [];
  state.staff.candidateCycle += 1;
  const candidates = refreshStaffCandidates(state, now);
  return { ok: true, candidates };
}

/** 候補者を雇う。採用費は一度だけ、給与は以後の周期ごとに引かれる。 */
export function hireStaff(
  state: GameState,
  candidateId: string,
  now = gameNow(),
): { ok: boolean; reason?: string; candidate?: StaffCandidate } {
  noteNow(now);
  if (!state.unlocks.staff) return { ok: false, reason: '飼育員の 募集は まだ 解放されていません。' };
  if (state.staff.hiredId !== null) return { ok: false, reason: 'すでに 飼育員を 雇っています。' };
  const candidate = state.staff.candidates.find((item) => item.id === candidateId);
  if (!candidate) return { ok: false, reason: 'その候補者は もう 募集にいません。' };
  const cfg = roleConfig(candidate.role);
  if (state.coins < cfg.hiringFee) {
    return { ok: false, reason: `採用費が ${cfg.hiringFee - state.coins} コイン たりません。` };
  }
  state.coins -= cfg.hiringFee;
  state.staff.hiredId = candidate.id;
  state.staff.hiredAt = now;
  state.staff.lastServiceAt = now;
  state.staff.lastPaidAt = now;
  state.staff.unpaidSince = 0;
  state.updatedAt = now;
  return { ok: true, candidate };
}

/** 飼育員を解雇する。すでに支払った採用費・給与は戻らない。 */
export function dismissStaff(state: GameState, now = gameNow()): { ok: boolean; reason?: string } {
  noteNow(now);
  if (state.staff.hiredId === null) return { ok: false, reason: '雇用中の 飼育員はいません。' };
  state.staff.hiredId = null;
  state.staff.hiredAt = 0;
  state.staff.lastServiceAt = 0;
  state.staff.lastPaidAt = 0;
  state.staff.unpaidSince = 0;
  state.staff.candidates = [];
  state.staff.candidateCycle += 1;
  state.updatedAt = now;
  return { ok: true };
}

/** 雇用中の候補を返す。壊れた参照は null として扱う。 */
export function hiredStaff(state: GameState): StaffCandidate | null {
  if (!state.staff.hiredId) return null;
  return state.staff.candidates.find((candidate) => candidate.id === state.staff.hiredId) ?? null;
}

function needsScore(c: Creature): number {
  if (c.life.stage === 'egg') return -1;
  return Math.max(
    100 - c.life.hunger,
    100 - c.life.hydration,
    100 - c.life.cleanliness,
    100 - c.life.mood,
  );
}

/** 1 回の巡回で、足りない個体から順に自動で世話する。 */
function serviceOnce(state: GameState, candidate: StaffCandidate, serviceIndex: number, now: number): number {
  const cfg = roleConfig(candidate.role);
  const targets = state.creatures
    .filter((c) => c.life.stage !== 'egg')
    .slice()
    .sort((a, b) => needsScore(b) - needsScore(a) || a.id.localeCompare(b.id))
    .slice(0, cfg.coverage);
  let serviced = 0;
  for (const c of targets) {
    // 能力の揺らぎも保存済みの候補者から決定する。同じ世話をしても、
    // 「今日は水やりだけ丁寧」などの小さな個性が出る。
    const rng = new Rng(`${candidate.id}:service:${Math.floor(now / cfg.serviceIntervalMs)}:${serviceIndex}:${c.id}`);
    const quality = candidate.skill * (rng.bool(candidate.reliability) ? 1 : 0.48);
    addStat(c, 'hunger', cfg.hunger * quality);
    addStat(c, 'hydration', cfg.hydration * quality);
    addStat(c, 'cleanliness', cfg.cleanliness * quality);
    addStat(c, 'mood', cfg.mood * quality);
    addStat(c, 'health', cfg.health * quality);
    c.life.careCount += 1;
    c.life.lastCareAt.staff = now;
    serviced += 1;
  }
  return serviced;
}

/** 経過時間分の巡回と給与を一度だけ適用する。applyTick から呼ぶ。 */
export function advanceStaff(state: GameState, now: number): StaffTickReport {
  noteNow(now);
  const report: StaffTickReport = { serviced: 0, paid: 0, wageDue: 0, changed: false, event: false, dismissed: false };
  if (!state.unlocks.staff) return report;

  const candidate = hiredStaff(state);
  if (!candidate) {
    refreshStaffCandidates(state, now);
    return report;
  }

  const cfg = roleConfig(candidate.role);
  if (!Number.isFinite(state.staff.lastServiceAt) || state.staff.lastServiceAt <= 0) state.staff.lastServiceAt = now;
  if (!Number.isFinite(state.staff.lastPaidAt) || state.staff.lastPaidAt <= 0) state.staff.lastPaidAt = now;

  const serviceElapsed = Math.max(0, now - state.staff.lastServiceAt);
  const serviceCount = Math.min(6, Math.floor(serviceElapsed / cfg.serviceIntervalMs));
  for (let i = 0; i < serviceCount; i++) {
    report.serviced += serviceOnce(state, candidate, i, now);
  }
  if (serviceCount > 0) {
    state.staff.lastServiceAt += serviceCount * cfg.serviceIntervalMs;
    state.stats.staffCareActions += report.serviced;
    report.changed = true;
    report.event = report.serviced > 0;
  }

  const payElapsed = Math.max(0, now - state.staff.lastPaidAt);
  const payCount = Math.min(12, Math.floor(payElapsed / STAFF.payIntervalMs));
  const due = payCount * candidate.wage;
  report.wageDue = due;
  if (payCount > 0) {
    if (state.coins >= due) {
      state.coins -= due;
      state.staff.lastPaidAt += payCount * STAFF.payIntervalMs;
      state.staff.unpaidSince = 0;
      report.paid = due;
      report.changed = true;
      report.event = true;
    } else {
      if (!state.staff.unpaidSince) state.staff.unpaidSince = now;
      report.changed = true;
      report.event = true;
      if (now - state.staff.unpaidSince >= STAFF.unpaidGraceMs) {
        dismissStaff(state, now);
        report.dismissed = true;
      }
    }
  }

  if (report.changed) state.updatedAt = now;
  return report;
}

export function staffRoleLabel(role: StaffRole): string {
  return roleLabel(role);
}

export function staffConfig(role: StaffRole): {
  hiringFee: number;
  wage: number;
  serviceIntervalMs: number;
  coverage: number;
} {
  const cfg = roleConfig(role);
  return {
    hiringFee: cfg.hiringFee,
    wage: cfg.wage,
    serviceIntervalMs: cfg.serviceIntervalMs,
    coverage: cfg.coverage,
  };
}
