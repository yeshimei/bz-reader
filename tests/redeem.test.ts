/* 服务端核销核心的端到端测试：真的用发行私钥签码、真的用令牌公钥验令牌。
   存储换成内存实现——核销规则只有 server/core.mjs 一份，换存储不该换行为。 */
import { describe, expect, it } from 'vitest';
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRedeem } from '../server/core.mjs';
import { importCodeKey, importTokenKey } from '../server/crypto.mjs';
import { verifyToken } from '../src/data/license';

const here = dirname(fileURLToPath(import.meta.url));
const keysDir = join(here, '..', 'scripts', 'keys');
const privPath = join(keysDir, 'private.pem');
const pubPath = join(keysDir, 'public-spki.b64');
const tokenPrivPath = join(keysDir, 'token-private.pem');

const hasKeys = existsSync(privPath) && existsSync(pubPath) && existsSync(tokenPrivPath);

const b64url = (buf: Buffer | Uint8Array): string =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function derToP1363(der: Buffer): Buffer {
  let at = 2;
  const readInt = (): Buffer => {
    const len = der[at + 1];
    const val = der.subarray(at + 2, at + 2 + len);
    at += 2 + len;
    const out = Buffer.alloc(32);
    let start = 0;
    while (start < val.length && val[start] === 0) start += 1;
    val.copy(out, 32 - (val.length - start), start);
    return out;
  };
  return Buffer.concat([readInt(), readInt()]);
}

const keyPem = hasKeys ? readFileSync(privPath, 'utf8') : '';

function issueV3(payload: object): string {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signer = createSign('sha256');
  signer.update(bytes);
  const sig = derToP1363(signer.sign({ key: keyPem, dsaEncoding: 'der' }));
  return `BZR3.${b64url(bytes)}.${b64url(sig)}`;
}

/** 内存版 Store，接口与 server/store-d1.mjs 一致 */
function memStore() {
  /** @type {Map<string, any>} */
  const codes = new Map();
  /** @type {any[]} */
  const acts = [];
  return {
    codes,
    acts,
    async getCode(id: string) {
      return codes.get(id) ?? null;
    },
    async putCode(p: any, now: number) {
      if (codes.has(p.id)) return codes.get(p.id);
      const row = {
        id: p.id,
        kind: p.kind,
        days: Number(p.days) || 0,
        max_act: p.maxAct ?? null,
        redeem_by: p.redeemBy ?? null,
        revoked: 0,
        note: p.note ?? null,
        created_at: now,
      };
      codes.set(p.id, row);
      return row;
    },
    async getActivation(codeId: string, installId: string) {
      return acts.find((a) => a.code_id === codeId && a.install_id === installId) ?? null;
    },
    async countActivations(codeId: string) {
      return acts.filter((a) => a.code_id === codeId).length;
    },
    async tryInsertActivation(codeId: string, installId: string, now: number, limit: number | null) {
      if (acts.some((a) => a.code_id === codeId && a.install_id === installId)) return true;
      if (limit !== null && acts.filter((a) => a.code_id === codeId).length >= limit) return false;
      acts.push({ code_id: codeId, install_id: installId, first_at: now });
      return true;
    },
  };
}

const codeKey = hasKeys ? await importCodeKey(readFileSync(pubPath, 'utf8').trim()) : null;
const tokenKey = hasKeys ? await importTokenKey(readFileSync(tokenPrivPath, 'utf8')) : null;

function redeem(store: any, body: any) {
  return handleRedeem({ body, store, codeKey: codeKey!, tokenKey: tokenKey! });
}

const UNIVERSAL = () =>
  issueV3({
    v: 3,
    kind: 'universal',
    id: 'U-TEST-1',
    days: 7,
    redeemBy: Date.now() + 30 * 86_400_000,
    note: '测试',
  });

const PAID = (maxAct = 2) =>
  issueV3({ v: 3, kind: 'paid', id: 'P-TEST-1', days: 0, maxAct, name: '包仔' });

describe.runIf(hasKeys)('核销：通用码', () => {
  it('第一次核销成功，发一枚 7 天令牌', async () => {
    const store = memStore();
    const out = await redeem(store, { code: UNIVERSAL(), installId: 'install-0001', version: '0.1.0' });
    expect(out.status).toBe(200);
    expect(out.body.kind).toBe('universal');
    expect(out.body.days).toBe(7);
    expect(out.body.used).toBe(1);
    expect(out.body.maxAct).toBeNull();
    expect(typeof out.body.token).toBe('string');

    const check = await verifyToken(out.body.token);
    expect(check.ok).toBe(true);
    expect(check.payload?.iid).toBe('install-0001');
    expect(check.payload?.kind).toBe('universal');
    expect(check.payload?.exp).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it('同一台机器重复核销：幂等，不重复占位', async () => {
    const store = memStore();
    const code = UNIVERSAL();
    const a = await redeem(store, { code, installId: 'install-0001' });
    const b = await redeem(store, { code, installId: 'install-0001' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.used).toBe(1);
    expect(store.acts).toHaveLength(1);
  });

  it('不限名额：20 台机器全部通过', async () => {
    const store = memStore();
    const code = UNIVERSAL();
    for (let i = 0; i < 20; i++) {
      const out = await redeem(store, { code, installId: `install-${String(i).padStart(4, '0')}` });
      expect(out.status).toBe(200);
    }
    expect(store.acts).toHaveLength(20);
  });
});

describe.runIf(hasKeys)('核销：付费码', () => {
  it('最多激活 N 次，超出 409', async () => {
    const store = memStore();
    const code = PAID(2);
    const a = await redeem(store, { code, installId: 'install-a' });
    const b = await redeem(store, { code, installId: 'install-b' });
    const c = await redeem(store, { code, installId: 'install-c' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(409);
    expect(c.body.error).toBe('activation_limit');
    expect(store.acts).toHaveLength(2);
  });

  it('同一台机器重复激活不烧次数', async () => {
    const store = memStore();
    const code = PAID(2);
    await redeem(store, { code, installId: 'install-a' });
    const again = await redeem(store, { code, installId: 'install-a' });
    expect(again.status).toBe(200);
    expect(again.body.used).toBe(1);
    // 第二台仍然有名额
    const other = await redeem(store, { code, installId: 'install-b' });
    expect(other.status).toBe(200);
  });

  it('付费码令牌永久（exp = 0）', async () => {
    const store = memStore();
    const out = await redeem(store, { code: PAID(5), installId: 'install-a' });
    const check = await verifyToken(out.body.token);
    expect(check.payload?.exp).toBe(0);
    expect(check.payload?.kind).toBe('paid');
  });
});

describe.runIf(hasKeys)('核销：撤回 / 兑换期 / 坏码', () => {
  it('撤回后新激活 410，已发出的令牌不受影响', async () => {
    const store = memStore();
    const code = UNIVERSAL();
    const first = await redeem(store, { code, installId: 'install-a' });
    expect(first.status).toBe(200);
    store.codes.get('U-TEST-1')!.revoked = 1;
    const second = await redeem(store, { code, installId: 'install-b' });
    expect(second.status).toBe(410);
    expect(second.body.error).toBe('revoked');
    expect((await verifyToken(first.body.token)).ok).toBe(true);
  });

  it('过了兑换期 410', async () => {
    const store = memStore();
    const code = issueV3({
      v: 3,
      kind: 'universal',
      id: 'U-OLD-1',
      days: 7,
      redeemBy: Date.now() - 1000,
    });
    const out = await redeem(store, { code, installId: 'install-a' });
    expect(out.status).toBe(410);
    expect(out.body.error).toBe('expired');
  });

  it('改过内容的码 400，不入库', async () => {
    const store = memStore();
    const [, , sig] = UNIVERSAL().split('.');
    const evil = `BZR3.${b64url(Buffer.from('{"v":3,"kind":"universal","id":"U-EVIL","days":7}'))}.${sig}`;
    const out = await redeem(store, { code: evil, installId: 'install-a' });
    expect(out.status).toBe(400);
    expect(out.body.error).toBe('invalid_code');
    expect(store.codes.size).toBe(0);
  });

  it('老格式 BZR2 码不归这个服务管', async () => {
    const store = memStore();
    const out = await redeem(store, {
      code: `BZR2.${b64url(Buffer.from('{"v":2,"id":"X"}'))}.aGVsbG8`,
      installId: 'install-a',
    });
    expect(out.status).toBe(400);
  });

  it('缺字段 / 过短的 installId 直接 400', async () => {
    const store = memStore();
    expect((await redeem(store, { code: '', installId: 'install-a' })).status).toBe(400);
    expect((await redeem(store, { code: UNIVERSAL(), installId: 'x' })).status).toBe(400);
    expect((await redeem(store, { code: UNIVERSAL(), installId: 123 })).status).toBe(400);
  });
});
