#!/usr/bin/env node
// 本地重试代理：Claude Code → 本代理 → tako 网关。
// 网关偶发的 400（「请求被拦截，请重新发送」等）Claude Code 视为客户端错误不重试，子代理直接死掉；
// 本代理在任何字节回给客户端之前识别这类响应并原样重发，成功的响应（含 SSE 流）不缓冲直接透传。
// 零依赖，见同目录 README.md。
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = Number(process.env.PORT || 18990);
const UPSTREAM = new URL(process.env.UPSTREAM || 'https://tako.shiroha.tech');
const MAX_RETRY = Number(process.env.MAX_RETRY || 6);
const RETRY_BUDGET_MS = Number(process.env.RETRY_BUDGET_MS || 90_000);
const LOG_FILE = process.env.LOG_FILE || path.join(os.homedir(), '.local/state/api-retry-proxy/retry.log');
// 测试用故障注入：对 model 匹配 FAULT_MODEL 的请求，前 FAULT_400 次假装上游回了 11128。
let faultLeft = Number(process.env.FAULT_400 || 0);
const FAULT_MODEL = process.env.FAULT_MODEL ? new RegExp(process.env.FAULT_MODEL) : null;

// 这些 400 是网关/上游的瞬时拦截，重发即可；其余 400（真·参数错误）原样返回。
const TRANSIENT_400 = [
  /"code"\s*:\s*11128/, // conversation id missing / Request blocked. Please send it again
  /"code"\s*:\s*11133/, // Invalid request parameters / model_param_invalid
  /model_param_invalid/,
  /invalid request error trace_id/, // {"type":"invalid_request_error","code":"",...}
  /send it again/i,
];
// 其中明确要求「重新发送」的，本代理重试用尽后改报 503，让 Claude Code 再按 5xx 自己重试一轮；
// 另两种可能是请求本身固定会错，保持 400 尽快失败（见 README「放弃之后」）。
const REWRITE_503 = [/"code"\s*:\s*11128/, /send it again/i];
const RETRY_5XX = new Set([500, 502, 503, 504]);
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']);

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
function log(rec) {
  fs.appendFile(LOG_FILE, JSON.stringify({ t: new Date().toISOString(), ...rec }) + '\n', () => {});
}

function decode(buf, enc) {
  try {
    if (enc === 'gzip') return zlib.gunzipSync(buf).toString();
    if (enc === 'br') return zlib.brotliDecompressSync(buf).toString();
    if (enc === 'deflate') return zlib.inflateSync(buf).toString();
  } catch { /* 解不开就按原文匹配 */ }
  return buf.toString();
}

function modelOf(body) {
  const m = /"model"\s*:\s*"([^"]+)"/.exec(body.subarray(0, 4096).toString());
  return m ? m[1] : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sendUpstream(req, body, signal) {
  return new Promise((resolve, reject) => {
    const headers = { ...req.headers, host: UPSTREAM.host };
    for (const h of Object.keys(headers)) if (HOP_BY_HOP.has(h)) delete headers[h];
    if (body.length || req.method !== 'GET') headers['content-length'] = String(body.length);
    const up = https.request(
      { protocol: UPSTREAM.protocol, hostname: UPSTREAM.hostname, port: UPSTREAM.port || 443, method: req.method, path: req.url, headers, signal },
      resolve,
    );
    up.on('error', reject);
    up.end(body);
  });
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function fakeUpstream400() {
  const body = Buffer.from(process.env.FAULT_BODY || '{"code":11128,"msg":"conversation id missing","displayMsg":{"en":"Request blocked. Please send it again"}}');
  return { statusCode: 400, headers: { 'content-type': 'application/json' }, injectedBody: body };
}

async function handle(req, res) {
  const body = await readAll(req);
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  const model = modelOf(body);
  const started = Date.now();
  let lastErr = null;

  for (let attempt = 0; ; attempt++) {
    let up;
    let upBody = null;
    try {
      if (faultLeft > 0 && FAULT_MODEL?.test(model) && req.method === 'POST') {
        faultLeft--;
        up = fakeUpstream400();
        upBody = up.injectedBody;
      } else {
        up = await sendUpstream(req, body, ac.signal);
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      lastErr = e;
      up = null;
    }

    const canRetry = attempt < MAX_RETRY && Date.now() - started < RETRY_BUDGET_MS && !ac.signal.aborted;
    let reason = null;
    let text = '';
    if (!up) {
      reason = `net:${lastErr?.code || lastErr?.message}`;
    } else if (up.statusCode === 400 || RETRY_5XX.has(up.statusCode)) {
      if (!upBody) upBody = await readAll(up).catch(() => Buffer.alloc(0));
      text = decode(upBody, up.headers['content-encoding']);
      if (RETRY_5XX.has(up.statusCode) || TRANSIENT_400.some((re) => re.test(text))) {
        reason = `${up.statusCode}:${text.slice(0, 160)}`;
      }
    }

    if (reason && canRetry) {
      const delay = Math.min(1000 * 2 ** attempt, 15_000);
      log({ ev: 'retry', model, path: req.url, attempt: attempt + 1, delay, reason });
      await sleep(delay);
      continue;
    }

    const as503 = Boolean(reason) && up?.statusCode === 400 && REWRITE_503.some((re) => re.test(text));
    if (attempt > 0 || as503) log({ ev: reason ? 'giveup' : 'recovered', model, path: req.url, attempts: attempt + 1, status: up?.statusCode, as503, reason });

    if (as503) {
      res.writeHead(503, { 'content-type': 'application/json', 'x-should-retry': 'true', 'x-retry-proxy-attempts': String(attempt + 1) });
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `api-retry-proxy: 上游 400 重试 ${attempt + 1} 次仍被拦截，改报 503 交给客户端重试。原文: ${text.slice(0, 300)}` } }));
      return;
    }
    if (!up) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `api-retry-proxy: upstream unreachable (${lastErr?.code || lastErr?.message})` } }));
      return;
    }
    const headers = {};
    for (const [k, v] of Object.entries(up.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
    headers['x-retry-proxy-attempts'] = String(attempt + 1);
    if (upBody) {
      headers['content-length'] = String(upBody.length);
      res.writeHead(up.statusCode, headers);
      res.end(upBody);
    } else {
      res.writeHead(up.statusCode, headers);
      up.pipe(res);
      up.on('error', () => res.destroy());
    }
    return;
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    log({ ev: 'crash', path: req.url, err: String(e?.stack || e) });
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end();
  });
});
server.requestTimeout = 0; // 长 SSE 流由客户端自己管超时
server.headersTimeout = 60_000;
server.keepAliveTimeout = 65_000;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`api-retry-proxy :${PORT} → ${UPSTREAM.origin}  log=${LOG_FILE}${faultLeft ? `  FAULT_400=${faultLeft} /${FAULT_MODEL}/` : ''}`);
});
