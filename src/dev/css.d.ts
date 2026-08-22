/**
 * CSS を副作用 import するための宣言。
 *
 * Cards Lab は `@kongyo2/cards-css` の付属スタイルシートを読み込む必要があるが、
 * `tsc --noEmit` は `.css` の解決方法を知らない（このプロジェクトは
 * `vite/client` の型を入れていない）。Vite 側は CSS の import を理解するので、
 * 型の穴だけをここで埋める。
 *
 * 【なぜ tsconfig に vite/client を足さなかったか】
 *   tsconfig.json は全モジュール共通の設定で、開発ツールだけの都合で
 *   グローバルな型（import.meta.env など）を増やしたくない。
 *   必要なのは「.css を import できる」ことだけなので、その 1 点に絞る。
 */
declare module '*.css';
