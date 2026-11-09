import { afterEach, describe, expect, it } from 'vitest';
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLAN_TABLE,
  PURCHASE_URL,
  activateLicense,
  can,
  capLabel,
  clearLicense,
  entitlement,
  revalidateLicense,
  setEntBackend,
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

/* ───────────── 验签三态（A10） ───────────── */

/**
 * 以前的漏洞：`entitlement()` 是同步的，只能拆 payload 不能验签，而 payload
 * 是码里的明文——手写一段 `{"v":1}` 的 base64，再把 checkedTs 填成今天，
 * 就「已激活」了。现在多一道 `verify`：没验过、验不过都不放行。
 */
describe('验签三态（A10）', () => {
  /** 结构合法、签名是假的：parseLicense 认，verifyLicense 不认 */
  const forged =
    'BZR1.' +
    b64url(Buffer.from(JSON.stringify({ v: 1, name: '白嫖' }), 'utf8')) +
    '.' +
    b64url(Buffer.alloc(64, 7));

  it('手填 checkedTs + 伪造 payload：验签没跑过时 can() 为 false', () => {
    setProBuild(true);
    setEntBackend({
      read: () => snapshot({ license: forged, checkedTs: Date.now() }),
      write: () => undefined,
    });
    expect(entitlement().verify).toBe('pending');
    expect(entitlement().tier).toBe('free');
    expect(can('stats')).toBe(false);
  });

  it.runIf(hasKey)('验签不过：verify 变 failed，can() 仍为 false，码被清掉', async () => {
    setProBuild(true);
    setEntBackend({
      read: () => snapshot({ license: forged, checkedTs: Date.now() }),
      write: () => undefined,
    });
    const res = await revalidateLicense();
    expect(res.changed).toBe(true);
    expect(entitlement().verify).toBe('failed');
    expect(can('stats')).toBe(false);
    expect(entitlement().license).toBe('');
  });

  it.runIf(hasKey)('真码验过之后才放行', async () => {
    setProBuild(true);
    let written: unknown = null;
    setEntBackend({
      read: () => snapshot({ license: issue({ v: 1, name: '包仔' }), checkedTs: Date.now() }),
      write: (raw) => {
        written = raw;
      },
    });
    expect(entitlement().verify).toBe('pending');
    expect(can('stats')).toBe(false); // 首帧不放行

    await revalidateLicense();
    expect(entitlement().verify).toBe('ok');
    expect(can('stats')).toBe(true);
    expect(written).toBeNull(); // 验过不等于要重写盘
  });

  it.runIf(hasKey)('过期码：verify 是 ok（签名是真的），但 tier 是 free', async () => {
    setProBuild(true);
    setEntBackend({
      read: () => snapshot({ license: issue({ v: 1, name: '包仔', exp: Date.now() - 86_400_000 }), checkedTs: 1 }),
      write: () => undefined,
    });
    await revalidateLicense();
    expect(entitlement().verify).toBe('ok');
    expect(entitlement().tier).toBe('free');
    expect(can('stats')).toBe(false);
    expect(entitlement().license).not.toBe(''); // 码留着，续费后不用重填
  });
});

describe('发行信息', () => {
  it('购买链接指向当前在售的店铺页', () => {
    // 用户点「去购买」要一步落到能下单的那一页；换渠道只改这一处。
    expect(PURCHASE_URL).toBe('https://wzyp.cn/shop/IFCEI5I3');
  });
});

describe('界面文案', () => {
  it('全书鸟瞰不再混英文（Book Map 只在代码里当标识）', () => {
    expect(capLabel('bookmap')).not.toMatch(/Book\s*Map/i);
    expect(capLabel('bookmap')).toContain('全书鸟瞰');
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

  it('AI 解释 / 翻译 / 摘要单独一行，紧跟在 AI 全书问答上面', () => {
    const sel = PLAN_TABLE.findIndex((r) => r.cap === 'aiSel');
    const book = PLAN_TABLE.findIndex((r) => r.cap === 'ai');
    expect(sel).toBeGreaterThan(-1);
    expect(book).toBe(sel + 1);
    expect(PLAN_TABLE[sel].name).toContain('解释');
    expect(PLAN_TABLE[book].name).toBe('AI 全书问答');
    expect(capLabel('ai')).toBe('AI 全书问答');
  });

  it('分类管理紧跟在脚注浮窗下面，两栏都打勾', () => {
    const footnote = PLAN_TABLE.findIndex((r) => r.name.includes('脚注'));
    expect(footnote).toBeGreaterThan(-1);
    const classify = PLAN_TABLE[footnote + 1];
    expect(classify.key).toBe('classify');
    expect(classify.name).toBe('分类管理');
    expect(classify.free).toBe('yes');
    expect(classify.pro).toBe('yes');
    /* 基础版行不挂 cap：它没有「被拦下」的时刻 */
    expect(classify.cap).toBeUndefined();
  });

  it('更多格式仍排在基础版第一块之后', () => {
    const footnote = PLAN_TABLE.findIndex((r) => r.name.includes('脚注'));
    expect(PLAN_TABLE[footnote + 2].key).toBe('formats');
    expect(PLAN_TABLE[footnote + 2].cap).toBe('fullFormats');
  });

  it('对照表不再单列向量检索，表尾只剩 BZ 知识库', () => {
    expect(PLAN_TABLE.some((r) => r.name.includes('向量'))).toBe(false);
    expect(PLAN_TABLE.slice(-1).map((r) => r.key)).toEqual(['kb']);
    expect(PLAN_TABLE.slice(-1).map((r) => r.name)).toEqual(['连接至 BZ AI 知识库']);
  });

  it('统计那一行写全：统计、打卡与目标', () => {
    const stats = PLAN_TABLE.find((r) => r.cap === 'stats');
    expect(stats?.name).toBe('阅读统计、打卡与目标');
    /* 被锁时弹层显示的那句卖点，与行名同一个说法 */
    expect(capLabel('stats')).toBe('阅读统计、打卡与目标');
  });

  it('书摘那一行写「图片」：书摘卡片本身是基础版就有的', () => {
    const card = PLAN_TABLE.find((r) => r.cap === 'card');
    expect(card?.name).toBe('书摘图片');
    expect(capLabel('card')).toContain('书摘图片');
  });

  it('每个付费行都有唯一 cap：解锁弹层才能高亮并滚到正确那一行', () => {
    const caps = PLAN_TABLE.filter((r) => r.free === 'no').map((r) => r.cap);
    expect(caps.every(Boolean)).toBe(true);
    expect(new Set(caps).size).toBe(caps.length);
    /* 基础版行不该挂 cap：它们没有「被拦下」的时刻 */
    for (const r of PLAN_TABLE.filter((r) => r.free === 'yes')) expect(r.cap).toBeUndefined();
  });
});

/* ───────────── 授权存哪（P1-05 / P1-06） ───────────── */

function snapshot(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    installId: 'i-test',
    activeDays: [],
    lastSeenTs: 1,
    clockAnomaly: 0,
    trialVoid: false,
    license: '',
    checkedTs: 0,
    ...over,
  };
}

afterEach(() => setEntBackend(null));

describe('授权存 data.json 而不是 localStorage（P1-06）', () => {
  it('后端里有码就直接认，不必等 localStorage', () => {
    setProBuild(true);
    setEntBackend({ read: () => snapshot({ license: 'BZR1.a.b', checkedTs: 5 }), write: () => undefined });
    expect(entitlement().license).toBe('BZR1.a.b');
  });

  it('激活成功后码写进后端（宿主落盘 data.json），不碰业务设置', async () => {
    if (!hasKey) return;
    setProBuild(true);
    let written: unknown = null;
    setEntBackend({
      read: () => snapshot(),
      write: (raw) => {
        written = raw;
      },
    });
    const res = await activateLicense(issue({ v: 1, name: '包仔' }));
    expect(res.ok).toBe(true);
    expect((written as { license?: string })?.license).toBeTruthy();
    expect(entitlement().tier).toBe('paid');
  });

  it('后端为空时才用 localStorage 镜像兜底', () => {
    const g = globalThis as { window?: { localStorage?: unknown } };
    const store = new Map<string, string>();
    g.window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    };
    store.set('bzs-entitlement-v1', JSON.stringify(snapshot({ license: 'BZR1.mirror.b', checkedTs: 7 })));
    setProBuild(true);
    setEntBackend({ read: () => null, write: () => undefined });
    expect(entitlement().license).toBe('BZR1.mirror.b');
    delete g.window;
  });
});

describe.runIf(hasKey)('到期不清码（P1-05）', () => {
  it('过期码：验签不过但码留着，只是降级——续费后不用重新找码', async () => {
    setProBuild(true);
    const code = issue({ v: 1, name: '包仔', exp: Date.now() - 86_400_000 });
    setEntBackend({ read: () => snapshot({ license: code, checkedTs: 1 }), write: () => undefined });

    const r = await revalidateLicense();
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('expired');
    expect(entitlement().license).toBe(code); // 码还在
    expect(entitlement().tier).toBe('free'); // 但功能锁上
  });

  it('伪造码：验签不过就清掉，不给「已激活但功能全锁」的错觉', async () => {
    setProBuild(true);
    const forged = `BZR1.${b64url(Buffer.from('{"v":1,"name":"冒充"}'))}.${b64url(Buffer.alloc(64))}`;
    let cleared = false;
    setEntBackend({
      read: () => snapshot({ license: forged, checkedTs: 1 }),
      write: (raw) => {
        cleared = !(raw as { license?: string }).license;
      },
    });

    const r = await revalidateLicense();
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('invalid');
    expect(cleared).toBe(true);
    expect(entitlement().license).toBe('');
  });

  /* 2026-11-08 改口径（A10）：env-error 以前保留「上次验过了」的结论，
     于是让 WebCrypto 抖一下就能白嫖高级功能。现在码不动（环境抖了不是码假），
     但验签结论落到 failed，can() / tier 一律不放行，等下一次启动重新验。 */
  it('验签环境异常（WebCrypto 抛错）：码留着，但不放行', async () => {
    setProBuild(true);
    const code = issue({ v: 1, name: '包仔' });
    setEntBackend({ read: () => snapshot({ license: code, checkedTs: 1 }), write: () => undefined });

    const real = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: { verify: () => Promise.reject(new Error('boom')), importKey: real.subtle.importKey.bind(real.subtle) } },
      configurable: true,
      writable: true,
    });
    try {
      const r = await revalidateLicense();
      expect(r.changed).toBe(false);
      expect(r.reason).toBe('env-error');
      expect(entitlement().license).toBe(code); // 码不清：环境的问题，不是码的问题
      expect(entitlement().verify).toBe('failed');
      expect(entitlement().tier).not.toBe('paid'); // 沿用上次结论就是给伪造开门
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true, writable: true });
    }
  });
});
