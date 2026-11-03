/* ============================================================
 * bz-reader · 数据落盘（data/store.ts）
 *
 * 单一 JSON：`<数据目录>/bz-reader.json`，数据目录默认 `bz 阅读/`
 * （库根目录，用户可在设置里改，见 core/plugin-path.ts）。
 *
 * 三条设计约束：
 *  1. **原子写**：先写 `.tmp` → `rename` 覆盖。直接 `adapter.write` 是
 *     「打开正本、截断、写入」，中间任何一拍出事（崩溃 / 盘满 / 杀软锁文件）
 *     磁盘上就留半截 JSON，下次启动整个书架读不出来。rename 要么旧要么新。
 *  2. **失败可恢复**：rename 不覆盖目标的平台（部分移动端）退回「正本 → .bak，
 *     再改名 tmp」。任何一步失败都还剩一份完整文件，绝不像以前那样先删正本。
 *  3. **写盘防抖**：翻页会改 percent，每页都落盘等于每翻一页一次 IO。
 *     500ms 合并，外加 unload / 关书时 `flush(true)` 强制写。
 * ============================================================ */
import type { App } from 'obsidian';
import { notify } from '../core/notice';
import { pluginVaultPath, storageDirOf } from '../core/plugin-path';
import { copyTree } from './migrate';
import { EMPTY_DATA, emptyReading, type ReaderBook, type ReaderData } from './schema';

const DATA_FILE = 'bz-reader.json';
const TMP_SUFFIX = '.tmp';
const BAK_SUFFIX = '.bak';
const SAVE_DEBOUNCE_MS = 500;

/** 时间戳后缀，坏文件与备份文件名用 */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * 结构校验 + 补缺省。
 *
 * 只检查 `books` 是数组是不够的：`{"books":[{"id":"x"}]}` 这种半截记录会被
 * 原样收下，随后统计页读 `reading.sessions`、书架读 `reading.stats` 全部
 * TypeError，整页空白。这里逐本补齐，补不出来的（没有 id / 没有路径）丢掉。
 */
export function sanitizeData(v: unknown): ReaderData | null {
  const d = v as Partial<ReaderData> | null;
  if (!d || typeof d !== 'object' || !Array.isArray(d.books)) return null;
  const now = Date.now();
  const books: ReaderBook[] = [];
  for (const raw of d.books) {
    const b = raw as Partial<ReaderBook> | null;
    if (!b || typeof b !== 'object') continue;
    if (typeof b.id !== 'string' || !b.id) continue;
    const ref = b.fileRef as ReaderBook['fileRef'] | undefined;
    if (!ref || typeof ref.vaultPath !== 'string' || !ref.vaultPath) continue;
    const base = emptyReading();
    const reading = (b.reading ?? {}) as Partial<ReaderBook['reading']>;
    const notes = (b.notes ?? {}) as Partial<ReaderBook['notes']>;
    books.push({
      id: b.id,
      meta: {
        ...(b.meta && typeof b.meta === 'object' ? b.meta : {}),
        title: String(b.meta?.title ?? ''),
      },
      fileRef: { ...ref },
      reading: {
        position: { ...base.position, ...(reading.position ?? {}) },
        stats: { ...base.stats, ...(reading.stats ?? {}) },
        /* 反复强调过的口径：sessions[].start 缺失/≤0 的条目连 bz 都会丢，
           这里先丢，免得它进统计 */
        sessions: Array.isArray(reading.sessions)
          ? reading.sessions.filter((s) => !!s && typeof s.start === 'number' && s.start > 0)
          : [],
      },
      notes: {
        highlights: Array.isArray(notes.highlights) ? notes.highlights : [],
        excerpts: Array.isArray(notes.excerpts) ? notes.excerpts : [],
        bookmarks: Array.isArray(notes.bookmarks) ? notes.bookmarks : [],
      },
      addedAt: typeof b.addedAt === 'number' ? b.addedAt : now,
      updatedAt: typeof b.updatedAt === 'number' ? b.updatedAt : now,
    });
  }
  return { ...(d as ReaderData), version: 1, books };
}

function isMissing(e: unknown): boolean {
  return /not exist|ENOENT|no such file/i.test((e as Error)?.message || '');
}

export class ReaderStore {
  private data: ReaderData = EMPTY_DATA;
  private timer: number | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private app: App) {}

  /** 数据目录变了以后文件路径跟着变，所以每次都现算，别缓存 */
  private filePath(): string {
    return `${storageDirOf(this.app)}/${DATA_FILE}`;
  }

  private tmpPath(): string {
    return `${this.filePath()}${TMP_SUFFIX}`;
  }

  /** 坏文件的留档路径：解析失败时把原文件挪到这里，绝不直接覆盖 */
  private brokenPath(): string {
    return `${storageDirOf(this.app)}/bz-reader.broken-${stamp()}.json`;
  }

  /** 老版本位置：`<插件目录>/storage/`。只在首次升级时读一次 */
  private legacyDir(): string {
    return pluginVaultPath(this.app, 'storage');
  }

  /**
   * 把老版本 `storage/` 里的数据搬到当前数据目录。
   *
   * 只在「新目录还没有 JSON」时执行，所以最多跑一次；失败了也不抛，
   * 上层按空库启动，用户至少还能用插件。
   */
  private async adoptLegacy(): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    const legacy = this.legacyDir();
    if (legacy === storageDirOf(this.app)) return false;
    try {
      await adapter.stat(`${legacy}/${DATA_FILE}`);
    } catch {
      return false; // 老目录也没有，就是全新用户
    }
    const res = await copyTree(this.app, legacy, storageDirOf(this.app));
    if (res.failed.length) {
      console.warn('[bz-reader] 老数据搬迁未完成，已跳过：', res.failed.slice(0, 3));
      return false;
    }
    console.info(`[bz-reader] 已把老数据搬到 ${storageDirOf(this.app)}/（${res.files} 个文件）`);
    return true;
  }

  /**
   * 上次写到一半留下的 `.tmp`：它比空库更接近真相。
   * 只在正本缺失时用，读得出来就顺势改名成正本。
   */
  private async recoverTmp(): Promise<ReaderData | null> {
    const adapter = this.app.vault.adapter;
    const tmp = this.tmpPath();
    try {
      if (!(await adapter.exists(tmp))) return null;
      const clean = sanitizeData(JSON.parse(await adapter.read(tmp)));
      if (!clean) return null;
      await adapter.rename(tmp, this.filePath()).catch(() => undefined);
      console.info('[bz-reader] 已从 .tmp 恢复数据文件');
      this.dirty = true;
      return clean;
    } catch {
      return null;
    }
  }

  /** 坏 JSON 留档：原文件改名保留，下一次写盘才不会把它覆盖掉 */
  private async quarantine(): Promise<void> {
    try {
      await this.app.vault.adapter.rename(this.filePath(), this.brokenPath());
      notify('数据文件读不出来，已留档为 bz-reader.broken-*.json', 'error');
    } catch {
      /* 留档失败就算了，至少不要因此阻断启动 */
    }
  }

  /** 读盘。文件不存在 / 坏形 / 读失败 → 空库（不抛，插件要能起来） */
  async load(): Promise<ReaderData> {
    const adapter = this.app.vault.adapter;
    const file = this.filePath();
    await adapter.mkdir(storageDirOf(this.app)).catch(() => undefined);

    let text: string | null = null;
    let missing = false;
    try {
      text = await adapter.read(file);
    } catch (e) {
      // 「不存在」是首次安装的正常态，顺带看看是不是从老版本升上来的
      if (!isMissing(e)) console.warn('[bz-reader] 读取数据失败：', (e as Error)?.message || e);
      missing = true;
      if (await this.adoptLegacy()) {
        text = await adapter.read(file).catch(() => null);
      }
    }

    if (text === null && missing) {
      const recovered = await this.recoverTmp();
      if (recovered) {
        this.data = recovered;
        return this.data;
      }
    }

    if (text !== null) {
      let parsed: unknown;
      let ok = false;
      try {
        parsed = JSON.parse(text);
        ok = true;
      } catch (e) {
        console.warn('[bz-reader] 数据文件不是合法 JSON：', (e as Error)?.message || e);
      }
      const clean = ok ? sanitizeData(parsed) : null;
      if (clean) {
        this.data = clean;
        return this.data;
      }
      console.warn('[bz-reader] 数据文件结构不符，按空库启动；原文件已留档');
      await this.quarantine();
    }

    this.data = { ...EMPTY_DATA, books: [] };
    return this.data;
  }

  get(): ReaderData {
    return this.data;
  }

  /** 就地修改 + 排一次落盘（调用方直接改 data 对象也行，改完调 touch） */
  touch(): void {
    this.dirty = true;
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * 立即落盘（unload / 关书时调）。串行化，避免两次写交叉。
   *
   * `force`：调用方刚刚在内存里加了东西但没 touch（例如 settle() 追加阅读
   * 会话）时用。以前一律 `!dirty` 早退，最后一段会话就永远写不下去。
   */
  flush(force = false): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty && !force) return this.writing;
    this.dirty = false;
    this.writing = this.writing.then(() => this.writeOnce()).catch(() => {});
    return this.writing;
  }

  private async writeOnce(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const tmp = this.tmpPath();
    const target = this.filePath();
    try {
      const text = JSON.stringify(this.data);
      await adapter.mkdir(storageDirOf(this.app)).catch(() => undefined);
      await adapter.write(tmp, text);
      try {
        await adapter.rename(tmp, target);
      } catch {
        /* 某些平台 rename 不覆盖目标。**先备份正本，不删**：
           以前是 remove(target) 再改名，第二次失败就只剩 tmp；而 load()
           不认 tmp，用户看到的就是空书架。 */
        await adapter.rename(target, `${target}${BAK_SUFFIX}`).catch(() => undefined);
        await adapter.rename(tmp, target);
      }
    } catch (e) {
      this.dirty = true; // 没写成就别丢标记，下次还会试
      notify('保存阅读数据失败，请检查磁盘空间', 'error');
      console.warn('[bz-reader] 写盘失败：', (e as Error)?.message || e);
    }
  }

  /** 卸载收口：清定时器 + 强制写 */
  async destroy(): Promise<void> {
    await this.flush(true);
  }
}

