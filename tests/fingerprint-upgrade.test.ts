import { describe, expect, it } from 'vitest';
import { upgradeFingerprints } from '../src/data/book-scan';
import { makeBook } from '../src/data/book-repo';
import { fingerprintOf } from '../src/data/fingerprint';
import type { App } from 'obsidian';

/** 用 adapter.readBinary 的假 App：按路径返回字节，没登记就抛（模拟文件丢了） */
function fakeApp(files: Record<string, Uint8Array>): App {
  return {
    vault: {
      adapter: {
        readBinary: async (path: string) => {
          const bytes = files[path];
          if (!bytes) throw new Error('not found');
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      },
    },
  } as unknown as App;
}

describe('v1 → v2 指纹后台升级', () => {
  it('v1 和缺失指纹的书都重算成 v2，成功才替换', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const v2 = await fingerprintOf(bytes);
    const old = makeBook('书/a.epub', 'epub', 4, 'v1-0123456789abcdef01234567');
    const missing = makeBook('书/b.epub', 'epub', 4);
    const app = fakeApp({ '书/a.epub': bytes, '书/b.epub': bytes });

    const changed = await upgradeFingerprints(app, [old, missing]);

    expect(changed).toBe(2);
    expect(old.fileRef.fingerprint).toBe(v2);
    expect(missing.fileRef.fingerprint).toBe(v2);
  });

  it('已是 v2 的书跳过，指纹原样不动、不计入改动', async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const v2 = await fingerprintOf(bytes);
    const cur = makeBook('书/c.epub', 'epub', 3, v2!);
    const app = fakeApp({ '书/c.epub': bytes });

    const changed = await upgradeFingerprints(app, [cur]);

    expect(changed).toBe(0);
    expect(cur.fileRef.fingerprint).toBe(v2);
  });

  it('文件读不到（删了/剪藏虚拟书）保留旧值，不计入改动，下次还能再试', async () => {
    const old = makeBook('书/gone.epub', 'epub', 4, 'v1-0123456789abcdef01234567');
    const app = fakeApp({}); // 没有任何文件

    const changed = await upgradeFingerprints(app, [old]);

    expect(changed).toBe(0);
    expect(old.fileRef.fingerprint).toBe('v1-0123456789abcdef01234567');
  });

  it('前一本读失败不影响后一本：能升级的照常升级', async () => {
    const bytes = new Uint8Array([7, 7]);
    const v2 = await fingerprintOf(bytes);
    const missing1 = makeBook('书/no.epub', 'epub', 2);
    const ok = makeBook('书/yes.epub', 'epub', 2);
    const app = fakeApp({ '书/yes.epub': bytes });

    const changed = await upgradeFingerprints(app, [missing1, ok]);

    expect(changed).toBe(1);
    expect(missing1.fileRef.fingerprint).toBeUndefined();
    expect(ok.fileRef.fingerprint).toBe(v2);
  });

  it('传旧的并发参数也照常把整批升级完（参数已废弃，不影响结果）', async () => {
    const bytes = new Uint8Array([5]);
    const v2 = await fingerprintOf(bytes);
    const app = fakeApp(Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`书/${i}.epub`, bytes]),
    ));
    const books = Array.from({ length: 5 }, (_, i) => makeBook(`书/${i}.epub`, 'epub', 1));

    const changed = await upgradeFingerprints(app, books, 10);

    expect(changed).toBe(5);
    expect(books.every((b) => b.fileRef.fingerprint === v2)).toBe(true);
  });

  it('归档书不参与升级：换版本后归档旧书与在架新书同路径，旧书指纹留原值', async () => {
    const newContent = new Uint8Array([7, 7, 7]);
    const archivedOld = makeBook('书/a.epub', 'epub', 3, 'v1-old');
    archivedOld.archivedAt = Date.now();
    const app = fakeApp({ '书/a.epub': newContent });

    const changed = await upgradeFingerprints(app, [archivedOld]);

    expect(changed).toBe(0);
    expect(archivedOld.fileRef.fingerprint).toBe('v1-old');
  });
});
