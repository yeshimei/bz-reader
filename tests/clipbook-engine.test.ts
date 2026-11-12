/**
 * 剪藏本「活书」引擎：章节惰性渲染、两级目录、图片/视频、稳定文件名。
 *
 * 用 `load()` 产出的 Blob 取 HTML 原文做断言（测试环境没有 DOMParser）；
 * 真实环境里 foliate 自己把 blob 塞进 iframe。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeClipBook, type ClipGroup } from '../src/engine/clipbook';

const groups = (): ClipGroup[] => [
  {
    id: 's1',
    name: '少数派',
    chapters: [
      {
        key: 'url:a',
        title: '文章 A',
        sourceId: 's1',
        sourceName: '少数派',
        author: '作者甲',
        date: '2026-11-01',
        url: 'https://a.com/1',
        state: 'unread',
        notePath: null,
        body: '# 小标题\n\n正文 **A**\n\n![[附件/p.png]]',
      },
      {
        key: 'clip:b',
        title: '文章 B',
        sourceId: 's1',
        sourceName: '少数派',
        author: '',
        date: '',
        url: 'https://b.com/2',
        state: 'saved',
        notePath: '剪藏/B.md',
        body: '一段视频：\n\n![[附件/v.mp4]]\n\nhttps://www.bilibili.com/video/BV1xx411c7mD',
      },
    ],
  },
  {
    id: 's2',
    name: '某 UP',
    chapters: [
      {
        key: 'url:c',
        title: '视频 C',
        sourceId: 's2',
        sourceName: '某 UP',
        author: 'UP',
        date: '',
        url: '',
        state: 'read',
        notePath: null,
        body: '简介',
      },
    ],
  },
];

let lastBlob: Blob | null = null;

beforeAll(() => {
  let n = 0;
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn((b: Blob) => {
      lastBlob = b;
      return `blob:mock-${++n}`;
    }),
    revokeObjectURL: vi.fn(),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const htmlOf = async (section: { load: () => Promise<string> }): Promise<string> => {
  await section.load();
  if (!lastBlob) throw new Error('no blob');
  return lastBlob.text();
};

const build = (opts: Partial<Parameters<typeof makeClipBook>[0]> = {}) =>
  makeClipBook({
    title: '剪藏本',
    groups: groups(),
    resolveAsset: async (_kind, path) =>
      path.endsWith('.png') || path.endsWith('.mp4') ? `blob:${path}` : null,
    ...opts,
  });

describe('makeClipBook', () => {
  it('每个源一个一级目录、每篇一个二级；空组不进目录', () => {
    const handle = build();
    expect(handle.book.toc?.map((t) => t.label)).toEqual(['少数派', '某 UP']);
    expect(handle.book.toc?.[0].subitems?.map((s) => s.label)).toEqual(['文章 A', '文章 B']);
    expect(handle.book.sections).toHaveLength(3);
  });

  it('章节文件名按文章 key 稳定（两次构建一致）', () => {
    const a = build();
    const b = build();
    expect(a.hrefOf('url:a')).toBe(b.hrefOf('url:a'));
    expect(a.hrefOf('url:a')).toMatch(/^t-[a-z0-9]+\.xhtml$/);
    expect(a.chapters.map((c) => c.key)).toEqual(['url:a', 'clip:b', 'url:c']);
  });

  it('按 href / key 反查，indexOf 与 spine 顺序一致', () => {
    const h = build();
    expect(h.byHref(h.hrefOf('clip:b'))?.title).toBe('文章 B');
    expect(h.byHref('t-none.xhtml')).toBeNull();
    expect(h.byKey('url:c')?.sourceName).toBe('某 UP');
    expect(h.indexOf('clip:b')).toBe(1);
    expect(h.indexOf('none')).toBe(-1);
  });

  it('章节 HTML：标题、来源、正文、原文链接、key 都在 body 上', async () => {
    const h = build();
    const html = await htmlOf(h.book.sections[0]);
    expect(html).toContain('data-bzr-clip-key="url:a"');
    expect(html).toContain('<h1>文章 A</h1>');
    expect(html).toContain('作者甲');
    expect(html).toContain('<h1>小标题</h1>');
    expect(html).toContain('<strong>A</strong>');
    expect(html).toContain('href="https://a.com/1"');
  });

  it('本地图走 resolveAsset；缺图给占位', async () => {
    const h = build();
    const html = await htmlOf(h.book.sections[0]);
    expect(html).toContain('<img src="blob:附件/p.png"');

    const missing = makeClipBook({ title: 'x', groups: groups(), resolveAsset: async () => null });
    const html2 = await htmlOf(missing.book.sections[0]);
    expect(html2).toContain('bzr-img-missing');
  });

  it('本地视频与 B 站链接都变成播放器；直链视频同理', async () => {
    const h = build();
    const html = await htmlOf(h.book.sections[1]);
    expect(html).toContain('<video');
    expect(html).toContain('src="blob:附件/v.mp4"');
    expect(html).toContain('player.bilibili.com');
    expect(html).toContain('BV1xx411c7mD');
    /* 章节进 iframe 前会被 blob-srcdoc 清一遍（默认删掉所有 iframe）。
       视频播放器靠这个标记拿到通行证，少了它整章就只剩一行「下面应该是播放器」。 */
    expect(html).toContain('data-bzr-keep="video"');

    const direct = makeClipBook({
      title: 'x',
      groups: [
        {
          id: 's',
          name: '源',
          chapters: [
            {
              key: 'k',
              title: 't',
              sourceId: 's',
              sourceName: '源',
              author: '',
              date: '',
              url: '',
              state: 'unread',
              notePath: null,
              body: 'https://cdn.test/v.mp4',
            },
          ],
        },
      ],
    });
    const html3 = await htmlOf(direct.book.sections[0]);
    expect(html3).toContain('src="https://cdn.test/v.mp4"');
  });

  it('正文按需拉取且只拉一次', async () => {
    const loadBody = vi.fn(async (key: string) => (key === 'url:a' ? '懒加载正文' : ''));
    const h = makeClipBook({
      title: 'x',
      groups: [{ id: 's', name: '源', chapters: [{ ...groups()[0].chapters[0], body: '' }] }],
      loadBody,
    });
    const html = await htmlOf(h.book.sections[0]);
    expect(html).toContain('懒加载正文');
    await h.book.sections[0].load();
    expect(loadBody).toHaveBeenCalledTimes(1);
  });

  it('destroy 收掉章节与资源 blob', async () => {
    const h = build();
    await h.book.sections[0].load();
    h.destroy();
    expect((URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
