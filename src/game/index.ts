/**
 * ゲームプレイ層の公開窓口（API.md が契約の正本）。
 *
 * UI はこのファイルからだけ import する。game/ の内部構成（state / care / tick …）を
 * 将来変えても、ここが変わらなければ UI は影響を受けない。
 *
 * すべての関数は GameState をその場で変更する。保存は UI の責務。
 */

// ── 生成・進行 ─────────────────────────────────────────────
export { chooseEggs, newGame, rollEggChoices } from './state.ts';
export { applyTick, type TickReport } from './tick.ts';

// ── 世話 ───────────────────────────────────────────────────
export { careActionsFor, careAvailability, doCare } from './care.ts';

// ── ショップ ───────────────────────────────────────────────
export { availableItems, buyItem, lockedItems, useItem } from './shop.ts';

// ── 展示会 ─────────────────────────────────────────────────
export { canExhibit, exhibitCooldownLeft, runExhibition } from './exhibition.ts';

// ── 交配 ───────────────────────────────────────────────────
export { breedCooldownLeft, breedingPreview, canBreed, doBreed, findBreedablePair } from './breeding.ts';

// ── 参照系（副作用なし） ───────────────────────────────────
export {
  capacityUsed,
  creaturesByStage,
  findCreature,
  hasRoomFor,
  releaseCreature,
  roomLeft,
} from './state.ts';
export { clearPhenotypeCache, getPhenotype, phenotypeCacheSize } from './phenoCache.ts';
export { blockedCreatures } from './growth.ts';

// ── 解放・案内 ─────────────────────────────────────────────
export { nextObjective, refreshUnlocks, unlockHint, type Objective } from './unlocks.ts';

// ── 定数の再輸出（UI が config を直接触らずに済むように） ──
export {
  CARE_DEFS,
  SHOP_ITEMS,
  SHOP_ITEM_BY_ID,
  TIMING,
  UNLOCK_RULES,
} from './config.ts';

