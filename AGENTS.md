# AGENTS.md — 『ゲノモン』恒久ルール

このファイルは Claude Code・Codex など、このリポジトリで作業する全エージェント共通の
恒久ルールの正本。プロジェクト直下の `CLAUDE.md` はここを参照するだけの薄い層。

**重要な決定・失敗の記録はここではなく Obsidian Vault 側にある**（後述）。
このファイルは「コードを壊さないために守るべきルール」だけを置く。

## プロジェクトの一言まとめ

小さな生きもの「ゲノモン」を育て、かたちの違いを観察し、交配して次の世代を見る
ブラウザゲーム。TypeScript + Vite + SVG 手描画。React 等のフレームワークは使わない
（プレーンな DOM 操作 + CSS）。詳細は [README.md](README.md)。

**リポジトリのルートと npm プロジェクトの場所がずれている**点に注意：
git リポジトリのルートは `genomen/`（このファイルの 1 つ上の階層）だが、
実際の npm プロジェクト（`package.json`・`src/` など）は `genomen/genomon/` にある。
コマンドは必ず `genomon/` ディレクトリで実行すること。

```bash
cd genomon
npm install
npm run dev        # http://localhost:5183 （既存セッションでは 5291 等、他ポートで
                    # 立っていることもある。.claude/launch.json の実ポートを見ること）
```

## 絶対に守ること

### 1. 描画・遺伝・表現型変換のパスで `Math.random()` を使わない

`src/genetics/**`・`src/render/**` は完全に決定論的でなければならない
（同じ `Genotype`（seed + 対立遺伝子ペア）から、常に同じ見た目が再構成される）。
乱数は必ず `Rng`（`src/core/rng.ts`）の**名前付きサブストリーム**を使う
（例: `ctx.rng('antennae')`, `root.stream('express:collar')`）。
名前を変えるとその部位の見た目だけが変わるので、既存の名前は不用意に変えない。

**唯一の正当な例外**（すべて「新しい世界／新しい一覧を始める」ボタンの起点にだけ許可）:
- `src/core/rng.ts` の `makeWorldSeed()`
- `src/sheetMain.ts` の「↻ 再生成」ボタン
- `src/dev/visualLab.ts` の「ランダム seed」ボタン
- `src/audio/synth.ts` のノイズ生成（音は保存対象ではないので決定論性が不要）
- `src/ui/dom.ts` の紙吹雪・パーティクル演出（個体の見た目とは無関係な UI アニメーション）

新しい乱数を足すときは、上のどれかに明確に該当する場合以外は seed 由来の
サブストリームを使うこと。

### 1.5. `src/render/parts/lashSprites.ts` は生成物。手で編集しない

まつげは製品オーナーが描いた原画（`art/eyelashes_sprite.svg`）をそのまま
素材として使っている。`lashSprites.ts` はそれを軽量化して焼き込んだ
**生成ファイル**なので、直接書き換えても次の生成で消える。

```bash
node tools/genLashSprites.mjs   # art/eyelashes_sprite.svg → src/render/parts/lashSprites.ts
```

まつげの見た目を変えたいときは、
- **形そのもの** を変える → 原画 `art/eyelashes_sprite.svg` を差し替えて再生成する
- **置きかた**（大きさ・位置）を変える → `src/render/parts/face.ts` の `LASH_PLACEMENT`

設計の経緯は [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) の D-031 と **D-032**。

### 2. `src/genetics/loci.ts` の対立遺伝子 ID を絶対に削除しない

セーブデータは `Genotype`（seed と対立遺伝子 ID のペア）だけを保存し、
**見た目そのものは保存しない**（毎回 `Genotype → Phenotype → RenderModel` で
再構成する）。そのため、既存個体が持っている可能性のある対立遺伝子 ID を
カタログ配列から削除すると、その個体が読み込み時に該当なしで壊れる。

ある形質を「もう新しく出したくない」場合の正しい手順（`ocelli`（めだま模様）・
`button`（ボタン瞳孔）・`mossRing`（こけの首かざり）・`shard`（かけら結晶）・
`wisp`（ひとすじの毛）で実際に使った手順）:

1. `CAT_LOCI`（`loci.ts`）の配列から該当エントリを削除する
   （これで新規個体には二度と出ない）。
2. 対応する描画コード（`src/render/parts/*.ts` の `case '...'` ブロック）は
   **消さずに残す**。既存セーブがまだその ID を持っている可能性があるため。
   残す場所には `！！このコードは消さないこと！！` という見出しコメントを付け、
   理由（カタログから外れているが現役／消すと個体の見た目が無地に化ける）を書く。
3. `weight`/`dominance` を 0 にするような中途半端なやり方はしない。
   配列から完全に取り除くか、残すかのどちらかにする。

### 2.5. 遺伝子座を新設するときは、カタログの先頭を既定形質にする

セーブされた個体の `cat` には、その座が **存在しない**。読み込み側は
`catPairOrDefault`（`phenotype.ts`）/ `pairOrDefault`（`genetics/breeding.ts`）で
**カタログ配列の先頭の対立遺伝子** をホモで補う。したがって先頭は必ず
`none` 相当の「その形質を持たない」側に置くこと。先頭に派手な形質を置くと、
既存の全個体に一斉にそれが生える。

`Genotype.cat[locus]` を素で添字参照しないこと（`pa[0]` が undefined で落ちる）。
新しく読む場所を足すときは上の 2 つのヘルパーを通す。経緯は
[DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) の **D-037**。

### 2.6. もこもこ（coat=fuzz）の体には輪郭を引かない

房そのものが輪郭を担う。体の輪郭を引き直すと **房の内側に 2 本目の輪郭**が
出て、房が「縁に付けた飾り」に見える（製品オーナー指摘。経緯は
[DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) の **D-038**）。

判定は `coatOwnsOutline()`（`render/parts/coat.ts`）。体の輪郭に沿って
線を引く処理を足すときは、必ず `rimPath()`（`render/parts/body.ts`）を通すこと。
`path(shape.d, { stroke: ... })` を直接書くと、もこもこの個体で輪郭が復活する。
`tests/coat.test.ts` が「体と同じ形を線として描き直しているパーツが無いこと」を
260 個体で機械的に見ている。

### 3. ビルドエントリは `index.html` だけ

`vite.config.ts` の `build` は `index.html`（本体ゲーム）だけを対象にする。
`lab.html`（Visual Lab / 開発者モード）と `sheet.html`（コンタクトシート）は
開発サーバ専用の入口で、**本番ビルド（`dist/`）に含めてはならない**。
これは「開発者機能が配布物に混ざらない」ことの技術的な担保になっている。
`vite.config.ts` に手を入れるときは、ビルド後に `dist/` の中身が
`index.html` 系のファイルだけであることを確認すること。

### 4. 依存の向き（`ARCHITECTURE.md` の要約）

`core` → `genetics`/`save`/`audio` → `render` → `game` → `ui` → `dev` の一方向のみ。
下位のモジュールが上位を import しない。詳細は [ARCHITECTURE.md](ARCHITECTURE.md)。

## 変更を「完了」と呼ぶ前に必ず実行すること

```bash
npx tsc --noEmit     # 型チェック
npx vitest run       # ユニットテスト（現在 250 件・18 ファイル）
npx vite build       # 本番ビルド（dist/ に index.html 系だけが出ること）
npx playwright test  # e2e（初回は `npx playwright install chromium` が要る）
```

見た目（`src/render/**`）を変えたときは、**上記に加えて実際にレンダリングした
SVG を目で見て確認する。** テストが green でも「合成された結果」が意図通りとは
限らない（口の幅だけ見て「直った」と判断し、目との重なりを見落とす、といった
事故が過去に何度もあった）。確認手段は次の「見た目の確認手段」を参照。

自動検査（`tests/inspect.test.ts` / Visual Lab の「自動検査」）の不良率も、
変更前後で悪化していないか必ず比較する。既知の false positive（例:
`ZLNX-BSZ2` の首かざり誤検出）はベースラインとして許容されているが、
**件数を新たに増やしてはいけない。**

**注意**: `tests/_lead_check.test.ts`（「検証後に削除する」と書かれた一時
ファイルの消し忘れ）は 2026-08-15 に削除した。3 件とも `console.log` だけで
**アサーションが 1 つも無く、絶対に落ちないテスト**だったため、残しても
回帰を守れない。同種の「数値を眺めるだけの一時ファイル」を作ったときは、
その場で消すか、アサーションを付けて恒久テストにすること。

## 見た目の確認手段

- `sheet.html?only=<seed1>,<seed2>&stage=adult&size=large&detail=full&zoom=3`
  — 名指しした個体だけを大きく並べる。ビジュアル批評は基本これで行う。
- `sheet.html?force=<locus>:<allele>,...&n=16` — 特定の対立遺伝子をホモ接合で
  強制し、その形質のバリエーションだけを一覧できる。
- `sheet.html?group=<locus>` — 絞り込まずに、種類ごとに見出しを挟んで並べる。
- `sheet.html` の操作パネルは上記 URL パラメータを GUI で組み立てるだけの薄い層。
- `lab.html`（Visual Lab）の「一覧」カードにも同じ「絞り込み」ピックロー
  （部位→種類、最大 3 件）がある（2026-08-12 追加、`src/dev/visualLab.ts` の
  `gridFilters`）。単体表示・自動検査には影響しない、一覧専用のスコープ。
- `lab.html?tab=cards`（Cards Lab）— トレーディングカードの研究環境。
  Showcase 1 枚・Finish 比較 6 枚・Design 比較 3 枚・個体比較 8〜30 枚を
  同時に見られる。カードの美術判断はここで行う（詳細は下の「Cards Lab」）。
- スクリーンショットは Playwright で撮る（このプロジェクトには
  `node_modules/playwright` が既に入っている）。**サブエージェントの
  「確認しました」という自己申告だけを信用せず、必ず自分でも一度は
  実際の画像を見ること。**

## Visual Lab ↔ 人間のフィードバックループ

`docs/lab-feedback.json`（`.gitignore` 済み・実行時に生成される共有ファイル）は、
製品オーナーと AI エージェントの共通のコメント帳。製品オーナーは Visual Lab の
個体カードから「💬 コメントを付けて保存」でコメントを残せる。エージェントが
それを直す側の作法:

- **1 つの seed に複数の issue がある場合、全部直るまで `resolved: true` に
  しない。** 部分的に直しただけで resolved を立てると、残りの issue が
  見過ごされる。ノート欄に `※〜は対応済み` と追記するのはよいが、
  resolved フラグは最後の 1 つが終わってから立てる。
- **Visual Lab 指摘を「解決済み」にする前に、テスト成功や実装者自身の文章を
  根拠にしてはならない。** リードは必ず対象seedを大きく実表示して画像を自分で
  確認する。対立遺伝子カタログを変更した後は seed だけでは以前と同じ表現型を
  再構成できない場合があるため、さらに `sheet.html?force=<locus>:<allele>` で
  指摘された形質と競合する組合せを強制表示し、禁止された見え方（重なり、太線、
  三角形、色切れ等）が残っていないことを確認する。**自動検査0件は、この目視確認の
  代わりにならない。**
- 指摘に「〜はやめて」「〜を削除」「太すぎる」のような否定条件がある場合は、
  修正後にもその見え方へ戻る分岐・線の重ね描き・別の組合せを残さない。個別seedの
  例外で隠さず、同じ描画規則を使う全個体へ効くルールとして直す。
- Visual Lab を開くたびに `syncAndReport()` が自動でこのファイルを
  pull → merge → push する（`mergeSeeds()` はレコードごとに `updatedAt` の
  新しい方を採用）。エージェントがファイルを直接編集するだけで、
  ユーザー側は次にページを開く（または何か 1 つ操作する）だけで
  「対応済み」表示に反映される。
- 並行して複数エージェントが別々の issue を直す場合、必ず着手直前に
  このファイルを読み直してから、自分が担当する seed のエントリだけを
  編集すること（他エージェントの追記を上書きしない）。

## 並行エージェントでの見た目修正（ファイルの担当分け）

見た目の修正を複数エージェントに並列で振るときは、ファイル単位で担当を分け、
**同じファイルを 2 つ以上のエージェントが同時に触らない。**
`src/genetics/loci.ts`（対立遺伝子カタログ）はリード（人間から直接指示を
受けているエージェント）だけが編集する。個々の修正エージェントは
カタログの変更が必要だと判断したら、変更案を報告するだけにとどめ、
実際の編集はしない（複数エージェントが同じカタログファイルを同時に
編集すると衝突・上書き事故になるため）。

`src/core/**`・`src/genetics/**`（カタログ以外は触ってよい場合もある）・
`src/game/**`・`src/save/**`・`src/ui/**`・`tests/**`・`e2e/**` は、
純粋な見た目修正エージェントのスコープ外として渡すのが基本。

## Cards Lab（`lab.html?tab=cards`）

トレーディングカードの **研究環境だけ** が入っている。ゲーム本編には
カードシステムを **まだ一切入れていない**（鑑定所・発行・所持・アルバム・
マーケット・GameState 変更・セーブ移行はすべて未実装）。設計の経緯と
踏んだ失敗は [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) の **D-034**。

守ること:

1. **Visual Lab の設定キー（`genomon.dev.prefs.v1`）へ書かない。**
   Cards Lab は `genomon.dev.cardprefs.v1` / `genomon.dev.cardsaved.v1` を使う
   （`src/dev/cardStore.ts`）。同じキーに書くと、片方を触るたびにもう片方の
   seed や段階が飛ぶ。cardStore.ts は `PREFS_KEY` を import しないことで
   経路そのものを作らないようにしてある。
2. **カード用の個体生成処理を新しく書かない。** `src/dev/gen.ts` の
   `makeSpecimen` / `makeSpecimenNear` / `drawSpecimen` を使う。カードに載る
   ゲノモンは Visual Lab・本編と同一でなければ、見た目の判断が無意味になる。
3. **カードの値も決定論。** `Math.random()` も `Date.now()` も使わない
   （`new Rng(seed).stream('card:...')` を使う）。`tests/cards.test.ts` が
   2 回導出して完全一致することを検査している。
4. **カードの中に置く SVG は `<path>` で描く。** `<rect width="1">` は
   ライブラリ CSS の `.holo-card__content *{width:auto}` に上書きされて
   幅 0 になり、絵が消える（QR で実際に消えた）。
5. **foil マスクの SVG は「描いた所＝箔が出る／透明な所＝箔が出ない」。**
   CSS の `mask-image` は輝度ではなくアルファで切り抜く。黒く塗っても隠れない。
6. **CSS は `src/dev/cardStyles.ts` に置く。** `labStyles.ts`（開発ツール UI）へ
   カードのスタイルを足さない。
7. `@kongyo2/cards-css` は **devDependency**。本編（`index.html` 系）から
   import しない。`npx vite build` 後、`dist/` に `holo-card` の文字列が
   出ないことを確認すること。
8. **スマホでの持ちかたを壊さない**（経緯は D-035）。
   - DOM の並びは「見る場が先」。PC 側は `order` で元に戻しているので、
     並びを変えたら **PC とスマホの両方で目視する**（order を書き忘れると
     設定パネルが 1fr 側へ落ちてカードが潰れる）。
   - カードの大きさは横幅だけで決めない。高さからも上限を掛けないと、
     下端が画面下のデッキバーの裏へ潜る。
   - `cardLab.ts` の `NARROW_PX`（900）と `cardStyles.ts` の
     `@media (max-width:899px)` は **必ず揃える**。片方だけ変えると、
     「畳んであるのにデッキバーが出ない」といった中途半端な幅ができる。
   - 比較と一覧は狭い画面では畳んであり、**開くまで作らない**。
     `renderFinishCmp` などに描画を足すときは、この早期 return を残すこと。
   - **1 端末で見て終わりにしない。** 320 / 360 / 375 / 393 / 428px と横向きを
     測ること。`body` に `overflow-x:hidden` が効いているので
     `scrollWidth === clientWidth` でははみ出しを検出できない
     （実際に 320px で右が 60px 切れているのを見逃した。D-036）。
9. **`cardStyles.ts` の CARD_CSS はテンプレートリテラルの中の CSS**。
   コメントにバッククォートを書くと文字列がそこで終わってビルドが止まる。
   CSS エスケープ（`be` など）も二重に潰れて制御文字になり得るので、
   記号は直接書く。`tests/cards.test.ts` が制御文字と波かっこの対応を見ている。

## ドキュメント地図

- [README.md](README.md) — 起動手順・実装済み機能・未実装項目・遺伝子仕様
- [ARCHITECTURE.md](ARCHITECTURE.md) — モジュール構成とデータの流れ
- [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) — 設計判断の記録と理由（append-only）
- [TEST_REPORT.md](TEST_REPORT.md) — テスト結果の実測値
- [VISUAL_QA.md](VISUAL_QA.md) — ビジュアル評価の結果と指摘事項
- [LOOP_REPORT.md](LOOP_REPORT.md) — 各項目の反復記録

**注意**: 上記のうち `README.md`/`VISUAL_QA.md` の一部数値（ビジュアル品質の
平均点など）は初期実装セッション時点のもので、その後のビジュアル批評ループ
（目・口・白目・触角と角の重複・体の非対称性などの大幅な修正）を反映していない
可能性がある。数値を信じる前に、実際に `sheet.html` で今の見た目を確認すること。

## 人間側の記録（Obsidian Vault）

製品オーナー（非エンジニア）は Obsidian で以下に事実・アイデア・修正依頼を
記録している。コード側のドキュメントに書くべきでない「なぜこの方向にしたいか」
「今後やりたいこと」はそちらが正本:

```
C:\Users\yuhim\Documents\第二次脳（second brain)）\Projects with AI\Genomon\
  README.md      — プロジェクト概要（このファイル執筆時点では未記入）
  アイデア.md      — 今後実装したい機能・修正したい見た目のメモ
  image/          — 参考画像
  ビジュアルのアイデア/ … 参考資料・修正コメントの pptx
    （genomon/ ビジュアルのアイデア/ 配下、Vault の外・プロジェクト直下にもある）
```

このファイル（Vault 上の README.md）が空なので、埋める場合は
「今のプロジェクトの状態」「直近で何をしたか」「次に何をしたいか」の3点を
簡潔に書くのがおすすめ（コードの詳細はここではなく `genomon/` 側のドキュメントへ
リンクするだけでよい）。
