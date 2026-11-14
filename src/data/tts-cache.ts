/* ============================================================
 * bz-reader · 朗读音频缓存（data/tts-cache.ts）
 *
 * DeepSeek TTS 按字符计费，同一页翻回去再听一次也照收。缓存的是**合成
 * 结果**（wav 字节），不是文本：重听零成本，换音色才重新合成。
 *
 * 为什么不落库：音频不进 Obsidian 库（会被同步到手机、撑爆仓库），
 * 放 IndexedDB——浏览器自己的存储，Obsidian 不读它。
 *
 * 容量：wav 是 24kHz/16-bit 单声道 ≈ 48 KB/秒，1 小时音频约 170 MB。
 * 默认上限 300 MB（约 100 分钟），超了删最旧的。LRU 是纯函数，能单测。
 * ============================================================ */

export interface CacheMeta {
  key: string;
  /** 字节数 */
  bytes: number;
  /** 最近一次写入 / 命中时间（ms） */
  at: number;
}

/** 音频本体。和元数据**分开两个库**：列清单（写缓存前算淘汰、看占用）时
 *  只读元数据，否则要把几百兆音频整份读进内存，手机上直接崩。 */
export interface CacheRow {
  key: string;
  data: ArrayBuffer;
}

/**
 * 缓存键：书 + 音色 + 文本。文本不直接进键（一段几百字，IndexedDB 的
 * 键会很长），用长度 + djb2 哈希；撞了只会拿到另一段音频，概率极低。
 */
export function cacheKey(bookId: string, voice: string, text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${bookId || 'book'}|${voice}|${text.length}|${(h >>> 0).toString(36)}`;
}

/**
 * 算出为了给新音频腾地方要删哪些键。
 *
 * 先删最旧的（`at` 升序），删到「现有 + 新来」不超过上限为止。
 * `keepKey` 是这次要写入的键，不能删它自己。
 */
export function pickEvictions(
  entries: readonly CacheMeta[],
  maxBytes: number,
  incomingBytes = 0,
  keepKey?: string,
): string[] {
  const cap = Math.max(0, maxBytes);
  let total = entries.reduce((n, e) => n + Math.max(0, e.bytes), 0) + Math.max(0, incomingBytes);
  if (total <= cap) return [];
  const victims: string[] = [];
  const sorted = entries
    .filter((e) => e.key !== keepKey)
    .slice()
    .sort((a, b) => a.at - b.at);
  for (const e of sorted) {
    if (total <= cap) break;
    victims.push(e.key);
    total -= Math.max(0, e.bytes);
  }
  return victims;
}

const DB_NAME = 'bz-reader-tts';
const STORE = 'audio';
const META = 'meta';
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
        /* v1 只有 audio 一库（元数据混在每一行里）。升到 v2 时清掉旧音频：
           它们没有独立的元数据行，淘汰算法看不到，留着就是占着配额的死重量。
           缓存本来就是可丢的，清空只让下一次重听再合成一遍。 */
        if (e.oldVersion < 2) req.transaction?.objectStore(STORE).clear();
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** 一个薄封装：失败不抛（缓存坏了不该让朗读停掉），调用方按 null 处理 */
export class TtsCache {
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase | null> | null = null;

  private ready(): Promise<IDBDatabase | null> {
    if (this.db) return Promise.resolve(this.db);
    if (!this.opening) {
      this.opening = openDb().then((db) => {
        this.db = db;
        return db;
      });
    }
    return this.opening;
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const db = await this.ready();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.get(key);
        req.onsuccess = () => {
          const row = req.result as CacheRow | undefined;
          if (!row?.data) {
            resolve(null);
            return;
          }
          /* 命中即刷新时间：LRU 看的是「最近用过」，不是「最近合成过」。
             只动元数据那一行，不把音频再写一遍（几十兆 × 每次命中）。 */
          try {
            db.transaction(META, 'readwrite')
              .objectStore(META)
              .put({ key, bytes: row.data.byteLength, at: Date.now() } satisfies CacheMeta);
          } catch {
            /* 时间戳没写上只影响淘汰顺序，不该让这次播放失败 */
          }
          resolve(row.data);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async put(key: string, data: ArrayBuffer, maxBytes: number): Promise<void> {
    const db = await this.ready();
    if (!db || !data.byteLength) return;
    try {
      const all = await this.entries(db);
      const victims = pickEvictions(all, maxBytes, data.byteLength, key);
      const tx = db.transaction([STORE, META], 'readwrite');
      const audio = tx.objectStore(STORE);
      const meta = tx.objectStore(META);
      for (const k of victims) {
        audio.delete(k);
        meta.delete(k);
      }
      audio.put({ key, data } satisfies CacheRow);
      meta.put({ key, bytes: data.byteLength, at: Date.now() } satisfies CacheMeta);
    } catch {
      /* 写不进去只影响下次重听要不要再花钱，不影响这一次听 */
    }
  }

  async clear(): Promise<void> {
    const db = await this.ready();
    if (!db) return;
    try {
      const tx = db.transaction([STORE, META], 'readwrite');
      tx.objectStore(STORE).clear();
      tx.objectStore(META).clear();
    } catch {
      /* 同上 */
    }
  }

  async stats(): Promise<{ count: number; bytes: number }> {
    const db = await this.ready();
    if (!db) return { count: 0, bytes: 0 };
    const all = await this.entries(db);
    return { count: all.length, bytes: all.reduce((n, e) => n + e.bytes, 0) };
  }

  /** 只读元数据那一库：音频本体不进内存（默认上限 300 MB） */
  private entries(db: IDBDatabase): Promise<CacheMeta[]> {
    return new Promise((resolve) => {
      try {
        const req = db.transaction(META, 'readonly').objectStore(META).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as CacheMeta[]);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }
}
