import { describe, expect, it } from 'vitest';
import type { BookMeta } from '../src/data/schema';
import type { PortraitFile } from '../src/data/portrait';
import {
  buildEnrichMessages,
  enrichDoneKind,
  enrichNeeds,
  enrichSample,
  mergeMetaPatch,
  parseEnrichReply,
  pickEnrichShelf,
} from '../src/data/book-enrich';

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

  /* 2026-11-17：AI 补全顺便给书写一个书架分类。labels 用「归类」与标签区分，
     别把「分类」也当书架分类——那个词在标签行里早就是 subjects 的别名。 */
  it('解析「归类」行成 shelf，与标签各归各', () => {
    const p = parseEnrichReply('简介：一本小说\n标签：小说, 成长\n语言：zh\n归类：文学');
    expect(p.subjects).toEqual(['小说', '成长']);
    expect(p.shelf).toBe('文学');
  });

  it('AI 把书架分类写成「分类」而不是「归类」时不污染标签', () => {
    const p = parseEnrichReply('简介：一本小说\n标签：小说\n分类：文学');
    /* 「分类」是标签的别名，这一行会成为标签；归类行缺席时 shelf 不写 */
    expect(p.shelf).toBeUndefined();
  });
});

describe('pickEnrichShelf', () => {
  const existing = ['文学', '科学', '历史'];

  it('AI 给的名字规整后命中现有分类 → 复用现有的写法', () => {
    expect(pickEnrichShelf(' 文学 ', existing)).toBe('文学');
    expect(pickEnrichShelf('文 学', existing)).toBe('文学');
  });

  it('现有分类都不合适 → 用 AI 起的新名字', () => {
    expect(pickEnrichShelf('纪实文学', existing)).toBe('纪实文学');
  });

  it('空名字不归类', () => {
    expect(pickEnrichShelf('', existing)).toBe('');
    expect(pickEnrichShelf('   ', existing)).toBe('');
  });

  it('撞上保留名「全部 / 未分类」不写（它们是筛选格，不是分类）', () => {
    expect(pickEnrichShelf('全部', existing)).toBe('');
    expect(pickEnrichShelf('未分类', existing)).toBe('');
  });
});

describe('buildEnrichMessages 带现有分类名册', () => {
  it('把名册交给模型，并要求优先复用、没有再新建', () => {
    const msgs = buildEnrichMessages({ title: '一本书', shelfNames: ['文学', '科学'] });
    const system = msgs[0].content;
    expect(system).toContain('文学');
    expect(system).toContain('科学');
    expect(system).toContain('归类');
    expect(system).toContain('现有分类');
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

  /* 2026-11-11 真机反馈：AI 的标签一直往已有分类上追加，于是「补全信息」每点一次
     都能凑出几条新标签、每点一次都弹「已补上」，而用户原来的分类被越搅越乱。
     分类和简介同一条规矩：只填空，有就不动。 */
  it('已有分类时不再追加（用户归过的就是他的分类）', () => {
    const out = mergeMetaPatch(meta({ subjects: ['小说'] }), { subjects: ['小说', '历史'] });
    expect(out.subjects).toBeUndefined();
  });

  it('没有分类时写入模型给的标签', () => {
    const out = mergeMetaPatch(meta(), { subjects: ['小说', '历史'] });
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

/* 「这本书还缺什么」：调模型之前先问一遍。两项都齐了就根本不该发请求——
   2026-11-11 真机反馈的核心：点一次弹一次，模型每次换个说法又能凑出「新增」，
   额度白花，用户还以为是在重复补简介。 */
describe('enrichNeeds', () => {
  it('两项都空：都要补', () => {
    expect(enrichNeeds(meta())).toEqual({ description: true, subjects: true });
  });

  it('只有简介：只补分类', () => {
    expect(enrichNeeds(meta({ description: '已有简介' }))).toEqual({
      description: false,
      subjects: true,
    });
  });

  it('只有分类：只补简介', () => {
    expect(enrichNeeds(meta({ subjects: ['小说'] }))).toEqual({
      description: true,
      subjects: false,
    });
  });

  it('两项都有：都不用补（调用方据此不发请求）', () => {
    expect(enrichNeeds(meta({ description: '已有', subjects: ['小说'] }))).toEqual({
      description: false,
      subjects: false,
    });
  });

  it('空白串与空数组不算「有」', () => {
    expect(enrichNeeds(meta({ description: '   ', subjects: ['  '] }))).toEqual({
      description: true,
      subjects: true,
    });
  });
});

/* 写完之后说哪句话：以前不管补到什么都弹「已补上简介与分类」，用户看到的是
   「简介明明有，怎么又补了」。按这次真的写了哪个字段说。 */
describe('enrichDoneKind', () => {
  it('两样都写了', () => {
    expect(enrichDoneKind({ description: '一段', subjects: ['a'] })).toBe('both');
  });

  it('只写了简介', () => {
    expect(enrichDoneKind({ description: '一段' })).toBe('desc');
  });

  it('只写了分类', () => {
    expect(enrichDoneKind({ subjects: ['a'] })).toBe('tags');
  });

  it('什么都没写', () => {
    expect(enrichDoneKind({})).toBe('none');
  });

  /* 回归（2026-11-17）：只补到「语言」时，以前落到 else 被报成
     「已补上简介与分类」——可简介和分类一个字都没动，用户看着像误报。 */
  it('只补到语言也算补了，但说「语言」那一档，不报简介与分类', () => {
    expect(enrichDoneKind({ language: 'zh' })).toBe('lang');
  });

  it('简介 + 语言：仍是「简介」档，不因多一行语言改口', () => {
    expect(enrichDoneKind({ description: '一段', language: 'zh' })).toBe('desc');
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
