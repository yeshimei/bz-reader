import { afterEach, describe, expect, it, vi } from 'vitest';
import { countWords, makeTxtBook } from '../src/engine/txt';

/**
 * A-33：TXT 章节 HTML 必须惰性生成。
 *
 * 以前 `makeTxtBook()` 一上来就给**所有**章节拼 HTML：一本 800 章的网文，
 * 打开第一页要先把整本 8MB 文本段落化、转义、拼字符串，主线程直接卡住，
 * 而且这些字符串一整天挂在 section 闭包里。现在只有 load()/createDocument()
 * 真正用到那一章时才生成，生成后缓存。
 */
function stubDomParser(): { restore: () => void; parsed: string[] } {
  const parsed: string[] = [];
  class FakeParser {
    parseFromString(html: string): unknown {
      parsed.push(html);
      return { html };
    }
  }
  const had = 'DOMParser' in globalThis;
  const prev = (globalThis as { DOMParser?: unknown }).DOMParser;
  (globalThis as { DOMParser?: unknown }).DOMParser = FakeParser;
  return {
    parsed,
    restore: () => {
      if (had) (globalThis as { DOMParser?: unknown }).DOMParser = prev;
      else delete (globalThis as { DOMParser?: unknown }).DOMParser;
    },
  };
}

/** 拦住 URL.createObjectURL，拿到 Blob 本体（node 里读 blob 比 fetch 可靠） */
function captureBlob(): { restore: () => void; blobs: Blob[] } {
  const blobs: Blob[] = [];
  const orig = URL.createObjectURL;
  URL.createObjectURL = ((blob: Blob) => {
    blobs.push(blob);
    return `blob:txt-test-${blobs.length}`;
  }) as typeof URL.createObjectURL;
  return { blobs, restore: () => (URL.createObjectURL = orig) };
}

const RAW = '第一章 初见\n第一段正文。\n\n第二段正文。\n第二章 再会\n另一段。';

describe('TXT 造书：章节惰性生成（A-33）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('造书时一个章节的 HTML 都不生成', () => {
    const render = vi.fn((title: string, text: string) => `<html><body>${title}|${text}</body></html>`);
    makeTxtBook(RAW, { title: '书' }, { renderChapter: render });
    expect(render).toHaveBeenCalledTimes(0);
  });

  it('第一次 load 才生成，且同一章只生成一次', async () => {
    const render = vi.fn((title: string, text: string) => `<html><body>${title}|${text}</body></html>`);
    const book = makeTxtBook(RAW, { title: '书' }, { renderChapter: render });
    const section = book.sections[0];

    await section.load?.();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[0]).toBe('第一章 初见');

    await section.load?.();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('搜索用的 createDocument 复用已生成的 HTML', async () => {
    const dom = stubDomParser();
    const render = vi.fn((title: string, text: string) => `<html><body>${title}|${text}</body></html>`);
    try {
      const book = makeTxtBook(RAW, { title: '书' }, { renderChapter: render });
      const section = book.sections[0];
      await section.load?.();
      await section.createDocument?.();
      expect(render).toHaveBeenCalledTimes(1);
      expect(dom.parsed).toHaveLength(1);
    } finally {
      dom.restore();
    }
  });

  it('没 load 直接搜索也会生成一次', async () => {
    const dom = stubDomParser();
    const render = vi.fn((title: string, text: string) => `<html><body>${title}|${text}</body></html>`);
    try {
      const book = makeTxtBook(RAW, { title: '书' }, { renderChapter: render });
      await book.sections[1].createDocument?.();
      expect(render).toHaveBeenCalledTimes(1);
      expect(render.mock.calls[0]?.[0]).toBe('第二章 再会');
    } finally {
      dom.restore();
    }
  });

  it('load 出来的 Blob 内容是惰性生成的 HTML', async () => {
    const cap = captureBlob();
    try {
      const book = makeTxtBook('第一章 开始\n正文甲。', { title: '书' });
      const url = await book.sections[0].load?.();
      expect(url).toMatch(/^blob:/);
      const html = await cap.blobs[0]?.text();
      expect(html).toContain('第一章 开始');
      expect(html).toContain('正文甲。');
      expect(html).toContain('<p>');
    } finally {
      cap.restore();
    }
  });

  it('章节切分与目录不受惰性改造影响', () => {
    const book = makeTxtBook(RAW, { title: '书' });
    expect(book.sections).toHaveLength(2);
    expect(book.toc?.map((t) => t.label)).toEqual(['第一章 初见', '第二章 再会']);
    expect(book.sections[0]?.size).toBe('第一段正文。\n\n第二段正文。'.length);
  });
});

describe('TXT 造书：基础契约', () => {
  it('metadata / 目录 / 不存在的章节兜底', () => {
    const book = makeTxtBook('只有一段正文。', { title: '书名', author: '作者' });
    expect(book.metadata?.title).toBe('书名');
    expect(book.metadata?.author).toBe('作者');
    expect(book.toc?.[0]?.label).toBe('正文');
    expect(book.sections[0]?.load).toBeTypeOf('function');
    expect(book.sections[0]?.unload).toBeTypeOf('function');
    expect(book.sections[0]?.createDocument).toBeTypeOf('function');
  });

  it('unload 回收该章的 blob', async () => {
    const revoked: string[] = [];
    const orig = URL.revokeObjectURL;
    URL.revokeObjectURL = ((url: string) => revoked.push(url)) as typeof URL.revokeObjectURL;
    try {
      const book = makeTxtBook('第一章 甲\n正文。', { title: '书' });
      const url = await book.sections[0]?.load?.();
      book.sections[0]?.unload?.();
      expect(revoked).toEqual([url]);
    } finally {
      URL.revokeObjectURL = orig;
    }
  });

  it('超长无章节文本按 12000 字硬切成目录', () => {
    const long = '啊'.repeat(13000);
    const book = makeTxtBook(long, { title: '书' });
    expect(book.sections.length).toBeGreaterThan(1);
    expect(book.toc?.[1]?.label).toBe('第 2 节');
  });

  it('countWords 中英混排粗估', () => {
    expect(countWords('中文 abc 123')).toBe(4);
  });
});
