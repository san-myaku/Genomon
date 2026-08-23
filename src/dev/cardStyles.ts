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

/* 狭い画面では、デッキの「版面／箔」を細くして「つぎ」を最大化する。 */
@media (max-width:400px){
  .cards-deck-swap{max-width:62px}
  .cards-deck-swap b{max-width:48px;font-size:10.5px}
  .cards-deck-main{font-size:15px}
}

/*
   360px 以下では 5 つを 1 段に並べきれず、「つぎのカード」が 62px まで
   潰れて 2 行に折り返していた（実測 320px）。2 段に分け、
   **主役を最下段の全幅**に置く（親指にいちばん近い所が主役）。
*/
@media (max-width:360px){
  .cards-wrap{--cards-deck-h:112px}
  .cards-deck{flex-wrap:wrap}
  .cards-deck-btn:not(.cards-deck-main){order:1;flex:1 1 auto;min-width:0;min-height:42px}
  .cards-deck-main{order:2;flex:1 0 100%;min-height:48px;font-size:16px}
  .cards-deck-swap{max-width:none}
  .cards-deck-swap b{max-width:none;font-size:11px}
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
`;

/** <style> をドキュメントへ 1 度だけ入れる（labStyles と同じ作法）。 */
export function installCardStyles(): void {
  if (document.getElementById('cards-css')) return;
  const style = document.createElement('style');
  style.id = 'cards-css';
  style.textContent = CARD_CSS;
  document.head.appendChild(style);
}
