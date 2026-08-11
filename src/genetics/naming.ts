/**
 * 名前の自動生成。
 *
 * やわらかい響きのカタカナ名を seed から決定論的に作る。
 * 既存キャラクター名を連想させないよう、音節表は独自に組んでいる
 * （濁音・半濁音・拗音を頭に置かない、語尾は母音か「ン」「リ」「ナ」系で終える）。
 */

import { Rng } from '../core/rng.ts';

/** 語頭。やわらかい清音を中心に。 */
const HEAD: readonly string[] = [
  'ミ', 'ポ', 'ユ', 'ル', 'ノ', 'コ', 'ハ', 'サ', 'ネ', 'リ',
  'モ', 'テ', 'ヒ', 'ラ', 'ク', 'セ', 'ト', 'マ', 'ヨ', 'ワ',
  'ナ', 'シ', 'フ', 'メ', 'ソ', 'キ', 'タ', 'チ', 'ホ', 'ム',
  'ロ', 'レ', 'カ', 'ケ', 'ヌ', 'ニ', 'ヤ', 'エ', 'オ', 'ア',
];

/** 中間。母音の流れが気持ちよくなる音を選んである。 */
const MID: readonly string[] = [
  'ル', 'ナ', 'コ', 'リ', 'ハ', 'メ', 'モ', 'ミ', 'ノ', 'セ',
  'タ', 'ラ', 'ヤ', 'ロ', 'レ', 'ク', 'ネ', 'チ', 'ソ', 'ト',
  'ポ', 'ピ', 'プ', 'マ', 'ム', 'ユ', 'ワ', 'シ', 'テ', 'ホ',
];

/** 語尾。ここで名前の印象が決まるので、丸い音だけにする。 */
const TAIL: readonly string[] = [
  'ナ', 'リ', 'ン', 'ヤ', 'コ', 'ミ', 'ノ', 'ホ', 'ム', 'ラ',
  'ル', 'メ', 'モ', 'マ', 'ネ', 'テ', 'カ', 'ト', 'ハ', 'セ',
];

/** 小さく添える音（たまに入ると愛嬌が出る）。 */
const TINY: readonly string[] = ['ィ', 'ゥ', 'ェ', 'ォ', 'ャ', 'ュ', 'ョ'];

/**
 * 念のための除外リスト。
 * 既存作品を連想させる並びが偶然できたときだけ作り直す。
 */
const BLOCKED: readonly string[] = ['ピカチュ', 'ポケモ', 'ミッキ', 'キティ', 'ドラエ', 'マリオ'];

function assemble(rng: Rng): string {
  const head = rng.pick(HEAD);
  const len = rng.pickWeighted([2, 3, 4], [26, 58, 16]);

  let name = head;
  for (let i = 1; i < len - 1; i++) {
    name += rng.pick(MID);
  }
  name += rng.pick(TAIL);

  // まれに小さい音を差し込む（2 文字目以降のみ）。
  if (rng.bool(0.12) && name.length >= 3) {
    const pos = rng.int(2, name.length - 1);
    name = name.slice(0, pos) + rng.pick(TINY) + name.slice(pos);
  }

  return name;
}

/** 同じ音が 3 つ続くなど、読みにくい並びを弾く。 */
function looksBad(name: string): boolean {
  for (let i = 2; i < name.length; i++) {
    if (name[i] === name[i - 1] && name[i] === name[i - 2]) return true;
  }
  return BLOCKED.some((b) => name.startsWith(b));
}

/**
 * seed から名前を作る。同じ seed からは常に同じ名前。
 * 例: ミルナ / ポコリ / ユメハ のような響きになる。
 */
export function makeName(seed: string): string {
  const root = new Rng(seed);
  for (let attempt = 0; attempt < 8; attempt++) {
    const rng = root.stream(`name:${attempt}`);
    const name = assemble(rng);
    if (!looksBad(name)) return name;
  }
  return assemble(root.stream('name:fallback'));
}

/** 兄弟に連番の別名を付けたいときに使う（seed 由来で決定論的）。 */
export function makeNames(seed: string, n: number): string[] {
  const out: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < n; i++) {
    let name = makeName(`${seed}#${i}`);
    let salt = 0;
    while (used.has(name) && salt < 16) {
      salt++;
      name = makeName(`${seed}#${i}/${salt}`);
    }
    used.add(name);
    out.push(name);
  }
  return out;
}
