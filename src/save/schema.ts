/**
 * ゲノモン — セーブデータの検証・補完・チェックサム
 *
 * 【方針】
 *   壊れたセーブでゲーム全体が起動不能にならないことを最優先にする（指示書 §27）。
 *   そのため検証は 2 段構えにしてある。
 *
 *     validateState()  … 厳格。1 つでも型が壊れていたらエラー配列を返す。
 *                         「このデータは正しいか」を答えるのが役目。
 *     coerceState()    … 寛容。欠けたフィールドをデフォルトで埋め、
 *                         救えるところだけ救って必ず GameState を返す。
 *                         「このデータで起動できるか」を答えるのが役目。
 *
 *   load() は 厳格 → 失敗したら 寛容 の順で試す。
 */

import { hashString, makeSeed } from '../core/rng.ts';
import {
  SAVE_VERSION,
  type BreederState,
  type Capacity,
  type Creature,
  type FieldDropping,
  type FieldPlacement,
  type FieldState,
  type GameState,
  type GameStats,
  type Genotype,
  type LifeState,
  type Settings,
  type SaleRecord,
  type Stage,
  type StaffCandidate,
  type StaffState,
  type TutorialState,
  type Unlocks,
} from '../core/types.ts';
import { CAPACITY_DEFAULT, FIELD, INITIAL_LIFE, SHOP_ITEM_BY_ID, freshInitialParts } from '../game/config.ts';

// ─────────────────────────────────────────────────────────
//  小道具
// ─────────────────────────────────────────────────────────

const VALID_STAGES: readonly string[] = ['egg', 'juvenile', 'adult'];

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isStr(x: unknown): x is string {
  return typeof x === 'string';
}

/** 数値を取り出す。壊れていたら fallback。範囲指定があればクランプする。 */
function num(x: unknown, fallback: number, lo?: number, hi?: number): number {
  let v = isNum(x) ? x : fallback;
  if (lo !== undefined && v < lo) v = lo;
  if (hi !== undefined && v > hi) v = hi;
  return v;
}

function str(x: unknown, fallback: string): string {
  return isStr(x) ? x : fallback;
}

function bool(x: unknown, fallback: boolean): boolean {
  return typeof x === 'boolean' ? x : fallback;
}

function strArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter(isStr) : [];
}

/**
 * キー順に依存しない安定シリアライズ。
 * JSON.stringify はキーの挿入順を保つため、同じ内容でも順序違いでハッシュがずれる。
 * チェックサムを決定論的にするには自前でキーをソートする必要がある。
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number') return Number.isFinite(value as number) ? String(value) : 'null';
  if (t === 'boolean') return String(value);
  if (t === 'string') return JSON.stringify(value);
  if (t === 'undefined' || t === 'function') return 'null';
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (isObj(value)) {
    const keys = Object.keys(value).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = value[k];
      if (v === undefined) continue; // undefined は JSON 往復で消えるので最初から無視する
      parts.push(JSON.stringify(k) + ':' + stableStringify(v));
    }
    return '{' + parts.join(',') + '}';
  }
  return 'null';
}

// ─────────────────────────────────────────────────────────
//  チェックサム
// ─────────────────────────────────────────────────────────

/**
 * 決定論的なチェックサム。
 * 32bit ハッシュ 1 本では衝突が気になるので、ソルト違いで 2 本取って 16 桁にする。
 * 暗号強度は不要（改竄防止ではなく破損検知が目的）。
 */
export function checksum(state: GameState): string {
  const s = stableStringify(state);
  const a = hashString(s);
  const b = hashString('genomon\\0' + s + '\\0' + s.length);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

// ─────────────────────────────────────────────────────────
//  厳格な検証
// ─────────────────────────────────────────────────────────

/** 検証中のエラー収集ヘルパ。 */
class Errs {
  readonly list: string[] = [];
  push(path: string, msg: string): void {
    this.list.push(`${path}: ${msg}`);
  }
}

function checkNum(e: Errs, path: string, v: unknown): void {
  if (!isNum(v)) e.push(path, `数値であるべき（実際: ${describe(v)}）`);
}

function checkStr(e: Errs, path: string, v: unknown): void {
  if (!isStr(v)) e.push(path, `文字列であるべき（実際: ${describe(v)}）`);
}

function checkBool(e: Errs, path: string, v: unknown): void {
  if (typeof v !== 'boolean') e.push(path, `真偽値であるべき（実際: ${describe(v)}）`);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** 遺伝情報の構造検証。対立遺伝子の中身（どの locus が必要か）は genetics 側の責務なので見ない。 */
function checkGenotype(e: Errs, path: string, g: unknown): void {
  if (!isObj(g)) {
    e.push(path, `オブジェクトであるべき（実際: ${describe(g)}）`);
    return;
  }
  checkStr(e, `${path}.seed`, g['seed']);
  const cat = g['cat'];
  const numLoci = g['num'];
  if (!isObj(cat)) {
    e.push(`${path}.cat`, `オブジェクトであるべき（実際: ${describe(cat)}）`);
  } else {
    for (const k of Object.keys(cat)) {
      const pair = cat[k];
      if (!Array.isArray(pair) || pair.length !== 2 || !isStr(pair[0]) || !isStr(pair[1])) {
        e.push(`${path}.cat.${k}`, '[string, string] であるべき');
      }
    }
  }
  if (!isObj(numLoci)) {
    e.push(`${path}.num`, `オブジェクトであるべき（実際: ${describe(numLoci)}）`);
  } else {
    for (const k of Object.keys(numLoci)) {
      const pair = numLoci[k];
      if (!Array.isArray(pair) || pair.length !== 2 || !isNum(pair[0]) || !isNum(pair[1])) {
        e.push(`${path}.num.${k}`, '[number, number] であるべき');
      }
    }
  }
}

function checkLife(e: Errs, path: string, life: unknown): void {
  if (!isObj(life)) {
    e.push(path, `オブジェクトであるべき（実際: ${describe(life)}）`);
    return;
  }
  if (!isStr(life['stage']) || !VALID_STAGES.includes(life['stage'])) {
    e.push(`${path}.stage`, `'egg' | 'juvenile' | 'adult' のいずれかであるべき`);
  }
  for (const k of [
    'ageMs', 'growth', 'hunger', 'hydration', 'cleanliness',
    'mood', 'health', 'hatchProgress', 'careCount', 'lastTickAt', 'restingUntil',
  ] as const) {
    checkNum(e, `${path}.${k}`, life[k]);
  }
  if (!isObj(life['lastCareAt'])) {
    e.push(`${path}.lastCareAt`, `オブジェクトであるべき（実際: ${describe(life['lastCareAt'])}）`);
  }
}

function checkCreature(e: Errs, path: string, c: unknown): void {
  if (!isObj(c)) {
    e.push(path, `オブジェクトであるべき（実際: ${describe(c)}）`);
    return;
  }
  checkStr(e, `${path}.id`, c['id']);
  checkStr(e, `${path}.seed`, c['seed']);
  checkStr(e, `${path}.name`, c['name']);
  checkGenotype(e, `${path}.genotype`, c['genotype']);
  checkLife(e, `${path}.life`, c['life']);
  checkNum(e, `${path}.generation`, c['generation']);
  checkNum(e, `${path}.bornAt`, c['bornAt']);
  checkNum(e, `${path}.bestScore`, c['bestScore']);
  checkNum(e, `${path}.exhibitionCount`, c['exhibitionCount']);
  // v4 で追加。クールダウンをモジュール内 Map ではなく個体に保存するようにしたもの。
  checkNum(e, `${path}.lastExhibitAt`, c['lastExhibitAt']);
  checkNum(e, `${path}.lastBredAt`, c['lastBredAt']);
  checkBool(e, `${path}.favorite`, c['favorite']);
  checkBool(e, `${path}.fromBreeding`, c['fromBreeding']);

  const parents = c['parents'];
  if (parents !== null && !(Array.isArray(parents) && parents.length === 2 && parents.every(isStr))) {
    e.push(`${path}.parents`, 'null または [string, string] であるべき');
  }
  const parentNames = c['parentNames'];
  if (parentNames !== null && !(Array.isArray(parentNames) && parentNames.length === 2 && parentNames.every(isStr))) {
    e.push(`${path}.parentNames`, 'null または [string, string] であるべき');
  }
}

/**
 * GameState の厳格な構造検証。
 * 壊れている場合はどこがどう壊れているかを errors に列挙して返す（デバッグ・報告用）。
 */
export function validateState(x: unknown): { ok: true; state: GameState } | { ok: false; errors: string[] } {
  const e = new Errs();

  if (!isObj(x)) {
    return { ok: false, errors: [`root: オブジェクトであるべき（実際: ${describe(x)}）`] };
  }

  checkNum(e, 'version', x['version']);
  checkNum(e, 'createdAt', x['createdAt']);
  checkNum(e, 'updatedAt', x['updatedAt']);
  checkNum(e, 'seedCounter', x['seedCounter']);
  checkStr(e, 'worldSeed', x['worldSeed']);
  checkNum(e, 'coins', x['coins']);

  // creatures
  const creatures = x['creatures'];
  if (!Array.isArray(creatures)) {
    e.push('creatures', `配列であるべき（実際: ${describe(creatures)}）`);
  } else {
    creatures.forEach((c, i) => checkCreature(e, `creatures[${i}]`, c));
  }

  // pendingEggs（null 可）
  const pending = x['pendingEggs'];
  if (pending !== null && pending !== undefined) {
    if (!Array.isArray(pending)) {
      e.push('pendingEggs', `null または配列であるべき（実際: ${describe(pending)}）`);
    } else {
      pending.forEach((egg, i) => {
        if (!isObj(egg)) {
          e.push(`pendingEggs[${i}]`, `オブジェクトであるべき（実際: ${describe(egg)}）`);
          return;
        }
        checkStr(e, `pendingEggs[${i}].seed`, egg['seed']);
        checkGenotype(e, `pendingEggs[${i}].genotype`, egg['genotype']);
      });
    }
  } else if (pending === undefined) {
    e.push('pendingEggs', 'null または配列であるべき（実際: undefined）');
  }

  // inventory
  const inv = x['inventory'];
  if (!isObj(inv)) {
    e.push('inventory', `オブジェクトであるべき（実際: ${describe(inv)}）`);
  } else {
    for (const k of Object.keys(inv)) checkNum(e, `inventory.${k}`, inv[k]);
  }

  // owned
  const owned = x['owned'];
  if (!Array.isArray(owned) || !owned.every(isStr)) {
    e.push('owned', 'string[] であるべき');
  }

  // unlocks
  const unlocks = x['unlocks'];
  if (!isObj(unlocks)) {
    e.push('unlocks', `オブジェクトであるべき（実際: ${describe(unlocks)}）`);
  } else {
    for (const k of ['nursery', 'exhibition', 'shop', 'breeding', 'collection', 'breeder', 'staff'] as const) {
      checkBool(e, `unlocks.${k}`, unlocks[k]);
    }
  }

  // capacity
  const cap = x['capacity'];
  if (!isObj(cap)) {
    e.push('capacity', `オブジェクトであるべき（実際: ${describe(cap)}）`);
  } else {
    for (const k of ['egg', 'juvenile', 'adult'] as const) checkNum(e, `capacity.${k}`, cap[k]);
  }

  // settings
  const settings = x['settings'];
  if (!isObj(settings)) {
    e.push('settings', `オブジェクトであるべき（実際: ${describe(settings)}）`);
  } else {
    checkNum(e, 'settings.volume', settings['volume']);
    checkBool(e, 'settings.muted', settings['muted']);
    checkBool(e, 'settings.reducedMotion', settings['reducedMotion']);
    checkBool(e, 'settings.skipCutscenes', settings['skipCutscenes']);
  }

  // tutorial
  const tut = x['tutorial'];
  if (!isObj(tut)) {
    e.push('tutorial', `オブジェクトであるべき（実際: ${describe(tut)}）`);
  } else {
    if (!Array.isArray(tut['done']) || !(tut['done'] as unknown[]).every(isStr)) {
      e.push('tutorial.done', 'string[] であるべき');
    }
    if (tut['current'] !== null && !isStr(tut['current'])) {
      e.push('tutorial.current', 'null または文字列であるべき');
    }
  }

  // stats
  const stats = x['stats'];
  if (!isObj(stats)) {
    e.push('stats', `オブジェクトであるべき（実際: ${describe(stats)}）`);
  } else {
    for (const k of ['hatched', 'grownUp', 'bred', 'exhibitions', 'coinsEarned', 'careActions', 'staffCareActions'] as const) {
      checkNum(e, `stats.${k}`, stats[k]);
    }
  }

  // activeCreatureId
  if (x['activeCreatureId'] !== null && !isStr(x['activeCreatureId'])) {
    e.push('activeCreatureId', 'null または文字列であるべき');
  }

  // 公認ブリーダーの資格・販売履歴
  const breeder = x['breeder'];
  if (!isObj(breeder)) {
    e.push('breeder', `オブジェクトであるべき（実際: ${describe(breeder)}）`);
  } else {
    checkBool(e, 'breeder.licensed', breeder['licensed']);
    checkNum(e, 'breeder.sales', breeder['sales']);
    checkNum(e, 'breeder.earnings', breeder['earnings']);
    if (!Array.isArray(breeder['history'])) {
      e.push('breeder.history', '配列であるべき');
    } else {
      breeder['history'].forEach((record, i) => {
        if (!isObj(record)) {
          e.push(`breeder.history[${i}]`, `オブジェクトであるべき（実際: ${describe(record)}）`);
          return;
        }
        checkStr(e, `breeder.history[${i}].id`, record['id']);
        checkStr(e, `breeder.history[${i}].creatureName`, record['creatureName']);
        checkStr(e, `breeder.history[${i}].seed`, record['seed']);
        checkStr(e, `breeder.history[${i}].stage`, record['stage']);
        checkNum(e, `breeder.history[${i}].generation`, record['generation']);
        checkNum(e, `breeder.history[${i}].bestScore`, record['bestScore']);
        checkNum(e, `breeder.history[${i}].exhibitionCount`, record['exhibitionCount']);
        checkNum(e, `breeder.history[${i}].price`, record['price']);
        checkNum(e, `breeder.history[${i}].soldAt`, record['soldAt']);
      });
    }
  }

  // 飼育員の募集・雇用
  const staff = x['staff'];
  if (!isObj(staff)) {
    e.push('staff', `オブジェクトであるべき（実際: ${describe(staff)}）`);
  } else {
    if (!Array.isArray(staff['candidates'])) {
      e.push('staff.candidates', '配列であるべき');
    } else {
      staff['candidates'].forEach((candidate, i) => {
        if (!isObj(candidate)) {
          e.push(`staff.candidates[${i}]`, `オブジェクトであるべき（実際: ${describe(candidate)}）`);
          return;
        }
        checkStr(e, `staff.candidates[${i}].id`, candidate['id']);
        checkStr(e, `staff.candidates[${i}].name`, candidate['name']);
        checkStr(e, `staff.candidates[${i}].role`, candidate['role']);
        checkNum(e, `staff.candidates[${i}].wage`, candidate['wage']);
        checkNum(e, `staff.candidates[${i}].skill`, candidate['skill']);
        checkNum(e, `staff.candidates[${i}].reliability`, candidate['reliability']);
        checkStr(e, `staff.candidates[${i}].profile`, candidate['profile']);
        checkStr(e, `staff.candidates[${i}].reason`, candidate['reason']);
        checkStr(e, `staff.candidates[${i}].quirk`, candidate['quirk']);
      });
    }
    if (staff['hiredId'] !== null && !isStr(staff['hiredId'])) e.push('staff.hiredId', 'null または文字列であるべき');
    checkNum(e, 'staff.hiredAt', staff['hiredAt']);
    checkNum(e, 'staff.lastServiceAt', staff['lastServiceAt']);
    checkNum(e, 'staff.lastPaidAt', staff['lastPaidAt']);
    // 初期 v7 の開発中セーブにはこの猶予時刻が無いものがある。欠損は 0 と同じ意味で
    // 読み込み時に補完し、壊れた型だけを拒否する（既存ユーザーを復旧画面へ送らない）。
    if (staff['unpaidSince'] !== undefined) checkNum(e, 'staff.unpaidSince', staff['unpaidSince']);
    checkNum(e, 'staff.candidateCycle', staff['candidateCycle']);
  }

  // 飼育フィールド
  const field = x['field'];
  if (!isObj(field)) {
    e.push('field', `オブジェクトであるべき（実際: ${describe(field)}）`);
  } else {
    checkNum(e, 'field.cleanliness', field['cleanliness']);
    checkNum(e, 'field.lastTickAt', field['lastTickAt']);
    checkNum(e, 'field.lastRobotCleanAt', field['lastRobotCleanAt']);
    if (!Array.isArray(field['droppings'])) {
      e.push('field.droppings', '配列であるべき');
    } else {
      field['droppings'].forEach((drop, i) => {
        if (!isObj(drop)) {
          e.push(`field.droppings[${i}]`, `オブジェクトであるべき（実際: ${describe(drop)}）`);
          return;
        }
        checkStr(e, `field.droppings[${i}].id`, drop['id']);
        checkStr(e, `field.droppings[${i}].creatureId`, drop['creatureId']);
        checkNum(e, `field.droppings[${i}].x`, drop['x']);
        checkNum(e, `field.droppings[${i}].y`, drop['y']);
        checkNum(e, `field.droppings[${i}].createdAt`, drop['createdAt']);
      });
    }
    if (!Array.isArray(field['placements'])) {
      e.push('field.placements', '配列であるべき');
    } else {
      field['placements'].forEach((placement, i) => {
        if (!isObj(placement)) {
          e.push(`field.placements[${i}]`, `オブジェクトであるべき（実際: ${describe(placement)}）`);
          return;
        }
        checkStr(e, `field.placements[${i}].itemId`, placement['itemId']);
        checkNum(e, `field.placements[${i}].slot`, placement['slot']);
        checkNum(e, `field.placements[${i}].placedAt`, placement['placedAt']);
      });
    }
    if (!isObj(field['lastDroppingAge'])) {
      e.push('field.lastDroppingAge', 'オブジェクトであるべき');
    } else {
      for (const key of Object.keys(field['lastDroppingAge'])) {
        checkNum(e, `field.lastDroppingAge.${key}`, field['lastDroppingAge'][key]);
      }
    }
  }

  // future（将来拡張用の予約領域）
  const future = x['future'];
  if (!isObj(future)) {
    e.push('future', `オブジェクトであるべき（実際: ${describe(future)}）`);
  } else {
    if (!Array.isArray(future['marketListings'])) e.push('future.marketListings', '配列であるべき');
    if (!Array.isArray(future['tradeHistory'])) e.push('future.tradeHistory', '配列であるべき');
    if (!('rankingCache' in future)) e.push('future.rankingCache', 'キーが存在するべき（null 可）');
  }

  if (e.list.length > 0) return { ok: false, errors: e.list };
  return { ok: true, state: x as unknown as GameState };
}

// ─────────────────────────────────────────────────────────
//  寛容な補完
// ─────────────────────────────────────────────────────────

/** 遺伝情報を救えるかどうか判定して整形する。救えなければ null（＝その個体は捨てる）。 */
function coerceGenotype(g: unknown): Genotype | null {
  if (!isObj(g)) return null;
  const cat = g['cat'];
  const numLoci = g['num'];
  // 遺伝子は捏造できない。cat/num が両方失われていたら、その個体は復元不可能。
  if (!isObj(cat) || !isObj(numLoci)) return null;

  const outCat: Record<string, readonly [string, string]> = {};
  for (const k of Object.keys(cat)) {
    const p = cat[k];
    if (Array.isArray(p) && p.length === 2 && isStr(p[0]) && isStr(p[1])) {
      outCat[k] = [p[0], p[1]] as const;
    }
  }
  const outNum: Record<string, readonly [number, number]> = {};
  for (const k of Object.keys(numLoci)) {
    const p = numLoci[k];
    if (Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1])) {
      outNum[k] = [p[0], p[1]] as const;
    }
  }
  if (Object.keys(outCat).length === 0 && Object.keys(outNum).length === 0) return null;

  return {
    seed: str(g['seed'], 'RECOVERED'),
    cat: outCat,
    num: outNum,
  } as unknown as Genotype;
}

/** 世話の最終実施時刻テーブルを整形する。壊れたエントリは黙って落とす。 */
function coerceLastCareAt(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(x)) return out;
  for (const k of Object.keys(x)) {
    const v = x[k];
    if (isNum(v)) out[k] = v;
  }
  return out;
}

function coerceStage(x: unknown): Stage {
  return isStr(x) && VALID_STAGES.includes(x) ? (x as Stage) : 'egg';
}

/** LifeState を補完する。stage に応じた初期値を土台にするので、欠落しても破綻しない。 */
function coerceLife(x: unknown, now: number): LifeState {
  const src = isObj(x) ? x : {};
  const stage = coerceStage(src['stage']);
  const base = stage === 'egg' ? INITIAL_LIFE.egg : INITIAL_LIFE.juvenile;
  return {
    stage,
    ageMs: num(src['ageMs'], 0, 0),
    growth: num(src['growth'], base.growth, 0, 100),
    hunger: num(src['hunger'], base.hunger, 0, 100),
    hydration: num(src['hydration'], base.hydration, 0, 100),
    cleanliness: num(src['cleanliness'], base.cleanliness, 0, 100),
    mood: num(src['mood'], base.mood, 0, 100),
    health: num(src['health'], base.health, 0, 100),
    hatchProgress: num(src['hatchProgress'], base.hatchProgress, 0, 100),
    careCount: num(src['careCount'], 0, 0),
    lastCareAt: coerceLastCareAt(src['lastCareAt']),
    // lastTickAt が壊れていると「巨大なオフライン経過」として扱われて事故る。現在時刻で潰す。
    lastTickAt: num(src['lastTickAt'], now, 0),
    restingUntil: num(src['restingUntil'], 0, 0),
  };
}

function coercePair(x: unknown): readonly [string, string] | null {
  if (Array.isArray(x) && x.length === 2 && isStr(x[0]) && isStr(x[1])) return [x[0], x[1]] as const;
  return null;
}

/** 個体を補完する。遺伝情報が救えない個体だけは復元を諦めて null を返す。 */
function coerceCreature(x: unknown, now: number, index: number): Creature | null {
  if (!isObj(x)) return null;
  const genotype = coerceGenotype(x['genotype']);
  if (!genotype) return null;

  const seed = str(x['seed'], genotype.seed);
  const out: Creature = {
    id: str(x['id'], `recovered-${index}-${seed}`),
    seed,
    name: str(x['name'], 'ななしのゲノモン'),
    genotype,
    life: coerceLife(x['life'], now),
    parents: coercePair(x['parents']),
    parentNames: coercePair(x['parentNames']),
    generation: num(x['generation'], 1, 1),
    bornAt: num(x['bornAt'], now, 0),
    bestScore: num(x['bestScore'], 0, 0),
    exhibitionCount: num(x['exhibitionCount'], 0, 0),
    // v4 追加分。欠落時は 0（＝クールダウン明け）で補う。
    // 現在時刻で埋めると、旧セーブのプレイヤーが身に覚えのない待ち時間を課されるため。
    lastExhibitAt: num(x['lastExhibitAt'], 0, 0),
    lastBredAt: num(x['lastBredAt'], 0, 0),
    favorite: bool(x['favorite'], false),
    fromBreeding: bool(x['fromBreeding'], false),
  };

  // ── 鑑定済みかどうか（appraisedAt）──────────────────────
  //
  // 【なぜ Creature 型に無いのに、ここで拾うのか】
  //   鑑定状態は `Creature` の正式フィールドではなく、後方互換な追加キーとして
  //   載せている（`game/grading.ts`）。通常の save → JSON → load では
  //   そのまま往復するが、**この救出経路だけは 1 フィールドずつ組み直す**ので、
  //   拾わなければ落ちる。プレイヤーから見れば「壊れたセーブを直したら、
  //   お金を払った鑑定だけ無かったことになった」という最悪の消え方になる。
  //   型を正式化するのが本筋だが、それは save/validate/migrate/createCreature/
  //   released record まで一貫して直す作業なので、ここでは
  //   **データを落とさないことだけ** を先に保証する。
  const appraisedAt = num(x['appraisedAt'], 0, 0);
  if (appraisedAt > 0) (out as Creature & { appraisedAt?: number }).appraisedAt = appraisedAt;
  return out;
}

function coerceUnlocks(x: unknown, fallback: Unlocks): Unlocks {
  const src = isObj(x) ? x : {};
  return {
    // 育成室だけは常に true。ここが false だと何もできない画面になり、詰む。
    nursery: true,
    exhibition: bool(src['exhibition'], fallback.exhibition),
    shop: bool(src['shop'], fallback.shop),
    breeding: bool(src['breeding'], fallback.breeding),
    collection: bool(src['collection'], fallback.collection),
    breeder: bool(src['breeder'], fallback.breeder),
    staff: bool(src['staff'], fallback.staff),
  };
}

function coerceCapacity(x: unknown): Capacity {
  const src = isObj(x) ? x : {};
  return {
    egg: num(src['egg'], CAPACITY_DEFAULT.egg, 1),
    juvenile: num(src['juvenile'], CAPACITY_DEFAULT.juvenile, 1),
    adult: num(src['adult'], CAPACITY_DEFAULT.adult, 1),
  };
}

function coerceSettings(x: unknown, fallback: Settings): Settings {
  const src = isObj(x) ? x : {};
  return {
    volume: num(src['volume'], fallback.volume, 0, 1),
    muted: bool(src['muted'], fallback.muted),
    reducedMotion: bool(src['reducedMotion'], fallback.reducedMotion),
    skipCutscenes: bool(src['skipCutscenes'], fallback.skipCutscenes),
  };
}

function coerceTutorial(x: unknown, fallback: TutorialState): TutorialState {
  const src = isObj(x) ? x : {};
  const current = src['current'];
  return {
    done: strArray(src['done']),
    current: current === null ? null : isStr(current) ? current : fallback.current,
  };
}

function coerceStats(x: unknown, fallback: GameStats): GameStats {
  const src = isObj(x) ? x : {};
  return {
    hatched: num(src['hatched'], fallback.hatched, 0),
    grownUp: num(src['grownUp'], fallback.grownUp, 0),
    bred: num(src['bred'], fallback.bred, 0),
    exhibitions: num(src['exhibitions'], fallback.exhibitions, 0),
    coinsEarned: num(src['coinsEarned'], fallback.coinsEarned, 0),
    careActions: num(src['careActions'], fallback.careActions, 0),
    staffCareActions: num(src['staffCareActions'], fallback.staffCareActions, 0),
  };
}

function coerceStaffCandidate(x: unknown, index: number): StaffCandidate | null {
  if (!isObj(x)) return null;
  const role = x['role'] === 'fullTime' ? 'fullTime' : x['role'] === 'partTime' ? 'partTime' : null;
  if (!role) return null;
  return {
    id: str(x['id'], `recovered-staff-${index}`),
    name: str(x['name'], 'ななしの飼育員'),
    role,
    wage: num(x['wage'], role === 'fullTime' ? 100 : 35, 1),
    skill: num(x['skill'], 1, 0.5, 1.5),
    reliability: num(x['reliability'], 0.9, 0.4, 1),
    profile: str(x['profile'], 'ゲノモンの世話を学んでいます。'),
    reason: str(x['reason'], '生きもののそばで働きたい。'),
    quirk: str(x['quirk'], 'ていねいに記録をつける。'),
  };
}

function coerceStaff(x: unknown, fallback: StaffState): StaffState {
  const src = isObj(x) ? x : {};
  const candidates = Array.isArray(src['candidates'])
    ? src['candidates'].map((candidate, i) => coerceStaffCandidate(candidate, i)).filter((c): c is StaffCandidate => !!c).slice(0, 6)
    : [];
  const hiredId = isStr(src['hiredId']) && candidates.some((candidate) => candidate.id === src['hiredId'])
    ? src['hiredId']
    : null;
  return {
    candidates,
    hiredId,
    hiredAt: num(src['hiredAt'], fallback.hiredAt, 0),
    lastServiceAt: num(src['lastServiceAt'], fallback.lastServiceAt, 0),
    lastPaidAt: num(src['lastPaidAt'], fallback.lastPaidAt, 0),
    unpaidSince: num(src['unpaidSince'], fallback.unpaidSince, 0),
    candidateCycle: num(src['candidateCycle'], fallback.candidateCycle, 0),
  };
}

function coerceSaleHistory(x: unknown): SaleRecord[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter(isObj)
    .map((record, index) => ({
      id: str(record['id'], `recovered-sale-${index}`),
      creatureName: str(record['creatureName'], 'ななしのゲノモン'),
      seed: str(record['seed'], 'RECOVERED'),
      stage: coerceStage(record['stage']),
      generation: num(record['generation'], 1, 1),
      parentNames: coercePair(record['parentNames']),
      bestScore: num(record['bestScore'], 0, 0, 100),
      exhibitionCount: num(record['exhibitionCount'], 0, 0),
      price: num(record['price'], 0, 0),
      soldAt: num(record['soldAt'], 0, 0),
    }))
    .slice(0, 50);
}

function coerceBreeder(x: unknown, fallback: BreederState): BreederState {
  const src = isObj(x) ? x : {};
  const history = coerceSaleHistory(src['history']);
  return {
    licensed: bool(src['licensed'], fallback.licensed),
    sales: Math.max(num(src['sales'], fallback.sales, 0), history.length),
    earnings: num(src['earnings'], fallback.earnings, 0),
    history,
  };
}

function coerceField(x: unknown, now: number, creatures: readonly Creature[]): FieldState {
  const src = isObj(x) ? x : {};
  const creatureIds = new Set(creatures.map((c) => c.id));
  const droppings: FieldDropping[] = Array.isArray(src['droppings'])
    ? src['droppings']
        .filter(isObj)
        .map((drop, index) => ({
          id: str(drop['id'], `recovered-dropping-${index}`),
          creatureId: str(drop['creatureId'], ''),
          x: num(drop['x'], 50, 0, 100),
          // v6 フィールドの排泄物は草地全体に置かれていた。部屋型フィールドでは
          // 床面へ寄せて、既存セーブを読み込んでも壁や窓に浮かないようにする。
          y: (() => { const rawY = num(drop['y'], 50, 0, 100); return rawY < 48 ? 54 + rawY * 0.35 : rawY; })(),
          createdAt: num(drop['createdAt'], now, 0),
        }))
        .filter((drop) => creatureIds.has(drop.creatureId))
        .slice(0, FIELD.maxDroppings)
    : [];

  const usedSlots = new Set<number>();
  const usedItems = new Set<string>();
  const placements: FieldPlacement[] = Array.isArray(src['placements'])
    ? src['placements']
        .filter(isObj)
        .map((placement) => ({
          itemId: str(placement['itemId'], ''),
          slot: Math.floor(num(placement['slot'], -1)),
          placedAt: num(placement['placedAt'], now, 0),
        }))
        .filter((placement) => {
          const item = SHOP_ITEM_BY_ID[placement.itemId];
          if (!item?.fieldObject || item.target !== 'field') return false;
          if (placement.slot < 0 || placement.slot >= FIELD.slotCount) return false;
          if (usedSlots.has(placement.slot) || usedItems.has(placement.itemId)) return false;
          usedSlots.add(placement.slot);
          usedItems.add(placement.itemId);
          return true;
        })
    : [];

  const lastDroppingAge: Record<string, number> = {};
  const rawAges = isObj(src['lastDroppingAge']) ? src['lastDroppingAge'] : {};
  for (const id of creatureIds) {
    const age = rawAges[id];
    if (isNum(age)) lastDroppingAge[id] = Math.max(0, age);
  }

  return {
    cleanliness: num(src['cleanliness'], 100, 0, 100),
    droppings,
    placements,
    lastDroppingAge,
    lastTickAt: num(src['lastTickAt'], now, 0),
    lastRobotCleanAt: num(src['lastRobotCleanAt'], 0, 0),
  };
}

function coerceInventory(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(x)) return out;
  for (const k of Object.keys(x)) {
    const v = x[k];
    if (isNum(v) && v > 0) out[k] = Math.floor(v);
  }
  return out;
}

/**
 * 部分的に壊れた state を、可能な限り救って GameState にする。
 *
 * 欠けたフィールドは config.ts の初期値で埋める。
 * 「オブジェクトですらない」入力（null / 文字列 / 配列）のときだけ null を返す。
 */
export function coerceState(x: unknown): GameState | null {
  if (!isObj(x)) return null;

  const now = Date.now();
  const init = freshInitialParts();

  // creatures: 救えない個体だけを落として、残りは生かす。
  const rawCreatures = Array.isArray(x['creatures']) ? x['creatures'] : [];
  const creatures: Creature[] = [];
  rawCreatures.forEach((c, i) => {
    const cc = coerceCreature(c, now, i);
    if (cc) creatures.push(cc);
  });

  // pendingEggs: 卵候補は失っても致命傷ではないので、壊れていたら null にする。
  let pendingEggs: { seed: string; genotype: Genotype }[] | null = null;
  const rawPending = x['pendingEggs'];
  if (Array.isArray(rawPending)) {
    const eggs: { seed: string; genotype: Genotype }[] = [];
    for (const egg of rawPending) {
      if (!isObj(egg)) continue;
      const g = coerceGenotype(egg['genotype']);
      if (!g) continue;
      eggs.push({ seed: str(egg['seed'], g.seed), genotype: g });
    }
    pendingEggs = eggs.length > 0 ? eggs : null;
  }

  const activeId = x['activeCreatureId'];
  const activeCreatureId = isStr(activeId) && creatures.some((c) => c.id === activeId) ? activeId : null;

  const rawFuture = isObj(x['future']) ? (x['future'] as Record<string, unknown>) : {};

  return {
    // バージョンは常に現行値へ寄せる（migrate 済みの state しかここへ来ない前提）。
    version: SAVE_VERSION,
    createdAt: num(x['createdAt'], now, 0),
    updatedAt: num(x['updatedAt'], now, 0),
    // seedCounter が巻き戻ると seed が衝突する。既存個体数より必ず大きい値を保証する。
    seedCounter: Math.max(num(x['seedCounter'], 0, 0), creatures.length),
    worldSeed: str(x['worldSeed'], `recovered-${now.toString(36)}`),
    coins: num(x['coins'], init.coins, 0),
    creatures,
    pendingEggs,
    inventory: coerceInventory(x['inventory']),
    owned: strArray(x['owned']),
    unlocks: coerceUnlocks(x['unlocks'], init.unlocks),
    capacity: coerceCapacity(x['capacity']),
    settings: coerceSettings(x['settings'], init.settings),
    tutorial: coerceTutorial(x['tutorial'], init.tutorial),
    stats: coerceStats(x['stats'], init.stats),
    activeCreatureId,
    field: coerceField(x['field'], now, creatures),
    breeder: coerceBreeder(x['breeder'], init.breeder),
    staff: coerceStaff(x['staff'], init.staff),
    future: {
      marketListings: Array.isArray(rawFuture['marketListings']) ? rawFuture['marketListings'] : [],
      tradeHistory: Array.isArray(rawFuture['tradeHistory']) ? rawFuture['tradeHistory'] : [],
      rankingCache: 'rankingCache' in rawFuture ? rawFuture['rankingCache'] : null,
    },
  };
}

// ─────────────────────────────────────────────────────────
//  新規ゲーム
// ─────────────────────────────────────────────────────────

/**
 * 新規ゲームの GameState を作る。
 * 個体はまだ 1 体もいない（卵選択画面で pendingEggs が作られる）。
 * バランス数値はすべて config.ts 由来にしてあり、ここには定数を書かない。
 */
export function createNewGameState(worldSeed: string): GameState {
  const now = Date.now();
  const init = freshInitialParts();
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    seedCounter: 0,
    worldSeed,
    coins: init.coins,
    creatures: [],
    pendingEggs: null,
    inventory: init.inventory,
    owned: init.owned,
    unlocks: init.unlocks,
    capacity: init.capacity,
    settings: init.settings,
    tutorial: init.tutorial,
    stats: init.stats,
    activeCreatureId: init.activeCreatureId,
    field: {
      cleanliness: init.field.cleanliness,
      droppings: [],
      placements: [],
      lastDroppingAge: {},
      lastTickAt: now,
      lastRobotCleanAt: 0,
    },
    breeder: init.breeder,
    staff: init.staff,
    future: init.future,
  };
}

/**
 * 次に使う個体 seed を払い出す（seedCounter を進める副作用つき）。
 * seed 採番の規則をセーブ側に閉じ込めておくことで、
 * 「ロード後に seed が衝突して同じ見た目の個体が生まれる」事故を防ぐ。
 */
export function nextSeed(state: GameState): string {
  state.seedCounter += 1;
  return makeSeed(state.worldSeed, state.seedCounter);
}
