// 只读事件记录器：每 3 秒拉一次 /events/snapshot（since_tick 增量），把关键事件追加到 events.jsonl。
// 用于事后取精确 tick（首攻、阵亡、研究完成、黑雾激怒等）。不发送任何命令。
import fs from 'node:fs';
const SERVER = process.env.P1V_SERVER ?? 'http://127.0.0.1:19630';
const OUT = `${process.env.PT_OUT.replace(/\/?$/, '/')}events.jsonl`;
const H = { authorization: 'Bearer key_player_1' };
let since = 0;
const seen = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
while (true) {
  try {
    const r = await fetch(`${SERVER}/events/snapshot?event_types=all&since_tick=${since}&limit=500`, { headers: H });
    const j = await r.json();
    const evs = j.events ?? [];
    for (const e of evs) {
      if (seen.has(e.event_id)) continue;
      seen.add(e.event_id);
      fs.appendFileSync(OUT, JSON.stringify({ tick: e.tick, type: e.event_type, scope: e.visibility_scope, payload: e.payload }) + '\n');
    }
    if (evs.length) since = Math.max(since, ...evs.map((e) => e.tick)) + 1;
    // 读档会让 tick 回退：发现当前 tick 小于 since 时重置，否则日志会永久停更
    const sum = await (await fetch(`${SERVER}/state/summary`, { headers: H })).json();
    if (sum.tick < since) { since = 0; }
  } catch (err) {
    fs.appendFileSync(OUT, JSON.stringify({ error: String(err) }) + '\n');
  }
  await sleep(3000);
}
