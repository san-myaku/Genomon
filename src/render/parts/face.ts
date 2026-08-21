/**
 * 顔（目・口・頬）。
 *
 * 目の構成:
 *   白目 → 虹彩（薄い陰影と縁取りのある面）→ 目の中の意匠 → ハイライト 1 つ
 *   → 上まぶたの太いインク弧 →（形によって）下まぶた・目尻の線
 *
 * 白目は形ごとにパスを作り、それを clipPath にして虹彩を切り抜く。
 * これで「虹彩が目の形にきれいに収まる」表現になる。
 *
 * 【瞳孔を廃止した経緯 — 3 段階の比較シートを見た製品オーナーの判定】
 *   以前は虹彩の中心に濃い点（瞳孔）を描いていた。点があると、そこが
 *   視線の焦点になる。目を大きくするほど「じっと見つめてくる圧」が増え、
 *   方針の「視線が強すぎない、やわらかい目」と正面から衝突していた。
 *   比較シート（`?eyes=cur|mid|ref`）で瞳孔あり／なしを並べたところ、
 *   **瞳孔なしのほうが表情がやわらかい** という判定が出て採用になった。
 *
 * 【`pupil` 遺伝子座の意味が変わった】
 *   瞳孔が無くなったので、この座は「瞳孔の形」ではなく
 *   **「目の中の意匠」** を指す。ラベル（まるい・つぶら…）は据え置きで、
 *   意味の通る意匠に描き直してある（`motifMarkup`）。
 *   どの意匠も **中心に濃い一点を置かない** のが約束で、
 *   帯・輪・星・花・粒・渦のように「面に載った模様」として描く。
 *
 * 【カートゥーン寄りに層を削った経緯 — 製品オーナーの方針】
 *   以前は 虹彩 → 虹彩の陰 → 虹彩の上明かり → 虹彩の縁 → 瞳 →
 *   大ハイライト → 小ハイライト と 7 層を重ねていた。
 *   実測で目 1 つあたりの描画要素は中央値 11・最大 16。
 *   これは「濡れた眼球」を描く手つきで、
 *     ・小さい表示（96px）ではただの濃い塊に潰れて読めない
 *     ・どの個体も「大きなキラキラ目」に見え、顔の個性が消える
 *     ・人間の眼球に近づき、生きものとしての可愛さから離れる
 *   の 3 つを同時に起こしていた。
 *   陰・上明かり・虹彩の縁・小ハイライトを落とし、**単色の虹彩＋瞳＋
 *   小さなハイライト 1 つ**にする。層ではなく「形」で個体差を作る。
 *
 * 【2026-08 の質感調整】
 *   その判断を守りすぎた結果、引きでの読みやすさは保てても、虹彩が
 *   「単色の円＋白い点」に見える個体が増えた。そこで視線を強くする
 *   瞳孔や過剰な光沢は戻さず、低コントラストの面内グラデーション・
 *   薄い外周・下側の陰だけを共通層として戻す。形質の違いを隠さず、
 *   紙の上に置いた小さな眼球としての奥行きを足すための層である。
 */

import { darken, hexToHsl, hslToHex, mix } from '../../core/color.ts';
import { Rng, clamp, lerp } from '../../core/rng.ts';
import { Z, type DrawCtx, type PartOut } from '../ctx.ts';
import { MOUTH_DOWN_RATIO, MOUTH_UP_RATIO, isSolidEye, isTallSolidEye, type EyeSlot } from './faceLayout.ts';
import {
  boxAround, boxUnion, circle, ellipse, leafPath, n, path, pathOpen, rad, starPath, url, vec,
  type Box, type Vec,
} from '../svg.ts';
import { LASH_SPRITES } from './lashSprites.ts';

/**
 * 目の形ごとの描画スタイル。
 *
 * 【なぜ表にしたか】
 *   7 種の eyeShape が「縦横比が少し違うだけ」だと、100 体並べたときに
 *   全個体が同じ顔に見える（指示書 §29 の不合格条件）。
 *   まぶたの下り・虹彩の比率・目尻・まつげ・傾きまで形ごとに変え、
 *   シルエットの段階で見分けられるようにする。
 */
export interface EyeStyle {
  /** 上まぶたが目を覆う割合 0..1。 */
  lid: number;
  /** まぶたの弧の深さ（大きいほど丸く垂れる）。 */
  lidBow: number;
  /** 虹彩の相対サイズ（白目の半径に対する比）。 */
  irisK: number;
  /**
   * 虹彩の縦横比（1 で真円、>1 で縦長、<1 で横長）。
   *
   * 【なぜ真円だけでは足りないか — 実測】
   *   『たまご』は白目が rx 0.7s / ry 1.0s と縦長で、虹彩は
   *   短いほう（rx）に縛られるため直径 0.95s の小さな円になる。
   *   結果、虹彩の上下に白が 1.0s ずつ残り、`WUYZ-S7QE` `3ZC7-B8YR` は
   *   **白目を剥いて見開いた人間の目** に見えていた。
   *   縦長の目には縦長の虹彩を入れるのがカートゥーンの定石で、
   *   これは新しい描画処理ではなく円 → 楕円のパラメータ 1 つで済む。
   *
   * 【<1（横長）も要る理由 — 同じ問題の裏返し】
   *   『ねむたげ』は白目が rx 1.2s / ry 0.5s の平たい半月で、
   *   虹彩は短いほう（ry）に縛られて直径 0.95s の円になる。
   *   すると **左右に白が 0.7s ずつ残る**。縦長の目で上下に白が残るのと
   *   まったく同じ現象で、見え方も同じ（横目でにらんでいる人間の目）。
   *   平たい目には平たい虹彩を入れる。
   */
  irisAsp: number;
  /** 虹彩の縦位置（ry に対する比）。 */
  irisY: number;
  /**
   * 目の中の意匠の大きさ倍率。1 が標準。
   *
   * 【虹彩と別に持つ理由】
   *   虹彩を大きくすると、その中の意匠もそのまま大きくなる。
   *   意匠が面いっぱいに広がると、どの形の目も「意匠が主役」になって
   *   目の形の違い（この作品の個体差の芯）が読めなくなる。
   *   面の広さ（虹彩の大きさ）と、そこに載る模様の大きさは別の軸で持つ。
   *   とくに『ぱっちり』は、面を広く取ったまま意匠を小さく置くことで
   *   「きょとん／とぼけている」を維持する。
   */
  motifK: number;
  /** 外向きの傾き（度）。 */
  tilt: number;
  /** まつげの長さ倍率（0 で描かない）。 */
  lash: number;
  /** 下まぶたの線を引くか。 */
  lower: boolean;
}

/**
 * 【白目を減らす方向へ振り直した理由 — 製品オーナーの方針】
 *   「白目が大きく見える目は、人間っぽさや不気味さが出やすい」。
 *   実測（成体 200 体）でも、目 1 つのうち白いまま残っている面積は
 *   中央 42.8%・上位 24% が 50% 超で、`A8JM-PBUW` `3ZC7-B8YR` `DBQ2-3FH6`
 *   のように **小さな虹彩を白がぐるりと囲む** 顔が主流だった。
 *   これは人間が驚いたときの目そのもので、生きものの目ではない。
 *   基本を「黒目主体の丸目・点目・小さく単純な虹彩」へ移す。
 *
 * 【それでも一律に大きくしない理由】
 *   虹彩を全形で白目いっぱいまで広げると、今度は全個体が
 *   「大きな黒目でじっと見つめてくる顔」になる。これは
 *   「視線が強すぎない、やわらかく単純な目」の逆で、方針に反する。
 *   ・虹彩の比率は 0.80〜0.96 の帯に散らし、形ごとの詰まり方の差は残す
 *   ・目の中の意匠は `motifK` で別に抑え、面が広くても模様は大きくしない
 *   ・白目そのものも純白をやめる（`palette.ts` の sclera）
 *   の 3 つで「黒目主体だが圧の無い目」にする。
 *
 * 【まつげを大幅に減らした理由】
 *   目尻から外へ伸びる線は、長いと **人間（とくに化粧をした目）**に見える。
 *   いちばん数の多い『まるめ』『たまご』からは落として素の丸い目にし、
 *   つり目・たれ目の芯になる『このは』『ねむたげ』『ぱっちり』にだけ
 *   短い目尻の線として残す。形の情報は保ったまま人間味だけ抜く。
 */
const EYE_STYLE: Record<string, EyeStyle> = {
  // まるめ: 「黒目主体の丸目」。この作品でいちばん数の多い目の基本形。
  round: { lid: 0.08, lidBow: 1.0, irisK: 0.9, irisAsp: 1, irisY: 0.1, motifK: 1, tilt: 4, lash: 0, lower: false },
  // たまご: はっきり縦長。虹彩も同じだけ縦長にして白の余りを詰める。
  oval: { lid: 0.06, lidBow: 1.3, irisK: 0.93, irisAsp: 1.95, irisY: 0.04, motifK: 0.92, tilt: 3, lash: 0, lower: false },
  // ぱっちり: まぶたを下ろさない、いちばん開いた目。
  //
  // 【「少数派として白目を残す」方針を撤回し、面積そのものを削った経緯】
  //   以前はここに irisK 0.68 を置き、コメントで「0.72 まで上げると
  //   『白目がはっきり見える目』という帯が事実上消えるので、少数派として
  //   残すためにこれ以上は上げない」と説明していた。加えて
  //   `R3K4-BJHR` `4UJW-5WXY`（いずれも wide）への「目が怖い」という
  //   指摘には、面積は変えず `scleraFillFor` で白目の **色だけ** を
  //   沈める対応をした。
  //
  //   しかし製品オーナーはこの「少数派としてあえて残す」設計判断そのものを
  //   撤回し、「白目タイプとして意図的に残す方針は撤回。白目面積はもっと
  //   減らして」と明確に指示した。**帯が消えることは今回はむしろ狙い**で、
  //   0.68 → 0.9 まで irisK を引き上げて面積を実際に削っている。
  //
  //   実寸（白目パスの実面積 - 虹彩の楕円面積、s=1 の相対値）で比較すると:
  //     irisK 0.68（旧値） … 白目の見える面積 1.95
  //     irisK 0.90（新値） … 同 0.92（旧値の 47%。半分以下まで削減）
  //   `?only=R3K4-BJHR,4UJW-5WXY&stage=adult&size=large&detail=full&zoom=4`
  //   で実際に描いて確認済み。白目は虹彩を囲む細い縁として残るのみで、
  //   `A8JM-PBUW` のように「小さな虹彩を白がぐるりと囲む」怖さは消えた。
  //
  // 【0 まで削らず、細い縁を残した理由 — 『ぱっちり』の独自性を保つため】
  //   irisK をさらに 1.0 超まで上げると `isTallSolidEye`（たまご）と
  //   同じ「白目なしのべた目」に近づき、7 形あるうちの『ぱっちり』だけの
  //   意匠（まぶたを下ろさず、白い縁がわずかに覗く「きょとん」とした目）が
  //   埋没する。0.9 は白目が「縁の太さ」に収まる帯の中でも面積が小さい側の
  //   値で、形の識別性（他の 6 形との見分け）と「怖くない」の両方を満たす。
  //   `motifK 0.72`（意匠は小さいまま）はそのまま維持し、面が広くなっても
  //   意匠だけが目立って浮くことは無い。
  wide: { lid: 0.0, lidBow: 0.66, irisK: 0.9, irisAsp: 1.02, irisY: 0.05, motifK: 0.72, tilt: 2, lash: 0.5, lower: true },
  // ねむたげ: 平たい半月。虹彩も平たくして左右の白を詰める。
  // 傾きを＋にして目尻を下げる（たれ目）
  sleepy: { lid: 0.3, lidBow: 1.15, irisK: 0.96, irisAsp: 0.6, irisY: 0.08, motifK: 0.88, tilt: 10, lash: 0.45, lower: true },
  // このは: 細くとがる。傾きを−にして目尻を上げる（つり目）
  leaf: { lid: 0.12, lidBow: 0.7, irisK: 0.92, irisAsp: 0.74, irisY: 0.05, motifK: 0.88, tilt: -14, lash: 0.85, lower: false },
  // ほしぞら: 虹彩が広く、瞳が星形。めずらしい形質なので特別さは残す。
  starry: { lid: 0.03, lidBow: 0.9, irisK: 0.9, irisAsp: 1, irisY: 0.08, motifK: 1, tilt: 3, lash: 0, lower: false },
  // したりめ: みかづきと同じ閉じ目の弧を使う（`lid` 以下は描画で参照しない。
  // `drawEye` は crescent と同様に早期リターンする）。傾きだけは強く効く値で、
  // ここを大きくするのが「したり顔」の主要因（もう 1 つの要因＝切り欠きは
  // `drawEye` の smirk 分岐で作る）。
  //
  // 【14（このは）より大きい 22 にした理由】
  //   みかづきは丸め由来の tilt 4 度で「穏やかな閉じ目」。7 形中もっとも
  //   傾いている このは の 14 度と並べても、参考画像ほど「傾いた半月」には
  //   読めなかった（実際に 14 度で描いて見比べ済み）。歪みが目で見て
  //   はっきり分かる帯まで上げる必要があり、22 度でようやく参考画像に近い
  //   斜めの半月になった。左右の目は `dir` で鏡合わせに開くので、
  //   両目とも「外側が上がる」向きに傾く。
  smirk: { lid: 0.08, lidBow: 1.0, irisK: 0.9, irisAsp: 1, irisY: 0.1, motifK: 1, tilt: 22, lash: 0, lower: false },
};

/** 目の形 → 描画スタイル。**まつげの回帰テストからも参照する。** */
export const styleOf = (id: string): EyeStyle => EYE_STYLE[id] ?? EYE_STYLE.round!;

/**
 * ヘテロクロミア（左右で目の色が違う）が出る `asymmetry` のしきい値。
 *
 * 【この値の根拠 — 実測】
 *   `asymmetry` は 0..1 の数値遺伝子だが、実分布は中央 0.26・上限 0.72 で
 *   高い側に薄く伸びる形をしている（4000 体の実測）。
 *     ≧0.44 … 10.2%   ≧0.46 … 7.7%   ≧0.48 … 6.1%   ≧0.50 … 4.6%
 *   目が 2 つ以上ある個体は 90.6% なので、0.46 で **約 7.0%**。
 *   移植元は 15%（さらに希少度条件つき）だったが、
 *   「珍しいからいい」形質なので 5〜10% の帯の真ん中に置いた。
 *   顔まわりの既存のしきい値（`faceLayout` の目の高さ差 0.45、
 *   `drawEye` の傾き 0.5）とも近く、「左右差の強い子」という
 *   ひとつの人格の中に収まる。
 */
const HETERO_MIN = 0.46;

/**
 * その目の虹彩色。ヘテロクロミアの個体では **1 つの目だけ** 色相をずらす。
 *
 * 【新しい遺伝子座を作らない理由】
 *   遺伝がテーマの作品なので、左右差そのものを司っている既存の数値遺伝子
 *   `asymmetry` に乗せるのが筋が通る。カタログにもセーブ形式にも触らずに
 *   済み、しかも **ちゃんと遺伝する**（左右差の強い親からは出やすい）。
 *
 * 【ずらすのが `index === 1` だけである理由 — 目が 3 つの個体の扱い】
 *   目のスロットは 2 つのとき [左, 右]、3 つのとき [左, 右, 額] の順に並ぶ。
 *   `index >= 1` をまとめてずらすと、3 つ目の個体で額の目まで色が変わり
 *   「左 1 色 ／ 右と額で 1 色」という読みにくい絵になる。
 *   逆に額の目だけ変えると、左右の対は揃ってしまって
 *   ヘテロクロミアではなく「第三の目」という別の形質になる。
 *   **左右に並んだ対のうち片方だけ**（`index === 1` かつ中央でない）を
 *   ずらせば、目が 3 つでも「片目だけ色が違う子」として素直に読める。
 *   額の目（`dir === 0`）は必ず基準色のままなので、3 色にはならない。
 *
 * 【色相だけを動かす理由】
 *   明度・彩度を変えると、片目だけ沈む／光る「傷んだ目」になる。
 *   実在のヘテロクロミアも色相（青と茶、青と緑）の違いで、
 *   明るさの違いではない。`hexToHsl` の H だけを回す。
 *
 * 【ずらし幅を 34〜62 度にした理由】
 *   30 度未満だと 96px では「同じ色の塗りムラ」にしか見えず、形質として
 *   読み取れない。90 度を超えると補色に近づいて「作り物の左右色違い」に
 *   なる。左右差が強い個体ほど大きくずれるようにして、
 *   しきい値ちょうどの個体が唐突に色違いにならないようにしてある。
 */
function heteroIris(ctx: DrawCtx, slot: EyeSlot, index: number): string {
  const base = ctx.colors.iris;
  // 目が 1 つの個体では当然発現しない（index === 1 が存在しない）。
  if (index !== 1 || slot.dir === 0) return base;
  const a = ctx.pheno.asymmetry;
  if (a < HETERO_MIN) return base;
  // 実測上限 0.72 で満額になるように正規化する。
  const t = clamp((a - HETERO_MIN) / 0.26, 0, 1);
  const amt = lerp(34, 62, t);
  // 名前付き乱数。`Math.random()` は使わない（同じ個体は毎回同じ絵になる）。
  const dir = ctx.rng('heterochromia').bool() ? 1 : -1;
  const h = hexToHsl(base);
  return hslToHex((h.h + dir * amt + 360) % 360, h.s, h.l);
}

/**
 * 縦長のべた目（白目なし）を塗る色。
 *
 * 引数の `iris` は `heteroIris` を通した **その目の** 虹彩色。
 * ヘテロクロミアの個体では左右で違う値が入る。
 *
 * 【虹彩の色をそのまま使わない理由 — 白目という緩衝材が無くなるから】
 *   白目付きの目では、虹彩と体のあいだに必ず明るい白目が挟まっていた。
 *   べた目ではその緩衝材が消え、目の面が **直接体の色と隣り合う**。
 *   `iris` は既定で明度 40 だが、配色ファミリーが独自の虹彩色を持つと
 *   もっと暗いことも明るいこともある。そのままだと
 *     ・暗すぎる虹彩 × 濃い体  … 目が体に沈んで、顔が「のっぺらぼう」になる
 *     ・暗すぎる虹彩 × 暗テーマ … 目が「顔に開いた 2 つの穴」に見える
 *     ・明るすぎる虹彩          … 白目に戻ってしまい、やった意味が無くなる
 *   の 3 方向に破綻する。明度を 30〜60 の帯へ押し込み、彩度にも下限を置いて
 *   「はっきり色が付いていて、体より濃く、しかし黒ではない面」に揃える。
 *   これで配色ファミリーごとの色の個性は残しつつ、破綻だけを潰せる。
 *
 * 【赤系だけ帯を別に持つ理由 — 実物を並べて特定した「凶悪な目」の正体】
 *   べた目にしたあと、リードが実物を見て
 *   「彩度の高い赤系の配色だと怖い目になる」と指摘した。実測した虹彩は:
 *     `W965-2FBS` H353 S55 L42（緑の体）… 真っ赤な縦長。いちばん悪い
 *     `AMZQ-SLHM` H358 S61 L40（青の体）… 赤黒い一つ目。傷に見える
 *     `GZ7K-KTYK` H343 S60 L42（緑の体）… 同系統
 *     `XQGY-5EKQ` H347 S62 L40 / `J2ER-LEF4` H355 S43 L48 も同じ出方
 *   `tallEyeFill` の旧帯は S 32〜78 / L 30〜60 で、これらは **どれも帯の内側**
 *   ＝ 素通りしていた。500 体の実測では虹彩の色相が赤帯（中心 H358 から
 *   ±30 以内）に入る個体が 88/500 ＝ 17.6% あり、まれな事故ではない。
 *
 * 【効いていたのは「彩度そのもの」より明度との積だった】
 *   彩度だけを下げても（S 78→52 上限）実物はほとんど変わらなかった。
 *   面が縦に細長く大きいので、明度 40 以上の赤は面全体が自発光して見え、
 *   緑・青の体との補色対比でさらに強く出る。
 *   4 段階（S78/L60・S52/L34・S42/L29・S34/L26）を実際に描いて並べたところ、
 *   **S42/L29 で「発光する切れ目」から「濃いワインレッドの目」へ変わった**。
 *   S34/L26 まで落としても見た目はほとんど変わらず、色の個性だけが減る。
 *   寒色（`QJVN-8ZWK` H162 S54 L37）では同じ数値でも起きないので、
 *   絞るのは赤帯だけでよい。
 *
 * 【色相を回さない理由 — 「赤い目を禁止しない」ため】
 *   赤い目そのものは「奇妙だけど可愛い」個性として残す方針。
 *   試しに色相を＋18〜25 回して茶へ寄せた版も描いたが、
 *   `J2ER-LEF4` `WUYZ-S7QE` が **ただの茶色い目**になり、
 *   個体の赤さが消えた。色相は動かさず、彩度と明度だけを落とす。
 *
 * 【連続的に効かせる理由 — 茶・橙を巻き添えにしないため】
 *   赤帯の中心（H358）からの色相距離 d で 0〜1 の重みを作る。
 *   d ≦ 18（H340〜16）は満額、d = 34（H324〜32）で 0。
 *   橙〜茶（H19〜21 帯 ＝ `H2ZT-ATF2` など）は重み 0.7〜0.8 で
 *   「明るい橙」から「濃い茶」へわずかに沈むだけ（この向きは安全側）、
 *   寒色（d > 34 ＝ `QJVN-8ZWK` H162・`VV83-UKFX` H213）は完全に素通りする。
 */
function tallEyeFill(iris: string): string {
  const h = hexToHsl(iris);
  // 赤帯の中心 H358 からの色相距離（0〜180）。
  const d = Math.abs(((h.h - 358 + 540) % 360) - 180);
  const w = clamp((34 - d) / 16, 0, 1);
  // 下限も一緒に下げる。下限だけ据え置くと、もともと沈んだ赤い虹彩が
  // 逆に持ち上げられて、上限を下げた意味が無くなる。
  return hslToHex(
    h.h,
    clamp(h.s, lerp(32, 26, w), lerp(78, 42, w)),
    clamp(h.l, lerp(30, 24, w), lerp(60, 29, w)),
  );
}

/**
 * 白目の塗り色。『ぱっちり』だけ、白そのものを少し沈めて怖さを和らげる。
 *
 * 【2 回目の「怖い」指摘 — 当時は色だけで沈めた理由】
 *   `4UJW-5WXY`「このぱっちりタイプの目が全般的に怖いんだと思う。
 *   白目の面積をもっと減らしたほうがいいのかな」。
 *   当時は『ぱっちり』の白目を方針として **意図的に少数派として残す**
 *   設計だったため、`irisK`（面積）は据え置き、**色だけ**を沈めて対応した。
 *
 * 【3 回目の指摘 — 今回は面積そのものを削った（`EYE_STYLE.wide` 参照）】
 *   製品オーナーが「少数派として残す」方針自体を撤回し、白目の面積を
 *   実際に減らす指示に変わった。`EYE_STYLE.wide.irisK` を 0.68 → 0.9 に
 *   上げて白目の見える面積を半分以下まで削ったので、怖さの主因はすでに
 *   面積側でおおむね解消している。それでも残った細い白の縁がテーマや
 *   配色によっては明るく浮くことがあるため、この色沈めは **面積を削った
 *   上での仕上げ**として残す（面積を削ったので外しても致命的ではないが、
 *   残しても副作用が無く、暗いテーマでの見え方が安定するため維持する）。
 */
function scleraFillFor(shapeId: string, sclera: string): string {
  return shapeId === 'wide' ? darken(sclera, 0.16) : sclera;
}

/** 目の白目にだけ使う、紙の上で沈みすぎない薄い面内陰影。 */
function eyeScleraGradient(ctx: DrawCtx, index: number, base: string): string {
  const id = ctx.defs.add(`eyeSclera${index}`, (gid) =>
    `<linearGradient id="${gid}" x1="0%" y1="0%" x2="0%" y2="100%">` +
    `<stop offset="0%" stop-color="${mix('#fffdf8', base, 0.34)}"/>` +
    `<stop offset="58%" stop-color="${base}"/>` +
    `<stop offset="100%" stop-color="${darken(base, 0.08)}"/>` +
    `</linearGradient>`,
  );
  return url(id);
}

/** 虹彩の共通質感。瞳孔を置かず、中心の柔らかい明るさと周縁の深さだけを出す。 */
function eyeIrisGradient(ctx: DrawCtx, index: number, base: string): string {
  const id = ctx.defs.add(`eyeIris${index}`, (gid) =>
    `<radialGradient id="${gid}" cx="30%" cy="23%" r="86%">` +
    `<stop offset="0%" stop-color="${mix('#fffdf8', base, 0.2)}"/>` +
    `<stop offset="42%" stop-color="${mix(base, '#fffdf8', 0.08)}"/>` +
    `<stop offset="78%" stop-color="${base}"/>` +
    `<stop offset="100%" stop-color="${darken(base, 0.36)}"/>` +
    `</radialGradient>`,
  );
  return url(id);
}

/** 楕円をパス文字列で書く（clipPath と共用するため）。 */
function ellipseD(rx: number, ry: number, cy = 0): string {
  return `M${n(-rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 1 ${n(rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 1 ${n(-rx)} ${n(cy)}Z`;
}

/**
 * 目の白目形状（ローカル座標・中心 0,0）。
 *
 * 制御点は「実際の曲線が ±rx, ±ry をわずかにしか超えない」ように選んである。
 * 3 次ベジエは制御点の 3/4 程度までしか届かないので、
 * 1.3〜1.35 倍の制御点でちょうど ±1.0 の輪郭になる。
 * ここを守らないと bbox が実寸より小さくなり、自動検査（はみ出し判定）が
 * 実際の絵より甘くなってしまう。
 */
function whiteShape(shapeId: string, rx: number, ry: number): string {
  switch (shapeId) {
    case 'leaf':
      // このは: 左右がはっきり尖ったアーモンド。つり目の芯になる形。
      return (
        `M${n(-rx)} ${n(ry * 0.06)}` +
        `C${n(-rx * 0.55)} ${n(-ry * 1.35)} ${n(rx * 0.55)} ${n(-ry * 1.35)} ${n(rx)} ${n(-ry * 0.12)}` +
        `C${n(rx * 0.5)} ${n(ry * 1.3)} ${n(-rx * 0.5)} ${n(ry * 1.3)} ${n(-rx)} ${n(ry * 0.06)}Z`
      );
    case 'wide':
      // ぱっちり: 上辺をやや平らに、下辺を大きく丸く（見開いた印象）
      return (
        `M${n(-rx)} ${n(-ry * 0.1)}` +
        `C${n(-rx * 0.7)} ${n(-ry * 1.32)} ${n(rx * 0.7)} ${n(-ry * 1.32)} ${n(rx)} ${n(-ry * 0.1)}` +
        `C${n(rx * 0.85)} ${n(ry * 1.3)} ${n(-rx * 0.85)} ${n(ry * 1.3)} ${n(-rx)} ${n(-ry * 0.1)}Z`
      );
    case 'sleepy':
      // ねむたげ: 上辺がほぼ水平、下辺だけがゆるく丸い平たい半月
      return (
        `M${n(-rx)} ${n(-ry * 0.5)}` +
        `C${n(-rx * 0.5)} ${n(-ry * 1.3)} ${n(rx * 0.5)} ${n(-ry * 1.3)} ${n(rx)} ${n(-ry * 0.2)}` +
        `C${n(rx * 0.75)} ${n(ry * 1.35)} ${n(-rx * 0.8)} ${n(ry * 1.3)} ${n(-rx)} ${n(-ry * 0.5)}Z`
      );
    default:
      return ellipseD(rx, ry);
  }
}

/**
 * 点目（白目を持たない、**小さな** インク一色の目）。
 *
 * 「まるめ × つぶら」で点目になるのが要点。目の形だけで印象が激変する装置で、
 * これが 1 種も出ていなかったことがビジュアル批評の主要な指摘だった。
 *
 * 【縦長の「べた目」とはっきり分けること — 混同すると両方が死ぬ】
 *   白目を持たない目は、この作品にいま 2 種類ある。
 *     点目   … 意匠『つぶら』で発現。器を 0.5〜0.72 倍に **縮めて** 描く。
 *              色はインク寄りの一色で、意匠は載せない。**小ささが形質**。
 *     べた目 … 目の形が縦長（たまご）のときに発現。器は縮めず、
 *              **意匠の色**で塗って、その上に意匠を載せる（`drawEye` 本体）。
 *   同じ「白目なし」でも、大きさ・色・中身のすべてが逆になっている。
 *   `drawEye` は点目を先に判定するので、たまご × つぶら は点目になる
 *   （縮んだ器に意匠を載せると、どちらの形質も読めなくなるため）。
 *
 * 【色を純黒にしない理由 — 製品オーナーの方針】
 *   面が 1 つしかない目なので、その 1 色が印象のすべてを決める。
 *   `colors.pupil`（明度 14 前後・ほぼ黒）のままだと、白い紙の上では
 *   「開いた穴」に見える。虹彩の色を 3 割混ぜて
 *   「その子の目の色のいちばん濃いところ」にすると、同じ黒っぽさでも
 *   生きものの目に見える。配色ファミリーの個性も点目に乗る。
 */
function drawSolidEye(ctx: DrawCtx, slot: EyeSlot, shapeId: string, iris: string, index: number): string {
  const c = ctx.colors;
  const { rx, ry } = slot;
  const droop = ctx.mood.droop;
  const wd = whiteShape(shapeId, rx, ry);
  const base = mix(c.pupil, iris, 0.3);
  let g = path(wd, {
    fill: eyeIrisGradient(ctx, index, base),
    stroke: c.inkPaint,
    width: ctx.strokeW * 0.78,
    linejoin: 'round',
  });
  // 小さな光を **1 つだけ**。点目の良さは「面が 1 つ」であることなので、
  // 光を 2 つ入れると途端に「つやつやした眼球」に寄る。
  // 色は純白ではなく紙寄りの白（硬い光にしない）。
  g += ellipse(-rx * 0.28, -ry * 0.32, rx * 0.24, ry * 0.24, { fill: '#fffdf8', opacity: 0.82 });
  // 体調が悪い／眠いときは上から潰す（表情が出る仕組みを点目でも殺さない）
  if (droop > 0.3) {
    const cut = ry * 2 * clamp((droop - 0.3) * 0.7, 0, 0.45);
    g += path(
      `M${n(-rx * 1.4)} ${n(-ry * 1.6)}L${n(rx * 1.4)} ${n(-ry * 1.6)}` +
      `L${n(rx * 1.4)} ${n(-ry + cut)}Q0 ${n(-ry + cut - ry * 0.5)} ${n(-rx * 1.4)} ${n(-ry + cut)}Z`,
      { fill: c.body },
    );
  }
  // 虹彩色をわずかに落として「黒目一色」に見えないようにする
  g += ellipse(0, ry * 0.1, rx * 0.42, ry * 0.34, { fill: darken(iris, 0.18), opacity: 0.3 });
  return g;
}

/** 目の中の意匠を描くのに要る色と寸法。 */
interface MotifCtx {
  /** 意匠が載る面の色（虹彩、またはべた目の塗り）。 */
  face: string;
  /** 面より濃い色。**黒ではなく面の色を落としたもの**。 */
  deep: string;
  /** 面より明るい色。ハイライトと同系の、紙寄りの白。 */
  light: string;
  /** ふくがんのガラス面に使う、いちばん濃い色。 */
  glass: string;
  /** 面の横半径・縦半径（面いっぱいに広がる意匠が使う）。 */
  ir: number;
  irY: number;
  /** 意匠の基準半径（面より小さい。`motifK` が効いている）。 */
  s: number;
  /** 意匠の縦位置。 */
  py: number;
  rng: Rng;
}

/**
 * 目の中の意匠（`pupil` 遺伝子座）。
 *
 * 【瞳孔ではなく意匠であることの約束】
 *   瞳孔を廃止したので、ここに **視線の焦点になる濃い一点** を置いてはいけない。
 *   どの種類も「面に載った模様」— 帯・輪・星・花・粒・渦 — として描く。
 *   濃い色を使うときも `deep`（面の色を落としたもの）までで、
 *   インクや黒は使わない。
 *
 * 【96px で潰れないための約束】
 *   線・粒はどれも面の半径の 10% 以上を確保する。
 *   それ未満の点を並べると、小サイズでは「ざらついた汚れ」にしか見えない
 *   （『ほしぞら』の星屑を 5 個 → 3 個に減らしたときと同じ理由）。
 */
function motifMarkup(kind: string, m: MotifCtx): string {
  const { s, py, deep, light, face } = m;
  switch (kind) {
    case 'round':
      // まるい: 無地を保ったまま、中央へごく薄い色の溜まりだけを置く。
      // 濃い一点は置かないので、視線の圧を強めず、単色の円っぽさだけを
      // 解消する。外周の輪と合わせて「虹彩の面」として読ませる。
      return ellipse(0, py + s * 0.08, s * 0.48, s * 0.32, { fill: deep, opacity: 0.14 });

    case 'slit': {
      // たてぼそ: 面を縦に横切るやわらかい帯。
      //
      // 【濃い縦線（旧・瞳孔）から帯へ描き直した理由】
      //   幅の狭い濃い縦線は、生きものの目としては **ヤギ・ヘビ** の記号で、
      //   しかも中心にあるので視線の焦点そのものになる。
      //   幅を広げ、**面の縦半径いっぱい**まで伸ばして上下の縁へ抜けさせると、
      //   「瞳」ではなく「縦に走る模様」として読める。
      //   高さを意匠の基準半径（`s`）ではなく面の縦半径（`irY`）から取るのが要点で、
      //   `s` 基準だと面の中に浮いた縦長の粒になり、結局ヤギの瞳に見えていた。
      //   不透明度を落としてあるので、面の色が透けて濃い塊にならない。
      return ellipse(0, py, s * 0.3, m.irY * 0.96, { fill: deep, opacity: 0.46 });
    }

    case 'ring':
      // わっか: 二重の輪。**中心に点を置かない**（旧実装は中心に芯があった）。
      //
      // 【線を細く・輪を外へ広げた理由 — うずまきと見分けるため】
      //   太い輪を詰めて置くと、同じく渦を巻く『うずまき』と 96px で区別がつかない。
      //   わっかは「細い輪が 2 本、はっきり離れて同心に並ぶ」、
      //   うずまきは「太い線が 1 本つながって巻く」で読み分ける。
      return (
        circle(0, py, s * 0.86, { stroke: deep, width: s * 0.13, opacity: 0.58 }) +
        circle(0, py, s * 0.4, { stroke: deep, width: s * 0.12, opacity: 0.58 })
      );

    case 'sparkle':
      // きらめき: 4 方向に伸びる光の星。明るい色なので焦点にならない。
      return path(starPath(0, py, s * 0.78, s * 0.24, 4, -90), { fill: light, opacity: 0.9 });

    case 'capsule': {
      // カプセル目: 縦長の面を上下で淡く分け、中央に細い光の帯を置く。
      // 濃い一点を置かないので、既存の「たてぼそ」と違って薬のカプセルの
      // ような丸い二色面として読める。
      const h = Math.min(m.irY * 0.92, s * 1.08);
      const w = Math.min(m.ir * 0.64, s * 0.64);
      let g = ellipse(0, py, w, h, { fill: deep, opacity: 0.9 });
      g += path(
        `M${n(-w * 0.92)} ${n(py)}Q0 ${n(py - h * 0.18)} ${n(w * 0.92)} ${n(py)}`,
        { stroke: light, width: Math.max(1.2, s * 0.12), opacity: 0.72 },
      );
      g += ellipse(-w * 0.28, py - h * 0.42, w * 0.2, h * 0.18, { fill: light, opacity: 0.82 });
      return g;
    }

    case 'catEye': {
      // ねこ目: 虹彩を縦長のアーモンドにして、中央を柔らかな縦の切れ目にする。
      // `slit` の帯より細く、外周に面の色を残すことで猫らしい表情を出す。
      const w = Math.min(m.ir * 0.72, s * 0.72);
      const h = Math.min(m.irY * 0.88, s * 0.98);
      let g = path(leafPath(0, py, h * 1.35, w * 1.18, -90, 0.34), { fill: light, opacity: 0.8 });
      g += path(
        `M0 ${n(py - h * 0.74)}Q${n(-w * 0.12)} ${n(py)} 0 ${n(py + h * 0.74)}Q${n(w * 0.12)} ${n(py)} 0 ${n(py - h * 0.74)}Z`,
        { fill: deep, opacity: 0.72 },
      );
      g += path(`M${n(-w * 0.42)} ${n(py - h * 0.38)}Q0 ${n(py - h * 0.66)} ${n(w * 0.42)} ${n(py - h * 0.38)}`, {
        stroke: light,
        width: Math.max(1.1, s * 0.1),
        opacity: 0.85,
      });
      return g;
    }

    case 'petalP': {
      // はなびら: 虹彩に溶ける、ごく薄い5枚の花。
      // 明るい花弁を不透明にすると「目の上に白い部品を貼った」印象になるため、
      // 面の色を主にし、花の存在は近くで初めて分かる程度に留める。
      let g = '';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        g += circle(Math.cos(a) * s * 0.38, py + Math.sin(a) * s * 0.38, s * 0.28, {
          fill: mix(light, face, 0.72),
          opacity: 0.42,
        });
      }
      g += circle(0, py, s * 0.14, { fill: mix(deep, face, 0.56), opacity: 0.2 });
      return g;
    }

    case 'compound': {
      // ふくがん: 暗いガラスのような面いっぱいに、細かい粒がびっしり。
      //
      // 【面いっぱいに広げる理由】
      //   これは「目の中に置いた模様」ではなく **目そのものの材質** で、
      //   小さくまとめると、ただの水玉模様になって虫の目に見えない。
      //   面の縁まで覆い、外側の白目（あれば）を細い縁として残す。
      //
      // 【粒の数を 10 に抑えた理由】
      //   参考にした絵は数十個の粒を打っているが、あれは 512px の絵。
      //   この作品は 96px でも読めることが要件で、粒が面の半径の 1 割を
      //   割ると小サイズでは灰色の靄になる。数を減らして 1 粒を大きくする。
      const { ir, irY, glass, rng } = m;
      let g = ellipse(0, py, ir * 1.02, irY * 1.02, { fill: glass });
      for (let i = 0; i < 10; i++) {
        // 極座標で散らす。同心円状に並ばないよう角度も半径も揺らす。
        const a = ((i + rng.float(0.15, 0.85)) / 10) * Math.PI * 2;
        const rr = Math.sqrt(rng.float(0.05, 0.86));
        const gr = Math.min(ir, irY) * rng.float(0.13, 0.26);
        g += circle(Math.cos(a) * ir * rr, py + Math.sin(a) * irY * rr, gr, {
          fill: light,
          opacity: rng.float(0.3, 0.62),
        });
      }
      // 大きめの粒をひとつ。これが無いと 96px で「黒い穴」に見える。
      g += circle(-ir * 0.34, py - irY * 0.4, Math.min(ir, irY) * 0.3, {
        fill: light,
        opacity: 0.5,
      });
      return g;
    }

    case 'gloss': {
      // つやだま。
      //
      // 【参考ファイルの標準の目を、比率そのままで移したもの】
      //   製品オーナーが用意した `poison_frog_fix_v8_...html` の
      //   `drawSingleEye` の default（normal）が、そのままこの意匠。
      //   向こうは Canvas 2D なので命令列を SVG に置き換えただけで、
      //   **半径と位置の比率は 1 つも変えていない**。
      //
      //     ctx.arc(x - s*0.2, y - s*0.2, s*0.25);   // 光（小）左上
      //     ctx.arc(x + s*0.2, y + s*0.2, sz*0.1);   // 光（大）右下
      //
      //   `s` は向こうの **白目の横半径**、`sz` は体の大きさで `s = sz*0.22`。
      //   したがって `sz*0.1 = s*0.4545` ＝ 右下の光のほうが大きい。
      //   （名前に反して 2 つ目のほうが大きいが、参考の絵がそうなっている。
      //     これが「大きな淡い面＋小さな丸」に見える正体なので、直さない。）
      //
      // 【単位を戻すときの落とし穴 — 実物を見て 1 度直した】
      //   向こうは **白目の半径 `s`** を基準に書いているが、こちらの意匠は
      //   虹彩の半径しか受け取らない。そこで白目の半径に戻してから比率を掛ける。
      //
      //   最初 `u = ir / 0.6` とした。向こうの虹彩が `s*0.6` だからだが、
      //   **これは間違いだった**。こちらは「白目を減らす」作業で虹彩を
      //   白目の 0.9 倍まで大きくしてある。向こうの 0.6 を使うと
      //   `u` が 1.5 倍に膨らみ、光が実寸で 1.5 倍になって
      //   **白が虹彩を食い尽くし、白い玉に色の三日月が乗っただけ**になった。
      //   基準にすべきは「向こうの虹彩」ではなく「白目」なので、
      //   こちらの虹彩と白目の比 0.9 で戻す。
      //   ＝ 比率は写しても、**その比率が何に対する比率か**は写せない。
      //
      // 【色を直値の白のままにしてある】
      //   他の意匠はその子の配色から色を作るが、ここは参考をそのまま写すのが
      //   目的なので `#ffffff` を直値で置く。意匠は白目にクリップされるので、
      //   虹彩からはみ出したぶんは白目の上に乗る（参考も同じ見え方になる）。
      const u = m.ir / 0.9;
      let g = circle(-u * 0.2, py - u * 0.2, u * 0.25, { fill: '#ffffff' });
      g += circle(u * 0.2, py + u * 0.2, u * 0.4545, { fill: '#ffffff' });
      return g;
    }

    case 'button': {
      // ボタン: 濃い円 ＋ 明るいリング ＋ 小さな点 4 つ（縫い付けたボタン）。
      //
      // 【！！このコードは消さないこと！！ — 遺伝子カタログから外れているが現役】
      //   製品オーナーの判断で『ボタン』は不採用になり、リードが
      //   `genetics/loci.ts` の pupil から `button` を **外し済み**。
      //   したがって **新しく生まれる個体にこの意匠は二度と出ない**。
      //   それでも描画を残しているのは、**既存のセーブデータが遺伝子型に
      //   `button` を持っている可能性がある**ため。ここを消すと
      //   `motifMarkup` の default に落ちて `''`（無地）になり、
      //   その子の目が「まるい」と同じ既定の意匠に化ける ＝
      //   プレイヤーから見れば **飼っている個体の見た目が勝手に変わる**。
      //   カタログから消えていることを理由に「もう使われていない死んだコード」と
      //   判断して削除しないこと。
      //
      // 【点 4 つを「糸穴」として残す理由】
      //   濃い円だけだと、それは結局いちばん大きな瞳孔になる。
      //   明るい点が 4 つ規則的に並ぶことで初めて「作り物のボタン」に読め、
      //   生きものの視線ではなくなる。点は明るい色なので焦点にもならない。
      const R = Math.min(m.ir, m.irY) * 0.82;
      let g = circle(0, py, R * 1.06, { stroke: light, width: R * 0.24, opacity: 0.92 });
      g += circle(0, py, R * 0.95, { fill: deep });
      const d = R * 0.3;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        g += circle(dx * d, py + dy * d, R * 0.14, { fill: light, opacity: 0.95 });
      }
      return g;
    }

    case 'swirl': {
      // うずまき: 外から中心へ巻き込む線 1 本。
      //
      // 【線 1 本で描く理由 — この作品の描画規則】
      //   渦は塗りではなく単線で描く。面で描くと「渦巻き模様のシール」になり、
      //   目の中の意匠ではなく体の模様に見えてしまう。
      //   端は丸く、太さは面の 1 割強を確保して 96px でも線として残す。
      const pts: Vec[] = [];
      const turns = 1.55;
      const steps = 20;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = -Math.PI / 2 + t * turns * Math.PI * 2;
        const rr = lerp(0.95, 0.16, t);
        pts.push(vec(Math.cos(a) * s * rr, py + Math.sin(a) * s * rr));
      }
      // 線の太さは面の 18%。これ以上太いと巻きの隙間が埋まり、
      // 「渦」ではなく「濃い円」になる（0.22 で実際にそう見えた）。
      return path(pathOpen(pts), {
        stroke: deep,
        width: s * 0.18,
        opacity: 0.62,
        linecap: 'round',
      });
    }

    case 'batsu': {
      // ばつじるし: 円の中に X 字。花びらのような 4 弁が中心で交差する形。
      //
      // 【参考画像との対応 — docs/screenshots/face/ref/ref-eye-batsu.png】
      //   円（＝面そのもの）の中に、4 枚の弁が中心で交差した X 字が入る。
      //   「気絶」の記号ではなく、他の意匠（はなびら・うずまき…）と同じ
      //   「面に載った模様」の 1 つとして扱う（常時この意匠を持つ個体がいる
      //   という設定のため。`genetics/loci.ts` の batsu のコメント参照）。
      //
      // 【新しい描画機構を増やさない】
      //   花びらの 1 枚 1 枚は、はなびら・ふくがん等でも使っていない
      //   `leafPath`（葉・花弁の共通ヘルパー、`ears.ts` や `flora.ts` の
      //   植物パーツと同じ関数）をそのまま流用する。X の腕を 1 枚ずつ塗る
      //   だけで、意匠専用の新しい図形処理は増えていない。
      //
      // 【縦横ではなく対角（45°刻み）に向ける理由】
      //   弁を上下左右へ向けると「＋」（プラス）に見え、X にならない。
      //   対角へ向けてはじめて参考画像どおりの X 字になる。
      //
      // 【`light` ではなく `deep` にした理由】
      //   『はなびら』はすでに `light`（明るい面）4〜5 枚の花で、同じ色を
      //   使うと 96px では意匠の見分けが付かなくなる。参考画像も濃い色の
      //   X なので、`deep`（面の色を落としたもの。黒でもインクでもない）
      //   で塗って『はなびら』とはっきり読み分ける。
      // 旧実装の4枚の花弁は中心で重なり、縮小時に細く尖った「バツ」へ
      // 潰れていた。丸い端点を持つ太い2本の曲線にして、面の中で読める
      // やわらかな X にする。
      // 腕を短く、端を丸く太くする。細長いXではなく、眼の面に沈む
      // ぷっくりした「ばつ」の印として読める比率。
      const a = s * 0.5;
      const bend = s * 0.1;
      const width = Math.max(3.6, s * 0.38);
      let g = path(
        `M${n(-a)} ${n(py - a)}Q${n(-bend)} ${n(py - bend)} ${n(a)} ${n(py + a)}`,
        { stroke: deep, width, linecap: 'round', linejoin: 'round', opacity: 0.94 },
      );
      g += path(
        `M${n(-a)} ${n(py + a)}Q${n(bend)} ${n(py + bend)} ${n(a)} ${n(py - a)}`,
        { stroke: deep, width, linecap: 'round', linejoin: 'round', opacity: 0.94 },
      );
      // 4 枚がちょうど点で接するだけだと、96px では中心に小さな穴が
      // 開いた十字に見える。中心を同じ色で軽く埋めて 1 つの X に見せる。
      g += circle(0, py, s * 0.22, { fill: deep });
      return g;
    }

    default:
      return '';
  }
}

/** 角の尖りを丸めた星。小さな目の中でも三角形に潰れない。 */
function roundedStarPath(cx: number, cy: number, rOuter: number, rInner: number, spikes: number, rot = -90): string {
  const pts: Vec[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = ((rot + (i * 360) / (spikes * 2)) * Math.PI) / 180;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  const midpoint = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 });
  let d = `M${n(midpoint(pts[pts.length - 1]!, pts[0]!).x)} ${n(midpoint(pts[pts.length - 1]!, pts[0]!).y)}`;
  for (let i = 0; i < pts.length; i++) {
    const next = pts[(i + 1) % pts.length]!;
    const end = midpoint(pts[i]!, next);
    d += `Q${n(pts[i]!.x)} ${n(pts[i]!.y)} ${n(end.x)} ${n(end.y)}`;
  }
  return `${d}Z`;
}

/** 3 次ベジェ曲線上の y 座標。まつ毛の付け根を輪郭に合わせるために使う。 */
function cubicY(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** 2 次ベジェ曲線上の y 座標。 */
function quadraticY(t: number, p0: number, p1: number, p2: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

/** 白目（点目ならその面）の上側輪郭上の y 座標。**テストからも参照する。** */
export function upperContourY(shapeId: string, rx: number, ry: number, x: number): number {
  const t = clamp((x + rx) / (2 * rx), 0, 1);
  switch (shapeId) {
    case 'leaf':
      return cubicY(t, ry * 0.06, -ry * 1.35, -ry * 1.35, -ry * 0.12);
    case 'wide':
      return cubicY(t, -ry * 0.1, -ry * 1.32, -ry * 1.32, -ry * 0.1);
    case 'sleepy':
      return cubicY(t, -ry * 0.5, -ry * 1.3, -ry * 1.3, -ry * 0.2);
    default: {
      const nx = clamp(x / rx, -1, 1);
      return -ry * Math.sqrt(Math.max(0, 1 - nx * nx));
    }
  }
}

/** 点目で眠たげに上から覆われたときの、実際に見える上辺。 */
function solidUpperY(rx: number, ry: number, shapeId: string, droop: number, x: number): number {
  if (droop <= 0.3) return upperContourY(shapeId, rx, ry, x);
  const cut = ry * 2 * clamp((droop - 0.3) * 0.7, 0, 0.45);
  const base = -ry + cut;
  const w = rx * 1.4;
  const t = clamp((x + w) / (2 * w), 0, 1);
  return quadraticY(t, base, base - ry * 0.5, base);
}

/** みかづき／したりめの弧上の y 座標。 */
function closedUpperY(rx: number, ry: number, x: number): number {
  const w = rx * 1.08;
  const h = ry * 1.5;
  const t = clamp((x + w) / (2 * w), 0, 1);
  return quadraticY(t, h * 0.3, -h * 1.15, h * 0.3);
}

/**
 * 白目の **下側の輪郭** 上の y 座標。下まつ毛を目の下辺へ合わせるのに使う。
 *
 * 【2026-08-15 `whiteShape` の実際の曲線に合わせ直した — レビュー B-1 の原因】
 *   以前は ねむたげ・このは を 2 次式で近似していたが、実際に描かれている
 *   下辺（`whiteShape` の 2 本目の C コマンド）より **かなり内側** だった。
 *     ねむたげ … 近似の最下点 0.65ry / 実際 0.91ry
 *     このは   … 近似の最下点 0.82ry / 実際 0.94ry
 *   下まつ毛の付け根がこのぶんだけ目の中へ入り、とげが虹彩の上に並んで
 *   **歯** のように見えていた。ここは `whiteShape` と対になる値なので、
 *   あちらを変えたらこちらも合わせること。
 *   下辺の C は右端 → 左端の向きに引かれているので `t` も右から数える。
 */
function lowerContourY(shapeId: string, rx: number, ry: number, x: number): number {
  // 閉じ目は弧そのものがインク。中心線を返し、線幅ぶんは呼び出し側で足す。
  if (shapeId === 'crescent' || shapeId === 'smirk') return closedUpperY(rx, ry, x);
  const t = clamp((rx - x) / (2 * rx), 0, 1);
  if (shapeId === 'sleepy') return cubicY(t, -ry * 0.2, ry * 1.35, ry * 1.3, -ry * 0.5);
  if (shapeId === 'leaf') return cubicY(t, -ry * 0.12, ry * 1.3, ry * 1.3, ry * 0.06);
  if (shapeId === 'wide') return cubicY(t, -ry * 0.1, ry * 1.3, ry * 1.3, -ry * 0.1);
  return ry * Math.sqrt(Math.max(0, 1 - Math.pow(clamp(x / rx, -1, 1), 2)));
}

function lidValue(st: EyeStyle, droop: number): number {
  return clamp(st.lid + droop * 0.36, 0, 0.8);
}

/** 上まぶたの見えている下辺上の y 座標。まぶたが無ければ null。 */
function upperLidY(rx: number, ry: number, st: EyeStyle, lid: number, x: number): number | null {
  if (lid <= 0.015) return null;
  const bow = st.lidBow;
  const yc = -ry + ry * 2 * lid;
  const sag = Math.min(
    rx * lerp(0.1, 0.18, clamp((bow - 0.66) / 0.64, 0, 1)),
    Math.max(0, (ry - yc) * 0.42),
  );
  const yMid = yc + sag;
  const yEdge = yc - ry * (0.3 + 0.2 * bow);
  const cpy = (8 * yMid - 2 * yEdge) / 6;
  const w = rx * 1.34;
  const t = clamp((x + w) / (2 * w), 0, 1);
  return cubicY(t, yEdge, cpy, cpy, yEdge);
}

/**
 * まつげを載せる線＝**その目の「上のインク」の下辺**。
 *
 * 【2026-08-15 目の外周から、インクの下辺へ変更した — レビューでの指摘】
 *   それまでは目の外周（`upperContourY`）を基準にしていた。つまりまつげは
 *   **目の外の地肌の上に、目とは接しないで置かれていた**。その結果:
 *     ・みかづき／したりめ … 弧の上に黒い塊が浮き、白いつやが目に見えて
 *       「まつげ」ではなく **黒い動物** に読めた（レビュー A-1）
 *     ・ねむたげ／このは … 元から太いまぶたのインクの **上に** さらに
 *       同じ大きさの塊が積み上がり、上半分が黒い「ヘルメット」になった（A-2）
 *   絵として正しいのは「まぶたの線とまつげがひとつながりの塊になり、
 *   その **外側の輪郭がまつげの形** になる」置きかた。そのためには
 *   まつげの下辺をインクの下辺に合わせ、**インクへ重ねる**必要がある。
 *   こうすると黒い面積は「まぶた＋まつげ」ではなく「まつげ」だけになり、
 *   浮きも塊化も同時に消える。
 *
 * 【`droop` に追従するようになった副次効果 — レビュー B-2】
 *   まぶたの下辺は `lidValue(st, droop)` で下りてくるので、基準線を
 *   ここにすると **まつげも一緒に下りる**。以前は目の外周が基準で
 *   `droop` を含まなかったため、元気のない個体ではまぶたのインクだけが
 *   下りてまつげを飲み込み、まつげが消えていた。
 */
export function lashBaseY(
  ctx: DrawCtx,
  shapeId: string,
  st: EyeStyle,
  rx: number,
  ry: number,
  x: number,
): number {
  if (shapeId === 'crescent' || shapeId === 'smirk') {
    // 閉じ目は太い弧そのものがインク。その **下辺** に載せる
    // （弧は中心線なので、線幅の半分だけ下げたところが下辺）。
    return closedUpperY(rx, ry, x) + ctx.strokeW * 0.575;
  }
  if (isSolidEye(ctx.parts)) {
    // 点目は面全体がインク。上端に重ねる。
    return solidUpperY(rx, ry, shapeId, ctx.mood.droop, x);
  }
  if (isTallSolidEye(shapeId)) {
    // 【たまご（べた目）だけ まぶたの線を基準にしない — レビュー第2ラウンド】
    //   たまごは **白目を持たない**。器の中はまるごと濃い虹彩で、インクとの
    //   明度差は実測 1.2〜1.8:1（1.0 で同色）しかない。ここでまぶたの線
    //   （器の内側にある）を基準にすると、まつげのうち器に重なった部分が
    //   **色が同じで消え**、器からはみ出した細い毛だけが残る。製品オーナーの
    //   「目と離れている／原画ほどのクオリティが無い」はこれが原因だった。
    //   器の **外周リング** に載せて、まつげ本体を地肌の上（コントラスト
    //   4〜6.7:1）に置く。原画の帯がそのまま読めるようになる。
    return upperContourY(shapeId, rx, ry, x) + ctx.strokeW * 0.41;
  }
  const lid = lidValue(st, ctx.mood.droop);
  return (
    upperLidY(rx, ry, st, lid, x) ??
    // まぶたを下ろさない形（ぱっちり）は、輪郭リングそのものが上のインク。
    upperContourY(shapeId, rx, ry, x) + ctx.strokeW * 0.5
  );
}

/**
 * 傾きを制限した基準線。`xa` を動かさない点として、そこから左右へ
 * 「1 歩あたり `maxSlope` まで」しか上下しない折れ線を積み上げる。
 *
 * 【一律の上限（`tanh` で頭打ち）をやめた理由】
 *   以前はしなり量そのものに上限を置いていた。しかしこれは
 *     ・弧が急な目（みかづき）… 追従しきれず **浮く**
 *     ・縦長の目（たまご）… 端で輪郭が垂直に落ちるので **回り込む**
 *   の両方を同時には解決できない。上限を上げれば囲いになり、
 *   下げれば浮く、というトレードオフの正体は「しなりの大きさ」ではなく
 *   **傾き**（どれだけ急に降りるか）だった。
 *   ・まぶたに貼り付いて見えるかどうか → 追従できているか
 *   ・目を囲って見えるかどうか       → 横から下へ回り込む急さ
 *   なので、制限すべきは傾きのほう。こうすると みかづきの弧
 *   （中央付近はゆるやか）は最後まで追従でき、たまごの端
 *   （垂直に落ちる）だけが頭打ちになる。
 */
function slopeLimited(
  edge: (x: number) => number,
  x0: number,
  x1: number,
  xa: number,
  maxSlope: number,
): (x: number) => number {
  const N = 33;
  const step = (x1 - x0) / (N - 1);
  if (!(step > 0)) return () => edge(xa);
  const xs: number[] = [];
  for (let i = 0; i < N; i++) xs.push(x0 + step * i);
  let ai = 0;
  for (let i = 1; i < N; i++) if (Math.abs(xs[i]! - xa) < Math.abs(xs[ai]! - xa)) ai = i;
  const ys: number[] = new Array(N).fill(0);
  const lim = maxSlope * step;
  ys[ai] = edge(xs[ai]!);
  for (let i = ai + 1; i < N; i++) {
    ys[i] = ys[i - 1]! + clamp(edge(xs[i]!) - edge(xs[i - 1]!), -lim, lim);
  }
  for (let i = ai - 1; i >= 0; i--) {
    ys[i] = ys[i + 1]! + clamp(edge(xs[i]!) - edge(xs[i + 1]!), -lim, lim);
  }
  return (x: number): number => {
    const t = clamp((x - x0) / step, 0, N - 1);
    const i = Math.min(N - 2, Math.floor(t));
    return lerp(ys[i]!, ys[i + 1]!, t - i);
  };
}

/**
 * 原画自身の反りを 2 次式（最小二乗）で近似する。
 *
 * 【生の折れ線を使わない理由】
 *   `profBot` の両端は、本体ではなく **尾や先端のとげ** の位置になっている
 *   （`tools/genLashSprites.mjs` が幅 4% の窓で上下端を拾うため）。
 *   これをそのまま「原画自身の反り」として差し引くと、尾やとげだけが
 *   逆向きに引っぱられて形が崩れる。知りたいのは「この原画は全体として
 *   どれだけ反っているか」なので、2 次式に落として先端の暴れを捨てる。
 */
const spriteArcCache = new Map<readonly number[], [number, number, number]>();
function spriteArcOf(prof: readonly number[]): (u: number) => number {
  let co = spriteArcCache.get(prof);
  if (!co) {
    const N = prof.length;
    if (N < 3) {
      co = [N ? prof[0]! : 0, 0, 0];
    } else {
      // y = a + b u + c u^2 の正規方程式を、u の冪和から直接解く。
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const y = prof[i]!;
        const u2 = u * u;
        s0 += 1; s1 += u; s2 += u2; s3 += u2 * u; s4 += u2 * u2;
        t0 += y; t1 += y * u; t2 += y * u2;
      }
      // 3x3 をクラメルの公式で解く
      const det =
        s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
      if (Math.abs(det) < 1e-12) {
        co = [t0 / N, 0, 0];
      } else {
        const da =
          t0 * (s2 * s4 - s3 * s3) - s1 * (t1 * s4 - t2 * s3) + s2 * (t1 * s3 - t2 * s2);
        const db =
          s0 * (t1 * s4 - t2 * s3) - t0 * (s1 * s4 - s3 * s2) + s2 * (s1 * t2 - s2 * t1);
        const dc =
          s0 * (s2 * t2 - s3 * t1) - s1 * (s1 * t2 - s2 * t1) + t0 * (s1 * s3 - s2 * s2);
        co = [da / det, db / det, dc / det];
      }
    }
    spriteArcCache.set(prof, co);
  }
  const [a, b, c] = co;
  return (u: number): number => {
    const t = clamp(u, 0, 1);
    return a + b * t + c * t * t;
  };
}

/**
 * まつげの置きかた。原画（`LASH_SPRITES`）は「片目ぶんのまつげ」1 枚として
 * 描かれているので、遺伝子の種類ごとに **どの原画を・どれだけの大きさで・
 * どこに** 置くかだけを決めればよい。
 *
 *   sprite  : `LASH_SPRITES` のキー
 *   outerAt : **原画のどこが目尻に当たるか**（インク幅に対する比 0..1）。
 *             原画は「本体が目をまたぎ、その先の枝分かれが目尻からはみ出す」
 *             構図で描かれている。全体幅を目の幅に合わせてしまうと枝分かれが
 *             目の上に乗ってしまうので、**本体の終わり**を目尻に合わせる。
 *             ここより右（＝1 との差）が目尻からのはみ出しになる。
 *   anchor  : まぶたへ合わせる基準線に、原画の上端(`top`)と下端(`bot`)のどちらを使うか。
 *             上まつ毛は下端をまぶたに載せる。とじ目型（下まつ毛・おねむ）は
 *             上端を目のふちに合わせて、とげを内側へ垂らす
 *   shiftX  : 置き始めを目頭からどれだけずらすか（rx 比。負で内側へ食い込む）
 *   shiftY  : 基準線の上下微調整（ry 比。正で下＝瞳側）
 *   lower   : 下まぶた側に置くか
 */
interface LashPlacement {
  sprite: string;
  outerAt: number;
  shiftX: number;
  /**
   * まぶたのインクの下辺へ、まつげの下辺をどれだけ **沈める** か。
   * 0 でちょうど接する。正の値でインクの中へ食い込み、まつげとまぶたが
   * ひとつながりの塊になる（＝黒い面積が増えない）。
   */
  sink: number;
  /**
   * まつげのインクの高さの上限（ry 比）。指定すると、幅から決めた倍率が
   * これを超える場合に全体を縮める。
   *
   * 【下まつ毛にこれが要る理由】
   *   倍率を **幅だけ** から決めると、横長の目（このは・ねむたげ）では
   *   `ry` が小さいのに まつげは目の幅なりに大きくなる。下まつ毛の原画は
   *   「帯＋下向きのとげ」なので、背が高すぎると帯が目の中へ入り、
   *   とげが虹彩の上に並んで **歯** に見える。逆に沈めて隠すと、
   *   とげの先だけが飛び飛びに覗いて **点線** になる。
   *   高さそのものを目の高さで抑えるのが正しい。
   */
  maxH?: number;
  /** 全体の大きさ倍率。1 で「本体の終わりが目尻に届く」大きさ。 */
  sizeK?: number;
  lower?: boolean;
}

/**
 * 【2026-08-15 まつげを原画スプライトに置き換え — 製品オーナーの指示】
 *   「別添を素材にいい感じにできない？」という指示とともに
 *   `art/eyelashes_sprite.svg`（8 種のまつげの原画）を受け取った。
 *
 *   それまでは同じ日に 2 度、手続き的な作図で参考イメージに寄せようとして
 *   いた（版1: 棘の束／版2: 太さの変わる 1 本の帯）。版2 は 5 周ぶん調律
 *   しても「ちょっとは良くなったけど、まだ微妙」という評価だった。
 *   **近似をやめて原画そのものを使う。**
 *
 *   原画の 8 種のうち 7 種が既存の対立遺伝子とそのまま 1 対 1 で対応する
 *   （`07_droopy` だけが余り。対立遺伝子を増やすかは製品オーナーの判断待ち
 *   なので、いまはカタログに足していない＝描かれない）。
 *
 *   手続き的な作図では出せなかったのに原画にはあった要素:
 *     ・先端の **枝分かれ（プロング）** が 2〜3 本ある種類がある
 *     ・まつげの上に **白いつやの点** が乗る
 *   どちらも「1 本の帯」を数式で作る方式では表現できていなかった。
 */
const LASH_PLACEMENT: Readonly<Record<string, LashPlacement>> = {
  short:    { sprite: '01_short',         outerAt: 0.84, shiftX: -0.04, sink: 0.30 },
  mid:      { sprite: '02_slightly_long', outerAt: 0.80, shiftX: -0.04, sink: 0.30 },
  long:     { sprite: '03_long',          outerAt: 0.80, shiftX: -0.04, sink: 0.30 },
  sideLong: { sprite: '04_side_long',     outerAt: 0.78, shiftX: 0,     sink: 0.30 },
  upper:    { sprite: '05_upper_only',    outerAt: 0.90, shiftX: -0.04, sink: 0.30 },
  droopy:   { sprite: '07_droopy',        outerAt: 0.86, shiftX: -0.04, sink: 0.30 },
  // おねむ: **目の下** に付ける。
  //
  // 【上まぶたから下へ移した理由 — 製品オーナーの指摘 4 件】
  //   原画は「とげが下へ垂れた」構図で、上まぶたに置くと目の上を横切る
  //   横棒に見えていた。2026-08-16 に 4 個体で「目の下のほうがいい」と
  //   指摘があり、いずれも手で **目の高さぶん（上まぶた→目の下）** 下げて
  //   あった（`7HWU-CD8Q` +41.5、`NL7X-XFNK` +23.1、`WBF4-HRWG` +10.8、
  //   `LD9V-5F8V` +40.5。どれも目の上端から下端の外へ移す量）。
  //   下まつげ（`lower`）と同じ土台に載せ、原画だけ おねむ のものを使う。
  sleepy:   { sprite: '08_sleepy',        outerAt: 0.94, shiftX: -0.02, sink: 0.04, sizeK: 0.88, maxH: 0.34, lower: true },
  // 下まつげ: 短くして目のふちに寄せる。長いままだと下向きのとげが
  // 目から離れて **虫の脚** に見えた（レビュー B-1）。
  //   `maxH` で背丈を目の高さの 32% に抑えるのが要点。抑えないと、横長の目
  //   （このは・ねむたげ）で帯が目の中へ入って **歯** に見え、それを沈めて
  //   隠すと今度はとげの先だけが飛び飛びに覗いて **点線** になる。
  lower:    { sprite: '06_lower_only',    outerAt: 0.94, shiftX: -0.02, sink: 0.04, sizeK: 0.9, maxH: 0.32, lower: true },
};

/**
 * まつげが目の側面へ回り込んでよい急さの上限（dy/dx）。
 * これを超える傾きの区間では、まつげはまぶたの線に追従するのをやめる。
 * 大きくすると縦長の目（たまご）で「囲い」になり、
 * 小さくすると弧の急な目（みかづき）で浮く。
 */
// 崖（上記 `edgeHold`）を取り除いたので、ここは「目のドームにどこまで沿うか」
// だけを決める値になった。まるめの目はふち近くで傾き 2 前後まで上がるので、
// 1.15 では途中で追従をやめてしまう。縦長の目（たまご）はさらに急なので、
// そちらは引き続きここで頭打ちになり、側面へ回り込まない。
const LASH_MAX_SLOPE = 2.4;

/** 点の集まりを囲む矩形。まつげのように矩形で表せない絵の bbox に使う。 */
function boxOfPoints(pts: readonly Vec[]): Box | undefined {
  if (!pts.length) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of pts) {
    if (q.x < x0) x0 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.x > x1) x1 = q.x;
    if (q.y > y1) y1 = q.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** まつげ 1 枚の描画結果。`probes` は目のローカル座標での輪郭上の点。 */
interface LashOut {
  svg: string;
  probes: readonly Vec[];
}

const NO_LASH: LashOut = { svg: '', probes: [] };

/**
 * ローカル座標の点列を `translate(cx cy) rotate(deg)` で親の座標系へ移す
 * （目のグループは形ごとに傾いているため）。
 */
function rotatePointsAt(pts: readonly Vec[], cx: number, cy: number, deg: number): Vec[] {
  const a = rad(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return pts.map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

/**
 * その種類のまつげが「下まつげ」か（目の下辺を基準に置くか）。
 * **テストからも参照する** — どの対立遺伝子が下側かは
 * `LASH_PLACEMENT` が正本で、テストに同じ一覧を書き写すと必ずずれる。
 */
export const isLowerLash = (kind: string): boolean =>
  !!LASH_PLACEMENT[kind === 'lash' ? 'short' : kind]?.lower;

/** 目の形にかかわらず、まつ毛を実際のまぶたのインクへ接続する。 */
function drawLashes(
  ctx: DrawCtx,
  slot: EyeSlot,
  shapeId: string,
  st: EyeStyle,
  lashRoom: number,
  /** 目のグループの回転（度）。体の輪郭と突き合わせるのに要る。 */
  tiltDeg: number,
): LashOut {
  const kind = ctx.parts.lashes;
  if (!kind || kind === 'none' || lashRoom <= 0.5) return NO_LASH;

  const style = kind === 'lash' ? 'short' : kind;
  const place = LASH_PLACEMENT[style];
  if (!place) return NO_LASH;
  const sprite = LASH_SPRITES[place.sprite];
  if (!sprite) return NO_LASH;

  const { rx, ry, dir } = slot;
  const mirror = dir === 0 ? 1 : dir;

  // まつげを載せる基準線＝**まぶたのインクの下辺**（`lashBaseY` の説明を参照）。
  // 下まつげは目の下のインクの外辺。
  const rawBase = (x: number): number =>
    place.lower
      ? lowerContourY(shapeId, rx, ry, x) + ctx.strokeW * 0.5
      : lashBaseY(ctx, shapeId, st, rx, ry, x);
  // `x` は mirror を掛ける前の座標。輪郭は左右非対称な形（このは・ねむたげ）が
  // あるので、実際の目のどちら側かに合わせて引く。
  //
  // 【目の幅の外では、ふちの高さを保つ — 2026-08-16「目とまつげのカーブが
  //   合っていない」6 件の原因】
  //   `upperContourY` は |x| ≧ rx で **0（目の縦中心）** を返す。まつげは
  //   目尻の外へも伸びるので、そこで基準線が `-ry` から `0` へ **崖のように
  //   落ちる**。`slopeLimited` はこの崖をならすのに傾きの許容量を使い切って
  //   しまい、肝心の「目のドームに沿う」ぶんが残らなかった。
  //   結果、まるめ・ほしぞらでまつげが目の上に浮いて見えていた。
  //   目の幅の外は、ふちの高さのまま伸ばす（崖を無くす）。
  //   保つ位置は「目のインクが実際にどこまであるか」。閉じ目の弧は
  //   `closedUpperY` が `w = rx * 1.08` の範囲で引かれていて、しかも
  //   その外では自分で値を保つ（崖にならない）。0.9rx で止めると弧の
  //   いちばん急に下りるところで追従をやめてしまい、目尻側で離れていた。
  const closedEye = shapeId === 'crescent' || shapeId === 'smirk';
  const edgeHold = rx * (closedEye ? 1.08 : 0.9);
  const baseAt = (x: number): number =>
    rawBase(clamp(mirror * x, -edgeHold, edgeHold));

  // ── 大きさ ────────────────────────────────────────────────
  //   原画は「幅 1」に正規化されていて、実際のインクは box.x0〜box.x1 に載る。
  //   縦横は同じ倍率で拡大する（別々に伸ばすと、縦長の目・平たい目で
  //   原画の線が歪み、手描きの筆致が台無しになる）。
  //
  //   倍率は「原画の `outerAt` の位置が、目尻にちょうど重なる」ように決める。
  //   全体幅を目の幅に合わせると、目尻からはみ出すはずの枝分かれが目の上に
  //   乗ってしまう（最初にそう実装して、実際にそう見えた）。
  const inkW = sprite.box.x1 - sprite.box.x0;
  if (inkW <= 0 || place.outerAt <= 0) return NO_LASH;
  const spanL = -rx + place.shiftX * rx;
  const spanC = (spanL + rx) / 2;
  let scale = ((rx - spanL) / (place.outerAt * inkW)) * (place.sizeK ?? 1);

  // 目尻からのはみ出しは、体の輪郭までの余白に収める。越える場合は
  // まつげ全体を縮める（原画の形は保ったまま小さくなる）。
  const rightOf = (s: number): number => spanC + inkW * s * (1 - place.outerAt / 2);
  if (rightOf(scale) - rx > lashRoom) {
    const fit = (rx + lashRoom - spanC) / (inkW * (1 - place.outerAt / 2));
    if (!(fit > 0)) return NO_LASH;
    scale = Math.min(scale, fit);
  }
  // 高さの上限（下まつ毛用。`maxH` の説明を参照）
  //
  // 【閉じ目にも高さの上限が要る — 2026-08-16「カーブが合っていない」】
  //   みかづき・したりめは **細い弧 1 本** が目のすべて（線幅 strokeW×1.15）。
  //   原画の帯はその 4 倍ほど厚く、そのまま載せると弧を置き換えてしまい、
  //   両端の枝分かれだけが外へ飛び出して「脚の生えた別の生きもの」に見える。
  //   弧に添える細いまつげとして読める高さまで抑える。
  const inkH = sprite.box.y1 - sprite.box.y0;
  const maxH = closedEye ? Math.min(place.maxH ?? Infinity, 1.3) : place.maxH;
  if (maxH !== undefined && Number.isFinite(maxH) && inkH > 0) {
    scale = Math.min(scale, (maxH * ry) / inkH);
  }
  if (inkW * scale < 2) return NO_LASH;

  // ── 位置 ──────────────────────────────────────────────────
  // 置き始めと倍率は `buildAt` の中で決める（輪郭に収まるまで縮めるため、
  // 倍率が確定するのは最後）。しならせる基準の x だけはここで固定する。
  const anchorX = spanC;

  // ── まぶたの線に合わせてしならせる ──────────────────────────
  //
  // 【なぜ「拡大して置く」だけでは足りないか — 実測して分かった】
  //   原画の弧は、目のドームよりずっと浅い。原画の下辺は中央から端まで
  //   幅の 13% ほどしか下がらないのに対し、目のふちは半幅ぶん進む間に
  //   `ry` まるごと下がる。中央で合わせると **両脇が上へ浮く**。
  //
  //   原画を縦だけ引き伸ばすと手描きの線が歪むので、代わりに
  //   **各点をまぶたの曲線ぶんだけ縦にずらす**（＝原画をしならせる）。
  //   移すのは（まぶたの曲がり）−（原画自身の反り）の **差分だけ**。
  //   両者の曲率が合っていれば差は 0 になり、原画は変形しない。
  //
  //   差分をそのまま全部与えると縦長の目で側面へ回り込むので、
  //   基準線のほうを `slopeLimited` で「急すぎない線」に均してから使う
  //   （しなり量そのものに上限を置くやり方をやめた経緯は `slopeLimited`）。
  const arc = spriteArcOf(place.lower ? sprite.profTop : sprite.profBot);
  const sinkDir = place.lower ? -1 : 1;

  // ── 沈める量は「下に白目があるか」で変える ────────────────
  //
  // 【2026-08-15 製品オーナーの指摘「目と離れている／原画ほどのクオリティが無い」】
  //   `sink` は本来「まぶたのインクへ食い込ませて、ひとつながりの塊に見せる」
  //   ための値。白目のある目ではインクの下が明るいので、少し深く沈めても
  //   まつげの下辺が白の上に出て **太いまつげの線** として読める。
  //
  //   ところが **たまご（べた目）と つぶら（点目）は白目を持たない**。
  //   器の中はまるごと濃い虹彩で、しかもインクと虹彩の明度差は実測で
  //   1.2〜1.8:1（1.0 で同色）しかない。ここへ 0.3ry も沈めると、
  //   沈めた部分は **色が同じで完全に見えなくなる**。
  //   結果、地肌の上へはみ出した細い毛だけが残り、
  //   「目から離れて浮いた数本の毛」に見えていた（実個体 `QHJS-K7MY`
  //   `S6AG-YGBX` `7QL5-ARVD`。いずれも たまご ＋ 濃い配色）。
  //
  //   白目が無い目では、輪郭リングに重なるぶんだけ沈めれば十分。
  //   まつげ本体は器の上（地肌の上＝コントラスト 4〜6.7:1）に載るので、
  //   原画の形がそのまま読める。
  //   `sleepy` のように負の `sink`（インクへ引き上げる）はそのまま通す。
  const hasSclera = !isTallSolidEye(shapeId) && !isSolidEye(ctx.parts);
  const sinkDepth = hasSclera
    ? place.sink * ry
    : Math.min(place.sink * ry, ctx.strokeW * 0.35);

  /** ある倍率でまつげ 1 枚を組み立てる（`lashRoom` を越えていないか試すため）。 */
  const buildAt = (s: number): { d: string; probes: Vec[] } => {
    const startX = spanC - (place.outerAt * inkW * s) / 2;
    const tx = startX - sprite.box.x0 * s;
    const edge = slopeLimited(baseAt, startX, rightOf(s), anchorX, LASH_MAX_SLOPE);
    const uOf = (x: number): number => (x - tx) / s / inkW - sprite.box.x0 / inkW;
    const uA = uOf(anchorX);
    const edgeA = edge(anchorX);
    const arcA = arc(uA);
    const bendAt = (x: number): number => edge(x) - edgeA - (arc(uOf(x)) - arcA) * s;
    // 原画の縁（上まつげなら下辺）が、基準線より `sink` だけ内側へ食い込む
    // ように縦位置を決める。0 でちょうど接し、正の値でまぶたのインクと
    // ひとつながりの塊になる。
    const ty = edgeA + sinkDir * sinkDepth - arcA * s;
    const w = warpSpritePath(sprite.body, tx, ty, s, bendAt);
    // 左右反転を適用した「実際に絵がある位置」にしてから返す。
    return {
      d: w.d,
      probes: mirror === 1 ? w.probes : w.probes.map((q) => ({ x: -q.x, y: q.y })),
    };
  };

  // ── 体の輪郭からはみ出さないところまで縮める ────────────────
  //
  // 【`lashRoom` だけでは足りない — レビュー C で実測して分かった】
  //   `lashRoom` は目の高さ ±0.7ry の 3 点でしか横幅を見ていない。まつげは
  //   目の **上** へ大きく伸びるので、頭が細くなる高さでの余白を見落とす。
  //   実測で成体 300 体中 31 体、まつげが体の輪郭を突き抜けていた
  //   （顔は体でクリップされるので、はみ出した先は **平らに切り落とされる**）。
  //
  //   `ctx.shape.outsideAt` は `inspectModel` とまったく同じ折れ線で判定する
  //   ので、ここを通れば自動検査も必ず通る。収まるまで原画の形を保ったまま
  //   少しずつ縮める。
  const angle = rad(tiltDeg);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  //
  // 【左右を必ず同じだけ縮める】
  //   体の輪郭は左右対称ではない（`silhouette` の癖・裾の割れなど）。片目ずつ
  //   判定すると、**片方のまつげだけが縮んで** 左右で大きさが変わる
  //   （実測 43.5 と 48.2 ＝ 11% 差。顔の上では作画ミスに見える）。
  //   顔の中心線で折り返した点も一緒に見て、どちらの側でも収まる大きさにする。
  //   こうすると両目がまったく同じ倍率になる。
  // 折り返しの軸は **顔の中心**（目を並べた基準）。体の中心 `shape.cx` を使うと
  // 両者が 0.26 ずれていて、境界ぎりぎりの個体で左右の縮小量が変わった
  // （実測 `wide` × `sideLong` で 3.0 のずれ）。
  const faceCx = ctx.face.cx;
  const worstOutside = (pts: readonly Vec[]): number => {
    let worst = 0;
    for (const q of pts) {
      const gx = slot.x + q.x * cos - q.y * sin;
      const gy = slot.y + q.x * sin + q.y * cos;
      const d = Math.max(ctx.shape.outsideAt(gx, gy), ctx.shape.outsideAt(2 * faceCx - gx, gy));
      if (d > worst) worst = d;
    }
    return worst;
  };
  let built = buildAt(scale);
  for (let i = 0; i < 12 && worstOutside(built.probes) > 1; i++) {
    scale *= 0.9;
    if (inkW * scale < 2) return NO_LASH;
    built = buildAt(scale);
  }

  // 左右反転は目の中心（x=0）まわり。原画は「外向きに跳ねる」向きで描かれて
  // いるので、mirror を掛けるだけで両目とも跳ねが外を向く。
  //
  // 【白いつやの点を描かなくなった理由 — レビュー A-1 / A-4】
  //   原画には、まつげの太いところに白いつやの点が乗っている。原画の
  //   サイズ（幅 900px）では意匠として効くが、ゲームでの実寸は幅 30px 前後で
  //   点は 1px 未満になり、96px の一覧では **そもそも見えない**（実測で
  //   full と lite に差が出なかった）。一方で拡大表示では、黒いまつげの
  //   シルエットの中にある白い点が **動物の目** に読めてしまい、みかづき／
  //   したりめでは「目の上を魚が泳いでいる」絵になっていた。点目
  //   （`bead`）では、目そのものが持つハイライトに加えて **2 つめの
  //   ハイライト** が浮き、傷か汚れに見えた。
  //   小さいと見えず、大きいと害になるので描かない。
  //   原画（`art/eyelashes_sprite.svg`）と `lashSprites.ts` の
  //   `highlight` はそのまま残してあるので、戻したくなったらここで
  //   描くだけでよい。
  let svg = mirror === 1 ? '' : `<g transform="scale(-1 1)">`;
  // パスは反転前の座標で書いてあるので、反転はグループの transform に任せる。
  //
  // 【白目の無い目にだけ細い縁を付ける理由 — レビュー第2ラウンド】
  //   たまご（べた目）・つぶら（点目）は器の中がまるごと濃い虹彩で、
  //   インクとの明度差が 1.2〜1.8:1 しかない。まつげのうち器に重なった部分は
  //   **輪郭が読めず**、原画の帯が消えて細い毛だけが残る。
  //   地肌の色で細く縁取ると、器の上では明るい隙間として帯の形が浮かび、
  //   地肌の上では同色なので何も足されない（＝白目のある目と同じ絵のまま）。
  // 【細い縁を付けない — 製品オーナーの指示（NTD6-GKM7）】
  //   白目の無い目（べた目・点目）では、まつげがインクと同色の虹彩に溶けて
  //   形が読めなくなる。いったん地肌寄りの細い縁を付けて輪郭を出したが、
  //   「まつ毛の縁の色いらない。全部黒色でいい。」との判断で外した。
  //   読みやすさは、縁ではなく **置きかた**（`lashBaseY` が べた目では
  //   外周リングを基準にする／`sinkDepth` が浅い）で確保している。
  svg += path(built.d, { fill: ctx.colors.inkPaint });
  if (mirror !== 1) svg += `</g>`;
  return { svg, probes: built.probes };
}

/**
 * 原画のパス（`M x y l dx dy … Z` だけでできている）を、
 * 拡大・平行移動し、さらに `bendAt(x)` ぶん縦にずらして書き直す。
 *
 * 変換行列では「曲線に沿ってしならせる」が表せないので、点ごとに計算する。
 * 原画は間引き済み（1 枚 100〜300 点）なので、目 1 つあたりの計算量は小さい。
 *
 * 出力は相対コマンド（`l`）にする。絶対座標を並べるより 2 割ほど短く、
 * 一覧（1 画面に 100 体）での DOM の重さに効く。
 */
function warpSpritePath(
  d: string,
  tx: number,
  ty: number,
  scale: number,
  bendAt: (localX: number) => number,
): { d: string; probes: Vec[] } {
  let out = '';
  // 検査用の点は輪郭から間引いて拾う。全点を渡すと 1 個体あたり数百点になり、
  // `inspectModel` の点 × シルエット辺の総当たりが重くなる。
  const probes: Vec[] = [];
  let seen = 0;
  for (const poly of parseSpritePath(d)) {
    let px = 0;
    let py = 0;
    poly.forEach((p, i) => {
      const x = tx + p.x * scale;
      const y = ty + p.y * scale + bendAt(x);
      if (seen++ % 3 === 0) probes.push({ x, y });
      out += i === 0 ? `M${n(x)} ${n(y)}` : `l${n(x - px)} ${n(y - py)}`;
      px = x;
      py = y;
    });
    out += 'Z';
  }
  // "12 -3" → "12-3"。区切りの空白は負号があれば省ける。
  return { d: out.replace(/ -/g, '-'), probes };
}

/** 原画パスの点列。同じ原画を何度も解析しないよう覚えておく。 */
const spritePathCache = new Map<string, Vec[][]>();

function parseSpritePath(d: string): Vec[][] {
  const hit = spritePathCache.get(d);
  if (hit) return hit;
  const polys: Vec[][] = [];
  let cur: Vec[] = [];
  let x = 0;
  let y = 0;
  // `M`/`l`/`Z` と、その後ろに続く数値の並び。数値は空白か符号で区切られる。
  for (const m of d.matchAll(/([MlZ])([^MlZ]*)/g)) {
    const cmd = m[1];
    const nums = (m[2]!.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (cmd === 'M') {
      if (cur.length > 2) polys.push(cur);
      cur = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        x = nums[i]!;
        y = nums[i + 1]!;
        cur.push({ x, y });
      }
    } else if (cmd === 'l') {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        x += nums[i]!;
        y += nums[i + 1]!;
        cur.push({ x, y });
      }
    } else {
      if (cur.length > 2) polys.push(cur);
      cur = [];
    }
  }
  if (cur.length > 2) polys.push(cur);
  spritePathCache.set(d, polys);
  return polys;
}

/** 目 1 つ分の SVG。 */
/**
 * 目 1 つ分。**まつげは別パーツとして返す**（`lashSvg`）。
 *
 * 【なぜ目と分けるのか — Visual Lab のドラッグ機能のため】
 *   製品オーナーが「まつげをクリックして動かす」で意図を伝えられるように、
 *   まつげは目とは独立して掴めるパーツでなければならない。同じ `<g>` の中に
 *   描いていると、クリックしても目ごと動いてしまう。
 *   描画結果（重なり順・クリップ）は分ける前とまったく同じ。
 */
function drawEye(
  ctx: DrawCtx,
  slot: EyeSlot,
  index: number,
): { svg: string; lashSvg: string; probes: readonly Vec[] } {
  // まつげの検査用の点。早期リターンが 4 か所あるので、`lashes()` を通した
  // 時点でここへ控えておき、最後にまとめて返す。目のグループは回転して
  // いるので、ここで親の座標系へ直してから渡す。
  let probes: readonly Vec[] = [];
  const lashes = (sh: string, style: EyeStyle, room: number): string => {
    const tilt = dir * style.tilt + asymTilt;
    const out = drawLashes(ctx, slot, sh, style, room, tilt);
    probes = rotatePointsAt(out.probes, slot.x, slot.y, tilt);
    return out.svg;
  };
  const c = ctx.colors;
  const { s, rx, ry, dir } = slot;
  const shapeId = ctx.parts.eyeShape;
  const st = styleOf(shapeId);
  const droop = ctx.mood.droop;
  // その目の虹彩色。ヘテロクロミアの個体だけ、片目の色相がずれて返る。
  const iris = heteroIris(ctx, slot, index);

  const asymTilt =
    ctx.pheno.asymmetry > 0.5 ? (index === 0 ? 1.6 : -0.8) * (ctx.pheno.asymmetry - 0.5) * 6 : 0;

  // 目尻の外側に残っている体内の余白（まつげの長さの上限に使う）。
  // 目の上下端まで見て一番狭いところを取る（輪郭は曲がっているので、
  // 目の中心の高さだけを見ると上の角が輪郭を突き抜ける）。
  const lashRoom = ((): number => {
    if (dir === 0) return rx * 1.2;
    const sh = ctx.shape;
    let room = Infinity;
    for (const t of [-0.7, 0, 0.7]) {
      const y = slot.y + ry * t;
      room = Math.min(room, Math.abs(sh.edgeX(y, dir >= 0 ? 1 : -1) - slot.x));
    }
    return Math.max(0, room - rx * 0.88 - ctx.strokeW);
  })();

  // まつげを別パーツにしても同じ位置へ置けるよう、変換を 1 か所で作る。
  const tf = `<g transform="translate(${n(slot.x)} ${n(slot.y)}) rotate(${n(dir * st.tilt + asymTilt)})">`;
  // まつげは目とは別の `<g>` に出す（ローカル座標のまま溜めておく）。
  let lashInner = '';
  let g = tf;

  // ── みかづき（閉じた笑い目）は白目を持たない ──────────────
  if (shapeId === 'crescent') {
    const w = rx * 1.08;
    const h = ry * 1.5;
    g += path(`M${n(-w)} ${n(h * 0.3)}Q0 ${n(-h * 1.15)} ${n(w)} ${n(h * 0.3)}`, {
      stroke: c.inkPaint,
      width: ctx.strokeW * 1.15,
      linecap: 'round',
    });
    // 弧の内側にうっすら虹彩色を敷いて「閉じた目」であることを伝える
    g += path(`M${n(-w * 0.7)} ${n(h * 0.42)}Q0 ${n(-h * 0.52)} ${n(w * 0.7)} ${n(h * 0.42)}`, {
      stroke: iris,
      width: ctx.strokeThin * 0.8,
      opacity: 0.5,
    });
    if (ctx.parts.pupil === 'sparkle' || ctx.parts.pupil === 'petalP') {
      g += path(starPath(dir * w * 0.95, -h * 0.75, s * 0.24, s * 0.09, 4, -90), {
        fill: c.accent,
        opacity: 0.9,
      });
    }
    lashInner = lashes(shapeId, st, lashRoom);
    g += `</g>`;
    return { svg: g, lashSvg: lashInner ? `${tf}${lashInner}</g>` : '', probes };
  }

  // ── したりめ（傾いた閉じ目＋切り欠き）も白目を持たない ──────
  //
  // 【参考画像との対応 — docs/screenshots/face/ref/ref-eye-smirk.png】
  //   斜めに傾いだ半月の閉じ目に、弧の端寄りへ小さな切り欠きが 1 つ入った
  //   非対称な形。みかづき（`crescent`、左右対称の穏やかな閉じ目）と
  //   まったく同じ弧をベースに、以下の 2 点だけを足して作る。
  //     1) 傾き … `EYE_STYLE.smirk.tilt`（22°）がこの `<g>` の回転に
  //        すでに効いている。みかづきの tilt（4°）よりはっきり傾く。
  //     2) 切り欠き … 弧の右寄り（頂点よりやや下った側）を小さな mask で
  //        くり抜く。左右の目で反転させないのがポイントで、`dir` に
  //        連動させると鏡合わせの傾きと打ち消し合って非対称さが消える。
  //        参考画像でも左右どちらの目も自分の弧の右側に切り欠きがある。
  //   新しい描画機構は増やさず、みかづきの 2 本の弧をそのまま使う。
  if (shapeId === 'smirk') {
    const w = rx * 1.08;
    const h = ry * 1.5;

    // 弧の頂点（u=0.5）よりやや右（u≈0.75）に切り欠きを置く。
    // 2 次ベジエ P(u) = (1-u)²P0 + 2(1-u)u·Pc + u²P2 を
    // P0=(-w, 0.3h) Pc=(0, -1.15h) P2=(w, 0.3h) で u=0.75 に代入した実座標。
    const notchX = w * 0.5;
    const notchY = -h * 0.244;
    // 線の太さ（strokeW*1.15）の半分よりひと回り大きい半径にして、
    // 小さくても「弧が欠けている」と読めるだけの深さを確保する。
    const notchR = Math.max(2.4, ctx.strokeW * 0.85);
    // mask は「白＝見える／黒＝消える」。矩形を弧より十分大きく取り、
    // その上に黒い円を重ねて弧の一部だけをくり抜く（body.ts と同じ手法）。
    const padM = w + h;
    const maskId = ctx.defs.add(`smirkNotch${index}`, (id) =>
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="${n(-padM)}" y="${n(-padM)}" width="${n(padM * 2)}" height="${n(padM * 2)}">` +
      `<rect x="${n(-padM)}" y="${n(-padM)}" width="${n(padM * 2)}" height="${n(padM * 2)}" fill="#ffffff"/>` +
      `<circle cx="${n(notchX)}" cy="${n(notchY)}" r="${n(notchR)}" fill="#000000"/>` +
      `</mask>`,
    );
    g += `<g mask="${url(maskId)}">`;
    g += path(`M${n(-w)} ${n(h * 0.3)}Q0 ${n(-h * 1.15)} ${n(w)} ${n(h * 0.3)}`, {
      stroke: c.inkPaint,
      width: ctx.strokeW * 1.15,
      linecap: 'round',
    });
    g += `</g>`;
    // 弧の内側にうっすら虹彩色を敷いて「閉じた目」であることを伝える（みかづきと同じ）
    g += path(`M${n(-w * 0.7)} ${n(h * 0.42)}Q0 ${n(-h * 0.52)} ${n(w * 0.7)} ${n(h * 0.42)}`, {
      stroke: iris,
      width: ctx.strokeThin * 0.8,
      opacity: 0.5,
    });
    if (ctx.parts.pupil === 'sparkle' || ctx.parts.pupil === 'petalP') {
      g += path(starPath(dir * w * 0.95, -h * 0.75, s * 0.24, s * 0.09, 4, -90), {
        fill: c.accent,
        opacity: 0.9,
      });
    }
    lashInner = lashes(shapeId, st, lashRoom);
    g += `</g>`;
    return { svg: g, lashSvg: lashInner ? `${tf}${lashInner}</g>` : '', probes };
  }

  // ── 点目（白目を持たない一色の目）──────────────────────
  //
  // 瞳『つぶら(bead)』のときに発現する。
  // 新しい遺伝子座を足さずに、既存の pupil 遺伝子で目の印象を丸ごと変える装置。
  // ビジュアル批評の主要指摘「小さい点目が 1 種も出ていない」への対応で、
  // 批評担当は「目の形だけで印象が激変する」ことを閉じ目の例で確認している。
  //
  // 【『まるめ／たまご』限定をやめた理由 — 実測 10%】
  //   製品オーナーは点目を「目の基本」の 1 つに挙げている。ところが
  //   `bead` は 200 体中 44 体（22%）出ているのに、点目になるのは
  //   そのうち丸／たまごの 20 体（全体の 10%）だけだった。
  //   一方 **配置側（`isSolidEye`）は形に関係なく bead を点目として縮めて**
  //   いたので、ぱっちり・ねむたげ・このはの bead は
  //   「小さく縮んだのに白目付き」という中途半端な目になっていた。
  //   判定を `isSolidEye` に一本化して、配置と描画の食い違いも消す。
  //
  // 【ほしぞらだけ外す理由】
  //   『ほしぞら』は虹彩が夜空・瞳が星形という、めずらしさの表示そのもの。
  //   点目にするとその形質が画面から消えてしまうので、星のほうを残す。
  if (isSolidEye(ctx.parts) && shapeId !== 'starry') {
    g += drawSolidEye(ctx, slot, shapeId, iris, index);
    lashInner = lashes(shapeId, st, lashRoom);
    g += `</g>`;
    return { svg: g, lashSvg: lashInner ? `${tf}${lashInner}</g>` : '', probes };
  }

  const wd = whiteShape(shapeId, rx, ry);
  const clipId = ctx.defs.add(`eyec${index}`, (id) =>
    `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${wd}"/></clipPath>`,
  );

  // ── 器（白目、または縦長のべた目の面）─────────────────────
  //
  // 【縦長だけ白目をやめた理由 — 製品オーナーの指示】
  //   「縦長は白目部分いらないんじゃない？」
  //   縦長の器（たまご rx0.7s/ry1.0s）は、虹彩を縦長にしてもなお
  //   上下に白が残りやすい。そこを大きくすると白の面積だけが増えて
  //   「白目を剥いて見開いた人間の目」に戻る。判断は `isTallSolidEye`。
  //
  // 【体の色と直接隣り合うことへの備え】
  //   白目が無いと、目の面がそのまま体の色と接する。
  //   体が濃い個体で目が沈まないよう、
  //     1) 面の色は明度・彩度を帯に収める（`tallEyeFill`。赤系だけ上限が低い）
  //     2) 器の輪郭のインクは白目のときと同じ太さで必ず引く
  //   の 2 段で分離を保つ。輪郭は明背景／暗背景でテーマ変数から切り替わる
  //   （`c.inkPaint`）ので、暗いテーマでも境目が消えない。
  const tall = isTallSolidEye(shapeId);
  const tallFill = tall ? tallEyeFill(iris) : '';
  const irisFill = tall ? tallFill : shapeId === 'starry' ? darken(iris, 0.46) : iris;
  const irisGradient = eyeIrisGradient(ctx, index, irisFill);
  g += path(wd, {
    fill: tall ? irisGradient : eyeScleraGradient(ctx, index, scleraFillFor(shapeId, c.sclera)),
    stroke: c.inkPaint,
    width: ctx.strokeW * 0.82,
    linejoin: 'round',
  });

  // 虹彩（白目に切り抜く）
  //
  // 【縦の縛りを irisAsp で割り戻す理由】
  //   `ir` は虹彩の **横** 半径なのに、以前は `ry * irisK` でも縛っていた。
  //   縦につぶれた目（ねむたげ rx1.2/ry0.5）では ry が効いて虹彩が
  //   直径 0.95s の小さな円になり、左右に白が 0.7s ずつ残る。
  //   縦の縛りは「縦半径 ≦ ry × irisK」であるべきなので、
  //   縦横比で割ってから横半径に掛ける。こうすると irisK は
  //   縦横どちらの向きにも「白目に対する虹彩の占有率」として素直に効く。
  const py = ry * st.irisY;
  const irisK = st.irisK;
  // べた目は器そのものが面なので、虹彩の楕円ではなく器の寸法を面として使う。
  // こうしないと意匠が「面の中の小さな円の中」に閉じ込められ、
  // ふくがん・ボタンのように面いっぱいに広がる意匠が成立しない。
  const ir = tall ? rx * 0.98 : Math.min(rx * irisK * 0.94, (ry * irisK) / st.irisAsp);
  // 縦長／横長の虹彩。白目からはみ出しても clipPath が切るので破綻しない。
  const irY = tall ? ry * 0.98 : Math.min(ir * st.irisAsp, ry * 0.98);
  g += `<g clip-path="${url(clipId)}">`;
  // 虹彩は低コントラストの面内グラデーション＋薄い外周で立体感を出す。
  // べた目は器そのものが既に面なので、二重に描かず、外周だけを足す。
  if (!tall) g += ellipse(0, py, ir, irY, { fill: irisGradient });
  g += ellipse(0, py, ir * 0.94, irY * 0.94, {
    fill: 'none',
    stroke: darken(irisFill, 0.3),
    width: Math.max(0.9, ctx.strokeThin * 0.62),
    opacity: 0.64,
  });
  // 下側だけをほんの少し落として、上のハイライトとの明暗をつなぐ。
  // 面の色を残すので、濃い瞳孔や人間の眼球のような強い視線にはならない。
  g += ellipse(0, py + irY * 0.38, ir * 0.74, irY * 0.2, {
    fill: darken(irisFill, 0.2),
    opacity: 0.13,
  });

  if (shapeId === 'starry') {
    // ほしぞら: 虹彩を夜空にして、瞳そのものを星形にする。
    // めずらしい形質なので特別さは残すが、星屑は 5 個 → 3 個に減らす
    // （96px では点が潰れて「ざらついた汚れ」に見えていた）。
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.7;
      g += circle(Math.cos(a) * ir * 0.62, py + Math.sin(a) * ir * 0.62, ir * 0.09, {
        fill: '#fff8e0',
        opacity: 0.9,
      });
    }
    // 星型を遺伝子に応じて3角形へ戻すと、「三角形はやめて」という
    // ほしぞら自体の造形ルールを破る。どの意匠との組合せでも丸い4弁に統一する。
    g += path(roundedStarPath(0, py, ir * 0.62, ir * 0.34, 4, -90), {
      // 星空の星は虹彩色ではなく、黒いシルエットとして読ませる。
      fill: mix(c.ink, '#000000', 0.48),
    });
  } else {
    // 【意匠の基準半径を「面の短いほうの半径」にした理由】
    //   以前の瞳は虹彩の相乗平均を基準にしていた。相乗平均は
    //   縦長の面（たまご ry/rx ≒ 2.2）で横半径より大きくなるので、
    //   円い意匠（わっか・ボタン）が **左右にはみ出して切れる**。
    //   意匠は模様なので、切れると何の模様か読めなくなる。
    //   短いほうに合わせれば、どの形の目でも意匠の全体が必ず面に収まる。
    //   0.86 は「意匠と面の縁のあいだに、面の色が細く残る」余白。
    const mr = Math.min(ir, irY) * 0.86 * st.motifK;
    g += motifMarkup(ctx.parts.pupil, {
      face: irisFill,
      deep: darken(irisFill, 0.4),
      light: mix('#fffdf8', irisFill, 0.12),
      glass: mix(irisFill, c.ink, 0.62),
      ir,
      irY,
      s: mr,
      py,
      // 名前付き乱数。`Math.random()` は使わない（同じ個体が毎回同じ絵になる）。
      // 左右の目で同じ並びにするため index は名前に入れない ＝ 目は「対」に見える。
      rng: ctx.rng('eyeMotif'),
    });
  }

  // ハイライトは 1 つだけ・小さめ。
  // 2 つ入れると「濡れて光る眼球」になり、全個体が同じキラキラ目に見える。
  // 縦位置は虹彩の縦半径に合わせる（縦長の虹彩で光だけ中央に残らないように）。
  //
  // 【虹彩を大きくしたぶん、光は相対的に小さくした】
  //   `ir * 0.26` のままだと虹彩と一緒に光も育ち、
  //   「純黒＋硬い白ハイライト」のぎらついた目になる。
  //   短いほうの半径を基準にして 0.22 まで詰め、色も紙寄りの白、
  //   不透明度も 0.95 → 0.85 に落とす。実寸は以前とほぼ同じで、
  //   96px で「黒い穴」に見えないための担保はそのまま残る。
  //
  // 【『つやだま』だけ描かない理由 — 光が 3 つになるから】
  //   つやだまは意匠そのものが丸い光を **2 つ** 持っている（それが形質）。
  //   そこへ既定のハイライトを足すと光が 3 つ並び、
  //   まさに上で避けたい「濡れて光る眼球」になる。しかもつやだまの光は
  //   下寄り・既定のハイライトは上寄りなので、面の上下が両方光って
  //   面の色（＝その子の配色）が見えなくなる。
  //   「96px で黒い穴に見えない」担保は、つやだまでは明るい面そのものが
  //   果たしているので、ここを飛ばしても暗く潰れることはない。
  //   『ほしぞら』は意匠を星で上書きしていて、つやだまの光は描かれていない。
  //   そちらでは既定のハイライトが要る（外すと夜空の面が黒い穴になる）。
  if (!(ctx.parts.pupil === 'gloss' && shapeId !== 'starry')) {
    g += circle(-ir * 0.44, py - irY * 0.44, Math.min(ir, irY) * 0.22, {
      fill: '#fffdf8',
      opacity: 0.85,
    });
  }
  g += `</g>`;

  // 上まぶた（太いインク）。形ごとの基準値＋元気のなさで深くなる。
  //
  // 【下辺を必ずたわませる理由 — 実測で特定した「ゴーグル」の正体】
  //   以前の式は端と中央の高さの差が
  //     ry × (1 − 1.5×bow + 0.3×lid×bow)
  //   で、bow が 0.66〜1.3 の実効域ではこれがほぼ 0 になっていた。
  //   実物のパス（`ZG9W-6RWF`）は幅 48.6 に対し制御点のずれが 0.53 ＝
  //   **たわみ 0.27px（1.1%）で実質直線**。輪郭リングも虹彩も丸いのに
  //   まぶただけが直線で白を切るので、上辺が水平線・両端が鋭い角になり、
  //   目が「ゴーグル」に見えていた。この作品で唯一の直線要素だった。
  //
  // 【端を持ち上げる理由】
  //   下辺を曲げるだけでは、白目の輪郭とほぼ直角に交わる両端の角が残る。
  //   まぶたは目尻・目頭へ向かって薄くなるものなので、端を持ち上げて
  //   白の輪郭と浅い角度で交わらせる。これで両端が丸く見える。
  const lid = lidValue(st, droop);
  if (lid > 0.015) {
    const bow = st.lidBow;
    // 中央でまぶたが下りる高さ（従来の lid の意味をそのまま保つ）
    const yc = -ry + ry * 2 * lid;
    // 下辺のたわみ。rx の 10〜18%。ただし目を閉じきらない範囲に抑える。
    const sag = Math.min(
      rx * lerp(0.1, 0.18, clamp((bow - 0.66) / 0.64, 0, 1)),
      Math.max(0, (ry - yc) * 0.42),
    );
    const yMid = yc + sag;
    const yEdge = yc - ry * (0.3 + 0.2 * bow);
    // 3 次ベジエの中点は (p0 + 3c1 + 3c2 + p3) / 8。左右対称なので
    // 制御点の y はひとつ解けばよい。
    const cpy = (8 * yMid - 2 * yEdge) / 6;
    const w = rx * 1.34;
    g += `<g clip-path="${url(clipId)}">`;
    g += path(
      `M${n(-w)} ${n(yEdge)}` +
      `C${n(-w * 0.46)} ${n(cpy)} ${n(w * 0.46)} ${n(cpy)} ${n(w)} ${n(yEdge)}` +
      `L${n(w)} ${n(-ry * 2.1)}L${n(-w)} ${n(-ry * 2.1)}Z`,
      {
        fill: c.inkPaint,
        stroke: c.inkPaint,
        width: ctx.strokeThin * 0.5,
        linejoin: 'round',
        linecap: 'round',
      },
    );
    g += `</g>`;
  }

  // 下まぶた（ぱっちり／ねむたげだけ）
  //
  // 【白目の内側に収めた理由】
  //   以前は制御点 `ry*1.16` で、極値が `ry*0.86 + …` ではなく
  //   白目の下端（ry）を **超えて** いた。パーツの bbox は
  //   `boxAround(x, y, rx, ry)` なので、絵だけが bbox の外へ出る。
  //   目の下端が実際より下にあると、口との間隔（`MOUTH_EYE_GAP`）の
  //   前提が崩れ、引きで「目と口がくっついた 1 つの器官」に見える個体が出る。
  //   極値 = (p0 + 2c + p1)/4 = 0.86ry に収まるよう制御点を下げる。
  if (st.lower) {
    g += path(`M${n(-rx * 0.78)} ${n(ry * 0.72)}Q0 ${n(ry)} ${n(rx * 0.78)} ${n(ry * 0.72)}`, {
      stroke: c.inkPaint,
      width: ctx.strokeThin * 0.85,
      opacity: 0.8,
    });
  }

  // 目尻の線（かつての「まつげ」）
  //
  // 【長さを半分にした理由】
  //   長い線を外へ伸ばすと、それはまつげ＝**化粧をした人間の目**になる。
  //   つり目（このは）・たれ目（ねむたげ）を伝えるのに必要なのは
  //   「目尻がどちらへ向いているか」だけで、長さは要らない。
  //   `EYE_STYLE.lash` を『まるめ』『たまご』『ほしぞら』で 0 にしたうえ、
  //   残した形でも伸び幅を 0.62s → 0.34s に詰める。
  //
  // 【輪郭からはみ出させないための 2 段構え】
  //   1) 長さの上限を「その高さで体の内側に残っている余白」でも抑える。
  //      以前は無制限に伸ばしていたため、目が体の端に寄った個体で
  //      線が輪郭を突き抜け、顔の外に髭が生えたように見えていた（P0-3）。
  //   2) それでも越える場合に備え、buildFace が顔全体を体パスでクリップする。
  if (st.lash > 0 && lashRoom > 0.5) {
    const lx = dir >= 0 ? rx * 0.88 : -rx * 0.88;
    const ldir = dir >= 0 ? 1 : -1;
    const reach = Math.min(s * 0.34 * st.lash, rx * 0.7, lashRoom);
    // 縦の振れも reach に比例させる。以前は縦だけ s 基準だったので、
    // 横を詰めた途端に「ほぼ垂直の鉤」になってしまう。
    g += path(
      `M${n(lx)} ${n(-ry * 0.42)}q${n(ldir * reach * 0.6)} ${n(-reach * 0.5)} ${n(ldir * reach)} ${n(-reach * 0.18)}`,
      { stroke: c.inkPaint, width: ctx.strokeThin },
    );
    // 【このはの 2 本目を廃した理由】
    //   目尻に線が 2 本並ぶと、それはもう「まつげの束」で、
    //   つり目という **形** の情報は 1 本目で足りている。
  }

  // 付け根は固定値ではなく、上まぶたの実際の下辺／白目の輪郭から求める。
  lashInner = lashes(shapeId, st, lashRoom);

  g += `</g>`;
  return { svg: g, lashSvg: lashInner ? `${tf}${lashInner}</g>` : '', probes };
}

/**
 * 『にこり』が **開いた口** になる機嫌のしきい値。
 *
 * 【0.56 → 0.78 へ上げた理由 — 製品オーナーの方針】
 *   「大きな笑い口も個性として残すが、少数にする」。
 *   0.56 では実測 200 体中 25 体（にこりの 28%）が大口で笑っており、
 *   『ぽかん』と合わせて **面として開いた口が 25.0%** ＝ 4 体に 1 体だった。
 *   LifeState が無いときの smile は性格から作られ、平均 0.47・標準偏差 0.21 の
 *   おおよそ正規分布なので、0.78 なら上位 6〜7% にあたる。
 *   遺伝子座『ぽかん』は残るので、開いた口が絶滅することはない。
 *
 * `drawMouth` と `mouthSpan` の両方が同じ値を見る必要がある
 * （ずれると「実際は線の口なのに、口の高さは開口として見積もられる」ことになり、
 *   模様が胴から追い出される）。
 */
const OPEN_SMILE = 0.78;

/**
 * 口。
 *
 * 6 種が「大きさの違う同じ弧」にならないよう、
 * 幅・曲率・線の本数・塗りの有無まで種類ごとに変える。
 * mood.smile（性格・機嫌）は各種の中でさらに曲率を動かす。
 *
 * 【描画の約束】
 *   `face.mouth.w` は **描いてよい横半幅**、`h` は縦の広がり。
 *   どの種類も x ± w / y ± h の中に収める。
 *
 * 【「小さく・単純に」へ舵を切った経緯 — 製品オーナーの方針】
 *   以前は「引きで口が消える」への対処として口を大きくし続け、
 *   実測で口幅 中央 63.4 / 最大 90.7（体幅 約130）まで来ていた。
 *   これは顔の下半分を口が占める大きさで、しかも開いた口には
 *   下唇の帯や歯の面まで足していたため、**人間の口** に近づいていた。
 *   方針を反転し、大きさは `faceLayout.MOUTH_W_RATIO` で種類ごとに絞り、
 *   ここでは **層を減らす**（下唇の帯・歯・口角の跳ね上げを廃す）。
 *   引きで消えないための担保は「大きさ」ではなく「線の太さ」で取る。
 */
function drawMouth(ctx: DrawCtx): string {
  const c = ctx.colors;
  const m = ctx.face.mouth;
  const kind = ctx.parts.mouth;
  if (kind === 'none') return '';
  const w = m.w;
  const smile = ctx.mood.smile;
  // 【口を小さくしても線は太いままにする理由】
  //   「引きで口が消える」の原因は幅ではなく線の細さだった
  //   （以前は strokeW × 0.9 で、140px のセルでは 2px を割っていた）。
  //   口を小さくするほど、この 1 本の線が読めるかどうかが効く。
  //   小さくて太い線 ＝ カートゥーンの口そのものでもある。
  const sw = ctx.strokeW * 1.15;
  const x = m.x;
  const y = m.y;

  switch (kind) {
    case 'tiny': {
      // ちいさい: 猫のような「ω」。山を 2 つ作る。
      // 半幅の 34% しか使っていなかったので、与えられた幅いっぱいに広げる。
      //
      // 【山の深さに下限を作った理由】
      //   機嫌が低い個体（smile≈0）だと山がほぼ潰れて水平線になり、
      //   引きでは口が消えていた。ω の形が読めるだけの深さは必ず残す。
      const ww = w * 0.5;
      const d = ww * 1.05 * (0.78 + smile * 0.32);
      return path(
        `M${n(x - ww * 2)} ${n(y - d * 0.34)}Q${n(x - ww)} ${n(y + d)} ${n(x)} ${n(y - d * 0.18)}` +
        `Q${n(x + ww)} ${n(y + d)} ${n(x + ww * 2)} ${n(y - d * 0.34)}`,
        { stroke: c.inkPaint, width: sw },
      );
    }
    case 'wavy': {
      // なみなみ: 上下に振れる波。振幅を大きくして「〜」と読めるようにする。
      // 左右対称に ±w を使い切る（以前は右へ 0.33w しか届かず偏っていた）。
      const q = w * 0.667;
      // 振幅の下限も上げる（浅い波は縮小すると直線になり、口に見えない）
      const a = q * 0.62 * (0.7 + smile * 0.38);
      return path(
        `M${n(x - w)} ${n(y)}` +
        `q${n(q * 0.45)} ${n(-a)} ${n(q)} 0` +
        `q${n(q * 0.45)} ${n(a)} ${n(q)} 0` +
        `q${n(q * 0.45)} ${n(-a * 0.7)} ${n(q)} 0`,
        { stroke: c.inkPaint, width: sw },
      );
    }
    case 'open': {
      // ぽかん: 小さく丸い開いた口。
      //
      // 【下唇の帯を廃した理由 — 製品オーナーの方針】
      //   開口の下縁に沿って明色の帯を敷いていた。これは絵として
      //   **人間の下唇** そのもので、「人間の唇のように見える口は避ける」に
      //   真正面から反する。帯が要ったのは口が体に対して大きく、
      //   開口が「平坦な暗い楕円＝顔に開いた穴」に見えていたからで、
      //   口そのものを小さくすれば穴には見えない。原因の側を直す。
      //
      // 【横長 → 縦を起こした理由】
      //   縦横比 0.3 の平たい開口は「あんぐり開けた大口」で、
      //   『ぽかん』という言葉の指す顔ではない。横を詰めて縦を起こすと、
      //   同じ小ささでも「小さな o 」として読める。
      //
      // 【口の中を体色から作る理由 — 実測】
      //   以前は `mix(cheek, ink, 0.34)` で、cheek は配色に関係のない
      //   固定の桃色（#f2879f）だった。そこへインクを混ぜるので
      //   どの配色でも灰茶〜灰藤になり、緑の体（`6L2Y-5CY8` #94d27a）でも
      //   口の中が #a1907b（灰茶）＝ **穴・傷** に見えていた。
      //   口の中は体の一部なので、体色を暗くした色にする。
      const rw = w;
      const rh = w * 0.66 * (0.86 + smile * 0.2);
      const inner = mix(c.body, c.ink, 0.45);
      let g = path(
        `M${n(x - rw)} ${n(y - rh * 0.2)}Q${n(x)} ${n(y - rh * 1.05)} ${n(x + rw)} ${n(y - rh * 0.2)}` +
        `Q${n(x)} ${n(y + rh * 1.95)} ${n(x - rw)} ${n(y - rh * 0.2)}Z`,
        { fill: inner, stroke: c.inkPaint, width: sw, linejoin: 'round' },
      );
      // 舌。黒い穴にしないための明るい面をひとつだけ。
      // 開口の下縁（y + 0.875rh）より内側で止め、輪郭のインクを侵さない
      // ようにする（以前は舌が縁を越えるので、上から輪郭を引き直していた）。
      g += path(
        `M${n(x - rw * 0.5)} ${n(y + rh * 0.3)}Q${n(x)} ${n(y + rh * 1.1)} ${n(x + rw * 0.5)} ${n(y + rh * 0.3)}Z`,
        { fill: mix(c.cheek, '#ffffff', 0.28) },
      );
      return g;
    }
    case 'pout': {
      // むっ: 口角が下がる。中央に短い縦線を入れて「への字」と区別する。
      const ww = w * 0.8;
      // への字の反りにも下限を置く（機嫌のよい『むっ』が水平線になっていた）
      const d = ww * 0.62 * (0.78 - smile * 0.42);
      let g = path(
        `M${n(x - ww)} ${n(y + d * 0.7)}Q${n(x)} ${n(y - d)} ${n(x + ww)} ${n(y + d * 0.7)}`,
        { stroke: c.inkPaint, width: sw * 1.05 },
      );
      g += path(`M${n(x)} ${n(y - d * 0.42)}l0 ${n(Math.max(2.4, ww * 0.34))}`, {
        stroke: c.inkPaint,
        width: sw * 0.7,
      });
      return g;
    }
    case 'beak': {
      // くちばし: 塗りつぶした小さな三角形の突起。
      //
      // 【参考画像との対応】
      //   製品オーナーの参考資料（口スライド）にあった、鳥のくちばしの
      //   ような塗りつぶし三角形。上辺がほぼまっすぐで、下へ向かって
      //   細くなり尖る。輪郭線で弧を描く他の 6 種とは根本的に描き方が違う
      //   （線ではなく面、しかも丸くない）。
      //
      // 【これは「大きくする」ではない — 積極的に小さくしてある】
      //   形状が小さな三角形なので、他の口より小さくても違和感がない。
      //   標準の口の大きさ感（縮小後の中央値 30.6 前後）から逸脱しない
      //   よう、`faceLayout.MOUTH_W_RATIO` 側で最初からいちばん小さい
      //   倍率を与えている。ここでの半幅・高さの比もそれ以上は広げない。
      //
      // 【色を個体の配色から作る理由】
      //   参考画像は鮮やかな橙のくちばしだが、これを直値で固定すると
      //   配色ファミリーに関係なく全個体が同じ色のくちばしになる。
      //   `accent` は角・耳・尾と同じ由来の「その個体のアクセント色」
      //   なので、これを少し暗くして使えば、配色ごとに個性が出るうえ
      //   体色との対比も自然に保たれる（accent はもともと本体色相から
      //   離れた色を持つ）。
      const bw = w * 0.4;
      const topY = y - bw * 0.52;
      const tipY = y + bw * 0.66;
      const fill = darken(c.accent, 0.12);
      return path(
        `M${n(x - bw)} ${n(topY)}` +
        `Q${n(x)} ${n(topY - bw * 0.14)} ${n(x + bw)} ${n(topY)}` +
        `Q${n(x + bw * 0.18)} ${n(tipY)} ${n(x)} ${n(tipY)}` +
        `Q${n(x - bw * 0.18)} ${n(tipY)} ${n(x - bw)} ${n(topY)}Z`,
        { fill, stroke: c.inkPaint, width: sw * 0.55, linejoin: 'round' },
      );
    }
    case 'fang': {
      // きば: 口の中が暗い、左右非対称なニヤリ口。片側だけに白い牙が 1 本。
      //
      // 【参考画像との対応】
      //   参考資料の口スライドは、左が浅く右へ向かって吊り上がる非対称な
      //   三日月形の暗い開口で、右側の下端から白い牙が 1 本だけ覗く。
      //   左右対称な弧しか無かった既存 6 種に無い形。
      //
      // 【非対称の向きを固定にする理由】
      //   個体ごとに左右をランダムに振ると、この形質の要点である
      //   「非対称であること」自体は保たれるが、
      //   検証時に同じ個体を見比べる作業（?force= の 16 体比較）で
      //   左右どちらの牙かが揺れて確認しづらくなる。要点は非対称の
      //   *向き* ではなく *有無* なので、常に右側へ固定する。
      //
      // 【面積を大きくしない理由 — 製品オーナーの方針】
      //   牙 1 本のインパクトで十分。開口の縦の広がりは『ぽかん』の
      //   小さな o より控えめに抑え、横だけ『むっ』程度に取る。
      const ww = w * 0.62;
      // 左端はほぼ水平、右端は大きく吊り上がる（にやり）。
      const leftY = y + ww * 0.08;
      const rightY = y - ww * 0.34;
      const topCtrl = y - ww * 0.5;
      const botCtrl = y + ww * 0.4;
      // 【0.62 → 0.72 に上げた理由 — 実物で確認】
      //   淡い体色（`B4KQ-YHUV` の ember 等）では 0.62 だと体色と
      //   あまり変わらず、「口の中が暗い」がほとんど読めなかった。
      //   0.72 まで上げるとどの配色でも暗い面として読める。
      const inner = mix(c.body, c.ink, 0.72);
      let g = path(
        `M${n(x - ww)} ${n(leftY)}` +
        `Q${n(x)} ${n(topCtrl)} ${n(x + ww)} ${n(rightY)}` +
        `Q${n(x + ww * 0.25)} ${n(botCtrl)} ${n(x - ww * 0.55)} ${n(leftY + ww * 0.1)}` +
        `Q${n(x - ww * 0.85)} ${n(leftY + ww * 0.06)} ${n(x - ww)} ${n(leftY)}Z`,
        { fill: inner, stroke: c.inkPaint, width: sw, linejoin: 'round' },
      );
      // 牙。右の口角のすぐ内側から、小さく下向きに 1 本だけ。
      // 明るい色なので暗い口の中でもはっきり読める。焦点にはならない
      // 大きさに留める（面積ではなく「1 本ある」ことが要点）。
      const fx = x + ww * 0.48;
      const fy = rightY + ww * 0.14;
      const fw = ww * 0.12;
      const fh = ww * 0.34;
      g += path(
        `M${n(fx - fw)} ${n(fy)}L${n(fx + fw)} ${n(fy)}L${n(fx)} ${n(fy + fh)}Z`,
        { fill: '#fffdf8' },
      );
      return g;
    }
    case 'peek': {
      // したみせ: 丸く開いた口の中に、もう一段明るい塊（舌／歯）が入る。
      //
      // 【『ぽかん』との違い — これが要点】
      //   『ぽかん』(open) は開口の暗い面だけで、中の明るい面は
      //   縁取り程度の細い帯だった。したみせは同じ丸い開口の中に、
      //   はっきり段差のある明るい塊を大きめに持つ。単なる大きさ違いに
      //   ならないよう、内側の塊の「有無」で 2 種を読み分ける。
      //
      // 【外側の開口を『ぽかん』より小さくしてある理由】
      //   製品方針は「大きくする」ではなく、既存の縮小後の大きさ感を
      //   超えないこと。開口そのものは `open` の 1.0 倍ではなく 0.88 倍
      //   に控えて、内側の塊が加わるぶんの見た目の密度は上げても
      //   輪郭の大きさは超えないようにする。
      //
      // 【内側の塊の色を体色から作る理由 — 唇に見せないための約束】
      //   参考画像はピンクの塊（舌）だが、指示書の禁止事項どおり
      //   「人間の唇に見える色」を避ける必要がある。
      //
      // 【`belly` をそのまま明るくするだけでは足りなかった — 実物で確認】
      //   最初は `mix(c.belly, '#fffdf8', 0.35)` で試したが、体色が
      //   淡い配色（例 `B4KQ-YHUV` の ember）では外側の暗い面との
      //   明度差がほとんど付かず、「もう一段明るい塊」が読めなかった。
      //   外側をより暗く、内側は彩度をほぼ落として明度を突き詰めた
      //   「体色相のかけらが残る、ほぼ白い面」にする。これなら
      //   赤い舌にも見えず、どんな体色でも段差がはっきり出る。
      const rw = w * 0.88;
      const rh = w * 0.62 * (0.86 + smile * 0.2);
      const outer = mix(c.body, c.ink, 0.6);
      let g = path(
        `M${n(x - rw)} ${n(y - rh * 0.2)}Q${n(x)} ${n(y - rh * 1.05)} ${n(x + rw)} ${n(y - rh * 0.2)}` +
        `Q${n(x)} ${n(y + rh * 1.95)} ${n(x - rw)} ${n(y - rh * 0.2)}Z`,
        { fill: outer, stroke: c.inkPaint, width: sw, linejoin: 'round' },
      );
      // 内側の塊。舌ではなく「体の中のいちばん明るい面」として作る。
      // 『ぽかん』の舌（0.5rw 幅・0.3rh〜1.1rh）よりひとまわり大きく、
      // 明度差もはっきり付けて「もう一段」の段差を読ませる。
      //
      // 【`warm` で彩度をさらに絞る理由 — 実物で確認して見つけた破綻】
      //   彩度を体色から一律 0.4 倍で作ると、暖色帯（`warmMeat` が高い
      //   配色。おきび・さんご等）の個体では、彩度 26%・明度 91% の面が
      //   まさに「サーモンピンクの肌色」に見えた（`B4KQ-YHUV` の ember
      //   配色 × `dartBand` で実際に確認）。これは指示書が禁じる
      //   「唇に見える色」そのもの。`palette.ts` の `warm`（生肉として
      //   読まれる暖色帯の強さ 0..1）を使って、その帯だけ彩度をさらに
      //   絞り、無彩色に近い白へ寄せる。寒色帯は 0.4 倍のまま変わらない。
      const bh = hexToHsl(c.body);
      const sat = clamp(bh.s * 0.4, 4, 26) * (1 - c.warm * 0.8);
      const inner = hslToHex(c.bodyHue, clamp(sat, 2, 26), 91);
      g += path(
        `M${n(x - rw * 0.62)} ${n(y + rh * 0.16)}` +
        `Q${n(x)} ${n(y + rh * 1.28)} ${n(x + rw * 0.62)} ${n(y + rh * 0.16)}` +
        `Q${n(x)} ${n(y + rh * 0.46)} ${n(x - rw * 0.62)} ${n(y + rh * 0.16)}Z`,
        { fill: inner },
      );
      return g;
    }
    case 'bowl': {
      /**
       * おわん口: 参考画像の「両端が上がった器」。
       *
       * 上辺は中央へ向かって持ち上がり、下辺は浅い U 字になる。
       * 下側に体色相の淡い面を一段だけ入れるが、唇の輪郭や歯は足さない。
       * ひとつの閉じた面として描くので、細い線の笑顔や貼り付けた部品には見えない。
       */
      const ww = w * 0.94;
      const cornerY = y - ww * 0.08;
      const peakY = y - ww * 0.4;
      const bottomY = y + ww * 0.48;
      const fill = mix(c.body, c.ink, 0.56);
      const inner = mix(c.belly, c.paper, 0.18);
      let g = path(
        `M${n(x - ww)} ${n(cornerY)}` +
        `C${n(x - ww * 0.72)} ${n(y - ww * 0.02)} ${n(x - ww * 0.3)} ${n(y - ww * 0.24)} ${n(x)} ${n(peakY)}` +
        `C${n(x + ww * 0.3)} ${n(y - ww * 0.24)} ${n(x + ww * 0.72)} ${n(y - ww * 0.02)} ${n(x + ww)} ${n(cornerY)}` +
        `C${n(x + ww * 0.86)} ${n(y + ww * 0.28)} ${n(x + ww * 0.48)} ${n(bottomY)} ${n(x)} ${n(y + ww * 0.5)}` +
        `C${n(x - ww * 0.48)} ${n(bottomY)} ${n(x - ww * 0.86)} ${n(y + ww * 0.28)} ${n(x - ww)} ${n(cornerY)}Z`,
        { fill, stroke: c.inkPaint, width: sw, linejoin: 'round' },
      );
      // 下側の淡い面。外周から一段内側に置いて、輪郭のインクを残す。
      g += path(
        `M${n(x - ww * 0.56)} ${n(y + ww * 0.2)}` +
        `Q${n(x)} ${n(y + ww * 0.54)} ${n(x + ww * 0.56)} ${n(y + ww * 0.2)}` +
        `Q${n(x + ww * 0.34)} ${n(y + ww * 0.4)} ${n(x)} ${n(y + ww * 0.42)}` +
        `Q${n(x - ww * 0.34)} ${n(y + ww * 0.4)} ${n(x - ww * 0.56)} ${n(y + ww * 0.2)}Z`,
        { fill: inner },
      );
      return g;
    }
    case 'smile':
    default: {
      // にこり: 大きく横に広い弧。
      const ww = w * 0.86;

      // ── 幅広の開口（大きく口を開けて笑う）─────────────────
      //
      // 【なぜ足したか】
      //   口の種類 6 つのうち「面として大きく開いている口」は
      //   『ぽかん』の丸い開口だけで、**横に広い開口型が 1 つも無かった**
      //   （ビジュアル批評 P1-11）。線の弧はどれだけ太くしても引きでは
      //   細い線にしか見えず、口の存在が消える。
      //   よく笑っている子は開いた口で笑う、という自然な理屈で結線するので
      //   新しい遺伝子座を足さずに済み、表情の仕組み（mood.smile）とも噛み合う。
      //
      // 【しきい値を 0.62 にした理由】
      //   LifeState が無いときの smile は性格から作られ、平均で 0.47 前後になる。
      //   0.42 で切ると 9 体中 7 体が開いた口になり、今度は
      //   「みんな同じ大きく開いた口」になった（実際にそうなった）。
      //
      // 【0.62 → 0.56 → 0.78 と動かした理由】
      //   0.62 では出現が 9% しかなく効果が薄いので 0.56 へ下げたが、
      //   今度は実測で 25 体／200 体が大口になり、『ぽかん』と合わせて
      //   **開いた口が 4 体に 1 体** になった。方針は「大きな笑い口は少数」。
      //   しきい値の意味と根拠は `OPEN_SMILE` に書いてある。
      if (smile > OPEN_SMILE) {
        const oh = w * 0.52 * (0.6 + smile * 0.4);
        // 『ぽかん』と同じ理由で、口の中は体色から作る（固定の桃色＋インクだと
        // どの配色でも灰茶になり「穴・傷」に見える）。
        const inner = mix(c.body, c.ink, 0.5);
        let g = path(
          // 上辺はほぼ水平、下辺が大きく垂れる「D を横にした」開口。
          `M${n(x - ww)} ${n(y - oh * 0.18)}` +
          `Q${n(x)} ${n(y - oh * 0.5)} ${n(x + ww)} ${n(y - oh * 0.18)}` +
          `Q${n(x + ww * 0.62)} ${n(y + oh * 1.24)} ${n(x)} ${n(y + oh * 1.28)}` +
          `Q${n(x - ww * 0.62)} ${n(y + oh * 1.24)} ${n(x - ww)} ${n(y - oh * 0.18)}Z`,
          { fill: inner, stroke: c.inkPaint, width: sw, linejoin: 'round' },
        );
        // 舌。黒い穴にしないための明るい面。
        g += path(
          `M${n(x - ww * 0.56)} ${n(y + oh * 0.42)}` +
          `Q${n(x)} ${n(y + oh * 1.5)} ${n(x + ww * 0.56)} ${n(y + oh * 0.42)}Z`,
          { fill: mix(c.cheek, '#ffffff', 0.3) },
        );
        // 【上の歯（白い面）を廃した理由 — 製品オーナーの方針】
        //   歯が一列に並ぶと、それは生きものの口ではなく **人間の笑顔** で、
        //   36 体シートでもいちばん人間くさく見える要素だった。
        //   開いた口が「穴」に見えないための担保は舌の側で足りている。
        return g;
      }

      // 【反りの深さ — 符号を残したまま浅い帯だけ持ち上げる】
      //   元の式（0.34 + smile × 0.66）は smile が -0.5 前後で
      //   ほぼ水平になり、幅 60px・深さ 6px の直線として消えていた。
      //   かといって「下限 + smile」の単純な式にすると、不調のときの
      //   **への字が失われる**。への字＋半目は「一目で不調と分かる」
      //   この作品でいちばん効いている装置なので、絶対に殺せない。
      //   そこで符号（笑い／への字）はそのままに、絶対値だけを
      //   0.4〜1.05 の帯へ写す。どちらへ反っていても引きで読める。
      const raw = smile + 0.05;
      const d =
        // 参考画像のような短くても丸いU字にする。横幅は faceLayout 側で
        // 縮め、ここでは弧の深さだけを少し起こす。
        ww * 1.15 * Math.sign(raw) * lerp(0.4, 1.05, Math.min(1, Math.abs(raw) * 1.1));
      let g = path(`M${n(x - ww)} ${n(y)}Q${n(x)} ${n(y + d)} ${n(x + ww)} ${n(y)}`, {
        stroke: c.inkPaint,
        width: sw,
      });
      // 【口角の跳ね上げ（2 本の短い線）を廃した理由 — 製品オーナーの方針】
      //   「小さな笑顔」は弧 1 本で足りる。口角に線を足すと、
      //   笑顔ではなく **にやりと引いた口元** に見えてきて、
      //   口が小さくなるほどその 2 本が口の輪郭の一部として読まれ、
      //   結果として口が横に広がって見えていた。
      //   線が 1 本になったぶん `mouthSpan` の計算も素直になる。
      return g;
    }
  }
}

/**
 * **実際に描かれる**口の上端・下端（輪郭線の太さ込み）。
 *
 * 【なぜ `MOUTH_UP_RATIO` / `MOUTH_DOWN_RATIO` をそのまま使えないか — 実測】
 *   あの 2 つは bbox 用に「開いた口も含めた最大値」を採ってある。
 *   ところが『にこり』は `mood.smile > OPEN_SMILE` のときだけ開口になり、
 *   それ以外は細い弧を引くだけ。閉じた弧の実測は下へ 0.20w しか広がらないのに、
 *   比の値は 0.68w。**3 倍以上の過大評価** になる。
 *     `UV2L-DPB9` 口の実寸 117.1〜128.2 に対し、比から出すと 96.5〜152.0
 *   模様（たいおび・したたり）は「口の高さを外す」ために口の位置を使うので、
 *   ここが 3 倍ずれると胴に置ける場所が消え、帯や滴が額へ追い出される。
 *   描いている当人（`drawMouth`）と同じ条件で実寸を返す関数を 1 つ持ち、
 *   模様側はこれを見る。
 */
export function mouthSpan(ctx: DrawCtx): { top: number; bot: number } {
  const m = ctx.face.mouth;
  const kind = ctx.parts.mouth;
  // 口を描かない個体では避けるものが無い（禁止帯を作ると帯や滴が
  // 理由もなく胴から追い出される）。
  if (kind === 'none') return { top: m.y, bot: m.y };
  const w = m.w;
  const ink = ctx.strokeW * 0.6;
  let up = w * (MOUTH_UP_RATIO[kind] ?? 0.34);
  let dn = w * (MOUTH_DOWN_RATIO[kind] ?? 0.68);
  const isSmile = kind === 'smile' || MOUTH_UP_RATIO[kind] === undefined;
  if (isSmile && ctx.mood.smile <= OPEN_SMILE) {
    // 閉じた弧 1 本。2 次ベジエの極値は制御点の半分（d/2）で、
    // 両端は y のまま。口角の跳ね上げを廃したので反対側への張り出しは無い。
    const ww = w * 0.86;
    const raw = ctx.mood.smile + 0.05;
    const d = ww * 1.15 * Math.sign(raw) * lerp(0.4, 1.05, Math.min(1, Math.abs(raw) * 1.1));
    const half = Math.abs(d) / 2;
    up = d >= 0 ? 0 : half;
    dn = d >= 0 ? half : 0;
  }
  return { top: m.y - up - ink, bot: m.y + dn + ink };
}

/**
 * 顔を「頬 / 目ごと / 口」の独立したパーツとして返す。
 * 目を個別パーツにしておくと、inspect が bbox 同士の重なりを機械的に検査でき、
 * anim.ts もまばたきの対象を class で選べる。
 */
export function buildFace(ctx: DrawCtx): PartOut[] {
  const c = ctx.colors;
  const face = ctx.face;
  const out: PartOut[] = [];

  /**
   * 顔は必ず体の内側で切る。
   *
   * まぶたの弧・まつげ・口角の跳ね上げは目や口の中心から外向きに伸びるので、
   * 目が体の端に寄った個体では輪郭を突き抜けて「顔の外に線が生えた」絵になる
   * （ビジュアル批評 P0-3）。長さの上限だけでは形状の組み合わせによって
   * 抜けが残るため、描画の側でも体のシルエットで確実に切り落とす。
   */
  const inBody = (svg: string): string =>
    svg ? `<g clip-path="${url(ctx.bodyClip)}">${svg}</g>` : '';

  // 頬（目より下に敷く）
  const blush = 0.5 * ctx.mood.blush;
  let cheekSvg = '';
  let cheekBox: Box | undefined;
  for (const ch of face.cheeks) {
    cheekSvg += ellipse(ch.x, ch.y, ch.rx * 1.05, ch.ry * 1.05, {
      fill: c.cheek,
      opacity: clamp(blush, 0.16, 0.68),
    });
    cheekBox = boxUnion(cheekBox, boxAround(ch.x, ch.y, ch.rx, ch.ry));
  }
  if (cheekSvg) out.push({ id: 'cheeks', z: Z.FACE - 1, svg: inBody(cheekSvg), bbox: cheekBox });

  face.eyes.forEach((slot, i) => {
    const eye = drawEye(ctx, slot, i);
    out.push({
      id: `eye${i}`,
      z: Z.FACE,
      svg: inBody(eye.svg),
      anchor: { id: `eye${i}`, x: slot.x, y: slot.y, angle: 0, scale: slot.s / 16 },
      // bbox は白目の実寸のまま（目どうしの重なり検査の基準なので、
      // まつげを足すと「重なり」の意味そのものが変わってしまう）。
      bbox: boxAround(slot.x, slot.y, slot.rx, slot.ry),
    });
    // まつげは別パーツ。目のすぐ後ろに積むので、z が同じでも配列順で
    // 目の上に描かれる（`model.ts` の並べ替えは安定ソート）。
    if (eye.lashSvg) {
      out.push({
        id: `lash${i}`,
        z: Z.FACE,
        svg: inBody(eye.lashSvg),
        // まつげは矩形ではなく **輪郭上の点** で検査する。
        //
        // 【レビュー C の修正】
        //   以前はまつげがどの検査にも入っておらず、したりめ＋`long` が
        //   宣言 bbox より 11.1 上（目の高さ 12.5）まで描かれていても
        //   `face-outside-body` は 0 件だった。かといって bbox に足すと
        //   矩形の角という **絵の無い場所** を検査してしまい、成体 300 体中
        //   43 件の誤検出が出た（実測）。点で渡すのが正解。
        bbox: boxOfPoints(eye.probes),
        probes: eye.probes,
      });
    }
  });

  const mouthSvg = drawMouth(ctx);
  if (mouthSvg) {
    // bbox は上下非対称にする。どの口も中心より下へ大きく広がるので、
    // 対称の矩形は上端を 0.2〜0.5w も高く見積もり、目の bbox と
    // 必ず重なって見えていた（実測 395/395 体・重なりの中央値 15.5px）。
    // 検査の対象範囲は画面に実際に現れるものと一致していなければならない。
    const upE = Math.max(4, face.mouth.w * (MOUTH_UP_RATIO[ctx.parts.mouth] ?? 0.34));
    const dnE = Math.max(4, face.mouth.w * (MOUTH_DOWN_RATIO[ctx.parts.mouth] ?? 0.68));
    out.push({
      id: 'mouth',
      z: Z.FACE + 1,
      svg: inBody(mouthSvg),
      anchor: { id: 'mouth', x: face.mouth.x, y: face.mouth.y, angle: 0, scale: 1 },
      bbox: {
        x: face.mouth.x - face.mouth.w,
        y: face.mouth.y - upE,
        w: face.mouth.w * 2,
        h: upE + dnE,
      },
    });
  }

  return out;
}

/** まばたき用の変換原点。 */
export function blinkOrigin(ctx: DrawCtx): { x: number; y: number } {
  const ys = ctx.face.eyes.map((e) => e.y);
  return { x: ctx.face.cx, y: ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length) };
}

/** 目の傾き（デバッグ表示用）。 */
export const eyeTiltOf = (dir: number): number => lerp(0, dir * 6, 1);
