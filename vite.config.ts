import { defineConfig } from 'vite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Visual Lab の「コメント付き個体」を、ブラウザの localStorage だけでなく
 * プロジェクト内のファイルにも書き出す開発サーバー専用の口。
 *
 * 【なぜ要るか】
 *   Visual Lab は「気になる個体」をブックマークできるが、保存先が
 *   ブラウザの localStorage だけだと、その内容を Claude（別セッション・
 *   ファイルしか読めない）へ渡す手段が無い。手動でダウンロード→
 *   プロジェクトへ移動、という手順を毎回踏むのは非エンジニアには煩雑。
 *   ここに小さな API を生やし、ブラウザ側が変更のたびに
 *   `docs/lab-feedback.json` へ直接書き込めるようにする。
 *
 * 【本番ビルドに影響しない理由】
 *   `configureServer` は `vite dev`（開発サーバー）でしか呼ばれない。
 *   `vite build` の入口・出力（build 以下は無変更）には一切関与しないので、
 *   「index.html だけが本番ビルドの入口」という不変条件は崩れない。
 *   `npx vite build` 後に `dist/` の中身が変わっていないことを確認済み。
 *
 * 【このファイルが tsc の対象外であることについて】
 *   `tsconfig.json` の `include` は `src` と `tests` のみで、
 *   `vite.config.ts` は含まれない（`@types/node` も未導入）。
 *   そのため req/res はあえて型注釈を付けず、Vite 自身の緩い読み込みに任せる。
 */
function labFeedbackPlugin() {
  const FILE = resolve(__dirname, 'docs/lab-feedback.json');

  const readBody = (req) =>
    new Promise((resolvePromise, rejectPromise) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        // 際限なく溜め込まない（開発ツール用の小さな JSON が対象）。
        if (body.length > 5_000_000) req.destroy();
      });
      req.on('end', () => resolvePromise(body));
      req.on('error', rejectPromise);
    });

  return {
    name: 'genomon-lab-feedback',
    configureServer(server) {
      server.middlewares.use('/api/lab-feedback', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'GET') {
          try {
            const data = existsSync(FILE) ? readFileSync(FILE, 'utf8') : '[]';
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(data);
          } catch {
            res.statusCode = 500;
            res.end('[]');
          }
          return;
        }
        if (req.method === 'POST') {
          try {
            const body = await readBody(req);
            const parsed = JSON.parse(String(body));
            if (!Array.isArray(parsed)) throw new Error('配列ではない');
            mkdirSync(dirname(FILE), { recursive: true });
            writeFileSync(FILE, JSON.stringify(parsed, null, 2), 'utf8');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true, count: parsed.length }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
          return;
        }
        res.statusCode = 405;
        res.end();
      });
    },
  };
}

export default defineConfig({
  base: './',
  server: { port: 5183, host: true },
  plugins: [labFeedbackPlugin()],
  build: { target: 'es2020', sourcemap: true },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as never);
