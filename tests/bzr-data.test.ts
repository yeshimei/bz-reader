import { beforeEach, describe, expect, it } from 'vitest';
import {
  BZR_CACHE_KEY,
  _resetBzrDataForTests,
  _setBzrHttpForTests,
  currentBzrData,
  parseBzrData,
  refreshBzrData,
  safeFeedbackUrl,
} from '../src/data/bzr-data';

/* ============================================================
 * 在线配置（更新日志 / 路线图 / 统计 / 跳转地址）的数据层
 *
 * 和感谢名单同一套：双源并发、本机缓存、坏数据不覆盖好数据。
 * 这一份测「远端内容不可信」那一面 + 链接白名单，网络本身不测（可注入）。
 * ============================================================ */

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  get length(): number { return this.m.size; }
}
const g = globalThis as unknown as Record<string, unknown>;
let calls: string[] = [];
function setHttp(fn: (url: string) => Promise<string | null> | string | null): void {
  calls = [];
  _setBzrHttpForTests(async (url) => { calls.push(url); return await fn(url); });
}

const GOOD = {
  version: 1,
  updatedAt: '2026-11-18',
  changelog: [
    { version: '1.5.2', date: '2026-11-17', improved: [
      { domain: { zh: '设置页', en: 'Settings' }, text: { zh: '分组', en: 'Groups' }, issue: 2 },
    ] },
  ],
  roadmap: [
    { theme: 'AI 能力', color: '#2f9e6e', order: 1, items: [
      { title: '多轮追问', state: 'doing', src: 'builtin', fb: { kind: 'issue', n: 12, label: '#12' } },
    ] },
  ],
  stats: { pro: 1286, patrons: 328 },
  links: {
    support: 'https://afdian.net/a/yeshimei',
    buy: 'https://afdian.net/a/yeshimei?plan=pro',
  },
};
const doc = (over: Record<string, unknown> = {}) => JSON.stringify({ ...GOOD, ...over });

beforeEach(() => {
  g.localStorage = new MemoryStorage();
  g.window = g;
  _resetBzrDataForTests();
  _setBzrHttpForTests(null);
  calls = [];
});

describe('解析 · 一份远端 JSON 能变成什么', () => {
  it('合法文档：五块数据都在，issue 字段保留', () => {
    const d = parseBzrData(doc());
    expect(d).not.toBeNull();
    expect(d!.changelog[0]!.version).toBe('1.5.2');
    expect(d!.changelog[0]!.improved![0]!.issue).toBe(2);
    expect(d!.roadmap[0]!.items[0]!.fb.label).toBe('#12');
    expect(d!.stats.pro).toBe(1286);
    expect(d!.links.buy).toContain('afdian.net');
  });

  it('顶层不对（不是对象 / 缺字段 / JSON 坏）→ null', () => {
    expect(parseBzrData('not json')).toBeNull();
    expect(parseBzrData('null')).toBeNull();
    expect(parseBzrData(JSON.stringify({ version: 1 }))).toBeNull();
  });

  it('坏条目丢条目，好条目留着；整份全坏 = null', () => {
    const d = parseBzrData(doc({ roadmap: [
      { theme: '好主题', color: '#fff', order: 1, items: [
        { title: '好条目', state: 'doing', src: 'builtin', fb: { kind: 'issue', n: 1, label: '#1' } },
        { title: '', state: 'doing', src: 'builtin', fb: {} },
        { title: '坏状态', state: 'wat', src: 'builtin', fb: {} },
      ] },
      { theme: '', items: [] },
    ] }));
    expect(d!.roadmap).toHaveLength(1);
    expect(d!.roadmap[0]!.items).toHaveLength(1);
    expect(parseBzrData(doc({ roadmap: [{ theme: 'x', items: [{ title: '' }] }] }))).toBeNull();
  });

  it('数字统计：非数字 / 负数 / 离谱值丢掉退回 0；统计全坏也不连累日志', () => {
    const d = parseBzrData(doc({ stats: { pro: -1, patrons: '328' } }));
    expect(d!.stats.pro).toBe(0);
    expect(d!.stats.patrons).toBe(0);
    /* 统计只是附加信息，坏掉不能让整份日志与路线图一起消失 */
    expect(parseBzrData(doc({ stats: { pro: null } }))!.stats.pro).toBe(0);
  });

  it('更新日志条目缺中英任一语言 → 丢那条；整版全坏 → null', () => {
    const d = parseBzrData(doc({ changelog: [{ version: '1.5.2', added: [
      { domain: { zh: '好', en: 'ok' }, text: { zh: '好', en: 'ok' } },
      { domain: { zh: '缺英文', en: '' }, text: { zh: 'x', en: 'x' } },
    ] }] }));
    expect(d!.changelog[0]!.added).toHaveLength(1);
    expect(parseBzrData(doc({ changelog: [{ version: 'x', added: [] }] }))).toBeNull();
  });
});

describe('链接白名单：远端不可信', () => {
  it('合法域名放行，未知域名 / javascript: 拒绝', () => {
    expect(safeFeedbackUrl('https://github.com/yeshimei/bz-reader/issues/3')).toContain('github.com');
    expect(safeFeedbackUrl('https://afdian.net/a/x')).toContain('afdian.net');
    expect(safeFeedbackUrl('https://evil.example.com/phish')).toBeNull();
    expect(safeFeedbackUrl('javascript:alert(1)')).toBeNull();
    expect(safeFeedbackUrl('http://github.com.evil.com/')).toBeNull();
  });

  it('反馈链接不在白名单 → 解析时就不渲染成可点（fb.href 为空）', () => {
    const d = parseBzrData(doc({ roadmap: [{ theme: 't', color: '#fff', order: 1, items: [
      { title: 'x', state: 'plan', src: 'builtin', fb: { kind: 'bili', label: 'B站', href: 'https://evil.example.com/' } },
    ] }] }));
    expect(d!.roadmap[0]!.items[0]!.fb.href).toBe('');
  });
});

describe('缓存与拉取', () => {
  it('无缓存时返回内置兜底（路线图不空、链接可用）', () => {
    const d = currentBzrData();
    /* 日志的兜底由 shell/changelog 的内置数据负责，这里保证链接与结构不空 */
    expect(d.roadmap.length).toBeGreaterThan(0);
    expect(d.links.buy).toContain('afdian.net');
  });

  it('拉取成功 → 覆盖内存并写缓存；第二个源胜出也能用', async () => {
    setHttp((u) => u.includes('github') ? 'bad json' : doc());
    expect(await refreshBzrData({ force: true })).toBe(true);
    expect(currentBzrData().stats.pro).toBe(1286);
    expect(g.localStorage!.getItem(BZR_CACHE_KEY)).toContain('1286');
    expect(calls).toHaveLength(2);
  });

  it('两个源都挂 → 不覆盖已有好数据', async () => {
    setHttp(() => 'broken');
    const before = currentBzrData().stats.pro;
    expect(await refreshBzrData({ force: true })).toBe(false);
    expect(currentBzrData().stats.pro).toBe(before);
  });

  it('缓存里的坏字段不影响好条目；坏缓存整份作废退回内置', () => {
    g.localStorage!.setItem(BZR_CACHE_KEY, JSON.stringify({ v: 1, at: Date.now(), data: GOOD }));
    expect(currentBzrData().stats.pro).toBe(1286);
    // v 不对 → 忽略
    g.localStorage!.setItem(BZR_CACHE_KEY, JSON.stringify({ v: 99, at: Date.now(), data: GOOD }));
    _resetBzrDataForTests();
    expect(currentBzrData().stats.pro).not.toBe(1286);
  });
});
