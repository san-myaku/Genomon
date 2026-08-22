/**
 * 「森へ かえした子」の記録（UI 層が持つ観察ノート）。
 *
 * 枠の都合で手放した個体も、姿・血統・鑑定済みかどうかを標本帳へ残す。
 * Genotype は不変なのでそのまま保存し、鑑定状態は appraisedAt の時刻だけ保存する。
 */

import type { Creature, Genotype, LifeState, Stage } from '../core/types.ts';
import { appraisedAtOf } from './gameApi.ts';

const KEY = 'genomon.ui.released.v1';
const MAX = 40;

export interface ReleasedRecord {
  id: string;
  seed: string;
  name: string;
  stage: Stage;
  generation: number;
  parentNames: [string, string] | null;
  bestScore: number;
  exhibitionCount: number;
  careCount: number;
  bornAt: number;
  releasedAt: number;
  genotype: Genotype;
  /** 0/欠損なら未鑑定。旧記録との後方互換のため optional。 */
  appraisedAt?: number;
}

function isRecord(v: unknown): v is ReleasedRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<ReleasedRecord>;
  const g = r.genotype as Partial<Genotype> | undefined;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.seed === 'string' &&
    (r.stage === 'egg' || r.stage === 'juvenile' || r.stage === 'adult') &&
    typeof g === 'object' &&
    g !== null &&
    typeof g.cat === 'object' &&
    g.cat !== null &&
    typeof g.num === 'object' &&
    g.num !== null
  );
}

export function loadReleased(): ReleasedRecord[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).sort((a, b) => b.releasedAt - a.releasedAt);
  } catch {
    return [];
  }
}

function write(list: ReleasedRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* 記録は補助なので、容量超過でも本編を止めない。 */
  }
}

export function recordRelease(c: Creature, now = Date.now()): void {
  const rec: ReleasedRecord = {
    id: c.id,
    seed: c.seed,
    name: c.name,
    stage: c.life.stage,
    generation: c.generation,
    parentNames: c.parentNames ? [c.parentNames[0], c.parentNames[1]] : null,
    bestScore: c.bestScore,
    exhibitionCount: c.exhibitionCount,
    careCount: c.life.careCount,
    bornAt: c.bornAt,
    releasedAt: now,
    genotype: c.genotype,
    appraisedAt: appraisedAtOf(c),
  };
  const list = loadReleased().filter((r) => r.id !== c.id);
  list.unshift(rec);
  write(list);
}

export function findReleasedById(id: string): ReleasedRecord | undefined {
  return loadReleased().find((r) => r.id === id);
}

export function releasedAsCreature(r: ReleasedRecord): Creature {
  const life: LifeState = {
    stage: r.stage,
    ageMs: Math.max(0, r.releasedAt - r.bornAt),
    growth: r.stage === 'adult' ? 100 : 60,
    hunger: 70,
    hydration: 70,
    cleanliness: 70,
    mood: 70,
    health: 70,
    hatchProgress: r.stage === 'egg' ? 50 : 100,
    careCount: r.careCount,
    lastCareAt: {},
    lastTickAt: r.releasedAt,
    restingUntil: 0,
  };
  const c: Creature = {
    id: r.id,
    seed: r.seed,
    name: r.name,
    genotype: r.genotype,
    life,
    parents: null,
    parentNames: r.parentNames,
    generation: r.generation,
    bornAt: r.bornAt,
    bestScore: r.bestScore,
    exhibitionCount: r.exhibitionCount,
    lastExhibitAt: 0,
    lastBredAt: 0,
    favorite: false,
    fromBreeding: r.parentNames !== null,
  };
  (c as Creature & { appraisedAt?: number }).appraisedAt = r.appraisedAt ?? 0;
  return c;
}

export function releasedDateLabel(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${two(d.getHours())}:${two(d.getMinutes())}`;
}
