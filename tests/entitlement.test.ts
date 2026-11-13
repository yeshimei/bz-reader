import { afterEach, describe, expect, it } from 'vitest';
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLAN_GROUPS,
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
  tierText,
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
    /* 两个例外，都不是「给功能名打补丁」（「书摘（图片版）」那种才是要拦的）：
       formats 括号里是「Kindle 系」这一族的扩展名枚举；
       kb 2026-11-14 起按 bz 的文案统一叫「AI 知识盒」，行名不带括号。 */
    const ALLOWED = new Set(['formats']);
    for (const row of PLAN_TABLE) {
      if (ALLOWED.has(row.key)) continue;
      expect(row.name, row.name).not.toMatch(/[（(]/);
    }
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

  it('分类管理是免费区最后一行：跟着书摘图片，两栏都打勾', () => {
    /* 1.0.0：书摘图片下放免费区，插在脚注浮窗与分类管理之间，所以
       「紧跟脚注浮窗」不再成立。真正要守的是「它在免费段最末」——
       后面一行就是付费的「更多格式」，免费项不许漏到付费段里去。 */
    const free = PLAN_TABLE.filter((r) => r.free === 'yes');
    const classify = free[free.length - 1];
    expect(classify.key).toBe('classify');
    expect(classify.name).toBe('分类管理');
    expect(classify.pro).toBe('yes');
    /* 基础版行不挂 cap：它没有「被拦下」的时刻 */
    expect(classify.cap).toBeUndefined();
  });

  it('更多格式仍是第一个付费项，紧跟在免费区之后', () => {
    /* 1.0.0 免费区补了「引用页签」，写死 footnote + 2 会跟着错位；
       这里按「第一行不是两栏都打勾」定位，加多少免费行都不会误判。 */
    const firstPaid = PLAN_TABLE.find((r) => r.free === 'no');
    expect(firstPaid?.key).toBe('formats');
    expect(firstPaid?.cap).toBe('fullFormats');
  });

  it('对照表不再单列向量检索，知识库后是剪藏成书，再往后是探索中段', () => {
    expect(PLAN_TABLE.some((r) => r.name.includes('向量'))).toBe(false);
    const kbAt = PLAN_TABLE.findIndex((r) => r.key === 'kb');
    expect(kbAt).toBeGreaterThan(-1);
    expect(PLAN_TABLE[kbAt]?.name).toBe('AI 知识盒');
    /* 2026-11-13：剪藏成书实现后从探索中转正，排在正式段末尾；
       探索中段仍收在表尾，它们不是「买到了什么」。 */
    expect(PLAN_TABLE[kbAt + 1]?.key).toBe('clipEpub');
    expect(PLAN_TABLE.slice(kbAt + 2).map((r) => r.key)).toEqual(
      PLAN_GROUPS.find((g) => g.key === 'explore')?.rows,
    );
  });

  it('数据面板那一行写全：时长、趋势、节律、书籍明细', () => {
    const stats = PLAN_TABLE.find((r) => r.cap === 'stats');
    expect(stats?.name).toBe('数据面板：时长、趋势、节律、书籍明细');
    /* 被锁时弹层显示的那句卖点，指的还是同一个「数据面板」，别退回
       「阅读统计」这种说法——用户点的是数据面板，弹层得说同一件事。 */
    expect(capLabel('stats')).toContain('数据面板');
  });

  it('书摘图片下放基础版：两栏都能用，不挂能力位', () => {
    const card = PLAN_TABLE.find((r) => r.key === 'card');
    expect(card?.name).toBe('划线做成书摘图片');
    expect(card?.free).toBe('yes');
    expect(card?.cap).toBeUndefined();
  });

  it('每个付费行都能被高亮：组里至少一行挂 cap，且 cap 不重复', () => {
    /* 2026-11-10 起不再是「每行各挂一个」：PDF 整段共用一个拦点（打开 PDF），
       基础版根本进不了 PDF，缩略图 / 导出这些按钮对他们不存在，给每行各配一个
       能力位只是摆样子。改成按组校验——付费段的头一行必须能高亮。 */
    for (const g of PLAN_GROUPS) {
      const rows = g.rows.map((k) => PLAN_TABLE.find((r) => r.key === k));
      /* 付费行 = 基础版没有、高级版有。探索中的行两版都没有（还没实现），
         既不参与合计，也没有可高亮的入口，按组校验时要排除。 */
      const paid = rows.filter((r) => r?.free === 'no' && r?.pro === 'yes');
      if (!paid.length) continue;
      expect(paid.some((r) => !!r?.cap), `组 ${g.key} 没有一行能高亮`).toBe(true);
    }
    const caps = PLAN_TABLE.map((r) => r.cap).filter((c): c is NonNullable<typeof c> => !!c);
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

/* ───────────── 赞助人标识（2026-11-09） ───────────── */

/**
 * 商品页口径：这批码「额外在插件中标识赞助人身份」；想要定制昵称的人另发带 name 的码。
 * 所以两种码都要成立——只有 patron、或 patron + name。
 */
describe.runIf(hasKey)('赞助人标识', () => {
  it('只带 patron：状态行写出「赞助人」，高级功能照常解锁', async () => {
    setProBuild(true);
    setEntBackend({ read: () => snapshot(), write: () => undefined });
    const res = await activateLicense(issue({ v: 2, id: 'BZR-AF-2026-0125', patron: true, plan: 'lifetime' }));
    expect(res.ok).toBe(true);
    expect(entitlement().patron).toBe(true);
    expect(tierText()).toContain('赞助人');
    expect(can('stats')).toBe(true);
  });

  it('patron + name：昵称与赞助人同时出现', async () => {
    setProBuild(true);
    setEntBackend({ read: () => snapshot(), write: () => undefined });
    await activateLicense(issue({ v: 2, id: 'BZR-SP-2026-0001', name: '小明', patron: true, plan: 'lifetime' }));
    const text = tierText();
    expect(text).toContain('小明');
    expect(text).toContain('赞助人');
  });

  it('老码没有 patron：状态行不出现「赞助人」', async () => {
    setProBuild(true);
    setEntBackend({ read: () => snapshot(), write: () => undefined });
    await activateLicense(issue({ v: 2, id: 'BZR-AF-2026-0124', plan: 'lifetime' }));
    expect(entitlement().patron).toBe(false);
    expect(tierText()).not.toContain('赞助人');
  });
});
