import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REVOKED_STATE_KEY,
  _resetRevokedForTests,
  builtinRevokedHit,
  revokedSeenAt,
} from '../src/data/revoked';
import {
  BUILTIN_REVOKED_IDS,
  BUILTIN_REVOKED_UPDATED_AT,
} from '../src/data/revoked-builtin';
import { _resetClockForTests } from '../src/data/trusted-clock';
import { entitlement, setEntBackend, setLicense } from '../src/data/entitlement';

/* ============================================================
 * 内置名单（tests/revoked-builtin.test.ts）
 *
 * 这一层解决的是「拉不到名单就放行」：
 *   · 断网启动，包里的常量照样命中；
 *   · 清 localStorage 没用，常量在代码里；
 *   · 解封靠 updatedAt 闸门——设备见过不早于它的线上名单后即让位。
 *
 * 第一组是**发布守卫**：改了 docs/revoked.json 却忘了跑
 * `npm run gen:revoked`，这里必须红。忘了生成 = 封禁不随版本下发。
 * ============================================================ */

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = join(here, '..', 'scripts', 'keys', 'private.pem');
const hasKey = existsSync(keyPath);
const keyPem = hasKey ? readFileSync(keyPath, 'utf8') : '';
const listPath = join(here, '..', 'docs', 'revoked.json');

const b64url = (buf: Buffer): string =>
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

function issue(payload: object): string {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signer = createSign('sha256');
  signer.update(bytes);
  const sig = derToP1363(signer.sign({ key: keyPem, dsaEncoding: 'der' }));
  return `BZR2.${b64url(bytes)}.${b64url(sig)}`;
}

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

const g = globalThis as unknown as Record<string, unknown>;
let storage: MemoryStorage;

beforeAll(() => {
  storage = new MemoryStorage();
  g.window = globalThis;
  g.localStorage = storage;
});

afterAll(() => {
  delete g.localStorage;
});

beforeEach(() => {
  storage.clear();
  _resetRevokedForTests();
  _resetClockForTests();
  setEntBackend({ read: () => null, write: () => undefined });
});

afterEach(() => {
  setEntBackend(null);
});

describe('发布守卫：内置名单必须与 docs/revoked.json 同步', () => {
  it('版本号一致（改了名单忘了跑 gen:revoked 就在这里红）', () => {
    const doc = JSON.parse(readFileSync(listPath, 'utf8')) as { updatedAt: number };
    expect(BUILTIN_REVOKED_UPDATED_AT).toBe(doc.updatedAt);
  });

  it('名单里的码号一个都不能漏', () => {
    const doc = JSON.parse(readFileSync(listPath, 'utf8')) as { ids: string[] };
    for (const id of doc.ids) {
      expect(BUILTIN_REVOKED_IDS).toContain(id.trim().toUpperCase());
    }
  });
});

describe.runIf(hasKey)('内置命中与解封闸门', () => {
  /* 用真实名单里的第一个码号造一枚码；名单为空时这条没有意义 */
  const targetId = BUILTIN_REVOKED_IDS[0] ?? '';
  const CODE = targetId ? issue({ v: 2, id: targetId, plan: 'lifetime' }) : '';

  it('设备没见过线上名单时，内置名单命中', () => {
    expect(revokedSeenAt()).toBe(0);
    expect(builtinRevokedHit(CODE)).toBe(true);
  });

  it('设备见过更新的线上名单后，内置名单让位（解封能恢复）', () => {
    storage.setItem(
      REVOKED_STATE_KEY,
      JSON.stringify({ code: '', at: BUILTIN_REVOKED_UPDATED_AT, checkedAt: 1 }),
    );
    _resetRevokedForTests();
    expect(builtinRevokedHit(CODE)).toBe(false);
  });

  it('内置命中 → entitlement 判停用、掉回基础版', () => {
    setLicense(CODE);
    const v = entitlement();
    expect(v.revoked).toBe(true);
    expect(v.tier).toBe('free');
    expect(v.unlocked).toBe(false);
  });
});
