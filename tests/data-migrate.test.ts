import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { ReaderStore } from '../src/data/store';
import { normalizePrefs, pickPrefs } from '../src/data/prefs';
import { DEFAULT_DATA_DIR } from '../src/core/plugin-path';
import { FakeAdapter } from './helpers/fake-adapter';

/* ============================================================
 * 0.4.1 → 1.0.0 旧库升级回归（发版门禁）。
 *
 * 1.0.0 只改了版本号，数据格式名义上没动——但这一版往 `bz-reader.json`
 * 里塞了不少新字段（PDF 视角、卡片下放、引用页签、笔记时间线、偏好里的
 * PDF 那几项）。老库里当然没有它们，全靠 `sanitizeDataDetailed` 逐字段
 * 兜默认值。
 *
 * 兜底写错的方向有两种，都很难在真机上发现：
 *   1. 某个字段没兜住 → 那一项**每读一次盘就丢一次**（lastPosition 就
 *      这么丢过），用户看到的是「我的划线少了一条」；
 *   2. 兜底过严 → 整本书被判成脏数据丢进 dropped，用户在书架上一夜之间
 *      少半排书。
 *
 * 所以这里不放结构断言，而是拿一份**0.4.1 形状的真数据**跑两遍：
 * 读 → 写 → 再读，老字段一个不少、新字段拿到默认值、round-trip 稳定。
 * ============================================================ */

const DIR = DEFAULT_DATA_DIR;
const FILE = `${DIR}/bz-reader.json`;

function makeStore(adapter: FakeAdapter): ReaderStore {
  const app = { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
  return new ReaderStore(app);
}

/** 一份 0.4.1 形状的书：没有任何 1.0.0 新增字段 */
function oldBook(id: string, title: string) {
  return {
    id,
    meta: { title, author: '某作者', format: 'epub' },
    fileRef: { vaultPath: `书/${title}.epub`, format: 'epub', size: 1024 },
    reading: {
      position: {
        percent: 0.42,
        cfi: 'epubcfi(/6/14!/4/2/2[c01]/1:0)',
        chapterIndex: 3,
        chapterTitle: '第三章 潮汐',
        chapterHref: 'ch03.xhtml',
        savedAt: 1_700_000_000_000,
      },
      lastPosition: {
        percent: 0.4,
        cfi: 'epubcfi(/6/12!/4/2/2[c01]/1:0)',
        chapterTitle: '第二章 回声',
        savedAt: 1_699_999_000_000,
      },
      stats: {
        totalReadTime: 7512,
        lastReadTime: 1_700_000_000_000,
        startReadTime: 1_699_000_000_000,
        rating: 4,
        review: '收尾太急',
      },
      sessions: [
        { start: 1_699_999_000_000, end: 1_700_000_000_000 },
        { start: 1_699_998_000_000, end: 1_699_998_500_000 },
      ],
    },
    notes: {
      highlights: [
        {
          id: 'h1',
          text: '海面像一块被人反复擦过的玻璃。',
          cfiRange: 'epubcfi(/6/14!/4/2/2[c01]/1:0)',
          chapterIndex: 3,
          chapterTitle: '第三章 潮汐',
          color: '#c98b53',
          comment: '和第二章那段对得上',
          createdAt: 1_699_999_500_000,
        },
      ],
      excerpts: [
        {
          id: 'e1',
          text: '潮水退下去的时候，才看得见滩上的字。',
          cfiRange: 'epubcfi(/6/16!/4/2/4[c02]/1:0)',
          createdAt: 1_699_999_600_000,
        },
      ],
      bookmarks: [{ id: 'b1', cfi: 'epubcfi(/6/18!/4/2/6[c03]/1:0)', label: '第四章', createdAt: 1_699_999_700_000 }],
    },
    favorite: true,
    shelf: '小说',
    addedAt: 1_698_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

function payload(books: unknown[]): string {
  return JSON.stringify({
    version: 1,
    books,
    prefs: {
      /* 0.4.1 的偏好：没有 pdfZoom / pdfLinkLabel / headerOrder 这些 */
      fontSize: 19,
      lineHeight: 1.7,
      margin: 56,
      fontFamily: 'serif',
      align: 'justify',
      accent: 'copper',
      layout: 'horizontal',
      columns: 1,
      footnote: 'popup',
      ttsRate: 1.2,
      ttsFollow: false,
      flow: 'paged',
      toolbarStyle: 'icons',
    },
  });
}

describe('0.4.1 → 1.0.0 旧库升级', () => {
  it('老库直接读：一本书都不丢，进度 / 标注 / 收藏原样在', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, payload([oldBook('b1', '潮汐'), oldBook('b2', '回声')]));
    const store = makeStore(adapter);

    const data = await store.load();
    expect(data.books.map((b) => b.id)).toEqual(['b1', 'b2']);

    const b1 = data.books[0]!;
    expect(b1.reading.position.percent).toBeCloseTo(0.42, 5);
    expect(b1.reading.position.cfi).toBe('epubcfi(/6/14!/4/2/2[c01]/1:0)');
    expect(b1.reading.position.chapterTitle).toBe('第三章 潮汐');
    /* lastPosition 以前就是「重建对象时漏掉、读一次盘永久丢」的那个字段 */
    expect(b1.reading.lastPosition?.chapterTitle).toBe('第二章 回声');
    expect(b1.reading.lastPosition?.percent).toBeCloseTo(0.4, 5);
    /* 读完打分与一句话感受也是读侧不能丢的沉淀 */
    expect(b1.reading.stats.rating).toBe(4);
    expect(b1.reading.stats.review).toBe('收尾太急');
    expect(b1.reading.sessions).toHaveLength(2);

    expect(b1.notes.highlights).toHaveLength(1);
    expect(b1.notes.highlights[0]!.comment).toBe('和第二章那段对得上');
    expect(b1.notes.highlights[0]!.color).toBe('#c98b53');
    expect(b1.notes.excerpts[0]!.text).toBe('潮水退下去的时候，才看得见滩上的字。');
    expect(b1.notes.bookmarks[0]!.label).toBe('第四章');

    expect(b1.favorite).toBe(true);
    expect(b1.shelf).toBe('小说');
  });

  it('老库缺的新字段拿到默认值，不是 undefined 漏进界面', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, payload([oldBook('b1', '潮汐')]));
    const store = makeStore(adapter);
    const data = await store.load();

    const b1 = data.books[0]!;
    /* 笔记时间线：老库没有，按 0 处理（合并时取「标注时间更大的那份」） */
    expect(b1.notesUpdatedAt ?? 0).toBe(0);
    /* 偏好里 1.0.0 才有的那几项必须齐全——设置页读到 undefined 就会出现
       「字号正常、PDF 缩放那格空着」这种半坏状态。注意读侧的口径是
       pickPrefs（原样存的 prefs 过一遍 normalize），不是 raw prefs。 */
    const prefs = pickPrefs(data, false);
    const defaults = normalizePrefs({});
    for (const key of Object.keys(defaults)) {
      expect(prefs[key as keyof typeof prefs], `prefs.${key}`).not.toBeUndefined();
    }
    /* 老库里写过的值不被默认值盖掉 */
    expect(prefs.fontSize).toBe(19);
    expect(prefs.ttsRate).toBe(1.2);
    expect(prefs.ttsFollow).toBe(false);
  });

  it('读 → 写 → 再读：round-trip 稳定，没有字段在写盘时被吃掉', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, payload([oldBook('b1', '潮汐'), oldBook('b2', '回声')]));
    const first = makeStore(adapter);
    const before = await first.load();
    await first.flush(true);

    const disk = adapter.files.get(FILE)!;
    /* 写回去的文件必须还是合法 JSON、还是那两本 */
    const reRead = makeStore(adapter);
    const after = await reRead.load();

    expect(after.books.map((b) => b.id)).toEqual(before.books.map((b) => b.id));
    for (let i = 0; i < before.books.length; i += 1) {
      const a = before.books[i]!;
      const b = after.books[i]!;
      expect(b.reading.position).toEqual(a.reading.position);
      expect(b.reading.lastPosition).toEqual(a.reading.lastPosition);
      expect(b.reading.stats).toEqual(a.reading.stats);
      expect(b.notes).toEqual(a.notes);
      expect(b.shelf).toBe(a.shelf);
      expect(b.favorite).toBe(a.favorite);
      expect(b.addedAt).toBe(a.addedAt);
    }
    expect(disk).toContain('epubcfi(/6/14!/4/2/2[c01]/1:0)');
  });

  it('坏书才进 dropped：缺 id / 缺路径的照旧丢，好书不受牵连', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(
      FILE,
      payload([
        oldBook('b1', '好书'),
        { meta: { title: '没有 id' }, fileRef: { vaultPath: 'x.epub' } },
        { id: 'b3', meta: { title: '没有路径' } },
        { id: 'b4', meta: { title: '路径是空的' }, fileRef: { vaultPath: '' } },
      ]),
    );
    const store = makeStore(adapter);
    const data = await store.load();

    /* 只有一本是好的——另外三条脏数据不许把好书一起带进 dropped */
    expect(data.books.map((b) => b.id)).toEqual(['b1']);
  });
});
