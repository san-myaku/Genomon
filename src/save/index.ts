/**
 * ゲノモン — セーブ層の公開窓口。
 *
 * 他のモジュールは save/schema.ts などを直接 import せず、必ずここ経由で使うこと。
 * 内部構成（schema / migrate / storage の分割）を将来変えても、この窓口が変わらなければ影響が出ない。
 */

export {
  checksum,
  coerceState,
  createNewGameState,
  nextSeed,
  stableStringify,
  validateState,
} from './schema.ts';

export { OLDEST_SUPPORTED_VERSION, detectVersion, migrate } from './migrate.ts';

export {
  BACKUP_KEY,
  SAVE_KEY,
  __readRawForTest,
  __writeRawForTest,
  clearSave,
  exportSave,
  hasSave,
  importSave,
  isUsingMemoryFallback,
  load,
  resetStorageCache,
  save,
} from './storage.ts';
