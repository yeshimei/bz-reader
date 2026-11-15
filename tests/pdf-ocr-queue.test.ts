import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../src/data/settings';
import { readOcr, writeOcr, withOcrPage, ocrPath } from '../src/data/pdf-ocr';
import type { OcrPage } from '../src/engine/pdf/ocr';
import {
  addFailedPage,
  ocrProgressText,
  ocrQueue,
  PdfOcrRunner,
  toOcrPage,
  unrotateOcrPage,
  type PdfOcrDeps,
  type PdfOcrHostLike,
} from '../src/shell/pdf-ocr';
import { FakeAdapter } from './helpers/fake-adapter';

function settings(): ReaderSettings {
  return {
    ...DEFAULT_SETTINGS,
    /* 识别默认走 DeepSeek 看图（独立配置，不借 AI 组） */
    pdfOcr: { ...DEFAULT_SETTINGS.pdfOcr, apiKey: 'sk-ocr', model: 'deepseek-flash' },
  };
}

/* 视觉模型的返回：一行一个对象，box 是 0..1 的比例 */
const MODEL_REPLY = '{"lines":[{"text":"第一行","box":[0.1,0.1,0.5,0.03]}]}';

function fakeHost(total = 10) {
  const applied: Array<{ page: number; ocr: OcrPage | null }> = [];
  const bulk: Array<Record<string, OcrPage> | null> = [];
  const host: PdfOcrHostLike = {
    isScanned: true,
    ocrOf: () => null,
    ocrStats: () => ({ done: 0, total }),
    applyOcr: (pages) => bulk.push(pages),
    applyOcrPage: (page, ocr) => applied.push({ page, ocr }),
    textOfPage: async () => '',
  };
  return { host, applied, bulk };
}

function depsOf(host: PdfOcrHostLike | null, adapter: FakeAdapter, notes: string[] = []): PdfOcrDeps {
  return {
    app: { vault: { adapter, configDir: '.obsidian' } } as unknown as App,
    book: () => ({ id: 'b1' }),
    host: () => host,
    settings: () => settings(),
    image: async () => ({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      rotation: 0,
      width: 1600,
      height: 2200,
    }),
    notify: (message) => notes.push(message),
  };
}

function okReply(content = MODEL_REPLY) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

describe('识别队列', () => {
  it('从当前页往后，跳过认过的', () => {
    expect(ocrQueue(100, 5, new Set([5, 6]), 3)).toEqual([7, 8, 9]);
  });

  it('到末页就停，不回绕去补前面的页', () => {
    expect(ocrQueue(4, 3, new Set(), 20)).toEqual([3, 4]);
    expect(ocrQueue(10, 11, new Set(), 5)).toEqual([]);
    expect(ocrQueue(10, 0, new Set(), 2)).toEqual([1, 2]);
  });

  it('limit 收成至少一页', () => {
    expect(ocrQueue(10, 1, new Set(), 1)).toEqual([1]);
    expect(ocrQueue(10, 1, new Set(), 0)).toEqual([1]);
  });
});

describe('常驻进度那句', () => {
  it('批量跑的时候带当前页与「已完/总数」，不跑就是空串', () => {
    const running = ocrProgressText({ running: true, page: 3, done: 2, total: 20, error: '' });
    expect(running).toContain('3');
    expect(running).toContain('2/20');
    expect(ocrProgressText({ running: false, page: 0, done: 0, total: 0, error: '' })).toBe('');
  });
});

describe('坐标反算（识别时视图转过角度）', () => {
  it('0 度原样返回', () => {
    const page = toOcrPage({ lines: [{ text: '甲', rect: { left: 0.1, top: 0.2, width: 0.3, height: 0.04 } }], layout: true, text: '' }, 'vision', 'm');
    expect(unrotateOcrPage(page, 0).lines[0]?.rect).toEqual({ left: 0.1, top: 0.2, width: 0.3, height: 0.04 });
  });

  it('90 度转回去：宽高互换、坐标跟着走', () => {
    /* 显示方向左上角的横条（宽 0.5、高 0.1）→ 未旋转页面里是左侧偏下的竖条 */
    const page = toOcrPage({ lines: [{ text: '甲', rect: { left: 0, top: 0, width: 0.5, height: 0.1 } }], layout: true, text: '' }, 'vision', 'm');
    const back = unrotateOcrPage(page, 90).lines[0]?.rect;
    expect(back?.width).toBeCloseTo(0.1, 6);
    expect(back?.height).toBeCloseTo(0.5, 6);
    expect(back?.left).toBeCloseTo(0, 6);
    expect(back?.top).toBeCloseTo(0.5, 6);
  });

  it('没有位置的行走「只有文本」那条路，不会被改坏', () => {
    const page = toOcrPage({ lines: [{ text: '甲' }], layout: false, text: '' }, 'vision', 'm');
    expect(unrotateOcrPage(page, 90).lines[0]).toEqual({ text: '甲' });
  });
});

describe('识别编排', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('没开 PDF 时说清楚，不静默失败', async () => {
    const notes: string[] = [];
    const adapter = new FakeAdapter();
    const runner = new PdfOcrRunner(depsOf(null, adapter, notes));
    expect(await runner.runPage(1)).toBe(false);
    expect(notes.join('')).toContain('只有 PDF');
  });

  it('认一页：结果给引擎、同时也落了盘', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okReply()));
    const adapter = new FakeAdapter();
    const { host, applied } = fakeHost();
    const runner = new PdfOcrRunner(depsOf(host, adapter));
    expect(await runner.runPage(3)).toBe(true);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.page).toBe(3);
    expect(applied[0]!.ocr?.lines[0]?.text).toBe('第一行');
    expect(applied[0]!.ocr?.layout).toBe(true);
    const back = await readOcr(depsOf(host, adapter).app, 'b1');
    expect(back?.pages['3']?.lines[0]?.text).toBe('第一行');
  });

  it('识别失败：不抛，记下原因继续过', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const adapter = new FakeAdapter();
    const { host, applied } = fakeHost();
    const runner = new PdfOcrRunner(depsOf(host, adapter));
    expect(await runner.runPage(1)).toBe(false);
    expect(applied).toHaveLength(0);
    expect(runner.getState().error).toContain('500');
  });

  it('认一批：跳过错过的页，进度有总数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okReply());
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new FakeAdapter();
    /* 第 1 页已经认过：这次从 1 起跑两页，实际只该认第 2、3 页 */
    await writeOcr(
      { vault: { adapter } } as unknown as App,
      withOcrPage(null, 'b1', 1, toOcrPage({ lines: [{ text: '旧', rect: { left: 0.1, top: 0.1, width: 0.2, height: 0.02 } }], layout: true, text: '' }, 'vision', 'm')),
    );
    const { host, applied } = fakeHost(10);
    const runner = new PdfOcrRunner(depsOf(host, adapter));
    await runner.load();
    const seen: number[] = [];
    runner['deps'].onProgress = (s) => {
      if (s.done > 0 && !seen.includes(s.done)) seen.push(s.done);
    };
    await runner.runBatch(1, 2);
    expect(applied.map((a) => a.page)).toEqual([2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen).toContain(2);
  });

  it('取消：认完一页就停，后面的页不再发请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okReply());
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new FakeAdapter();
    const { host, applied } = fakeHost(10);
    const notes: string[] = [];
    const deps = depsOf(host, adapter, notes);
    const runner = new PdfOcrRunner(deps);
    deps.onProgress = (s) => {
      if (s.done === 1) runner.cancel();
    };
    await runner.runBatch(1, 5);
    expect(applied).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    /* 界面靠 last 说「已停止 · 认完 1 页」：只给 running=false 分不出
       是跑完了还是被用户停掉的 */
    expect(runner.getState().last).toBe('stopped');
  });

  it('空白页：不算失败、落盘成 empty 页，重开书也不会再排它', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okReply('{"lines":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new FakeAdapter();
    const app = { vault: { adapter } } as unknown as App;
    const { host } = fakeHost(10);
    const runner = new PdfOcrRunner(depsOf(host, adapter));
    const ran = await runner.runBatch(1, 2);
    expect(ran).toBe(true);
    expect(runner.getState().failed).toEqual([]);
    expect(runner.getState().last).toBe('done');
    expect(runner.recognized().has(1)).toBe(true);
    /* 读回来还在：不然重开书之后又会为同一张空白页付一次钱 */
    const file = await readOcr(app, 'b1');
    expect(file?.pages['1']?.empty).toBe(true);
  });

  it('这一批都认过了：返回 false，条子据此自己收起来', async () => {
    const adapter = new FakeAdapter();
    const app = { vault: { adapter } } as unknown as App;
    await writeOcr(
      app,
      withOcrPage(null, 'b1', 1, toOcrPage({ lines: [{ text: '甲' }], layout: false, text: '甲' }, 'http', 'http')),
    );
    const { host } = fakeHost(1);
    const runner = new PdfOcrRunner(depsOf(host, adapter));
    await runner.load();
    const ran = await runner.runBatch(1, 1);
    expect(ran).toBe(false);
  });

  it('打开书：读盘并整本灌给引擎', async () => {
    const adapter = new FakeAdapter();
    const app = { vault: { adapter } } as unknown as App;
    await writeOcr(app, withOcrPage(null, 'b1', 2, toOcrPage({ lines: [{ text: '甲', rect: { left: 0.1, top: 0.1, width: 0.2, height: 0.02 } }], layout: true, text: '' }, 'vision', 'm')));
    const { host, bulk } = fakeHost(10);
    const runner = new PdfOcrRunner(depsOf(host, adapter));
    const file = await runner.load();
    expect(file?.pages['2']).toBeTruthy();
    expect(bulk[0]?.['2']?.lines[0]?.text).toBe('甲');
    expect(runner.recognized().has(2)).toBe(true);
  });

  it('清掉：文件删掉，引擎里的层一起撤', async () => {
    const adapter = new FakeAdapter();
    const app = { vault: { adapter } } as unknown as App;
    await writeOcr(app, withOcrPage(null, 'b1', 1, toOcrPage({ lines: [{ text: '甲', rect: { left: 0.1, top: 0.1, width: 0.2, height: 0.02 } }], layout: true, text: '' }, 'vision', 'm')));
    const { host, bulk } = fakeHost(10);
    const runner = new PdfOcrRunner(depsOf(host, adapter));
    await runner.clear();
    expect(adapter.files.has(ocrPath('b1'))).toBe(false);
    expect(bulk.at(-1)).toBeNull();
  });

  it('按确认卡给出的页号跑：不往后补页，「重新生成」也不跳过已认页', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okReply());
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new FakeAdapter();
    const app = { vault: { adapter } } as unknown as App;
    await writeOcr(app, withOcrPage(null, 'b1', 1, toOcrPage({ lines: [{ text: '旧', rect: { left: 0.1, top: 0.1, width: 0.2, height: 0.02 } }], layout: true, text: '' }, 'vision', 'm')));
    const { host, applied } = fakeHost(10);
    const runner = new PdfOcrRunner(depsOf(host, adapter));
    await runner.load();
    const ran = await runner.runPages([1, 2, 3]);
    expect(ran).toBe(true);
    /* 第 1 页已认过也照认（覆盖），而且不会补到 4、5 页去 */
    expect(applied.map((a) => a.page)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('失败页可见与重试', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('失败页升序去重，非法页号不进表', () => {
    expect(addFailedPage([], 3)).toEqual([3]);
    expect(addFailedPage([3], 1)).toEqual([1, 3]);
    expect(addFailedPage([1, 3], 3)).toEqual([1, 3]);
    expect(addFailedPage([], 0)).toEqual([]);
  });

  it('一批里有一页失败：记下页号，条子拿得到这份名单', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okReply())
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(okReply());
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new FakeAdapter();
    const { host } = fakeHost(10);
    const notes: string[] = [];
    const runner = new PdfOcrRunner(depsOf(host, adapter, notes));
    await runner.runBatch(1, 3);
    expect(runner.getState().failed).toEqual([2]);
    expect(runner.getState().last).toBe('done');
    /* 页号不再靠通知喊：条子直接读 failed，通知只留「为什么失败」 */
    expect(notes.join('')).toContain('没成功');
  });

  it('重试只认失败的那几页，成功后就从表里摘掉', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okReply())
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(okReply())
      .mockResolvedValueOnce(okReply());
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new FakeAdapter();
    const { host, applied } = fakeHost(10);
    const runner = new PdfOcrRunner(depsOf(host, adapter));
    await runner.runBatch(1, 3);
    expect(runner.getState().failed).toEqual([2]);
    const before = fetchMock.mock.calls.length;
    await runner.retryFailed();
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect(applied.map((a) => a.page)).toEqual([1, 3, 2]);
    expect(runner.getState().failed).toEqual([]);
  });

  it('没有失败页时重试只给一句提示，不发请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okReply());
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new FakeAdapter();
    const { host } = fakeHost(10);
    const notes: string[] = [];
    const runner = new PdfOcrRunner(depsOf(host, adapter, notes));
    await runner.retryFailed();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notes.join('')).toContain('没有要重试');
  });
});
