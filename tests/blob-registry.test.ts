import { describe, expect, it } from 'vitest';
import { MAX_BLOB_BYTES, keepBlob, pruneBlobs, totalBytesOf, type KeptBlob } from '../src/engine/blob-registry';

/** node 里没有 Blob，造一个只有 size 的替身（注册表只读 size） */
function fakeBlob(size: number): Blob {
  return { size } as unknown as Blob;
}

function reg(): Map<string, KeptBlob> {
  return new Map<string, KeptBlob>();
}

describe('blob 注册表按字节淘汰（P2-22）', () => {
  it('总量按字节累加，不是按条数', () => {
    const m = reg();
    keepBlob(m, 'blob:a', fakeBlob(1000), 1);
    keepBlob(m, 'blob:b', fakeBlob(2000), 2);
    expect(totalBytesOf(m)).toBe(3000);
    expect(m.size).toBe(2);
  });

  it('超过上限时先扔已 revoke 的最旧条目', () => {
    const m = reg();
    keepBlob(m, 'blob:old', fakeBlob(60), 1);
    keepBlob(m, 'blob:mid', fakeBlob(60), 2);
    keepBlob(m, 'blob:new', fakeBlob(60), 3);
    m.get('blob:old')!.revoked = true;
    m.get('blob:mid')!.revoked = true;

    pruneBlobs(m, 60);
    expect([...m.keys()]).toEqual(['blob:new']);
  });

  it('没有已 revoke 的条目时扔最旧的活条目', () => {
    const m = reg();
    keepBlob(m, 'blob:1', fakeBlob(50), 1);
    keepBlob(m, 'blob:2', fakeBlob(50), 2);
    keepBlob(m, 'blob:3', fakeBlob(50), 3);
    pruneBlobs(m, 50);
    expect([...m.keys()]).toEqual(['blob:3']);
  });

  it('至少留一条：正在渲染的那一章不能被扔光', () => {
    const m = reg();
    keepBlob(m, 'blob:huge', fakeBlob(10 * 1024 * 1024), 1);
    pruneBlobs(m, 1024);
    expect(m.size).toBe(1);
    expect(m.has('blob:huge')).toBe(true);
  });

  it('同一个 URL 重建时不重复计费', () => {
    const m = reg();
    keepBlob(m, 'blob:x', fakeBlob(100), 1);
    keepBlob(m, 'blob:x', fakeBlob(200), 2);
    expect(m.size).toBe(1);
    expect(totalBytesOf(m)).toBe(200);
  });

  it('默认上限是 64MB', () => {
    expect(MAX_BLOB_BYTES).toBe(64 * 1024 * 1024);
  });

  it('淘汰数量有返回值，方便日志', () => {
    const m = reg();
    keepBlob(m, 'blob:a', fakeBlob(80), 1);
    keepBlob(m, 'blob:b', fakeBlob(80), 2);
    expect(pruneBlobs(m, 100)).toBe(1);
  });
});
