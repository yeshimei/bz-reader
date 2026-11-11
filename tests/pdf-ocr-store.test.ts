import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import {
  emptyOcrFile,
  ocrChars,
  ocrDir,
  ocrPageAt,
  ocrPages,
  ocrPath,
  readOcr,
  removeOcr,
  sanitizeOcrFile,
  sanitizeOcrPage,
  withOcrPage,
  writeOcr,
  type OcrFile,
} from '../src/data/pdf-ocr';
import type { OcrPage } from '../src/engine/pdf/ocr';
import { FakeAdapter } from './helpers/fake-adapter';

function appOf(adapter: FakeAdapter): App {
  return { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
}

function pageOf(text: string, top = 0.1): OcrPage {
  return {
    engine: 'vision',
    model: 'm1',
    at: 100,
    layout: true,
    lines: [{ text, rect: { left: 0.1, top, width: 0.3, height: 0.02 } }],
  };
}

describe('OCR 落盘路径', () => {
  it('按书 id 一个文件，分隔符与上跳一律挡掉', () => {
    expect(ocrDir()).toBe('bz-reader/storage/ocr');
    expect(ocrPath('b1')).toBe('bz-reader/storage/ocr/b1.json');
    expect(ocrPath('../etc/passwd')).toBe('bz-reader/storage/ocr/.._etc_passwd.json');
    expect(ocrPath('a:b')).toBe('bz-reader/storage/ocr/a_b.json');
    expect(ocrPath('')).toBe('bz-reader/storage/ocr/unknown.json');
  });
});

describe('收口径', () => {
  it('缺位置的页判成 layout=false（不能划词，但文本还在）', () => {
    const got = sanitizeOcrPage({ engine: 'http', model: 'x', lines: [{ text: '只给了字' }] });
    expect(got?.layout).toBe(false);
    expect(got?.lines).toHaveLength(1);
  });

  it('坏页整条丢掉：没有文本、页号不是数字、行全是空串', () => {
    const file = sanitizeOcrFile(
      {
        version: 1,
        bookId: 'b1',
        engine: 'vision',
        model: 'm1',
        pages: {
          '1': pageOf('甲'),
          x: pageOf('乙'),
          '2': { engine: 'vision', lines: [{ text: '   ' }] },
        },
      },
      'b1',
    );
    expect(Object.keys(file?.pages ?? {})).toEqual(['1']);
  });

  it('没有页的文件读回来是空壳而不是 null（书开着但一页都没认）', () => {
    const file = sanitizeOcrFile({ version: 1, bookId: 'b1' }, 'b1');
    expect(file).not.toBeNull();
    expect(ocrPages(file)).toEqual([]);
    expect(ocrChars(file)).toBe(0);
  });

  it('认不出的东西返回 null', () => {
    expect(sanitizeOcrFile(null, 'b1')).toBeNull();
    expect(sanitizeOcrFile('x', 'b1')).toBeNull();
  });
});

describe('逐页合并', () => {
  it('写一页不动其它页，同页覆盖成新的', () => {
    let file = withOcrPage(null, 'b1', 3, pageOf('第三页'));
    file = withOcrPage(file, 'b1', 5, pageOf('第五页'));
    file = withOcrPage(file, 'b1', 3, pageOf('第三页改'));
    expect(Object.keys(file.pages)).toEqual(['3', '5']);
    expect(ocrPageAt(file, 3)?.lines[0]?.text).toBe('第三页改');
    expect(ocrPageAt(file, 4)).toBeNull();
    /* 3 被覆盖成「第三页改」(4) + 「第五页」(3) */
    expect(ocrChars(file)).toBe(7);
  });

  it('页号收成 1 基整数，0 与负数夹到 1', () => {
    expect(Object.keys(withOcrPage(null, 'b1', 0, pageOf('甲')).pages)).toEqual(['1']);
    expect(Object.keys(withOcrPage(null, 'b1', 2.7, pageOf('甲')).pages)).toEqual(['2']);
  });

  it('换了引擎与模型记在文件头上，页数据保留', () => {
    const first = withOcrPage(null, 'b1', 1, pageOf('甲'));
    const next = withOcrPage(first, 'b1', 2, { ...pageOf('乙'), engine: 'http', model: 'paddle' });
    expect(next.engine).toBe('http');
    expect(next.model).toBe('paddle');
    expect(Object.keys(next.pages)).toEqual(['1', '2']);
  });
});

describe('读写盘', () => {
  it('写完读回来一模一样，不留 .tmp', async () => {
    const adapter = new FakeAdapter();
    const app = appOf(adapter);
    const file = withOcrPage(emptyOcrFile('b1'), 'b1', 1, pageOf('甲'));
    expect(await writeOcr(app, file)).toBe(true);
    expect([...adapter.files.keys()].some((p) => p.endsWith('.tmp'))).toBe(false);
    const back = await readOcr(app, 'b1');
    expect(back?.pages['1']?.lines[0]?.text).toBe('甲');
    expect(back?.bookId).toBe('b1');
  });

  it('平台不支持 rename 也能落盘', async () => {
    const adapter = new FakeAdapter({ renameAlwaysFails: true });
    const app = appOf(adapter);
    expect(await writeOcr(app, withOcrPage(null, 'b2', 1, pageOf('甲')))).toBe(true);
    expect((await readOcr(app, 'b2'))?.pages['1']?.lines[0]?.text).toBe('甲');
  });

  it('坏 JSON 读回 null，不抛错', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(ocrPath('b3'), '{ 半截');
    const app = appOf(adapter);
    expect(await readOcr(app, 'b3')).toBeNull();
  });

  it('没有文件 / 没有 adapter 都返回 null', async () => {
    const adapter = new FakeAdapter();
    const app = appOf(adapter);
    expect(await readOcr(app, 'nope')).toBeNull();
    expect(await readOcr(null, 'nope')).toBeNull();
  });

  it('删除：删掉之后读回 null', async () => {
    const adapter = new FakeAdapter();
    const app = appOf(adapter);
    await writeOcr(app, withOcrPage(null, 'b4', 1, pageOf('甲')));
    expect(await removeOcr(app, 'b4')).toBe(true);
    expect(await readOcr(app, 'b4')).toBeNull();
    expect(await removeOcr(app, 'b4')).toBe(false);
  });
});

describe('文件头', () => {
  it('空壳默认引擎与模型是空的、没有页', () => {
    const file: OcrFile = emptyOcrFile('b9');
    expect(file.version).toBe(1);
    expect(file.bookId).toBe('b9');
    expect(file.pages).toEqual({});
    expect(file.engine).toBe('manual');
  });
});
