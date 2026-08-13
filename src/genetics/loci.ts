/**
 * 遺伝子座と対立遺伝子のデータ駆動カタログ（正本）。
 *
 * ここに書かれた対立遺伝子 ID が、そのまま描画側のパーツ ID になる。
 * 新しいパーツを増やすときは、まずこのファイルに追加する。
 *
 * dominance（優性度）の設計方針:
 *   - 「なし(none)」は多くの器官で最も優性にしてある。
 *     → 装飾が全個体に生えて全部が派手になる事故を防ぐ（指示書 §11）。
 *   - 珍しい形質ほど dominance を低く（潜性に）してある。
 *     → 保因されて数世代後に突然現れる楽しさが生まれる（指示書 §14）。
 *   - dominance が同値で両方 coDominant のときのみ共優性表現になる。
 */

import type { CatLocus, CatLocusDef, NumLocus, NumLocusDef } from '../core/types.ts';

// ─────────────────────────────────────────────────────────
//  カテゴリ形質
// ─────────────────────────────────────────────────────────

export const CAT_LOCI: readonly CatLocusDef[] = [
  {
    locus: 'base',
    label: '素体',
    alleles: [
      { id: 'maru',  label: 'まる型',   dominance: 3, weight: 34, coDominant: true },
      { id: 'yurei', label: '幽霊型',   dominance: 3, weight: 33, coDominant: true },
      { id: 'slime', label: 'スライム型', dominance: 3, weight: 33, coDominant: true },
    ],
    // 素体は混ざらない（形が破綻するため）。共優性の場合は後述の解決規則で
    // seed 由来に片方を選ぶ。coExpress は定義しない。
  },
  {
    locus: 'silhouette',
    label: '輪郭',
    alleles: [
      // ビジュアル批評の実測で `plain` が 100 体中 57 体を占め、
      // 96px サムネイルの大半が「同じ丸いドーム」になっていた。
      // 輪郭に効く遺伝子座はここだけなので、plain の優位を崩す。
      { id: 'plain',   label: 'すなお',   dominance: 4, weight: 16 },
      { id: 'tall',    label: 'たてなが', dominance: 4, weight: 18 },
      { id: 'wide',    label: 'よこひろ', dominance: 4, weight: 18 },
      { id: 'wavy',    label: 'ゆらぎ',   dominance: 3, weight: 17 },
      { id: 'pointed', label: 'とんがり', dominance: 3, weight: 16 },
      { id: 'lobed',   label: 'くびれ',   dominance: 2, weight: 15, notable: true },
    ],
  },
  {
    locus: 'eyeCount',
    label: '目の数',
    alleles: [
      { id: 'two',   label: 'ふたつ', dominance: 6, weight: 66 },
      { id: 'one',   label: 'ひとつ', dominance: 2, weight: 18, notable: true },
      { id: 'three', label: 'みっつ', dominance: 1, weight: 16, notable: true },
    ],
  },
  {
    locus: 'eyeShape',
    label: '目の形',
    alleles: [
      // 『まるめ』は dominance 5・weight 26 で支配的すぎ、100体シートで
      // 目の形が実質2種類しか出ていなかった（ビジュアル批評 10-1）。
      // 顕性度と重みを下げ、他の形が表に出るようにする。
      // 【『ぱっちり』を 15 → 8 に下げた理由】
      //   製品方針は「白目がはっきり見える目は**少数派**にし、標準顔には使いすぎない」。
      //   白目がいちばん見える形はこの『ぱっちり』だが、対立遺伝子比 15.8% に対して
      //   **発現は 24%**（実測 200 体中 48 体）だった。同 dominance の相手（まるめ・
      //   たまご・ねむたげ）との抽選に半分勝ち、下位の 3 種には必ず勝つためで、
      //   重みの割に出過ぎている。24% は少数派ではないので「標準顔に使いすぎ」になる。
      //
      //   描画側だけで白目を減らすと、今度は「白目がはっきり見える目」という帯そのものが
      //   消えてしまった（白目の見え割合 0.4 以上が 60.5% → 1.0%）。方針は「無くす」では
      //   なく「少数派にする」なので、**出現率を下げたうえで、この形にだけ白目を残す**。
      //   8 にすると発現は約 11.5%。減らした 7 は『まるめ』『たまご』へ回す
      //   （方針が基本形に挙げている「黒目主体の丸目」を厚くする方向）。
      //   潜性側（このは・みかづき・ほしぞら）の相対的な珍しさは変えない。
      { id: 'round',    label: 'まるめ',   dominance: 4, weight: 20 },
      { id: 'oval',     label: 'たまご',   dominance: 4, weight: 18 },
      { id: 'wide',     label: 'ぱっちり', dominance: 4, weight: 8 },
      { id: 'sleepy',   label: 'ねむたげ', dominance: 4, weight: 15 },
      { id: 'leaf',     label: 'このは',   dominance: 3, weight: 13, notable: true },
      { id: 'crescent', label: 'みかづき', dominance: 3, weight: 12, notable: true },
      { id: 'starry',   label: 'ほしぞら', dominance: 2, weight: 8, notable: true },

      // 【したりめ を追加 — 参考資料の SVG 図形（画像2）から】
      //   既存の『みかづき』（左右対称の閉じ目）とは違い、**斜めに傾いだ
      //   半月＋端に小さな切り欠き**という非対称な閉じ目。したり顔・
      //   「どや」の表情に読める。閉じ目のバリエーションとして、
      //   みかづき（穏やかな笑み）と分けて別の対立遺伝子にする。
      //   潜性側の最下位（starry と同格）として珍しさを保つ。
      { id: 'smirk',    label: 'したりめ', dominance: 2, weight: 7, notable: true },
    ],
  },
  {
    locus: 'pupil',
    label: '瞳',
    alleles: [
      // 【この遺伝子座の意味が変わった】
      //   製品方針で「瞳孔（視線の焦点になる濃い点）」を廃止した。
      //   濃い点があると、目を大きくしたときに見つめてくる圧が出るため。
      //   そこでこの座は「瞳孔の形」ではなく **「目の中の意匠」** を指すことにした。
      //   ラベル（まるい・つぶら…）はそのままでも意味が通るので変えていない。
      //   **対立遺伝子 ID は 1 つも消していない。** 既存のセーブは
      //   遺伝子型に ID を持っているので、消すと過去の個体が読めなくなる。
      //   追加は安全（新しい ID は新しく生まれた個体にしか出ない）。
      { id: 'round',   label: 'まるい',   dominance: 5, weight: 30 },
      { id: 'bead',    label: 'つぶら',   dominance: 4, weight: 20 },
      { id: 'slit',    label: 'たてぼそ', dominance: 3, weight: 16 },
      { id: 'ring',    label: 'わっか',   dominance: 2, weight: 14, notable: true },
      { id: 'sparkle', label: 'きらめき', dominance: 2, weight: 12, notable: true },
      { id: 'petalP',  label: 'はなびら', dominance: 1, weight: 8, notable: true },

      // 【カプセル目／ねこ目を追加 — 製品オーナーの参考画像から】
      //   既存の「たてぼそ」は縦帯、「わっか」は同心円なので、
      //   参考画像の縦長カプセルと猫の瞳を別の意匠として追加する。
      //   どちらも暗い一点を置かず、面の中の模様として描く。
      { id: 'capsule', label: 'カプセル', dominance: 2, weight: 7 },
      { id: 'catEye',  label: 'ねこ目',   dominance: 2, weight: 7 },

      // 【ここから 3 種は追加分】
      //   瞳孔を廃止して空いた「目の中」に置く意匠。いずれも濃い点を持たず、
      //   面か線でできているので、視線の圧を上げずに個体差だけ増やせる。
      //   合計 26 で、既存 100 に対して約 2 割。珍しいものとして扱う。
      { id: 'compound', label: 'ふくがん',   dominance: 3, weight: 10, notable: true },
      { id: 'swirl',    label: 'うずまき',   dominance: 2, weight: 6,  notable: true },

      // 【『ボタン』を取り下げた】
      //   製品オーナーの判断で不採用。**カタログから外すだけで、
      //   `face.ts` の描画は残してある。** 既存のセーブが遺伝子型に
      //   `button` を持っている可能性があり、描画を消すとその個体の目が
      //   既定の意匠に化けてしまうため。カタログから消えているので
      //   新しく生まれる個体には二度と出ない。
      //
      // 【『つやだま』を追加】
      //   製品オーナーが参考画像で示した目。濃い縁の内側が明るく、
      //   丸い光が大小 2 つ入っている。瞳孔を廃止した今の作りと相性がよく、
      //   「視線が強すぎない、やわらかい目」の方針にも合う。
      //   取り下げた『ボタン』の重み 10 を引き継ぎ、少し厚くして 12。
      { id: 'gloss',    label: 'つやだま',   dominance: 3, weight: 12, notable: true },

      // 【ばつじるし を追加 — 参考資料の SVG 図形（画像3）から】
      //   円の中に X 字。他の意匠（無地・縦の帯・二重リング・星・花形・
      //   つやだま…）と同じ「目の中の意匠」の 1 つとして加える。
      //   常時この意匠を持つ個体がいる、という設定なので「気絶」ではなく
      //   図案として扱う（ずっと気絶している生きものだと不自然なため）。
      //   いちばん珍しい意匠にする（weight を最小に）。
      { id: 'batsu',    label: 'ばつじるし', dominance: 2, weight: 5, notable: true },
    ],
  },
  {
    locus: 'lashes',
    label: 'まつげ',
    alleles: [
      // 【新設 — 製品オーナー要望】
      //   「既存の目に加えて、まつげがある個体も追加してほしい」という指摘。
      //   `eyeShape`（目の形）とは独立させる：まつげの有無をどの目の形にも
      //   等しく乗せられるようにしたいので、形そのものを増やすのではなく
      //   別のロカスにする（`face.ts` 側で `EYE_STYLE[shape].lash` に
      //   このロカスの発現を重ねる。すでにまつげ寄りの形——ぱっちり・
      //   ねむたげ・このは——では、もとの量とこのロカスの量の大きい方を使う
      //   ので二重に足されて不自然に濃くなることはない）。
      //   dominance を両方同じ値にして、発現率＝対立遺伝子頻度になる設計
      //   にした（`collar` の beadRing/frill 修正と同じ考え方）。weight の
      //   比をそのまま「まつげを持つ個体の割合」として読める（約 3 割）。
      { id: 'none',     label: 'なし',       dominance: 3, weight: 66 },
      // `lash` は既存セーブ互換のため残す「ショート」相当の標準形。
      { id: 'lash',     label: 'ショート',   dominance: 3, weight: 8 },
      { id: 'mid',      label: 'ちょい長',   dominance: 3, weight: 6 },
      { id: 'long',     label: 'ロング',     dominance: 3, weight: 4 },
      { id: 'sideLong', label: 'サイド長め', dominance: 3, weight: 3 },
      { id: 'upper',    label: '上まつ毛み', dominance: 3, weight: 3 },
      { id: 'lower',    label: '下まつ毛み', dominance: 3, weight: 3 },
      { id: 'sleepy',   label: 'おねむまつ毛', dominance: 3, weight: 7 },
    ],
  },
  {
    locus: 'mouth',
    label: '口',
    alleles: [
      // 【への字（pout）を潜性から外した理由】
      //   製品方針で「小さな笑顔・ぽかん口・への字・無表情」を口の基本形と定めた。
      //   ところが pout は dominance 2 で、上に立てるのが none（dominance 1）しかなく、
      //   実測 200 体中 4 体（2%）しか表に出ていなかった。基本形と呼べる数ではない。
      //   dominance を 3 にして wavy / open と対等にすると、同値ヘテロは 50/50 の
      //   抽選になるので（phenotype.ts の表現規則 3）、その半分を取れる。
      //   weight も 12→15 に上げ、そのぶん smile を 28→25 に下げて合計 100 を保つ。
      //   smile は下げてもなお最多（発現 44%）で、「基本はにこり」という位置は変わらない。
      //   **不機嫌な顔を増やすのが目的ではない**ので、9% 前後に留めてある。
      { id: 'smile', label: 'にこり',   dominance: 5, weight: 25 },
      { id: 'tiny',  label: 'ちいさい', dominance: 4, weight: 22 },
      { id: 'wavy',  label: 'なみなみ', dominance: 3, weight: 16 },
      { id: 'open',  label: 'ぽかん',   dominance: 3, weight: 14 },
      { id: 'pout',  label: 'むっ',     dominance: 3, weight: 15 },
      { id: 'none',  label: 'なし',     dominance: 1, weight: 8, notable: true },

      // 【ここから 3 種は追加分 — 製品オーナーの参考資料から発見】
      //   「口が小さすぎないか」の検討中に見落としていた形。参考画像
      //   （PowerPoint「ゲノモンビジュアル参考資料」2 枚目・口スライド）を
      //   1 枚ずつ拡大して見直したところ、いまの 6 種には無い形が 3 つあった。
      //   方針の「大きな笑い口や変わった口も個性として残すが、少数にする」
      //   （D-027）に合わせ、dominance 2（wavy/open/pout の 3 より弱い）・
      //   weight は 4〜5 の少数派として追加する。既存 ID は変更していない。
      { id: 'beak',  label: 'くちばし', dominance: 2, weight: 5, notable: true },
      { id: 'fang',  label: 'きば',     dominance: 2, weight: 5, notable: true },
      { id: 'peek',  label: 'したみせ', dominance: 2, weight: 4, notable: true },
      // 両端が上がった器に、下側の淡い面が入る参考画像由来の口。
      // 人間の唇に寄せず、体色由来の面として描く。
      { id: 'bowl',  label: 'おわん口', dominance: 2, weight: 4, notable: true },
    ],
  },
  {
    locus: 'ears',
    label: '耳',
    alleles: [
      // 耳はシルエットに効く数少ない部位。実測で `none` が 59% を占め、
      // 「輪郭に効く部位がほぼ常に無い」状態になっていた（ビジュアル批評 S-2）。
      // 装飾全体を増やすのではなく、**輪郭に効く耳だけ**出現率を上げる。
      // 角・翅・結晶・首かざりの `none` 優位（D-004）はそのまま維持する。
      { id: 'none',    label: 'なし',     dominance: 5, weight: 20 },
      { id: 'nub',     label: 'ちょこん', dominance: 4, weight: 20 },
      { id: 'round',   label: 'まるみみ', dominance: 4, weight: 17, coDominant: true },
      { id: 'leafEar', label: 'このはみみ', dominance: 4, weight: 15, coDominant: true },
      { id: 'longEar', label: 'うさ耳',   dominance: 2, weight: 10, notable: true },
      { id: 'flopEar', label: 'たれみみ', dominance: 2, weight: 8, notable: true },
      { id: 'tuft',    label: 'ふさみみ', dominance: 1, weight: 4, notable: true },
      { id: 'catEar',  label: 'ねこ耳',   dominance: 2, weight: 7 },
      { id: 'bearEar', label: 'くま耳',   dominance: 2, weight: 6 },
      // 【アホロートルひれを新規抽選から撤去】
      //   製品オーナーの判断で不採用。既存セーブに残る `gill` は、
      //   `render/parts/ears.ts` の描画を消さずに互換表示する。
    ],
    coExpress: { 'round+leafEar': 'roundLeafEar' },
  },
  {
    locus: 'earTip',
    label: '耳先色',
    alleles: [
      { id: 'none', label: 'なし',       dominance: 3, weight: 94 },
      // 耳の形とは別に遺伝し、発現はごく稀。耳がない個体では見た目に出ない。
      { id: 'tip',  label: 'みみさき色', dominance: 3, weight: 6, notable: true },
    ],
  },
  {
    locus: 'antennae',
    label: '触角',
    alleles: [
      { id: 'none',    label: 'なし',     dominance: 6, weight: 52 },
      { id: 'dot',     label: 'たまつき', dominance: 3, weight: 18 },
      { id: 'curl',    label: 'くるん',   dominance: 3, weight: 14 },
      { id: 'feather', label: 'ふわり',   dominance: 1, weight: 9, notable: true },
      { id: 'stemA',   label: 'くきつき', dominance: 1, weight: 7, notable: true },

      // 【すじつの を追加 — 参考資料（実物の写真）から】
      //   製品オーナーの指摘どおり、既存の『たまつき』（棒に球が 1 個）は
      //   参考の甲虫の触角（長く弧を描き、縞模様に色が交互する）とは別物。
      //   『たまつき』を描き替えるのではなく、別の対立遺伝子として追加する
      //   （既存個体の見た目を変えないため）。
      { id: 'banded',  label: 'すじつの', dominance: 1, weight: 6, notable: true },
    ],
  },
  {
    locus: 'horns',
    label: '角',
    alleles: [
      { id: 'none',        label: 'なし',       dominance: 6, weight: 56 },
      { id: 'budHorn',     label: 'つぼみづの', dominance: 3, weight: 16 },
      { id: 'twin',        label: 'ふたつづの', dominance: 3, weight: 12 },
      { id: 'spiral',      label: 'らせん',     dominance: 1, weight: 9, notable: true },
      { id: 'crystalHorn', label: 'すいしょう', dominance: 1, weight: 7, notable: true },
      // 【新しい角を追加 — 製品オーナーの参考画像から】
      //   既存の `budHorn`／`spiral`／`twin` と見分けられるよう、
      //   小さな突起・とげ状・くるん・ヤギ・ラム・サンゴを別 ID にする。
      { id: 'nubHorn',   label: 'つのポチ', dominance: 2, weight: 6 },
      { id: 'coneHorn',  label: 'とげつの', dominance: 1, weight: 5 },
      { id: 'curlHorn',  label: 'くるん角', dominance: 1, weight: 5 },
      { id: 'goatHorn',  label: 'ヤギ角',   dominance: 1, weight: 4 },
      { id: 'ramHorn',   label: 'ラム角',   dominance: 1, weight: 4 },
      { id: 'coralHorn', label: 'サンゴ角', dominance: 1, weight: 3 },
    ],
  },
  {
    locus: 'plant',
    label: '植物器官',
    alleles: [
      { id: 'none',   label: 'なし',     dominance: 5, weight: 42 },
      { id: 'sprout', label: 'ふたば',   dominance: 4, weight: 18, coDominant: true },
      { id: 'leaf',   label: 'このは',   dominance: 4, weight: 15, coDominant: true },
      { id: 'flower', label: 'はな',     dominance: 2, weight: 11, notable: true, coDominant: true },
      { id: 'fern',   label: 'しだ',     dominance: 2, weight: 8, notable: true },
      { id: 'mossTuft', label: 'こけむら', dominance: 1, weight: 6, notable: true },
    ],
    coExpress: {
      'leaf+sprout': 'leafSprout',
      'flower+leaf': 'flowerLeaf',
      'flower+sprout': 'flowerSprout',
    },
  },
  {
    locus: 'wings',
    label: '羽',
    alleles: [
      { id: 'none',     label: 'なし',     dominance: 7, weight: 68 },
      { id: 'gossamer', label: 'うすばね', dominance: 2, weight: 14, notable: true },
      { id: 'petalW',   label: 'はなばね', dominance: 1, weight: 10, notable: true },
      { id: 'moth',     label: 'よるばね', dominance: 1, weight: 8, notable: true },
      // 【ひればね】製品オーナーの個人プロジェクトから「ベタ（熱帯魚）」を移植。
      //   向こうは尾ひれ・耳・体色をまとめて変える形質で、
      //     ・色相を[赤・青・紫・紅・空・橙]から選び **彩度 95 / 明度 55** の宝石色に振る
      //     ・付け根から放射状に走る細い明るい筋（ひれ条）
      //     ・後縁が細かく波打ち、付け根の濃色 → 先端の半透明白へグラデーション
      //   の 3 つで「稀に出る、はっとするほど綺麗な個体」を作っていた。
      //   ここでは羽の対立遺伝子として置く。**いちばん珍しい羽**にしたいので
      //   dominance 1・weight 6（よるばね 8 より少ない）。
      { id: 'finW',     label: 'ひればね', dominance: 1, weight: 6, notable: true },
    ],
  },
  {
    locus: 'tail',
    label: '尾',
    alleles: [
      { id: 'none',  label: 'なし',     dominance: 5, weight: 34 },
      { id: 'stub',  label: 'ちょび',   dominance: 4, weight: 18 },
      { id: 'curl',  label: 'くるり',   dominance: 3, weight: 16 },
      { id: 'frond', label: 'はねかざり', dominance: 2, weight: 12, notable: true },
      { id: 'fin',   label: 'ひれ',     dominance: 2, weight: 11, notable: true },
      { id: 'wisp',  label: 'ゆらめき', dominance: 1, weight: 9, notable: true },
      // 丸くふくらんだ、毛束のある参考画像由来の尾。
      { id: 'fluff', label: 'ふさふさ丸尾', dominance: 2, weight: 7, notable: true },
    ],
  },
  {
    locus: 'crystal',
    label: '結晶',
    alleles: [
      { id: 'none',    label: 'なし',   dominance: 7, weight: 70 },
      // 【『かけら』（shard）を取り下げた】
      //   製品オーナーの判断で不採用（背中のトゲが尖って見えるという指摘を
      //   一度は丸め直したが、最終的に「完全に消して」という要望に変更）。
      //   **カタログから外すだけで、`aura.ts` の `case 'shard'` の描画は
      //   残してある。** 既存のセーブが遺伝子型に `shard` を持っている
      //   可能性があり、描画を消すとその個体の背中が無地に化けてしまうため。
      //   カタログから消えているので、新しく生まれる個体には二度と出ない。
      // 【『むらがり』（cluster）を取り下げた】
      //   製品オーナーの判断で不採用（「結晶むらがりをゲームから完全削除」）。
      //   **カタログから外すだけで、`aura.ts` の `case 'cluster'` の描画は
      //   残してある。** 既存のセーブが遺伝子型に `cluster` を持っている
      //   可能性があり、描画を消すとその個体の背中が無地に化けてしまうため。
      //   カタログから消えているので、新しく生まれる個体には二度と出ない。
      // 【結晶をゲームから完全撤去】
      //   `halo` も新規抽選のカタログから外し、現在の結晶ロカスは `none` のみ。
      //   下位の描画コードは既存セーブ互換のため `aura.ts` に残す。
    ],
  },
  {
    locus: 'collar',
    label: '首かざり',
    alleles: [
      { id: 'none',    label: 'なし',   dominance: 7, weight: 74 },
      // 『こけわ』を外して非既定側が2種だけになったため、`beadRing` と
      // `frill` の dominance を同値（2）に揃えた。dominance が違うままだと
      // 上位側がヘテロで常に勝ってしまい、下位側がほぼ発現しなくなる
      // （実測: 既定値以外の中で 96% が `beadRing` に偏り、多様性テストで
      // 検出された）。同値ヘテロは seed 由来の五分五分抽選になるので、
      // これで両方がまんべんなく発現する。
      { id: 'beadRing', label: 'つぶわ', dominance: 2, weight: 12, notable: true },
      { id: 'frill',   label: 'ひだ',   dominance: 2, weight: 8, notable: true },
      // 【『こけわ』（mossRing）を取り下げた】
      //   製品オーナーの判断で不採用（「腰巻きに見える」という指摘を受けて
      //   ビーズ状のリングに作り直したが、最終的に「完全に消して」という
      //   要望に変更）。**カタログから外すだけで、`flora.ts` の
      //   `case 'mossRing'` の描画は残してある。** 既存のセーブが遺伝子型に
      //   `mossRing` を持っている可能性があり、描画を消すとその個体の首元が
      //   無地に化けてしまうため。カタログから消えているので、新しく生まれる
      //   個体には二度と出ない。
    ],
  },
  {
    locus: 'feet',
    label: '足',
    alleles: [
      { id: 'none', label: 'なし',     dominance: 4, weight: 38, bases: ['yurei', 'slime'] },
      { id: 'stub', label: 'ちょこあし', dominance: 5, weight: 34 },
      { id: 'paw',  label: 'まるあし', dominance: 4, weight: 20 },
      { id: 'root', label: 'ねっこ',   dominance: 1, weight: 8, notable: true },
    ],
  },
  {
    locus: 'floaters',
    label: '浮遊物',
    alleles: [
      { id: 'none',   label: 'なし',   dominance: 7, weight: 66 },
      { id: 'motes',  label: 'ほこり', dominance: 3, weight: 14 },
      { id: 'orbs',   label: 'たまゆら', dominance: 2, weight: 10, notable: true },
      { id: 'spores', label: 'ほうし', dominance: 1, weight: 4, notable: true },
      // `petals` は製品オーナー判断で新規抽選から撤去。描画側は旧セーブ互換のため残す。
    ],
  },
  {
    locus: 'pattern',
    label: '模様',
    alleles: [
      // 『むじ』が weight 20・dominance 5 で、実測 約7割が無地になっていた
      // （ビジュアル批評 7-4）。装飾「なし」の優性は §11 の意図だが、
      // 模様まで無地に寄ると個体識別が色だけに依存してしまう。
      { id: 'none',     label: 'むじ',     dominance: 4, weight: 12 },
      { id: 'belly',    label: 'はらしろ', dominance: 5, weight: 20, coDominant: true },
      { id: 'spots',    label: 'ぶち',     dominance: 4, weight: 17, coDominant: true },
      { id: 'stripes',  label: 'しま',     dominance: 4, weight: 16, coDominant: true },
      { id: 'speckle',  label: 'こまかい斑', dominance: 4, weight: 13 },
      { id: 'rings',    label: 'わもよう', dominance: 3, weight: 10, notable: true },
      { id: 'veins',    label: 'ようみゃく', dominance: 3, weight: 10, notable: true },
      { id: 'dapple',   label: 'まだら',   dominance: 3, weight: 9, notable: true },
      // ── 眼状紋（めだま模様）は取り下げ ──
      //   製品オーナーの個人プロジェクトから移植した「孔雀風の目玉模様」だが、
      //   **本人の判断で不採用**。カタログから外してある。
      //   `pattern.ts` の `case 'ocelli'` の描画は残してある（既存のセーブが
      //   遺伝子型に `ocelli` を持っている可能性があるため。消すと
      //   その個体の模様が無地に化ける）。`button` 意匠と同じ扱い。
      // ── 牛柄 ──
      // 白地に大きく不規則な塊。境界がなめらかで、左右非対称。
      // 高コントラストなので、小さいサムネイルでも一目で分かる識別子になる。
      // notable は付けない。牛柄は見た目こそ強いが「珍しい形質」ではなく
      // ありふれた毛色の一種で、希少度の加点に乗せると珍しさが安く見える。
      { id: 'cow',      label: 'うしがら', dominance: 3, weight: 9 },
      // ── ヤドクガエル系 4 種 ──
      // 実在のヤドクガエルは「暗い地 × 明るい模様」の高コントラストが美しさの芯。
      // 4 種は模様の作りが根本的に違うので、まとめず別の対立遺伝子にしてある。
      { id: 'dartBand', label: 'たいおび', dominance: 2, weight: 7, notable: true },
      { id: 'dartNet',  label: 'あみめ',   dominance: 2, weight: 7, notable: true },
      { id: 'dartDrop', label: 'したたり', dominance: 2, weight: 6, notable: true },
      { id: 'dartPebble', label: 'つぶいし', dominance: 2, weight: 6, notable: true },
      // ── 星屑 ──
      // 大小の粒がまばらに散り、いくつかは光る。夜空を体に閉じ込めた印象。
      { id: 'stardust', label: 'ほしくず', dominance: 1, weight: 6, notable: true },
      // ── 斑入り ──
      //   製品オーナーの参考資料（斑入り植物の葉）から。`cow`（うしがら）と
      //   骨格は同じ——低周波の波で歪めた不規則な塊・左右非対称・顔を避ける
      //   仕組み・96px でも高コントラストで判別できる——だが、**色が固定の
      //   白ではなく個体の配色から作られる**点が違う。参考の葉は白×緑の
      //   古典的な斑入りだけでなく、桃×緑（カラジウム）もあった。
      //   「珍重される美しい模様」という参考の文脈に合わせ、`cow` とは違い
      //   notable を付ける（`cow` が notable を外している理由＝ありふれた
      //   毛色の一種、とは逆の位置づけ）。
      { id: 'variegate', label: 'ふいり', dominance: 3, weight: 8, notable: true },
    ],
    coExpress: {
      'belly+spots': 'bellySpots',
      'belly+stripes': 'bellyStripes',
      'spots+stripes': 'spotsStripes',
      // 牛柄＋腹白は「白地に塊」を強めるので相性がよい
      'belly+cow': 'bellyCow',
    },
  },
  {
    locus: 'bicolor',
    label: '2色',
    alleles: [
      // 「稀に」が要件なので none を強い優性にしてある。
      { id: 'none',    label: 'なし',       dominance: 6, weight: 66 },
      // 上下でなめらかに色が変わる（空のような）
      // 3 種のうち最も出やすいこれだけ notable を外す。
      // 2 色すべてを希少加点に乗せると、希少度が「色の付きかた」で決まってしまう。
      { id: 'duotone', label: 'ふたいろ',   dominance: 2, weight: 13 },
      // 斜めに色が変わる
      { id: 'diagonal', label: 'ななめぼかし', dominance: 1, weight: 9, notable: true },
      // 体の先端（下端・裾）だけ色が変わる
      { id: 'tipped',  label: 'すそぞめ',   dominance: 1, weight: 8, notable: true },
    ],
  },
  {
    locus: 'lumin',
    label: '発光',
    alleles: [
      // これも「稀に」。none を最も優性にする。
      { id: 'none',   label: 'なし',     dominance: 7, weight: 72 },
      // 体の内側からぼんやり光る
      { id: 'inner',  label: 'うちあかり', dominance: 2, weight: 11, notable: true },
      // 輪郭の外側がにじむ
      { id: 'rim',    label: 'ふちひかり', dominance: 2, weight: 9, notable: true },
      // 模様の粒だけが光る（星屑との相性がよい）
      { id: 'mote',   label: 'つぶあかり', dominance: 1, weight: 8, notable: true },
    ],
  },
  {
    locus: 'texture',
    label: '質感',
    alleles: [
      // 実測で `matte` が 100 体中 44 体。質感 8 種のうち最多が「質感なし」で、
      // 無地の模様と重なると模様も質感も無い個体が量産されていた（ビジュアル批評 T-1）。
      { id: 'matte',   label: 'マット',   dominance: 4, weight: 14 },
      { id: 'jelly',   label: 'ゼリー',   dominance: 4, weight: 20 },
      { id: 'pearl',   label: 'しんじゅ', dominance: 3, weight: 14 },
      { id: 'frost',   label: 'すりガラス', dominance: 3, weight: 13 },
      { id: 'mossy',   label: 'こけ',     dominance: 2, weight: 12 },
      { id: 'mineral', label: 'こうぶつ', dominance: 1, weight: 9, notable: true },
      { id: 'glassy',  label: 'すきとおり', dominance: 1, weight: 8, notable: true },
      // うすぎぬ: ゼリー（厚みのある半透明）とは別に、
      // 「向こうが透けて見える薄い膜」としての半透明。
      // glassy が屈折で光を集めるのに対し、こちらは全体が均一に薄い。
      // notable は付けない。半透明は素材の性質であって珍しさではない。
      { id: 'veil',    label: 'うすぎぬ', dominance: 2, weight: 10 },
    ],
  },
  {
    locus: 'palette',
    label: '配色',
    alleles: [
      // 実測で寒色（くさはら・こけ・しも・みずうみ）が 67%、暖色が 29% に偏り、
      // 100体シートが緑と青の壁になっていた（ビジュアル批評 6-2）。
      // 暖色側の顕性度を揃え、重みを寒色から暖色へ移して 50:50 に近づける。
      { id: 'meadow',  label: 'くさはら', dominance: 4, weight: 9,  coDominant: true },
      { id: 'moss',    label: 'こけ',     dominance: 3, weight: 7,  coDominant: true },
      { id: 'frost',   label: 'しも',     dominance: 4, weight: 8,  coDominant: true },
      { id: 'lagoon',  label: 'みずうみ', dominance: 4, weight: 9,  coDominant: true },
      { id: 'dusk',    label: 'たそがれ', dominance: 4, weight: 12, coDominant: true },
      { id: 'bloom',   label: 'はなびら', dominance: 4, weight: 12, coDominant: true },
      { id: 'coral',   label: 'さんご',   dominance: 4, weight: 13, coDominant: true },
      { id: 'ember',   label: 'おきび',   dominance: 4, weight: 11, coDominant: true },
      { id: 'pearl',   label: 'しんじゅ', dominance: 1, weight: 8, notable: true },
      { id: 'mineral', label: 'こうせき', dominance: 1, weight: 7, notable: true },
      // すみ: 無彩色。彩度をほぼ 0 にした灰色の体。
      // 目・模様・装飾のアクセント色だけが color を持つので、
      // 「一点だけ色がある」強い絵になる。潜性にはせず、たまに出る程度にする。
      { id: 'ash',     label: 'すみ',     dominance: 2, weight: 9, notable: true },
    ],
  },
];

export const CAT_LOCUS_BY_ID: Readonly<Record<CatLocus, CatLocusDef>> = Object.fromEntries(
  CAT_LOCI.map((l) => [l.locus, l]),
) as Record<CatLocus, CatLocusDef>;

export const CAT_LOCUS_IDS: readonly CatLocus[] = CAT_LOCI.map((l) => l.locus);

/** 対立遺伝子 ID → 定義（全遺伝子座を横断）。 */
export function alleleDef(locus: CatLocus, id: string) {
  return CAT_LOCUS_BY_ID[locus].alleles.find((a) => a.id === id);
}

/** 対立遺伝子の日本語ラベル。未知 ID はそのまま返す。 */
export function alleleLabel(locus: CatLocus, id: string): string {
  return alleleDef(locus, id)?.label ?? id;
}

// ─────────────────────────────────────────────────────────
//  数値形質
// ─────────────────────────────────────────────────────────

export const NUM_LOCI: readonly NumLocusDef[] = [
  { locus: 'size',        label: '大きさ',     mean: 0.5,  spread: 0.17 },
  { locus: 'ratio',       label: '縦横比',     mean: 0.5,  spread: 0.16 },
  { locus: 'plump',       label: 'ふくらみ',   mean: 0.52, spread: 0.17 },
  { locus: 'hue',         label: '色相',       mean: 0.5,  spread: 0.3 },
  { locus: 'hueShift',    label: '補助色',     mean: 0.5,  spread: 0.26 },
  { locus: 'sat',         label: '彩度',       mean: 0.5,  spread: 0.2 },
  { locus: 'light',       label: '明度',       mean: 0.52, spread: 0.18 },
  { locus: 'patDensity',  label: '模様の密度', mean: 0.5,  spread: 0.2 },
  { locus: 'patScale',    label: '模様の粗さ', mean: 0.5,  spread: 0.2 },
  { locus: 'translucency',label: '透明感',     mean: 0.34, spread: 0.22 },
  { locus: 'glow',        label: '発光',       mean: 0.28, spread: 0.22 },
  { locus: 'eyeSize',     label: '目の大きさ', mean: 0.5,  spread: 0.16 },
  { locus: 'eyeSpacing',  label: '目の間隔',   mean: 0.5,  spread: 0.15 },
  // 【羽の大きさ — 製品オーナー要望「今の大きさを基準に、最大2.5倍の個体もいるように」】
  //   `glow`/`translucency` と同じ「平均を低めに寄せた」分布にして、
  //   大多数は今までどおりの大きさ・ごく一部だけ大きく育つようにする。
  //   0..1 の生値から実際の倍率（1.0〜2.5倍）への変換は `render/parts/aura.ts`
  //   の `buildWings()` 側で行う（累乗カーブで低い値側に多くの個体を寄せる）。
  { locus: 'wingSize',    label: '羽の大きさ', mean: 0.15, spread: 0.34 },
  { locus: 'asymmetry',   label: '左右差',     mean: 0.26, spread: 0.2 },
  { locus: 'decorAmount', label: '装飾量',     mean: 0.44, spread: 0.2 },
  { locus: 'growthSpeed', label: '成長の速さ', mean: 0.5,  spread: 0.15 },
  { locus: 'healthTend',  label: '健康',       mean: 0.55, spread: 0.15 },
  { locus: 'pEnergy',     label: '活発さ',     mean: 0.5,  spread: 0.22 },
  { locus: 'pAffection',  label: '人なつこさ', mean: 0.5,  spread: 0.22 },
  { locus: 'pCuriosity',  label: '好奇心',     mean: 0.5,  spread: 0.22 },
  { locus: 'pDependence', label: 'あまえ',     mean: 0.5,  spread: 0.22 },
  { locus: 'pAppetite',   label: '食欲',       mean: 0.5,  spread: 0.22 },
  { locus: 'pTidiness',   label: 'きれい好き', mean: 0.5,  spread: 0.22 },
];

export const NUM_LOCUS_BY_ID: Readonly<Record<NumLocus, NumLocusDef>> = Object.fromEntries(
  NUM_LOCI.map((l) => [l.locus, l]),
) as Record<NumLocus, NumLocusDef>;

export const NUM_LOCUS_IDS: readonly NumLocus[] = NUM_LOCI.map((l) => l.locus);

// ─────────────────────────────────────────────────────────
//  突然変異率
// ─────────────────────────────────────────────────────────

export const MUTATION = {
  /** カテゴリ形質 1 座あたりの突然変異率。 */
  catRate: 0.018,
  /** 数値形質 1 座あたりの追加変動が起きる確率。 */
  numRate: 0.06,
  /** 数値形質の通常のゆらぎ（標準偏差、0..1 空間）。 */
  numJitter: 0.045,
  /** 突然変異時の数値の大きな飛び幅。 */
  numLeap: 0.16,
  /** 素体そのものが変わる確率（さらに低くする）。 */
  baseRate: 0.006,
} as const;
