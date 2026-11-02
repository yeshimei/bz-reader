/* ============================================================
 * bz-reader · 数据落盘（data/store.ts）
 *
 * 单一 JSON：`<插件目录>/storage/bz-reader.json`。
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
import { EMPTY_DATA, type ReaderData } from './schema';

const DATA_FILE = 'bz-reader.json';
const TMP_SUFFIX = '.tmp';
const SAVE_DEBOUNCE_MS = 500;

/** 极简结构校验：读出来的东西至少得像个 ReaderData，否则按空库处理（别让坏文件把插件拖死） */
function looksValid(v: unknown): v is ReaderData {
  const d = v as ReaderData;
  return !!d && typeof d === 'object' && Array.isArray((d as ReaderData).books);
}

export class ReaderStore {
  private data: ReaderData = EMPTY_DATA;
  private timer: number | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private app: App) {}

  private filePath(): string {
    return pluginVaultPath(this.app, `storage/${DATA_FILE}`);
  }

  private tmpPath(): string {
    return `${this.filePath()}${TMP_SUFFIX}`;
  }

  /** 读盘。文件不存在 / 坏形 / 读失败 → 空库（不抛，插件要能起来） */
  async load(): Promise<ReaderData> {
    const adapter = this.app.vault.adapter;
    try {
      await adapter.mkdir(storageDirOf(this.app)).catch(() => undefined);
      const text = await adapter.read(this.filePath());
      const parsed = JSON.parse(text);
      if (!looksValid(parsed)) throw new Error('数据结构不符');
      this.data = parsed;
    } catch (e) {
      const msg = (e as Error)?.message || '';
      // 「不存在」是首次安装的正常态，不打扰用户
      if (!/not exist|ENOENT|no such file/i.test(msg)) {
        console.warn('[bz-reader] 读取数据失败，按空库启动：', msg);
      }
      this.data = { ...EMPTY_DATA, books: [] };
    }
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
