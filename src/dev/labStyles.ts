/**
 * 開発ツールの見た目。
 *
 * ゲーム本体の src/ui/styles.css は読み込まない（開発ツールの都合で本体の CSS を
 * 触りたくなる事故を防ぐため）。ここは完全に自己完結した最小限のスタイル。
 *
 * 【テーマ】
 *   個体の背景を明／暗で切り替える必要がある。
 *   render/creature.ts の接地影は `:root[data-theme]` を見て明暗を出し分けるので、
 *   html 要素の data-theme を必ず一緒に切り替える（sheetMain.ts と同じ作法）。
 *   これを忘れると暗背景の検証で明背景用の影が出て、評価そのものが無意味になる。
 */

export const LAB_CSS = `
*{box-sizing:border-box}
:root{
  --bg:#efe3cd; --panel:#e6d8bd; --panel2:#f5ecda; --line:#cbb694;
  --fg:#4b3b34; --fg-soft:#8a7660; --paper:#f8efdf;
  --accent:#3f6f8f; --accent-ink:#fff; --warn:#a83c22; --good:#3f7a44;
}
:root[data-theme="dark"]{
  --bg:#1a161d; --panel:#241f2a; --panel2:#2e2836; --line:#3a3242;
  --fg:#e9dcc6; --fg-soft:#9b8c7a; --paper:#221d26;
  --accent:#7fb3d5; --accent-ink:#141018; --warn:#ffb0a0; --good:#8fd39a;
}
html,body{margin:0;background:var(--bg);color:var(--fg)}
body{font-family:"Hiragino Maru Gothic ProN","Segoe UI",system-ui,sans-serif;font-size:13px;line-height:1.5}
code,.mono{font-family:ui-monospace,Menlo,Consolas,monospace}

/* ── ヘッダ・タブ ── */
.lab-hdr{position:sticky;top:0;z-index:20;background:var(--panel);border-bottom:2px solid var(--line);
  padding:6px 12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.lab-hdr h1{font-size:14px;margin:0;font-weight:800;letter-spacing:.04em}
.lab-hdr .badge{background:var(--warn);color:#fff;border-radius:6px;padding:1px 7px;font-size:10px;font-weight:800}
.lab-tabs{display:flex;gap:4px;margin-left:auto}
.lab-tab{border:1.5px solid var(--line);background:transparent;color:var(--fg);border-radius:8px 8px 0 0;
  padding:5px 14px;font:inherit;font-weight:700;cursor:pointer}
.lab-tab[aria-selected="true"]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}

.lab-body{padding:10px 12px 60px}
.lab-panel[hidden]{display:none}

/* ── 部品 ── */
.card{background:var(--panel2);border:1.5px solid var(--line);border-radius:10px;padding:9px 11px;margin-bottom:10px}
.card>h2{font-size:12px;margin:0 0 8px;letter-spacing:.06em;text-transform:none;color:var(--fg-soft);font-weight:800}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.row+.row{margin-top:7px}
.grow{flex:1 1 auto;min-width:0}
label.f{display:inline-flex;gap:5px;align-items:center;font-size:12px;color:var(--fg-soft);white-space:nowrap}
input[type=text],input[type=number],select,textarea{
  background:var(--bg);color:var(--fg);border:1.5px solid var(--line);border-radius:7px;
  padding:4px 7px;font:inherit;font-size:12px;min-width:0}
input[type=text],textarea{font-family:ui-monospace,Menlo,Consolas,monospace}
textarea{width:100%;min-height:110px;resize:vertical}
input[type=range]{accent-color:var(--accent);vertical-align:middle}
button{background:var(--panel);color:var(--fg);border:1.5px solid var(--line);border-radius:7px;
  padding:4px 11px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
button:hover{border-color:var(--accent);color:var(--accent)}
button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
button.primary:hover{opacity:.86;color:var(--accent-ink)}
button.danger{border-color:var(--warn);color:var(--warn)}
button[disabled]{opacity:.45;cursor:not-allowed}
.seg{display:inline-flex;border:1.5px solid var(--line);border-radius:7px;overflow:hidden}
.seg button{border:0;border-radius:0;padding:4px 10px}
.seg button[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink)}
.pickrow{display:inline-flex;gap:4px;align-items:center;background:var(--panel);
  padding:4px 6px;border-radius:8px}
.pickrow .clear{cursor:pointer;font-size:11px;opacity:.6;padding:0 4px;user-select:none;color:var(--fg-soft)}
.pickrow .clear:hover{opacity:1;color:var(--warn)}
.hint{color:var(--fg-soft);font-size:11px;margin:5px 0 0}
.warn{color:var(--warn);font-weight:700}
.good{color:var(--good);font-weight:700}
.tagline{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--fg-soft)}

/* ── 個体の表示 ── */
.stage{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
.figure{background:var(--paper);border:1.5px solid var(--line);border-radius:12px;padding:6px}
.figure svg{display:block}
.figure.bad{border-color:#e2604a;box-shadow:0 0 0 2px rgba(226,96,74,.35)}
.meta{flex:1 1 260px;min-width:240px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12px}
.kv dt{color:var(--fg-soft)}
.kv dd{margin:0;font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all}

/* ── グリッド ── */
#lab-grid{display:grid;gap:6px}
.cell{background:var(--paper);border:1.5px solid var(--line);border-radius:10px;padding:3px 2px 2px;
  text-align:center;cursor:pointer}
.cell:hover{border-color:var(--accent)}
.cell.bad{border-color:#e2604a;box-shadow:0 0 0 2px rgba(226,96,74,.32)}
.cell svg{display:block;width:100%;height:auto}
.cell .lbl{font-size:9px;line-height:1.25;color:var(--fg-soft);
  font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all;padding:1px 2px 2px}
.cell .iss{color:#e2604a}

/* ── パーツ一覧（描画順） ── */
.parts{max-height:240px;overflow:auto;border:1.5px solid var(--line);border-radius:8px;background:var(--bg)}
.parts div{display:flex;gap:8px;padding:2px 8px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px}
.parts div.on{background:var(--accent);color:var(--accent-ink)}
.parts div.off{opacity:.35}
.parts .z{color:var(--fg-soft);min-width:32px;text-align:right}
.parts div.on .z{color:var(--accent-ink)}

/* ── 表 ── */
table.t{border-collapse:collapse;width:100%;font-size:11.5px;font-family:ui-monospace,Menlo,Consolas,monospace}
table.t th,table.t td{border-bottom:1px solid var(--line);padding:3px 6px;text-align:left;vertical-align:top}
table.t th{color:var(--fg-soft);font-weight:700;white-space:nowrap}
table.t tr:hover td{background:var(--panel)}
.scroll{max-height:340px;overflow:auto;border:1.5px solid var(--line);border-radius:8px}

/* ── 進捗 ── */
.bar{height:7px;background:var(--panel);border:1.5px solid var(--line);border-radius:99px;overflow:hidden}
.bar>i{display:block;height:100%;background:var(--accent);width:0}

/* ── トースト ── */
#lab-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99;
  display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none}
#lab-toast .t{background:var(--panel);border:1.5px solid var(--line);border-radius:9px;
  padding:6px 14px;font-size:12px;font-weight:700;box-shadow:0 4px 16px rgba(0,0,0,.28)}
#lab-toast .t.bad{border-color:var(--warn);color:var(--warn)}
#lab-toast .t.ok{border-color:var(--good);color:var(--good)}

/* ── 開発者モードの未保存バー ── */
.dirtybar{position:sticky;bottom:0;z-index:15;margin-top:10px;background:var(--panel);
  border:2px solid var(--warn);border-radius:10px;padding:7px 11px;display:flex;gap:10px;
  align-items:center;flex-wrap:wrap}
.gauge{display:grid;grid-template-columns:5em 1fr 3em;gap:6px;align-items:center;font-size:11.5px}
.gauge+.gauge{margin-top:3px}
.gauge span:first-child{color:var(--fg-soft)}
.gauge output{font-family:ui-monospace,Menlo,Consolas,monospace;text-align:right}

/* ── Visual Lab 2026 polish ───────────────────────────────
   操作の意味を保ったまま、観察対象（個体）を主役にする。
   一覧の列数は画面幅に合わせ、スマホではカードが読める大きさを優先する。 */
html,body{min-width:0;overflow-x:hidden}
body{font-size:14px;background-image:radial-gradient(color-mix(in srgb,var(--line) 38%,transparent) 1px,transparent 1px);background-size:22px 22px}

.lab-hdr{padding:10px clamp(12px,2.2vw,30px);gap:10px 14px;min-height:58px;
  background:color-mix(in srgb,var(--panel) 94%,var(--accent) 6%);box-shadow:0 3px 14px rgba(80,55,25,.13)}
.lab-hdr h1{font-size:15px;letter-spacing:.045em;white-space:nowrap}
.lab-hdr .badge{padding:3px 8px;border-radius:99px;letter-spacing:.04em}
.lab-hdr>.hint{margin:0;min-width:0;overflow-wrap:anywhere}
.lab-tabs{gap:6px;margin-left:auto}
.lab-tab{min-height:38px;padding:7px 16px;border-radius:10px;font-size:13px}
.lab-tab[aria-selected="true"]{box-shadow:0 2px 0 color-mix(in srgb,var(--accent) 65%,#000)}

.lab-body{width:min(100%,1480px);margin:0 auto;padding:16px clamp(10px,2.2vw,30px) 76px}
.lab-quicknav{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:0 0 14px;min-width:0}
.lab-quicknav::-webkit-scrollbar{display:none}
.lab-quicknav a{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:6px 14px;
  border:1.5px solid var(--line);border-radius:99px;background:var(--panel2);color:var(--fg-soft);
  font-size:12px;font-weight:800;text-decoration:none;white-space:nowrap;transition:background .16s,border-color .16s,color .16s}
.lab-quicknav a:hover,.lab-quicknav a:focus-visible{border-color:var(--accent);background:var(--accent);color:var(--accent-ink)}

.lab-card{padding:clamp(13px,1.8vw,22px);margin-bottom:16px;border-radius:16px;box-shadow:0 3px 12px rgba(110,75,35,.09);scroll-margin-top:78px}
.lab-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:0 0 15px;padding-bottom:11px;border-bottom:1px solid var(--line)}
.lab-card__head h2{font-size:16px;line-height:1.3;color:var(--fg);letter-spacing:.035em}
.lab-kicker{display:block;margin-bottom:3px;color:var(--accent);font-size:10px;font-weight:900;letter-spacing:.14em}
.lab-card__desc{max-width:42em;margin:3px 0 0;color:var(--fg-soft);font-size:12px;line-height:1.55;text-align:right}
.lab-subhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;color:var(--fg)}
.lab-subhead span{color:var(--fg-soft);font-size:11px}

.lab-form-grid{display:grid;grid-template-columns:minmax(165px,1.25fr) minmax(185px,auto) repeat(5,minmax(105px,1fr));gap:10px}
.lab-field{display:grid!important;align-content:start;gap:4px;min-width:0;white-space:normal!important}
.lab-field__label{color:var(--fg-soft);font-size:11px;font-weight:800;line-height:1.25}
.lab-field input[type=text],.lab-field input[type=number],.lab-field select{width:100%;min-height:36px;padding:7px 9px;border-radius:9px}
.lab-field--actions{min-width:0}
.lab-inline-actions{display:flex;gap:6px;flex-wrap:wrap;min-height:36px}
.lab-inline-actions button{flex:1 1 auto;white-space:nowrap}
.lab-checkbox{display:inline-flex;align-items:center;gap:6px;min-height:36px;color:var(--fg);font-size:12px;font-weight:700;line-height:1.35}
.lab-checkbox input{accent-color:var(--accent);width:16px;height:16px;flex:0 0 auto}
.lab-tool-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:13px;padding-top:12px;border-top:1px solid var(--line)}
.lab-control-group{display:flex;align-items:center;gap:7px}
.lab-control-label{color:var(--fg-soft);font-size:11px;font-weight:800}
.lab-debug-check{margin-left:auto}
.lab-hint{max-width:100ch;margin-top:12px;line-height:1.6}

button{min-height:36px}
input[type=text],input[type=number],select{min-height:36px}
.seg{border-radius:9px}
.seg button{min-height:34px;padding-inline:13px}
.lab-grid-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.lab-inline-field{display:inline-flex;align-items:center;gap:6px;min-height:36px;white-space:nowrap}
.lab-inline-field input{min-height:36px}
.lab-generate-button{margin-left:auto}
.lab-form-actions{display:flex;justify-content:flex-end;margin-top:12px}
.lab-filter-box{margin-top:14px;padding:12px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--panel) 55%,transparent)}
#lab-grid-filters{gap:7px}
.pickrow{min-height:38px;padding:4px 6px;border:1px solid color-mix(in srgb,var(--line) 75%,transparent);background:var(--panel2)}
.pickrow select{min-height:30px}
.pickrow .clear{min-height:30px}

.lab-specimen-stage{display:grid;grid-template-columns:minmax(0,42%) minmax(0,1fr);gap:18px;align-items:start}
.lab-specimen-visual{min-width:0;max-width:100%}
.lab-specimen-visual .figure{width:min(100%,440px);margin:0 auto;padding:9px;border-radius:14px}
.lab-specimen-visual .figure svg{display:block;width:100%;height:auto;max-width:100%}
.lab-specimen-meta{min-width:0;flex:none}
.lab-specimen-meta .kv{grid-template-columns:minmax(66px,auto) minmax(0,1fr);gap:4px 10px}
.lab-comment-row{margin-top:14px;gap:8px}
.lab-comment-row input{flex:1 1 220px;min-width:0;min-height:38px;padding:7px 10px}
.lab-comment-row button{flex:0 0 auto}
.lab-action-row{margin-top:8px;gap:7px}
.lab-parts-control{margin-top:12px}
.lab-parts-label{flex:0 0 auto}
.parts{max-height:190px}

.lab-grid-summary{align-items:center;gap:6px;margin:14px 0 10px}
.lab-grid-summary span{display:inline-flex;align-items:center;min-height:28px;padding:3px 9px;border:1px solid var(--line);border-radius:99px;background:var(--panel2);font-size:11px}
.lab-grid-summary .good{color:var(--good);border-color:color-mix(in srgb,var(--good) 48%,var(--line))}
.lab-grid-summary .warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 48%,var(--line))}
.lab-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:9px;width:100%;max-width:min(100%,var(--lab-grid-max,100%));margin:0 auto}
.cell{display:flex;flex-direction:column;align-items:stretch;min-width:0;width:100%;padding:5px;border:1.5px solid var(--line);border-radius:12px;background:var(--paper);color:var(--fg);
  text-align:left;appearance:none;box-shadow:0 2px 6px rgba(100,70,30,.06);transition:transform .14s,border-color .14s,box-shadow .14s}
.cell:hover{border-color:var(--accent);box-shadow:0 4px 12px rgba(100,70,30,.15);transform:translateY(-2px);color:var(--fg)}
.cell:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.cell__art{display:block;width:100%;aspect-ratio:1/1;overflow:hidden;border-radius:8px;background:var(--paper)}
.cell__art svg{display:block;width:100%;height:100%;max-width:none}
.cell__lbl{display:flex;flex-direction:column;gap:1px;min-width:0;padding:6px 2px 2px}
.cell__id,.cell__meta,.cell .iss{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cell__id{font-size:10px;font-weight:900;letter-spacing:.025em}
.cell__meta{font-size:10px;color:var(--fg-soft);line-height:1.3}
.cell .iss{font-size:9px;color:var(--warn);line-height:1.3;white-space:normal;overflow-wrap:anywhere}
.cell.bad{border-color:var(--warn);box-shadow:0 0 0 2px color-mix(in srgb,var(--warn) 28%,transparent)}
.lab-empty{grid-column:1/-1;display:grid;gap:4px;padding:28px 16px;text-align:center;border:1px dashed var(--line);border-radius:12px;color:var(--fg-soft)}
.lab-empty strong{color:var(--fg)}

.lab-saved-toolbar{align-items:flex-start;margin-bottom:9px}
.lab-row-actions{gap:5px;align-items:center;flex-wrap:wrap}
.note-input{min-height:36px;padding:6px 8px;border-radius:8px}
.saved-row--resolved{opacity:.64}

@media (max-width:900px){
  .lab-form-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .lab-field--seed{grid-column:span 2}
  .lab-field--actions{grid-column:span 1}
  .lab-specimen-stage{grid-template-columns:minmax(0,1fr)}
  .lab-specimen-visual .figure{width:min(100%,440px)}
  .lab-specimen-meta{width:100%}
}

/* PC workspace: 条件を決めたあと、左の一覧と右の選択個体を同時に見る。 */
@media (min-width:1100px){
  /* .lab-body は製品版・開発版のパネルを包む外枠。実際のカード群は
     #lab-panel-lab の直下なので、ここを作業用グリッドにする。 */
  .lab-body{display:block}
  #lab-panel-lab{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,420px);column-gap:16px;row-gap:0;align-items:start}
  .lab-quicknav,#lab-settings,#lab-inspect-card,#lab-sib-card,#lab-saved-card{grid-column:1/-1}
  #lab-single-card{grid-column:2;grid-row:3;position:sticky;top:74px;max-height:calc(100vh - 90px);max-height:calc(100dvh - 90px);overflow:auto;min-width:0}
  #lab-grid-card{grid-column:1;grid-row:3;min-width:0}
  #lab-single-card .lab-specimen-stage{grid-template-columns:minmax(0,1fr);gap:12px}
  #lab-single-card .lab-specimen-visual .figure{width:min(100%,400px)}
  #lab-single-card .lab-card__head{display:block}
  #lab-single-card .lab-card__desc{text-align:left;margin-top:6px}
  #lab-grid-card .lab-grid{grid-template-columns:repeat(auto-fill,minmax(116px,1fr))}
  .cell[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 28%,transparent),0 5px 14px rgba(100,70,30,.16)}
}

@media (max-width:680px){
  .lab-hdr{grid-template-columns:minmax(0,1fr) auto;align-items:center;padding:9px 10px;gap:7px 8px}
  .lab-hdr h1{font-size:14px}
  .lab-hdr>.hint{grid-column:1/-1;grid-row:2;font-size:10px}
  .lab-tabs{grid-column:1/-1;grid-row:3;display:grid;grid-template-columns:1fr 1fr;margin:0}
  .lab-tab{width:100%;min-height:40px}
  .lab-body{padding:12px 10px 72px}
  .lab-card{padding:13px 12px;margin-bottom:13px;border-radius:14px}
  .lab-card__head{display:block;margin-bottom:12px;padding-bottom:9px}
  .lab-card__desc{margin-top:5px;text-align:left;font-size:11px}
  .lab-form-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
  .lab-field--seed,.lab-field--actions{grid-column:1/-1}
  .lab-field--actions .lab-inline-actions{display:grid;grid-template-columns:1fr 1fr}
  .lab-tool-row{gap:9px 13px;margin-top:11px;padding-top:10px}
  .lab-debug-check{width:100%;margin-left:0}
  .lab-grid-controls{align-items:stretch}
  .lab-generate-button{margin-left:0;flex:1 1 150px}
  .lab-filter-box{padding:10px;margin-top:11px}
  #lab-grid-filters{display:grid;grid-template-columns:1fr;gap:6px}
  .pickrow{width:100%;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 36px;gap:5px;padding:4px}
  .pickrow select{width:100%}
  .pickrow .clear{width:36px;padding:0}
  .lab-specimen-stage{gap:12px}
  .lab-specimen-visual .figure{width:100%;padding:6px}
  .lab-comment-row{display:grid;grid-template-columns:1fr;gap:7px}
  .lab-comment-row button{width:100%}
  .lab-action-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
  .lab-action-row button{padding-inline:5px;font-size:11px}
  .lab-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;max-width:none}
  .cell{padding:4px;border-radius:11px}
  .cell__lbl{padding:5px 1px 1px}
  .cell__id,.cell__meta{font-size:9px}
  .lab-grid-summary{gap:4px;margin:11px 0 8px}
  .lab-grid-summary span{font-size:10px;padding-inline:7px}
  #lab-saved-out .scroll{max-height:none;overflow:visible;border:0}
  #lab-saved-out table.t{display:block;font-family:inherit;font-size:12px}
  #lab-saved-out table.t thead{display:none}
  #lab-saved-out table.t tbody{display:grid;gap:8px}
  #lab-saved-out table.t tr.saved-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 10px;padding:9px;border:1px solid var(--line);border-radius:11px;background:var(--paper)}
  #lab-saved-out table.t td{display:block;border:0;padding:2px 0;min-width:0}
  #lab-saved-out table.t td[data-label]::before{content:attr(data-label);display:block;color:var(--fg-soft);font-size:10px;font-weight:800;line-height:1.25}
  #lab-saved-out table.t td[data-label="seed"]{font-weight:900}
  #lab-saved-out table.t td[data-label="issues"],#lab-saved-out table.t td[data-label="コメント"]{grid-column:1/-1;overflow-wrap:anywhere}
  #lab-saved-out table.t td[data-label="操作"]{grid-column:1/-1;display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}
  #lab-saved-out table.t td[data-label="操作"]::before{display:none}
  #lab-saved-out .note-input{width:100%;font-size:12px}
}
@media (max-width:360px){
  .lab-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .lab-action-row{grid-template-columns:1fr}
}

@media (prefers-reduced-motion:reduce){
  .cell{transition:none}
}
`;

/** <style> をドキュメントへ 1 度だけ入れる。 */
export function installLabStyles(): void {
  if (document.getElementById('lab-css')) return;
  const style = document.createElement('style');
  style.id = 'lab-css';
  style.textContent = LAB_CSS;
  document.head.appendChild(style);
}
