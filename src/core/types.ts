/**
 * ゲノモン — 全モジュール共通の型契約（正本）
 *
 * このファイルは「インターフェースの背骨」であり、リードアーキテクトのみが所有する。
 * 各担当モジュールはここを import するだけで、互いを直接 import しない層構造にする。
 *
 *   Genotype  … 遺伝情報（保存対象・不変）
 *   Phenotype … Genotype から決定された外見的/行動的特徴（導出・キャッシュ可）
 *   LifeState … 年齢・成長・体調など時間で変化する状態（保存対象・可変）
 *   RenderModel … 描画に必要な座標/形状/色/描画順（Phenotype+LifeState から導出）
 *   SaveData  … 保存用データ
 *
 * 重要な不変条件:
 *   同じ (Genotype, stage, renderSize プロファイル) からは常に同じ RenderModel が出る。
 *   描画パスで Math.random() を呼んではならない。必ず seed 由来の RNG を使う。
 */

// ─────────────────────────────────────────────────────────
//  基礎
// ─────────────────────────────────────────────────────────

/** 基本素体。四足歩行型は採用しない（指示書 §10）。 */
export type BodyBase = 'maru' | 'yurei' | 'slime';

/** 成長段階。 */
export type Stage = 'egg' | 'juvenile' | 'adult';

export const STAGES: readonly Stage[] = ['egg', 'juvenile', 'adult'] as const;
export const BODY_BASES: readonly BodyBase[] = ['maru', 'yurei', 'slime'] as const;

/** 描画詳細プロファイル。遺伝形質には一切影響しない（表示品質のみ）。 */
export type RenderDetail = 'full' | 'lite';

// ─────────────────────────────────────────────────────────
//  遺伝子座（locus）定義
// ─────────────────────────────────────────────────────────

/** カテゴリ形質の遺伝子座。対立遺伝子は文字列 ID。 */
export type CatLocus =
  | 'base'        // 基本素体
  | 'silhouette'  // 輪郭バリエーション（素体内の形の癖）
  | 'eyeCount'    // 目の数
  | 'eyeShape'    // 目の形
  | 'pupil'       // 瞳
  | 'lashes'      // まつげ
  | 'mouth'       // 口
  | 'ears'        // 耳
  | 'earTip'      // 耳先の別色
  | 'antennae'    // 触角
  | 'horns'       // 角
  | 'plant'       // 植物器官（葉・芽・花）
  | 'wings'       // 羽
  | 'tail'        // 尾
  | 'crystal'     // 結晶
  | 'collar'      // 首飾り状器官
  | 'feet'        // 小さな足
  | 'floaters'    // 浮遊物
  | 'pattern'     // 模様
  | 'texture'     // 質感
  | 'bicolor'     // 2 色化（体の色が途中で変わる）
  | 'lumin'       // 発光の出かた
  | 'palette';    // 配色ファミリー

/** 数値形質の遺伝子座。対立遺伝子は 0..1 の実数。 */
export type NumLocus =
  | 'size'          // 大きさ
  | 'ratio'         // 体の縦横比
  | 'plump'         // ふくらみ（輪郭の丸み）
  | 'hue'           // 基本色相（0..1 → 0..360）
  | 'hueShift'      // 補助色の色相差
  | 'sat'           // 彩度傾向
  | 'light'         // 明度傾向
  | 'patDensity'    // 模様の密度
  | 'patScale'      // 模様の大きさ
  | 'translucency'  // 透明度
  | 'glow'          // 発光
  | 'eyeSize'       // 目の大きさ
  | 'eyeSpacing'    // 目の間隔
  | 'wingSize'      // 羽の大きさ（基準の何倍か）
  | 'asymmetry'     // 左右非対称の強さ
  | 'decorAmount'   // 装飾量の傾向
  | 'growthSpeed'   // 成長速度
  | 'healthTend'    // 健康傾向
  // 性格軸（指示書 §15）
  | 'pEnergy'       // 活発 ⇔ おとなしい
  | 'pAffection'    // 人懐こい ⇔ 慎重
  | 'pCuriosity'    // 好奇心 ⇔ 警戒心
  | 'pDependence'   // 甘えん坊 ⇔ 自立的
  | 'pAppetite'     // 食いしん坊 ⇔ 小食
  | 'pTidiness';    // きれい好き ⇔ 気にしない

/** 二倍体の対立遺伝子ペア。順序は [母方, 父方] として保持するが表現には影響しない。 */
export type CatPair = readonly [string, string];
export type NumPair = readonly [number, number];

/**
 * 遺伝情報。保存され、決して破壊的に変更されない。
 * seed は「この個体固有の乱数系列の種」であり、遺伝子と併せて外見を完全に決定する。
 */
export interface Genotype {
  readonly seed: string;
  readonly cat: Readonly<Record<CatLocus, CatPair>>;
  readonly num: Readonly<Record<NumLocus, NumPair>>;
}

// ─────────────────────────────────────────────────────────
//  対立遺伝子のデータ駆動定義
// ─────────────────────────────────────────────────────────

export interface CatAlleleDef {
  /** 対立遺伝子 ID。 */
  id: string;
  /** 日本語表示名。UI にそのまま出す。 */
  label: string;
  /**
   * 優性度。大きいほど優性。
   * 同値の 2 つが揃うと共優性（co-dominant）表現になり得る（coDominant が true のとき）。
   */
  dominance: number;
  /** 初期個体群での出現重み。 */
  weight: number;
  /** 同順位同士が揃ったとき共優性表現を試みるか。 */
  coDominant?: boolean;
  /** 潜性表現時に UI で「隠れ形質」として提示するか。 */
  notable?: boolean;
  /** この対立遺伝子が使える素体の制限（省略時は全素体）。 */
  bases?: readonly BodyBase[];
}

export interface CatLocusDef {
  locus: CatLocus;
  label: string;
  alleles: readonly CatAlleleDef[];
  /** 共優性の結果として生じる合成表現（例: 'leaf'+'flower' → 'leafFlower'）。 */
  coExpress?: Readonly<Record<string, string>>;
}

export interface NumLocusDef {
  locus: NumLocus;
  label: string;
  /** 初期個体群での平均・分散（0..1 空間）。 */
  mean: number;
  spread: number;
  /** 表現時に UI で見せるか。 */
  hidden?: boolean;
}

// ─────────────────────────────────────────────────────────
//  表現型
// ─────────────────────────────────────────────────────────

export interface Palette {
  /** 本体色（メイン）。 */
  body: string;
  /** 本体の陰。 */
  bodyDark: string;
  /** 本体のハイライト。 */
  bodyLight: string;
  /** 腹／内側の淡色。 */
  belly: string;
  /** 輪郭のインク色。 */
  ink: string;
  /** 模様色。 */
  pattern: string;
  /** アクセント（装飾器官）色。 */
  accent: string;
  /** 虹彩色。 */
  iris: string;
  /** 発光色。 */
  glow: string;
  /** 頬の色。 */
  cheek: string;
  /** 生成に使った HSL 値（デバッグ・評価用）。 */
  hsl: { h: number; s: number; l: number };
  /** 配色ファミリー ID。 */
  family: string;
}

export interface Personality {
  energy: number;      // 0=おとなしい .. 1=活発
  affection: number;   // 0=慎重 .. 1=人懐こい
  curiosity: number;   // 0=警戒心 .. 1=好奇心
  dependence: number;  // 0=自立的 .. 1=甘えん坊
  appetite: number;    // 0=小食 .. 1=食いしん坊
  tidiness: number;    // 0=気にしない .. 1=きれい好き
  /** 代表的な性格ラベル（UI 表示用）。 */
  label: string;
  /** 補足ラベル。 */
  subLabel: string;
}

/** 表現された各器官の種類。'none' は非発現。 */
export interface PartExpression {
  eyeCount: number;
  eyeShape: string;
  pupil: string;
  /** まつげの有無。目の形（eyeShape）とは独立した遺伝子座。 */
  lashes: string;
  mouth: string;
  ears: string;
  /** ごく稀に耳先だけ別色になる形質。耳の形とは独立。 */
  earTip: string;
  antennae: string;
  horns: string;
  plant: string;
  wings: string;
  tail: string;
  crystal: string;
  collar: string;
  feet: string;
  floaters: string;
  pattern: string;
  texture: string;
  /** 2 色化の出かた（'none' なら単色系）。 */
  bicolor: string;
  /** 発光の出かた（'none' なら光らない）。 */
  lumin: string;
  silhouette: string;
}

export type RarityTier = 'common' | 'uncommon' | 'rare' | 'precious';

export interface Rarity {
  /** 0..100。 */
  score: number;
  tier: RarityTier;
  /** 希少と判定した具体的な理由（UI・展示会コメントで使う）。 */
  reasons: string[];
}

/** UI に出す「この子の特徴」1 項目。 */
export interface TraitSummary {
  locus: CatLocus | NumLocus;
  label: string;
  value: string;
  /** 潜性で隠れている側（保因）を持つ場合の表示。 */
  carrier?: string;
  /** 珍しい形質か。 */
  notable?: boolean;
}

/**
 * 遺伝情報から決定された、現在の外見的・行動的特徴。
 * stage を含むのは「成長差分」を表現型レベルで解決するため。
 */
export interface Phenotype {
  seed: string;
  stage: Stage;
  base: BodyBase;
  /** 素体の日本語名。 */
  baseLabel: string;
  size: number;         // 0.8..1.25 相対
  ratio: number;        // 幅/高さ 比 0.78..1.28
  plump: number;        // 0..1
  translucency: number; // 0..1
  glow: number;         // 0..1
  asymmetry: number;    // 0..1
  eyeSize: number;
  eyeSpacing: number;
  /** 羽の大きさの倍率傾向（0..1）。実際の倍率への変換は render 側（aura.ts）で行う。 */
  wingSize: number;
  patDensity: number;
  patScale: number;
  decorAmount: number;
  growthSpeed: number;
  healthTend: number;
  palette: Palette;
  parts: PartExpression;
  personality: Personality;
  rarity: Rarity;
  traits: TraitSummary[];
}

// ─────────────────────────────────────────────────────────
//  生存状態
// ─────────────────────────────────────────────────────────

export interface LifeState {
  stage: Stage;
  /** 実時間ミリ秒での年齢。 */
  ageMs: number;
  /** 成長度 0..100。100 で次段階へ。 */
  growth: number;
  /** 満腹度 0..100（高いほど満たされている）。 */
  hunger: number;
  /** 水分 0..100。 */
  hydration: number;
  /** 清潔 0..100。 */
  cleanliness: number;
  /** 機嫌 0..100。 */
  mood: number;
  /** 健康 0..100。 */
  health: number;
  /** 卵の孵化進捗 0..100。 */
  hatchProgress: number;
  /** 通算の世話回数。 */
  careCount: number;
  /** 世話の種類ごとの直近実施時刻（ms epoch）。飽きの計算に使う。 */
  lastCareAt: Record<string, number>;
  /** 直近の tick 時刻（ms epoch）。 */
  lastTickAt: number;
  /** 休息中の終了時刻（ms epoch）。0 なら休息していない。 */
  restingUntil: number;
}

export type CareAction =
  | 'warm' | 'moisten' | 'talk' | 'touch' | 'tidyEnv'   // 卵向け
  | 'feed' | 'water' | 'clean' | 'pet' | 'play' | 'rest'; // 幼体・成体向け

// ─────────────────────────────────────────────────────────
//  個体
// ─────────────────────────────────────────────────────────

export interface Creature {
  id: string;
  seed: string;
  name: string;
  genotype: Genotype;
  life: LifeState;
  /** 親の個体 ID。初期個体は null。 */
  parents: readonly [string, string] | null;
  /** 親の名前スナップショット（親が失われても比較表示できるように）。 */
  parentNames: readonly [string, string] | null;
  generation: number;
  bornAt: number;
  /** 展示会の最高得点。 */
  bestScore: number;
  /** 展示会の参加回数。 */
  exhibitionCount: number;
  /**
   * 最後に展示会へ参加した時刻（ms epoch）。0 なら未参加。
   * クールダウン判定に使う。モジュール内 Map に置くとリロードで消え、
   * 展示会を連続で回してコインを稼げてしまうため、個体に保存する。
   */
  lastExhibitAt: number;
  /** 最後に交配した時刻（ms epoch）。0 なら未交配。上と同じ理由で個体に保存する。 */
  lastBredAt: number;
  /** お気に入り。 */
  favorite: boolean;
  /** 卵が「誰かの子」として生まれたか（初期選択卵は false）。 */
  fromBreeding: boolean;
}

// ─────────────────────────────────────────────────────────
//  RenderModel（描画契約）
// ─────────────────────────────────────────────────────────

/** パーツの接合点。Visual Lab のデバッグ表示に使う。 */
export interface Anchor {
  id: string;
  x: number;
  y: number;
  /** 度。パーツの向き。 */
  angle: number;
  scale: number;
}

/** 描画順を持つ 1 パーツ。svg は自己完結した SVG 断片。 */
export interface RenderPart {
  id: string;
  /** 描画順（小さいほど奥）。同値は配列順で安定ソート。 */
  z: number;
  /** SVG マークアップ断片。 */
  svg: string;
  /** このパーツの接合点（デバッグ表示用）。 */
  anchor?: Anchor;
  /** 概算バウンディングボックス（はみ出し検査用）。 */
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface RenderModel {
  seed: string;
  stage: Stage;
  base: BodyBase;
  detail: RenderDetail;
  /** 一意な描画インスタンス ID。SVG 内 id 衝突を避けるための接頭辞。 */
  uid: string;
  viewBox: { x: number; y: number; w: number; h: number };
  /** <defs> に入る内容。 */
  defs: string;
  /** 描画順にソート済みのパーツ列。 */
  parts: RenderPart[];
  /** すべての接合点。 */
  anchors: Anchor[];
  /** 本体の外接矩形（はみ出し検査の基準）。 */
  bodyBox: { x: number; y: number; w: number; h: number };
  /** 顔の領域（装飾が覆っていないか検査する基準）。 */
  faceBox: { x: number; y: number; w: number; h: number };
  /** アニメーション用のパラメータ。 */
  motion: MotionParams;
}

export interface MotionParams {
  /** 呼吸/伸縮の周期（ms）。 */
  breathMs: number;
  /** 呼吸の振幅（0..1）。 */
  breathAmp: number;
  /** 上下浮遊の振幅（px）。 */
  floatAmp: number;
  floatMs: number;
  /** まばたき間隔（ms）。 */
  blinkMs: number;
  /** 体の傾ぎ（度）。 */
  swayDeg: number;
  swayMs: number;
  /** 位相オフセット（個体差）。 */
  phase: number;
}

// ─────────────────────────────────────────────────────────
//  ゲーム進行
// ─────────────────────────────────────────────────────────

export interface Unlocks {
  nursery: boolean;
  exhibition: boolean;
  shop: boolean;
  breeding: boolean;
  collection: boolean;
  /** 公認ブリーダー資格と販売所。 */
  breeder: boolean;
  /** 飼育員の募集・雇用。 */
  staff: boolean;
}

export interface Capacity {
  egg: number;
  juvenile: number;
  adult: number;
}

export interface ShopItemDef {
  id: string;
  name: string;
  price: number;
  /** カテゴリ。 */
  kind: 'food' | 'drink' | 'care' | 'growth' | 'health' | 'decor' | 'equipment';
  /** 短い説明。 */
  desc: string;
  /** 効果の一行表記（UI 用）。 */
  effectText: string;
  /** 使用対象。 */
  target: 'egg' | 'juvenile' | 'adult' | 'any' | 'room' | 'field';
  /** 消費型か（false なら設備・装飾で永続）。 */
  consumable: boolean;
  /** 効果（消費型のみ）。 */
  effect?: Partial<Record<'hunger' | 'hydration' | 'cleanliness' | 'mood' | 'health' | 'growth' | 'hatch', number>>;
  /** 設備効果（永続）。 */
  passive?: Partial<Record<'growthRate' | 'moodDecay' | 'hungerDecay' | 'cleanlinessDecay' | 'hatchRate' | 'healthRegen', number>>;
  /** 飼育枠を増やす買い切り許可証。購入時に capacity へ加算する。 */
  capacityIncrease?: Partial<Record<Stage, number>>;
  /** フィールドへ配置できる買い切り物。 */
  fieldObject?: FieldObjectKind;
  /** 解放に必要な条件。 */
  requires?: { exhibitions?: number };
}

/** 販売所に残す、売却済み個体の最小限の来歴。遺伝情報そのものは複製しない。 */
export interface SaleRecord {
  id: string;
  creatureName: string;
  seed: string;
  stage: Stage;
  generation: number;
  parentNames: readonly [string, string] | null;
  bestScore: number;
  exhibitionCount: number;
  price: number;
  soldAt: number;
}

/** 公認ブリーダーの資格・販売実績。 */
export interface BreederState {
  licensed: boolean;
  sales: number;
  earnings: number;
  history: SaleRecord[];
}

/** 飼育員の雇用形態。短時間勤務は安価だが、一度に世話できる子が少ない。 */
export type StaffRole = 'partTime' | 'fullTime';

/** 募集に応じた候補者。能力値はセーブに残し、雇用後も同じ人として扱う。 */
export interface StaffCandidate {
  id: string;
  name: string;
  role: StaffRole;
  /** 給料。STAFF.payIntervalMs ごとに引かれる。 */
  wage: number;
  /** 世話の効率。0.7〜1.35。 */
  skill: number;
  /** 仕事を休まず続ける確率の基準値。決定論的な欠勤判定に使う。 */
  reliability: number;
  profile: string;
  reason: string;
  quirk: string;
}

/** 現在の募集と雇用中の飼育員。候補者を保存するので再起動で能力が変わらない。 */
export interface StaffState {
  candidates: StaffCandidate[];
  hiredId: string | null;
  hiredAt: number;
  lastServiceAt: number;
  lastPaidAt: number;
  unpaidSince: number;
  /** 解雇後に募集を更新するたびに増える決定論的な世代番号。 */
  candidateCycle: number;
}

/** フィールドに置ける遊具・環境物の種類。見た目だけでなく配置状態を保存する。 */
export type FieldObjectKind = 'log' | 'pond' | 'flowerbed' | 'shade' | 'food' | 'water';

export interface FieldPlacement {
  itemId: string;
  slot: number;
  placedAt: number;
}

export interface FieldDropping {
  id: string;
  creatureId: string;
  x: number;
  y: number;
  createdAt: number;
}

/** 複数個体が生活するフィールドの永続状態。 */
export interface FieldState {
  cleanliness: number;
  droppings: FieldDropping[];
  placements: FieldPlacement[];
  /** 個体ごとの排泄生成済み年齢。tick の粒度に依存せず重複生成を防ぐ。 */
  lastDroppingAge: Record<string, number>;
  lastTickAt: number;
  lastRobotCleanAt: number;
}

export interface ExhibitionScore {
  beauty: number;      // 美しさ
  health: number;      // 健康状態
  character: number;   // 個性
  rarity: number;      // 希少性
  care: number;        // 育成状態
  total: number;       // 合計 0..100
  rank: 'D' | 'C' | 'B' | 'A' | 'S';
  coins: number;
  comments: string[];
  /** 審査員名 */
  judge: string;
}

export interface Settings {
  volume: number;      // 0..1
  muted: boolean;
  reducedMotion: boolean;
  skipCutscenes: boolean;
}

export interface TutorialState {
  /** 完了済みのステップ ID。 */
  done: string[];
  /** 現在のガイド対象。 */
  current: string | null;
}

export interface GameStats {
  hatched: number;
  grownUp: number;
  bred: number;
  exhibitions: number;
  coinsEarned: number;
  careActions: number;
  /** 飼育員が自動で行った世話の回数。プレイヤーの手動世話とは分けて記録する。 */
  staffCareActions: number;
}

export type ScreenId =
  | 'title' | 'eggSelect' | 'nursery' | 'field' | 'collection' | 'detail'
  | 'exhibition' | 'shop' | 'breeding' | 'market' | 'staff' | 'settings' | 'visualLab';

export interface GameState {
  version: number;
  createdAt: number;
  updatedAt: number;
  /** 新規 seed 生成用の決定論的カウンタ。 */
  seedCounter: number;
  /** ワールド seed。セーブごとに固有。 */
  worldSeed: string;
  coins: number;
  creatures: Creature[];
  /** 選択画面で提示中の卵候補（未確定）。 */
  pendingEggs: { seed: string; genotype: Genotype }[] | null;
  inventory: Record<string, number>;
  /** 購入済みの設備・装飾 ID。 */
  owned: string[];
  unlocks: Unlocks;
  capacity: Capacity;
  settings: Settings;
  tutorial: TutorialState;
  stats: GameStats;
  /** 育成室で選択中の個体 ID。 */
  activeCreatureId: string | null;
  /** 複数個体が生活するフィールドの状態。 */
  field: FieldState;
  /** 公認ブリーダー資格と、売却済み個体の記録。 */
  breeder: BreederState;
  /** 飼育員の募集・雇用・給与の状態。 */
  staff: StaffState;
  /** 将来のオンライン機能用の予約領域（縦切り版では未使用）。 */
  future: {
    marketListings: unknown[];
    tradeHistory: unknown[];
    rankingCache: unknown | null;
  };
}

// ─────────────────────────────────────────────────────────
//  セーブ
// ─────────────────────────────────────────────────────────

/**
 * セーブ形式のバージョン。
 * v7 で飼育員の募集・給与・自動世話を追加した。
 * v6 で飼育フィールド（排泄・掃除・配置）を追加した。
 * v5 では公認ブリーダー資格・販売履歴を追加した。
 * v4 では Creature に lastExhibitAt / lastBredAt を追加した
 * （クールダウンがリロードで消える不具合の修正。DESIGN_DECISIONS D-013 参照）。
 */
export const SAVE_VERSION = 7;

export interface SaveData {
  version: number;
  savedAt: number;
  /** 破損検知用のチェックサム。 */
  checksum: string;
  state: GameState;
}

export type SaveLoadResult =
  | { ok: true; state: GameState; migratedFrom?: number; usedBackup?: boolean }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'corrupt'; detail: string; recovered?: GameState };

// ─────────────────────────────────────────────────────────
//  イベント（UI ↔ ゲームロジックの疎結合用）
// ─────────────────────────────────────────────────────────

export interface CareResult {
  ok: boolean;
  /** 拒否理由（ok=false のとき）。 */
  reason?: string;
  /** ゲノモンの反応種別。演出に使う。 */
  reaction: 'happy' | 'delighted' | 'neutral' | 'dislike' | 'sleepy' | 'full';
  /** 吹き出しに出す短い台詞。 */
  speech: string;
  /** 変化した値。 */
  deltas: Partial<Record<keyof LifeState, number>>;
  /** 段階が変わったか。 */
  evolved?: Stage;
  /** 飽きているか（同じ操作の連打抑制）。 */
  bored?: boolean;
}
