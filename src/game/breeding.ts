/**
 * 交配（ゲーム進行側）。
 *
 * 遺伝の計算そのものは genetics/breeding.ts が持つ。
 * ここが受け持つのは「交配してよいか」「コストと機嫌の後始末」「日本語の予想表示」。
 *
 * 【クールダウンの保存】
 *   Creature.lastBredAt（0 = 未交配）に持つ。セーブ v4 で保存されるので、
 *   リロードしてもクールダウンは維持される（＝再読み込みによる連続量産ができない）。
 */

import type { CatLocus, Creature, GameState } from '../core/types.ts';
import { CAT_LOCUS_BY_ID, alleleDef, alleleLabel, breed } from '../genetics/index.ts';
import { nextSeed } from '../save/index.ts';
import { BREEDING } from './config.ts';
import { getPhenotype } from './phenoCache.ts';
import { createCreature, findCreature, gameNow, hasRoomFor, noteNow } from './state.ts';

/** 残りクールダウン（ms）。0 なら交配できる。 */
export function breedCooldownLeft(c: Creature, now: number): number {
  const last = c.lastBredAt;
  if (!Number.isFinite(last) || last <= 0) return 0;
  return Math.max(0, BREEDING.cooldownMs - (now - last));
}

// ─────────────────────────────────────────────────────────
//  可否判定
// ─────────────────────────────────────────────────────────

/**
 * 交配できるか。
 * API.md の signature に now が無いので、時刻は state.gameNow()（最後に tick が見た時刻）を使う。
 */
export function canBreed(state: GameState, aId: string, bId: string): { ok: boolean; reason?: string } {
  if (!state.unlocks.breeding) {
    return { ok: false, reason: '交配は まだ 解放されていません。' };
  }
  if (aId === bId) {
    return { ok: false, reason: 'おなじ子どうしでは 交配できません。2 体 えらんでください。' };
  }

  const a = findCreature(state, aId);
  const b = findCreature(state, bId);
  if (!a || !b) return { ok: false, reason: 'えらんだ子が 見つかりません。' };

  for (const c of [a, b]) {
    if (c.life.stage !== BREEDING.requiredStage) {
      return { ok: false, reason: `${c.name} は まだ 成体では ありません。` };
    }
  }
  for (const c of [a, b]) {
    if (c.life.mood < BREEDING.minMood) {
      return {
        ok: false,
        reason: `${c.name} の 機嫌が たりません（${Math.floor(c.life.mood)} / ${BREEDING.minMood}）。なでたり あそんだり しましょう。`,
      };
    }
    if (c.life.health < BREEDING.minHealth) {
      return {
        ok: false,
        reason: `${c.name} の 健康が たりません（${Math.floor(c.life.health)} / ${BREEDING.minHealth}）。やすませましょう。`,
      };
    }
  }

  const now = gameNow();
  for (const c of [a, b]) {
    const left = breedCooldownLeft(c, now);
    if (left > 0) {
      return { ok: false, reason: `${c.name} は 休息中です（あと ${Math.ceil(left / 1000)} 秒）。` };
    }
  }

  if (state.coins < BREEDING.costCoins) {
    return {
      ok: false,
      reason: `コインが たりません（${state.coins} / ${BREEDING.costCoins}）。展示会で かせぎましょう。`,
    };
  }
  if (!hasRoomFor(state, 'egg')) {
    return {
      ok: false,
      reason: '卵の枠が いっぱいです。孵してから、または どれかを 手放してから もう一度。',
    };
  }

  return { ok: true };
}

/** 交配できる組み合わせを探す（UI の候補表示・nextObjective 用）。 */
export function findBreedablePair(state: GameState): [Creature, Creature] | null {
  const adults = state.creatures.filter((c) => c.life.stage === BREEDING.requiredStage);
  for (let i = 0; i < adults.length; i++) {
    for (let j = i + 1; j < adults.length; j++) {
      const a = adults[i];
      const b = adults[j];
      if (a && b && canBreed(state, a.id, b.id).ok) return [a, b];
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────
//  実行
// ─────────────────────────────────────────────────────────

/** 交配して卵を 1 つ産む。 */
export function doBreed(
  state: GameState,
  aId: string,
  bId: string,
  now: number,
): { ok: boolean; eggId?: string; reason?: string } {
  noteNow(now);

  const check = canBreed(state, aId, bId);
  if (!check.ok) return { ok: false, reason: check.reason };

  const a = findCreature(state, aId);
  const b = findCreature(state, bId);
  if (!a || !b) return { ok: false, reason: 'えらんだ子が 見つかりません。' };

  // 子の seed はセーブ側の採番規則に任せる（ロード後の seed 衝突を防ぐため）。
  const childSeed = nextSeed(state);
  const genotype = breed(a.genotype, b.genotype, childSeed);

  const egg = createCreature(state, genotype, now, {
    parents: [a.id, b.id] as const,
    parentNames: [a.name, b.name] as const,
    generation: Math.max(a.generation, b.generation) + 1,
    fromBreeding: true,
  });
  state.creatures.push(egg);

  state.coins -= BREEDING.costCoins;
  state.stats.bred += 1;

  // 連発への自然なブレーキ。機嫌が下がるので、また世話をする理由になる。
  // lastBredAt は Creature に持つ＝セーブされるので、リロードでは回避できない。
  for (const parent of [a, b]) {
    parent.life.mood = Math.max(0, parent.life.mood * BREEDING.parentMoodAfter);
    parent.lastBredAt = now;
  }

  state.updatedAt = now;
  return { ok: true, eggId: egg.id };
}

// ─────────────────────────────────────────────────────────
//  予想表示（交配画面のプレビュー）
// ─────────────────────────────────────────────────────────

/** プレビューに出す遺伝子座（見た目の印象を決める順）。 */
const PREVIEW_LOCI: readonly CatLocus[] = [
  'base',
  'palette',
  'pattern',
  'texture',
  'silhouette',
  'eyeShape',
  'eyeCount',
  'pupil',
  'ears',
  'horns',
  'plant',
  'wings',
  'tail',
  'crystal',
  'collar',
  'antennae',
  'floaters',
  'mouth',
  'feet',
];

interface PairOutcome {
  /** 発現しうる表現のラベル。 */
  labels: string[];
  /** 表に出ず「保因」される可能性のある対立遺伝子ラベル。 */
  carriers: string[];
  /** 珍しい形質が出る可能性があるか。 */
  notable: boolean;
}

/**
 * 対立遺伝子ペア 1 組の発現を予想する。
 * genetics/phenotype.ts の表現規則（優性度が高い方・同値かつ共優性なら合成）と同じ判定を、
 * 「seed が無い状態」で行うため、同値ヘテロは **両方の可能性** を返す。
 */
function outcomeOfPair(locus: CatLocus, x: string, y: string, out: PairOutcome): void {
  const def = CAT_LOCUS_BY_ID[locus];
  const dx = alleleDef(locus, x);
  const dy = alleleDef(locus, y);
  const push = (label: string, notable?: boolean): void => {
    if (!out.labels.includes(label)) out.labels.push(label);
    if (notable) out.notable = true;
  };
  const carry = (id: string): void => {
    const label = alleleLabel(locus, id);
    if (!out.carriers.includes(label)) out.carriers.push(label);
  };

  if (!dx || !dy) {
    push(alleleLabel(locus, x));
    return;
  }
  if (x === y) {
    push(dx.label, dx.notable);
    return;
  }
  if (dx.dominance !== dy.dominance) {
    const win = dx.dominance > dy.dominance ? dx : dy;
    const lose = dx.dominance > dy.dominance ? dy : dx;
    push(win.label, win.notable);
    carry(lose.id);
    return;
  }
  // 同じ優性度。共優性の合成表現が定義されていれば混ざる。
  if (locus !== 'base' && dx.coDominant && dy.coDominant) {
    const co = def.coExpress?.[`${x}+${y}`] ?? def.coExpress?.[`${y}+${x}`];
    if (co) {
      push(`${dx.label}＋${dy.label}`, dx.notable || dy.notable);
      return;
    }
  }
  // 合成が無ければ、どちらが出るかは子の seed 次第。両方を可能性として出す。
  push(dx.label, dx.notable);
  push(dy.label, dy.notable);
  carry(dx.id);
  carry(dy.id);
}

/** 交配画面のプレビュー: 子に受け継がれる可能性がある特徴の日本語説明。 */
export function breedingPreview(a: Creature, b: Creature): { label: string; detail: string }[] {
  const rows: { label: string; detail: string; score: number }[] = [];

  for (const locus of PREVIEW_LOCI) {
    const pa = a.genotype.cat[locus];
    const pb = b.genotype.cat[locus];
    if (!pa || !pb) continue;

    const out: PairOutcome = { labels: [], carriers: [], notable: false };
    // 減数分裂で作られうる 4 通りの組み合わせをすべて見る。
    for (const x of pa) {
      for (const y of pb) outcomeOfPair(locus, x, y, out);
    }
    if (out.labels.length === 0) continue;

    // 表に出る側から消えた保因だけを残す（両親が同じホモなら保因は無い）。
    const carriers = out.carriers.filter((c) => !out.labels.includes(c));

    const shown = out.labels.slice(0, 4).map((l) => `『${l}』`).join(' か ');
    let detail =
      out.labels.length === 1 ? `かならず ${shown} に なります。` : `${shown} の どれかが 出ます。`;
    if (carriers.length > 0) {
      detail += ` ${carriers.slice(0, 3).map((c) => `『${c}』`).join('・')} を かくして 持つ ことも あります。`;
    }
    if (out.notable) detail += ' めずらしい 形質が 出る 可能性が あります。';

    // 面白い行から見せる: 珍しい > 選択肢が多い > 保因がある。
    const score =
      (out.notable ? 6 : 0) + (out.labels.length > 1 ? 3 : 0) + (carriers.length > 0 ? 2 : 0);
    rows.push({ label: CAT_LOCUS_BY_ID[locus].label, detail, score });
  }

  rows.sort((p, q) => q.score - p.score);
  const top = rows.slice(0, 6).map(({ label, detail }) => ({ label, detail }));

  // ── 数値形質・性格は「両親の間に寄る」ので、まとめて 1 行ずつ添える ──
  const pa = getPhenotype(a, 'adult');
  const pb = getPhenotype(b, 'adult');

  const sizeWord = pa.size === pb.size ? '両親と おなじくらい' : '両親の あいだくらい';
  top.push({
    label: '大きさ・色あい',
    detail: `${sizeWord}に なりやすい。色は 『${pa.palette.family === pb.palette.family ? pa.traits.find((t) => t.locus === 'palette')?.value ?? '同じ配色' : 'どちらかの配色'}』の 系統。`,
  });

  top.push({
    label: '性格',
    detail: `${a.name} は「${pa.personality.label}」、${b.name} は「${pb.personality.label}」。子は その あいだに 寄ります。`,
  });

  top.push({
    label: 'とつぜん変異',
    detail: 'まれに どちらの親にも ない 形質が 出ることが あります。系統に 無い色や かたちは その しるし。',
  });

  return top;
}
