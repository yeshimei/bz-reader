import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REVOKED_STATE_KEY,
  REVOKED_URLS,
  _resetRevokedForTests,
  _setRevokedHttpForTests,
  checkRevoked,
  clearRevoked,
  codeHash,
  markRevoked,
  parseRevoked,
  refreshRevoked,
  revokedCode,
  revokedOrder,
  revokedSeenAt,
  revokedSignText,
  verifyRevoked,
} from '../src/data/revoked';
import { setLocale } from '../src/i18n';

/* ============================================================
 * 停用名单（tests/revoked.test.ts）
 *
 * 这一份盯四件事：
 *   1. 名单是公开文件，**只认码号 / 摘要**，不认码原文；
 *   2. 必须验签——假名单、改过的名单、旧名单一律当「没拉到」；
 *   3. 拉不到 = 放行（unknown），不能被网络故障误伤；
 *   4. 命中之后本地要记住，断网重启也贴不回来；解封要能自动恢复。
 * 真实通道走真机，网络函数全部注入。
 * ============================================================ */

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = join(here, '..', 'scripts', 'keys', 'private.pem');
const hasKey = existsSync(keyPath);
const keyPem = hasKey ? readFileSync(keyPath, 'utf8') : '';

const embeds = readFileSync(join(here, '..', 'src', 'data', 'license.ts'), 'utf8');
const PUB = /PUBKEY_SPKI_B64 =\s*'([^']+)'/;

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

/** 按生产端同样的格式签一份名单 */
function signed(
  ids: string[],
  hashes: string[] = [],
  updatedAt = 1_800_000_000_000,
  key = keyPem,
): string {
  const text = [
    'bzr-revoked',
    '1',
    String(updatedAt),
    ids.map((x) => x.trim().toUpperCase()).sort().join(','),
    hashes.map((x) => x.trim().toLowerCase()).sort().join(','),
  ].join('\n');
  const signer = createSign('sha256');
  signer.update(Buffer.from(text, 'utf8'));
  const sig = derToP1363(signer.sign({ key, dsaEncoding: 'der' }));
  return JSON.stringify({ v: 1, updatedAt, ids, hashes, sig: b64url(sig) });
}

/** 签一枚真码（复用发行方私钥） */
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
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
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

function setHttp(fn: (url: string) => string | null | Promise<string | null>): void {
  _setRevokedHttpForTests(async (url) => await fn(url));
}

beforeEach(() => {
  storage.clear();
  _resetRevokedForTests();
});

/* ------------------------------------------------------------
 * 加速（2026-11-23）：两源一起抓、谁先回用谁，不再等齐挑最新；
 * 语言只决定谁先发（简中先码云，其余先 GitHub）。
 * 验签与「比本地旧就丢」仍是硬门槛，不属于镜像对比。
 * ---------------------------------------------------------- */
describe('拉取顺序（语言优先）', () => {
  afterEach(() => setLocale('zh'));

  it('简中先码云，其余语言先 GitHub', () => {
    setLocale('zh');
    expect(revokedOrder()[0]).toContain('gitee.com');
    expect(revokedOrder()[1]).toContain('githubusercontent.com');
    for (const lang of ['zh-TW', 'en', 'ja', 'de', 'fr', 'es', 'pt'] as const) {
      setLocale(lang);
      expect(revokedOrder()[0]).toContain('githubusercontent.com');
      expect(revokedOrder()[1]).toContain('gitee.com');
    }
  });

  it('兜底源仍在，只是顺序随语言变', () => {
    expect(REVOKED_URLS).toHaveLength(2);
    expect(revokedOrder().slice().sort()).toEqual(REVOKED_URLS.slice().sort());
  });
});

describe.runIf(hasKey)('两源等齐取最新', () => {
  let CODE = '';
  beforeAll(() => {
    CODE = issue({ v: 2, id: 'BZR-AF-2026-0021', name: '包仔', plan: 'lifetime' });
  });
  afterEach(() => setLocale('zh'));

  it('后到的更新名单覆盖先回的旧名单（正确性优先于速度）', async () => {
    setLocale('en'); // GitHub 先发、先回
    const calls: string[] = [];
    _setRevokedHttpForTests(async (url) => {
      calls.push(url);
      await new Promise((r) => setTimeout(r, url.includes('gitee') ? 300 : 40));
      return url.includes('gitee')
        ? signed(['BZR-AF-2026-0021'], [], 1_900_000_000_000)
        : signed([], [], 1_800_000_000_000);
    });
    /* 先回的那份不含这枚码：先回者胜会判 clear，等齐取最新会判 hit */
    expect(await checkRevoked(CODE)).toBe('hit');
    expect(revokedCode()).toBe(CODE);
    expect(calls).toHaveLength(2);
  });

  it('简中先发码云：两份都在，取版本更新的那份', async () => {
    setLocale('zh');
    const calls: string[] = [];
    _setRevokedHttpForTests(async (url) => {
      calls.push(url);
      await new Promise((r) => setTimeout(r, url.includes('gitee') ? 40 : 300));
      return signed(
        url.includes('gitee') ? ['BZR-AF-2026-0021'] : [],
        [],
        url.includes('gitee') ? 1_900_000_000_000 : 1_800_000_000_000,
      );
    });
    expect(await checkRevoked(CODE)).toBe('hit');
    expect(calls[0]).toContain('gitee.com');
  });

  it('优先源挂了：自动用另一源那份', async () => {
    setLocale('zh');
    _setRevokedHttpForTests(async (url) => {
      if (url.includes('gitee')) return null;
      await new Promise((r) => setTimeout(r, 40));
      return signed(['BZR-AF-2026-0021']);
    });
    expect(await checkRevoked(CODE)).toBe('hit');
  });

  it('先到的旧名单不能把已封的码放出来', async () => {
    markRevoked(CODE, 1_900_000_000_000);
    setLocale('zh');
    _setRevokedHttpForTests(async (url) => {
      await new Promise((r) => setTimeout(r, url.includes('gitee') ? 40 : 200));
      return signed([], [], url.includes('gitee') ? 1_800_000_000_000 : 1_900_000_000_000);
    });
    expect(await checkRevoked(CODE)).toBe('clear');
  });
});

describe('名单解析', () => {
  /* 前两条要真签名：私钥在 scripts/keys（gitignore），干净检出 / worktree
     里没有，跑了只会拿空 key 撞 OpenSSL。有 key 才跑，与下面几组同口径。 */
  describe.runIf(hasKey)('带签名的名单', () => {
    it('合法名单原样收下', () => {
      const doc = parseRevoked(signed(['BZR-AF-2026-0021']));
      expect(doc?.ids).toEqual(['BZR-AF-2026-0021']);
      expect(doc?.updatedAt).toBe(1_800_000_000_000);
      expect(doc?.sig).toBeTruthy();
    });

    it('空数组合法（还没人被封）', () => {
      const doc = parseRevoked(signed([]));
      expect(doc?.ids).toEqual([]);
      expect(doc?.hashes).toEqual([]);
    });
  });

  it('结构不对整份作废', () => {
    expect(parseRevoked('不是 JSON')).toBeNull();
    expect(parseRevoked('[]')).toBeNull();
    expect(parseRevoked(JSON.stringify({ v: 2, updatedAt: 1, ids: [], hashes: [], sig: 'x' }))).toBeNull();
    expect(parseRevoked(JSON.stringify({ v: 1, updatedAt: 0, ids: [], hashes: [], sig: 'x' }))).toBeNull();
    expect(parseRevoked(JSON.stringify({ v: 1, updatedAt: 1, ids: [], hashes: [] }))).toBeNull();
  });

  it('单条坏只丢那一条，码号统一大写、摘要统一小写', () => {
    const raw = JSON.stringify({
      v: 1,
      updatedAt: 1_800_000_000_000,
      ids: ['bzr-af-2026-0021', 'not-a-code', 'BZR-AF-2026-0021'],
      hashes: ['ABCDEF0123456789', 'xyz', 'abcdef0123456789'],
      sig: 'x',
    });
    const doc = parseRevoked(raw);
    expect(doc?.ids).toEqual(['BZR-AF-2026-0021']);
    expect(doc?.hashes).toEqual(['abcdef0123456789']);
  });
});

describe('签名串', () => {
  it('固定格式，数组顺序无关', () => {
    const a = revokedSignText({ v: 1, updatedAt: 123, ids: ['B', 'A'], hashes: ['y', 'x'] });
    const b = revokedSignText({ v: 1, updatedAt: 123, ids: ['A', 'B'], hashes: ['x', 'y'] });
    expect(a).toBe(b);
    expect(a).toBe('bzr-revoked\n1\n123\nA,B\nx,y');
  });
});

describe.runIf(hasKey && PUB.test(embeds))('验签', () => {
  it('真签名的名单通过', async () => {
    const doc = parseRevoked(signed(['BZR-AF-2026-0021']));
    expect(doc).toBeTruthy();
    expect(await verifyRevoked(doc!)).toBe(true);
  });

  it('改过码号的名单不通过', async () => {
    const doc = parseRevoked(signed(['BZR-AF-2026-0021']));
    expect(doc).toBeTruthy();
    doc!.ids = ['BZR-AF-2026-0099'];
    expect(await verifyRevoked(doc!)).toBe(false);
  });

  it('别的私钥签的名单不通过', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const other = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const doc = parseRevoked(signed(['BZR-AF-2026-0021'], [], 1_800_000_000_000, other));
    expect(await verifyRevoked(doc!)).toBe(false);
  });
});

describe.runIf(hasKey && PUB.test(embeds))('仓库里的名单', () => {
  /* 这道断言盯的是「作者改完名单忘了重签」和「签发脚本与插件端的签名串
     不一致」——两者都会让所有人拉到的名单验签失败，而表现只是「封码没生效」，
     很难从现场看出来。 */
  it('docs/revoked.json 当前签名有效', async () => {
    const raw = readFileSync(join(here, '..', 'docs', 'revoked.json'), 'utf8');
    const doc = parseRevoked(raw);
    expect(doc).toBeTruthy();
    expect(await verifyRevoked(doc!)).toBe(true);
  });
});

describe.runIf(hasKey)('判定', () => {
  /* 在 it 里现签，别在 describe 回调顶层签：runIf 不满足时回调仍会被收集一遍，
     而 worktree 里 scripts/keys 是 gitignore 的，顶层调用会直接炸在收集期。 */
  let CODE = '';
  beforeAll(() => {
    CODE = issue({ v: 2, id: 'BZR-AF-2026-0021', name: '包仔', plan: 'lifetime' });
  });

  it('命中码号：hit，本地记住这枚码', async () => {
    setHttp(() => signed(['BZR-AF-2026-0021']));
    expect(await checkRevoked(CODE)).toBe('hit');
    expect(revokedCode()).toBe(CODE);
  });

  it('大小写不同也算命中', async () => {
    setHttp(() => signed(['bzr-af-2026-0021']));
    expect(await checkRevoked(CODE)).toBe('hit');
  });

  it('名单里没有：clear，且不动本地', async () => {
    setHttp(() => signed(['BZR-AF-2026-0099']));
    expect(await checkRevoked(CODE)).toBe('clear');
    expect(revokedCode()).toBe('');
  });

  it('两个源都挂：unknown（放行）', async () => {
    setHttp(() => null);
    expect(await checkRevoked(CODE)).toBe('unknown');
    expect(revokedCode()).toBe('');
  });

  it('假签名：unknown，不能把付费用户打回基础版', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const other = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    setHttp(() => signed(['BZR-AF-2026-0021'], [], 1_800_000_000_000, other));
    expect(await checkRevoked(CODE)).toBe('unknown');
  });

  it('旧名单：unknown（防重放，别让已封的码复活）', async () => {
    markRevoked(CODE, 1_900_000_000_000);
    setHttp(() => signed(['BZR-AF-2026-0099'], [], 1_800_000_000_000));
    expect(await checkRevoked(CODE)).toBe('unknown');
    expect(revokedCode()).toBe(CODE);
  });

  it('解封：名单里没了就清本地标记', async () => {
    markRevoked(CODE, 1_800_000_000_000);
    setHttp(() => signed([], [], 1_900_000_000_000));
    expect(await checkRevoked(CODE)).toBe('clear');
    expect(revokedCode()).toBe('');
  });

  it('同一版本再拉一次仍然判定（不能当成旧名单丢掉）', async () => {
    setHttp(() => signed(['BZR-AF-2026-0021'], [], 1_800_000_000_000));
    expect(await checkRevoked(CODE)).toBe('hit');
    expect(await checkRevoked(CODE)).toBe('hit');
  });

  it('老码没有码号：按 sha256 摘要封', async () => {
    const old = issue({ v: 1, name: '老用户' });
    const h = await codeHash(old);
    setHttp(() => signed([], [h]));
    expect(await checkRevoked(old)).toBe('hit');
    expect(revokedCode()).toBe(old);
  });

  it('老码：摘要对不上就不算命中', async () => {
    const old = issue({ v: 1, name: '老用户' });
    setHttp(() => signed([], ['0123456789abcdef']));
    expect(await checkRevoked(old)).toBe('clear');
  });
});

describe.runIf(hasKey)('后台刷新与持久化', () => {
  let CODE = '';
  beforeAll(() => {
    CODE = issue({ v: 2, id: 'BZR-AF-2026-0021', plan: 'lifetime' });
  });

  it('24 小时内不重复；force 每次真拉', async () => {
    let n = 0;
    setHttp(() => {
      n += 1;
      return signed(['BZR-AF-2026-0099']);
    });
    // 两源各自发一次（一起抓），先回的先采用
    expect(await refreshRevoked(CODE, { force: true })).toBe('clear');
    expect(n).toBe(2);
    // 24 小时内再自动查：不请求，直接 skipped（不是失败）
    expect(await refreshRevoked(CODE)).toBe('skipped');
    expect(n).toBe(2);
    // 手动核对（force）绕过 24 小时
    expect(await refreshRevoked(CODE, { force: true })).toBe('clear');
    expect(n).toBe(4);
  });

  it('拉不到不算核对成功：下一次启动还会试', async () => {
    setHttp(() => null);
    expect(await refreshRevoked(CODE)).toBe('unknown');
    setHttp(() => signed(['BZR-AF-2026-0099']));
    // 上一次没写 checkedAt，所以这次不会被 24 小时节流挡掉
    expect(await refreshRevoked(CODE)).toBe('clear');
  });

  it('本地状态写进 localStorage，重建缓存后还在', async () => {
    markRevoked(CODE, 1_800_000_000_000);
    expect(storage.getItem(REVOKED_STATE_KEY)).toContain('BZR2.');
    _resetRevokedForTests();
    expect(revokedCode()).toBe(CODE);
    expect(revokedSeenAt()).toBe(1_800_000_000_000);
    clearRevoked();
    _resetRevokedForTests();
    expect(revokedCode()).toBe('');
    // 版本号不清：解封后也不能拿旧名单回放
    expect(revokedSeenAt()).toBe(1_800_000_000_000);
  });
});

/* ------------------------------------------------------------
 * 两条绕过路径的回归（2026-11-28 审计）
 *
 *   1. 旧名单先回 → 已封码被判 clear。加速改成「先回者胜」之后，
 *      只有「本地已经封过某枚码」才拒绝旧名单；本地干净时旧名单照收。
 *   2. checkedAt 被顶到未来 → 24 小时节流永远成立，一次都不再拉名单。
 *      `now - checkedAt` 是负数，恒小于 gap。
 * ---------------------------------------------------------- */
describe.runIf(hasKey)('旧名单与未来时间（2026-11-28 审计回归）', () => {
  const ID = 'BZR-AF-2026-0383';
  let CODE = '';
  beforeAll(() => {
    CODE = issue({ v: 2, id: ID, plan: 'lifetime' });
  });

  it('旧名单先回、新名单后回：以新的为准，不能采信先回的旧名单', async () => {
    const oldList = signed([], [], 1_000);
    const newList = signed([ID], [], 2_000);
    setHttp(async (url) => {
      // 一个源还没同步（旧名单），立刻回；另一个源已同步（新名单），慢一点
      if (url.includes('gitee')) return oldList;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return newList;
    });

    expect(await checkRevoked(CODE)).toBe('hit');
    expect(revokedCode()).toBe(CODE);
  });

  it('本地核对时刻在未来：不能当成「刚查过」，照常拉一次', async () => {
    storage.setItem(
      REVOKED_STATE_KEY,
      JSON.stringify({ code: '', at: 0, checkedAt: Date.now() + 400 * 86_400_000 }),
    );
    _resetRevokedForTests();

    let calls = 0;
    setHttp(() => {
      calls += 1;
      return signed([], [], 1_800_000_000_000);
    });

    expect(await refreshRevoked(CODE)).toBe('clear');
    expect(calls).toBe(2);
  });
});
