import { describe, expect, it } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenseSummary, parseLicense, parseToken, verifyLicense, verifyToken } from '../src/data/license';

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = join(here, '..', 'scripts', 'keys', 'private.pem');
const tokenKeyPath = join(here, '..', 'scripts', 'keys', 'token-private.pem');

const b64url = (buf: Buffer | Uint8Array): string =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** DER 签名 → P1363 裸格式（与 scripts/issue-license.mjs 同一转换，测试里独立实现一遍防脚本退化） */
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

function sign(payload: object, keyPem: string, tag: string): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signer = createSign('sha256');
  signer.update(payloadBytes);
  const sig = derToP1363(signer.sign({ key: keyPem, dsaEncoding: 'der' }));
  return `${tag}.${b64url(payloadBytes)}.${b64url(sig)}`;
}

const issue = (payload: object, keyPem: string): string => sign(payload, keyPem, 'BZR1');
const issueV3 = (payload: object, keyPem: string): string => sign(payload, keyPem, 'BZR3');
const issueToken = (payload: object, keyPem: string): string => sign(payload, keyPem, 'BZRT');

const hasKey = existsSync(keyPath);
const keyPem = hasKey ? readFileSync(keyPath, 'utf8') : '';
const hasTokenKey = existsSync(tokenKeyPath);
const tokenKeyPem = hasTokenKey ? readFileSync(tokenKeyPath, 'utf8') : '';
// 内嵌公钥必须与 scripts/keys 里的私钥配对——不配对下面的签发测试全挂
const embeds = readFileSync(join(here, '..', 'src', 'data', 'license.ts'), 'utf8');
const PUB = /PUBKEY_SPKI_B64 =\s*'([^']+)'/;
const TPUB = /TOKEN_PUBKEY_SPKI_B64 =\s*'([^']+)'/;

describe('激活码解析', () => {
  it('三段式 + BZR1/BZR2/BZR3 前缀 + 版本匹配才算认识', () => {
    expect(parseLicense('BZR1.eyJ2IjoxfQ.aGVsbG8')).toBeTruthy();
    expect(parseLicense('BZR2.eyJ2IjoyfQ.aGVsbG8')).toBeTruthy();
    expect(parseLicense(`BZR3.${b64url(Buffer.from('{"v":3}'))}.aGVsbG8`)).toBeTruthy();
    expect(parseLicense('BZR4.eyJ2IjozfQ.aGVsbG8')).toBeNull(); // 未知前缀
    expect(parseLicense('BZR1.not-base64!!?.aGVsbG8')).toBeNull();
    expect(parseLicense('')).toBeNull();
  });

  it('前缀与版本对不上就拒绝（防止 v3 塞进老前缀绕过核销）', () => {
    expect(parseLicense(`BZR2.${b64url(Buffer.from('{"v":3}'))}.aGVsbG8`)).toBeNull();
    expect(parseLicense(`BZR3.${b64url(Buffer.from('{"v":2}'))}.aGVsbG8`)).toBeNull();
  });

  it('坏 payload（不是 JSON / 版本不对）拒绝', () => {
    expect(parseLicense('BZR1.aGVsbG8.aGVsbG8')).toBeNull(); // "hello" 不是对象
    expect(parseLicense(`BZR1.${b64url(Buffer.from('{"v":3}'))}.aGVsbG8`)).toBeNull();
  });
});

describe.runIf(hasKey && PUB.test(embeds))('激活码验签（端到端，需要 scripts/keys + 内嵌公钥配对）', () => {
  it('签发的老码验签通过，状态行带署名', async () => {
    const code = issue({ v: 1, name: '包仔' }, keyPem);
    const res = await verifyLicense(code);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('包仔');
    expect(res.message).toContain('永久');
    expect(licenseSummary(code)).toContain('包仔');
  });

  it('改过 payload 的码拒绝', async () => {
    const code = issue({ v: 1, name: '包仔' }, keyPem);
    const [, , sig64] = code.split('.');
    const evil = `BZR1.${b64url(Buffer.from('{"v":1,"name":"别人"}'))}.${sig64}`;
    const res = await verifyLicense(evil);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('失败');
  });

  it('过期码拒绝并给出日期', async () => {
    const code = issue({ v: 1, name: '包仔', exp: Date.now() - 86_400_000 }, keyPem);
    const res = await verifyLicense(code);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('过期');
    expect(licenseSummary(code)).toContain('已过期');
  });

  it('用别的私钥签的码拒绝', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const other = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const res = await verifyLicense(issue({ v: 1, name: '冒牌' }, other));
    expect(res.ok).toBe(false);
  });

  it('空码给出引导而不是抛错', async () => {
    const res = await verifyLicense('  ');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('激活码');
  });
});

describe.runIf(hasKey && PUB.test(embeds))('BZR3 激活码：签名通过但必须核销', () => {
  it('v3 通用码不直接放行，返回 needRedeem', async () => {
    const code = issueV3(
      { v: 3, kind: 'universal', id: 'U-TEST-1', days: 7, redeemBy: Date.now() + 86_400_000 },
      keyPem,
    );
    const res = await verifyLicense(code);
    expect(res.ok).toBe(false);
    expect(res.needRedeem).toBe(true);
    expect(res.message).toContain('联网');
    expect(res.payload?.kind).toBe('universal');
  });

  it('过了兑换截止直接拒绝，不给核销入口', async () => {
    const code = issueV3(
      { v: 3, kind: 'universal', id: 'U-TEST-2', days: 7, redeemBy: Date.now() - 1000 },
      keyPem,
    );
    const res = await verifyLicense(code);
    expect(res.ok).toBe(false);
    expect(res.needRedeem).toBeUndefined();
    expect(res.message).toContain('截止兑换');
  });

  it('v3 码改一个字节就验签失败', async () => {
    const code = issueV3({ v: 3, kind: 'paid', id: 'P-TEST-1', days: 0, maxAct: 5 }, keyPem);
    const [, payload, sig] = code.split('.');
    const evil = `BZR3.${b64url(Buffer.from('{"v":3,"kind":"paid","id":"P-TEST-1","days":0,"maxAct":999}'))}.${sig}`;
    expect(payload).toBeTruthy();
    const res = await verifyLicense(evil);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('失败');
  });

  it('v3 码在设置页不显示「已激活」（结论由令牌给）', () => {
    const code = issueV3({ v: 3, kind: 'paid', id: 'P-TEST-2', days: 0, maxAct: 5 }, keyPem);
    expect(licenseSummary(code)).toBe('');
  });
});

describe.runIf(hasTokenKey && TPUB.test(embeds))('设备令牌验签', () => {
  const token = (over: object = {}) =>
    issueToken(
      { v: 1, cid: 'U-TEST-1', iid: 'install-abc', kind: 'universal', exp: Date.now() + 86_400_000, iat: Date.now(), ...over },
      tokenKeyPem,
    );

  it('合法令牌通过，payload 可拆', async () => {
    const t = token();
    const res = await verifyToken(t);
    expect(res.ok).toBe(true);
    expect(res.payload?.iid).toBe('install-abc');
    expect(parseToken(t)?.kind).toBe('universal');
  });

  it('改过 payload 的令牌拒绝', async () => {
    const [, , sig] = token().split('.');
    const evil = `BZRT.${b64url(Buffer.from('{"v":1,"cid":"U-TEST-1","iid":"别的机器","kind":"paid","exp":0,"iat":1}'))}.${sig}`;
    const res = await verifyToken(evil);
    expect(res.ok).toBe(false);
  });

  it('用发行私钥签的「令牌」拒绝（两把密钥不能混用）', async () => {
    const res = await verifyToken(issueToken({ v: 1, cid: 'x', iid: 'y', kind: 'paid', exp: 0, iat: 1 }, keyPem));
    expect(res.ok).toBe(false);
  });

  it('格式不对的令牌返回 null 而不是抛错', () => {
    expect(parseToken('')).toBeNull();
    expect(parseToken('BZRT.abc')).toBeNull();
    expect(parseToken('BZR3.eyJ2IjozfQ.aGVsbG8')).toBeNull();
  });
});
