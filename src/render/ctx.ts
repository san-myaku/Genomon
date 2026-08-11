/**
 * パーツ描画で共有する文脈と描画順（z）の定義。
 *
 * 【描画順の原則】
 *   背面装飾（羽・耳・尾・浮遊物の奥）→ 体 → 模様 → 質感 → 輪郭の描き直し
 *   → 前面装飾（首かざり・植物・角・触角・結晶）→ 顔 → 浮遊物の手前
 *
 *   模様の上から輪郭をもう一度引く（Z.OUTLINE）のが要点。
 *   これをやらないと clip した模様が輪郭のインクを侵食し、
 *   「太いインク輪郭」という美術方針が小サイズで崩れる。
 */

import type { LifeState, Phenotype, PartExpression, RenderDetail } from '../core/types.ts';
import { Rng, clamp } from '../core/rng.ts';
import type { Box } from './svg.ts';
import { Defs } from './svg.ts';
import type { BodyShape } from './geom.ts';
import type { RenderColors } from './palette.ts';
import type { FaceLayout } from './parts/faceLayout.ts';

export const Z = {
  SHADOW: 0,
  FLOAT_BACK: 4,
  GLOW: 8,
  WING: 12,
  TAIL_BACK: 16,
  EAR_BACK: 20,
  CRYSTAL_BACK: 24,
  FEET: 28,
  BODY: 40,
  BELLY: 44,
  PATTERN: 48,
  TEXTURE: 54,
  OUTLINE: 58,
  COLLAR: 62,
  EAR_FRONT: 64,
  PLANT: 68,
  HORN: 70,
  ANTENNA: 72,
  CRYSTAL_FRONT: 74,
  FACE: 82,
  FLOAT_FRONT: 92,
} as const;

/** 体調・機嫌から決まる表情の補正。 */
export interface MoodMods {
  /** まぶたの下がり具合 0..1（1 で細目）。 */
  droop: number;
  /** 口の反り。+1 で笑い、-1 でへの字。 */
  smile: number;
  /** 元気 0..1。 */
  vigor: number;
  /** 眠さ 0..1。 */
  sleepy: number;
  /** 頬の赤み倍率。 */
  blush: number;
}

export function moodOf(life: LifeState | null, pheno: Phenotype): MoodMods {
  const p = pheno.personality;
  if (!life) {
    // LifeState が無いとき（コレクション表示・卵選択・図鑑など）は
    // 「その子の素の表情」を性格から作る。ここを固定値にすると
    // 全個体が同じ顔になり、指示書 §12 の表情の多様性が成立しない。
    const energy = clamp(p?.energy ?? 0.5, 0, 1);
    const curiosity = clamp(p?.curiosity ?? 0.5, 0, 1);
    const affection = clamp(p?.affection ?? 0.5, 0, 1);
    return {
      // おとなしい／警戒心の強い子ほどまぶたが下がり、落ち着いた表情になる
      droop: clamp(0.46 - energy * 0.36 - curiosity * 0.18, 0, 0.52),
      // 人なつこい子ほど大きく笑い、慎重な子は無表情に近づく
      smile: clamp(-0.32 + affection * 1.24 + energy * 0.34, -1, 1),
      vigor: clamp(0.45 + energy * 0.55, 0, 1),
      sleepy: clamp(0.42 - energy * 0.42, 0, 1),
      blush: clamp(0.55 + affection * 0.8, 0.3, 1.4),
    };
  }
  const mood = clamp(life.mood / 100, 0, 1);
  const health = clamp(life.health / 100, 0, 1);
  const hunger = clamp(life.hunger / 100, 0, 1);
  const resting = life.restingUntil > 0;
  const vigor = clamp(mood * 0.42 + health * 0.4 + hunger * 0.18, 0, 1);
  const sleepy = clamp((resting ? 0.7 : 0) + (1 - vigor) * 0.45, 0, 1);
  return {
    droop: clamp((1 - vigor) * 0.9 + sleepy * 0.25, 0, 1),
    smile: clamp(mood * 1.7 - 0.62 + ((p?.energy ?? 0.5) - 0.5) * 0.2, -1, 1),
    vigor,
    sleepy,
    blush: clamp(0.5 + mood * 0.9, 0.3, 1.4),
  };
}

export interface PartOut {
  id: string;
  z: number;
  svg: string;
  anchor?: { id: string; x: number; y: number; angle: number; scale: number };
  bbox?: Box;
}

export interface DrawCtx {
  pheno: Phenotype;
  parts: PartExpression;
  colors: RenderColors;
  shape: BodyShape;
  face: FaceLayout;
  detail: RenderDetail;
  uid: string;
  defs: Defs;
  /** 本体の輪郭線幅。 */
  strokeW: number;
  /** 細部の線幅。 */
  strokeThin: number;
  life: LifeState | null;
  mood: MoodMods;
  /** 本体シルエットの clipPath id。 */
  bodyClip: string;
  /**
   * テーマ（明/暗）で切り替えたい色。`[明背景での色, 暗背景での色]`。
   *
   * パーツがここへ書き込むと `model.ts` / `egg.ts` が `inkThemeStyle` の
   * extra として `--gm-<名前>` の CSS 変数に流し込む。
   * インクと同じく「同じ絵をテーマで塗り替える」ための仕組みで、
   * 牛柄の塊が暗背景でインクに溶ける問題（実測 200 体中 143 体）の解決に使う。
   */
  themeVars: Record<string, [string, string]>;
  /** 名前付き乱数サブストリーム。 */
  rng(name: string): Rng;
}

export function makeDefs(uid: string): Defs {
  return new Defs(uid);
}
