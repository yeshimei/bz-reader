import { describe, expect, it } from 'vitest';
import { BookRepo, bookNeedsRelocate, makeBook, planRelocations, type ScannedFile } from '../src/data/book-repo';
import { makeClipBookRecord } from '../src/data/clip-book-entry';

function book(path: string, size: number, format: 'epub' | 'txt' = 'epub') {
  const b = makeBook(path, format, size);
  b.reading.position.percent = 0.42;
  return b;
}

const scan = (path: string, size: number, format: 'epub' | 'txt' = 'epub'): ScannedFile => ({ path, size, format });

describe('planRelocations（改名/移动识别）', () => {
  it('同格式 + 同字节数 + 旧路径消失 → 认成同一本书，保留 id', () => {
    const old = book('书/三体.epub', 1024);
    const moves = planRelocations([old], [scan('书/三体（全三册）.epub', 1024)]);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.book.id).toBe(old.id);
    expect(moves[0]!.to).toBe('书/三体（全三册）.epub');
  });

  it('大小不同不认（避免把另一本书的笔记接过来）', () => {
    const old = book('书/a.epub', 1024);
    expect(planRelocations([old], [scan('书/b.epub', 2048)])).toEqual([]);
  });

  it('格式不同不认', () => {
    const old = book('书/a.epub', 1024, 'epub');
    expect(planRelocations([old], [scan('书/b.txt', 1024, 'txt')])).toEqual([]);
  });

  it('原地未动的书不会被误判成「移动」', () => {
    const old = book('书/a.epub', 1024);
    expect(planRelocations([old], [scan('书/a.epub', 1024)])).toEqual([]);
  });

  it('size 未知（0）不参与匹配', () => {
    const old = book('书/a.epub', 0);
    expect(planRelocations([old], [scan('书/b.epub', 0)])).toEqual([]);
  });

  it('两个同大小候选时一对一认领，不会两条都指到同一个文件', () => {
    const a = book('书/a.epub', 1024);
    const b = book('书/b.epub', 1024);
    const moves = planRelocations([a, b], [scan('书/c.epub', 1024), scan('书/d.epub', 1024)]);
    expect(moves).toHaveLength(2);
    expect(new Set(moves.map((m) => m.book.id)).size).toBe(2);
    expect(new Set(moves.map((m) => m.to)).size).toBe(2);
  });
});

describe('BookRepo 按内容指纹去重（同一份文件只登记一次）', () => {
  const fp = 'v1-0123456789ab';

  it('同一指纹换了路径：不新建记录，返回已有那本，并告知路径变了', () => {
    const repo = new BookRepo([]);
    const first = repo.ensure('书/a.epub', 'epub', 100, fp);
    const second = repo.ensure('书/a (2).epub', 'epub', 100, fp);
    expect(second.created).toBe(false);
    expect(second.book.id).toBe(first.book.id);
    expect(second.book.fileRef.vaultPath).toBe('书/a.epub');
    expect(second.pathChanged).toBe(true);
    expect(repo.all()).toHaveLength(1);
  });

  it('同一指纹同一路径：照常复用，不算路径变化', () => {
    const repo = new BookRepo([]);
    const first = repo.ensure('书/a.epub', 'epub', 100, fp);
    const again = repo.ensure('书/a.epub', 'epub', 120, fp);
    expect(again.created).toBe(false);
    expect(again.pathChanged).toBeFalsy();
    expect(again.book.id).toBe(first.book.id);
    expect(again.book.fileRef.size).toBe(120);
  });

  it('没有指纹时退回按路径去重（老行为不变）', () => {
    const repo = new BookRepo([]);
    const first = repo.ensure('书/a.epub', 'epub', 100);
    const again = repo.ensure('书/a.epub', 'epub', 100);
    expect(again.created).toBe(false);
    expect(again.book.id).toBe(first.book.id);
  });

  it('已有记录没有指纹时，下次登记补上，之后能按指纹查到', () => {
    const repo = new BookRepo([]);
    const b = repo.ensure('书/a.epub', 'epub', 100).book;
    repo.ensure('书/a.epub', 'epub', 100, fp);
    expect(b.fileRef.fingerprint).toBe(fp);
    expect(repo.byFingerprint(fp)?.id).toBe(b.id);
  });

  it('不同指纹、不同路径：各是各的记录（不同版本不合并）', () => {
    const repo = new BookRepo([]);
    repo.ensure('书/a.epub', 'epub', 100, 'v1-aaa');
    const second = repo.ensure('书/b.epub', 'epub', 100, 'v1-bbb');
    expect(second.created).toBe(true);
    expect(repo.all()).toHaveLength(2);
  });
});

describe('剪藏本（虚拟书）不参与失联判定', () => {
  /* 真机复现（2026-11-13 录屏库）：书架上点「剪藏本」弹「文件失联」。
     vaultPath 是空串，但 markMissing 拿空串去 existingPaths 里查永远是 false，
     于是整本书被画成失联角标；openBookById 的「文件在不在」同样把它拦进
     重新定位弹层。剪藏本本来就没有文件——这类检查必须整本跳过。 */
  const clip = () => makeClipBookRecord('剪藏本', 'bz');

  it('markMissing 跳过虚拟书，不给它打失联标', () => {
    const c = clip();
    const real = book('书/a.epub', 1024);
    const repo = new BookRepo([c, real]);
    repo.markMissing(new Set(['书/a.epub']));
    expect((c.fileRef as { fileMissing?: boolean }).fileMissing).toBeFalsy();
    expect((real.fileRef as { fileMissing?: boolean }).fileMissing).toBe(false);
  });

  it('真书文件真丢了，照旧标失联（别把整条判定弄哑）', () => {
    const gone = book('书/gone.epub', 1024);
    const repo = new BookRepo([gone]);
    repo.markMissing(new Set());
    expect((gone.fileRef as { fileMissing?: boolean }).fileMissing).toBe(true);
  });

  it('虚拟书上一轮残留的 fileMissing 会被清掉（升级上来的旧记录）', () => {
    const c = clip();
    (c.fileRef as { fileMissing?: boolean }).fileMissing = true;
    const repo = new BookRepo([c]);
    repo.markMissing(new Set());
    expect((c.fileRef as { fileMissing?: boolean }).fileMissing).toBe(false);
  });
});

describe('BookRepo.relocate', () => {
  it('只改路径：id / 进度 / 划线全部保留，fileMissing 清掉', () => {
    const b = book('书/旧名.epub', 1024);
    b.notes.highlights.push({ id: 'h1', text: '划线', createdAt: 1 });
    (b.fileRef as { fileMissing?: boolean }).fileMissing = true;
    const repo = new BookRepo([b]);
    repo.relocate(b, '书/新名.epub');
    expect(b.fileRef.vaultPath).toBe('书/新名.epub');
    expect((b.fileRef as { fileMissing?: boolean }).fileMissing).toBe(false);
    expect(b.id).toBe(book('书/旧名.epub', 1024).id);
    expect(b.reading.position.percent).toBe(0.42);
    expect(b.notes.highlights).toHaveLength(1);
  });
});

describe('bookNeedsRelocate（点开一本书之前要不要先送去重新定位）', () => {
  const exists = (p: string) => p === '书/a.epub';

  it('剪藏本没有文件，也必须能直接读（真机：书架上点它弹「文件失联」）', () => {
    const c = makeClipBookRecord('剪藏本', 'bz');
    expect(bookNeedsRelocate(c, exists)).toBe(false);
  });

  it('剪藏本即便残留了 fileMissing 也不拦（旧记录升级上来的）', () => {
    const c = makeClipBookRecord('剪藏本', 'bz');
    (c.fileRef as { fileMissing?: boolean }).fileMissing = true;
    expect(bookNeedsRelocate(c, exists)).toBe(false);
  });

  it('真书文件不见了 → 要重新定位', () => {
    const gone = book('书/gone.epub', 1024);
    expect(bookNeedsRelocate(gone, exists)).toBe(true);
  });

  it('真书被标过失联 → 即便文件这时又能访问也要先定位', () => {
    const b = book('书/a.epub', 1024);
    (b.fileRef as { fileMissing?: boolean }).fileMissing = true;
    expect(bookNeedsRelocate(b, exists)).toBe(true);
  });

  it('真书文件在、没被标失联 → 正常打开', () => {
    expect(bookNeedsRelocate(book('书/a.epub', 1024), exists)).toBe(false);
  });
});
