/**
 * 建画像流程（data/portrait-build.ts）：暂停/续跑/取消、失败只重跑失败块、已完成不重算。
 *
 * 这条流程每错一次，用户要么白花钱（重复请求），要么白等（整本重来）。
 * 所以这里全部用假依赖跑真实状态机，不碰网络、不碰 Obsidian。
 */
import { describe, expect, it, vi } from 'vitest';
import { PortraitBuilder, estimateOf, type PortraitBuildDeps } from '../src/data/portrait-build';
import { decodeVector, type PortraitFile } from '../src/data/portrait';

function deps(patch: Partial<PortraitBuildDeps> = {}) {
  const saved: PortraitFile[] = [];
  const base: PortraitBuildDeps = {
    load: async () => null,
    save: async (p) => {
      saved.push(JSON.parse(JSON.stringify(p)));
      return true;
    },
    extract: async (onProgress) => {
      onProgress(1, 1, '第一章');
      return [{ title: '第一章', text: '字'.repeat(2500) }];
    },
    embed: async (texts) => texts.map((t) => [t.length, 1]),
    summarise: async () => ({ digest: '一句话', summary: '要点' }),
    overview: async () => '整本书讲的是专注',
    embedModel: () => 'bge-m3',
    chatModel: () => 'chat-model',
    now: () => 1000,
    ...patch,
  };
  return { deps: base, saved };
}

const book = { id: 'b1', title: '心流' };

describe('向量方案', () => {
  it('读完书 → 切块 → 按批嵌入 → 每批落盘 → 完成', async () => {
    const { deps: d, saved } = deps();
    const b = new PortraitBuilder(d);
    await b.start(book, 'vector');

    const p = b.current()!;
    expect(p.total).toBe(3); // 2500 字 / 1000 字一块
    expect(p.blocks.every((x) => !!x.vec)).toBe(true);
    expect(p.done).toBe(true);
    expect(p.model).toBe('bge-m3');
    expect(p.dim).toBe(2);
    expect(decodeVector(p.blocks[0].vec).length).toBe(2);
    expect(saved.length).toBeGreaterThan(1); // 开跑一次 + 每批一次
    expect(b.progress().status).toBe('done');
    expect(b.progress().done).toBe(3);
  });

  it('续跑：已有向量的块不再请求，只补缺的', async () => {
    const partial: PortraitFile = {
      version: 1,
      bookId: 'b1',
      bookTitle: '心流',
      plan: 'vector',
      model: 'bge-m3',
      chunkChars: 1000,
      total: 3,
      blocks: [
        { chapter: '第一章', chars: 1000, vec: 'AAAA' },
        { chapter: '第一章', chars: 1000 },
        { chapter: '第一章', chars: 500 },
      ],
      createdAt: 1,
      updatedAt: 1,
      done: false,
    };
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 1]));
    const { deps: d } = deps({ load: async () => JSON.parse(JSON.stringify(partial)), embed });
    const b = new PortraitBuilder(d);
    await b.start(book, 'vector');

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][0]).toHaveLength(2); // 只补后两块
    expect(b.current()!.done).toBe(true);
  });

  it('已完成且方案一致：一个请求都不发', async () => {
    const done: PortraitFile = {
      version: 1,
      bookId: 'b1',
      bookTitle: '心流',
      plan: 'vector',
      model: 'bge-m3',
      chunkChars: 1000,
      total: 1,
      blocks: [{ chapter: '一', chars: 10, vec: 'AAAA' }],
      createdAt: 1,
      updatedAt: 1,
      done: true,
    };
    const embed = vi.fn(async () => [[1]]);
    const extract = vi.fn(async () => [{ title: '一', text: 'x' }]);
    const { deps: d } = deps({ load: async () => JSON.parse(JSON.stringify(done)), embed, extract });
    const b = new PortraitBuilder(d);
    await b.start(book, 'vector');

    expect(embed).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(b.progress().status).toBe('done');
  });

  it('重建（用户主动点）：已完成也整本重来', async () => {
    const done: PortraitFile = {
      version: 1,
      bookId: 'b1',
      bookTitle: '心流',
      plan: 'vector',
      model: 'bge-m3',
      chunkChars: 1000,
      total: 1,
      blocks: [{ chapter: '一', chars: 10, vec: 'AAAA' }],
      createdAt: 1,
      updatedAt: 1,
      done: true,
    };
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 1]));
    const { deps: d } = deps({ load: async () => JSON.parse(JSON.stringify(done)), embed });
    const b = new PortraitBuilder(d);
    await b.start(book, 'vector', { rebuild: true });
    expect(embed).toHaveBeenCalled();
  });

  it('失败块记下原因，重试只补它', async () => {
    let round = 0;
    const embed = vi.fn(async (texts: string[]) => {
      round += 1;
      if (round === 1) throw new Error('Ollama 错误: 500');
      return texts.map(() => [1, 1]);
    });
    const { deps: d } = deps({ embed });
    const b = new PortraitBuilder(d);
    await b.start(book, 'vector');

    expect(b.progress().status).not.toBe('done');
    expect(b.current()!.blocks[0].error).toContain('Ollama');
    expect(b.current()!.done).toBe(false);

    await b.retryFailed();
    expect(b.current()!.done).toBe(true);
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('读书阶段失败：给出原因，不留半份空画像', async () => {
    const { deps: d } = deps({
      extract: async () => {
        throw new Error('这本书读不出正文');
      },
    });
    const b = new PortraitBuilder(d);
    await b.start(book, 'vector');
    expect(b.progress().status).toBe('error');
    expect(b.progress().message).toContain('读不出正文');
  });
});

describe('暂停 / 取消', () => {
  it('暂停后状态是 paused，进度留在盘上；继续把缺口补完', async () => {
    let release: (() => void) | null = null;
    const embed = vi.fn(async (texts: string[], signal: AbortSignal) => {
      if (embed.mock.calls.length === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        throw Object.assign(new Error('已取消'), { name: 'AbortError' });
      }
      return texts.map(() => [1, 1]);
    });
    const { deps: d, saved } = deps({ embed });
    const b = new PortraitBuilder(d);
    const run = b.start(book, 'vector');

    await vi.waitFor(() => expect(embed).toHaveBeenCalled());
    b.pause();
    release?.();
    await run;

    expect(b.progress().status).toBe('paused');
    expect(saved.length).toBeGreaterThan(0);
    expect(b.current()!.done).toBe(false);

    await b.resume();
    expect(b.current()!.done).toBe(true);
  });

  it('取消只停下，不删盘上的进度', async () => {
    const { deps: d, saved } = deps();
    const b = new PortraitBuilder(d);
    await b.start(book, 'vector');
    b.cancel();
    expect(b.progress().status).toBe('idle');
    expect(saved.length).toBeGreaterThan(0);
    expect(saved[saved.length - 1].blocks.length).toBe(3);
  });

  it('暂停中不会因为 abort 把块标成失败（用户主动停的不算错）', async () => {
    const embed = vi.fn(async (texts: string[], signal: AbortSignal) => {
      await new Promise((r) => setTimeout(r, 5));
      signal.throwIfAborted();
      return texts.map(() => [1, 1]);
    });
    const { deps: d } = deps({ embed });
    const b = new PortraitBuilder(d);
    const run = b.start(book, 'vector');
    await vi.waitFor(() => expect(embed).toHaveBeenCalled());
    b.pause();
    await run;
    expect(b.current()!.blocks.some((x) => x.error)).toBe(false);
  });
});

describe('压缩方案', () => {
  it('逐块要「一句话 + 要点」，最后可以补一次全书总述', async () => {
    const summarise = vi.fn(async () => ({ digest: '讲了心流', summary: '要点若干' }));
    const { deps: d } = deps({
      summarise,
      extract: async () => [{ title: '第一章', text: '字'.repeat(9000) }],
    });
    const b = new PortraitBuilder(d);
    await b.start(book, 'compress');

    const p = b.current()!;
    expect(p.total).toBe(2); // 9000 / 8000
    expect(summarise).toHaveBeenCalledTimes(2);
    expect(p.blocks[0].digest).toBe('讲了心流');
    expect(p.model).toBe('chat-model');
    expect(p.done).toBe(true);

    const overview = await b.buildOverview();
    expect(overview).toBe('整本书讲的是专注');
    expect(b.current()!.overview).toBe('整本书讲的是专注');
  });

  it('总述失败不影响块级完成', async () => {
    const { deps: d } = deps({
      overview: async () => {
        throw new Error('超时');
      },
      extract: async () => [{ title: '一', text: '字'.repeat(100) }],
    });
    const b = new PortraitBuilder(d);
    await b.start(book, 'compress');
    expect(await b.buildOverview()).toBeNull();
    expect(b.current()!.done).toBe(true);
  });
});

describe('预估', () => {
  it('向量按批、压缩逐块加一次总述', () => {
    expect(estimateOf(10_000, 'vector')).toEqual({ blocks: 10, requests: 2 });
    expect(estimateOf(10_000, 'compress')).toEqual({ blocks: 2, requests: 3 });
  });
});

/**
 * 向量方案要留原文（2026-11-07）。
 *
 * 检索出「最相关的八块」之后，拼上下文用的是原文；不存就得每次提问
 * 把整本书重新解析一遍。压缩方案不存——它的 summary 本身就是依据。
 */
describe('块里的原文', () => {
  it('向量方案：每块都带着自己的原文，且与切块一致', async () => {
    const { deps: d } = deps();
    const b = new PortraitBuilder(d);
    await b.start(book, 'vector');
    const p = b.current()!;
    expect(p.blocks.every((x) => typeof x.text === 'string' && x.text.length > 0)).toBe(true);
    expect(p.blocks.map((x) => x.text!.length).reduce((a, c) => a + c, 0)).toBe(2500);
  });

  it('压缩方案：不存原文（只有摘要）', async () => {
    const { deps: d } = deps();
    const b = new PortraitBuilder(d, 'compress');
    await b.start(book, 'compress');
    const p = b.current()!;
    expect(p.blocks.every((x) => x.text === undefined)).toBe(true);
    expect(p.blocks.every((x) => !!x.summary)).toBe(true);
  });

  it('续跑同一块时原文跟着旧块一起留在文件里', async () => {
    const { deps: d } = deps();
    const b = new PortraitBuilder(d);
    await b.start(book, 'vector');
    const first = b.current()!;
    const b2 = new PortraitBuilder({ ...d, load: async () => JSON.parse(JSON.stringify(first)) });
    await b2.start(book, 'vector');
    expect(b2.current()!.blocks[0].text).toBe(first.blocks[0].text);
  });
});
