/**
 * Cards Lab 専用の「経歴」。**本編のデータではない。**
 *
 * ─────────────────────────────────────────────────────────
 * 【この型が独立している理由 — 本番へ持っていくときの目印】
 *
 *   カードの裏面には、血統・交配・展示の記録が載る。しかし本編には
 *   まだ「親をたどる」「展示の履歴を残す」仕組みが無い。ここで
 *   Phenotype から取れる値（模様・希少度・遺伝子）と、まだ存在しない値
 *   （親・子・展示成績）を **同じ型に混ぜてしまうと、本番へ移すときに
 *   どれが嘘だったのか分からなくなる**。
 *
 *     CardFacts       … Phenotype / Genotype から出る本物
 *     LabCardHistory  … seed から決めた仮の経歴（この型）
 *
 *   `labOnly: true` を必ず持たせてあるので、本番実装のときは
 *   `labOnly` を検索すれば置き換え箇所が全部出る。
 *
 * 【決定論】
 *   すべて `new Rng(seed).stream('lab:…')` 由来。`Math.random()` も
 *   `Date.now()` も使わない。同じ個体のカードは、いつ開いても同じ経歴になる。
 *
 * 【発行時スナップショットへの布石（§16）】
 *   将来カードは「発行された瞬間の記録」になり、あとで rarity 算法や
 *   展示成績が変わっても昔のカードは変質してはいけない。そのため
 *   ここは **引数で受け取った値だけ** から組み立て、外の可変な状態を見ない。
 *   `CertifiedCardSnapshot` へ移すときは、この戻り値をそのまま
 *   保存対象にできる形にしてある。
 * ─────────────────────────────────────────────────────────
 */

import { Rng } from '../core/rng.ts';
import { makeName } from '../genetics/naming.ts';
import type { CardRank } from './cardRarity.ts';

/** 個体コード名の語幹。鉱物・天体・植物の語をもとにした造語。 */
export const CODE_STEMS: readonly string[] = [
  'NOVA', 'LUNE', 'AURI', 'MOSS', 'VESP', 'IRIS', 'CIRR', 'FERN', 'ONYX', 'OPAL',
  'HALO', 'VIRE', 'LUMA', 'NIMB', 'CALX', 'SILV', 'AMBR', 'TERR', 'GLAU', 'ZEPH',
  'ORYX', 'SOLE', 'MICA', 'PYRE', 'CERU', 'THAL', 'VELU', 'ARBO', 'CRIN', 'NACR',
  'RIME', 'SORA', 'TIDE', 'VEIL', 'DUNE', 'ECHO', 'FLUX', 'GEOD', 'HELI', 'INDI',
];

const SHOW_EVENTS: readonly string[] = [
  'VERDANT SHOW', 'PALE MOON EXPO', 'STRATA CUP', 'AURORA CLASSIC',
  'HOLLOW FAIR', 'TIDEPOOL INVITATIONAL', 'EMBER TRIALS', 'GLASS GARDEN CUP',
  'NORTHGATE EXHIBITION', 'SALT MEADOW OPEN',
];

const TITLES: readonly string[] = [
  'BEST IN SHOW', 'CHAMPION OF FORM', 'JUDGES CHOICE', 'BREEDERS CUP',
  'MASTER OF PATTERN', 'GRAND CHAMPION', 'RISING LINE',
];

const DESCENDANT_NOTE: readonly string[] = [
  'FIRST OF LINE', 'PATTERN FOUNDER', 'COLOUR FOUNDER', 'RECORD HOLDER', 'EXPORTED',
];

/** 発行枚数の母数。珍しい段ほど少ない。 */
const PRINT_TOTAL: Readonly<Record<CardRank, number>> = {
  standard: 2000,
  notable: 999,
  rare: 444,
  exceptional: 180,
  mythic: 60,
};

const ROMAN_UNITS: readonly (readonly [number, string])[] = [
  [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** 小さな数をローマ数字にする（世代表記用）。 */
export function toRoman(nth: number): string {
  let rest = Math.max(1, Math.floor(nth));
  let out = '';
  while (rest >= 10) {
    out += 'X';
    rest -= 10;
  }
  for (const pair of ROMAN_UNITS) {
    while (rest >= pair[0]) {
      out += pair[1];
      rest -= pair[0];
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────
//  型
// ─────────────────────────────────────────────────────────

export interface LabParent {
  /** カード上の型式番号（NOVA-17）。 */
  code: string;
  /** カタカナ名（本編と同じ makeName）。 */
  name: string;
  /** 登録番号。 */
  regId: string;
  role: 'sire' | 'dam';
}

export interface LabShowEntry {
  event: string;
  year: number;
  /** 展示会と同じ 0..100 の総合点。 */
  score: number;
  /** 順位表記。 */
  place: string;
}

export interface LabCardHistory {
  /**
   * **この経歴は Lab 専用の作りもの**。本番実装ではここを消して
   * 実データへ差し替える。`labOnly` を検索すれば該当箇所が全部出る。
   */
  readonly labOnly: true;
  generation: number;
  generationRoman: string;
  parents: readonly [LabParent, LabParent];
  /** 交配回数。 */
  matings: number;
  /** 子の数。 */
  offspring: number;
  /** 記録に残った子孫（コード名）。 */
  notableDescendants: readonly { code: string; note: string }[];
  /** 種親として実績が認められているか。 */
  proven: 'sire' | 'dam' | null;
  shows: readonly LabShowEntry[];
  /** いちばん良かった展示成績。 */
  bestShow: LabShowEntry | null;
  titles: readonly string[];
  /** 鑑定日。 */
  certifiedOn: string;
  /** 発行番号。 */
  print: { index: number; total: number; text: string };
}

// ─────────────────────────────────────────────────────────
//  生成
// ─────────────────────────────────────────────────────────

function code(rng: Rng): string {
  return `${rng.pick(CODE_STEMS)}-${String(rng.int(1, 99)).padStart(2, '0')}`;
}

/**
 * 仮の経歴を組み立てる。
 *
 * `rank` を受け取るのは、発行枚数と展示成績の厚みを段に連動させるため。
 * 珍しい個体ほど記録が厚いのは自然だし、裏面を並べたときに
 * 「この子は本当に特別だ」と読める（数字の裏づけになる）。
 */
export function deriveLabHistory(seed: string, rank: CardRank): LabCardHistory {
  const root = new Rng(seed);

  const genRng = root.stream('lab:generation');
  const generation = genRng.pickWeighted(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 12],
    [8, 12, 15, 16, 14, 12, 9, 7, 4, 3],
  );

  // ── 親 ──
  const pRng = root.stream('lab:parents');
  const parent = (role: 'sire' | 'dam'): LabParent => {
    const pseed = `${seed}#lab:parent:${role}`;
    return {
      code: code(pRng),
      name: makeName(pseed),
      regId: `GM-${String(pRng.int(1, 99_999_999)).padStart(8, '0')}`,
      role,
    };
  };
  // 初代（GEN I）に親はいない、という嘘をつかないよう、世代 1 でも
  // 「記録なし」を表せるように空文字ではなく専用の値を入れておく。
  const parents: readonly [LabParent, LabParent] =
    generation <= 1
      ? [
          { code: '—', name: '記録なし', regId: '—', role: 'sire' },
          { code: '—', name: '記録なし', regId: '—', role: 'dam' },
        ]
      : [parent('sire'), parent('dam')];

  // ── 交配 ──
  const bRng = root.stream('lab:breeding');
  const matings = generation <= 1 ? bRng.int(0, 2) : bRng.int(0, 9);
  const offspring = matings === 0 ? 0 : bRng.int(matings, matings * 4);
  const descCount = offspring === 0 ? 0 : bRng.pickWeighted([0, 1, 2, 3], [46, 30, 16, 8]);
  const notableDescendants = Array.from({ length: descCount }, () => ({
    code: code(bRng),
    note: bRng.pick(DESCENDANT_NOTE),
  }));
  const proven = matings >= 3 && offspring >= 6 ? bRng.pick(['sire', 'dam'] as const) : null;

  // ── 展示 ──
  //   段が高いほど回数も点も伸びる。ここが空でも「NO RECORD ON FILE」と
  //   書けるよう、0 件を許している（実際、大半の個体は展示に出ない）。
  const sRng = root.stream('lab:shows');
  const rankBonus: Record<CardRank, number> = {
    standard: 0, notable: 4, rare: 9, exceptional: 14, mythic: 20,
  };
  const showCount = sRng.pickWeighted([0, 1, 2, 3, 4], [30, 26, 20, 14, 10]);
  const shows: LabShowEntry[] = [];
  for (let i = 0; i < showCount; i++) {
    const score = Math.min(99.8, Math.round((sRng.float(38, 74) + rankBonus[rank]) * 10) / 10);
    shows.push({
      event: sRng.pick(SHOW_EVENTS),
      year: sRng.int(2024, 2026),
      score,
      place:
        score >= 88 ? '1st Place' : score >= 78 ? '2nd Place' : score >= 68 ? '3rd Place' : 'Finalist',
    });
  }
  const bestShow = shows.reduce<LabShowEntry | null>(
    (best, s) => (best === null || s.score > best.score ? s : best),
    null,
  );
  const titleCount = bestShow && bestShow.score >= 84 ? sRng.pickWeighted([1, 2], [70, 30]) : 0;
  const titles = Array.from({ length: titleCount }, () => sRng.pick(TITLES));

  // ── 鑑定日と発行番号 ──
  const dRng = root.stream('lab:date');
  const year = dRng.int(2024, 2026);
  const month = dRng.int(1, 12);
  const day = dRng.int(1, 28);

  const total = PRINT_TOTAL[rank];
  const index = root.stream('lab:print').int(1, total);
  const pad = String(total).length;

  return {
    labOnly: true,
    generation,
    generationRoman: toRoman(generation),
    parents,
    matings,
    offspring,
    notableDescendants,
    proven,
    shows,
    bestShow,
    titles,
    certifiedOn: `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`,
    print: { index, total, text: `${String(index).padStart(pad, '0')}/${total}` },
  };
}
