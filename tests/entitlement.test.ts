import { describe, expect, it } from 'vitest';
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAP_LABEL,
  PLAN_TABLE,
  PURCHASE_URL,
  activateLicense,
  can,
  clearLicense,
  entitlement,
  setProBuild,
} from '../src/data/entitlement';

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = join(here, '..', 'scripts', 'keys', 'private.pem');
const hasKey = existsSync(keyPath);
const keyPem = hasKey ? readFileSync(keyPath, 'utf8') : '';

const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signer = createSign('sha256');
  signer.update(payloadBytes);
  const sig = derToP1363(signer.sign({ key: keyPem, dsaEncoding: 'der' }));
  return `BZR1.${b64url(payloadBytes)}.${b64url(sig)}`;
}

/**
 * 回归目标：**激活入口那条路也要真的解锁**。
 *
 * 以前的 bug 是 verifyLicense 通过后只把码写进 settings，entitlement 里仍然是
 * 空的，于是界面显示「已激活」、can() 恒 false。这里从激活入口一路断言到 can()。
 */
describe('激活入口', () => {
  it('非法码不写 entitlement，can() 仍为 false', async () => {
    setProBuild(true);
    clearLicense();
    const res = await activateLicense('BZR1.not-a-real-code.not-a-real-sig');
    expect(res.ok).toBe(false);
    expect(entitlement().license).toBe('');
    expect(can('stats')).toBe(false);
  });

  it('空码给出人话而不是抛错', async () => {
    setProBuild(true);
    clearLicense();
    const res = await activateLicense('   ');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('激活码');
  });
});

describe.runIf(hasKey)('激活入口（端到端，需要 scripts/keys 私钥）', () => {
  it('合法码：写进 entitlement，can() 立即变 true', async () => {
    setProBuild(true);
    clearLicense();
    const res = await activateLicense(issue({ v: 1, name: '包仔' }));
    expect(res.ok).toBe(true);
    expect(entitlement().tier).toBe('paid');
    expect(entitlement().name).toBe('包仔');
    expect(can('stats')).toBe(true);
  });

  it('过期码：拒绝且清空，不会留下半个已激活状态', async () => {
    setProBuild(true);
    clearLicense();
    const res = await activateLicense(issue({ v: 1, name: '包仔', exp: Date.now() - 86_400_000 }));
    expect(res.ok).toBe(false);
    expect(res.message).toContain('过期');
    expect(entitlement().tier).toBe('free');
  });
});

describe('发行信息', () => {
  it('购买链接指向爱发电商品直链，不是店铺主页', () => {
    // 用户点「去购买」必须落到可以下单的那一页；主页只是店铺动态列表。
    expect(PURCHASE_URL).toBe('https://afdian.com/item/6f17bf10d7e311f1b8735254001e7c00');
  });
});

describe('界面文案', () => {
  it('全书鸟瞰不再混英文（Book Map 只在代码里当标识）', () => {
    expect(CAP_LABEL.bookmap).not.toMatch(/Book\s*Map/i);
    const row = PLAN_TABLE.find((r) => r.cap === 'bookmap');
    expect(row?.name).not.toMatch(/Book\s*Map/i);
    expect(row?.name).toContain('全书鸟瞰');
  });

  it('功能名只用短名，不带括号补充说明', () => {
    for (const row of PLAN_TABLE) expect(row.name, row.name).not.toMatch(/[（(]/);
  });

  it('脚注浮窗属于基础版，且排在第一个付费项前面', () => {
    const footnote = PLAN_TABLE.findIndex((r) => r.name.includes('脚注'));
    expect(footnote).toBeGreaterThan(-1);
    expect(PLAN_TABLE[footnote].free).toBe('yes');
    const firstPaid = PLAN_TABLE.findIndex((r) => r.free === 'no');
    expect(footnote).toBeLessThan(firstPaid);
  });

  it('AI 行覆盖回答、摘要、解释、翻译四件事', () => {
    const ai = PLAN_TABLE.find((r) => r.cap === 'ai');
    for (const word of ['回答', '摘要', '解释', '翻译']) expect(ai?.name).toContain(word);
    expect(CAP_LABEL.ai).toContain('回答');
  });
});
