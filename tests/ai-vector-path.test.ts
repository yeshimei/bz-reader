/**
 * 全书问答的向量路径（tests/ai-vector-path.test.ts）
 *
 * 这条路径的错法都很安静：依据被截掉一半，界面照常出答案；相似度不过阈值
 * 也照常凑满 6 块，模型只能对着噪声硬答。所以这里锁的是**最终交给模型的
 * 那份依据**，不是中间某一步的形状。
 *
 * 五条契约：
 *   1. 全书依据只有一个预算口径，且裁的时候**留开头**（最相关的块在最前）；
 *   2. 低于阈值 / 维度对不上的块不参与，宁可返回空让上层说「没找到」；
 *   3. 来源带原文摘录，点开能按片段落回书里；
 *   4. 短问题拼章节名再算查询向量；
 *   5. 向量方案的相邻块有重叠，跨块论证不会断。
 */
import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { FakeAdapter } from './helpers/fake-adapter';
import {
  PORTRAIT_EVIDENCE_LIMIT,
  chapterAwarePicks,
  chunkChapters,
  expandQuery,
  topBlocksByVector,
  writePortrait,
  type PortraitFile,
} from '../src/data/portrait';
import { AI_CONTEXT_LIMIT, mergeEvidence, sourcesOfBlocks } from '../src/data/ai-evidence';
import { buildMessages } from '../src/data/ai';
import { AI_EVIDENCE_LIMIT } from '../src/data/ai-budget';
import { readPortraitCached } from '../src/data/portrait-cache';

function portrait(patch: Partial<PortraitFile> = {}): PortraitFile {
  return {
    version: 1,
    bookId: 'b1',
    bookTitle: '围城',
    plan: 'vector',
    model: 'bge-m3',
    chunkChars: 1000,
    total: 1,
    blocks: [],
    createdAt: 1,
    updatedAt: 1,
    done: true,
    ...patch,
  };
}

describe('依据预算：一个口径', () => {
  it('三处上限指向同一个数：8000 字', () => {
    expect(AI_EVIDENCE_LIMIT).toBe(8000);
    expect(AI_CONTEXT_LIMIT).toBe(AI_EVIDENCE_LIMIT);
    expect(PORTRAIT_EVIDENCE_LIMIT).toBe(AI_EVIDENCE_LIMIT);
  });

  it('超预算时裁掉尾部，最相关的开头必须还在', () => {
    const ctx = `【第一章】\n开头标记${'甲'.repeat(8100)}结尾标记${'乙'.repeat(900)}`;
    const msgs = buildMessages({ task: 'ask', text: '方鸿渐是谁？', context: ctx });
    const user = msgs.filter((m) => m.role === 'user').at(-1)!;
    expect(user.content).toContain('开头标记');
    expect(user.content).not.toContain('结尾标记');
    expect(user.content.length).toBeLessThanOrEqual(AI_EVIDENCE_LIMIT + 20);
  });

  it('合并笔记时书先吃预算，书的前缀不被笔记挤掉', () => {
    const book = { context: `书首${'书'.repeat(7900)}书尾`, sources: [] };
    const notes = { context: `笔记${'笔'.repeat(3000)}`, sources: [] };
    const out = mergeEvidence(book, notes)!;
    expect(out.context.startsWith('书首')).toBe(true);
    expect(out.context.length).toBeLessThanOrEqual(AI_EVIDENCE_LIMIT);
  });
});

describe('检索：阈值与维度守卫', () => {
  const block = (vec: number[]) => ({ chapter: '第一章', chars: 10, vec: b64(vec) });

  it('明显不相关的块被阈值挡掉（不拿噪声凑满 k 块）', () => {
    const p = portrait({
      blocks: [block([1, 0]), block([0.5, 0.866]), block([0, 1])],
    });
    const picks = topBlocksByVector(p, [1, 0], 6);
    expect(picks.map((x) => x.block)).toHaveLength(1);
  });

  it('全部低于绝对下限时返回空：上层据此说「书里没找到」，而不是硬答', () => {
    const p = portrait({ blocks: [block([0.1, 0.995]), block([0.05, 0.999])] });
    expect(topBlocksByVector(p, [1, 0], 6)).toEqual([]);
  });

  it('维度对不上的块被跳过（换模型但名字没变时不能静默算分）', () => {
    const p = portrait({ blocks: [block([1, 0, 0]), block([1, 0])] });
    const picks = topBlocksByVector(p, [1, 0], 6);
    expect(picks).toHaveLength(1);
    expect(picks[0]!.block.vec).toBe(b64([1, 0]));
  });
});

describe('来源：带原文摘录', () => {
  const block = (chapter: string, index: number, text: string) => ({ chapter, index, text });

  it('摘录取块首 40 字，点开能按片段落回书里', () => {
    const text = '方鸿渐到欧洲留学，四年里换了三所大学，最后从克莱登大学弄到一张文凭。';
    const src = sourcesOfBlocks('b1', [block('第一章', 3, text)]);
    expect(src[0]!.note).toContain('第 4 块');
    expect(src[0]!.note).toContain('方鸿渐到欧洲留学');
    expect(src[0]!.text).toBe(text.slice(0, 40));
  });

  it('没有原文的老画像保持原样（不塞空摘录）', () => {
    const src = sourcesOfBlocks('b1', [{ chapter: '第一章', index: 0 }]);
    expect(src[0]!.text).toBeUndefined();
    expect(src[0]!.note).toBe('第 1 块');
  });
});

describe('检索结果：命中的章带回章首', () => {
  const mk = (chapter: string, text: string) => ({ chapter, chars: text.length, text, vec: b64([1, 0]) });
  const p = portrait({
    blocks: [mk('一', '一甲'), mk('一', '一乙'), mk('二', '二甲'), mk('二', '二乙'), mk('二', '二丙')],
  });
  const cand = [
    { block: p.blocks[3]!, index: 3, score: 0.9 },
    { block: p.blocks[4]!, index: 4, score: 0.8 },
  ];

  it('命中的章把它第一块也带上（章首常给定义、背景、专名）', () => {
    const picks = chapterAwarePicks(p, cand, 4);
    expect(picks.map((x) => x.block.text)).toContain('二甲');
    expect(picks.map((x) => x.block.text)).toContain('二乙');
  });

  it('章首已经在候选里时不重复', () => {
    const picks = chapterAwarePicks(p, cand, 4);
    expect(picks.filter((x) => x.block.text === '二甲')).toHaveLength(1);
  });

  it('名额封顶，且按分数排出（章首不挤掉最相关的块）', () => {
    const many = p.blocks.map((block, index) => ({ block, index, score: 1 - index / 10 }));
    const picks = chapterAwarePicks(p, many, 3);
    expect(picks).toHaveLength(3);
    expect(picks[0]!.block.text).toBe('一甲');
    expect(picks.map((x) => x.score)).toEqual([...picks.map((x) => x.score)].sort((a, b) => b - a));
  });
});

describe('查询扩展：只给带指代词的短问题补章节名', () => {
  it('带指代又很短的问题，拼上当前章节名再算向量', () => {
    expect(expandQuery('他为什么走', '第三章')).toBe('第三章 他为什么走');
  });

  it('同一长度但主语是专名：不拼（拼了会把它拉向前文）', () => {
    expect(expandQuery('三闾大学的校长是谁？', '第一章')).toBe('三闾大学的校长是谁？');
  });

  it('已经问清楚的问题不拼（避免把问题拉向当前章）', () => {
    const q = '方鸿渐在三国大学经历了什么，为什么最后离开';
    expect(expandQuery(q, '第三章')).toBe(q);
  });

  it('没有章节名时原样返回', () => {
    expect(expandQuery('他为什么走')).toBe('他为什么走');
  });
});

describe('切块：向量方案相邻块重叠', () => {
  it('开了重叠之后，下一块开头复述上一块结尾 120 字', () => {
    const text = Array.from({ length: 25 }, (_, i) => `第${i}段：${'字'.repeat(100)}`).join('\n');
    const plain = chunkChapters([{ title: '第一章', text }], 1000);
    const over = chunkChapters([{ title: '第一章', text }], 1000, { overlap: 120 });
    expect(over.length).toBeGreaterThanOrEqual(plain.length);
    expect(over[0]!.text.startsWith('第0段')).toBe(true);
    const tail = over[0]!.text.slice(-120);
    expect(over[1]!.text.startsWith(tail)).toBe(true);
  });

  it('默认不重叠（压缩方案与老画像的切块口径不动）', () => {
    const text = '甲'.repeat(2500);
    const chunks = chunkChapters([{ title: '一章', text }], 1000);
    expect(chunks.reduce((n, c) => n + c.chars, 0)).toBe(2500);
  });
});

describe('画像缓存：按 mtime + size 命中', () => {
  function appOf(adapter: FakeAdapter): App {
    return { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
  }

  it('同一份文件不重复读；文件变了重新读', async () => {
    const adapter = new FakeAdapter();
    const app = appOf(adapter);
    await writePortrait(app, portrait({ overview: '第一版' }));

    let reads = 0;
    const rawRead = adapter.read.bind(adapter);
    adapter.read = async (path: string) => {
      reads += 1;
      return rawRead(path);
    };

    const first = await readPortraitCached(app, 'b1');
    expect(first?.overview).toBe('第一版');
    expect(reads).toBe(1);

    const again = await readPortraitCached(app, 'b1');
    expect(again?.overview).toBe('第一版');
    expect(reads).toBe(1);

    await writePortrait(app, portrait({ overview: '第二版' }));
    const changed = await readPortraitCached(app, 'b1');
    expect(changed?.overview).toBe('第二版');
    expect(reads).toBe(2);
  });
});

/** 测试里手写 base64 的小工具：只给 2/3 维向量用 */
function b64(vec: number[]): string {
  const buf = new ArrayBuffer(vec.length * 4);
  const view = new DataView(buf);
  vec.forEach((v, i) => view.setFloat32(i * 4, v, true));
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
