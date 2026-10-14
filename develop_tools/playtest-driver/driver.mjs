// 试玩驱动：常驻一个 Chromium 页面，监听 127.0.0.1:$DRIVER_PORT（默认 4198），
// POST 一段 JS（async 函数体，作用域内有 page、L、S、G）执行并返回结果。
// 用法：curl -s localhost:$DRIVER_PORT --data-binary @snippet.js   所有执行过的片段追加到 actions.log 便于复现。
import http from 'node:http';
import fs from 'node:fs';
import * as L from './lib.mjs';
import { install } from './helpers.mjs';
const { browser, page, errors } = await L.launch();
const S = { errors };
globalThis.page = page; globalThis.L = L; globalThis.S = S;
const G = install(page, L);
globalThis.G = G;
const DRIVER_PORT = Number(process.env.DRIVER_PORT ?? 4198);

// web 端可能比驱动晚就绪（一键脚本并行起三个进程）：先等 /lobby 可访问再导航。
for (let i = 0; i < 120; i++) {
  try {
    const r = await fetch(`${L.WEB}/lobby`);
    if (r.ok) break;
  } catch {}
  await L.sleep(1000);
}
await page.goto(`${L.WEB}/lobby`);
await L.sleep(1500);
const log = fs.createWriteStream(`${L.OUT}actions.log`, { flags: 'a' });
const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const t = new Date().toISOString();
  log.write(`\n--- ${t}\n${body}\n`);
  try { const r = await new AsyncFn('page', 'L', 'S', 'G', body)(page, L, S, G); res.end(JSON.stringify(r ?? null, null, 1)); }
  catch (e) { res.statusCode = 500; res.end(String(e?.stack ?? e)); }
}).listen(DRIVER_PORT, '127.0.0.1', () => console.log(`driver ready on ${DRIVER_PORT}`));
