import { describe, expect, it } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenseSummary, parseLicense, verifyLicense } from '../src/data/license';

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = join(here, '..', 'scripts', 'keys', 'private.pem');

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

function issue(payload: object, keyPem: string): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signer = createSign('sha256');
  signer.update(payloadBytes);
  const sig = derToP1363(signer.sign({ key: keyPem, dsaEncoding: 'der' }));
  return `BZR1.${b64url(payloadBytes)}.${b64url(sig)}`;
}

const hasKey = existsSync(keyPath);
const keyPem = hasKey ? readFileSync(keyPath, 'utf8') : '';
// 内嵌公钥必须与 scripts/keys 里的私钥配对——不配对下面的签发测试全挂
const embeds = readFileSync(join(here, '..', 'src', 'data', 'license.ts'), 'utf8');
const PUB = /PUBKEY_SPKI_B64 =\s*'([^']+)'/;

describe('激活码解析', () => {
  it('三段式 + BZR1 前缀 + v1 payload 才算认识', () => {
    expect(parseLicense('BZR1.eyJ2IjoxfQ.aGVsbG8')).toBeTruthy();
    expect(parseLicense('BZR2.eyJ2IjoxfQ.aGVsbG8')).toBeNull();
    expect(parseLicense('BZR1.not-base64!!?.aGVsbG8')).toBeNull();
    expect(parseLicense('')).toBeNull();
  });

  it('坏 payload（不是 JSON / 版本不对）拒绝', () => {
    expect(parseLicense('BZR1.aGVsbG8.aGVsbG8')).toBeNull(); // "hello" 不是对象
    expect(parseLicense(`BZR1.${b64url(Buffer.from('{"v":2}'))}.aGVsbG8`)).toBeNull();
  });
});

describe.runIf(hasKey && PUB.test(embeds))('激活码验签（端到端，需要 scripts/keys + 内嵌公钥配对）', () => {
  it('签发的码验签通过，状态行带署名', async () => {
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
