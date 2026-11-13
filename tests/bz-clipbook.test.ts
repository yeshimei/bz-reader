/**
 * 剪藏本门面（data/bz-bridge 的第三项能力）：判「用没用过」+ 打开主界面。
 *
 * 这一项只服务一个场景：设置页把剪藏本开关从关拨到开时，库里还空着就提醒
 * 一句「先去配源或看教程」。所以底线是**判不出来时不要拦人**——门面缺、
 * 读盘抛错、返回非数组，统统按「用过」处理，宁可不提醒也别对着一个装满
 * 文章的库说「你还是空的」。
 */
import { describe, expect, it, vi } from 'vitest';
import { bzClipbookUsed, openBzClipbook, probeBz } from '../src/data/bz-bridge';

function app(patch: Record<string, unknown> = {}) {
  return {
    plugins: {
      getPlugin: (id: string) => (id === 'bz' ? patch : null),
      plugins: { bz: patch },
      manifests: { bz: { version: '1.48.0' } },
    },
  } as never;
}

describe('剪藏本门面探测', () => {
  it('门面在：三项都拿到', () => {
    const sources = vi.fn(async () => []);
    const articles = vi.fn(async () => []);
    const open = vi.fn();
    const p = probeBz(app({ clipbook: { sources, articles, open } }));
    expect(p.clipbook?.sources).toBe(sources);
    expect(p.clipbook?.articles).toBe(articles);
    expect(p.clipbook?.open).toBe(open);
  });

  it('老版本 bz 没有这一项：clipbook 为空，不影响其他门面', () => {
    const p = probeBz(app({ knowledge: { openTermNote: vi.fn(), openPassageNote: vi.fn() } }));
    expect(p.clipbook).toBeNull();
    expect(p.knowledge).not.toBeNull();
  });

  it('只有 open 没有判据也算在（半可用门面）', () => {
    expect(probeBz(app({ clipbook: { open: vi.fn() } })).clipbook).not.toBeNull();
  });

  it('三项都不是函数：当成没有这一项', () => {
    expect(probeBz(app({ clipbook: { version: 1 } })).clipbook).toBeNull();
  });
});

describe('bzClipbookUsed', () => {
  it('源和文章都空 → false（该提醒了）', async () => {
    expect(await bzClipbookUsed(app({ clipbook: { sources: async () => [], articles: async () => [] } }))).toBe(false);
  });

  it('有文章 → true', async () => {
    expect(
      await bzClipbookUsed(app({ clipbook: { sources: async () => [], articles: async () => [{ key: 'a' }] } })),
    ).toBe(true);
  });

  it('只配了源、还没抓到文章 → 也算用过', async () => {
    expect(
      await bzClipbookUsed(app({ clipbook: { sources: async () => [{ id: 'rss' }], articles: async () => [] } })),
    ).toBe(true);
  });

  it('没有门面 → true（判不出来就不提醒）', async () => {
    expect(await bzClipbookUsed(app({}))).toBe(true);
    expect(await bzClipbookUsed(null)).toBe(true);
  });

  it('查询抛错 → true（一次 IO 失败不该变成「你是空的」）', async () => {
    const sources = vi.fn(async () => {
      throw new Error('EACCES');
    });
    expect(await bzClipbookUsed(app({ clipbook: { sources, articles: async () => [] } }))).toBe(true);
  });

  it('返回非数组 → 当判不出来，按用过处理', async () => {
    expect(
      await bzClipbookUsed(app({ clipbook: { sources: async () => undefined as never, articles: async () => [] } })),
    ).toBe(true);
  });

  it('只有一项判据时，它说空才说空', async () => {
    expect(await bzClipbookUsed(app({ clipbook: { articles: async () => [] } }))).toBe(false);
    expect(await bzClipbookUsed(app({ clipbook: { articles: async () => [{ key: 'a' }] } }))).toBe(true);
    /* 只有 open、没有判据：不提醒 */
    expect(await bzClipbookUsed(app({ clipbook: { open: () => undefined } }))).toBe(true);
  });
});

describe('openBzClipbook', () => {
  it('门面在：转交出去并返回 true', () => {
    const open = vi.fn();
    expect(openBzClipbook(app({ clipbook: { open } }))).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('门面缺 → false，调用方据此提示', () => {
    expect(openBzClipbook(app({}))).toBe(false);
    expect(openBzClipbook(null)).toBe(false);
  });

  it('open 内部抛错 → 吞掉并返回 false', () => {
    const open = vi.fn(() => {
      throw new Error('boom');
    });
    expect(openBzClipbook(app({ clipbook: { open } }))).toBe(false);
  });
});
