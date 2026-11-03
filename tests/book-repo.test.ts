import { describe, expect, it } from 'vitest';
import { BookRepo, makeBook, planRelocations, type ScannedFile } from '../src/data/book-repo';

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
