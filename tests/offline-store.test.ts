/* ============================================================
 * bz-reader · 离线包读写（tests/offline-store.test.ts）
 *
 * 用内存假文件系统跑完整条链路：写清单 → 写音频 → 扫描 → 读音频 → 删包。
 * 真 Obsidian 的 adapter 只是这几个动作的薄壳，规则在这一层就能验完。
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  chapterPath,
  deletePack,
  findPack,
  manifestPath,
  packBytes,
  readChapter,
  readManifest,
  readManifestState,
  scanPacks,
  writeChapter,
  writeManifest,
  type PackFS,
} from '../src/data/offline-store';
import {
  OFFLINE_ROOT,
  chapterFile,
  packagePath,
  type OfflineBook,
  type OfflineChapter,
} from '../src/core/offline-pack';
import { buildChapter, emptyBook, upsertChapter } from '../src/core/offline-build';

class MemFS implements PackFS {
  files = new Map<string, ArrayBuffer>();
  dirs = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const at = path.lastIndexOf('/');
    if (at > 0) this.dirs.add(path.slice(0, at));
    this.files.set(path, data);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const data = this.files.get(path);
    if (!data) throw new Error(`ENOENT ${path}`);
    return data;
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  }

  async list(path: string): Promise<{ folders: string[]; files: string[] }> {
    const prefix = `${path}/`;
    const folders = new Set<string>();
    const files: string[] = [];
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash >= 0) folders.add(prefix + rest.slice(0, slash));
      else files.push(key);
    }
    return { folders: [...folders], files };
  }

  /** 和 Obsidian 一样：只删单个文件，对目录无效 */
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  /** 同目录内改名；目标已存在时覆盖——写清单靠它做原子替换 */
  async rename(from: string, to: string): Promise<void> {
    const data = this.files.get(from);
    if (!data) throw new Error(`ENOENT ${from}`);
    this.files.delete(from);
    this.files.set(to, data);
  }

  /** 和 Obsidian 一样：非空目录必须显式 recursive，否则当失败 */
  async rmdir(path: string, recursive = false): Promise<void> {
    const kids = [...this.files.keys()].filter((k) => k.startsWith(`${path}/`));
    const sub = [...this.dirs].filter((d) => d.startsWith(`${path}/`));
    if (!recursive && (kids.length || sub.length)) throw new Error(`dir not empty: ${path}`);
    for (const key of kids) this.files.delete(key);
    for (const dir of sub) this.dirs.delete(dir);
    this.dirs.delete(path);
  }
}

const FRAME = Uint8Array.from([0xff, 0xfb, 0x50, 0xc0]);

function mp3(frames: number): ArrayBuffer {
  const out = new Uint8Array(frames * 208);
  for (let i = 0; i < frames; i++) out.set(FRAME, i * 208);
  return out.buffer;
}

function builtBook(title = '围城'): { book: OfflineBook; data: ArrayBuffer; chapter: OfflineChapter } {
  const built = buildChapter({ title: '第一章', texts: ['甲', '乙'], parts: [mp3(10), mp3(10)], format: 'mp3' })!;
  const book = upsertChapter(emptyBook({ title, bookId: 'b1', engine: 'local', voice: '中文女' }), built.chapter);
  return { book, data: built.data as ArrayBuffer, chapter: built.chapter };
}

/** 写出一份完整包（清单 + 一章音频） */
async function seed(fs: MemFS, title = '围城'): Promise<{ book: OfflineBook; chapter: OfflineChapter }> {
  const { book, data, chapter } = builtBook(title);
  await writeChapter(fs, title, chapter, data);
  await writeManifest(fs, book);
  return { book, chapter };
}

describe('路径：清洗后撞名', () => {
  it('两个书名只差一个非法字符，落在两个目录里', () => {
    expect(packagePath('三体2：黑暗森林')).not.toBe(packagePath('三体2?黑暗森林'));
  });

  it('两个章名只差一个非法字符，写进两个文件', () => {
    expect(chapterFile('第1章：起', 'mp3')).not.toBe(chapterFile('第1章?起', 'mp3'));
  });
});

describe('写清单（原子替换）', () => {
  it('写完不留 .tmp，正本能读回来', async () => {
    const fs = new MemFS();
    const { book } = await seed(fs);
    const path = manifestPath('围城');
    expect(fs.files.has(`${path}.tmp`)).toBe(false);
    expect(await readManifest(fs, '围城')).toEqual(book);
  });

  it('替换失败时正本一个字节都不动，.tmp 也不留', async () => {
    const fs = new MemFS();
    const { book } = await seed(fs);
    const before = await readManifest(fs, '围城');
    fs.rename = async () => {
      throw new Error('EPERM');
    };
    const bigger: OfflineBook = { ...book, chapters: [...book.chapters, ...book.chapters] };
    await expect(writeManifest(fs, bigger)).rejects.toThrow();
    expect(await readManifest(fs, '围城')).toEqual(before);
    expect(fs.files.has(`${manifestPath('围城')}.tmp`)).toBe(false);
  });

  it('半截 JSON 报 broken，不混成「没有清单」', async () => {
    const fs = new MemFS();
    await seed(fs);
    fs.files.set(manifestPath('围城'), new TextEncoder().encode('{"title":"围城"').buffer);
    expect((await readManifestState(fs, '围城')).state).toBe('broken');
    expect(await readManifest(fs, '围城')).toBeNull();
  });
});

describe('路径', () => {
  it('清单在包目录下，章音频也在同一个目录', () => {
    const dir = packagePath('围城');
    expect(manifestPath('围城')).toBe(`${dir}/manifest.json`);
    expect(chapterPath('围城', '第一章.mp3')).toBe(`${dir}/第一章.mp3`);
  });

  it('书名里的非法字符被清掉，目录名另带防撞后缀', () => {
    expect(packagePath('围城/上').startsWith(`${OFFLINE_ROOT}/围城_上-`)).toBe(true);
  });
});

describe('写清单', () => {
  it('写完能原样读回来', async () => {
    const fs = new MemFS();
    const { book } = await seed(fs);
    const back = await readManifest(fs, '围城');
    expect(back?.title).toBe(book.title);
    expect(back?.chapters[0].marks).toEqual(book.chapters[0].marks);
  });

  it('没有清单给 null', async () => {
    expect(await readManifest(new MemFS(), '不存在')).toBeNull();
  });

  it('清单坏掉给 null，不抛', async () => {
    const fs = new MemFS();
    await fs.writeBinary(manifestPath('围城'), new TextEncoder().encode('{不是 json').buffer as ArrayBuffer);
    expect(await readManifest(fs, '围城')).toBeNull();
  });
});

describe('写音频', () => {
  it('返回库内路径，字节原样落盘', async () => {
    const fs = new MemFS();
    const { data, chapter } = builtBook();
    const path = await writeChapter(fs, '围城', chapter, data);
    expect(path).toBe(chapterPath('围城', chapter.file));
    expect((await fs.readBinary(path)).byteLength).toBe(data.byteLength);
  });

  it('读回一章音频', async () => {
    const fs = new MemFS();
    const { chapter } = await seed(fs);
    const data = await readChapter(fs, '围城', chapter);
    expect(data?.byteLength).toBe(chapter.bytes);
  });

  it('文件被单独删掉时给 null（用户只拷了清单）', async () => {
    const fs = new MemFS();
    const { chapter } = await seed(fs);
    await fs.remove(chapterPath('围城', chapter.file));
    expect(await readChapter(fs, '围城', chapter)).toBeNull();
  });
});

describe('扫描', () => {
  it('扫出一本，书名取自目录', async () => {
    const fs = new MemFS();
    await seed(fs);
    const packs = await scanPacks(fs);
    expect(packs.map((p) => p.ref.title)).toEqual(['围城']);
    expect(packs[0].book.chapters).toHaveLength(1);
  });

  it('根目录不存在时给空数组', async () => {
    expect(await scanPacks(new MemFS())).toEqual([]);
  });

  it('目录里混着别的东西（截图、坏了的一半）不报错，只跳过', async () => {
    const fs = new MemFS();
    await seed(fs);
    await fs.mkdir(`${OFFLINE_ROOT}/随手放的`);
    await fs.writeBinary(`${OFFLINE_ROOT}/随手放的/封面.png`, new Uint8Array([1]).buffer as ArrayBuffer);
    await fs.writeBinary(`${OFFLINE_ROOT}/半途而废/manifest.json`, new TextEncoder().encode('{}').buffer as ArrayBuffer);
    const packs = await scanPacks(fs);
    expect(packs.map((p) => p.ref.title)).toEqual(['围城']);
  });
});

describe('找这本书的包', () => {
  it('先按书名找', async () => {
    const fs = new MemFS();
    await seed(fs);
    const hit = await findPack(fs, { title: '围城' });
    expect(hit?.book.title).toBe('围城');
  });

  it('书名对不上时按 bookId 兜底（用户改过书名）', async () => {
    const fs = new MemFS();
    await seed(fs);
    const hit = await findPack(fs, { title: '围城（新版）', bookId: 'b1' });
    expect(hit?.book.title).toBe('围城');
  });

  it('两条都不中就是没有', async () => {
    const fs = new MemFS();
    await seed(fs);
    expect(await findPack(fs, { title: '别的书', bookId: 'zzz' })).toBeNull();
  });
});

describe('删包与体积', () => {
  it('删掉整本：清单与音频一起没', async () => {
    const fs = new MemFS();
    const { chapter } = await seed(fs);
    await deletePack(fs, '围城');
    expect(await readManifest(fs, '围城')).toBeNull();
    expect(await fs.exists(chapterPath('围城', chapter.file))).toBe(false);
  });

  /* 真机踩过：`adapter.remove` 对目录无效，点了清理、弹了提示、文件还在。
     所以 deletePack 必须走 rmdir(recursive)。 */
  it('删整本不能靠 remove：它对目录无效', async () => {
    const fs = new MemFS();
    const { chapter } = await seed(fs);
    await fs.remove(`${OFFLINE_ROOT}/围城`);
    expect(await fs.exists(chapterPath('围城', chapter.file))).toBe(true);
    await deletePack(fs, '围城');
    expect(await fs.exists(chapterPath('围城', chapter.file))).toBe(false);
    expect(await fs.exists(`${OFFLINE_ROOT}/围城`)).toBe(false);
  });

  it('删不存在的包不报错', async () => {
    await expect(deletePack(new MemFS(), '没有这本')).resolves.toBeUndefined();
  });

  it('体积按清单里记的字节数累加', async () => {
    const { book } = await seed(new MemFS());
    expect(packBytes(book)).toBe(208 * 20);
  });
});
