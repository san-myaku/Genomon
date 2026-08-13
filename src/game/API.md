# game レイヤの公開 API 契約（リード所有・変更禁止）

`src/game/index.ts` は以下を export する。**UI はこの契約以外に game の内部へ触れない。**
ゲームプレイ担当と UI 担当が別々に作業しても噛み合うよう、リードが固定した。

すべての関数は `GameState` を**その場で変更（mutate）**し、必要なら結果オブジェクトを返す。
UI は変更後に `render()` を呼び直す。イミュータブル更新はしない（SVG 再生成のコストが高く、
差分計算の利点が無いため。DESIGN_DECISIONS D-007 参照）。

```ts
import type {
  GameState, Creature, Genotype, Phenotype, Stage, CareAction,
  CareResult, ExhibitionScore, ShopItemDef, LifeState, FieldState,
  StaffCandidate, StaffRole,
} from '../core/types.ts';

// ── 生成・進行 ─────────────────────────────────────────────
/** 新規ゲーム。worldSeed 省略時は実時間から生成。 */
export function newGame(worldSeed?: string): GameState;

/** 卵選択画面に出す 9 個の候補を作り state.pendingEggs に入れて返す。決定論的（worldSeed 由来）。 */
export function rollEggChoices(state: GameState): { seed: string; genotype: Genotype }[];

/** 選んだ 3 つの seed を確定し、卵の Creature を作る。pendingEggs は null に戻す。 */
export function chooseEggs(state: GameState, seeds: string[], now: number): { ok: boolean; reason?: string };

/** 時間経過を適用（オフライン分も含む）。UI は 250ms ごとに呼ぶ。 */
export function applyTick(state: GameState, now: number): TickReport;

export interface TickReport {
  /** この tick で孵化した個体 ID。 */
  hatched: string[];
  /** この tick で成体になった個体 ID。 */
  grownUp: string[];
  /** 新たに解放された機能 ID（展示会・ショップ・交配・標本帳・ブリーダー・飼育員）。 */
  unlocked: string[];
  /** オフライン分をまとめて適用したときの経過ミリ秒（0 なら通常 tick）。 */
  offlineMs: number;
  /** フィールドの清潔度・排泄物・配置が変化したか。 */
  fieldChanged: boolean;
  /** 排泄物の生成・ロボット清掃など、画面上で知らせるイベントが起きたか。 */
  fieldEvent: boolean;
}

// ── 世話 ───────────────────────────────────────────────────
/** 世話を 1 回行う。飽き・満足・性格による反応差はこの中で解決される。 */
export function doCare(state: GameState, creatureId: string, action: CareAction, now: number): CareResult;

/** そのアクションが今使えるか（クールダウン・段階不一致・休息中など）。UI のボタン活性判定用。 */
export function careAvailability(
  state: GameState, creatureId: string, action: CareAction, now: number,
): { enabled: boolean; reason?: string; effectiveness: number /* 0..1 飽き込みの効き目 */ };

/** その段階で選べる世話アクションの一覧（順序は UI 表示順）。 */
export function careActionsFor(stage: Stage): CareAction[];

// ── ショップ ───────────────────────────────────────────────
/** 現在購入可能な商品（解放条件を満たすもの）。 */
export function availableItems(state: GameState): ShopItemDef[];
export function buyItem(state: GameState, itemId: string): { ok: boolean; reason?: string };
/** 消耗品を個体に使う。装飾・設備は buyItem した時点で有効になるのでここは通さない。 */
export function useItem(state: GameState, creatureId: string, itemId: string, now: number): CareResult;

// ── 飼育フィールド ────────────────────────────────────────
/** フィールドの排泄物を片付け、環境と個体の清潔度を回復する。 */
export function cleanField(state: GameState, now: number): { ok: boolean; cleaned: number; reason?: string };
export function cleanDropping(state: GameState, droppingId: string, now: number): { ok: boolean; cleaned: number; reason?: string };
/** フィールド上の往復ルート・向き・歩き/走りを seed と時刻から決定する。保存不要・決定論的。 */
export function fieldMotionFor(creature: Creature, now: number, index?: number, total?: number): {
  x: number; y: number; scale: number; phase: number;
  facing: -1 | 1; gait: 'rest' | 'walk' | 'run'; gaitPhaseMs: number;
};
/** 次の排泄までの目安（ms）。卵では null。 */
export function nextDroppingIn(state: GameState, creature: Creature, now: number): number | null;
/** ショップで購入済みの遊具を 12 マスのいずれかへ配置する。 */
export function placeFieldItem(
  state: GameState, itemId: string, slot: number, now: number,
): { ok: boolean; reason?: string; placement?: import('../core/types.ts').FieldPlacement };
/** 配置済みの遊具を外す（所有権は残る）。 */
  export function removeFieldItem(state: GameState, itemId: string, now: number): { ok: boolean; reason?: string };

// ── 飼育員 ────────────────────────────────────────────────
/** 募集中の候補を作る。候補は worldSeed と募集回数から決まり、state に保存される。 */
export function refreshStaffCandidates(state: GameState, now?: number): StaffCandidate[];
/** 現在の候補を見送り、次の募集を出す。 */
export function rerollStaffCandidates(state: GameState, now?: number): { ok: boolean; reason?: string; candidates?: StaffCandidate[] };
/** 候補を雇い、採用費を支払う。給与は applyTick の時間経過で処理される。 */
export function hireStaff(state: GameState, candidateId: string, now?: number): { ok: boolean; reason?: string; candidate?: StaffCandidate };
/** 雇用中の飼育員を解雇する（支払済みの費用は戻らない）。 */
export function dismissStaff(state: GameState, now?: number): { ok: boolean; reason?: string };
export function hiredStaff(state: GameState): StaffCandidate | null;

/** 個体名を正規化して変更する。空名・重複・16文字超などは失敗する。 */
export function renameCreature(
  state: GameState, creatureId: string, rawName: string, now?: number,
): { ok: boolean; name?: string; reason?: string };
export const CREATURE_NAME_MAX_LENGTH: 16;

// ── 展示会 ─────────────────────────────────────────────────
export function canExhibit(state: GameState, creatureId: string, now: number): { ok: boolean; reason?: string };
/** 採点して報酬を state に反映し、結果を返す。演出は UI 側の責任。 */
export function runExhibition(state: GameState, creatureId: string, now: number): ExhibitionScore;

// ── 販売所・ブリーダー ──────────────────────────────────────
/** 現在の個体を販売した場合の決定論的な見積額。state は変更しない。 */
export function saleQuote(state: GameState, creatureId: string): SaleQuoteResult;
export type SaleQuoteResult =
  | { ok: true; quote: SaleQuote; creature: Creature }
  | { ok: false; reason: string };
export interface SaleQuote {
  creatureId: string;
  creatureName: string;
  stage: Stage;
  price: number;
  base: number;
  conditionBonus: number;
  rarityBonus: number;
  exhibitionBonus: number;
  generationBonus: number;
}
/** ブリーダー資格を確認して個体を販売し、売上履歴に記録する。 */
export function sellCreature(state: GameState, creatureId: string, now: number): SellResult;
export type SellResult =
  | { ok: true; quote: SaleQuote; record: import('../core/types.ts').SaleRecord }
  | { ok: false; reason: string };

// ── 交配 ───────────────────────────────────────────────────
export function canBreed(state: GameState, aId: string, bId: string): { ok: boolean; reason?: string };
/** 交配して卵を 1 つ産む。生まれた卵の Creature ID を返す。 */
export function doBreed(state: GameState, aId: string, bId: string, now: number): { ok: boolean; eggId?: string; reason?: string };
/** 交配画面のプレビュー: 子に受け継がれる可能性がある特徴の日本語説明。 */
export function breedingPreview(a: Creature, b: Creature): { label: string; detail: string }[];

// ── 参照系（副作用なし） ───────────────────────────────────
/** 表現型。内部でメモ化される。UI は毎フレーム呼んでよい。 */
export function getPhenotype(creature: Creature, stage?: Stage): Phenotype;
export function findCreature(state: GameState, id: string): Creature | undefined;
export function creaturesByStage(state: GameState, stage: Stage): Creature[];
export function capacityUsed(state: GameState): { egg: number; juvenile: number; adult: number };
/** 所持枠に空きがあるか。 */
export function hasRoomFor(state: GameState, stage: Stage): boolean;
/** 個体を手放す（枠が満杯のときの逃がし）。 */
export function releaseCreature(state: GameState, id: string): { ok: boolean; reason?: string };

/** 解放条件を再評価し、新たに解放された ID を返す。 */
export function refreshUnlocks(state: GameState): string[];
/** 未解放機能の解放条件を日本語で説明する（「今後解放」表示に使う）。 */
export function unlockHint(state: GameState, feature: keyof GameState['unlocks']): string;

/** 「次に何をすればよいか」の 1 行ガイド。UI のヘッダに常時出す。指示書 §25「次に何をすればよいか分かる」対応。 */
export function nextObjective(state: GameState): { text: string; screen: string | null; creatureId?: string };
```

`STAFF` は飼育員の採用費・給与・巡回間隔、`FIELD` はフィールドの排泄・清掃・配置の
バランス正本として `src/game/index.ts` から再輸出する。

## 規約

1. **`ShopItemDef.passive` は倍率への加算値**。例 `hungerDecay: -0.2` は減衰 20% 減。
   複数の設備を持つ場合は加算してから 1 に足す（`1 + Σpassive`）。下限は 0.1 でクランプ。
2. **`getPhenotype` はメモ化必須**。キー は `phenotypeCacheKey(genotype, stage)`。
   UI は描画のたびに呼ぶので、毎回計算すると 100 体一覧が落ちる。
3. **`doCare` / `useItem` は `CareResult` を返す**。UI はこの `reaction` と `speech` で演出を出す。
   演出の内容（どのアニメーションを再生するか）は UI の責任、反応の種別決定は game の責任。
4. **保存は UI が行う**。game は state を変更するだけで localStorage に触らない。
   UI は「卵選択後・世話後・孵化後・成長後・展示会後・購入後・交配後・設定変更後・画面遷移時・20秒ごと」に保存する（指示書 §27）。
5. **`rollEggChoices` は決定論的**。同じ state から何度呼んでも同じ 9 個が出る（リロードしても変わらない）。
