/**
 * 世話（ケア）。
 *
 * 【効き目の決まり方】
 *   最終効果 = config.CARE_DEFS[action].effect
 *            × careEffectMultiplier（飽き × 満足）  ← config.ts の正本
 *            × 性格による反応倍率                   ← このファイルの責務
 *
 *   「飽き」「満足」は config が持つ。ここで再定義しない。
 *   このファイルが決めるのは **その子がどう感じたか**（反応と台詞）だけ。
 *
 * 【ボタンを殺さない方針（指示書 §5）】
 *   飽き・満足・満腹では **押せなくしない**。押せるが効き目が下がり、
 *   careAvailability が「まだ 満足しているみたい」という理由文字列を返す。
 *   押せなくするのは、押しても意味が通らないとき
 *   （段階不一致・休息中・クールダウン中）だけ。
 */

import { Rng } from '../core/rng.ts';
import type {
  CareAction,
  CareResult,
  Creature,
  GameState,
  LifeState,
  Personality,
  Stage,
} from '../core/types.ts';
import {
  BOREDOM,
  CARE_BY_STAGE,
  CARE_DEFS,
  DECAY,
  SATIATION,
  TIMING,
  careBoredomFactor,
  careEffectMultiplier,
  careSatiationFactor,
  type EffectKey,
} from './config.ts';
import { advanceStageIfReady } from './growth.ts';
import { getPhenotype } from './phenoCache.ts';
import { findCreature, healBrokenStats, noteNow } from './state.ts';

type Reaction = CareResult['reaction'];

// ─────────────────────────────────────────────────────────
//  しきい値（config に無い「判定基準」だけをここに置く）
// ─────────────────────────────────────────────────────────

/**
 * 「もう満ちている」とみなす境界。config.DECAY.ceil から導出する（上限の 92%）。
 * これ以上のときに feed / water / clean を押すと反応が 'full' になる。
 */
const SATED_AT = DECAY.ceil * 0.92;

/** 性格の「高い／低い」の境界。0.5 を中心に、はっきり差が出る幅だけを見る。 */
const HIGH = 0.66;
const LOW = 0.34;

/**
 * 反応による効果倍率。
 * 喜んだ子はよく育ち、いやがった子には効きにくい、を数値で表す。
 * 幅を広げすぎると「相性の悪い世話は絶対にしない」が最適解になるので、
 * いちばん低い dislike でも 7 割は残してある。
 */
const REACTION_MULT: Readonly<Record<Reaction, number>> = {
  delighted: 1.18,
  happy: 1.0,
  neutral: 0.92,
  sleepy: 0.85,
  dislike: 0.72,
  full: 0.4,
};

/** 段階の日本語名（理由文で使う）。 */
const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  egg: 'たまご',
  juvenile: '幼体',
  adult: '成体',
};

// ─────────────────────────────────────────────────────────
//  効果の適用
// ─────────────────────────────────────────────────────────

/** EffectKey → LifeState 上のキー。config の語彙と LifeState の語彙の橋渡し。 */
const EFFECT_TO_LIFE: Readonly<Record<EffectKey, keyof LifeState>> = {
  hunger: 'hunger',
  hydration: 'hydration',
  cleanliness: 'cleanliness',
  mood: 'mood',
  health: 'health',
  growth: 'growth',
  hatch: 'hatchProgress',
};

/**
 * 効果を適用し、**実際に動いた量** を返す。
 * クランプで頭打ちになった分は deltas に含めない（UI が「+34」と出したのに
 * ゲージが動かない、という嘘をつかないため）。
 */
export function applyEffects(
  c: Creature,
  effect: Partial<Record<EffectKey, number>>,
  multiplier: number,
): Partial<Record<keyof LifeState, number>> {
  const deltas: Partial<Record<keyof LifeState, number>> = {};

  for (const [rawKey, rawValue] of Object.entries(effect)) {
    const key = rawKey as EffectKey;
    if (typeof rawValue !== 'number' || rawValue === 0) continue;

    const lifeKey = EFFECT_TO_LIFE[key];
    if (!lifeKey) continue;

    // 孵化進捗は卵にしか意味がなく、成長は成体では止まっている。
    if (lifeKey === 'hatchProgress' && c.life.stage !== 'egg') continue;
    if (lifeKey === 'growth' && c.life.stage !== 'juvenile') continue;

    const before = c.life[lifeKey] as number;
    const after = Math.max(DECAY.floor, Math.min(DECAY.ceil, before + rawValue * multiplier));
    // NaN / Infinity は Math.max/min をすり抜ける。書き込むと保存時に null になり
    // セーブが壊れるので、ここで捨てる（値の修復は state.ts の healBrokenStats が行う）。
    if (!Number.isFinite(after) || after === before) continue;

    (c.life[lifeKey] as number) = after;
    deltas[lifeKey] = Math.round((after - before) * 10) / 10;
  }

  return deltas;
}

// ─────────────────────────────────────────────────────────
//  反応（性格差・指示書 §5 §15）
// ─────────────────────────────────────────────────────────

/**
 * その子がこの世話をどう感じたか。
 *
 * 6 軸の性格（Phenotype.personality）と今の状態から決める。
 * 「人なつこい子をなでると delighted、慎重な子は dislike」のように、
 * **同じボタンでも子によって返ってくるものが違う** ことが体験の核（指示書 §15）。
 */
export function reactionFor(action: CareAction, p: Personality, life: LifeState): Reaction {
  switch (action) {
    // ── 卵 ─────────────────────────────────────────
    case 'warm':
      // 甘えん坊の卵はぬくもりをよろこぶ。自立的な子は淡泊。
      return p.dependence >= HIGH ? 'delighted' : p.dependence <= LOW ? 'neutral' : 'happy';
    case 'moisten':
      if (life.hydration >= SATED_AT) return 'full';
      return p.tidiness >= HIGH ? 'delighted' : 'happy';
    case 'talk':
      // 好奇心の強い子は殻の中から返事をする。警戒心の強い子は黙っている。
      return p.curiosity >= HIGH ? 'delighted' : p.curiosity <= LOW ? 'neutral' : 'happy';
    case 'touch':
      // 人なつこさがそのまま出る軸。慎重な子は触られるのが少し苦手。
      return p.affection >= HIGH ? 'delighted' : p.affection <= LOW ? 'dislike' : 'happy';
    case 'tidyEnv':
      return p.tidiness >= HIGH ? 'delighted' : p.tidiness <= LOW ? 'neutral' : 'happy';

    // ── 幼体・成体 ─────────────────────────────────
    case 'feed':
      // 小食の子は早く満腹になる。食いしんぼうは満腹でもまだ喜ぶ。
      if (life.hunger >= SATED_AT) return p.appetite >= HIGH ? 'happy' : 'full';
      if (p.appetite <= LOW && life.hunger >= DECAY.ceil * 0.6) return 'full';
      return p.appetite >= HIGH ? 'delighted' : 'happy';
    case 'water':
      if (life.hydration >= SATED_AT) return 'full';
      return p.appetite >= HIGH ? 'happy' : 'neutral';
    case 'clean':
      // きれい好きはここで機嫌が大きく動く。気にしない子はくすぐったいだけ。
      if (p.tidiness >= HIGH) return 'delighted';
      if (p.tidiness <= LOW) return life.cleanliness >= SATED_AT ? 'full' : 'neutral';
      return 'happy';
    case 'pet':
      // 人なつこい子はすりよってくる。慎重な子はそっと離れる。
      if (p.affection >= HIGH || p.dependence >= HIGH) return 'delighted';
      if (p.affection <= LOW) return 'dislike';
      return 'happy';
    case 'play':
      // 活発な子は跳ね回る。おとなしい子は眠そうにする。
      if (life.health < DECAY.lowThreshold) return 'sleepy';
      if (p.energy >= HIGH) return 'delighted';
      if (p.energy <= LOW) return 'sleepy';
      return 'happy';
    case 'rest':
      return p.energy >= HIGH ? 'neutral' : 'sleepy';
    default:
      return 'happy';
  }
}

// ─────────────────────────────────────────────────────────
//  台詞（seed 由来で選ぶ。Math.random() は使わない）
// ─────────────────────────────────────────────────────────

/** 世話 × 反応 の台詞候補。ここに無い組み合わせは SPEECH_FALLBACK から選ぶ。 */
const SPEECH: Readonly<Partial<Record<CareAction, Partial<Record<Reaction, readonly string[]>>>>> = {
  warm: {
    delighted: ['ぽかぽか……', 'こと、と うれしそうに ゆれた', 'なかで なにかが うごいた'],
    happy: ['しずかに あたたまっている', 'ことん、と ゆれた'],
    neutral: ['……しずかな ままだ', 'すこし ぬるいのかも'],
  },
  moisten: {
    delighted: ['しっとり、いい かんじ', 'からが つやを とりもどした'],
    happy: ['きらり と しずくが はねた', 'ひんやり きもちよさそう'],
    full: ['もう じゅうぶん しめっている'],
  },
  talk: {
    delighted: ['こんこん、と 返事が した！', 'なかから ことり と おとが した'],
    happy: ['きこえて いるみたいだ', 'そっと ゆれて こたえた'],
    neutral: ['……しん、と している'],
  },
  touch: {
    delighted: ['てのひらに よりそって きた', 'ことこと ふるえている'],
    happy: ['あたたかい もようが うかんだ', 'ゆっくり ゆれた'],
    dislike: ['すこし かたく なった', 'そっと しずかに なった'],
  },
  tidyEnv: {
    delighted: ['ねどこが ふかふかに なった！', 'いい においが する'],
    happy: ['すっきり した', 'こけが つやつやだ'],
    neutral: ['……とくに 気に していないみたい'],
  },
  feed: {
    delighted: ['もぐもぐ！ もっと ほしい！', 'ぱくぱく…… しあわせ', 'おいしい！ おいしい！'],
    happy: ['もぐもぐ', 'おいしいね', 'ぱく、と たべた'],
    full: ['おなかは いっぱい……', 'もう たべられないよ', 'すこし 休みたいな'],
    neutral: ['ちょっとだけ たべた'],
  },
  water: {
    delighted: ['ごくごく！ つめたい！', 'おいしい みず！'],
    happy: ['こくり、と のんだ', 'うるおった'],
    neutral: ['ひとくち だけ のんだ'],
    full: ['のどは かわいてないよ'],
  },
  clean: {
    delighted: ['ぴかぴか！ うれしい！', 'つやつやに なった！', 'きれいなのが いちばん'],
    happy: ['さっぱり した', 'きれいに なった'],
    neutral: ['……くすぐったい', 'べつに よごれて ないのに'],
    full: ['もう じゅうぶん きれいだよ'],
  },
  pet: {
    delighted: ['すりよって きた！', 'もっと なでて！', 'ごろごろ……'],
    happy: ['きもちよさそうに 目を ほそめた', 'ふるふる と ゆれた'],
    dislike: ['すこし はなれた', 'そっと 身を ひいた', 'まだ ちょっと はずかしい'],
    sleepy: ['うとうと して きた'],
  },
  play: {
    delighted: ['ぴょんぴょん はねている！', 'もっと あそぼう！', 'くるくる まわった！'],
    happy: ['たのしそうに ゆれている', 'ころころ ころがった'],
    sleepy: ['ねむそうに あくびを した', 'きょうは のんびり したいみたい'],
  },
  rest: {
    sleepy: ['すう…… すう……', 'まるくなって ねむった', 'ゆっくり 目を とじた'],
    neutral: ['まだ あそびたそう だけど 目を とじた'],
  },
};

/** 組み合わせが定義されていないときの受け皿。 */
const SPEECH_FALLBACK: Readonly<Record<Reaction, readonly string[]>> = {
  delighted: ['うれしそうだ！', 'とても よろこんでいる！'],
  happy: ['うれしそうに ゆれた', 'きげんが よさそう'],
  neutral: ['じっと している', 'そっと こちらを 見ている'],
  dislike: ['すこし いやがっている', 'そっと 身を ひいた'],
  sleepy: ['ねむそうだ', 'うとうと している'],
  full: ['もう じゅうぶん みたい', 'おなかいっぱい という顔だ'],
};

/**
 * 台詞を選ぶ。
 * seed だけで選ぶと「同じ状況で毎回まったく同じ台詞」になるので、
 * 通算の世話回数（nonce）を混ぜて、巡ってくる順番も個体ごとに違うようにする。
 */
export function pickSpeech(c: Creature, action: CareAction, reaction: Reaction, nonce: number): string {
  const pool = SPEECH[action]?.[reaction] ?? SPEECH_FALLBACK[reaction];
  return new Rng(c.seed).stream(`speech:${action}:${reaction}:${nonce}`).pick(pool);
}

// ─────────────────────────────────────────────────────────
//  可否判定
// ─────────────────────────────────────────────────────────

/** その段階で選べる世話アクション（UI の表示順の正本は config.CARE_BY_STAGE）。 */
export function careActionsFor(stage: Stage): CareAction[] {
  return [...CARE_BY_STAGE[stage]];
}

/** 直近に行った世話の時刻（種類を問わない）。一度も無ければ null。 */
function lastCareTime(lastCareAt: Readonly<Record<string, number>>): number | null {
  let last: number | null = null;
  for (const key of Object.keys(lastCareAt)) {
    const t = lastCareAt[key];
    if (typeof t === 'number' && Number.isFinite(t) && (last === null || t > last)) last = t;
  }
  return last;
}

/** 「もう満ちている」ソフト理由。押せるが効きにくいことを伝える。 */
function satedReason(action: CareAction, life: LifeState): string | null {
  if (action === 'feed' && life.hunger >= SATED_AT) return 'おなかは いっぱいみたい。';
  if ((action === 'water' || action === 'moisten') && life.hydration >= SATED_AT) {
    return 'のどは かわいていないみたい。';
  }
  if ((action === 'clean' || action === 'tidyEnv') && life.cleanliness >= SATED_AT) {
    return 'もう じゅうぶん きれいみたい。';
  }
  if (action === 'rest' && life.health >= SATED_AT) return 'とても 元気そう。';
  return null;
}

/**
 * そのアクションが今使えるか。
 *
 * enabled=false は「押しても意味が通らない」ときだけ。
 * enabled=true でも reason が付くことがある（満腹・飽き・満足）。
 * UI はボタンを消さず、reason を吹き出しやツールチップに出せばよい。
 */
export function careAvailability(
  state: GameState,
  creatureId: string,
  action: CareAction,
  now: number,
): { enabled: boolean; reason?: string; effectiveness: number } {
  const c = findCreature(state, creatureId);
  if (!c) return { enabled: false, reason: 'その子が 見つかりません。', effectiveness: 0 };

  const def = CARE_DEFS[action];
  if (!def) return { enabled: false, reason: 'その世話は ありません。', effectiveness: 0 };

  if (!def.stages.includes(c.life.stage)) {
    return {
      enabled: false,
      reason: `${STAGE_LABEL[c.life.stage]}には できません。`,
      effectiveness: 0,
    };
  }

  const effectiveness = careEffectMultiplier(c.life.lastCareAt, action, now);

  // ── 休息中（「やすませる」の結果。切り札に重みを持たせるための唯一の全面停止）──
  if (c.life.restingUntil > now) {
    const sec = Math.ceil((c.life.restingUntil - now) / 1000);
    return { enabled: false, reason: `ぐっすり ねむっています（あと ${sec} 秒）。`, effectiveness };
  }

  // ── 同じ世話のクールダウン ──
  const mine = c.life.lastCareAt[action];
  if (typeof mine === 'number' && Number.isFinite(mine) && now - mine < def.cooldownMs) {
    const sec = Math.ceil((def.cooldownMs - (now - mine)) / 1000);
    return { enabled: false, reason: `「${def.label}」は あと ${sec} 秒 まってください。`, effectiveness };
  }

  // ── 世話全体のクールダウン（別のボタンを連打して進行を早める抜け道を塞ぐ）──
  const any = lastCareTime(c.life.lastCareAt);
  if (any !== null && now - any < TIMING.globalCareCooldownMs) {
    const sec = Math.max(1, Math.ceil((TIMING.globalCareCooldownMs - (now - any)) / 1000));
    return { enabled: false, reason: `いま 反応を みています（あと ${sec} 秒）。`, effectiveness };
  }

  // ── ここから先は「押せる」。効きが悪い理由だけ伝える ──
  const sated = satedReason(action, c.life);
  if (sated) return { enabled: true, reason: sated, effectiveness };

  if (careSatiationFactor(c.life.lastCareAt, now) < SATIATION.satiatedNoticeBelow) {
    return { enabled: true, reason: 'さっきの 世話で まだ 満足しているみたい。', effectiveness };
  }
  if (careBoredomFactor(c.life.lastCareAt, action, now) < BOREDOM.boredNoticeBelow) {
    return { enabled: true, reason: 'おなじ 世話に すこし あきているみたい。', effectiveness };
  }

  return { enabled: true, effectiveness };
}

// ─────────────────────────────────────────────────────────
//  実行
// ─────────────────────────────────────────────────────────

/** 世話を 1 回行う。 */
export function doCare(
  state: GameState,
  creatureId: string,
  action: CareAction,
  now: number,
): CareResult {
  // now を持つ入り口はゲーム内時計を更新する（canBreed など now を取れない関数のため）。
  noteNow(now);

  const c = findCreature(state, creatureId);
  if (!c) {
    return {
      ok: false,
      reason: 'その子が 見つかりません。',
      reaction: 'neutral',
      speech: '',
      deltas: {},
    };
  }

  const avail = careAvailability(state, creatureId, action, now);
  if (!avail.enabled) {
    return {
      ok: false,
      reason: avail.reason,
      reaction: 'neutral',
      speech: 'いまは そっと 見まもろう。',
      deltas: {},
    };
  }

  // 壊れた値が残っていたら、効果を足す前に直す（NaN は保存で null になる）。
  healBrokenStats(c.life);

  const def = CARE_DEFS[action];
  // 倍率は lastCareAt を更新する **前** に取る（更新後だと常に満足度が最低になる）。
  const boredom = careBoredomFactor(c.life.lastCareAt, action, now);
  const multiplier = careEffectMultiplier(c.life.lastCareAt, action, now);

  const personality = getPhenotype(c).personality;
  const reaction = reactionFor(action, personality, c.life);

  const deltas = applyEffects(c, def.effect, multiplier * REACTION_MULT[reaction]);

  c.life.careCount += 1;
  c.life.lastCareAt[action] = now;
  state.stats.careActions += 1;

  // 「やすませる」だけは、しばらく他の世話を止める（config.TIMING.restDurationMs）。
  if (action === 'rest') c.life.restingUntil = now + TIMING.restDurationMs;

  const speech = pickSpeech(c, action, reaction, c.life.careCount);

  // 世話の結果その場で孵化・成体化することがある（tick を待たせない）。
  const change = advanceStageIfReady(state, c, now);
  state.updatedAt = now;

  const result: CareResult = {
    ok: true,
    reaction,
    speech,
    deltas,
    bored: boredom < BOREDOM.boredNoticeBelow,
  };
  if (change.evolved) result.evolved = change.evolved;
  if (change.blocked) result.reason = change.blocked;
  return result;
}
