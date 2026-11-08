/* ============================================================
 * bz-reader · 数据落盘（data/store.ts）
 *
 * 单一 JSON：`<数据目录>/bz-reader.json`，数据目录默认 `bz-reader/storage/`
 * （库根目录，用户可在设置里改，见 core/plugin-path.ts）。
 *
 * 三条设计约束：
 *  1. **原子写**：先写 `.tmp` → `rename` 覆盖。直接 `adapter.write` 是
 *     「打开正本、截断、写入」，中间任何一拍出事（崩溃 / 盘满 / 杀软锁文件）
 *     磁盘上就留半截 JSON，下次启动整个书架读不出来。rename 要么旧要么新。
 *  2. **失败可恢复**：rename 不覆盖目标的平台（部分移动端）退回「正本 → .bak，
 *     再改名 tmp」；连 rename 都不支持时退回就地覆盖正本。任何一步失败都还剩
 *     一份完整文件，绝不像以前那样先删正本。
 *  3. **写盘防抖**：翻页会改 percent，每页都落盘等于每翻一页一次 IO。
 *     2000ms 合并，外加 unload / 关书时 `flush(true)` 强制写。
 *     内容与上次写下去的完全一样时不产生任何文件 IO。
 *
 * 2026-11-04 补的两条（都是「防御代码写了但没接上」）：
 *  4. **`.bak` 要读**：以前只写不读，于是「正本坏、备份好」这个最该救的
 *     场景恰好救不回来。现在解析失败先试 .bak，能解析就恢复并回写。
 *  5. **留档失败就只读**：`quarantine()` 失败说明这台机器连 rename 都不
 *     支持，此时若继续写盘，第一次 touch() 就会用空库覆盖那份还躺在原地
 *     的真数据。宁可本次会话不保存，也不能覆盖。
 *
 * 2026-11-08（用户拍板）：**不做跨设备冲突处理**。
 *   写盘不再比对磁盘签名、不再重读合并——本机内存就是这份文件的真相，
 *   谁最后写谁赢。多设备怎么同步、要不要合并，交给用户自己的同步工具。
 *   「别把文件弄坏」的防御（原子写 / .bak / .tmp / 坏文件留档 / 只读）
 *   一条不少，删掉的只是「替用户管数据」的那部分。
 * ============================================================ */
import type { App } from 'obsidian';
import { notify } from '../core/notice';
import { t } from '../i18n';
import { pluginVaultPath, storageDirOf } from '../core/plugin-path';
import { copyTree } from './migrate';
import { cleanShelfList } from './shelves';
import {
  EMPTY_DATA,
  SCHEMA_VERSION,
  emptyReading,
  type ReaderBook,
  type ReaderData,
  type ReadingPosition,
  type ReadingSession,
  type ReadingStats,
} from './schema';

const DATA_FILE = 'bz-reader.json';
const TMP_SUFFIX = '.tmp';
const BAK_SUFFIX = '.bak';
const SAVE_DEBOUNCE_MS = 2000;

/** 时间戳后缀，坏文件与备份文件名用 */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export interface SanitizeResult {
  data: ReaderData;
  /** 被丢掉的原始条目。写进 `bz-reader.dropped-*.json`，让用户还能捞回来 */
  dropped: unknown[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

/**
 * id 的合法形状：字母数字下划线短横，1..64 字。
 *
 * 不是洁癖：`book.id` 会被 `data/cover.ts` 拼成缓存文件名
 * （`covers/<id>-<size>.jpg`），标注 id 会进 DOM 的 `data-id`。
 * 一个 `../../evil` 就能让封面写到数据目录外面，一个带引号的 id
 * 就能从属性里逃出来注入。历史数据全是 `b` + base36（以及撞号时的 `-2`），
 * 这条正则不会误伤任何一本真书。
 */
const ID_RE = /^[\w-]{1,64}$/;

function idOk(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}

/**
 * 只认有限数字。
 *
 * `JSON.parse('{"updatedAt":1e999}')` 得到 `Infinity`——它 `typeof` 是 number，
 * 于是能一路混进内存，再 `JSON.stringify` 回 `null`，下次读盘就崩在
 * `new Date(null)` 之类的分支上。NaN 同理（`typeof NaN === 'number'`）。
 */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** 标注数组：留下 id 合规的，其余原样记进 dropped（用户还能手动捞回来） */
function marksOf<T>(raw: unknown, dropped: unknown[]): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    if (isObj(item) && idOk(item.id)) out.push(item as T);
    else dropped.push(item);
  }
  return out;
}

/**
 * 结构校验 + 补缺省。
 *
 * 只检查 `books` 是数组是不够的：`{"books":[{"id":"x"}]}` 这种半截记录会被
 * 原样收下，随后统计页读 `reading.sessions`、书架读 `reading.stats` 全部
 * TypeError，整页空白。这里逐本补齐，补不出来的（没有 id / 没有路径）丢掉。
 *
 * 丢掉的**不静默**：条目原样放进 `dropped`，由 load() 另存一份
 * `bz-reader.dropped-*.json`。云同步截断、手改、`relocate` 传空路径都会
 * 走到这里——以前整本书连同几百条划线就这么没了，还没人知道。
 */
export function sanitizeDataDetailed(v: unknown): SanitizeResult | null {
  const d = v as Partial<ReaderData> | null;
  if (!d || typeof d !== 'object' || !Array.isArray(d.books)) return null;
  const now = Date.now();
  const books: ReaderBook[] = [];
  const dropped: unknown[] = [];
  for (const raw of d.books) {
    const b = raw as Partial<ReaderBook> | null;
    if (!isObj(b) || !idOk(b.id)) {
      dropped.push(raw);
      continue;
    }
    const ref = b.fileRef;
    if (!isObj(ref) || typeof ref.vaultPath !== 'string' || !ref.vaultPath) {
      dropped.push(raw);
      continue;
    }
    const base = emptyReading();
    const reading = (b.reading ?? {}) as Partial<ReaderBook['reading']>;
    const notes = (b.notes ?? {}) as Partial<ReaderBook['notes']>;
    const pos = (isObj(reading.position) ? reading.position : {}) as Partial<ReadingPosition>;
    const stats = (isObj(reading.stats) ? reading.stats : {}) as Partial<ReadingStats>;
    const last = isObj(reading.lastPosition) ? (reading.lastPosition as Partial<ReadingPosition>) : null;
    books.push({
      id: b.id,
      meta: {
        ...(isObj(b.meta) ? b.meta : {}),
        title: String(b.meta?.title ?? ''),
      },
      fileRef: { ...ref },
      reading: {
        /* percent 是「0..1」的口径（bz 侧直接拿来算百分比）。
           1e999 → Infinity 会让进度条算出 NaN 宽度，负数渲染成负宽度。 */
        position: {
          ...base.position,
          ...pos,
          percent: clamp01(num(pos.percent) ?? 0),
        },
        /* lastPosition 是冗余字段（未来「返回上一处」用）。重建对象时漏了它，
           读一次盘就永久丢掉——与 favorite/shelf 同一个坑。 */
        ...(last ? { lastPosition: { ...last, percent: clamp01(num(last.percent) ?? 0) } } : {}),
        stats: {
          totalReadTime: num(stats.totalReadTime) ?? 0,
          lastReadTime: num(stats.lastReadTime) ?? 0,
          ...(num(stats.completedTime) !== undefined ? { completedTime: num(stats.completedTime)! } : {}),
          ...(num(stats.startReadTime) !== undefined ? { startReadTime: num(stats.startReadTime)! } : {}),
          ...(num(stats.rating) !== undefined ? { rating: num(stats.rating)! } : {}),
          ...(typeof stats.review === 'string' ? { review: stats.review } : {}),
        },
        /* 反复强调过的口径：sessions[].start 缺失/≤0 的条目连 bz 都会丢，
           这里先丢，免得它进统计 */
        sessions: Array.isArray(reading.sessions)
          ? reading.sessions
              .filter(
                (s): s is ReadingSession =>
                  isObj(s) && typeof s.start === 'number' && Number.isFinite(s.start) && s.start > 0,
              )
              .map((s) => ({
                ...s,
                start: num(s.start) ?? 0,
                end: num(s.end) ?? 0,
                durationSeconds: num(s.durationSeconds) ?? 0,
                ...(num(s.percent) !== undefined ? { percent: clamp01(num(s.percent)!) } : {}),
              }))
          : [],
      },
      notes: {
        /* 只保证是数组还不够：`[null]` 会让笔记页读 h.text 时 TypeError；
           id 不合规的不只是读起来丑——它会进封面文件名和 DOM 属性 */
        highlights: marksOf<ReaderBook['notes']['highlights'][number]>(notes.highlights, dropped),
        excerpts: marksOf<ReaderBook['notes']['excerpts'][number]>(notes.excerpts, dropped),
        bookmarks: marksOf<ReaderBook['notes']['bookmarks'][number]>(notes.bookmarks, dropped),
      },
      addedAt: num(b.addedAt) ?? now,
      updatedAt: num(b.updatedAt) ?? now,
      /* 标注时间戳与 updatedAt 分两条线（A-15）。重建时漏掉它，读盘一次
         就退回 0，标注线的时间基准就没了。 */
      ...(num(b.notesUpdatedAt) !== undefined ? { notesUpdatedAt: num(b.notesUpdatedAt)! } : {}),
      /* 重建对象时漏了这两项，读盘一次就把收藏和分组丢掉——
         P2-01 把「跟着走」搬进业务数据，落盘面却把它清了。 */
      ...(b.favorite === true ? { favorite: true } : {}),
      ...(typeof b.shelf === 'string' && b.shelf ? { shelf: b.shelf } : {}),
      /* 归档是「移出书架、数据全留」。重建时漏掉 archivedAt，读盘一次
         归档书就会自己回到书架——用户会以为移除没生效。 */
      ...(num(b.archivedAt) !== undefined && num(b.archivedAt)! > 0 ? { archivedAt: num(b.archivedAt)! } : {}),
    });
  }
  const shelfList = Array.isArray((d as ReaderData).shelves)
    ? cleanShelfList(((d as ReaderData).shelves as unknown[]).map((x) => String(x)))
    : undefined;
  return {
    data: {
      ...(d as ReaderData),
      version: 1,
      schemaVersion: SCHEMA_VERSION,
      books,
      /* 分类名单只收规整过的字符串：坏值（对象、空串、重复）都不该进内存。
         它丢了不影响书与标注，分类条会退回「书上反推」的老样子。 */
      ...(shelfList ? { shelves: shelfList } : {}),
    },
    dropped,
  };
}

/** 旧签名：只要数据、不要丢弃记录（大部分调用方只需要这个） */
export function sanitizeData(v: unknown): ReaderData | null {
  return sanitizeDataDetailed(v)?.data ?? null;
}

/**
 * 校验「刚复制出来的那份 JSON 能不能用」（迁移用，P1-04）。
 *
 * 为什么不能用 `exists()` 代替：副本恰好是半截 JSON 时 exists 为真，
 * 流程会切指针 → load() 把新位置的坏文件隔离 → 删掉旧目录。
 * 用户得到「迁移成功」和一个空书架，原来那份好数据没了。
 */
export function verifyCopiedJson(
  text: string | null,
  minBooks: number,
): { ok: boolean; message: string; books: number } {
  if (text === null) return { ok: false, message: '复制后没找到数据文件，已留在原目录', books: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: '复制出来的数据文件是半截 JSON，已留在原目录', books: 0 };
  }
  const clean = sanitizeDataDetailed(parsed);
  if (!clean) return { ok: false, message: '复制出来的数据文件结构不对，已留在原目录', books: 0 };
  const books = clean.data.books.length;
  if (books < minBooks) {
    return { ok: false, message: `复制后只有 ${books} 本书（原有 ${minBooks} 本），已留在原目录`, books };
  }
  return { ok: true, message: '', books };
}

/**
 * 报错的可读文本。
 *
 * 不是所有平台的读失败都是 `Error`：移动端桥接层有抛字符串的，也有抛
 * `{ code: 'NOT_FOUND' }` 这种对象的。只看 `.message` 会得到空串，后面
 * 任何匹配都命中不了，于是「文件不存在」被判成真失败。
 */
function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  const o = e as { message?: unknown; code?: unknown } | null;
  return `${asText(o?.message)} ${asText(o?.code)}`;
}

/** 只认字符串与数字；对象直接拼进模板串只会得到 `[object Object]`，没有信息量 */
function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}

/**
 * 报错说是「文件不存在」。
 *
 * **只当兜底**：正常路径上游已经先问过 `exists()`。这里认不全是必然的——
 * iOS 上 FileManager 的错误描述跟着系统语言走（中文系统给的是
 * 「未能完成操作。（NSCocoaErrorDomain 错误 260。）」），靠文案判断存在性
 * 从一开始就不可靠。
 */
function isMissing(e: unknown): boolean {
  return /not exist|not found|ENOENT|no such file|NOT_FOUND|找不到该文件|文件不存在/i.test(errorText(e));
}

export class ReaderStore {
  private data: ReaderData = EMPTY_DATA;
  private timer: number | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;
  /** 写盘失败只报一次，避免翻页时每 500ms 弹一条 */
  private saveWarned = false;
  /** 上次真正写到磁盘上的 JSON 文本；内容完全相同就不必再写一遍 */
  private lastSaved = '';
  /** 留档失败后置位：本次会话禁止任何写盘，绝不用空库覆盖真数据 */
  private readOnly = false;

  constructor(private app: App) {}

  /** 数据目录变了以后文件路径跟着变，所以每次都现算，别缓存 */
  private filePath(): string {
    return `${storageDirOf(this.app)}/${DATA_FILE}`;
  }

  private tmpPath(): string {
    return `${this.filePath()}${TMP_SUFFIX}`;
  }

  private bakPath(): string {
    return `${this.filePath()}${BAK_SUFFIX}`;
  }

  /** 坏文件的留档路径：解析失败时把原文件挪到这里，绝不直接覆盖 */
  private brokenPath(): string {
    return `${storageDirOf(this.app)}/bz-reader.broken-${stamp()}.json`;
  }

  /** 老版本位置：`<插件目录>/storage/`。只在首次升级时读一次 */
  private legacyDir(): string {
    return pluginVaultPath(this.app, 'storage');
  }

  /** 解析一段文本；坏 JSON / 结构不符都返回 null，由调用方决定退路 */
  private parseText(text: string): SanitizeResult | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.warn('[bz-reader] 数据文件不是合法 JSON：', (e as Error)?.message || e);
      return null;
    }
    const clean = sanitizeDataDetailed(parsed);
    if (!clean) console.warn('[bz-reader] 数据文件结构不符');
    return clean;
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
    /* copyTree 是「合并覆盖」：新目录里已经有正本时再搬一次，老目录那份就会
       把新的整份盖掉（读失败与 Sync 建文件可能只差一拍）。先确认没有正本。 */
    const exists = await adapter.exists(`${storageDirOf(this.app)}/${DATA_FILE}`).catch(() => false);
    if (exists) return false;

    const res = await copyTree(this.app, legacy, storageDirOf(this.app));
    if (res.failed.length) {
      console.warn('[bz-reader] 老数据搬迁未完成，已跳过：', res.failed.slice(0, 3));
      return false;
    }
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
      const clean = this.parseText(await adapter.read(tmp));
      if (!clean) return null;
      await adapter.rename(tmp, this.filePath()).catch(() => undefined);
      this.dirty = true;
      return clean.data;
    } catch {
      return null;
    }
  }

  /**
   * 正本解析失败时试 `.bak`。
   *
   * 这条路径以前根本不存在：`.bak` 每次写盘都会更新（replaceTarget 第二层），
   * 却从来没有一个读它的地方。于是「正本写成半截、旁边躺着完好备份」——
   * 最该救回来的场景，实际结果是隔离成空库。
   */
  private async recoverBak(): Promise<SanitizeResult | null> {
    const text = await this.app.vault.adapter.read(this.bakPath()).catch(() => null);
    if (text === null) return null;
    const clean = this.parseText(text);
    if (!clean) return null;
    return clean;
  }

  /**
   * 坏 JSON 留档：原文件改名保留，下一次写盘才不会把它覆盖掉。
   * 返回是否留档成功——失败意味着这台机器连 rename 都不支持，此后禁止写盘。
   */
  private async quarantine(): Promise<boolean> {
    try {
      await this.app.vault.adapter.rename(this.filePath(), this.brokenPath());
      notify(t('notice.data.broken'), 'error');
      return true;
    } catch {
      notify(t('notice.data.brokenUnarchived'), 'error');
      return false;
    }
  }

  /** 被 sanitize 丢掉的条目另存一份：用户还能手动捞回来 */
  private async saveDropped(dropped: unknown[]): Promise<void> {
    if (!dropped.length) return;
    const path = `${storageDirOf(this.app)}/bz-reader.dropped-${stamp()}.json`;
    try {
      await this.app.vault.adapter.write(path, JSON.stringify({ at: Date.now(), dropped }, null, 2));
      notify(t('notice.data.dropped', { n: dropped.length }), 'info');
    } catch {
      /* 存不下就算了：至少不要因此阻断启动 */
    }
  }

  /** 读盘。文件不存在 / 坏形 / 读失败 → 空库（不抛，插件要能起来） */
  async load(): Promise<ReaderData> {
    const adapter = this.app.vault.adapter;
    const file = this.filePath();
    await adapter.mkdir(storageDirOf(this.app)).catch(() => undefined);

    let text: string | null = null;
    let missing = false;
    let existsSaid = false;
    let readFailed = false;
    /* 先问一句「在不在」，不拿报错文案猜。
       2026-11-08 iPhone 首装真机反馈：iOS 上读一个不存在的文件，抛的是
       FileManager 的本地化描述（「未能完成操作。（NSCocoaErrorDomain 错误 260。）」），
       一个英文关键词都不含。旧实现靠 `/not exist|ENOENT|no such file/` 认，
       于是首装被判成「读取失败」——弹红字 + 整场会话锁成只读，用户加的书、
       划的线一条都存不下去。存在性本来就是能直接问的，不该靠猜。
       `exists` 自己抛错时不急着定案，退回 read 再试，下面的文案匹配兜底。 */
    try {
      if (await adapter.exists(file)) existsSaid = true;
      else missing = true;
    } catch {
      /* 问不出来就按老路读一次，让 catch 分支判 */
    }
    if (!missing) {
      try {
        text = await adapter.read(file);
      } catch (e) {
        if (isMissing(e)) {
          /* exists 刚说「在」、read 却说「不在」：多半是竞态（Sync 刚把文件
             建出来 / 另一个窗口刚写完）。再读一次，别急着按空库启动——
             那样下一次 touch() 就把刚同步来的书整份盖掉。 */
          if (existsSaid) text = await adapter.read(file).catch(() => null);
          if (text === null) missing = true;
        } else {
          /* 权限 / IO / 盘掉线：这**不是**首次安装。
             当成空库继续跑，下一次 touch() 就会用「一本书都没有」覆盖真数据，
             所以这里直接进只读，让 writeOnce() 早退。 */
          readFailed = true;
          this.readOnly = true;
          console.warn('[bz-reader] 读取数据失败：', errorText(e));
          notify(t('notice.data.loadFailed'), 'error');
        }
      }
    }

    /* 「不存在」是首次安装的正常态，顺带看看是不是从老版本升上来的 */
    if (!readFailed && missing) {
      if (await this.adoptLegacy()) {
        text = await adapter.read(file).catch(() => null);
      }
    }

    /* 主文件缺失：先试 .bak（上一次完整写盘），再试 .tmp（写到一半的）。
       恢复完立刻回写正本（A-14），否则下次启动还要再走一遍恢复路径。 */
    if (!readFailed && text === null && missing) {
      const fromBak = await this.recoverBak();
      if (fromBak) {
        this.data = fromBak.data;
        if (fromBak.dropped.length) await this.saveDropped(fromBak.dropped);
        this.dirty = true;
        await this.flush(true);
        return this.data;
      }
      const recovered = await this.recoverTmp();
      if (recovered) {
        this.data = recovered;
        return this.data;
      }
    }

    if (text !== null) {
      const clean = this.parseText(text);
      if (clean) {
        this.data = clean.data;
        if (clean.dropped.length) await this.saveDropped(clean.dropped);
        return this.data;
      }

      // 正本读不出来：先试 .bak，再考虑放弃
      const bak = await this.recoverBak();
      if (bak) {
        this.data = bak.data;
        if (bak.dropped.length) await this.saveDropped(bak.dropped);
        /* 坏正本挪走，别让下一次写盘覆盖。挪不走说明平台连 rename 都不支持，
           那就只读，否则这次回写会把唯一一份坏文件也换掉。 */
        if (!(await this.quarantine())) this.readOnly = true;
        this.dirty = true;
        await this.flush(true);
        return this.data;
      }

      console.warn('[bz-reader] 数据文件结构不符，按空库启动；原文件已留档');
      if (!(await this.quarantine())) this.readOnly = true;
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
    if (this.readOnly) return;
    const adapter = this.app.vault.adapter;
    const tmp = this.tmpPath();
    const target = this.filePath();
    try {
      const text = JSON.stringify(this.data);
      /* 与上次写下去的一模一样：不写文件（A-21）。
         否则「打开书翻一页又翻回来」「unload 时 force flush」都会白白 IO 一次。 */
      if (text === this.lastSaved) {
        this.saveWarned = false;
        return;
      }
      await adapter.mkdir(storageDirOf(this.app)).catch(() => undefined);
      await adapter.write(tmp, text);
      await this.replaceTarget(tmp, target, text);
      this.lastSaved = text;
      this.saveWarned = false;
    } catch (e) {
      this.dirty = true; // 没写成就别丢标记，下次还会试
      /* 只报一次：翻页会一直 touch，写盘失败时每次都弹一条，界面就没法用了 */
      if (!this.saveWarned) {
        this.saveWarned = true;
        notify(t('notice.data.saveFailed'), 'error');
      }
      console.warn('[bz-reader] 写盘失败：', (e as Error)?.message || e);
    }
  }

  /**
   * 用写好的 tmp 顶替正本，三层退路。
   *
   * 1) 直接 rename：桌面端（原子）。
   * 2) 正本 → .bak，再改名 tmp：移动端 rename 不覆盖目标时走这条。
   *    **必须先把旧 .bak 删掉**——这是移动端「翻页一直弹保存失败」的根因：
   *    第一次失败留下 .bak，之后每次 `rename(target, .bak)` 都因为目标已存在
   *    而失败，紧接着 `rename(tmp, target)` 也失败，退路从此永远走不通。
   * 3) 就地写正本：连 rename 都不支持的平台。不原子，但比每次保存都失败好；
   *    写成功后 tmp 是垃圾，顺手删掉。
   */
  private async replaceTarget(tmp: string, target: string, text: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    try {
      await adapter.rename(tmp, target);
      return;
    } catch {
      /* 落到下一层 */
    }
    const bak = this.bakPath();
    try {
      await adapter.remove(bak).catch(() => undefined);
      await adapter.rename(target, bak);
      await adapter.rename(tmp, target);
      return;
    } catch {
      /* 落到下一层 */
    }
    await adapter.write(target, text);
    await adapter.remove(tmp).catch(() => undefined);
  }

  /** 卸载收口：清定时器 + 强制写 */
  async destroy(): Promise<void> {
    await this.flush(true);
  }
}
