/**
 * 全书画像数据层（data/portrait.ts）：切块 / 预估 / 向量编解码 / 依据拼装 / 状态判定。
 *
 * 这一层的错都会变成用户的钱和时间：块切错 → 检索指不到地方；预估错 → 点了开始发现
 * 要多花十倍请求；向量编解码错 → 答案全偏但界面一切正常。所以全是纯函数断言。
 */
import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { FakeAdapter } from './helpers/fake-adapter';
import {
  PORTRAIT_CHUNK_CHARS,
  blocksEvidence,
  chapterDigests,
  chunkChapters,
  compressEvidence,
  cosine,
  decodeVector,
  encodeVector,
  estimateBlocks,
  estimateChars,
  estimateRequests,
  firstSentence,
  listPortraits,
  orphanPortraits,
  portraitPath,
  portraitState,
  sanitizePortrait,
  topBlocksByVector,
  writePortrait,
  type PortraitFile,
} from '../src/data/portrait';

function portrait(patch: Partial<PortraitFile> = {}): PortraitFile {
  return {
    version: 1,
    bookId: 'b1',
    bookTitle: '心流',
    plan: 'compress',
    model: 'm',
    chunkChars: 8000,
    total: 1,
    blocks: [{ chapter: '第一章', chars: 100, summary: '要点', digest: '一句话' }],
    createdAt: 1,
    updatedAt: 1,
    done: true,
    ...patch,
  };
}

describe('切块：按字数、章节只当边界参考', () => {
  it('短章节可以合并进同一块（不为一页前言白花一次请求）', () => {
    const chunks = chunkChapters(
      [
        { title: '前言', text: '这是一段很短的前言。' },
        { title: '第一章', text: '第一章的正文也不长。' },
      ],
      8000,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chapter).toBe('前言');
    expect(chunks[0].text).toContain('第一章的正文也不长');
  });

  it('章首正好是分界线时收口：上一块过半就换块，块不跨章', () => {
    const big = '甲'.repeat(4500);
    const chunks = chunkChapters(
      [
        { title: '第一章', text: big },
        { title: '第二章', text: big },
      ],
      8000,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0].chapter).toBe('第一章');
    expect(chunks[1].chapter).toBe('第二章');
    expect(chunks[0].text).not.toContain('第二章');
  });

  it('单段超长（整章没有换行）时按字数硬切，不丢字', () => {
    const text = '乙'.repeat(2500);
    const chunks = chunkChapters([{ title: '一章', text }], 1000);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.reduce((n, c) => n + c.chars, 0)).toBe(2500);
  });

  it('块大小设成 0 / 负数时不炸：夹回一个可用下限', () => {
    expect(chunkChapters([{ title: 'a', text: 'x'.repeat(500) }], 0).length).toBeGreaterThan(0);
  });

  it('空白章节跳过，不产出空块', () => {
    expect(chunkChapters([{ title: '空白', text: '   \n\n  ' }], 1000)).toEqual([]);
  });
});

describe('预估', () => {
  it('EPUB 的字节数折算成字数，TXT 直接用字符数', () => {
    expect(estimateChars({ meta: { title: '', wordCount: 2500 }, fileRef: { vaultPath: 'a.epub', format: 'epub' } })).toBe(1000);
    expect(estimateChars({ meta: { title: '', wordCount: 2500 }, fileRef: { vaultPath: 'a.txt', format: 'txt' } })).toBe(2500);
  });

  it('没有字数记录时退回文件体积；什么都不知道就是 0', () => {
    expect(estimateChars({ meta: { title: '' }, fileRef: { vaultPath: 'a.epub', format: 'epub', size: 4000 } })).toBe(1000);
    expect(estimateChars(null)).toBe(0);
  });

  it('块数按各自的口径算；空书也至少一块', () => {
    expect(estimateBlocks(10_000, 'vector')).toBe(10);
    expect(estimateBlocks(10_000, 'compress')).toBe(2);
    expect(estimateBlocks(0, 'compress')).toBe(1);
  });

  it('请求数：向量按批、压缩一块一次外加一次总述', () => {
    expect(estimateRequests(10, 'vector', 8)).toBe(2);
    expect(estimateRequests(10, 'compress')).toBe(11);
  });

  it('两种方案的块大小按定稿取值（向量细、压缩粗）', () => {
    expect(PORTRAIT_CHUNK_CHARS.vector).toBe(1000);
    expect(PORTRAIT_CHUNK_CHARS.compress).toBe(8000);
  });
});

describe('向量', () => {
  it('编解码往返不丢精度（float32 精度内）', () => {
    const src = [0.5, -1.25, 3.1415926, 0, 1e-6];
    const back = Array.from(decodeVector(encodeVector(src)));
    expect(back).toHaveLength(src.length);
    back.forEach((v, i) => expect(v).toBeCloseTo(src[i], 5));
  });

  it('坏 base64 / 空串返回空向量而不是抛错', () => {
    expect(decodeVector('这不是 base64').length).toBe(0);
    expect(decodeVector('').length).toBe(0);
    expect(decodeVector(undefined).length).toBe(0);
  });

  it('余弦：同向 1、反向 -1、零向量 0（不产生 NaN）', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(Number.isNaN(cosine([], [1]))).toBe(false);
  });

  it('取前 k 块，按分数从高到低，缺向量的块不参与', () => {
    const p = portrait({
      plan: 'vector',
      blocks: [
        { chapter: '第一章', chars: 10, vec: encodeVector([1, 0]) },
        { chapter: '第二章', chars: 10, vec: encodeVector([0.9, 0.1]) },
        { chapter: '第三章', chars: 10 },
        { chapter: '第四章', chars: 10, vec: encodeVector([0, 1]) },
      ],
    });
    const top = topBlocksByVector(p, [1, 0], 2);
    expect(top.map((x) => x.block.chapter)).toEqual(['第一章', '第二章']);
    expect(top[0].score).toBeGreaterThan(top[1].score);
  });

  it('没有查询向量时返回空（不发散地拿前几块凑数）', () => {
    expect(topBlocksByVector(portrait(), [], 3)).toEqual([]);
  });
});

describe('依据拼装', () => {
  it('压缩方案按章分节拼要点；超长时头尾都留（不许只留前半本）', () => {
    const p = portrait({
      blocks: [
        { chapter: '第一章', chars: 1, summary: '开头：心流的定义' },
        { chapter: '第二章', chars: 1, summary: '中段：专注的条件' },
        { chapter: '第三章', chars: 1, summary: '结尾：如何进入心流' },
      ],
    });
    const ev = compressEvidence(p);
    expect(ev).toContain('【第一章】');
    expect(ev).toContain('如何进入心流');

    const tiny = compressEvidence(p, 30);
    expect(tiny).toContain('中段省略');
    expect(tiny.startsWith('【第一章】')).toBe(true);
    expect(tiny).toContain('结尾');
  });

  it('每章取第一条一句话摘要（鸟瞰用）', () => {
    const p = portrait({
      blocks: [
        { chapter: '第一章', chars: 1, digest: '讲了心流的定义' },
        { chapter: '第一章', chars: 1, digest: '第二条不该覆盖' },
        { chapter: '第二章', chars: 1, digest: '讲了进入方法' },
      ],
    });
    expect(chapterDigests(p)).toEqual([
      { chapter: '第一章', line: '讲了心流的定义' },
      { chapter: '第二章', line: '讲了进入方法' },
    ]);
  });
});

describe('状态', () => {
  it('没建 / 建到一半 / 可用', () => {
    expect(portraitState(null, 'm')).toBe('none');
    expect(portraitState(portrait({ done: false }), 'm')).toBe('building');
    expect(portraitState(portrait(), 'm')).toBe('ready');
  });

  it('向量方案换了嵌入模型 = stale（维度不同不可比）；压缩方案不受影响', () => {
    expect(portraitState(portrait({ plan: 'vector', model: 'bge-m3' }), 'qwen3')).toBe('stale');
    expect(portraitState(portrait({ plan: 'compress', model: 'gpt-4o-mini' }), 'deepseek')).toBe('ready');
  });

  it('探测不到模型名时不凭猜测让人重建', () => {
    expect(portraitState(portrait({ plan: 'vector', model: 'bge-m3' }), '')).toBe('ready');
  });

  /* 2026-11-07：模型名改由第二大脑提供，画像里却没记 —— 这份向量不是这套
     模型算的，拿它检索会静默给错结果，所以判废。 */
  it('画像没记模型名、但现在有模型名：判废', () => {
    expect(portraitState(portrait({ plan: 'vector', model: '' }), 'qwen3')).toBe('stale');
  });
});

describe('收口径与无主画像', () => {
  it('坏 JSON / 缺字段被修成可用形状；块数不足按块数算', () => {
    const p = sanitizePortrait({ plan: 'weird', blocks: [{ chapter: 'x' }], total: 9 }, 'b1');
    expect(p?.plan).toBe('vector');
    expect(p?.total).toBe(9);
    expect(p?.blocks).toHaveLength(1);
    expect(p?.chunkChars).toBe(PORTRAIT_CHUNK_CHARS.vector);
  });

  it('既没有块也没完成 → null（当成没建过，不显示半份空画像）', () => {
    expect(sanitizePortrait(null, 'b1')).toBeNull();
    expect(sanitizePortrait({ blocks: [] }, 'b1')).toBeNull();
  });

  it('无主画像：文件在、书上没有；归档的书不算无主', () => {
    expect(orphanPortraits([{ bookId: 'a' }, { bookId: 'b' }], [{ id: 'a' }])).toEqual(['b']);
  });
});


/**
 * 向量方案的依据（2026-11-07 补）：命中块的原文拼起来。
 *
 * 以前画像只存向量不存原文，检索到「最相关的八块」之后没有东西可给模型看。
 * 老画像没有 text 字段，退回 digest / summary——答得浅，但不是一个空字符串。
 */
describe('blocksEvidence · 命中块的原文', () => {
  const block = (chapter: string, text?: string, digest?: string) => ({ chapter, chars: 10, text, digest });

  it('按命中顺序拼，章节变化时起一个小标题', () => {
    const out = blocksEvidence({} as never, [
      { block: block('第一章', '甲'.repeat(10)) },
      { block: block('第一章', '乙'.repeat(10)) },
      { block: block('第二章', '丙'.repeat(10)) },
    ]);
    expect(out).toContain('【第一章】');
    expect(out).toContain('【第二章】');
    expect(out.indexOf('甲')).toBeLessThan(out.indexOf('乙'));
    expect(out.match(/【第一章】/g)).toHaveLength(1);
  });

  it('老画像没有原文时退回一句话摘要', () => {
    const out = blocksEvidence({} as never, [{ block: block('序', undefined, '讲专注') }]);
    expect(out).toContain('讲专注');
  });

  it('超长时截断，不把整本书塞进上下文', () => {
    const out = blocksEvidence({} as never, [{ block: block('一', '字'.repeat(5000)) }], 400);
    expect(out.length).toBeLessThanOrEqual(402);
  });
});

/* 一句话摘要：夹在两块正文之间当「这章讲了什么」用，太长会占掉半屏 */
describe('firstSentence', () => {
  it('取第一个句末标点', () => {
    expect(firstSentence('注意力是有限的。所以要做减法。')).toBe('注意力是有限的。');
  });

  it('没有标点就整句截断，并补省略号', () => {
    expect(firstSentence('字'.repeat(80))).toBe(`${'字'.repeat(60)}…`);
  });

  it('空输入给空串（不要一个孤零零的省略号）', () => {
    expect(firstSentence('   ')).toBe('');
  });
});

/* 盘上的画像：读回来的 mtime 决定 bz 侧要不要重新读（数据层的缓存按它判） */
describe('画像文件 · 存储', () => {
  function appOf(adapter: FakeAdapter): App {
    return { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
  }

  it('mtime 取自磁盘：重建之后不能被当成旧文件一直用缓存', async () => {
    const adapter = new FakeAdapter();
    const app = appOf(adapter);
    await writePortrait(app, portrait({ bookId: 'b1' }));

    const first = await listPortraits(app);
    expect(first).toHaveLength(1);
    expect(first[0]!.bookId).toBe('b1');
    expect(first[0]!.mtime).toBeGreaterThan(0);

    /* 重建 = 同一个路径被重写；mtime 不变的话调用方永远读旧向量 */
    adapter.bump(portraitPath('b1'));
    const second = await listPortraits(app);
    expect(second[0]!.mtime).toBeGreaterThan(first[0]!.mtime);
  });

  it('正本直接写失败时靠 rename 落盘：不留下半截 JSON', async () => {
    const adapter = new FakeAdapter();
    const app = appOf(adapter);
    const target = portraitPath('b1');
    const rawWrite = adapter.write.bind(adapter);
    adapter.write = async (path: string, data: string) => {
      if (path === target) throw new Error('disk full');
      return rawWrite(path, data);
    };

    expect(await writePortrait(app, portrait({ bookId: 'b1' }))).toBe(true);
    expect(JSON.parse(adapter.files.get(target)!).bookId).toBe('b1');
    expect([...adapter.files.keys()].some((p) => p.endsWith('.tmp'))).toBe(false);
  });

  it('平台不支持 rename：退回直接写，照样存得下', async () => {
    const adapter = new FakeAdapter({ renameAlwaysFails: true });
    const app = appOf(adapter);
    expect(await writePortrait(app, portrait({ bookId: 'b2' }))).toBe(true);
    expect(JSON.parse(adapter.files.get(portraitPath('b2'))!).bookId).toBe('b2');
  });
});
