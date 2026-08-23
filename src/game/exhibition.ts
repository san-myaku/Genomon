/**
 * 展示会（審査と報酬）。
 *
 * 【指示書 §7 の要求と、それをどう満たしたか】
 *   「完全なランダムにしない」
 *      → 5 項目はすべて Phenotype と LifeState から決定論的に計算する。
 *        ゆらぎは seed と参加回数から作る ±6%（config.EXHIBITION.varianceRatio）だけ。
 *        同じ個体・同じ状態・同じ参加回数なら、何度呼んでも同じ点数になる。
 *   「派手な個体が常に高得点にならないこと」
 *      → 「美しさ」は装飾の数ではなく **配色の調和と装飾数の適正** で決める。
 *        装飾が 5 個を超えると decorFit が急落し、6 個以上でほぼ 0 になる。
 *        希少性は装飾と正の相関を持つが、重みは 16 しかなく、
 *        美しさ 28 の中の装飾適正（0.34）と個性 18 が打ち消す。
 *   「プレイヤーの世話が効くこと」
 *      → 育成 20 ＋ 健康 18 ＝ 38 点ぶんが LifeState 由来。
 *        遺伝で決まるのは 62 点ぶんで、世話の差だけでランクが 1 段変わる。
 *
 * 【クールダウンの保存】
 *   再参加クールダウンは Creature.lastExhibitAt（0 = 未参加）に持つ。
 *   セーブ v4 で保存されるので、リロードしてクールダウンを飛ばす
 *   （＝同じ個体を出し続けてコインを稼ぐ）ことはできない。
 */

import { Rng, clamp, clamp01 } from '../core/rng.ts';
import { contrastRatio } from '../core/color.ts';
import type {
  Creature,
  ExhibitionScore,
  GameState,
  LifeState,
  Palette,
  PartExpression,
  Phenotype,
} from '../core/types.ts';
import { EXHIBITION, exhibitionCoins, rankOf } from './config.ts';
import { isAppraised } from './grading.ts';
import { getPhenotype } from './phenoCache.ts';
import { findCreature, noteNow } from './state.ts';
import { refreshUnlocks } from './unlocks.ts';

// ─────────────────────────────────────────────────────────
//  採点の部品
// ─────────────────────────────────────────────────────────

/** 装飾として数える器官。目・口・模様・質感は「装飾」ではないので数えない。 */
const DECOR_PARTS: readonly (keyof PartExpression)[] = [
  'ears',
  'antennae',
  'horns',
  'plant',
  'wings',
  'tail',
  'crystal',
  'collar',
  'floaters',
];

/** 発現している装飾の数（0..9）。 */
export function decorCount(parts: PartExpression): number {
  let n = 0;
  for (const key of DECOR_PARTS) {
    const v = parts[key];
    if (typeof v === 'string' && v !== 'none') n++;
  }
  return n;
}

/** 値が [lo, hi] の帯に入っていれば 1、外れるほど 0 に近づく。 */
function band(v: number, lo: number, hi: number, soft: number): number {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - d / soft);
}

/**
 * 配色の調和（0..1）。
 * 「鮮やかさ」ではなく「読みやすく、浮きすぎない関係にあるか」を見る。
 * 模様が本体に埋もれても、逆にぎらついても下がる。
 */
export function paletteHarmony(p: Palette): number {
  const patternReadable = band(contrastRatio(p.pattern, p.body), 1.55, 3.1, 1.5);
  const accentFits = band(contrastRatio(p.accent, p.body), 1.2, 2.4, 1.2);
  const bellyContinuous = band(contrastRatio(p.belly, p.body), 1.15, 2.0, 1.0);
  const saturationCalm = band(p.hsl.s, 26, 66, 22);
  return clamp01(
    patternReadable * 0.32 + accentFits * 0.26 + bellyContinuous * 0.2 + saturationCalm * 0.22,
  );
}

/**
 * 装飾数の適正（0..1）。
 *
 * 集団の装飾数は 中央値 2・平均 2.09（400 体の実測）。
 * そこを頂点にした山なりにしてある。帯（band）ではなく山にしたのは、
 * 帯だと 1〜3 個の個体が全員 1.0 に張り付いて、この項目が
 * 「装飾が多すぎる子だけを落とす」以外の仕事をしなくなるため。
 *
 *   0 個 → 0.44 / 1 個 → 0.82 / 2 個 → 1.00 / 3 個 → 0.82
 *   4 個 → 0.44 / 5 個 → 0.16 / 6 個 → 0.04
 *
 * ここが派手さへの歯止め。実測で、装飾 0 個の群と 4.2 個の群の
 * 総合得点の相関係数を 0.5 未満に保っている（tests/game.test.ts）。
 */
export function decorFit(n: number): number {
  const t = (n - 2) / 2.2;
  return Math.exp(-t * t);
}

/**
 * 素点（0..1）を審査点（0..100）へ写す共通スケール。
 *
 * 【なぜ要るか】
 *   素点をそのまま 100 倍すると、項目ごとに分布がまったく違うせいで
 *   「美しさは いつも 95、個性は いつも 20」のような読めない表になる（実測で発生）。
 *   そこで 5 項目すべてを、実測した分布の下端 lo・上端 hi で 30〜96 点に伸ばす。
 *
 * @param lo   この値以下は 30 点（0 点にしないのは、審査で 0 を出しても情報が無いから）
 * @param hi   この値以上は 96 点
 * @param gamma 1 より大きいと「上に行くほど厳しい」。
 *              素点が上端に密集している項目（美しさ）で、上位の差を開くために使う。
 */
function judgeScale(raw: number, lo: number, hi: number, gamma: number): number {
  const t = clamp01((raw - lo) / (hi - lo));
  return clamp(30 + 66 * Math.pow(t, gamma), 0, 100);
}

/**
 * 美しさ 0..100。
 * 素点の実測（600 体）: 最小 0.651 / p05 0.779 / 中央 0.931 / 最大 1.000。
 * 上端に密集しているので gamma=2.8 で上位の差を開く（中央値が 66 点になる）。
 */
export function beautyScore(ph: Phenotype): number {
  const harmony = paletteHarmony(ph.palette);
  const fit = decorFit(decorCount(ph.parts));
  // 極端に細長い・平べったい体は「整っていない」と見なす。
  const formFit = band(ph.ratio, 0.93, 1.12, 0.22);
  // 模様は濃すぎても薄すぎても読みにくい。
  const patternFit = band(ph.patDensity, 0.2, 0.72, 0.35);
  const raw = harmony * 0.45 + fit * 0.35 + patternFit * 0.1 + formFit * 0.1;
  return judgeScale(raw, 0.65, 1.0, 2.8);
}

/**
 * 健康 0..100。実際の体調が主で、体質（healthTend）が少しだけ効く。
 * lo/hi は遺伝の分布ではなく **遊びうる範囲**（放置した子 〜 万全の子）に取る。
 */
export function healthScore(ph: Phenotype, life: LifeState): number {
  const raw = (life.health / 100) * 0.85 + ph.healthTend * 0.15;
  return judgeScale(raw, 0.3, 0.97, 1);
}

/**
 * 個性 0..100。
 * 性格の尖り（6 軸が真ん中から離れているか）が主。装飾の数とは無関係な軸なので、
 * ここが「派手さ ≠ 強さ」を支える柱になる。
 *
 * 素点の実測（600 体）: 最小 0.194 / p05 0.298 / 中央 0.505 / 最大 0.901。
 * 旧実装は性格の分母を 0.275 と大きく取りすぎ（実際の平均偏差は 0.124）、
 * さらに 100 倍しただけだったので中央値が 40 点、下位が 16 点まで落ちていた。
 */
export function characterScore(ph: Phenotype): number {
  const p = ph.personality;
  const axes = [p.energy, p.affection, p.curiosity, p.dependence, p.appetite, p.tidiness];
  // 6 軸の平均偏差。実測分布は 0.039〜0.221、中央 0.121。上位 5% の 0.19 で頭打ちにする。
  const avgDev = axes.reduce((a, v) => a + Math.abs(v - 0.5), 0) / axes.length;
  const persona = clamp01(avgDev / 0.19);

  const notable = ph.traits.filter((t) => t.notable).length;
  const notableFit = clamp01(notable / 3);

  const asym = clamp01(ph.asymmetry / 0.5);

  const raw = persona * 0.45 + notableFit * 0.3 + asym * 0.25;
  return judgeScale(raw, 0.18, 0.9, 1);
}

/**
 * 希少性 0..100。
 *
 * Phenotype.rarity.score の実測は 初期個体で 中央 14・平均 16.5・上位 5% が 40
 * （交配を重ねた系統で 100 まで伸びる）。そのまま使うと ほぼ全員が最低点になるので、
 * gamma=0.55 の凹曲線で **下側を広げ、上側は precious 用に残す**。
 *   score 3 → 40 点 / 14 → 52 点 / 40 → 69 点 / 63 → 81 点 / 100 → 96 点
 * 重みは 16 なので、この項目だけで開く差は最大 9 点ぶん。引きの良さが支配しない。
 */
export function rarityScore(ph: Phenotype): number {
  return judgeScale(clamp01(ph.rarity.score / 100), 0, 1, 0.55);
}

/**
 * 育成状態 0..100。プレイヤーの手入れがそのまま出る項目。
 * 機嫌・清潔・満腹・水分の平均が主、健康と通算の世話回数を少し足す。
 * lo/hi は遊びうる範囲（放置した子 〜 万全の子）。
 */
export function careScore(life: LifeState): number {
  const avg = (life.mood + life.cleanliness + life.hunger + life.hydration) / 4;
  const effort = Math.min(100, life.careCount * 3);
  const raw = (avg / 100) * 0.7 + (life.health / 100) * 0.15 + (effort / 100) * 0.15;
  return judgeScale(raw, 0.28, 1.0, 1);
}

// ─────────────────────────────────────────────────────────
//  可否判定
// ─────────────────────────────────────────────────────────

/** 残りクールダウン（ms）。0 なら参加できる。 */
export function exhibitCooldownLeft(c: Creature, now: number): number {
  const last = c.lastExhibitAt;
  if (!Number.isFinite(last) || last <= 0) return 0;
  return Math.max(0, EXHIBITION.cooldownMs - (now - last));
}

export function canExhibit(
  state: GameState,
  creatureId: string,
  now: number,
): { ok: boolean; reason?: string } {
  noteNow(now);
  // 成体になった直後に呼ばれても弾かないよう、ここで解放条件を取り直す。
  refreshUnlocks(state);

  const c = findCreature(state, creatureId);
  if (!c) return { ok: false, reason: 'その子が 見つかりません。' };
  if (c.life.stage !== 'adult') {
    return { ok: false, reason: `${c.name} は まだ 成体では ありません。育ててから もう一度。` };
  }
  if (!state.unlocks.exhibition) {
    return { ok: false, reason: '展示会は まだ 解放されていません。' };
  }

  const left = exhibitCooldownLeft(c, now);
  if (left > 0) {
    return {
      ok: false,
      reason: `${c.name} は さっき 出たばかりです（あと ${Math.ceil(left / 60000)} 分）。`,
    };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
//  審査員コメント
// ─────────────────────────────────────────────────────────

/**
 * その個体の具体的な特徴に触れるコメントを作る。
 * 「よかったですね」だけで終わらせず、必ず **この子の何を見たのか** を言う（指示書 §7）。
 */
function specificComments(
  c: Creature,
  ph: Phenotype,
  life: LifeState,
  rng: Rng,
  appraised: boolean,
): string[] {
  const out: string[] = [];

  const paletteLabel = ph.traits.find((t) => t.locus === 'palette')?.value;
  const textureLabel = ph.traits.find((t) => t.locus === 'texture')?.value;
  const harmony = paletteHarmony(ph.palette);
  const n = decorCount(ph.parts);

  // ── 配色について ──
  if (paletteLabel) {
    if (harmony >= 0.78) {
      out.push(`この子の『${paletteLabel}』の配色は、落ち着いていて とてもよい。`);
    } else if (harmony >= 0.55) {
      out.push(`『${paletteLabel}』の配色は 悪くない。模様の出かたが もう少し 整うと なおよい。`);
    } else {
      out.push(`『${paletteLabel}』の配色は、色が すこし ちぐはぐに 見える。`);
    }
  }
  if (textureLabel && rng.stream('texture').bool(0.6)) {
    out.push(`質感は『${textureLabel}』。光の受けかたに その子らしさが 出ている。`);
  }

  // ── 装飾の数について（派手さへの評価をここで言語化する）──
  if (n >= 6) {
    out.push(`かざりが ${n} か所。目移りしてしまって、この子の 良さが 埋もれている。`);
  } else if (n >= 1 && n <= 4) {
    out.push(`かざりは ${n} か所。数を おさえてあるぶん、姿の輪郭が よく見える。`);
  } else if (n === 0) {
    out.push('かざりは ひとつも 無い。潔いが、見どころは 少ない。');
  } else {
    out.push(`かざりが ${n} か所。もう すこし 絞ってもよい。`);
  }

  // ── 希少性について ──
  //
  // 【未鑑定では reasons を出さない】
  //   `rarity.reasons` は「めずらしい形質が 10 か所」「めずらしい『しんじゅ』の配色」など、
  //   **鑑定でしか分からないはずの内訳そのもの**。審査員の口から出てしまうと、
  //   詳細画面で伏せている意味が無くなる（鑑定所より先に展示会が答えを言う）。
  //   鑑定済みの個体は証明書を提示している扱いなので、そのまま読み上げてよい。
  if (appraised) {
    const reason = ph.rarity.reasons[0];
    if (reason) out.push(`めずらしさ: ${reason}。`);
  } else if (ph.rarity.reasons.length > 0) {
    out.push('めずらしさ: 気になる所はあるが、鑑定書が無いので断定はできない。');
  }

  // ── 育成状態について ──
  if (life.cleanliness >= 80 && life.mood >= 75) {
    out.push('よく手入れされている。毛づやも 機嫌も よい。');
  } else if (life.hunger < 40) {
    out.push('おなかが すいているようだ。出す前に 食べさせて あげたい。');
  } else if (life.cleanliness < 50) {
    out.push('よごれが 目立つ。ひと拭き するだけで 印象が 変わる。');
  } else if (life.mood < 50) {
    out.push('すこし 元気が ない。もっと かまって あげてほしい。');
  }

  // ── 性格について ──
  out.push(`性格は「${ph.personality.label}」（${ph.personality.subLabel}）。${c.name} らしさが 出ている。`);

  return out;
}

// ─────────────────────────────────────────────────────────
//  本番
// ─────────────────────────────────────────────────────────

/**
 * 採点して報酬を state に反映し、結果を返す。
 * 同じ個体・同じ状態・同じ参加回数なら、必ず同じ点数になる。
 */
export function runExhibition(state: GameState, creatureId: string, now: number): ExhibitionScore {
  noteNow(now);

  const check = canExhibit(state, creatureId, now);
  const c = findCreature(state, creatureId);

  if (!check.ok || !c) {
    // 参加できないときも型は ExhibitionScore で返す（UI が分岐を減らせる）。
    return {
      beauty: 0,
      health: 0,
      character: 0,
      rarity: 0,
      care: 0,
      total: 0,
      rank: 'D',
      coins: 0,
      comments: [check.reason ?? '参加できませんでした。'],
      judge: '受付',
    };
  }

  const ph = getPhenotype(c, 'adult');
  const life = c.life;
  const appraised = isAppraised(c);

  const beauty = beautyScore(ph);
  const health = healthScore(ph, life);
  const character = characterScore(ph);
  const rarity = rarityScore(ph);
  const care = careScore(life);

  const w = EXHIBITION.weights;
  const raw =
    (beauty * w.beauty + care * w.care + health * w.health + character * w.character + rarity * w.rarity) /
    (w.beauty + w.care + w.health + w.character + w.rarity);

  // ── ゆらぎ（完全ランダムではなく、seed と参加回数から決まる）──
  const rng = new Rng(`${c.seed}:exh:${c.exhibitionCount}`);
  const wobble = (rng.stream('wobble').next() * 2 - 1) * EXHIBITION.varianceRatio;
  let total = clamp(raw * (1 + wobble), 0, 100);

  const isFirst = state.stats.exhibitions === 0;
  // 初回は下駄をはかせる。最初の結果で心が折れると、そこで遊びが終わる。
  if (isFirst) total = Math.max(total, EXHIBITION.firstTimeScoreFloor);

  total = Math.round(total * 10) / 10;
  const rank = rankOf(total);
  const coins = exhibitionCoins(total, rank, isFirst);

  // ── 審査員とコメント ──
  const judge = rng.stream('judge').pick(EXHIBITION.judges);
  const line = rng.stream('line').pick(judge.lines[rank]);
  const details = specificComments(c, ph, life, rng.stream('detail'), appraised);
  const comments = [line, ...details].slice(0, 5);

  // ── 反映 ──
  state.coins += coins;
  state.stats.exhibitions += 1;
  state.stats.coinsEarned += coins;
  c.exhibitionCount += 1;
  c.bestScore = Math.max(c.bestScore, total);
  // Creature に持つ＝セーブされる。リロードしてクールダウンを飛ばすことはできない。
  c.lastExhibitAt = now;
  state.updatedAt = now;

  // 初回参加でショップが開く（config.UNLOCK_RULES.shop）。
  refreshUnlocks(state);

  return {
    beauty: Math.round(beauty * 10) / 10,
    health: Math.round(health * 10) / 10,
    character: Math.round(character * 10) / 10,
    rarity: Math.round(rarity * 10) / 10,
    care: Math.round(care * 10) / 10,
    total,
    rank,
    coins,
    comments,
    judge: `${judge.name}（${judge.title}）`,
  };
}
