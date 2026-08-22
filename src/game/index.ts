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
export { saleQuote, sellCreature, type SaleQuote, type SaleQuoteResult, type SellResult } from './market.ts';

// ── 飼育員 ────────────────────────────────────────────────
export {
  advanceStaff,
  dismissStaff,
  hiredStaff,
  hireStaff,
  refreshStaffCandidates,
  rerollStaffCandidates,
  staffConfig,
  staffRoleLabel,
  type StaffTickReport,
} from './staff.ts';

// ── 飼育フィールド ─────────────────────────────────────────
export {
  cleanDropping,
  cleanField,
  fieldBehaviorFor,
  fieldMotionFor,
  fieldSlotPosition,
  nextDroppingIn,
  placeFieldItem,
  removeFieldItem,
  type FieldGait,
  type FieldBehavior,
  type FieldBehaviorKind,
  type FieldMotion,
  type FieldTickReport,
} from './field.ts';

// ── 展示会 ─────────────────────────────────────────────────
export { canExhibit, exhibitCooldownLeft, runExhibition } from './exhibition.ts';

// ── 鑑定 ───────────────────────────────────────────────────
export {
  APPRAISAL_COST,
  appraiseCreature,
  appraisedAtOf,
  canAppraise,
  deriveGeneticReport,
  isAppraised,
  observedRarity,
  type AppraisalAvailability,
  type AppraisalResult,
  type CategoricalGeneReport,
  type GeneticReport,
  type NumericGeneReport,
} from './grading.ts';
export { deriveFlavorText, type FlavorKind, type FlavorText } from './flavor.ts';

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
  renameCreature,
  CREATURE_NAME_MAX_LENGTH,
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
  FIELD,
  STAFF,
  TIMING,
  UNLOCK_RULES,
} from './config.ts';
