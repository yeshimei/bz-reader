/* ============================================================
 * bz-reader · 数据落盘（data/store.ts）
 *
 * 单一 JSON：`<数据目录>/bz-reader.json`，数据目录默认 `bz 阅读/`
 * （库根目录，用户可在设置里改，见 core/plugin-path.ts）。
 *
 * 两条设计约束：
 *  1. **原子写**：先写 `.tmp` → `rename` 覆盖。直接 `adapter.write` 是
 *     「打开正本、截断、写入」，中间任何一拍出事（崩溃 / 盘满 / 杀软锁文件）
 *     磁盘上就留半截 JSON，下次启动整个书架读不出来。rename 要么旧要么新。
 *  2. **写盘防抖**：翻页会改 percent，每页都落盘等于每翻一页一次 IO。
 *     500ms 合并，外加 unload 时强制 flush。
 * ============================================================ */
import type { App } from 'obsidian';
import { notify } from '../core/notice';
import { pluginVaultPath, storageDirOf } from '../core/plugin-path';
import { copyTree } from './migrate';
import { EMPTY_DATA, type ReaderData } from './schema';

const DATA_FILE = 'bz-reader.json';
const TMP_SUFFIX = '.tmp';
const SAVE_DEBOUNCE_MS = 500;

/** 极简结构校验：读出来的东西至少得像个 ReaderData，否则按空库处理（别让坏文件把插件拖死） */
function looksValid(v: unknown): v is ReaderData {
  const d = v as ReaderData;
  return !!d && typeof d === 'object' && Array.isArray((d as ReaderData).books);
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

  /** 读盘。文件不存在 / 坏形 / 读失败 → 空库（不抛，插件要能起来） */
  async load(): Promise<ReaderData> {
    const adapter = this.app.vault.adapter;
    const file = this.filePath();
    await adapter.mkdir(storageDirOf(this.app)).catch(() => undefined);

    let text: string | null = null;
    try {
      text = await adapter.read(file);
    } catch (e) {
      // 「不存在」是首次安装的正常态，顺带看看是不是从老版本升上来的
      if (!isMissing(e)) console.warn('[bz-reader] 读取数据失败：', (e as Error)?.message || e);
      if (await this.adoptLegacy()) {
        text = await adapter.read(file).catch(() => null);
      }
    }

    if (text !== null) {
      try {
        const parsed = JSON.parse(text);
        if (!looksValid(parsed)) throw new Error('数据结构不符');
        this.data = parsed;
        return this.data;
      } catch (e) {
        console.warn('[bz-reader] 数据文件坏形，按空库启动：', (e as Error)?.message || e);
      }
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

  /** 立即落盘（unload / 关书时调）。串行化，避免两次写交叉。 */
  flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return this.writing;
    this.dirty = false;
    this.writing = this.writing.then(() => this.writeOnce());
    return this.writing;
  }

  private async writeOnce(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const text = JSON.stringify(this.data);
    const tmp = this.tmpPath();
    const target = this.filePath();
    try {
      await adapter.mkdir(storageDirOf(this.app)).catch(() => undefined);
      await adapter.write(tmp, text);
      try {
        await adapter.rename(tmp, target);
      } catch {
        // 某些平台 rename 不覆盖目标：先删再改名（窗口极短，且 tmp 已完整）
        await adapter.remove(target).catch(() => undefined);
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
    await this.flush();
  }
}
