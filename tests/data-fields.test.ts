import { describe, expect, it } from 'vitest';
import {
  applyEngineMeta,
  contributorNames,
  contributorText,
  engineMetaFromBook,
  isbnOf,
  textOf,
} from '../src/data/book-meta';
import { EMPTY_DATA, SCHEMA_VERSION, recordPosition, type ReadingBlock } from '../src/data/schema';
import { sanitizeData } from '../src/data/store';
import { coverFileName, extOfMime, normalizeCoverIndex } from '../src/data/cover-name';
import { attachChapter } from '../src/engine/activity';
import type { FoliateBook } from '../src/types/foliate';

/**
 * 落盘字段完整性契约（2026-11-04）。
 *
 * 背景：bz 的书库要读这份数据文件。bz 侧自己适配字段名，但**数据本身必须存全**：
 * 作者、封面路径、出版社、语言、简介、分类、ISBN、出版日期、丛书、章节数，
 * 以及「上一次位置」「会话发生在哪一章」这类现在用不上、以后要用的冗余。
 *
 * 这里用 foliate 真实输出的形状（`tidy()` 会把单元素数组压成对象）锁行为，
 * 免得再出现「字段声明了、但回填永远为空」这种静默缺口。
 */

/** foliate `getMetadata()` 经 `tidy()` 之后的典型形状：单个 contributor 是对象，不是字符串 */
function foliateBook(metadata: Record<string, unknown>, sections = 2): FoliateBook {
  return {
    metadata,
    sections: Array.from({ length: sections }, () => ({})),
    toc: [
      { label: '一', href: 'a.xhtml' },
      { label: '二', href: 'b.xhtml' },
    ],
  } as unknown as FoliateBook;
}

describe('textOf：引擎元数据的各种真实形状', () => {
  it('字符串与函数直接取', () => {
    expect(textOf('书名')).toBe('书名');
    expect(textOf(() => '书名')).toBe('书名');
  });

  it('contributor 对象取 name（tidy 后的单作者就是对象）', () => {
    expect(textOf({ name: '曹雪芹', role: ['aut'] })).toBe('曹雪芹');
  });

  it('LanguageMap（多语言标题）取第一个非空值', () => {
    expect(textOf({ zh: '红楼梦', en: 'Dream of the Red Chamber' })).toBe('红楼梦');
  });

  it('数组取第一个非空（title 的 alternate-script 形态）', () => {
    expect(textOf([{ name: 'A' }, 'B'])).toBe('A');
  });

  it('数字转字符串，空值一律空串', () => {
    expect(textOf(42)).toBe('42');
    expect(textOf(null)).toBe('');
    expect(textOf(undefined)).toBe('');
    expect(textOf({})).toBe('');
  });
});

describe('contributorText / contributorNames', () => {
  it('多作者拼起来，不丢第二个', () => {
    expect(contributorText([{ name: 'A' }, { name: 'B' }])).toBe('A、B');
  });

  it('单作者（对象）原样', () => {
    expect(contributorText({ name: 'A' })).toBe('A');
  });

  it('分类列表去空、去重、保序', () => {
    expect(contributorNames([{ name: '长篇小说' }, { name: ' ' }, { name: '长篇小说' }, { name: '意大利' }])).toEqual([
      '长篇小说',
      '意大利',
    ]);
  });

  it('单分类对象也能吃', () => {
    expect(contributorNames({ name: '散文' })).toEqual(['散文']);
  });
});

describe('isbnOf：从 identifier / altIdentifier 里捞 ISBN', () => {
  it('urn:isbn: 前缀', () => {
    expect(isbnOf({ identifier: 'urn:isbn:9787020002207' })).toBe('9787020002207');
  });

  it('altIdentifier 里的 isbn scheme', () => {
    expect(isbnOf({ altIdentifier: [{ scheme: 'isbn', value: '9787532776771' }] })).toBe('9787532776771');
  });

  it('没有就用空串（不要拿 identifier 乱充）', () => {
    expect(isbnOf({ identifier: 'urn:uuid:3978bb51' })).toBe('');
  });

  it('EPUB2 把 ISBN 直接写在 identifier 里（纯 10 位数字）', () => {
    expect(isbnOf({ identifier: '1619127694' })).toBe('1619127694');
  });

  it('13 位纯数字也认（ISBN-13）', () => {
    expect(isbnOf({ identifier: '9787020002207' })).toBe('9787020002207');
  });
});

describe('engineMetaFromBook：打开书时能拿到的全部书目字段', () => {
  it('作者/出版社/语言/简介/分类/ISBN/出版日期/丛书/章节数/字数全量提取', () => {
    const book = foliateBook(
      {
        title: '我的天才女友',
        subtitle: '那不勒斯四部曲 1',
        author: { name: '[意] 埃莱娜·费兰特', role: ['aut'] },
        publisher: { name: '人民文学出版社' },
        language: ['zh'],
        description: '两个女孩一生的友谊。',
        identifier: 'urn:isbn:9787020120290',
        published: '2016-12-31',
        subject: [{ name: '长篇小说' }, { name: '意大利' }],
        belongsTo: { series: { name: '那不勒斯四部曲', position: '1' } },
      },
      3,
    );
    const m = engineMetaFromBook(book, '兜底书名', 166057);
    expect(m.title).toBe('我的天才女友');
    expect(m.subtitle).toBe('那不勒斯四部曲 1');
    expect(m.author).toBe('[意] 埃莱娜·费兰特');
    expect(m.publisher).toBe('人民文学出版社');
    expect(m.language).toBe('zh');
    expect(m.description).toBe('两个女孩一生的友谊。');
    expect(m.subjects).toEqual(['长篇小说', '意大利']);
    expect(m.identifier).toBe('urn:isbn:9787020120290');
    expect(m.isbn).toBe('9787020120290');
    expect(m.publishDate).toBe('2016-12-31');
    expect(m.series).toBe('那不勒斯四部曲');
    expect(m.seriesIndex).toBe('1');
    expect(m.chapterCount).toBe(3);
    expect(m.wordCount).toBe(166057);
  });

  it('metadata 为空时书名回落文件名，其余留空而不是 undefined', () => {
    const m = engineMetaFromBook({ metadata: {}, sections: [], toc: [] } as unknown as FoliateBook, '文件名', 0);
    expect(m.title).toBe('文件名');
    expect(m.author).toBe('');
    expect(m.subjects).toEqual([]);
    expect(m.chapterCount).toBe(0);
  });
});

describe('applyEngineMeta：回填全部字段，书名尊重用户改名', () => {
  function book(): Parameters<typeof applyEngineMeta>[0] {
    return {
      id: 'b1',
      meta: { title: '旧名' },
      fileRef: { vaultPath: '书/a.epub', format: 'epub' },
      reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
      notes: { highlights: [], excerpts: [], bookmarks: [] },
      addedAt: 1,
      updatedAt: 1,
    };
  }

  it('作者/出版社/分类/ISBN/丛书/章节数一起回填', () => {
    const b = book();
    const changed = applyEngineMeta(b, {
      title: '新名',
      author: '曹雪芹',
      publisher: '人民文学出版社',
      language: 'zh',
      description: '简介',
      subjects: ['古典文学'],
      isbn: '9787020002207',
      identifier: 'urn:isbn:9787020002207',
      publishDate: '2019-10-16',
      series: '中国古典文学读本丛书',
      seriesIndex: '1',
      subtitle: '彩皮版',
      chapterCount: 138,
      wordCount: 879954,
    });
    expect(changed).toBe(true);
    expect(b.meta).toMatchObject({
      title: '新名',
      author: '曹雪芹',
      publisher: '人民文学出版社',
      language: 'zh',
      description: '简介',
      subjects: ['古典文学'],
      isbn: '9787020002207',
      identifier: 'urn:isbn:9787020002207',
      publishDate: '2019-10-16',
      series: '中国古典文学读本丛书',
      seriesIndex: '1',
      subtitle: '彩皮版',
      chapterCount: 138,
      wordCount: 879954,
    });
  });

  it('改过名：书名不覆盖，其余照填', () => {
    const b = book();
    b.meta.title = '我改的名字';
    b.meta.titleEdited = true;
    applyEngineMeta(b, { title: '旧书名', author: '作者' });
    expect(b.meta.title).toBe('我改的名字');
    expect(b.meta.author).toBe('作者');
  });

  it('分类数组比较按内容，不重复回填', () => {
    const b = book();
    b.meta.subjects = ['古典文学'];
    expect(applyEngineMeta(b, { subjects: ['古典文学'] })).toBe(false);
    expect(applyEngineMeta(b, { subjects: ['古典文学', '小说'] })).toBe(true);
  });

  it('空字符串不覆盖已有值（引擎这次没读到，不代表要把旧值抹掉）', () => {
    const b = book();
    b.meta.author = '曹雪芹';
    expect(applyEngineMeta(b, { author: '' })).toBe(false);
    expect(b.meta.author).toBe('曹雪芹');
  });
});

describe('recordPosition：上一次位置作为冗余落盘', () => {
  function reading(): ReadingBlock {
    return {
      position: { percent: 0.1, cfi: 'epubcfi(/6/2)', chapterIndex: 0, chapterTitle: '一' },
      stats: { totalReadTime: 0, lastReadTime: 0 },
      sessions: [],
    };
  }

  it('CFI 变了：旧位置进 lastPosition，带 savedAt', () => {
    const r = reading();
    recordPosition(
      r,
      { percent: 0.2, cfi: 'epubcfi(/6/4)', chapterIndex: 1, chapterTitle: '二', chapterHref: 'ch2.xhtml' },
      1000,
    );
    expect(r.position).toMatchObject({
      percent: 0.2,
      cfi: 'epubcfi(/6/4)',
      chapterIndex: 1,
      chapterTitle: '二',
      chapterHref: 'ch2.xhtml',
    });
    expect(r.lastPosition).toMatchObject({ percent: 0.1, cfi: 'epubcfi(/6/2)', chapterTitle: '一', savedAt: 1000 });
  });

  it('同一位置反复上报不刷 lastPosition（翻页高频调用）', () => {
    const r = reading();
    recordPosition(r, { percent: 0.15, cfi: 'epubcfi(/6/2)' }, 1000);
    recordPosition(r, { percent: 0.16, cfi: 'epubcfi(/6/2)' }, 2000);
    expect(r.lastPosition).toBeUndefined();
    expect(r.position.percent).toBe(0.16);
  });
});

describe('落盘形状：schemaVersion 与冗余字段不丢', () => {
  it('EMPTY_DATA 带 schemaVersion', () => {
    expect(SCHEMA_VERSION).toBe(3);
    expect(EMPTY_DATA.schemaVersion).toBe(3);
  });

  it('sanitize 保留 lastPosition 与 schemaVersion（读盘一次不把冗余清掉）', () => {
    const clean = sanitizeData({
      version: 1,
      schemaVersion: 2,
      books: [
        {
          id: 'b1',
          meta: { title: '书', author: '作者', publisher: '社', subjects: ['分类'], chapterCount: 12 },
          fileRef: { vaultPath: 'a.epub', format: 'epub' },
          reading: {
            position: { percent: 0.5, cfi: 'cfi/2' },
            lastPosition: { percent: 0.4, cfi: 'cfi/1', savedAt: 99 },
            stats: { totalReadTime: 1, lastReadTime: 2 },
            sessions: [],
          },
          notes: { highlights: [], excerpts: [], bookmarks: [] },
          addedAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(clean?.schemaVersion).toBe(3);
    const b = clean!.books[0]!;
    expect(b.meta).toMatchObject({ author: '作者', publisher: '社', subjects: ['分类'], chapterCount: 12 });
    expect(b.reading.lastPosition).toMatchObject({ cfi: 'cfi/1', percent: 0.4, savedAt: 99 });
  });

  it('sanitize 保留 fileRef.fingerprint（读盘一次不丢内容指纹）', () => {
    const clean = sanitizeData({
      version: 1,
      schemaVersion: 3,
      books: [
        {
          id: 'b1',
          meta: { title: '书' },
          fileRef: { vaultPath: 'a.epub', format: 'epub', size: 10, fingerprint: 'v1-abc' },
          reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
          notes: { highlights: [], excerpts: [], bookmarks: [] },
          addedAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(clean?.books[0]?.fileRef.fingerprint).toBe('v1-abc');
  });
});

describe('封面缓存文件名：bz 侧要能直接当 vault 图片路径用', () => {
  it('mime → 扩展名（jpeg 归 jpg）', () => {
    expect(extOfMime('image/jpeg')).toBe('jpg');
    expect(extOfMime('image/png')).toBe('png');
    expect(extOfMime('image/webp')).toBe('webp');
    expect(extOfMime('image/gif')).toBe('gif');
    expect(extOfMime('application/octet-stream')).toBe('jpg');
  });

  it('文件名 = <bookId>-<size>.<ext>', () => {
    expect(coverFileName('b1-123', 'image/png')).toBe('b1-123.png');
  });

  it('索引兼容旧的「key → mime 字符串」格式', () => {
    expect(normalizeCoverIndex({ 'b1-1': 'image/jpeg' })).toEqual({
      'b1-1': { mime: 'image/jpeg', file: 'b1-1' },
    });
  });

  it('新格式原样保留，坏值丢弃', () => {
    expect(normalizeCoverIndex({ 'b1-1': { mime: 'image/png', file: 'b1-1.png' }, bad: 42 })).toEqual({
      'b1-1': { mime: 'image/png', file: 'b1-1.png' },
    });
  });
});

describe('attachChapter：会话带上章节冗余（以后按章统计用）', () => {
  it('把结束时的章节信息挂到会话上', () => {
    const s = attachChapter(
      { start: 1, end: 2, durationSeconds: 60 },
      { chapterIndex: 3, chapterTitle: '第三章' },
    );
    expect(s).toMatchObject({ start: 1, end: 2, durationSeconds: 60, chapterIndex: 3, chapterTitle: '第三章' });
  });

  it('没有章节信息时不硬塞空字段', () => {
    const s = attachChapter({ start: 1, end: 2, durationSeconds: 60 }, {});
    expect(s.chapterIndex).toBeUndefined();
    expect(s.chapterTitle).toBeUndefined();
  });
});
