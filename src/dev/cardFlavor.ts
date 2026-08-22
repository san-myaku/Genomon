/**
 * 個体固有のフレーバーテキスト。
 *
 * カードの数値説明ではなく、「この個体の外側にも世界が続いている」と感じさせる
 * ための短い観察記録。AI にその場で作文させず、人が書いた文の集合から
 * Phenotype と seed に応じて決定論的に選ぶ。
 *
 * 重要:
 * - Math.random() を使わない。同じ個体はいつでも同じ文になる。
 * - 実際に持っていない形質について断言しない。
 * - 保因を直接ばらす文章にはしない。鑑定結果を知ったあとで意味が増す程度の
 *   「匂わせ」に留める。
 */

import type { Phenotype } from '../core/types.ts';
import { Rng } from '../core/rng.ts';

export type FlavorKind = 'FIELD NOTE' | 'BREEDER NOTE' | 'ARCHIVE' | 'OLD SAYING';

export interface FlavorText {
  kind: FlavorKind;
  text: string;
}

interface Candidate {
  kind: FlavorKind;
  text: string;
}

const GENERIC: readonly Candidate[] = [
  { kind: 'FIELD NOTE', text: '餌を置いた直後より、観察者が背を向けたあとによく動く。' },
  { kind: 'FIELD NOTE', text: '同じ場所で眠るが、朝になると必ず少しだけ向きが違う。' },
  { kind: 'FIELD NOTE', text: '水を飲む前に、器の縁へ一度だけ触れる癖がある。' },
  { kind: 'FIELD NOTE', text: '名前を呼ぶより、記録紙をめくる音によく反応した。' },
  { kind: 'FIELD NOTE', text: '静かな日は、呼吸に合わせて模様まで動いて見える。' },
  { kind: 'BREEDER NOTE', text: '見た目だけで残した個体が、三代あとに系統の基準になった。' },
  { kind: 'BREEDER NOTE', text: 'よい親は、目立つ子を産むとは限らない。記録だけは捨てるな。' },
  { kind: 'BREEDER NOTE', text: 'この子を選んだ理由は説明できなかった。次の世代を見て、ようやく分かった。' },
  { kind: 'BREEDER NOTE', text: '似ていることと、同じであることは違う。育種家はその差を残す。' },
  { kind: 'ARCHIVE', text: '最初の記録には、特徴より先に「よく見ること」とだけ書かれている。' },
  { kind: 'ARCHIVE', text: '古い標本帳では、この系統だけ余白が広く取られていた。' },
  { kind: 'ARCHIVE', text: '番号の振り直しが一度だけ検討されたが、元の記録がそのまま残された。' },
  { kind: 'OLD SAYING', text: '育種家は、見えているものより見えていないものを長く覚える。' },
  { kind: 'OLD SAYING', text: '一代の姿を見て、系統を語ってはいけない。' },
  { kind: 'OLD SAYING', text: '珍しい個体は探せる。残すべき個体は、育てなければ分からない。' },
];

function addPattern(out: Candidate[], p: Phenotype): void {
  switch (p.parts.pattern) {
    case 'stardust':
      out.push(
        { kind: 'FIELD NOTE', text: '眠っているあいだも、背中の星は少しずつ場所を変える。' },
        { kind: 'ARCHIVE', text: '暗室で写した記録だけ、点の数が一つ多い。理由はまだ書かれていない。' },
      );
      break;
    case 'cow':
      out.push(
        { kind: 'BREEDER NOTE', text: '斑点の並びは似ても、同じ並びの個体は一度も出なかった。' },
        { kind: 'ARCHIVE', text: 'この斑を写し取った紙は、繁殖記録と同じ棚に保管される。' },
      );
      break;
    case 'dartNet':
      out.push(
        { kind: 'OLD SAYING', text: '網目の切れ目を数える育種家がいる。理由を話す者はいない。' },
        { kind: 'FIELD NOTE', text: '成長するほど、網目より網目のない場所の方が目につく。' },
      );
      break;
    case 'stripes':
      out.push({ kind: 'FIELD NOTE', text: '歩くたび、縞だけが半拍遅れて追いかけてくるように見える。' });
      break;
    case 'contour':
      out.push({ kind: 'ARCHIVE', text: '古い記録では、この線を「育った時間の跡」と呼んでいた。' });
      break;
    default:
      break;
  }
}

function addPalette(out: Candidate[], p: Phenotype): void {
  switch (p.palette.family) {
    case 'pearl':
      out.push(
        { kind: 'FIELD NOTE', text: '灯りを落とすと、この子だけは夜を知らない。' },
        { kind: 'OLD SAYING', text: '真珠色は色ではない。光が去ったあとに残るものだ。' },
      );
      break;
    case 'ash':
      out.push({ kind: 'ARCHIVE', text: '色の少ない個体ほど、一点の色が長く記録に残る。' });
      break;
    case 'mineral':
      out.push({ kind: 'FIELD NOTE', text: '角度を変えるたび、昨日まで無かった面が一つ増える。' });
      break;
    case 'lagoon':
      out.push({ kind: 'OLD SAYING', text: '水辺の色を持つ子は、乾いた部屋でも水の場所を覚えている。' });
      break;
    case 'ember':
      out.push({ kind: 'FIELD NOTE', text: '暖かい場所では目立たず、冷えた朝だけ輪郭が濃く見える。' });
      break;
    default:
      break;
  }
}

function addBody(out: Candidate[], p: Phenotype): void {
  if (p.parts.coat === 'fuzz') {
    out.push(
      { kind: 'FIELD NOTE', text: '濡れた日の記録だけ、輪郭がひとまわり小さい。' },
      { kind: 'BREEDER NOTE', text: '毛並みを選んだつもりが、残ったのは別の形質だった。' },
    );
  } else if (p.parts.coat !== 'none') {
    out.push({ kind: 'FIELD NOTE', text: '逆光では、体より先に毛先の輪郭が現れる。' });
  }

  if (p.parts.lumin !== 'none' || p.glow > 0.62) {
    out.push(
      { kind: 'FIELD NOTE', text: '暗室に入れると、輪郭だけが先にこちらを向く。' },
      { kind: 'ARCHIVE', text: '夜間観察の頁だけ、インクの色がわずかに違う。' },
    );
  }
  if (p.translucency > 0.58 || p.parts.texture === 'veil') {
    out.push({ kind: 'FIELD NOTE', text: '向こう側が透けて見えるのに、影だけは妙にはっきりしている。' });
  }
  if (p.size > 1.12) {
    out.push({ kind: 'BREEDER NOTE', text: '大きさは記録しやすい。大きくなった理由は、いつも記録しにくい。' });
  } else if (p.size < 0.9) {
    out.push({ kind: 'ARCHIVE', text: '小さい個体ほど余白を広く取れ、と古い標本規格にある。' });
  }
}

function addPersonality(out: Candidate[], p: Phenotype): void {
  const x = p.personality;
  if (x.curiosity > 0.72) {
    out.push({ kind: 'FIELD NOTE', text: '扉を開ける音より、閉める音に先に反応した。' });
  }
  if (x.affection > 0.75) {
    out.push({ kind: 'FIELD NOTE', text: '観察者が代わると、最初に手ではなく顔を確かめる。' });
  } else if (x.affection < 0.25) {
    out.push({ kind: 'FIELD NOTE', text: '観察者がいなくなってから、ようやく餌箱へ近づいた。' });
  }
  if (x.tidiness > 0.76) {
    out.push({ kind: 'FIELD NOTE', text: '寝床の位置を変えても、朝には同じ向きに整え直してある。' });
  }
  if (x.energy < 0.23) {
    out.push({ kind: 'OLD SAYING', text: '動かない個体を退屈だと言うのは、観察が短すぎる。' });
  }
}

/** 同じ Phenotype からは必ず同じ一文を返す。 */
export function deriveFlavorText(pheno: Phenotype): FlavorText {
  const candidates: Candidate[] = [...GENERIC];
  addPattern(candidates, pheno);
  addPalette(candidates, pheno);
  addBody(candidates, pheno);
  addPersonality(candidates, pheno);

  const rng = new Rng(pheno.seed).stream('card:flavor');

  // 個体固有の形質に紐づく文がある場合、それを少し優先する。
  const specificCount = candidates.length - GENERIC.length;
  if (specificCount > 0 && rng.bool(0.72)) {
    return rng.pick(candidates.slice(GENERIC.length));
  }
  return rng.pick(candidates);
}
