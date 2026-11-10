import { describe, expect, it } from 'vitest';
import type { BookMeta } from '../src/data/schema';
import type { PortraitFile } from '../src/data/portrait';
import { buildEnrichMessages, enrichSample, mergeMetaPatch, parseEnrichReply } from '../src/data/book-enrich';

/**
 * 导入补元数据（2026-11-11）。
 *
 * 导入一本 EPUB 常常只有书名与作者：简介、分类、语言都空着。这一层让用户
 * 点一下菜单补上，三条规矩：
 *   1. **只填空白**：用户改过的简介、已有的分类不动；
 *   2. **模型输出格式固定**：解析失败宁可什么都不写，也不要把一段散文塞进简介；
 *   3. **样本来自画像**：没有画像就只用书名/作者——不为了补信息去解析整本书。
 */

function meta(patch: Partial<BookMeta> = {}): BookMeta {
  return { title: '一本书', ...patch };
}

function portrait(patch: Partial<PortraitFile> = {}): PortraitFile {
  return {
    version: 1,
    bookId: 'b1',
    bookTitle: '一本书',
    plan: 'vector',
    model: 'm1',
    chunkChars: 1000,
    total: 1,
    blocks: [{ chapter: '第一章', chars: 10, text: '开头一段正文。' }],
    createdAt: 1,
    updatedAt: 1,
    done: true,
    ...patch,
  };
}

describe('parseEnrichReply', () => {
  it('解析标准的简介 / 标签 / 语言三行', () => {
    const p = parseEnrichReply('简介：讲一个人在乱世里做选择的故事。\n标签：小说, 历史, 成长\n语言：zh');
    expect(p.description).toBe('讲一个人在乱世里做选择的故事。');
    expect(p.subjects).toEqual(['小说', '历史', '成长']);
    expect(p.language).toBe('zh');
  });

  it('全角冒号、顿号、英文标签都认', () => {
    const p = parseEnrichReply('简介: 一本讲修身的书\nTags: philosophy、self-help\nLanguage: en');
    expect(p.description).toBe('一本讲修身的书');
    expect(p.subjects).toEqual(['philosophy', 'self-help']);
    expect(p.language).toBe('en');
  });

  it('只给简介时不硬编造标签与语言', () => {
    const p = parseEnrichReply('简介：只有一句话。');
    expect(p.description).toBe('只有一句话。');
    expect(p.subjects).toBeUndefined();
    expect(p.language).toBeUndefined();
  });

  it('整段不像约定格式时什么都不返回（宁可不写）', () => {
    expect(parseEnrichReply('这本书写得很好，建议大家都读一读。')).toEqual({});
  });

  it('空输入返回空对象', () => {
    expect(parseEnrichReply('')).toEqual({});
    expect(parseEnrichReply('   \n  ')).toEqual({});
  });

  it('简介过长时截断（书架详情放不下一整段）', () => {
    const p = parseEnrichReply(`简介：${'长'.repeat(400)}`);
    expect(p.description!.length).toBeLessThanOrEqual(201);
  });
});

describe('mergeMetaPatch', () => {
  it('空白字段才写', () => {
    const out = mergeMetaPatch(meta(), { description: '一段简介', subjects: ['小说'], language: 'zh' });
    expect(out).toMatchObject({ description: '一段简介', subjects: ['小说'], language: 'zh' });
  });

  it('已有简介与语言不动（用户改过的更贵）', () => {
    const out = mergeMetaPatch(meta({ description: '我写的', language: 'en' }), {
      description: '模型写的',
      language: 'zh',
    });
    expect(out.description).toBeUndefined();
    expect(out.language).toBeUndefined();
  });

  it('分类是合并去重，不是覆盖', () => {
    const out = mergeMetaPatch(meta({ subjects: ['小说'] }), { subjects: ['小说', '历史'] });
    expect(out.subjects).toEqual(['小说', '历史']);
  });

  it('没有任何可写的东西时返回空对象（调用方据此不落盘）', () => {
    expect(mergeMetaPatch(meta({ description: '已有', language: 'zh', subjects: ['a'] }), {})).toEqual({});
  });

  it('分类太多时只留前几个', () => {
    const out = mergeMetaPatch(meta(), { subjects: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
    expect(out.subjects!.length).toBeLessThanOrEqual(6);
  });
});

describe('enrichSample', () => {
  it('向量画像取正文，压缩画像取总述与要点', () => {
    expect(enrichSample(portrait())).toContain('开头一段正文。');
    const compress = portrait({
      plan: 'compress',
      overview: '全书总述。',
      blocks: [{ chapter: '第一章', chars: 10, digest: '一句', summary: '一段要点。' }],
    });
    const text = enrichSample(compress);
    expect(text).toContain('全书总述。');
    expect(text).toContain('一段要点。');
  });

  it('没有画像时返回空串（只用书名与作者）', () => {
    expect(enrichSample(null)).toBe('');
  });

  it('超长时截断', () => {
    const long = portrait({ blocks: [{ chapter: '第一章', chars: 10, text: '很长'.repeat(3000) }] });
    expect(enrichSample(long, 200).length).toBeLessThanOrEqual(201);
  });
});

describe('buildEnrichMessages · enrich', () => {
  it('书名、作者、样本都进上下文，要求固定格式', () => {
    const msgs = buildEnrichMessages({ title: '一本书', author: '某作者', sample: '开头一段正文。' });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('简介');
    const all = msgs.map((m) => m.content).join('\n');
    expect(all).toContain('一本书');
    expect(all).toContain('某作者');
    expect(all).toContain('开头一段正文。');
  });

  it('没有样本时也能出（只凭书名与作者）', () => {
    const all = buildEnrichMessages({ title: '一本书' }).map((m) => m.content).join('\n');
    expect(all).toContain('一本书');
    expect(all).not.toContain('【片段】');
  });
});
