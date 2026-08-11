/**
 * 表示用の書式・日本語ラベル。
 * 「同じ概念は必ず同じ言葉で出す」ための正本。
 */

import type { CareAction, Creature, LifeState, RarityTier, Stage } from '../core/types.ts';

export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  egg: 'たまご',
  juvenile: 'ようたい',
  adult: 'せいたい',
};

export const STAGE_ICON: Readonly<Record<Stage, string>> = {
  egg: 'egg',
  juvenile: 'hatch',
  adult: 'leaf',
};

export const RARITY_LABEL: Readonly<Record<RarityTier, string>> = {
  common: 'ふつう',
  uncommon: 'めずらしい',
  rare: 'とてもめずらしい',
  precious: '至宝',
};

export const REACTION_LABEL: Readonly<Record<string, string>> = {
  delighted: 'とても よろこんでいる',
  happy: 'よろこんでいる',
  neutral: 'おだやか',
  dislike: 'いやがっている',
  sleepy: 'ねむそう',
  full: 'もう じゅうぶんみたい',
};

/** 世話アクション → 効果音の名前。 */
export const CARE_SFX: Readonly<Record<CareAction, 'feed' | 'drink' | 'clean' | 'pet' | 'play' | 'rest' | 'tap' | 'eggWobble'>> = {
  warm: 'eggWobble',
  moisten: 'drink',
  talk: 'tap',
  touch: 'pet',
  tidyEnv: 'clean',
  feed: 'feed',
  water: 'drink',
  clean: 'clean',
  pet: 'pet',
  play: 'play',
  rest: 'rest',
};

/*
 * 世話ボタンのラベル・アイコン・説明は game 側の CARE_DEFS が正本。
 * `src/game/index.ts` が UI 向けに再輸出しているので、UI は gameApi 経由でそれを使う。
 * ここに複製を置くと必ず食い違うので、置かない。
 */

/** ショップの品目カテゴリ → アイコン。 */
export const ITEM_ICON: Readonly<Record<string, string>> = {
  food: 'jar',
  drink: 'drop',
  care: 'feather',
  growth: 'sprout',
  health: 'flask',
  decor: 'vase',
  equipment: 'gear',
};

/** 育成室の背景に足す装飾（購入した品が見た目に反映される）。 */
export const DECOR_VIEW: Readonly<Record<string, { cls: string; glyph: string; label: string }>> = {
  sunnyLamp: { cls: 'decor--lamp', glyph: 'lamp', label: '陽だまりランプ' },
  specimenShelf: { cls: 'decor--shelf', glyph: 'shelf', label: '標本帳の書棚' },
  glassPlanter: { cls: 'decor--planter', glyph: 'pot', label: '硝子の温室鉢' },
  mistCirculator: { cls: 'decor--mist', glyph: 'mist', label: '循環霧散器' },
  sunbedIncubator: { cls: 'decor--incubator', glyph: 'bed', label: '日輪の保温床' },
};

/** ゲージの見出し（育成室・個体詳細で共有）。 */
export interface GaugeDef {
  key: keyof LifeState;
  label: string;
  icon: string;
}

export const GAUGES_LIVE: readonly GaugeDef[] = [
  { key: 'hunger', label: 'おなか', icon: 'bowl' },
  { key: 'hydration', label: 'みず', icon: 'drop' },
  { key: 'cleanliness', label: 'きれいさ', icon: 'bubbles' },
  { key: 'mood', label: 'きげん', icon: 'balloon' },
  { key: 'health', label: 'けんこう', icon: 'pulse' },
  { key: 'growth', label: 'せいちょう', icon: 'chart' },
];

export const GAUGES_EGG: readonly GaugeDef[] = [
  { key: 'hatchProgress', label: 'ふかまで', icon: 'egg' },
  { key: 'hydration', label: 'みず', icon: 'drop' },
  { key: 'cleanliness', label: 'きれいさ', icon: 'bubbles' },
  { key: 'mood', label: 'きげん', icon: 'balloon' },
];

/** 0..100 の値を good / mid / low に分ける（色分けの正本）。 */
export function levelOf(v: number): 'good' | 'mid' | 'low' {
  if (v >= 60) return 'good';
  if (v >= 25) return 'mid';
  return 'low';
}

export const pct = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

/** コインなど整数の桁区切り。 */
export function num(v: number): string {
  return Math.round(v).toLocaleString('ja-JP');
}

/** 経過時間の日本語表記。 */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}時間` : `${h}時間${mm}分`;
}

/** 日時（保存インジケータなど）。 */
export function clockTime(t: number): string {
  const d = new Date(t);
  const p = (n2: number): string => String(n2).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 世代の表示（正本）。
 *
 * game/state.ts は最初に迎える卵を `generation: 1` で作る（＝1 始まり）。
 * 以前の UI は一律 `generation + 1` を出していたため、
 * 「カードは 2代目・系譜行は 初代」という矛盾が起きていた。
 * 世代を文字にするのは必ずこの関数を通すこと。
 */
export function generationLabel(gen: number): string {
  const g = Number.isFinite(gen) ? Math.max(1, Math.round(gen)) : 1;
  return g <= 1 ? '初代' : `${g}代目`;
}

/** 個体の一行説明（カードの副題）。 */
export function creatureCaption(c: Creature): string {
  return `${STAGE_LABEL[c.life.stage]} / ${generationLabel(c.generation)}`;
}

/**
 * 交配の必要条件（表示用の写し）。
 *
 * 正本は `src/game/config.ts` の `BREEDING`。ただし game は UI の所有外で、
 * 公開契約（`src/game/index.ts`）にも出ていないため、ここに写しを持つ。
 * **値を変えるときは両方を直すこと。**
 *
 * 可否の判定は必ず `canBreed()` を正とする。この写しは
 * 「いま何が足りないのか」を 1 つだけでなく全部並べて見せるためだけに使う。
 */
export const BREEDING_UI = {
  /** 交配 1 回のコイン。 */
  costCoins: 80,
  /** 両親に必要な機嫌。 */
  minMood: 60,
  /** 両親に必要な健康。 */
  minHealth: 60,
} as const;

/** 性格軸の表示定義（個体詳細のバー表示）。 */
export const PERSONALITY_AXES: readonly { key: 'energy' | 'affection' | 'curiosity' | 'dependence' | 'appetite' | 'tidiness'; lo: string; hi: string }[] = [
  { key: 'energy', lo: 'おとなしい', hi: '活発' },
  { key: 'affection', lo: '慎重', hi: '人懐こい' },
  { key: 'curiosity', lo: '警戒心', hi: '好奇心' },
  { key: 'dependence', lo: '自立的', hi: '甘えん坊' },
  { key: 'appetite', lo: '小食', hi: '食いしん坊' },
  { key: 'tidiness', lo: '気にしない', hi: 'きれい好き' },
];
