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
`;

/** <style> をドキュメントへ 1 度だけ入れる。 */
export function installLabStyles(): void {
  if (document.getElementById('lab-css')) return;
  const style = document.createElement('style');
  style.id = 'lab-css';
  style.textContent = LAB_CSS;
  document.head.appendChild(style);
}
