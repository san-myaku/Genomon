# ARCHITECTURE.md — 『ゲノモン』構成

## 全体像

```
                  ┌──────────────┐
                  │  src/core    │  型契約・乱数・色  （誰にも依存しない）
                  └──────┬───────┘
             ┌───────────┼───────────┐
             ▼           ▼           ▼
      ┌──────────┐ ┌──────────┐ ┌──────────┐
      │ genetics │ │   save   │ │  audio   │
      └────┬─────┘ └────┬─────┘ └────┬─────┘
           │            │            │
           ▼            │            │
      ┌──────────┐      │            │
      │  render  │      │            │
      └────┬─────┘      │            │
           │            │            │
           └──────┬─────┴────────────┘
                  ▼
            ┌──────────┐
            │   game   │  進行・世話・成長・展示会・ショップ・交配
            └────┬─────┘
                 ▼
            ┌──────────┐
            │    ui    │  画面・演出・入力
            └────┬─────┘
                 ▼
            ┌──────────┐
            │   dev    │  Visual Lab・開発者モード
            └──────────┘
```

**依存は必ず上から下へ一方向。** 下位が上位を import してはならない。
`core` は他のどのモジュールにも依存しない。

---

## データの流れ

```
seed ──► Genotype ──► Phenotype ──► RenderModel ──► SVG 文字列 ──► DOM
          (保存)      (stage 込み)    (detail 込み)
                          ▲
                     LifeState ────────┘
                      (保存)
```

- **`Genotype`** … 保存される不変データ。`seed` と各遺伝子座の対立遺伝子ペアのみ。
- **`Phenotype`** … `phenotypeOf(genotype, stage)` の純粋関数出力。キャッシュ可能。
- **`LifeState`** … 時間とともに変化する状態。保存される。
- **`RenderModel`** … 描画に必要な座標・色・SVG 断片・描画順・アンカー。`Phenotype` + `LifeState` + `detail` から導出。
- **SVG** … `RenderModel.parts` を `z` 昇順に連結した文字列。

**外見は保存しない。** セーブに入るのは `Genotype` と `LifeState` だけで、見た目は毎回この経路で再構成される。

---

## ディレクトリ

```
src/
  core/
    types.ts      全モジュール共通の型契約（正本・リードのみ所有）
    rng.ts        seed 付き PRNG。名前付きサブストリーム
    color.ts      色ユーティリティ・配色ファミリー定義
  genetics/
    loci.ts       遺伝子座と対立遺伝子のカタログ（データ駆動の正本）
    genotype.ts   遺伝子型の生成
    phenotype.ts  遺伝子型 → 表現型（stage 差分を含む）
    breeding.ts   交配・減数分裂・突然変異
    similarity.ts 親子/兄弟の類似度・集団多様性・継承の日本語説明
    naming.ts     名前生成
  render/
    svg.ts        SVG 組み立てユーティリティ
    palette.ts    表現型 → 描画用の色解決
    model.ts      Phenotype + LifeState → RenderModel
    creature.ts   RenderModel → SVG 文字列
    egg.ts        卵の描画
    anim.ts       待機モーション・反応アニメーションの駆動
    parts/        素体・目・口・耳・角・植物・羽・尾・結晶・模様 …
  game/
    config.ts     バランス定数・ショップ商品・展示会設定（データ駆動）
    state.ts      GameState の生成と操作
    care.ts       世話アクションの処理
    growth.ts     成長・孵化・段階変化
    exhibition.ts 展示会の採点
    shop.ts       購入・使用
    breeding.ts   交配の条件判定と実行
    unlocks.ts    解放条件
    tick.ts       時間経過の適用（オフライン分を含む）
  save/
    schema.ts     検証・チェックサム・新規 state
    storage.ts    localStorage 読み書き・バックアップ・復旧
    migrate.ts    バージョン連鎖マイグレーション
  ui/
    app.ts        ルーター・アプリシェル
    screens/      タイトル / 卵選択 / 育成室 / コレクション / 個体詳細 /
                  展示会 / ショップ / 交配 / 設定
    components/   ボタン・カード・ゲージ・ダイアログ・吹き出し・トースト
    styles.css    デザイントークンと共通スタイル
  audio/
    synth.ts      Web Audio API による合成音（外部素材を使わない）
    sfx.ts        効果音の定義と再生
  dev/
    visualLab.ts  開発者用ビジュアル検査画面
    devmode.ts    開発者モードのコマンド
tests/            Vitest（ユニット・統計検証）
e2e/              Playwright（実ブラウザでのゲームループ通し）
```

---

## 主要な不変条件（テストで守る）

1. **同じ `(Genotype, stage, detail)` からは常に同じ SVG が出る。**
   描画パスで `Math.random()` を呼ばない。`tests/` で `Math.random` を監視して検出する。
2. **`detail` は遺伝形質に影響しない。** `full` と `lite` で `Phenotype` は完全一致する。
3. **依存は一方向。** `core` は何も import しない。`genetics` は `core` のみ。
4. **セーブは遺伝子型のみ。** 画像・SVG 文字列を保存しない。
5. **壊れたセーブで起動不能にならない。**

---

## 画面遷移

```
title ──► eggSelect ──► nursery ⇄ detail
                          │  ⇅
                          ├──► collection ──► detail
                          ├──► exhibition   （成体化で解放）
                          ├──► shop         （初回展示会で解放）
                          ├──► breeding     （ショップ解放＋成体2体で解放）
                          └──► settings
                                  └──► visualLab （開発者操作でのみ到達）
```

解放前の画面は導線ごと隠すのではなく、**「今後解放」と条件を明示して表示する**（指示書 §16）。反応しないダミーボタンは置かない。

---

## Visual Lab / 開発者モードへの入り口

通常プレイヤーが誤って入らないよう、次のいずれかでのみ開く。

- URL パラメータ `?dev=1`
- 設定画面のバージョン表記を 7 回連続でタップ

有効化するとヘッダに開発者バッジが出る。無効時は `dev/` のコードパスが一切呼ばれない。
