/**
 * 「森へ かえした子」の記録（UI 層が持つ観察ノート）。
 *
 * 【なぜ要るのか】
 *   本作の副題は「小さな生きものの観察帳」で、標本帳は「記録」だと説明している。
 *   ところが枠は各段階 3 体しかなく、交配で子が生まれるたびに親を手放すことになる。
 *   手放すと個体は state.creatures から消えるので、
 *   **続けるほど記録が減っていく観察帳** になっていた。
 *   手放しの確認文が「この子は もう 戻ってきません」と丁寧なぶん、
 *   そのあと何も残らないことが強く効いてしまう。
 *
 * 【置き場所】
 *   - セーブ本体（genomon.save.v1）のスキーマは変えない（リード所有）。
 *   - GameState.future は将来のオンライン機能用の予約領域なので流用しない。
 *   → UI が自分の localStorage キーに、自分の責任で持つ。
 *     読めなくても・書けなくてもゲームは動く（ここが落ちても本編に波及しない）。
 *
 * 【姿を残すために遺伝情報ごと保存する】
 *   seed だけでは姿を再現できない（交配で生まれた子の遺伝子は親の組み合わせで決まる）。
 *   Genotype は不変・純データなのでそのまま持つ。1 体あたり 1.5KB 程度。
 *
 * 【鑑定状態も残す】
 *   鑑定はコインを払う一度きりの操作なので、手放した記録から消えると
 *   「払った証拠が無くなった」ことになる。appraisedAt の時刻だけ保存する。
 */

import type { Creature, Genotype, LifeState, Stage } from '../core/types.ts';
import { appraisedAtOf } from './gameApi.ts';

/** UI 所有のキー。セーブ本体（genomon.save.v1）とは無関係。 */
const KEY = 'genomon.ui.released.v1';
/** 残す上限。古いものから捨てる（localStorage を食いつぶさないため）。 */
const MAX = 40;

export interface ReleasedRecord {
  /** 手放した時点の個体 ID。親の照合に使う。 */
  id: string;
  seed: string;
  name: string;
  /** 手放したときの段階。 */
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

/** 壊れた JSON・別バージョンの残骸を読んでも落ちないよう、形だけ確かめる。 */
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

/** 記録を読む（新しい順）。読めなければ空配列。 */
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
    /* 容量超過・プライベートモード。記録は補助なので黙って諦める（本編は続く）。 */
  }
}

/** 手放した個体を記録する。releaseCreature が成功した直後に呼ぶ。 */
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

/** ID から記録を探す（親子比較で、手もとにいない親を復元するのに使う）。 */
export function findReleasedById(id: string): ReleasedRecord | undefined {
  return loadReleased().find((r) => r.id === id);
}

/**
 * 記録を Creature の形に組み直す。
 *
 * getPhenotype / thumbSvg は Creature を受け取る契約なので、
 * 表示に必要なだけの最小の個体を作る。state には決して入れない（読み取り専用の影）。
 * 体調は「元気だったころ」の中庸な値にする（手放した瞬間の空腹まで再現する必要はない）。
 */
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

/** 「7月28日 12:30」のような短い日付。記録は「いつ」が入って初めて記録になる。 */
export function releasedDateLabel(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${two(d.getHours())}:${two(d.getMinutes())}`;
}
