/**
 * Cards Lab の CSS。
 *
 * 【labStyles.ts と分けている理由】
 *   labStyles.ts は「開発ツールの画面」（パネル・ボタン・表）のための質素な CSS で、
 *   Visual Lab と開発者モードが共有している。カードそのものは
 *   **開発ツール UI とは別世界の、高品質なビジュアル**でなければならない。
 *   同じファイルに混ぜると、片方を触ったときにもう片方が壊れる。
 *
 * 【単位の決めかた — cqw】
 *   カードは Showcase（大）・比較（中）・一覧（小）で 3 段階の大きさで出る。
 *   px で組むと縮小時に文字だけ相対的に大きくなって版面が崩れるので、
 *   `.holo-card__content` をコンテナにして、文字も余白も
 *   **カード幅に対する割合**（cqw / %）で決める。どの大きさでも同じ版面になる。
 *
 * 【ライブラリ CSS との関係】
 *   `.holo-card__rotator *` が全子孫に grid/overflow を強制するが、
 *   `.holo-card__content *` がそれを revert する（ライブラリ側の仕様）。
 *   ここのセレクタは必ず `.gmc-card` を先頭に付けて、ライブラリ既定より
 *   詳細度を高く保つ（読み込み順に依存しないため）。
 */

export const CARD_CSS = `
/* ══ Cards Lab の UI（labStyles の語彙を引き継ぐ薄い層） ══ */
.cards-wrap{display:grid;gap:10px;grid-template-columns:minmax(0,1fr);align-items:start}
@media (min-width:1080px){
  .cards-wrap{grid-template-columns:minmax(340px,420px) minmax(0,1fr)}
  /* DOM は「見る場が先」（スマホでカードを最初に見せるため）。
     PC では order で元の並び（左=設定 / 右=カード）に戻す。
     order を書き忘れると、設定パネルが 1fr 側へ落ちてカードが潰れる。 */
  .cards-wrap>.cards-left{order:1;position:sticky;top:52px}
  .cards-wrap>.cards-right{order:2}
}
.cards-left{min-width:0}
/* 【grid-template-columns を必ず書く】
   暗黙のカラムは auto ＝ max-content で決まるので、中に横並びの帯
   （.cards-strip の 6 枚）を置くと 列が 380px に膨らみ、画面が 320px でも
   380px のまま**になる。body の overflow-x:hidden に隠れて横スクロールは
   出ないため、気づかないまま右側が切れていた（実測 2026-08-22）。
   minmax(0,1fr) にして、必ず親の幅へ収める。 */
.cards-right{min-width:0;display:grid;gap:10px;grid-template-columns:minmax(0,1fr)}
.cards-right>*{min-width:0}

.cards-stage{display:flex;flex-direction:column;align-items:center;gap:8px;
  padding:22px 14px;border-radius:12px;border:1.5px solid var(--line);
  background:
    radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,.10), transparent 60%),
    var(--cards-bg,#1a1620);
  transition:background .25s ease}
.cards-stage[data-bg="light"]{--cards-bg:#ddd3c1}
.cards-stage[data-bg="dark"]{--cards-bg:#171320}
.cards-showcase{width:min(88vw,var(--cards-showcase-w,430px));max-width:100%}
.cards-caption{font-size:11px;color:var(--fg-soft);text-align:center;line-height:1.6}
.cards-caption b{color:var(--fg)}

.cards-strip{display:flex;gap:10px;overflow-x:auto;padding:12px 10px 14px;
  border-radius:12px;border:1.5px solid var(--line);background:var(--cards-bg,#1a1620)}
.cards-strip[data-bg="light"]{--cards-bg:#ddd3c1}
.cards-strip[data-bg="dark"]{--cards-bg:#171320}
.cards-slot{flex:0 0 auto;width:var(--slot-w,180px);display:flex;flex-direction:column;gap:5px;
  align-items:center;background:none;border:0;padding:0;cursor:pointer;font:inherit}
.cards-slot .cards-slot-card{display:block;width:100%}
.cards-slot--tile{width:100%}
.cards-slot .cards-slot-label{display:block;width:100%;font-size:10.5px;color:#cdbfae;
  letter-spacing:.06em;text-align:center;font-weight:700;text-transform:uppercase;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cards-slot[aria-pressed="true"] .cards-slot-label{color:#ffd98a}
.cards-slot:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:10px}

.cards-gallery{display:grid;gap:10px;padding:12px 10px;border-radius:12px;
  border:1.5px solid var(--line);background:var(--cards-bg,#1a1620);
  grid-template-columns:repeat(auto-fill,minmax(124px,1fr))}
.cards-gallery[data-bg="light"]{--cards-bg:#ddd3c1}
.cards-gallery[data-bg="dark"]{--cards-bg:#171320}
@media (min-width:900px){.cards-gallery{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}}

/* ── 折りたたみ（狭い画面では既定で閉じ、開くまで中身を作らない） ── */
.cards-fold{background:var(--panel2);border:1.5px solid var(--line);border-radius:10px;
  margin-bottom:10px;overflow:hidden}
.cards-fold>summary{list-style:none;cursor:pointer;padding:9px 11px;display:flex;align-items:center;
  gap:8px;font-size:12px;font-weight:800;letter-spacing:.06em;color:var(--fg-soft);
  -webkit-tap-highlight-color:transparent}
.cards-fold>summary::-webkit-details-marker{display:none}
.cards-fold>summary::after{content:"▾";margin-left:auto;font-size:14px;
  transition:transform .18s ease}
.cards-fold[open]>summary::after{transform:rotate(180deg)}
.cards-fold>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.cards-fold-body{padding:0 11px 11px}
/* 設定は中に .card を並べるので、外側の箱は透明にして二重の枠を作らない。 */
.cards-fold--settings{background:none;border:0;overflow:visible;margin-bottom:0}
.cards-fold--settings>.cards-fold-body{padding:0}
.cards-wrap:not(.cards-wrap--narrow) .cards-fold--settings>summary{display:none}

/* 【seg は折り返す — 実測で 320px からはみ出した】
   labStyles の .seg は inline-flex で折り返さない。段（AUTO + 5 段）と
   版面（4 案）を足したことで、EXCEPTIONAL / Legacy Collector が
   320px の画面から 40〜250px はみ出していた。
   Visual Lab の .seg には触らないよう .cards-wrap で囲う。 */
.cards-wrap .seg{flex-wrap:wrap;max-width:100%}
.cards-wrap .seg button{flex:0 1 auto;min-width:0}

.cards-saved{display:grid;gap:6px}
.cards-saved-item{display:flex;gap:8px;align-items:center;padding:5px 8px;border-radius:8px;
  border:1.5px solid var(--line);background:var(--panel)}
.cards-saved-item .t{flex:1 1 auto;min-width:0;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cards-saved-item .d{font-size:10px;color:var(--fg-soft);white-space:nowrap}

/* ══ カード本体 ══ */
.gmc-card{width:100%;--gmc-serif:"Hiragino Mincho ProN","Yu Mincho",Georgia,"Times New Roman",serif;
  --gmc-sans:"Helvetica Neue",Arial,"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;
  --gmc-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}

.gmc-card .holo-card__content{position:relative;container-type:inline-size;
  background:var(--gmc-paper,#f7f1e3)}

.gmc-card .gmc{position:absolute;inset:0;font-size:3.05cqw;line-height:1.24;
  color:var(--gmc-ink);font-family:var(--gmc-sans);letter-spacing:.01em;
  -webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}

.gmc-card .gmc-paper{position:absolute;inset:0;background-color:var(--gmc-paper);
  background-image:var(--gmc-grain);background-size:100% 100%;background-repeat:no-repeat}
.gmc-card .gmc-paper::after{content:"";position:absolute;inset:0;
  background:radial-gradient(120% 86% at 50% 6%, rgba(255,255,255,.30), transparent 58%),
             radial-gradient(120% 100% at 50% 100%, rgba(0,0,0,.16), transparent 55%)}
.gmc-card--collector .gmc-paper::after{
  background:radial-gradient(110% 70% at 50% 24%,
               color-mix(in srgb, var(--gmc-accent) 16%, transparent), transparent 62%),
             linear-gradient(180deg, rgba(0,0,0,.20), transparent 30%, rgba(0,0,0,.55))}

.gmc-card .gmc-body{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0}

/* 金属質の文字（箔押しの見立て）。ポインタに合わせて艶が動く。 */
.gmc-card .gmc-metal{
  background-image:linear-gradient(100deg,
    var(--gmc-metal-dim) 0%, var(--gmc-metal) 26%, #fff8e4 44%,
    var(--gmc-metal) 62%, var(--gmc-metal-dim) 100%);
  background-size:260% 100%;
  background-position:calc(50% + var(--pointer-dx,0) * 42%) 50%;
  -webkit-background-clip:text;background-clip:text;color:transparent}
.gmc-card--collector .gmc-metal{
  background-image:linear-gradient(100deg,
    var(--gmc-metal-dim) 0%, var(--gmc-metal) 30%, #ffffff 46%,
    var(--gmc-metal) 64%, var(--gmc-metal-dim) 100%)}

.gmc-card .gmc-wordmark{font-family:var(--gmc-serif);font-weight:700;
  letter-spacing:.30em;text-transform:uppercase}

/* ── ゲノモンの窓 ── */
.gmc-card .gmc-art{position:relative;flex:1 1 auto;min-height:0;border-radius:.5em;overflow:hidden}
.gmc-card .gmc-art-bg{position:absolute;inset:0;background:var(--gmc-window);
  box-shadow:inset 0 0 0 .07em rgba(0,0,0,.10)}
.gmc-card .gmc-art-inner{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.gmc-card .gmc-art-inner svg{width:100%;height:100%;display:block}

/* 角の見当（Certified） */
.gmc-card .gmc-ticks i{position:absolute;width:1.05em;height:1.05em;border:.11em solid var(--gmc-metal);opacity:.85}
.gmc-card .gmc-ticks i:nth-child(1){left:.36em;top:.36em;border-right:0;border-bottom:0}
.gmc-card .gmc-ticks i:nth-child(2){right:.36em;top:.36em;border-left:0;border-bottom:0}
.gmc-card .gmc-ticks i:nth-child(3){left:.36em;bottom:.36em;border-right:0;border-top:0}
.gmc-card .gmc-ticks i:nth-child(4){right:.36em;bottom:.36em;border-left:0;border-top:0}

/* 標本板の括弧（Natural History） */
.gmc-card .gmc-brackets i{position:absolute;width:1.5em;height:1.5em;border:.14em solid var(--gmc-ink);opacity:.55}
.gmc-card .gmc-brackets i:nth-child(1){left:.3em;top:.3em;border-right:0;border-bottom:0}
.gmc-card .gmc-brackets i:nth-child(2){right:.3em;top:.3em;border-left:0;border-bottom:0}
.gmc-card .gmc-brackets i:nth-child(3){left:.3em;bottom:.3em;border-right:0;border-top:0}
.gmc-card .gmc-brackets i:nth-child(4){right:.3em;bottom:.3em;border-left:0;border-top:0}
.gmc-card .gmc-scale{position:absolute;left:.7em;bottom:.55em;display:flex;align-items:center;gap:.35em;
  font-family:var(--gmc-mono);font-size:.52em;color:var(--gmc-ink);opacity:.62;letter-spacing:.04em}
.gmc-card .gmc-scale i{display:block;width:3.4em;height:.42em;
  border:.14em solid currentColor;border-top:0;
  background:repeating-linear-gradient(90deg,currentColor 0 .14em,transparent .14em 1.13em)}

/* QR プレースホルダ */
.gmc-card .gmc-qr{width:3.5em;height:3.5em;flex:0 0 auto;border-radius:.18em;overflow:hidden;
  opacity:.9;box-shadow:0 0 0 .08em rgba(0,0,0,.12)}
.gmc-card .gmc-qr svg{display:block;width:100%;height:100%}
.gmc-card--collector .gmc-qr{opacity:.42;box-shadow:0 0 0 .08em rgba(255,255,255,.12)}

/* ── 比較・一覧では、静止状態でも箔を見せる ──
   ライブラリは --card-opacity を 0 から始め、ポインタが乗ったときだけ
   箔を出す。Showcase の 1 枚ならそれで良いが、**比較の 6 枚が全部
   消えていては仕上げを見比べられない**（実際、最初の Finish 比較は
   6 枚とも同じ絵に見えた）。ポインタを模した固定値をここで置いておく。
   ライブラリが操作中に書くのはインラインスタイルなので、触れば必ず勝つ。 */
.gmc-card.gmc-q-medium,
.gmc-card.gmc-q-lite{
  --pointer-x:33%; --pointer-y:26%;
  --background-x:39%; --background-y:31%;
  --pointer-from-center:.52; --pointer-from-left:.33; --pointer-from-top:.26;
  --pointer-dx:-.34; --pointer-dy:-.48}
.gmc-card.gmc-q-medium{--card-opacity:.72}
.gmc-card.gmc-q-lite{--card-opacity:.5}

/* セキュリティ模様のレイヤー：傾けたときだけ濃く出る */
.gmc-card.holo-card .holo-card__layers .holo-card__layer--dna{
  opacity:calc(var(--layer-opacity,.34) * (0.16 + var(--pointer-from-center,0) * 1.05))}

/* ══ Design A — Certified ══ */
.gmc-card--certified .gmc-body{padding:7.2% 7% 5.8%}
.gmc-card--certified .gmc-frame{position:absolute;inset:2.3%;border:.14em solid var(--gmc-metal);
  border-radius:.7em;opacity:.85}
.gmc-card--certified .gmc-frame::after{content:"";position:absolute;inset:.5em;
  border:.055em solid var(--gmc-metal);border-radius:.35em;opacity:.7}

.gmc-card--certified .gmc-c-head{display:flex;align-items:flex-start;gap:.6em}
.gmc-card--certified .gmc-c-title{flex:1 1 auto;min-width:0}
.gmc-card--certified .gmc-wordmark{font-size:1.42em;line-height:1}
.gmc-card--certified .gmc-c-sub{font-size:.56em;letter-spacing:.34em;color:var(--gmc-ink-soft);
  margin-top:.65em;text-transform:uppercase;font-weight:700}
.gmc-card--certified .gmc-c-seal{width:2.9em;height:2.9em;color:var(--gmc-metal);opacity:.9;flex:0 0 auto}
.gmc-card--certified .gmc-c-seal svg{width:100%;height:100%;display:block}

.gmc-card--certified .gmc-c-id{display:flex;align-items:baseline;gap:.6em;
  margin:.9em 0 .5em;padding-bottom:.5em;border-bottom:.12em solid var(--gmc-metal)}
.gmc-card--certified .gmc-c-name{flex:1 1 auto;min-width:0;font-family:var(--gmc-serif);
  font-size:1.72em;line-height:1;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gmc-card--certified .gmc-c-name em{font-style:normal;font-family:var(--gmc-sans);
  font-size:.42em;letter-spacing:.16em;color:var(--gmc-ink-soft);margin-left:.9em}
.gmc-card--certified .gmc-c-cert{font-family:var(--gmc-mono);font-size:.62em;
  letter-spacing:.1em;color:var(--gmc-ink-soft);flex:0 0 auto}

.gmc-card--certified .gmc-art{margin-bottom:.85em;border:.075em solid var(--gmc-rule)}

.gmc-card--certified .gmc-c-grade{display:flex;align-items:center;gap:.75em;margin-bottom:.8em}
.gmc-card--certified .gmc-c-gradebox{width:3.05em;height:2.7em;flex:0 0 auto;
  display:flex;align-items:center;justify-content:center;border-radius:.28em;
  border:.13em solid var(--gmc-metal);
  background:linear-gradient(160deg,rgba(255,255,255,.75),rgba(255,255,255,0))}
.gmc-card--certified .gmc-c-gradebox span{font-family:var(--gmc-serif);font-size:1.95em;
  font-weight:700;line-height:1;color:var(--gmc-ink)}
.gmc-card--certified .gmc-c-gradetext{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:.3em}
.gmc-card--certified .gmc-c-print{flex:0 0 auto;text-align:right}
.gmc-card--certified .gmc-c-print span{font-family:var(--gmc-mono);font-size:.68em;letter-spacing:.08em}
.gmc-card--certified .gmc-c-gradetext b{font-size:.55em;letter-spacing:.34em;color:var(--gmc-ink-soft)}
.gmc-card--certified .gmc-c-gradetext span{font-family:var(--gmc-serif);font-size:.92em;
  letter-spacing:.18em;font-weight:700}
.gmc-card--certified .gmc-c-tier{flex:0 0 auto;font-size:.52em;letter-spacing:.22em;font-weight:800;
  padding:.42em .8em;border-radius:99em;border:.1em solid var(--gmc-metal);color:var(--gmc-ink)}

.gmc-card--certified .gmc-c-spec{display:grid;grid-template-columns:repeat(3,1fr);gap:.5em;
  padding:.62em 0;border-top:.09em solid var(--gmc-rule);border-bottom:.09em solid var(--gmc-rule)}
.gmc-card--certified .gmc-c-spec>div{min-width:0;display:flex;flex-direction:column;gap:.24em}
.gmc-card--certified .gmc-c-spec b{font-size:.5em;letter-spacing:.22em;color:var(--gmc-ink-soft)}
.gmc-card--certified .gmc-c-spec span{font-family:var(--gmc-serif);font-size:.86em;font-weight:700;
  letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gmc-card--certified .gmc-c-spec em{font-style:normal;font-size:.5em;color:var(--gmc-ink-soft);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.gmc-card--certified .gmc-c-foot{display:flex;align-items:flex-end;gap:.6em;margin-top:auto;padding-top:.7em}
.gmc-card--certified .gmc-c-foottext{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:.34em}
.gmc-card--certified .gmc-c-foottext b{font-size:.58em;letter-spacing:.3em;font-weight:800}
.gmc-card--certified .gmc-c-foottext span{font-family:var(--gmc-mono);font-size:.5em;
  color:var(--gmc-ink-soft);letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ══ Design B — Natural History ══ */
.gmc-card--natural .gmc-body{padding:6.4% 7.2% 5.2%}
.gmc-card--natural .gmc-frame{position:absolute;inset:2.6%;border:.09em solid var(--gmc-ink);
  border-radius:.4em;opacity:.42}
.gmc-card--natural .gmc-frame::after{content:"";position:absolute;inset:.42em;
  border:.05em solid var(--gmc-ink);opacity:.4;border-radius:.22em}

.gmc-card--natural .gmc-n-head{padding-bottom:.5em;border-bottom:.14em solid var(--gmc-ink);
  display:flex;align-items:baseline;justify-content:space-between;gap:.6em;flex-wrap:wrap}
.gmc-card--natural .gmc-wordmark{font-size:1.12em;line-height:1;color:var(--gmc-ink);
  background:none;-webkit-background-clip:border-box;background-clip:border-box}
.gmc-card--natural .gmc-n-sub{font-size:.5em;letter-spacing:.26em;color:var(--gmc-ink-soft);font-weight:700}
.gmc-card--natural .gmc-n-head::after{content:"";display:block;width:100%;height:.05em;
  background:var(--gmc-ink);opacity:.55;margin-top:.4em}

.gmc-card--natural .gmc-n-id{display:flex;align-items:baseline;gap:.5em;margin:.6em 0 .55em}
.gmc-card--natural .gmc-n-name{flex:1 1 auto;min-width:0;font-family:var(--gmc-serif);font-size:1.42em;
  letter-spacing:.07em;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gmc-card--natural .gmc-n-name em{font-style:italic;font-size:.46em;letter-spacing:.1em;
  color:var(--gmc-ink-soft);margin-left:.8em}
.gmc-card--natural .gmc-n-no{font-family:var(--gmc-mono);font-size:.56em;color:var(--gmc-ink-soft);flex:0 0 auto}

.gmc-card--natural .gmc-art{flex:0 0 34%;margin-bottom:.7em;border:.06em solid var(--gmc-ink);
  border-radius:.2em}
.gmc-card--natural .gmc-art-bg{
  background-color:var(--gmc-window);
  background-image:
    linear-gradient(0deg,rgba(44,58,56,.09) .06em,transparent .06em),
    linear-gradient(90deg,rgba(44,58,56,.09) .06em,transparent .06em);
  background-size:1.5em 1.5em}

.gmc-card--natural .gmc-n-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:.4em;
  padding:.5em 0;border-top:.05em solid var(--gmc-ink);border-bottom:.05em solid var(--gmc-ink)}
.gmc-card--natural .gmc-n-meta>div{display:flex;flex-direction:column;gap:.22em;min-width:0}
.gmc-card--natural .gmc-n-meta b{font-size:.46em;letter-spacing:.2em;color:var(--gmc-ink-soft)}
.gmc-card--natural .gmc-n-meta span{font-family:var(--gmc-serif);font-size:.92em;font-weight:700;letter-spacing:.08em}

.gmc-card--natural .gmc-n-sec{padding:.5em 0;border-bottom:.05em solid var(--gmc-ink)}
.gmc-card--natural .gmc-n-sec.gmc-n-last{border-bottom:0}
.gmc-card--natural .gmc-n-sec h4{margin:0 0 .38em;font-size:.46em;letter-spacing:.28em;
  font-weight:800;color:var(--gmc-ink-soft)}

.gmc-card--natural .gmc-n-ped{display:flex;align-items:center;gap:.5em}
.gmc-card--natural .gmc-n-parents{display:flex;flex-direction:column;gap:.34em;flex:0 0 auto;
  font-family:var(--gmc-mono);font-size:.54em;letter-spacing:.04em;color:var(--gmc-ink-soft);
  line-height:1}
.gmc-card--natural .gmc-ped-svg{width:1.5em;height:2.3em;flex:0 0 auto;display:block}
.gmc-card--natural .gmc-n-child{font-family:var(--gmc-mono);font-size:.74em;font-weight:700;
  letter-spacing:.06em;flex:0 0 auto}
.gmc-card--natural .gmc-n-house{margin-left:auto;font-size:.46em;letter-spacing:.2em;
  color:var(--gmc-ink-soft);font-weight:700;text-align:right;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}

.gmc-card--natural .gmc-n-dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:.16em .7em;align-items:baseline}
.gmc-card--natural .gmc-n-dl dt{font-size:.46em;letter-spacing:.18em;color:var(--gmc-ink-soft);font-weight:700}
.gmc-card--natural .gmc-n-dl dd{margin:0;min-width:0;font-size:.62em;letter-spacing:.08em;font-weight:700;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gmc-card--natural .gmc-n-dl dd.on{color:var(--gmc-metal)}
.gmc-card--natural .gmc-n-dl dd em{font-style:normal;font-weight:400;font-size:.86em;
  color:var(--gmc-ink-soft);margin-left:.6em}
.gmc-card--natural .gmc-n-dl dd.ja{font-weight:400;color:var(--gmc-ink-soft)}


.gmc-card--natural .gmc-n-show{margin:0;display:flex;align-items:baseline;gap:.6em;min-width:0}
.gmc-card--natural .gmc-n-show b{font-family:var(--gmc-serif);font-size:.86em;letter-spacing:.06em;flex:0 0 auto}
.gmc-card--natural .gmc-n-show span{font-size:.5em;letter-spacing:.14em;color:var(--gmc-ink-soft);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gmc-card--natural .gmc-n-none span{opacity:.7}

.gmc-card--natural .gmc-n-foot{display:flex;align-items:flex-end;gap:.6em;margin-top:auto;padding-top:.55em}
.gmc-card--natural .gmc-n-strip{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:.3em}
.gmc-card--natural .gmc-n-strip span{font-family:var(--gmc-mono);font-size:.5em;letter-spacing:.1em;
  color:var(--gmc-ink-soft)}
.gmc-card--natural .gmc-n-strip i{display:block;height:.85em;
  background:repeating-linear-gradient(90deg,
    var(--gmc-ink) 0 .1em,transparent .1em .26em,
    var(--gmc-ink) .26em .34em,transparent .34em .62em);
  opacity:.55}

/* ══ Design C — Collector ══ */
.gmc-card--collector .gmc-body{padding:5.4% 5.6% 5.4%}
.gmc-card--collector .gmc-k-rail{display:flex;align-items:center;justify-content:space-between;
  gap:.6em;padding-bottom:.5em}
.gmc-card--collector .gmc-wordmark{font-size:.76em;letter-spacing:.44em}
.gmc-card--collector .gmc-k-stamp{font-size:.5em;letter-spacing:.3em;font-weight:800;
  padding:.35em .75em;border-radius:99em;color:var(--gmc-ink);
  border:.09em solid var(--gmc-rule);background:rgba(255,255,255,.05)}

/* 窓の枠は作らない。背景がカード全面にあるので、切れ目が出ると
   「絵を貼った板」に見える。 */
.gmc-card--collector .gmc-art{flex:1 1 auto;overflow:visible}
.gmc-card--collector .gmc-art-bg{display:none}
.gmc-card--collector .gmc-k-backdrop{position:absolute;inset:-4%;
  background-image:var(--gmc-backdrop);background-size:100% 100%;background-repeat:no-repeat;
  opacity:.72;mix-blend-mode:screen;
  transform:translate3d(calc(var(--pointer-dx,0) * -7px), calc(var(--pointer-dy,0) * -7px), 0)}
.gmc-card--collector .gmc-k-halo{position:absolute;inset:0;
  background:radial-gradient(46% 30% at 50% 38%,
    color-mix(in srgb, var(--gmc-glow) 40%, transparent), transparent 72%);
  mix-blend-mode:screen;opacity:.6}
/* 文字を置く下半分だけ、背景を落ち着かせる幕。 */
.gmc-card--collector .gmc-k-scrim{position:absolute;inset:0;
  background:linear-gradient(180deg, transparent 52%, rgba(6,4,12,.62) 76%, rgba(6,4,12,.88))}
.gmc-card--collector .gmc-art-inner{
  transform:translate3d(calc(var(--pointer-dx,0) * 3px), calc(var(--pointer-dy,0) * 3px), 0);
  filter:drop-shadow(0 .32em .5em rgba(0,0,0,.5))}

.gmc-card--collector .gmc-k-info{display:flex;flex-direction:column;gap:.42em}
.gmc-card--collector .gmc-k-name{font-family:var(--gmc-sans);font-size:1.85em;font-weight:800;
  letter-spacing:.1em;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  color:var(--gmc-ink)}
.gmc-card--collector .gmc-k-name em{font-style:normal;font-size:.38em;font-weight:600;
  letter-spacing:.24em;color:var(--gmc-ink-soft);margin-left:.9em}
.gmc-card--collector .gmc-k-rule{height:.09em;background:linear-gradient(90deg,
  var(--gmc-accent), transparent 78%);opacity:.9}
.gmc-card--collector .gmc-k-stats{display:flex;gap:1.3em}
.gmc-card--collector .gmc-k-stats>div{display:flex;align-items:baseline;gap:.42em;min-width:0}
.gmc-card--collector .gmc-k-stats b{font-size:.46em;letter-spacing:.24em;color:var(--gmc-ink-soft)}
.gmc-card--collector .gmc-k-stats span{font-size:.88em;font-weight:800;letter-spacing:.06em}
.gmc-card--collector .gmc-k-foot{display:flex;align-items:center;gap:.7em;margin-top:.2em}
.gmc-card--collector .gmc-k-print{font-family:var(--gmc-mono);font-size:.62em;letter-spacing:.14em;
  font-weight:700;color:var(--gmc-ink)}
.gmc-card--collector .gmc-k-tier{flex:1 1 auto;font-size:.46em;letter-spacing:.3em;font-weight:800;
  color:var(--gmc-ink-soft)}

/* ══ フレーバー ══
   【大きさの決めかた】
   最初の版は 1.42cqw で組まれていて、430px のカードで **6.1px** しかなく
   読めなかった（実測）。文として読ませるものなので、他の小さなラベルとは
   別に下限を持たせる。1 行に押し込まず 2 行まで許し、文の途中で
   三点リーダに切られないようにする。 */
.gmc-card .gmc-flavor{display:flex;flex-direction:column;gap:.14em;min-width:0}
.gmc-card .gmc-flavor b{font-size:.46em;letter-spacing:.22em;color:var(--gmc-ink-soft);font-weight:800}
.gmc-card .gmc-flavor span{font-family:var(--gmc-serif);font-size:.78em;line-height:1.5;
  letter-spacing:.02em;color:var(--gmc-ink);
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}

.gmc-card--certified .gmc-flavor{margin-top:.55em;padding-top:.5em;
  border-top:.05em solid var(--gmc-rule)}
/* 【Natural History だけ 1 行にする — 実測で 6px あふれた】
   3 案のうち Natural History がいちばん情報量が多い版面で、
   ここに 2 行ぶん足すとカードからあふれた。標本記録の「備考」は
   もともと 1 行の書き込みなので、版面としても 1 行のほうが正しい。 */
.gmc-card--natural .gmc-flavor{margin-top:.34em;padding-top:.34em;
  flex-direction:row;gap:.6em;align-items:baseline}
.gmc-card--natural .gmc-flavor b{flex:0 0 auto}
.gmc-card--natural .gmc-flavor span{font-style:italic;font-size:.66em;
  -webkit-line-clamp:1;min-width:0}
/* Collector は文字が最小限の版面。絵の下に 1 か所だけ、静かに置く。 */
.gmc-card--collector .gmc-flavor{margin-bottom:.5em}
.gmc-card--collector .gmc-flavor b{color:var(--gmc-metal-dim)}
.gmc-card--collector .gmc-flavor span{color:var(--gmc-ink-soft);font-size:.74em;-webkit-line-clamp:2}

/* ══ 小さいカード（一覧・比較）で潰れる要素を間引く ══ */
.gmc-q-lite .gmc-c-spec em,
.gmc-q-lite .gmc-n-house,
.gmc-q-lite .gmc-c-foottext span,
.gmc-q-lite .gmc-n-strip span{display:none}
.gmc-q-lite .gmc-qr{opacity:.5}
/* 比較（150px 前後）では文は読めないので、版面の占有だけ見せる。 */
.gmc-q-medium .gmc-flavor span{-webkit-line-clamp:1}

/* ══ 親指の届く所（スマホのデッキバー） ══ */
/*
   カードは手に持って眺めるものなので、判断もスマホでできないと意味がない。
   「つぎのカード」を画面下に固定して、片手で次々にめくれるようにする。
   広い画面では出さない（マウスなら設定パネルのほうが速い）。
*/
.cards-deck{display:none}

@media (max-width:899px){
  /* カードが最初に見えるように、見る場と設定を入れ替える。 */
  .cards-wrap{gap:8px}
  .cards-wrap>.cards-right{order:1}
  .cards-wrap>.cards-left{order:2}
  /* デッキバーに隠れない高さを確保する（.lab-body は他タブと共有なので触らない）。
     デッキの高さは幅によって 1 段 / 2 段に変わるので、変数で 1 か所にまとめる。 */
  .cards-wrap{--cards-deck-h:69px;padding-bottom:calc(var(--cards-deck-h) + 10px)}

  .cards-showcard{position:relative}
  .cards-showcard>h2{display:none}
  .cards-stage{padding:14px 8px 12px}
  /* 【カードを画面に収める】
     スマホでは「スクロールせずに 1 枚まるごと見えて、親指の所に
     つぎのカードがある」ことが最優先。横幅だけで決めると、カードの下端が
     デッキバーの裏に潜る（実測で 29px 隠れていた）。高さからも上限を掛ける。
     引き算しているのはヘッダ・台紙の余白・説明文・デッキバーの合計。
     svh を使うのは、スマホのアドレスバーの伸縮で 100vh がずれるため。 */
  /* max() の下限は、横向き（高さ 390px 程度）で高さから決めると
     カードが 83px まで潰れたため（実測）。潰れるくらいならスクロールさせる。 */
  .cards-showcase{width:min(94vw,var(--cards-showcase-w,430px),
    max(200px, calc((100vh - 205px - var(--cards-deck-h,69px)) * 0.716)))}
  .cards-caption{font-size:11px;line-height:1.45;padding:0 4px}
  /* 3 行に収める（折り返すとカードがデッキバーの裏へ潜る）。 */
  .cards-cap-sub{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cards-cap-tip{margin-top:1px;font-size:10px}

  /* 指で押せる大きさにする（既定は 12px / 高さ 26px 前後で小さすぎる）。 */
  .cards-wrap button,
  .cards-wrap select,
  .cards-wrap input[type=text],
  .cards-wrap input[type=number]{min-height:40px;font-size:14px}
  .cards-wrap .seg button{min-height:40px;padding:0 15px}
  .cards-wrap label.f{font-size:13px}
  .cards-wrap input[type=range]{height:34px;flex:1 1 120px}
  /* 既定のチェックボックスは 13px 角しかなく、指では押せない。
     箱を大きくするだけでなく、ラベル全体を押せる高さにする。 */
  .cards-wrap input[type=checkbox]{width:22px;height:22px;flex:0 0 auto}
  .cards-wrap label.f:has(input[type=checkbox]){min-height:44px;padding:0 4px;
    border-radius:9px;background:var(--panel)}
  .cards-fold>summary{padding:13px 12px;font-size:13px;min-height:46px}

  .cards-slot{width:var(--slot-w,150px)}
  .cards-strip{padding:10px 8px 12px;scroll-snap-type:x proximity}
  .cards-slot{scroll-snap-align:center}
  .cards-gallery{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}

  /* トーストがデッキバーの裏に隠れないよう持ち上げる。 */
  #lab-toast{bottom:86px}

  .cards-deck{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;
    gap:6px;padding:8px 8px calc(8px + env(safe-area-inset-bottom,0px));
    background:color-mix(in srgb, var(--panel) 92%, transparent);
    border-top:1.5px solid var(--line);
    box-shadow:0 -6px 18px rgba(0,0,0,.22);
    backdrop-filter:blur(8px)}
  .cards-deck-btn{flex:0 0 auto;min-height:52px;min-width:52px;border-radius:12px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
    font-size:15px;font-weight:800;-webkit-tap-highlight-color:transparent}
  .cards-deck-main{flex:1 1 auto;background:var(--accent);color:var(--accent-ink);
    border-color:var(--accent);font-size:16px;letter-spacing:.06em}
  .cards-deck-main:hover{color:var(--accent-ink)}
  .cards-deck-main:active{transform:scale(.97)}
  .cards-deck-swap{flex:0 0 auto;max-width:86px;padding:4px 8px}
  .cards-deck-swap i{font-style:normal;font-size:9.5px;letter-spacing:.14em;color:var(--fg-soft)}
  .cards-deck-swap b{font-size:11.5px;font-weight:800;max-width:70px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cards-deck-save{font-size:20px;color:var(--warn)}
  .cards-deck-btn[disabled]{opacity:.35}
}

@supports (height:100svh){
  @media (max-width:899px){
    .cards-showcase{width:min(94vw,var(--cards-showcase-w,430px),
      max(200px, calc((100svh - 205px - var(--cards-deck-h,69px)) * 0.716)))}
  }
}

/* 少し狭い画面では、デッキの「版面／箔／面」を細くして「つぎ」を最大化する。 */
@media (max-width:620px){
  .cards-deck-swap{max-width:62px}
  .cards-deck-swap b{max-width:48px;font-size:10.5px}
  .cards-deck-main{font-size:15px}
}

/*
   【閾値を 360px から 480px へ広げた — ボタンが 1 つ増えたため】
     元は 5 つ（戻る・つぎ・版面・箔・保存）で、360px 以下だけが 2 段だった。
     裏返しの「面」を足して 6 つになり、393px で
     「つぎのカード」が 73px まで潰れて 2 行に折り返す計算になる
     （52 + 62x3 + 52 + すき間 30 = 320px を引くと 47px しか残らない）。
     余裕を持って 480px 以下は 2 段にし、**主役を最下段の全幅**へ置く
     （親指にいちばん近い所が主役）。
     ボタンを足すときは、必ずここの計算をやり直すこと。
*/
@media (max-width:480px){
  .cards-wrap{--cards-deck-h:112px}
  .cards-deck{flex-wrap:wrap}
  .cards-deck-btn:not(.cards-deck-main){order:1;flex:1 1 auto;min-width:0;min-height:42px}
  .cards-deck-main{order:2;flex:1 0 100%;min-height:48px;font-size:16px}
  .cards-deck-swap{max-width:none}
  .cards-deck-swap b{max-width:none;font-size:10.5px}
  /* トーストが 2 段のデッキバーの裏に隠れないよう、さらに持ち上げる。 */
  #lab-toast{bottom:128px}
}

/*
   横向き・低い画面。縦長のカードを丸ごと収めるのは物理的に無理なので、
   ここだけは「収める」をあきらめてスクロールを許す。そのかわり
   デッキバーと説明文を薄くして、見えている面積をカードに回す。
*/
@media (max-width:899px) and (max-height:520px){
  .cards-wrap{--cards-deck-h:58px}
  .cards-deck{padding:5px 8px calc(5px + env(safe-area-inset-bottom,0px))}
  .cards-deck-btn,.cards-deck-main{min-height:44px}
  .cards-cap-sub,.cards-cap-tip{display:none}
  .cards-stage{padding:10px 8px 8px}
  /* どうせ少しスクロールするので、高さからの上限はやめて幅で決める。
     200px（縦向き用の下限）のままだと、横に余っているのに小さすぎた。 */
  .cards-showcase{width:min(40vw,var(--cards-showcase-w,430px),340px)}
}

/* ══ カードの真下の操作列（PC の主動線）══
   スマホのデッキバーと同じ並びを、固定バーではなくカードの直下に置く。
   「つぎのカード」が設定パネルの中にしか無かったので、PC では
   めくるたびにカードから目を離して左端まで狙う必要があった。 */
.cards-deal{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;
  gap:7px;margin-top:4px}
.cards-deal button{min-height:34px}
.cards-deal-main{min-width:150px;font-weight:700}
.cards-deal-save{color:var(--warn);font-size:15px;line-height:1}
.cards-deal button[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink);
  border-color:var(--accent)}
.cards-deal button[disabled]{opacity:.4}
.cards-deal .cards-deal-keys{flex:1 1 100%;margin:0;text-align:center;font-size:10.5px}
.cards-deal kbd{display:inline-block;min-width:1.5em;padding:0 4px;border-radius:4px;
  border:1px solid var(--line);background:var(--panel);font-family:monospace;
  font-size:10px;line-height:16px;text-align:center;color:var(--fg)}

/* 説明文の役割分担。広い画面ではキーの案内（.cards-deal-keys）が同じことを
   言っているので、説明文側の「タップ／左右スワイプ」は出さない
   （PC には無い操作なので、そのまま出すと嘘になる）。 */
@media (min-width:900px){
  .cards-cap-tip{display:none}
}

@media (max-width:899px){
  /* 狭い画面ではデッキバーと左右スワイプが同じ役割を担う。二重に置かない。 */
  .cards-deal{display:none}
}

.cards-count{display:inline-block;margin-left:.4em;padding:1px 7px;border-radius:99px;
  background:var(--panel);border:1px solid var(--line);font-size:10px;color:var(--fg-soft)}
.cards-cap-sub{display:block;margin-top:2px}
.cards-cap-tip{display:block;margin-top:3px;font-size:10.5px;opacity:.75}

/* ══ 動きへの配慮 ══ */
@media (prefers-reduced-motion:reduce){
  .gmc-card .holo-card__translater,
  .gmc-card .holo-card__rotator,
  .gmc-card .holo-card__shine,
  .gmc-card .holo-card__glare{transition:none !important}
  .gmc-card--collector .gmc-k-backdrop,
  .gmc-card--collector .gmc-art-inner{transform:none}
  .cards-stage{transition:none}
  .cards-deck-main:active{transform:none}
}
/* ══════════════════════════════════════════════════════════
   Collector v2 ── 表（見るカード）
   ══════════════════════════════════════════════════════════
   【版面の縦の取りかた】
     レール 4% / 絵 62% / 情報 24% / 脚（フレーバー）10%
   文字情報を増やしても、絵は縦の 6 割を保つ（主役はゲノモン・§5）。
   絵は flex:1 1 auto なので、情報欄の行数が増えたぶんだけ絵が痩せる。
   欄を足すときは必ず 430px で実物を見て、絵が潰れていないか確かめること。 */

/* 【左寄せを明示する — ライブラリが text-align:center を掛けている】
   .holo-card 側の中央寄せがそのまま降りてきて、名前とフレーバーだけが
   中央に寄っていた（flex の行は左に出るので、混在して余計に目立つ）。
   版面の基準は左なので、body でいったん左へ戻す。 */
.gmc-card--collectorV2 .gmc-body{padding:5.2% 5.6% 4.6%;text-align:left}
.gmc-card .gmc-b-body{text-align:left}

/* 背景・後光・幕はカード全面。窓の中だけに入れると光の帯が縁で切れて
   「絵を貼った板」に見える（旧 Collector と同じ判断）。 */
.gmc-card--collectorV2 .gmc-art{flex:1 1 auto;overflow:visible;min-height:0}
.gmc-card--collectorV2 .gmc-art-bg{display:none}
.gmc-card--collectorV2 .gmc-k-backdrop{position:absolute;inset:-4%;
  background-image:var(--gmc-backdrop);background-size:100% 100%;background-repeat:no-repeat;
  opacity:calc(.42 * var(--gmc-backdrop-amount,1));mix-blend-mode:screen;
  transform:translate3d(calc(var(--pointer-dx,0) * -7px), calc(var(--pointer-dy,0) * -7px), 0)}
.gmc-card--collectorV2 .gmc-k-halo{position:absolute;inset:0;
  background:radial-gradient(44% 27% at 50% 33%,
    color-mix(in srgb, var(--gmc-glow) 38%, transparent), transparent 72%);
  mix-blend-mode:screen;opacity:calc(.42 * var(--gmc-backdrop-amount,1))}
/* 情報欄の下半分だけ地を沈める。v2 は情報が多いぶん、旧 Collector より
   幕の立ち上がりを上（44%）にしてある。 */
.gmc-card--collectorV2 .gmc-k-scrim{position:absolute;inset:0;
  background:linear-gradient(180deg, transparent 44%, rgba(4,3,8,.66) 66%, rgba(4,3,8,.93) 84%)}
/* 絵は「窓いっぱい」より少し大きく出す。描画 SVG 自身が余白を持っているので、
   等倍だと窓の中で一回り小さく見える（絵の上下に 10% ずつ空いていた）。
   窓は overflow:visible なので、はみ出しても切れない。 */
.gmc-card--collectorV2 .gmc-art-inner{
  transform:translate3d(calc(var(--pointer-dx,0) * 3px), calc(var(--pointer-dy,0) * 3px), 0) scale(1.08);
  filter:drop-shadow(0 .32em .5em rgba(0,0,0,.5))}

/* ── 縁 ──
   段の材質そのもの。実際に光らせるのは foil マスクの border ゾーンなので、
   ここは「線があるかどうか・太さ」だけを持つ。 */
.gmc-card .gmc-v-edge{position:absolute;inset:2.1%;border-radius:.62em;pointer-events:none;
  border:.06em solid rgba(255,255,255,.055)}
.gmc-card[data-rank="notable"] .gmc-v-edge{border-color:rgba(255,255,255,.14)}
.gmc-card[data-rank="rare"] .gmc-v-edge{border-width:.1em;border-color:rgba(206,214,232,.5)}
.gmc-card[data-rank="exceptional"] .gmc-v-edge{border-width:.12em;border-color:rgba(238,205,133,.6);
  box-shadow:inset 0 0 0 .05em rgba(238,205,133,.18)}
.gmc-card[data-rank="mythic"] .gmc-v-edge{border-width:.12em;border-color:rgba(226,214,255,.72);
  box-shadow:inset 0 0 0 .05em rgba(190,160,255,.25), inset 0 0 1.1em -.3em rgba(190,160,255,.4)}

/* ── 上のレール ── */
.gmc-card--collectorV2 .gmc-v-rail{display:flex;align-items:center;justify-content:space-between;
  gap:.6em;padding-bottom:.3em;min-width:0}
.gmc-card--collectorV2 .gmc-wordmark{font-size:.76em;letter-spacing:.42em;color:var(--gmc-ink)}
.gmc-card .gmc-v-pips{flex:0 0 auto;display:flex;gap:.18em;font-size:.66em;line-height:1}
.gmc-card .gmc-v-pips i{font-style:normal;color:var(--gmc-metal-dim);opacity:.45}
.gmc-card .gmc-v-pips i.on{color:var(--gmc-metal);opacity:1;
  text-shadow:0 0 .35em color-mix(in srgb, var(--gmc-accent) 55%, transparent)}
.gmc-card[data-rank="mythic"] .gmc-v-pips i.on{color:#fff;
  text-shadow:0 0 .5em rgba(220,190,255,.9), 0 0 .9em rgba(140,200,255,.5)}

/* ── 情報欄 ── */
/* 【右 23% を認証印のために空けておく】
   最初は印をカード全体に対する % で置いていたが、絵は flex:1 1 auto で
   伸びるので情報欄の位置が個体ごとに動き、**印が段の帯に重なって
   点数を隠した**（実測: 印 67.7〜83.3% / 帯 79.2〜83.4%）。
   位置を推測せず、情報欄そのものに右の柱を予約する。 */
.gmc-card--collectorV2 .gmc-v-info{position:relative;flex:0 0 auto;display:flex;
  flex-direction:column;gap:.3em;padding-top:.35em;padding-right:23%}

/* 段の帯。ここだけで「一瞬で格が分かる」ことを担保する（§6）。 */
.gmc-card .gmc-v-band{display:flex;align-items:baseline;justify-content:space-between;gap:.6em;
  padding:.3em .6em;border-radius:.26em;min-width:0;position:relative;overflow:hidden}
.gmc-card .gmc-v-rankname{font-size:1.12em;font-weight:900;letter-spacing:.18em;line-height:1.05;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.gmc-card[data-rank="exceptional"] .gmc-v-rankname{font-size:.9em;letter-spacing:.1em}
.gmc-card .gmc-v-score{flex:0 0 auto;font-family:var(--gmc-mono);font-size:1.02em;font-weight:800;
  letter-spacing:.02em;line-height:1}

/* 段ごとの素材。文字色だけを変えるのではなく、帯そのものの材質を変える（§7）。 */
.gmc-card .gmc-v-band--flat{background:rgba(255,255,255,.04);
  border:.06em solid rgba(255,255,255,.085);color:var(--gmc-ink-soft)}
.gmc-card .gmc-v-band--shine{color:var(--gmc-ink);border:.06em solid var(--gmc-rule);
  background:linear-gradient(100deg, rgba(255,255,255,.17), rgba(255,255,255,.03) 62%)}
.gmc-card .gmc-v-band--metal{color:#191c24;
  background:linear-gradient(100deg,#8d95a5 0%,#e9edf4 21%,#a9b1bf 46%,#f3f6fb 63%,#97a0b0 100%)}
.gmc-card .gmc-v-band--metalGlow{color:#2b1f06;
  background:linear-gradient(100deg,#8a6a22 0%,#f1d78b 20%,#caa54f 45%,#fff1c0 63%,#aa8330 100%);
  box-shadow:0 0 .8em -.2em rgba(240,214,138,.45)}
.gmc-card .gmc-v-band--spectral{color:#1a1426;
  background:linear-gradient(100deg,#ffd7e3 0%,#ffeab4 22%,#c6ffe1 44%,#bfe5ff 66%,#e3cdff 88%,#ffd7e3 100%);
  box-shadow:0 0 1em -.2em rgba(200,170,255,.55)}
/* 金属・分光の帯には、ポインタに合わせて動く艶を重ねる。 */
.gmc-card .gmc-v-band--metal::after,
.gmc-card .gmc-v-band--metalGlow::after,
.gmc-card .gmc-v-band--spectral::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(calc(var(--pointer-dx,0) * 30deg + 105deg),
    rgba(255,255,255,.66) 0%, rgba(255,255,255,0) 34%, rgba(0,0,0,.22) 60%, rgba(255,255,255,.5) 100%);
  mix-blend-mode:overlay;opacity:.8}

/* 名前・特徴・メタは、右下の認証印を避けて組む。 */
.gmc-card .gmc-v-name{font-family:var(--gmc-sans);font-size:1.42em;font-weight:800;letter-spacing:.08em;
  line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--gmc-ink)}
.gmc-card .gmc-v-name em{font-style:normal;font-size:.42em;font-weight:600;letter-spacing:.2em;
  color:var(--gmc-ink-soft);margin-left:.8em}
.gmc-card .gmc-v-traits{display:flex;flex-wrap:wrap;gap:.1em .5em;font-size:.6em;line-height:1.5;
  color:var(--gmc-ink);max-height:3em;overflow:hidden}
.gmc-card .gmc-v-traits span{position:relative;white-space:nowrap}
.gmc-card .gmc-v-traits span+span::before{content:"·";margin-right:.5em;color:var(--gmc-ink-soft)}
.gmc-card .gmc-v-traits--none{color:var(--gmc-ink-soft)}
.gmc-card .gmc-v-meta{display:flex;flex-wrap:wrap;gap:.2em .95em;font-size:.54em;line-height:1.4;
  color:var(--gmc-ink)}
.gmc-card .gmc-v-meta b{font-weight:700;letter-spacing:.2em;color:var(--gmc-ink-soft);margin-right:.45em}

/* ── 認証印の置き場所（§8）──
   右下・少し斜め・ゲノモンの顔には重ねない。顔は絵の上半分にあるので、
   絵の下端と情報欄の境目にまたがる高さへ置く。 */
.gmc-card--collectorV2 .gmc-v-seal{position:absolute;right:0;top:-3.6em;width:21%;
  transform:rotate(-7deg);transform-origin:50% 50%}

/* ── 脚（フレーバーと証明書番号）── */
.gmc-card--collectorV2 .gmc-v-foot{margin-top:auto;display:flex;align-items:flex-end;gap:.7em;
  padding-top:.5em;min-width:0}
.gmc-card--collectorV2 .gmc-flavor{flex:1 1 auto;min-width:0;margin:0}
.gmc-card--collectorV2 .gmc-flavor b{font-size:.42em;letter-spacing:.2em;color:var(--gmc-metal-dim)}
/* 【小さくしすぎない — 実測で下限を割った】
   .62em は 430px のカードで 8.1px（カード幅比 0.0189）。
   e2e が持っている可読性の下限 0.021 を割っていた。目立たせないことと
   読めないことは違う。大きさは name の 1/2 に留めつつ、下限は守る。 */
.gmc-card--collectorV2 .gmc-flavor span{font-size:.72em;line-height:1.45;color:var(--gmc-ink-soft);
  -webkit-line-clamp:2}
.gmc-card .gmc-v-cert{flex:0 0 auto;font-family:var(--gmc-mono);font-size:.44em;letter-spacing:.08em;
  color:var(--gmc-ink-soft);opacity:.75;white-space:nowrap}

/* ══════════════════════════════════════════════════════════
   認証印
   ══════════════════════════════════════════════════════════
   【素材の進化がそのまま格（§8）】
     ink → inkFoil → silver → gold → holo
   インク系は紙に押した線だけ。箔系は円盤そのものが箔で、意匠を抜く。

   【暗い地の上で読めること】
     本来の証券インクは深い臙脂だが、ほぼ黒のカードの上では何も見えない。
     紙ではなく黒地に押す前提なので、赤みは保ったまま明度だけ上げてある
     （最初に本来の暗さで置いたら、実際に真っ暗で消えた）。 */
.gmc-card .gmc-seal{position:relative;display:block;width:100%;aspect-ratio:1;
  --seal-ink:#d2536a;--seal-ring:#d2536a;--seal-line:#a83a4e;
  --seal-disc:transparent;--seal-disc-edge:transparent}
.gmc-card .gmc-seal-svg{display:block;width:100%;height:100%;overflow:visible}
.gmc-card .gmc-seal--ink{filter:drop-shadow(0 .04em .08em rgba(0,0,0,.55))}
/* 縁だけ箔が回る段。意匠はインクのまま。 */
.gmc-card .gmc-seal--inkFoil{--seal-ring:#d9cdf2;
  filter:drop-shadow(0 .04em .08em rgba(0,0,0,.55))}
.gmc-card .gmc-seal--silver{--seal-ink:#2f3542;--seal-ring:#525b6d;--seal-line:#5d6678;
  --seal-disc:#c6ccd8;--seal-disc-edge:#8b93a3;
  filter:drop-shadow(0 .06em .14em rgba(0,0,0,.55))}
.gmc-card .gmc-seal--gold{--seal-ink:#463108;--seal-ring:#6f5216;--seal-line:#7c5c1c;
  --seal-disc:#e2c073;--seal-disc-edge:#a8823a;
  filter:drop-shadow(0 .06em .16em rgba(0,0,0,.55))}
.gmc-card .gmc-seal--holo{--seal-ink:#20173a;--seal-ring:#3d3168;--seal-line:#4b3d7d;
  --seal-disc:#d3d9ff;--seal-disc-edge:#9a8fd0;
  filter:drop-shadow(0 .06em .18em rgba(0,0,0,.6))}

.gmc-card .gmc-seal-arc{fill:var(--seal-ink);font-family:var(--gmc-sans);font-weight:800}
.gmc-card .gmc-seal-arc--top{font-size:7.4px;letter-spacing:.32px}
.gmc-card .gmc-seal-arc--bot{font-size:7px;font-family:var(--gmc-mono);letter-spacing:.5px}
.gmc-card .gmc-seal-word{fill:var(--seal-ink);font-family:var(--gmc-sans);font-weight:900;
  font-size:9.4px;letter-spacing:1.1px}
.gmc-card .gmc-seal-date{fill:var(--seal-ink);font-family:var(--gmc-mono);font-size:6.4px;
  letter-spacing:.3px;opacity:.85}

/* 箔の艶。インク系には付けない（紙に押したインクは光らない）。 */
.gmc-card .gmc-seal-shine{position:absolute;inset:3%;border-radius:50%;pointer-events:none}
.gmc-card .gmc-seal--silver .gmc-seal-shine,
.gmc-card .gmc-seal--gold .gmc-seal-shine{mix-blend-mode:overlay;opacity:.85;
  background:linear-gradient(calc(var(--pointer-dx,0) * 34deg + 112deg),
    rgba(255,255,255,.9) 0%, rgba(255,255,255,0) 32%, rgba(0,0,0,.42) 58%, rgba(255,255,255,.75) 100%)}
/* 【color-dodge だと白く飛んで銀に見えた】
   明るい円盤の上に color-dodge を掛けると、どの色相も 255 に張り付いて
   **ただの銀の印**になった（実測で段の差が出なくなっていた）。
   円盤の地を落として、色を足す側（hard-light）で重ねる。 */
.gmc-card .gmc-seal--holo{--seal-disc:#8f93c4}
.gmc-card .gmc-seal--holo .gmc-seal-shine{mix-blend-mode:hard-light;opacity:.92;
  background:conic-gradient(from calc(var(--pointer-dx,0) * 80deg + 20deg),
    #ff5f96, #ffc24a, #55f0b4, #46b6ff, #b46cff, #ff5f96)}
/* 【z-index で SVG を上げてはいけない】
   円盤は SVG の中に描いてある。SVG を上へ出すと艶が円盤の **裏** へ回り、
   分光がまったく見えず銀の印に見えた。艶は SVG の後ろの兄弟のまま、
   inset+border-radius で円盤の内側だけに収める。 */

/* ══════════════════════════════════════════════════════════
   裏（読むカード）
   ══════════════════════════════════════════════════════════
   【全面を明るくしない（§12）】
     紙は表と同じ黒のまま。その上に **書類だけ** を羊皮紙の面として置く。
     全面を羊皮紙にすると、めくった瞬間に別のカードに見える。 */
/* 【裏は表と別の文字寸法で組む】
   表は絵が主役なので 3.05cqw で足りるが、裏は読む面。同じ寸法だと
   430px のカードで本文 7.3px になり、書類の下 4 割が空いたまま
   「小さくて読めないのにスカスカ」という最悪の版面になっていた。
   文字を上げると余白も埋まる（実測して 3.75cqw に決めた）。 */
/* 【cqw だけで組むとスマホで読めなくなる — 実測 6.8px / 320px では 5.6px】
   表は絵が主役なので相対寸法でよいが、裏は読む面。スマホではカードの
   実寸が 258〜331px しかないため、cqw に比例させると本文が 6px 台に落ちる。
   **px の下限**を入れて、どの幅でも本文 9px を割らないようにする。
   はみ出すぶんは書類の中だけをスクロールさせる（§23 が明示的に許している）。 */
.gmc-card .gmc--back{font-size:max(16px, 3.75cqw);
  --doc:#e9dfc6;--doc2:#ded2b4;--doc-ink:#2a2419;--doc-soft:#6e6350;
  --doc-metal:#8a6a2a}
.gmc-card .gmc-b-body{padding:4.6% 5%}
.gmc-card .gmc-b-head{display:flex;align-items:center;justify-content:space-between;gap:.6em;
  min-width:0;padding-bottom:.24em}
.gmc-card .gmc-b-office{display:flex;align-items:baseline;gap:.55em;min-width:0}
.gmc-card .gmc-b-office .gmc-wordmark{font-size:.76em;letter-spacing:.34em;color:var(--gmc-ink)}
.gmc-card .gmc-b-office span{font-size:.44em;letter-spacing:.24em;color:var(--gmc-ink-soft);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* metal-dim（#6d5f95）はほぼ黒の地に沈んで読めなかった。 */
.gmc-card .gmc-b-title{font-family:var(--gmc-serif);font-size:.6em;letter-spacing:.28em;
  color:var(--gmc-metal);opacity:.82;padding-bottom:.5em}

/* 書類そのもの。 */
/* 【書類は伸ばさず、中身の高さで置く】
   flex:1 1 auto で下端まで引き伸ばしていたので、記録の少ない個体だと
   紙の下 4 割が空白のまま残り「小さいのにスカスカ」に見えた。
   中身の高さで止めて、余白は書類の **外**（署名欄までの間）へ逃がす。
   実際の証書もそう組まれている。 */
.gmc-card .gmc-b-doc{position:relative;flex:0 1 auto;min-height:0;display:flex;flex-direction:column;
  gap:.5em;padding:.7em .75em .6em;border-radius:.3em;color:var(--doc-ink);
  background:linear-gradient(168deg, var(--doc), var(--doc2));
  box-shadow:0 .1em .5em rgba(0,0,0,.5), inset 0 0 0 .05em rgba(0,0,0,.14)}
.gmc-card .gmc-b-doc::after{content:"";position:absolute;inset:0;pointer-events:none;
  background-image:var(--gmc-grain);background-size:100% 100%;opacity:.16;mix-blend-mode:multiply}
.gmc-card .gmc-b-sec{min-width:0}
.gmc-card .gmc-b-sec h4{margin:0 0 .16em;font-size:.44em;letter-spacing:.24em;font-weight:800;
  color:var(--doc-metal);padding-bottom:.14em;border-bottom:.07em solid rgba(0,0,0,.2)}
.gmc-card .gmc-b-row{display:flex;align-items:baseline;gap:.6em;min-width:0;line-height:1.42}
.gmc-card .gmc-b-row b{flex:0 0 27%;font-size:.44em;letter-spacing:.14em;font-weight:700;
  color:var(--doc-soft)}
.gmc-card .gmc-b-row span{flex:1 1 auto;min-width:0;font-size:.56em;font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gmc-card .gmc-b-row span i{font-style:normal;font-family:var(--gmc-mono);font-size:.86em;
  color:var(--doc-soft);margin-left:.7em}
.gmc-card .gmc-b-row.on span{color:#7a4a12;font-weight:800}
.gmc-card .gmc-b-none{margin:0;font-size:.5em;letter-spacing:.14em;color:var(--doc-soft);opacity:.85}

.gmc-card .gmc-b-rank{display:flex;align-items:baseline;gap:.6em;min-width:0}
.gmc-card .gmc-b-rank b{font-size:.86em;font-weight:900;letter-spacing:.14em;color:#5d3a0c}
.gmc-card .gmc-b-rank-score{font-family:var(--gmc-mono);font-size:.8em;font-weight:800}
.gmc-card .gmc-b-rank-pips{flex:1 1 auto;text-align:right;font-size:.56em;color:var(--doc-metal)}
.gmc-card .gmc-b-reasons{margin:.1em 0 0;padding-left:.9em;font-size:.5em;line-height:1.5;
  color:var(--doc-soft)}
.gmc-card .gmc-b-reasons li{margin:0}

.gmc-card .gmc-b-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.14em .5em}
.gmc-card .gmc-b-stats>div{min-width:0;display:flex;flex-direction:column}
.gmc-card .gmc-b-stats b{font-size:.38em;letter-spacing:.14em;color:var(--doc-soft);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gmc-card .gmc-b-stats span{font-family:var(--gmc-mono);font-size:.6em;font-weight:800}
.gmc-card .gmc-b-stats span i{font-style:normal;font-family:var(--gmc-sans);font-size:.6em;
  font-weight:600;color:var(--doc-soft);margin:0 .35em 0 .16em}

.gmc-card .gmc-b-genes{width:100%;border-collapse:collapse;table-layout:fixed}
.gmc-card .gmc-b-genes th,
.gmc-card .gmc-b-genes td{text-align:left;padding:.06em 0;font-size:.5em;line-height:1.4;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gmc-card .gmc-b-genes th{width:22%;font-weight:700;color:var(--doc-soft)}
.gmc-card .gmc-b-genes td{width:34%;font-weight:600}
.gmc-card .gmc-b-genes td.z{width:14%;font-family:var(--gmc-mono);font-size:.44em;
  letter-spacing:.06em;color:var(--doc-metal);font-weight:800}
.gmc-card .gmc-b-genes td.e{width:30%;color:#5d3a0c;font-weight:700}

.gmc-card .gmc-b-cols{display:grid;grid-template-columns:1fr 1fr;gap:.5em .8em}
.gmc-card .gmc-b-sec--half{min-width:0}
.gmc-card .gmc-b-sec--half .gmc-b-row b{flex:0 0 42%}

.gmc-card .gmc-b-foot{flex:0 0 auto;margin-top:auto;display:flex;align-items:center;gap:.6em;
  padding-top:.7em;min-width:0}
.gmc-card .gmc-b-qr{flex:0 0 auto;width:3.1em;height:3.1em;border-radius:.16em;overflow:hidden;
  box-shadow:0 0 0 .07em rgba(255,255,255,.16)}
.gmc-card .gmc-b-qr svg{display:block;width:100%;height:100%}
.gmc-card .gmc-b-fulltext{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:.1em}
.gmc-card .gmc-b-fulltext b{font-size:.44em;letter-spacing:.2em;color:var(--gmc-ink)}
.gmc-card .gmc-b-fulltext span{font-family:var(--gmc-mono);font-size:.42em;letter-spacing:.04em;
  color:var(--gmc-ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gmc-card .gmc-b-fulltext i{font-style:normal;font-size:.38em;letter-spacing:.16em;
  color:var(--gmc-metal);opacity:.6}
.gmc-card .gmc-b-seal{flex:0 0 auto;width:3.4em;height:3.4em;transform:rotate(-6deg)}

/* ══════════════════════════════════════════════════════════
   裏返し（§11）
   ══════════════════════════════════════════════════════════
   【器はカードの外側】
     ライブラリの .holo-card__back は読み込み中の裏地用で、
     backface-visibility:visible が当たっている。裏返し用ではないので、
     3D の器を自前で作り、表と裏に独立した .holo-card を 1 枚ずつ入れる。

   【面の中の 3D をきちんと畳む】
     ライブラリは .holo-card__translater / __rotator に preserve-3d を掛ける。
     面にだけ backface-visibility を付けても、子が自前の 3D 文脈を作ると
     裏側が透けて見える環境がある。子にも明示的に掛けて畳む。 */
.gmc-flip{width:100%;perspective:1500px}
.gmc-flip-inner{position:relative;display:block;width:100%;padding:0;border:0;background:none;
  transform-style:preserve-3d;cursor:pointer;-webkit-tap-highlight-color:transparent;
  transition:transform .6s cubic-bezier(.2,.75,.25,1)}
.gmc-flip[data-face="back"] .gmc-flip-inner{transform:rotateY(180deg)}
.gmc-flip-inner:focus-visible{outline:3px solid var(--accent);outline-offset:7px;border-radius:16px}
.gmc-flip-face{backface-visibility:hidden;-webkit-backface-visibility:hidden}
.gmc-flip-face>.holo-card,
.gmc-flip-face .holo-card__translater{backface-visibility:hidden;-webkit-backface-visibility:hidden}
.gmc-flip-face--front{position:relative}
.gmc-flip-face--back{position:absolute;inset:0;transform:rotateY(180deg)}
/* 裏を向けているあいだ、表はポインタを拾わない（箔が動いてしまう）。 */
.gmc-flip[data-face="back"] .gmc-flip-face--front{pointer-events:none}
.gmc-flip[data-face="front"] .gmc-flip-face--back{pointer-events:none}

/* ══ 比較・一覧では潰れる要素を間引く ══ */
.gmc-q-lite .gmc-v-seal,
.gmc-q-lite .gmc-v-cert,
.gmc-q-lite .gmc-v-meta b{display:none}
.gmc-q-lite .gmc-v-name,
.gmc-q-lite .gmc-v-traits,
.gmc-q-lite .gmc-v-meta{padding-right:0}
.gmc-q-lite .gmc-v-traits{max-height:1.5em}
.gmc-q-medium .gmc-v-traits{max-height:1.5em}
.gmc-q-medium .gmc-seal-date{display:none}

/* ══ スマホ ══ */
@media (max-width:899px){
  /* 裏面は文字が主役なので、狭い画面では相対の文字寸法を上げ、
     あふれるぶんは書類の中だけをスクロールさせる（§23）。
     カードの外形は変えないので、めくる操作の手ざわりは同じ。 */
  /* 【下端を素で切らない】
     スマホでは書類が必ずあふれる。行の途中でぷつりと切れると
     「壊れている」に見えるので、下端だけ薄く消して
     「まだ続く」と読めるようにする。 */
  .gmc-card .gmc-b-doc{overflow-y:auto;-webkit-overflow-scrolling:touch;
    overscroll-behavior:contain;
    -webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 1.2em),transparent);
    mask-image:linear-gradient(180deg,#000 calc(100% - 1.2em),transparent)}
  .gmc-card .gmc-b-cols{grid-template-columns:1fr}
  /* 258px 幅のカードで 4 列は成立しない。 */
  .gmc-card .gmc-b-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  /* 見出しと欄名も、本文と同じだけ持ち上げる（.44em では 7px を割る）。 */
  .gmc-card .gmc-b-sec h4{font-size:.52em}
  .gmc-card .gmc-b-row b{font-size:.5em}
  .gmc-card .gmc-b-genes th,
  .gmc-card .gmc-b-genes td{font-size:.56em}
  .gmc-card .gmc-b-genes td.z{font-size:.48em}
  .gmc-card .gmc-b-stats b{font-size:.44em}
}

/* ══ 動きへの配慮 ══ */
@media (prefers-reduced-motion:reduce){
  /* 3D で回さない。面を入れ替えるだけにする（§11）。 */
  .gmc-flip-inner{transition:opacity .16s linear}
  .gmc-flip[data-face="back"] .gmc-flip-inner{transform:none}
  .gmc-flip-face--back{transform:none}
  .gmc-flip[data-face="front"] .gmc-flip-face--back{opacity:0;visibility:hidden}
  .gmc-flip[data-face="back"] .gmc-flip-face--front{opacity:0;visibility:hidden}
  .gmc-flip[data-face="back"] .gmc-flip-face--back{opacity:1;visibility:visible}
  .gmc-card--collectorV2 .gmc-k-backdrop,
  .gmc-card--collectorV2 .gmc-art-inner{transform:none}
}

`;

/** <style> をドキュメントへ 1 度だけ入れる（labStyles と同じ作法）。 */
export function installCardStyles(): void {
  if (document.getElementById('cards-css')) return;
  const style = document.createElement('style');
  style.id = 'cards-css';
  style.textContent = CARD_CSS;
  document.head.appendChild(style);
}
