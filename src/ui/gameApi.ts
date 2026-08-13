/**
 * game レイヤへの唯一の入口（UI 側の facade）。
 *
 * 【なぜ挟むのか】
 *   - UI は `src/game/API.md` の契約だけを使う。game の内部ファイルには触らない。
 *   - 契約以外の依存が生えていないか、この 1 ファイルを見れば確認できる。
 *   - 将来 game 側の内部構成が変わっても、直すのはここだけで済む。
 *
 * ここに書いてよいのは `src/game/index.ts` が公開している名前だけ。
 */

export {
  // ── 生成・進行 ──
  newGame,
  rollEggChoices,
  chooseEggs,
  applyTick,
  // ── 世話 ──
  doCare,
  careAvailability,
  careActionsFor,
  // ── ショップ ──
  availableItems,
  lockedItems,
  buyItem,
  useItem,
  // ── 公認ブリーダー販売 ──
  saleQuote,
  sellCreature,
  // ── 飼育員 ──
  dismissStaff,
  hiredStaff,
  hireStaff,
  refreshStaffCandidates,
  rerollStaffCandidates,
  staffConfig,
  staffRoleLabel,
  // ── 飼育フィールド ──
  cleanDropping,
  cleanField,
  fieldBehaviorFor,
  fieldMotionFor,
  fieldSlotPosition,
  nextDroppingIn,
  placeFieldItem,
  removeFieldItem,
  // ── 展示会 ──
  canExhibit,
  runExhibition,
  // ── 交配 ──
  canBreed,
  doBreed,
  breedingPreview,
  breedCooldownLeft,
  findBreedablePair,
  // ── 参照系 ──
  getPhenotype,
  findCreature,
  creaturesByStage,
  capacityUsed,
  hasRoomFor,
  roomLeft,
  releaseCreature,
  renameCreature,
  CREATURE_NAME_MAX_LENGTH,
  blockedCreatures,
  refreshUnlocks,
  unlockHint,
  nextObjective,
  // ── 表示に必要な定数（game 側が UI 向けに再輸出しているもの）──
  CARE_DEFS,
  SHOP_ITEMS,
  SHOP_ITEM_BY_ID,
  FIELD,
  STAFF,
  UNLOCK_RULES,
} from '../game/index.ts';

export type { TickReport, Objective } from '../game/index.ts';
export type { SaleQuote, SaleQuoteResult, SellResult } from '../game/index.ts';
export type { FieldBehavior, FieldBehaviorKind, FieldGait, FieldMotion, FieldTickReport } from '../game/index.ts';
export type { StaffTickReport } from '../game/index.ts';
