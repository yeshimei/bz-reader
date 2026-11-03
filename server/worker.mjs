/* ============================================================
 * bz-reader · 激活服务 · Cloudflare Worker（server/worker.mjs）
 *
 * 部署见 server/README.md。只有一个路由：
 *   POST /v1/redeem  { code, installId, version }  → { token, kind, days, exp, used, maxAct }
 *   GET  /health
 *
 * 环境变量：
 *   CODE_PUBKEY        发行公钥（SPKI base64），放 [vars]
 *   TOKEN_PRIVATE_KEY  令牌私钥（PKCS8 PEM），必须 `wrangler secret put`
 *   DB                 D1 绑定
 * ============================================================ */

import { importCodeKey, importTokenKey } from './crypto.mjs';
import { handleRedeem } from './core.mjs';
import { d1Store } from './store-d1.mjs';

/** 每个 isolate 只 import 一次密钥 */
let keys = null;

async function getKeys(env) {
  if (!keys) {
    keys = {
      codeKey: await importCodeKey(env.CODE_PUBKEY),
      tokenKey: await importTokenKey(env.TOKEN_PRIVATE_KEY),
    };
  }
  return keys;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }

    if (req.method !== 'POST' || url.pathname !== '/v1/redeem') {
      return json({ error: 'not_found', message: '没有这个接口。' }, 404);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad_request', message: '请求体不是 JSON。' }, 400);
    }

    try {
      const { codeKey, tokenKey } = await getKeys(env);
      const out = await handleRedeem({ body, store: d1Store(env.DB), codeKey, tokenKey });
      return json(out.body, out.status);
    } catch (e) {
      console.error('redeem failed', e);
      return json({ error: 'server_error', message: '服务内部错误，稍后再试。' }, 500);
    }
  },
};
