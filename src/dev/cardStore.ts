/**
 * Cards Lab 専用の localStorage 層。
 *
 * 【Visual Lab の設定を絶対に上書きしないこと】
 *   Visual Lab は `genomon.dev.prefs.v1` を正本にしている。Cards Lab が
 *   同じキーへ書くと、片方を触るたびにもう片方の seed や段階が飛ぶ。
 *   キーを分けるだけでなく、**このモジュールから PREFS_KEY を import しない**
 *   ことで、うっかり同じキーへ書く経路を作らない。
 *
 * 書き込みは labStore.ts の `putRaw` を通す。あちらが
 * `genomon.dev.` 接頭辞を実行時に検査するので、本体セーブを壊す経路が無い。
 */

import { dropRaw, getRaw, putRaw } from './labStore.ts';
import type { CardDesign, CardFinish, CardGrade } from './cardModel.ts';

const CARD_PREFIX = 'genomon.dev.';

/** Cards Lab の画面設定。 */
export const CARD_PREFS_KEY = `${CARD_PREFIX}cardprefs.v1`;
/** 「この組み合わせは良い」と思ったカード案。 */
export const CARD_SAVED_KEY = `${CARD_PREFIX}cardsaved.v1`;

export function loadCardPrefs<T extends object>(fallback: T): T {
  const raw = getRaw(CARD_PREFS_KEY);
  if (!raw) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fallback;
    return { ...fallback, ...(v as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function saveCardPrefs(prefs: object): void {
  putRaw(CARD_PREFS_KEY, JSON.stringify(prefs));
}

// ─────────────────────────────────────────────────────────
//  保存したカード案
// ─────────────────────────────────────────────────────────

export interface SavedCard {
  /** 個体 seed。 */
  seed: string;
  design: CardDesign;
  finish: CardFinish;
  grade: CardGrade;
  /** 見た目のつまみ一式（cardDesign.ts の CardVisuals と同じ形）。 */
  visuals: {
    foil: number;
    glare: number;
    tilt: number;
    depth: boolean;
    mask: boolean;
    security: boolean;
  };
  /** 演示の背景。 */
  bg: 'light' | 'dark';
  /** 自由メモ（なぜ良いと思ったか）。 */
  note: string;
  savedAt: number;
}

/** 保存の同一性。同じ個体でも design/finish が違えば別の案として残す。 */
function keyOf(c: Pick<SavedCard, 'seed' | 'design' | 'finish'>): string {
  return `${c.seed}::${c.design}::${c.finish}`;
}

export function loadSavedCards(): SavedCard[] {
  const raw = getRaw(CARD_SAVED_KEY);
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    // 壊れた要素は黙って捨てる（開発ツールが起動不能になる方が困る）。
    return v.filter((x): x is SavedCard => !!x && typeof (x as SavedCard).seed === 'string');
  } catch {
    return [];
  }
}

function putSavedCards(list: readonly SavedCard[]): void {
  putRaw(CARD_SAVED_KEY, JSON.stringify(list.slice(0, 200)));
}

/** 同じ seed+design+finish は上書きする（重複を溜めない）。 */
export function addSavedCard(entry: SavedCard): SavedCard[] {
  const list = loadSavedCards().filter((c) => keyOf(c) !== keyOf(entry));
  list.unshift(entry);
  putSavedCards(list);
  return list;
}

export function removeSavedCard(entry: Pick<SavedCard, 'seed' | 'design' | 'finish'>): SavedCard[] {
  const list = loadSavedCards().filter((c) => keyOf(c) !== keyOf(entry));
  putSavedCards(list);
  return list;
}

export function clearSavedCards(): void {
  dropRaw(CARD_SAVED_KEY);
}
