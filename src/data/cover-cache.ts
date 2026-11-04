/* ============================================================
 * bz-reader · 封面缓存的两块纯逻辑（data/cover-cache.ts）
 *
 * 与 cover.ts 分开：那边一 import 就会拉 engine/foliate（整个 vendor
 * 运行时），node 测试里跑不起来。这里只放两件可独立验证的事：
 *
 *  1. 内存 LRU：objectURL 不释放会一直占着整张图的解码内存。书架翻久了
 *     几十本封面全在 Map 里只增不减，所以要有上限，淘汰时 revoke。
 *  2. 失败负缓存：一本书取不出封面（坏 EPUB、无封面、40MB 以上的漫画）
 *     时，书架每次重绘都重新 readBinary + 解 zip 是纯浪费。记住失败时
 *     书的 size/mtime，只有它变了（文件被替换）才值得再试一次。
 * ============================================================ */

/** 内存里最多留多少张封面。手机上每张解出来的图约 1~3MB，60 张是安全线 */
export const COVER_MEM_LIMIT = 60;

export type RevokeUrl = (url: string) => void;

function revokeObjectUrl(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* 已经释放过，或环境不支持 objectURL */
  }
}

/** 有上限的 Map：get 也算「用过」，淘汰最久未用的那条 */
export class CoverMemory {
  private readonly urls = new Map<string, string>();

  constructor(
    private readonly limit = COVER_MEM_LIMIT,
    private readonly revoke: RevokeUrl = revokeObjectUrl,
  ) {}

  get size(): number {
    return this.urls.size;
  }

  get(id: string): string | undefined {
    const url = this.urls.get(id);
    if (url === undefined) return undefined;
    // 重新插入到队尾 = 最近使用
    this.urls.delete(id);
    this.urls.set(id, url);
    return url;
  }

  set(id: string, url: string): void {
    const prev = this.urls.get(id);
    if (prev !== undefined && prev !== url) this.revoke(prev);
    this.urls.delete(id);
    this.urls.set(id, url);
    while (this.urls.size > this.limit) {
      /* `keys().next()` 的 `value` 在 lib 的类型里是 any：先看 `done`，
         再取 key，TS 才收窄成 string。 */
      const oldest = this.urls.keys().next();
      if (oldest.done) break;
      const old = this.urls.get(oldest.value);
      this.urls.delete(oldest.value);
      if (old) this.revoke(old);
    }
  }

  clear(): void {
    for (const url of this.urls.values()) this.revoke(url);
    this.urls.clear();
  }
}

export interface CoverFailureMark {
  size: number;
  mtime: number;
}

/**
 * 失败记录：key 用 `keyOf(book)`（bookId + size），值里再记一次源文件
 * 的 size/mtime。key 里已经含 size，这里记 size 是为了拿 stat 的实际值
 * 对齐——书被替换成同名不同版本时 key 和 stat 都会变。
 */
export class CoverFailureCache {
  private readonly marks = new Map<string, CoverFailureMark>();

  markOf(key: string): CoverFailureMark | undefined {
    return this.marks.get(key);
  }

  blocked(key: string, size: number, mtime: number): boolean {
    const mark = this.marks.get(key);
    return !!mark && mark.size === size && mark.mtime === mtime;
  }

  remember(key: string, size: number, mtime: number): void {
    this.marks.set(key, { size, mtime });
  }

  forget(key: string): void {
    this.marks.delete(key);
  }

  clear(): void {
    this.marks.clear();
  }
}
