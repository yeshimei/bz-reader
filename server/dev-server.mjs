#!/usr/bin/env node
/* ============================================================
 * bz-reader · 激活服务 · 本地开发服务器（server/dev-server.mjs）
 *
 *   node server/dev-server.mjs            # 127.0.0.1:8787
 *   PORT=9000 node server/dev-server.mjs
 *
 * 跟线上 Worker 共用 server/core.mjs，只有存储不同（JSON 文件 vs D1）。
 * 客户端把端点指过来即可联调：
 *
 *   localStorage.setItem('bzs-license-endpoint', 'http://127.0.0.1:8787/v1/redeem')
 *
 * 日志只有「码号 + installId 前 8 位 + 状态」，不记 IP、不记 UA。
 * ============================================================ */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCodeKey, importTokenKey } from './crypto.mjs';
import { handleRedeem } from './core.mjs';
import { jsonStore } from './store-json.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const keysDir = join(root, 'scripts', 'keys');

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const storeFile = process.env.LICENSE_STORE || join(root, '.scratch', 'license-store.json');

const codeKey = await importCodeKey(
  process.env.CODE_PUBKEY || readFileSync(join(keysDir, 'public-spki.b64'), 'utf8').trim(),
);
const tokenKey = await importTokenKey(
  process.env.TOKEN_PRIVATE_KEY || readFileSync(join(keysDir, 'token-private.pem'), 'utf8'),
);
const store = jsonStore(storeFile);

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(text);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((ok, bad) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        bad(new Error('too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', bad);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, store: storeFile });
  }

  if (req.method !== 'POST' || url.pathname !== '/v1/redeem') {
    return send(res, 404, { error: 'not_found', message: '没有这个接口。' });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'bad_request', message: '请求体不是 JSON，或者太大。' });
  }

  try {
    const out = await handleRedeem({ body, store, codeKey, tokenKey });
    const codeId = typeof body?.code === 'string' ? body.code.split('.')[1]?.slice(0, 6) : '';
    const iid = typeof body?.installId === 'string' ? body.installId.slice(0, 8) : '';
    console.log(
      `[redeem] ${out.status} code=${codeId}… iid=${iid}… ` +
        (out.status === 200
          ? `kind=${out.body.kind} used=${out.body.used}${out.body.maxAct ? `/${out.body.maxAct}` : ''}`
          : out.body.error),
    );
    return send(res, out.status, out.body);
  } catch (e) {
    console.error('[redeem] 500', e);
    return send(res, 500, { error: 'server_error', message: '服务内部错误，稍后再试。' });
  }
});

server.listen(port, host, () => {
  console.log(`bz 激活服务（本地）→ http://${host}:${port}/v1/redeem`);
  console.log(`存储：${storeFile}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n收工。');
    server.close(() => process.exit(0));
  });
}
