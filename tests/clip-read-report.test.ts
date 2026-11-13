/**
 * 剪藏本：阅读时长回写（2026-11-13）。
 *
 * 阅读器把剪藏本当书读时按章计时（engine/activity 的 sink + ChapterClock）。
 * 以前这些秒数只进 book.reading.chapterSeconds，剪藏本面板完全不知道——
 * 在阅读器里读完一篇回来，那边还显示「没读过」。
 *
 * 两件事分开测：
 * - 上报队列：切章时把这一篇的秒数攒起来，同篇多次合并，满一分钟批量发；
 * - 门面调用：老版本 bz 没有 recordRead 时静默跳过，不能把剪藏本判成不可用。
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { ClipReportQueue } from '../src/data/clip-epub/report-queue';
import { reportClipSeconds } from '../src/data/clip-book';
import type { ClipbookFacade } from '../src/data/clipbook-bridge';

function fakeApp(facade: Partial<ClipbookFacade>): App {
  const full = {
    version: 1 as const,
    sources: async () => [],
    articles: async () => [],
    articleBody: async () => '',
    markRead: async () => 0,
    saveArticle: async () => ({ ok: false }),
    isReady: () => ({ ok: true }),
    dataVersion: async () => 'v0',
    ...facade,
  };
  return {
    plugins: { manifests: { bz: { version: '1.44.2' } }, plugins: { bz: { clipbook: full } } },
  } as unknown as App;
}

describe('ClipReportQueue · 上报队列', () => {
  it('同一篇多次进队合并秒数，标题取最后一次非空值', () => {
    const q = new ClipReportQueue();
    q.add({ key: 'k', seconds: 30, title: '标题', src: '少数派' });
    q.add({ key: 'k', seconds: 45, title: '', src: '' });
    expect(q.size).toBe(1);
    expect(q.take()).toEqual([{ key: 'k', seconds: 75, title: '标题', src: '少数派' }]);
  });

  it('take 之后清空，再 add 重新攒', () => {
    const q = new ClipReportQueue();
    q.add({ key: 'a', seconds: 60 });
    expect(q.take()).toHaveLength(1);
    expect(q.isEmpty).toBe(true);
    expect(q.take()).toEqual([]);
    q.add({ key: 'b', seconds: 20 });
    expect(q.take()).toEqual([{ key: 'b', seconds: 20, title: '', src: '' }]);
  });

  it('多篇各记各的，按入队顺序取出', () => {
    const q = new ClipReportQueue();
    q.add({ key: 'a', seconds: 10 });
    q.add({ key: 'b', seconds: 20 });
    expect(q.take()).toEqual([
      { key: 'a', seconds: 10, title: '', src: '' },
      { key: 'b', seconds: 20, title: '', src: '' },
    ]);
  });

  it('非法条目忽略：空 key / 0 / 负数 / NaN', () => {
    const q = new ClipReportQueue();
    q.add({ key: '', seconds: 60 });
    q.add({ key: 'z', seconds: 0 });
    q.add({ key: 'y', seconds: -5 });
    q.add({ key: 'n', seconds: Number.NaN });
    expect(q.isEmpty).toBe(true);
  });

  it('秒数取整：小数向下取整进累计', () => {
    const q = new ClipReportQueue();
    q.add({ key: 'k', seconds: 12.9 });
    expect(q.take()).toEqual([{ key: 'k', seconds: 12, title: '', src: '' }]);
  });
});

describe('reportClipSeconds · 门面调用', () => {
  const entry = { key: 'k', seconds: 90, title: '标题', src: '少数派' };

  it('门面有 recordRead：交给它并回传落账篇数', async () => {
    const recordRead = vi.fn(async () => 1);
    const app = fakeApp({ recordRead });
    expect(await reportClipSeconds(app, [entry])).toBe(1);
    expect(recordRead).toHaveBeenCalledWith([entry]);
  });

  it('老版本 bz 没有 recordRead：返回 0，不报错、不调别的能力', async () => {
    const app = fakeApp({});
    expect(await reportClipSeconds(app, [entry])).toBe(0);
  });

  it('门面写盘抛错：吞掉返回 0，不把异常带进阅读流程', async () => {
    const app = fakeApp({ recordRead: vi.fn(async () => { throw new Error('写盘失败'); }) });
    expect(await reportClipSeconds(app, [entry])).toBe(0);
  });

  it('空批次：直接返回 0，不碰门面', async () => {
    const recordRead = vi.fn(async () => 5);
    const app = fakeApp({ recordRead });
    expect(await reportClipSeconds(app, [])).toBe(0);
    expect(recordRead).not.toHaveBeenCalled();
  });

  it('没装 bz：返回 0，不抛错', async () => {
    const app = {} as unknown as App;
    expect(await reportClipSeconds(app, [entry])).toBe(0);
  });
});
