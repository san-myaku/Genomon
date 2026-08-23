/**
 * ゲノモン — ゲームバランスの正本（データ駆動）
 *
 * 【このファイルの役割】
 *   世話の効果量・減衰速度・価格・展示会報酬・解放条件など、
 *   「調整したくなる数値」をすべてここに集約する。
 *   他モジュール（game/ui/save）は数値をハードコードせず、必ずここを import すること。
 *
 * 【設計方針（指示書 §5 §7 §8 §9）】
 *   - 縦切り版として、最初の孵化は通常プレイで数分以内に到達すること。
 *   - 同じボタンを連打するだけの作業ゲーにしないこと（→ BOREDOM）。
 *   - 初回展示会の報酬で必ず何か買えること（→ EXHIBITION.firstTimeMinCoins）。
 *   - 放置で全部終わらないこと（→ TIMING.maxOfflineMs）。
 *
 * 【値の根拠】
 *   各定数に「なぜその値なのか」を 1 行コメントで添えてある。
 *   数値を変えるときはコメントの前提も一緒に見直すこと。
 */

import type {
  CareAction,
  Capacity,
  BreederState,
  ExhibitionScore,
  FieldState,
  GameStats,
  Settings,
  StaffState,
  ShopItemDef,
  Stage,
  TutorialState,
  Unlocks,
} from '../core/types.ts';

/** 展示会ランク。ExhibitionScore の定義から借りて二重定義を避ける。 */
export type Rank = ExhibitionScore['rank'];

/** 世話・アイテムが動かせる LifeState 上の数値キー（ShopItemDef.effect と同じ語彙に揃える）。 */
export type EffectKey = 'hunger' | 'hydration' | 'cleanliness' | 'mood' | 'health' | 'growth' | 'hatch';

// ─────────────────────────────────────────────────────────
//  1. 時間・進行
// ─────────────────────────────────────────────────────────

export const TIMING = {
  /** 卵の孵化しきい値。LifeState.hatchProgress が 0..100 なので 100 固定。 */
  hatchTarget: 100,
  /** 卵は放置でも毎秒 +0.35 進む。世話ゼロでも約 4.8 分で孵るので「詰み」がない。 */
  hatchPassivePerSec: 0.35,

  /** 幼体→成体のしきい値。LifeState.growth が 0..100 なので 100 固定。 */
  growthTarget: 100,
  /** 幼体は毎秒 +0.25 成長。世話を挟めば 3〜5 分で成体になる想定。 */
  growthPassivePerSec: 0.25,

  /** 成体は growth を伸ばさない（打ち止め）。UI が満タン表示を出すための明示フラグ。 */
  adultGrowthPerSec: 0,

  /** オフライン経過は最大 2 時間分しか加算しない。一晩放置で全部完了する事故を防ぐ。 */
  maxOfflineMs: 2 * 60 * 60 * 1000,
  /** オフライン中の減衰は半分。留守にした罰で瀕死になっていると復帰意欲が削がれるため。 */
  offlineDecayScale: 0.5,
  /** オフライン中の進行（孵化・成長）は 6 割。放置プレイが最適解にならない程度に効かせる。 */
  offlineProgressScale: 0.6,

  /** ゲームループの tick 間隔。4fps 相当で十分。描画は別 rAF で回すため軽くしてある。 */
  tickMs: 250,
  /** 自動保存の間隔（指示書 §27 の「一定時間ごと」）。20 秒なら事故時の巻き戻しが体感的に痛くない。 */
  autoSaveMs: 20_000,

  /** 「やすませる」の休息時間。45 秒は待たされ感が出ない上限。 */
  restDurationMs: 45_000,
  /** 休息中は減衰が 3 割になる。休ませる意味を数値で持たせるため。 */
  restDecayScale: 0.3,

  /**
   * 世話ボタン全体の最小間隔（ms）。
   * 世話ごとの cooldownMs は「同じボタン」しか止めないため、
   * これが無いと 5 種のボタンを 2 秒で連打して卵が即孵る（実測で 5 秒）。
   * 反応演出を見せる最低時間でもあるので 2 秒。
   */
  globalCareCooldownMs: 2_000,
} as const;

// ─────────────────────────────────────────────────────────
//  2. 自然減衰
// ─────────────────────────────────────────────────────────

/**
 * 【2 度目の調整（リードの手プレイでの不合格を受けて）】
 *
 * 旧値（hunger 0.20 / hydration 0.24 / cleanliness 0.12 / mood 0.15）は
 * 「1 体を見ながら数十秒で数値が動くのが見える速さ」として決めたが、
 * 実プレイでは **3 体 × 4 ゲージ ＝ 12 本** を同時に維持することになる。
 *
 *   旧: 1 体あたりの減衰合計 0.71/秒。世話 1 回の回復が約 35 なので、
 *       均衡するには 1 体あたり 49 秒に 1 回 ＝ 3 体で 16 秒に 1 回の操作が必要。
 *       ところが SATIATION は 18 秒未満の間隔の世話を非効率にする設計なので、
 *       「ゲームが推奨する遊び方では絶対に維持できない」という自己矛盾が起きていた。
 *       実測（リードの手プレイ 30 分）で 3 体とも おなか 0・みず 0・健康 0〜3 に落ちた。
 *
 *   新: 減衰合計 0.18/秒。世話 1 回 35 に対し、1 体あたり 195 秒に 1 回で均衡する。
 *       3 体なら「65 秒に 1 回どれかを世話する」で釣り合い、
 *       人が実際に遊ぶ間隔（60〜90 秒に 1 回）とかみ合う。
 *       ゲージが 0 になるまでの時間は 30 分前後で、放置の実感も残る。
 */
export const DECAY = {
  /** 毎秒 0.05 → 満腹 100 が 0 になるまで約 33 分。3 体ぶんを人の手で回せる速さ。 */
  hunger: 0.05,
  /** 水分は空腹よりやや速い。飲み物アイテムに存在意義を与えるため。 */
  hydration: 0.06,
  /** 清潔はゆっくり。汚れは「気付いたら掃除する」程度の頻度が心地よい。 */
  cleanliness: 0.025,
  /** 機嫌は中間速度。交配条件（機嫌 60）に手が届く速さに合わせてある。 */
  mood: 0.045,

  /** 卵は代謝が低い設定。卵の世話が「減った分を埋める作業」にならないように 35% へ抑える。 */
  eggScale: 0.35,

  /** 「赤ゲージ」とみなす境界。案内の優先度と成長の鈍りに使う。 */
  lowThreshold: 25,

  // ── 健康（体調）のモデル ────────────────────────────────
  //
  // 旧実装は「低いステータス 1 種につき -0.10/秒、回復は全ステータス 60 以上のとき +0.06/秒」
  // という **一方通行のラチェット** だった。4 種とも低いと -0.40/秒 ＝ 4 分で瀕死、
  // 戻すには全ゲージを 60 以上に保ったまま 16 分。減衰と回復が 6.7:1 の非対称で、
  // 一度底を打つと手作業では現実的に戻せない（＝薬を使っても 2 分で元に戻る）。
  //
  // 新実装は「健康は世話の質の **遅れた鏡**」にした。
  //   目安値 = healthFloor + healthSpan × (満腹・水分・清潔・機嫌の平均 / 100)
  //   健康は毎 tick この目安値へ指数的に近づく（上がるときは速く、下がるときは遅い）。
  // これで
  //   - 底なしに落ちない（全ゲージ 0 でも healthFloor で止まる）
  //   - 世話を再開すれば必ず戻る（「全ステータス 60 以上」という崖が無い）
  //   - 減衰と回復が同じ仕組みなので非対称が生まれない
  // という 3 つを 1 つの式で満たす。

  /** 全ゲージが 0 でも健康はここまでしか落ちない。愛着を壊さないための下限（指示書 §25）。 */
  healthFloor: 20,
  /** 目安値の幅。世話の平均が 100 なら目安値 100、50 なら 60。 */
  healthSpan: 80,
  /** 体質（Phenotype.healthTend）による目安値の上下幅（±6）。丈夫な子はわずかに高い。 */
  healthTendSpan: 12,
  /** 目安値へ **上がる** ときの時定数。4 分で差の 63% を回復する。 */
  healthRiseMs: 240_000,
  /** 目安値へ **下がる** ときの時定数。悪化は回復の半分の速さにして、挽回の余地を残す。 */
  healthFallMs: 480_000,

  /** 各ステータスの下限。0 にすると「死亡」概念が要るので、縦切り版では 0 止まりで死なせない。 */
  floor: 0,
  /** 各ステータスの上限。 */
  ceil: 100,
} as const;

// ─────────────────────────────────────────────────────────
//  3. 飽き（連打抑制）
// ─────────────────────────────────────────────────────────

export const BOREDOM = {
  /** 直後に同じ世話を繰り返したときの効果倍率。40% まで落として連打を非効率にする。 */
  minFactor: 0.4,
  /** 何もしなくても 90 秒で飽きが完全に抜ける。放置プレイでも回復するので詰まない。 */
  recoverMs: 90_000,
  /** 「他の世話を 1 種類はさむ」ごとに 30% 回復。4 種類はさめば完全回復＝世話の巡回が最適解になる。 */
  otherCareRecovery: 0.3,
  /** 飽き倍率がこの値を下回ったら UI に「あきているみたい」を出す。 */
  boredNoticeBelow: 0.7,
} as const;

/**
 * 世話の「飽き」倍率を返す純関数。
 *
 * LifeState.lastCareAt（世話種別 → 最終実施時刻）だけを見て決定論的に決まる。
 *   - 時間経過による回復（recoverMs まで線形）
 *   - 他の世話をはさんだことによる回復（otherCareRecovery × 種類数）
 * のうち大きい方を採用する。「同じボタン連打は損、巡回は得」という設計（指示書 §5）。
 *
 * @returns BOREDOM.minFactor 〜 1 の倍率
 */
export function careBoredomFactor(
  lastCareAt: Readonly<Record<string, number>>,
  action: CareAction,
  now: number,
): number {
  const mine = lastCareAt[action];
  // 一度も使っていない世話は当然フルパワー。
  if (typeof mine !== 'number' || !Number.isFinite(mine)) return 1;

  const elapsed = Math.max(0, now - mine);
  const byTime = Math.min(1, elapsed / BOREDOM.recoverMs);

  // この世話より後に使われた「別の世話」の種類数を数える。
  let newer = 0;
  for (const key of Object.keys(lastCareAt)) {
    if (key === action) continue;
    const t = lastCareAt[key];
    if (typeof t === 'number' && Number.isFinite(t) && t > mine) newer++;
  }
  const byVariety = Math.min(1, newer * BOREDOM.otherCareRecovery);

  const recovery = Math.max(byTime, byVariety);
  return BOREDOM.minFactor + (1 - BOREDOM.minFactor) * recovery;
}

// ─────────────────────────────────────────────────────────
//  3-b. 満足（全体の進行ペース）
// ─────────────────────────────────────────────────────────

/**
 * 「さっき世話したばかり」を表す満足度。
 *
 * BOREDOM は "同じ世話" の連打だけを抑える。それだけだと
 * 「5 種のボタンを順に速く押す」が最適解になり、卵が数秒で孵ってしまう（実測済み）。
 * そこで、直前の世話からの経過時間に比例して効果が入る仕組みを全体にかける。
 *
 * この形にすると、押す間隔をどれだけ詰めても
 * 「1 秒あたりに入る量」がほぼ一定（＝効果量 / fullMs）に収束する。
 * ボタンを無効化せずに進行ペースを決められるのが利点で、
 * 連打しても壊れず、ただ「まだ満足しているみたい」と分かるだけになる。
 */
export const SATIATION = {
  /** 直前の世話から fullMs 経てば効果 100%。18 秒＝反応演出を見て一息つく間隔。 */
  fullMs: 18_000,
  /**
   * 間を置かずに押したときの下限。**0 でなければならない。**
   *
   * 【なぜ 0 か（重要）】
   *   効果倍率は `minFactor + (1 - minFactor) × min(t / fullMs, 1)`。
   *   「1 秒あたりどれだけ育つか」はこれを t で割った値になる:
   *
   *       rate(t) = minFactor / t + (1 - minFactor) / fullMs
   *
   *   第 1 項は **t が小さいほど大きくなる**。つまり minFactor が 0 より大きい限り、
   *   押す間隔を詰めるほど 1 秒あたりの効率が上がる ＝ 連打が常に有利になる。
   *   旧値 0.05 では t=2 秒で 0.0778/秒、t=18 秒で 0.0556/秒 と **連打が 1.40 倍速く**、
   *   画面の「連打しても 早くは なりません。」が事実に反していた
   *   （ゲームプレイ批評の実測でも連打ががまんの 1.7 倍速いことが確認された）。
   *
   *   0 にすると rate(t) = 1 / fullMs で **間隔に依らず一定**になり、
   *   「何回押しても速さは変わらない。待って押せば少ない回数で同じだけ育つ」
   *   という UI の説明がそのまま真になる。
   *
   * 【「無効打に見える」懸念について】
   *   0 でも t=2 秒なら倍率は 2/18 ≒ 11% あり、完全な無効打にはならない。
   *   加えて現在は効き目バーと「あと ○ 秒で 全効果」のカウントダウンが出るので、
   *   なぜ効きが薄いのかがプレイヤーに見えている。当初の懸念は解消済み。
   *
   * この値を 0 より大きくすると連打が有利に戻る。`tests/game.test.ts` の
   * 「連打しても 1 秒あたりの効率が上がらない」テストが落ちるようにしてある。
   */
  minFactor: 0,
  /** この値を下回ったら UI に「まだ満足しているみたい」を出す。 */
  satiatedNoticeBelow: 0.6,
} as const;

/**
 * 満足度による効果倍率を返す純関数。
 * 「直前に行った世話（種類を問わない）」からの経過時間だけで決まる。
 */
export function careSatiationFactor(lastCareAt: Readonly<Record<string, number>>, now: number): number {
  let last = Number.NEGATIVE_INFINITY;
  for (const key of Object.keys(lastCareAt)) {
    const t = lastCareAt[key];
    if (typeof t === 'number' && Number.isFinite(t) && t > last) last = t;
  }
  // 一度も世話していない（＝最初の 1 回）は必ず全効果。初手で手応えを返すため。
  if (last === Number.NEGATIVE_INFINITY) return 1;

  const elapsed = Math.max(0, now - last);
  const ratio = Math.min(1, elapsed / SATIATION.fullMs);
  return SATIATION.minFactor + (1 - SATIATION.minFactor) * ratio;
}

/**
 * 世話の最終的な効果倍率。ゲームプレイ側はこの 1 本だけ呼べばよい。
 *
 *   倍率 = 飽き（同じ世話の連打を抑える） × 満足（全体の進行ペースを決める）
 *
 * どちらも LifeState.lastCareAt だけから決まるので、追加の保存項目は要らない。
 */
export function careEffectMultiplier(
  lastCareAt: Readonly<Record<string, number>>,
  action: CareAction,
  now: number,
): number {
  return careBoredomFactor(lastCareAt, action, now) * careSatiationFactor(lastCareAt, now);
}

// ─────────────────────────────────────────────────────────
//  4. 世話アクション定義
// ─────────────────────────────────────────────────────────

export interface CareDef {
  action: CareAction;
  /** UI にそのまま出す日本語ラベル。 */
  label: string;
  /** UI のボタンに出す絵文字アイコン。 */
  icon: string;
  /** この世話が使える成長段階。 */
  stages: readonly Stage[];
  /** 連打防止のクールダウン（ms）。 */
  cooldownMs: number;
  /** 効果量。飽き倍率を掛けてから適用する。 */
  effect: Partial<Record<EffectKey, number>>;
  /** ショップ解放前でも無料で使えるか（指示書 §5 の「無料の基本飼料と水」）。 */
  free: boolean;
  /** ボタンの説明文（ツールチップ／チュートリアル用）。 */
  hint: string;
}

/**
 * 世話アクションの定義。
 *
 * 【卵の設計】5 種を 1 巡すると hatch +76。パッシブ +0.35/秒と SATIATION（18 秒で全効果）に
 *   従うと、世話 5〜6 回・1 分半前後で孵化する。
 * 【幼体の設計】6 種を 1 巡すると growth +42。同様に世話 8〜10 回・3 分前後で成体化。
 * 実測値はテスト（tests/save.test.ts の「バランス検証」）で毎回検証している。
 */
export const CARE_DEFS: Readonly<Record<CareAction, CareDef>> = {
  // ── 卵向け（指示書 §5） ──────────────────────────────
  warm: {
    action: 'warm',
    label: '温める',
    icon: 'flame',
    stages: ['egg'],
    cooldownMs: 5_000,
    // 孵化への寄与が最大。「温めるのが本命」と直感的に分かる差を付けてある。
    effect: { hatch: 18, mood: 3 },
    free: true,
    hint: '手のひらで包んで、ゆっくり温める。',
  },
  moisten: {
    action: 'moisten',
    label: '水分をあたえる',
    icon: 'drop',
    stages: ['egg'],
    cooldownMs: 5_000,
    // 孵化 +15 と水分。卵の殻の乾燥を防ぐ、という世界観の裏付け付き。
    effect: { hatch: 15, hydration: 10 },
    free: true,
    hint: '霧を吹いて、殻を乾かさないようにする。',
  },
  talk: {
    action: 'talk',
    label: '声をかける',
    icon: 'speech',
    stages: ['egg'],
    cooldownMs: 4_000,
    // 孵化寄与は最小だがクールダウンが最短。「気軽に押せる世話」の枠。
    effect: { hatch: 14, mood: 8 },
    free: true,
    hint: '殻ごしに、そっと名前を呼んでみる。',
  },
  touch: {
    action: 'touch',
    label: 'やさしく触れる',
    icon: 'hands',
    stages: ['egg'],
    cooldownMs: 4_500,
    effect: { hatch: 14, mood: 10 },
    free: true,
    hint: '指先で、殻のもようをなぞる。',
  },
  tidyEnv: {
    action: 'tidyEnv',
    label: '環境を整える',
    icon: 'broom',
    stages: ['egg'],
    cooldownMs: 6_000,
    // 清潔を大きく上げる代わりにクールダウン最長。掃除系は頻度を落とす。
    effect: { hatch: 15, cleanliness: 16 },
    free: true,
    hint: '苔と敷き葉を替えて、寝床を整える。',
  },

  // ── 幼体・成体向け（指示書 §5） ──────────────────────
  feed: {
    action: 'feed',
    label: 'えさ',
    icon: 'bowl',
    stages: ['juvenile', 'adult'],
    cooldownMs: 8_000,
    // 無料の基本飼料。満腹 +34 は減衰 0.20/秒の約 170 秒ぶん＝「3 分に 1 回」の頻度。
    effect: { hunger: 34, growth: 8, mood: 3 },
    free: true,
    hint: '基本飼料。無料でいつでも使える。',
  },
  water: {
    action: 'water',
    label: 'みず',
    icon: 'drop',
    stages: ['juvenile', 'adult'],
    cooldownMs: 7_000,
    // 無料の水。減衰が速い水分に合わせて回復量も多め。
    effect: { hydration: 38, growth: 6 },
    free: true,
    hint: '汲みたての水。無料でいつでも使える。',
  },
  clean: {
    action: 'clean',
    label: 'きれいにする',
    icon: 'bubbles',
    stages: ['juvenile', 'adult'],
    cooldownMs: 10_000,
    // 清潔は減衰が遅いぶん 1 回で大きく回復させ、押す回数を減らす。
    effect: { cleanliness: 42, mood: 4, growth: 6 },
    free: true,
    hint: 'やわらかい布で、体のよごれを拭き取る。',
  },
  pet: {
    action: 'pet',
    label: 'なでる',
    icon: 'hands',
    stages: ['juvenile', 'adult'],
    cooldownMs: 5_000,
    // 機嫌専用・クールダウン最短。反応演出を一番見たくなるボタンにする。
    effect: { mood: 22, growth: 7 },
    free: true,
    hint: '背中をゆっくりなでる。反応は性格で変わる。',
  },
  play: {
    action: 'play',
    label: 'あそぶ',
    icon: 'plane',
    stages: ['juvenile', 'adult'],
    cooldownMs: 9_000,
    // 機嫌と成長が最大だが、腹と水分を消費する。「遊んだら食べさせる」ループを作る。
    effect: { mood: 28, growth: 9, hunger: -6, hydration: -5 },
    free: true,
    hint: 'いっしょに遊ぶ。おなかと水分は減る。',
  },
  rest: {
    action: 'rest',
    label: 'やすませる',
    icon: 'moon',
    stages: ['juvenile', 'adult'],
    cooldownMs: 20_000,
    // 健康を回復できる唯一の無料手段。クールダウン最長で「切り札」の位置付け。
    effect: { health: 18, growth: 6, mood: 5 },
    free: true,
    hint: '寝床で休ませる。しばらく世話はできない。',
  },
};

/** 段階ごとに使える世話アクション一覧（UI のボタン並び順の正本）。 */
export const CARE_BY_STAGE: Readonly<Record<Stage, readonly CareAction[]>> = {
  egg: ['warm', 'moisten', 'talk', 'touch', 'tidyEnv'],
  juvenile: ['feed', 'water', 'clean', 'pet', 'play', 'rest'],
  adult: ['feed', 'water', 'clean', 'pet', 'play', 'rest'],
};

// ─────────────────────────────────────────────────────────
//  5. ショップ
// ─────────────────────────────────────────────────────────

/**
 * 商品一覧（12 品）。指示書 §8 の必須カテゴリを網羅しつつ、増やしすぎない。
 *
 * 【価格設計】
 *   初回展示会の最低保証 120 コインで、最安 35 コインの品が確実に買える。
 *   安価帯 35〜60 / 中価格帯 70〜130 / 設備帯 180〜260 の 3 層構成。
 * 【passive の意味】
 *   倍率に対する加算値。growthRate:+0.15 → 成長速度 +15%、
 *   hungerDecay:-0.2 → 空腹の減りが 20% 遅くなる。
 */
export const SHOP_ITEMS: readonly ShopItemDef[] = [
  // ── 飲み物・基本消耗品（最安帯：初回報酬で必ず買える） ──
  {
    id: 'springWater',
    name: '霧摘みの湧き水',
    price: 35,
    kind: 'drink',
    desc: '温室の朝霧を集めて漉した水。無料の水より澄んでいる。',
    effectText: '水分 +45 / 健康 +4',
    target: 'any',
    consumable: true,
    // 最安値。初回展示会の最低保証（120）で必ず買える価格に固定してある。
    effect: { hydration: 45, health: 4 },
  },
  {
    id: 'chimeBerry',
    name: 'ゆらゆら鈴の実',
    price: 40,
    kind: 'care',
    desc: '振ると澄んだ音が鳴る実。ゲノモンはこの音をとても気に入る。',
    effectText: '機嫌 +34',
    target: 'any',
    consumable: true,
    // 機嫌特化の最安手段。無料の「なでる」(+22) の上位互換だが消耗品なので使い所を選ぶ。
    effect: { mood: 34 },
  },
  {
    id: 'honeyMossBall',
    name: 'はちみつ苔だんご',
    price: 45,
    kind: 'food',
    desc: '苔と花蜜を練った中級飼料。ほのかに甘い匂いがする。',
    effectText: '満腹 +52 / 機嫌 +8 / 成長 +4',
    target: 'any',
    consumable: true,
    // 中級飼料。無料飼料(+34)の約 1.5 倍。1 回の世話で長く保つのが購入動機。
    effect: { hunger: 52, mood: 8, growth: 4 },
  },

  // ── 装飾（育成室の見た目に反映される。consumable:false） ──
  {
    id: 'sunnyLamp',
    name: '陽だまりランプ',
    price: 60,
    kind: 'decor',
    desc: '窓辺の光を模した小さなランプ。部屋がやわらかく色づく。',
    effectText: '育成室が明るくなる / 機嫌の減りが 10% 遅く',
    target: 'room',
    consumable: false,
    // 最初に買える装飾。見た目の変化＋わずかな効率という「買ってよかった」体験の入口。
    passive: { moodDecay: -0.1 },
  },
  {
    id: 'specimenShelf',
    name: '標本帳の書棚',
    price: 130,
    kind: 'decor',
    desc: '歴代の観察記録が並ぶ棚。研究室らしい背景になる。',
    effectText: '育成室に書棚が並ぶ',
    target: 'room',
    consumable: false,
    // 純粋な装飾。効率ゼロでも欲しくなる「飾り」の枠を確保しておく。
  },
  {
    id: 'glassPlanter',
    name: '硝子の温室鉢',
    price: 180,
    kind: 'decor',
    desc: '硝子の覆いの中で植物が茂る鉢。光が差すと影がゆれる。',
    effectText: '育成室に緑と光の影が増える',
    target: 'room',
    consumable: false,
    // 装飾の最上位。展示会を数回こなした頃の目標として置いてある。
    requires: { exhibitions: 2 },
  },

  // ── 中価格帯の消耗品 ──
  {
    id: 'whisperBrush',
    name: 'ささやき草のブラシ',
    price: 70,
    kind: 'care',
    desc: '穂先がやわらかい草のブラシ。手入れをしながら機嫌もとれる。',
    effectText: '清潔 +50 / 機嫌 +24',
    target: 'any',
    consumable: true,
    // 清潔と機嫌を同時に埋める時短アイテム。世話 2 回ぶんを 1 回にまとめる価値で 70。
    effect: { cleanliness: 50, mood: 24 },
  },
  {
    id: 'evergreenTonic',
    name: '常盤葉の煎じ薬',
    price: 85,
    kind: 'health',
    desc: '常緑の葉を煮出した苦い薬。弱った体をしっかり戻す。',
    effectText: '健康 +45',
    target: 'any',
    consumable: true,
    // 健康回復の主力。無料の「やすませる」(+18) の 2.5 倍で、緊急時の解決手段になる。
    effect: { health: 45 },
  },
  {
    id: 'sproutDew',
    name: '芽吹きの雫',
    price: 95,
    kind: 'growth',
    desc: '発芽を促す樹液の雫。卵にも幼体にも使える。',
    effectText: '成長 +20 / 孵化 +16',
    target: 'any',
    consumable: true,
    // 成長補助。パッシブ +0.25/秒の 80 秒ぶんを一瞬で買う＝「時間を買う」アイテム。
    effect: { growth: 20, hatch: 16 },
  },
  {
    id: 'sunfruitJam',
    name: '陽だまり果のジャム',
    price: 110,
    kind: 'food',
    desc: '温室で完熟させた果実の上級飼料。ひと匙で満ち足りる。',
    effectText: '満腹 +75 / 機嫌 +14 / 健康 +6',
    target: 'any',
    consumable: true,
    // 上級飼料。満腹をほぼ全快させる。展示会前の仕上げ用として 110。
    effect: { hunger: 75, mood: 14, health: 6 },
    requires: { exhibitions: 2 },
  },

  // ── 育成設備（永続効果。consumable:false + passive） ──
  {
    id: 'mistCirculator',
    name: '循環霧散器',
    price: 220,
    kind: 'equipment',
    desc: '室内に細かな霧を巡らせる装置。乾きと退屈をやわらげる。',
    effectText: '空腹の減り -20% / 機嫌の減り -20% / 健康が少し回復しやすい',
    target: 'room',
    consumable: false,
    // 「世話の頻度を下げる」設備。展示会 2〜3 回ぶんの報酬で届く 220。
    passive: { hungerDecay: -0.2, moodDecay: -0.2, healthRegen: 0.03 },
    requires: { exhibitions: 2 },
  },
  {
    id: 'sunbedIncubator',
    name: '日輪の保温床',
    price: 260,
    kind: 'equipment',
    desc: '一日じゅう一定の温もりを保つ床。卵と幼体の育ちが早くなる。',
    effectText: '孵化 +50% / 成長 +18%',
    target: 'room',
    consumable: false,
    // 「進行を早める」設備。2 体目以降の育成を軽くするので終盤解放（展示会 3 回）。
    passive: { hatchRate: 0.5, growthRate: 0.18 },
    requires: { exhibitions: 3 },
  },
  {
    id: 'nurseryPermit2',
    name: '飼育器拡張許可証 I',
    price: 360,
    kind: 'equipment',
    desc: '飼育器を一つ増設するための正式な許可証。卵から成体まで、各段階の枠が一つ増える。',
    effectText: '卵・幼体・成体の枠 +1',
    target: 'room',
    consumable: false,
    capacityIncrease: { egg: 1, juvenile: 1, adult: 1 },
    requires: { exhibitions: 2 },
  },
  {
    id: 'nurseryPermit3',
    name: '飼育器拡張許可証 II',
    price: 720,
    kind: 'equipment',
    desc: '二基目の増設許可証。育てる数を増やしながら、世話の手間も見渡せる範囲に保つ。',
    effectText: '卵・幼体・成体の枠 +1',
    target: 'room',
    consumable: false,
    capacityIncrease: { egg: 1, juvenile: 1, adult: 1 },
    requires: { exhibitions: 4 },
  },
  {
    id: 'nurseryPermit4',
    name: '飼育器拡張許可証 III',
    price: 1_200,
    kind: 'equipment',
    desc: '大規模な飼育を認める最終許可証。交配と販売を本格的に続ける人向け。',
    effectText: '卵・幼体・成体の枠 +1',
    target: 'room',
    consumable: false,
    capacityIncrease: { egg: 1, juvenile: 1, adult: 1 },
    requires: { exhibitions: 7 },
  },
  {
    id: 'cleaningRobot',
    name: 'おそうじロボット',
    price: 520,
    kind: 'equipment',
    desc: '飼育室を巡回して、汚れがたまる前に手入れする小型機。世話の手を完全に置き換えはしない。',
    effectText: '清潔さの減り -75%',
    target: 'room',
    consumable: false,
    passive: { cleanlinessDecay: -0.75 },
    requires: { exhibitions: 3 },
  },
  // ── 飼育フィールドの遊具・環境物 ──
  {
    id: 'fieldLog',
    name: '苔むした遊び木',
    price: 120,
    kind: 'decor',
    desc: '登ったり、隠れたり。フィールドに小さな冒険の場所をつくる。',
    effectText: 'フィールドに遊び木を 1 つ配置できる',
    target: 'field',
    consumable: false,
    fieldObject: 'log',
    requires: { exhibitions: 1 },
  },
  {
    id: 'fieldPond',
    name: '浅瀬の水場',
    price: 190,
    kind: 'decor',
    desc: '水面をのぞき込める浅い水場。ひと休みする場所にもなる。',
    effectText: 'フィールドに水場を 1 つ配置できる',
    target: 'field',
    consumable: false,
    fieldObject: 'pond',
    requires: { exhibitions: 2 },
  },
  {
    id: 'fieldFeeder',
    name: '木製のごはん箱',
    price: 160,
    kind: 'decor',
    desc: 'いつでも立ち寄れる、浅い木箱のごはん場所。食べる姿を観察できる。',
    effectText: 'フィールドにごはん箱を 1 つ配置できる',
    target: 'field',
    consumable: false,
    fieldObject: 'food',
    requires: { exhibitions: 1 },
  },
  {
    id: 'fieldWater',
    name: '陶器の水飲み場',
    price: 170,
    kind: 'decor',
    desc: '小さな水皿。水面に顔を近づける様子を眺められる。',
    effectText: 'フィールドに水飲み場を 1 つ配置できる',
    target: 'field',
    consumable: false,
    fieldObject: 'water',
    requires: { exhibitions: 1 },
  },
  {
    id: 'fieldFlowerbed',
    name: '野花の花壇',
    price: 240,
    kind: 'decor',
    desc: '季節の野花が咲く小さな花壇。観察する楽しみを増やす。',
    effectText: 'フィールドに花壇を 1 つ配置できる',
    target: 'field',
    consumable: false,
    fieldObject: 'flowerbed',
    requires: { exhibitions: 3 },
  },
  {
    id: 'fieldShade',
    name: '葉陰のひさし',
    price: 280,
    kind: 'decor',
    desc: '木漏れ日の下で眠れるひさし。落ち着いた生活の場所になる。',
    effectText: 'フィールドにひさしを 1 つ配置できる',
    target: 'field',
    consumable: false,
    fieldObject: 'shade',
    requires: { exhibitions: 4 },
  },
];

/** id 逆引き。UI とセーブ復元の両方で使う。 */
export const SHOP_ITEM_BY_ID: Readonly<Record<string, ShopItemDef>> = Object.fromEntries(
  SHOP_ITEMS.map((it) => [it.id, it]),
);

/** 最安値。バランス検証テストと「初回報酬で買える」保証に使う。 */
export const SHOP_CHEAPEST_PRICE: number = SHOP_ITEMS.reduce(
  (min, it) => (it.price < min ? it.price : min),
  Number.POSITIVE_INFINITY,
);

// ─────────────────────────────────────────────────────────
//  6. 展示会
// ─────────────────────────────────────────────────────────

export interface JudgeDef {
  id: string;
  name: string;
  /** 肩書き。世界観（標本帳・植物研究室・温室）に合わせてある。 */
  title: string;
  /** 語調の指針。コメント生成側がこの方針でセリフを選ぶ。 */
  tone: string;
  /** ランク別のコメント候補。seed で選ぶので完全ランダムにはならない。 */
  lines: Readonly<Record<Rank, readonly string[]>>;
}

export const EXHIBITION = {
  /**
   * 5 項目の重み（合計 100）。
   * 美しさを最重視しつつ、育成（プレイヤーの手入れ）を 2 番手に置くことで
   * 「派手な個体を引いただけでは勝てない」構造にしてある（指示書 §7）。
   */
  weights: {
    beauty: 28,
    care: 20,
    health: 18,
    character: 18,
    rarity: 16,
  },

  /** ランク境界（total 以上でそのランク）。C を 40 に置き、初回でも D になりにくくしてある。 */
  rankThresholds: [
    { rank: 'S' as Rank, min: 88 },
    { rank: 'A' as Rank, min: 74 },
    { rank: 'B' as Rank, min: 58 },
    { rank: 'C' as Rank, min: 40 },
    { rank: 'D' as Rank, min: 0 },
  ],

  /** 参加するだけで貰える基礎コイン。ゼロ報酬の徒労感を作らない。 */
  baseCoins: 30,
  /** 得点 1 点あたりのコイン。総合 60 点で +96 コインになる係数。 */
  coinPerPoint: 1.6,
  /** ランクボーナス。上位ほど跳ねるようにして、育成の伸びが報酬で見えるようにする。 */
  rankBonus: { D: 0, C: 15, B: 35, A: 70, S: 130 } as Readonly<Record<Rank, number>>,

  /** 初回展示会の最低保証コイン。SHOP_CHEAPEST_PRICE(35) を必ず上回るので進行が止まらない。 */
  firstTimeMinCoins: 120,
  /** 初回は総合点にも下駄をはかせ、極端に低い結果で心が折れないようにする（指示書 §7）。 */
  firstTimeScoreFloor: 45,

  /** 2 回目以降の最低保証。少額でも必ず前進する感覚を残す。 */
  minCoins: 20,

  /** 同一個体の再参加クールダウン。3 分あければ次の世話サイクルが 1 巡する。 */
  cooldownMs: 3 * 60 * 1000,

  /** 評価のゆらぎ幅（±%）。完全ランダムにはせず、seed 由来で ±6% だけ揺らす。 */
  varianceRatio: 0.06,

  judges: [
    {
      id: 'kokemori',
      name: '苔守 みどり',
      title: '植物研究室 主任',
      tone: 'おだやかで、必ず良いところを先に言う。ですます調。',
      lines: {
        S: ['ここまで整った子は、久しぶりに見ました。', '色も形も、よく手をかけられていますね。'],
        A: ['とても健やかに育っています。立派です。', '均整のとれた、気持ちのよい子ですね。'],
        B: ['よい育ち方をしています。この調子で。', '素直な良さがあります。伸びしろも十分です。'],
        C: ['まだこれからですね。焦らなくて大丈夫。', '基礎はできています。あと少しの手入れを。'],
        D: ['今日は調子が出なかったようですね。', 'まずは、ゆっくり休ませてあげてください。'],
      },
    },
    {
      id: 'garasudani',
      name: '硝子谷 レン',
      title: '標本帳 編纂者',
      tone: '分析的で辛口。断定調で短く言い切る。',
      lines: {
        S: ['文句なし。標本帳の巻頭に載せる。', '形質の噛み合いが完璧だ。記録しておく。'],
        A: ['配色の統一感がいい。上出来だ。', '珍しい形質が生きている。悪くない。'],
        B: ['悪くない。ただ、まとまりが一歩足りない。', '素材はいい。仕上げが甘い。'],
        C: ['粗さが目立つ。手入れの回数が足りていない。', '見どころはある。今は、それだけだ。'],
        D: ['状態が良くない。出す時期を間違えたな。', '整えてから出直してくれ。'],
      },
    },
    {
      id: 'hinata',
      name: '陽向 ことね',
      title: '温室 見習い',
      tone: '元気で感情的。感嘆符を使い、素直に反応する。',
      lines: {
        S: ['わあ、すごい！ずっと見ていられます！', 'こんな子、はじめて見ました！'],
        A: ['かわいい！つやつやしてます！', 'とっても元気そう！いいなあ！'],
        B: ['いい子ですね！なでてみたいです！', 'この形、けっこう好きです！'],
        C: ['もうちょっと元気が出そうな気がします！', 'これから、きっと化けますよ！'],
        D: ['あっ……ちょっとお疲れみたいですね。', 'だいじょうぶ、次はきっと！'],
      },
    },
  ] as readonly JudgeDef[],
} as const;

/** 総合点からランクを引く（境界の正本をここに閉じ込める）。 */
export function rankOf(total: number): Rank {
  for (const t of EXHIBITION.rankThresholds) {
    if (total >= t.min) return t.rank;
  }
  return 'D';
}

/**
 * 報酬コインを計算する。
 * isFirst のときは firstTimeMinCoins を下限として保証する（指示書 §7）。
 */
export function exhibitionCoins(total: number, rank: Rank, isFirst: boolean): number {
  const raw = Math.round(EXHIBITION.baseCoins + total * EXHIBITION.coinPerPoint) + EXHIBITION.rankBonus[rank];
  const floor = isFirst ? EXHIBITION.firstTimeMinCoins : EXHIBITION.minCoins;
  return Math.max(floor, raw);
}

// ─────────────────────────────────────────────────────────
//  7. 公認ブリーダー販売
// ─────────────────────────────────────────────────────────

/** 売却額の正本。世話・展示・世代を別々の小さな加点にして、価値の理由を説明できるようにする。 */
export const MARKET = {
  basePrice: { egg: 160, juvenile: 320, adult: 520 } as const,
  /** 成体の展示実績は売却額へ反映するが、展示会より主収入にはしない。 */
  bestScoreRate: 0.55,
  /**
   * 姿から見て取れる目立つ点 1 つあたりの上乗せ。**鑑定していなくても付く**。
   *
   * 1500 体で測った `observedSignal` は 0〜7・中央値 1〜2 なので、
   * 14 コイン／点で中央値 +21・上位 5% で +56 ほど。下の `rarityRate` が
   * 出す額（中央値 +25・上位 5% +53）と釣り合う幅にしてある。
   * 片方だけ大きいと「鑑定するだけで値が跳ねる／鑑定しても変わらない」の
   * どちらかになり、鑑定書の意味がぼやける。
   */
  observedRate: 14,
  /**
   * 遺伝的な希少度の上乗せ。**鑑定済みの個体にだけ付く**（D-041）。
   *
   * `rarity.score` は保因・接合状態まで含んだ、鑑定して初めて分かる値。
   * 未鑑定の見積もりへ混ぜると、価格を割り算するだけで隠したはずの
   * 希少度が復元できてしまう。「鑑定書が無ければ市場も潜在的な遺伝価値を
   * 評価できない」という世界観の、技術的な裏づけでもある。
   */
  rarityRate: 1.15,
  /** 親から続く世代への小さな評価。希少度だけの競争にしないため上限を置く。 */
  generationBonus: 16,
  /** 売却履歴は localStorage を太らせないよう直近 50 件だけ残す。 */
  historyLimit: 50,
} as const;

// ─────────────────────────────────────────────────────────
//  8. 飼育フィールド
// ─────────────────────────────────────────────────────────

/** 排泄・掃除・配置のゲームプレイに使う数値の正本。 */
export const FIELD = {
  slotCount: 12,
  /** 生き物1体につき10〜14分に1個。短時間の観察で床が埋まらない間隔にする。 */
  droppingIntervalMs: 10 * 60 * 1000,
  droppingJitterMs: 4 * 60 * 1000,
  /** 3体でも数個を眺められる上限。古いセーブも tick 時にここへ収める。 */
  maxDroppings: 6,
  /** 何も落ちていないときのフィールド清潔度の自然減衰。 */
  cleanlinessDecayPerSec: 0.012,
  /** 排泄物 1 個ごとの環境汚染。上限は droppings の数で自然に決まる。 */
  droppingDirtPerSec: 0.018,
  /** 汚れたフィールドから個体へ伝わる清潔度低下。 */
  creatureDirtPerSec: 0.01,
  /** ロボットは 30 秒ごとに一つずつ、古いものから片付ける。 */
  robotCleanIntervalMs: 30 * 1000,
  cleanRecovery: 32,
} as const;

// ─────────────────────────────────────────────────────────
//  9. 飼育員
// ─────────────────────────────────────────────────────────

/**
 * 飼育員の固定費と自動世話の正本。
 * 5 分を 1 給料周期にするのは、ゲーム内の短いプレイでも「雇うとお金が減る」
 * ことを確認でき、月給という世界観を壊さずに試せる折衷値。
 */
export const STAFF = {
  payIntervalMs: 5 * 60 * 1000,
  partTime: {
    hiringFee: 110,
    wage: 34,
    serviceIntervalMs: 50 * 1000,
    coverage: 1,
    hunger: 12,
    hydration: 14,
    cleanliness: 10,
    mood: 5,
    health: 2,
  },
  fullTime: {
    hiringFee: 260,
    wage: 86,
    serviceIntervalMs: 32 * 1000,
    coverage: 3,
    hunger: 9,
    hydration: 11,
    cleanliness: 8,
    mood: 4,
    health: 2,
  },
  /** 募集画面で一度に見せる候補数。 */
  candidateCount: 3,
  /** 給料不足のまま放置しても、候補者を勝手に解雇しない猶予。 */
  unpaidGraceMs: 2 * 60 * 1000,
} as const;

// ─────────────────────────────────────────────────────────
//  10. 解放条件
// ─────────────────────────────────────────────────────────

export const UNLOCK_RULES = {
  /** 育成室は最初から。ここが閉じていると何もできない。 */
  nursery: { label: '育成室', desc: '最初から使えます。', auto: true },
  /** 標本帳は最初の孵化で解放。見るものが無い図鑑を先に開かない。 */
  collection: { label: '標本帳', desc: '最初の卵が孵ると開きます。', minHatched: 1 },
  /** 展示会は成体 1 体で解放（指示書 §6）。 */
  exhibition: { label: '展示会', desc: 'ゲノモンが成体になると開きます。', minAdults: 1 },
  /** ショップは初回展示会の完了で解放（指示書 §7）。報酬を得てから店を開く順序。 */
  shop: { label: 'ショップ', desc: '展示会に 1 回参加すると開きます。', minExhibitions: 1 },
  /** 交配はショップ解放かつ成体 2 体。個体を 2 体育てた実感が前提。 */
  breeding: { label: '交配', desc: 'ショップ解放後、成体が 2 体そろうと開きます。', requiresShop: true, minAdults: 2 },
  /** 販売は育成・展示・交配を一通り経験してから。資格の条件は隠さず表示する。 */
  breeder: {
    label: '公認ブリーダー',
    desc: '展示会 3 回・交配 1 回・成体 2 体で資格を申請できます。',
    minExhibitions: 3,
    minBred: 1,
    minAdults: 2,
  },
  /** フィールドの世話が増えてから雇える。雇用前に固定費の意味が分かる順番にする。 */
  staff: {
    label: '飼育員',
    desc: '展示会に 2 回 参加すると、飼育員を 募集できます。',
    minExhibitions: 2,
  },
} as const;

// ─────────────────────────────────────────────────────────
//  11. 所持枠
// ─────────────────────────────────────────────────────────

/** 各段階 3 体ずつ。少なすぎず、育成室の一覧が一画面に収まる上限。 */
export const CAPACITY_DEFAULT: Capacity = { egg: 3, juvenile: 3, adult: 3 };

// ─────────────────────────────────────────────────────────
//  12. 交配
// ─────────────────────────────────────────────────────────

export const BREEDING = {
  /** 両親とも成体であること（指示書 §9）。 */
  requiredStage: 'adult' as Stage,
  /** 機嫌がこの値以上。「よく世話をした個体でないと子を残せない」動機付け。 */
  minMood: 60,
  /** 健康がこの値以上。弱った個体を無理に使わせない。 */
  minHealth: 60,
  /** 交配コスト。展示会 1 回ぶん弱で、報酬サイクルの中に自然に収まる。 */
  costCoins: 80,
  /** 同じ個体の再交配クールダウン。5 分で連続量産を防ぐ。 */
  cooldownMs: 5 * 60 * 1000,
  /** 1 回の交配で生まれる卵の数。縦切り版では 1 個固定（枠を圧迫しない）。 */
  eggsPerBreeding: 1,
  /** 交配後、両親の機嫌がこの割合まで下がる。連発への自然なブレーキ。 */
  parentMoodAfter: 0.6,
} as const;

// ─────────────────────────────────────────────────────────
//  13. 新規ゲームの初期値
// ─────────────────────────────────────────────────────────

/** 卵を孵す前の LifeState 初期値。孵化直後・新規卵の両方で使う。 */
export const INITIAL_LIFE = {
  /** 卵は満たされた状態から始める。開始直後にゲージ管理を強いない。 */
  egg: {
    growth: 0,
    hunger: 80,
    hydration: 80,
    cleanliness: 90,
    mood: 70,
    health: 100,
    hatchProgress: 0,
  },
  /** 孵化直後の幼体。少し空腹にして「まず食べさせる」導線を作る。 */
  juvenile: {
    growth: 0,
    hunger: 60,
    hydration: 60,
    cleanliness: 85,
    mood: 75,
    health: 100,
    hatchProgress: 100,
  },
} as const;

/**
 * 新規ゲームの初期値（正本）。
 * オブジェクトを共有すると事故るので、実際の生成では freshInitialParts() で複製すること。
 */
export const INITIAL_STATE_PARTS = {
  /** 所持コインは 0。最初の収入は初回展示会（指示書 §7）。 */
  coins: 0,
  /** 基本飼料と水は無料・無限なので、初期インベントリは空でよい（指示書 §5）。 */
  inventory: {} as Record<string, number>,
  /** 購入済みの装飾・設備。 */
  owned: [] as string[],
  /** 育成室のみ開いた状態から始める。 */
  unlocks: { nursery: true, exhibition: false, shop: false, breeding: false, collection: false, breeder: false, staff: false } as Unlocks,
  capacity: CAPACITY_DEFAULT,
  /** 音量は 0.7。初回起動でいきなり大音量にしない。 */
  settings: { volume: 0.7, muted: false, reducedMotion: false, skipCutscenes: false } as Settings,
  /** 最初のガイドは卵選び。 */
  tutorial: { done: [], current: 'chooseEgg' } as TutorialState,
  stats: {
    hatched: 0,
    grownUp: 0,
    bred: 0,
    exhibitions: 0,
    coinsEarned: 0,
    careActions: 0,
    staffCareActions: 0,
  } as GameStats,
  activeCreatureId: null as string | null,
  breeder: {
    licensed: false,
    sales: 0,
    earnings: 0,
    history: [],
  } as BreederState,
  field: {
    cleanliness: 100,
    droppings: [],
    placements: [],
    lastDroppingAge: {},
    lastTickAt: 0,
    lastRobotCleanAt: 0,
  } as FieldState,
  staff: {
    candidates: [],
    hiredId: null,
    hiredAt: 0,
    lastServiceAt: 0,
    lastPaidAt: 0,
    unpaidSince: 0,
    candidateCycle: 0,
  } as StaffState,
  /** 将来のオンライン機能用の予約領域（指示書 §9）。縦切り版では空のまま保存される。 */
  future: {
    marketListings: [] as unknown[],
    tradeHistory: [] as unknown[],
    rankingCache: null as unknown,
  },
} as const;

/** INITIAL_STATE_PARTS の可変コピーを作る（共有参照による汚染を防ぐ）。 */
export function freshInitialParts() {
  return {
    coins: INITIAL_STATE_PARTS.coins,
    inventory: {} as Record<string, number>,
    owned: [] as string[],
    unlocks: { ...INITIAL_STATE_PARTS.unlocks },
    capacity: { ...INITIAL_STATE_PARTS.capacity },
    settings: { ...INITIAL_STATE_PARTS.settings },
    tutorial: { done: [] as string[], current: INITIAL_STATE_PARTS.tutorial.current },
    stats: { ...INITIAL_STATE_PARTS.stats },
    activeCreatureId: INITIAL_STATE_PARTS.activeCreatureId,
    breeder: {
      licensed: INITIAL_STATE_PARTS.breeder.licensed,
      sales: INITIAL_STATE_PARTS.breeder.sales,
      earnings: INITIAL_STATE_PARTS.breeder.earnings,
      history: [],
    },
    field: {
      cleanliness: INITIAL_STATE_PARTS.field.cleanliness,
      droppings: [],
      placements: [],
      lastDroppingAge: {},
      lastTickAt: INITIAL_STATE_PARTS.field.lastTickAt,
      lastRobotCleanAt: INITIAL_STATE_PARTS.field.lastRobotCleanAt,
    },
    staff: {
      candidates: [],
      hiredId: INITIAL_STATE_PARTS.staff.hiredId,
      hiredAt: INITIAL_STATE_PARTS.staff.hiredAt,
      lastServiceAt: INITIAL_STATE_PARTS.staff.lastServiceAt,
      lastPaidAt: INITIAL_STATE_PARTS.staff.lastPaidAt,
      unpaidSince: INITIAL_STATE_PARTS.staff.unpaidSince,
      candidateCycle: INITIAL_STATE_PARTS.staff.candidateCycle,
    },
    future: { marketListings: [] as unknown[], tradeHistory: [] as unknown[], rankingCache: null as unknown },
  };
}
