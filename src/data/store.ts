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
 *     内容与上次写下去的完全一样时只刷新签名，不产生任何文件 IO。
 *
 * 2026-11-04 补的三条（都是「防御代码写了但没接上」）：
 *  4. **外部修改先合并再写**：load() 之后 Obsidian Sync / 另一个窗口 /
 *     手改都可能动过文件。写盘前比对 stat 签名，变了就重读并按每本书的
 *     updatedAt 合并。不改这条，同步进来的划线会被本机旧快照整份覆盖。
 *  5. **`.bak` 要读**：以前只写不读，于是「正本坏、备份好」这个最该救的
 *     场景恰好救不回来。现在解析失败先试 .bak，能解析就恢复并回写。
 *  6. **留档失败就只读**：`quarantine()` 失败说明这台机器连 rename 都不
 *     支持，此时若继续写盘，第一次 touch() 就会用空库覆盖那份还躺在原地
 *     的真数据。宁可本次会话不保存，也不能覆盖。
 * ============================================================ */
import type { App } from 'obsidian';
import { notify } from '../core/notice';
import { t } from '../i18n';
import { pluginVaultPath, storageDirOf } from '../core/plugin-path';
import { copyTree } from './migrate';
import { EMPTY_DATA, SCHEMA_VERSION, emptyReading, type ReaderBook, type ReaderData } from './schema';

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
    if (!isObj(b) || typeof b.id !== 'string' || !b.id) {
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
    books.push({
      id: b.id,
      meta: {
        ...(isObj(b.meta) ? b.meta : {}),
        title: String(b.meta?.title ?? ''),
      },
      fileRef: { ...ref },
      reading: {
        position: { ...base.position, ...(reading.position ?? {}) },
        /* lastPosition 是冗余字段（未来「返回上一处」用）。重建对象时漏了它，
           读一次盘就永久丢掉——与 favorite/shelf 同一个坑。 */
        ...(isObj(reading.lastPosition) ? { lastPosition: { ...reading.lastPosition } } : {}),
        stats: { ...base.stats, ...(reading.stats ?? {}) },
        /* 反复强调过的口径：sessions[].start 缺失/≤0 的条目连 bz 都会丢，
           这里先丢，免得它进统计 */
        sessions: Array.isArray(reading.sessions)
          ? reading.sessions.filter((s) => isObj(s) && typeof s.start === 'number' && s.start > 0)
          : [],
      },
      notes: {
        /* 只保证是数组还不够：`[null]` 会让笔记页读 h.text 时 TypeError */
        highlights: Array.isArray(notes.highlights)
          ? notes.highlights.filter((h) => isObj(h) && typeof h.id === 'string' && !!h.id)
          : [],
        excerpts: Array.isArray(notes.excerpts)
          ? notes.excerpts.filter((x) => isObj(x) && typeof x.id === 'string' && !!x.id)
          : [],
        bookmarks: Array.isArray(notes.bookmarks)
          ? notes.bookmarks.filter((m) => isObj(m) && typeof m.id === 'string' && !!m.id)
          : [],
      },
      addedAt: typeof b.addedAt === 'number' ? b.addedAt : now,
      updatedAt: typeof b.updatedAt === 'number' ? b.updatedAt : now,
      /* 标注时间戳与 updatedAt 分两条线（A-15）。重建时漏掉它，读盘一次
         就退回 0：另一台设备的新标注再也不会被合并进来。 */
      ...(typeof b.notesUpdatedAt === 'number' ? { notesUpdatedAt: b.notesUpdatedAt } : {}),
      /* 重建对象时漏了这两项，读盘一次就把收藏和分组丢掉——
         P2-01 把「跟着走」搬进业务数据，落盘面却把它清了。 */
      ...(b.favorite === true ? { favorite: true } : {}),
      ...(typeof b.shelf === 'string' && b.shelf ? { shelf: b.shelf } : {}),
      /* 归档是「移出书架、数据全留」。重建时漏掉 archivedAt，读盘一次
         归档书就会自己回到书架——用户会以为移除没生效。 */
      ...(typeof b.archivedAt === 'number' && b.archivedAt > 0 ? { archivedAt: b.archivedAt } : {}),
    });
  }
  return { data: { ...(d as ReaderData), version: 1, schemaVersion: SCHEMA_VERSION, books }, dropped };
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
 * 顶层标量字段的合并规则（A-13）。
 *
 * 以前 `mergeData` 是 `{ ...disk, ...local }`：顶层的 checkins / goal /
 * dailyGoalMinutes 一律本地赢。另一台设备今天打的卡、改大的目标，只要本机
 * 内存里还是旧值，就会被下一次写盘整份盖回去。
 *
 * 现在的规则：
 *   · `checkins` 按天取 max——它是当天累计秒数，取大只会「打上卡」，不会抹掉记录；
 *   · `goal` / `dailyGoalMinutes` 取有值且较大的那份（本机没设时采用磁盘的）；
 *   · 其余顶层字段沿用本地（prefs / dataDir 这类机器相关的东西不跟着盘走）。
 */
export function mergeScalars(
  local: ReaderData,
  disk: ReaderData,
): Pick<ReaderData, 'checkins' | 'goal' | 'dailyGoalMinutes'> {
  const checkins: Record<string, number> = { ...(local.checkins ?? {}) };
  for (const [day, sec] of Object.entries(disk.checkins ?? {})) {
    const n = Number(sec) || 0;
    if (n > (checkins[day] ?? 0)) checkins[day] = n;
  }
  return {
    checkins,
    goal: biggerNumber(local.goal, disk.goal),
    dailyGoalMinutes: biggerNumber(local.dailyGoalMinutes, disk.dailyGoalMinutes),
  };
}

/** 两个可选数字里取「有值且较大」的；都没有就是没有 */
function biggerNumber(a: number | undefined, b: number | undefined): number | undefined {
  const x = typeof a === 'number' && Number.isFinite(a) ? a : undefined;
  const y = typeof b === 'number' && Number.isFinite(b) ? b : undefined;
  if (x === undefined) return y;
  if (y === undefined) return x;
  return Math.max(x, y);
}

/**
 * 把磁盘上那份（可能来自另一台设备）合进内存这份。
 *
 * 按 `id` 对齐，同一本取 `updatedAt` 大的——这是唯一能跨设备比较的字段。
 * 顺序保持「本地的在前」，磁盘上新增的追加在后面，书架自己的排序不受影响。
 *
 * 2026-11-04 改（A-15）：**标注单独按 `notesUpdatedAt` 合**。
 * 整本按 updatedAt 二选一有个固定丢数据的场景：A 机一直在读（updatedAt 新），
 * B 机刚写了一条想法（updatedAt 也新，但更早）——合并取 A 整本，B 的标注没了。
 * 现在 reading / meta / favorite 这些取 updatedAt 大的那份，`notes` 取
 * notesUpdatedAt 大的那份；旧数据没有 notesUpdatedAt 时按 0，等价于旧行为。
 *
 * 顶层不再整块覆盖：checkins / goal / dailyGoalMinutes 按 mergeScalars 的
 * 规则合（见上），其余字段本地优先，磁盘只补本地没有的键。
 *
 * 已知取舍：本地删掉的书如果磁盘上还有，会回来。宁可多一本（用户能再删），
 * 也不要少一本（用户找不回来）。
 */
export function mergeData(local: ReaderData, disk: ReaderData): ReaderData {
  const diskById = new Map<string, ReaderBook>();
  for (const b of disk.books) diskById.set(b.id, b);
  const out: ReaderBook[] = [];
  const seen = new Set<string>();
  for (const b of local.books) {
    const other = diskById.get(b.id);
    /* 其余字段：updatedAt 大的整本当底 */
    const newer = other && (other.updatedAt ?? 0) > (b.updatedAt ?? 0) ? other : b;
    if (!other) {
      out.push(newer);
      seen.add(b.id);
      continue;
    }
    /* 标注单独比 notesUpdatedAt：赢家是「另一份」时只换 notes，
       不动 newer 里的进度 / 元数据 / 收藏。 */
    const otherSide = newer === b ? other : b;
    const newerNotesAt = newer.notesUpdatedAt ?? 0;
    const otherNotesAt = otherSide.notesUpdatedAt ?? 0;
    out.push(
      otherNotesAt > newerNotesAt
        ? { ...newer, notes: otherSide.notes, notesUpdatedAt: otherSide.notesUpdatedAt }
        : newer,
    );
    seen.add(b.id);
  }
  for (const b of disk.books) if (!seen.has(b.id)) out.push(b);
  return { ...disk, ...local, ...mergeScalars(local, disk), books: out };
}

function isMissing(e: unknown): boolean {
  return /not exist|ENOENT|no such file/i.test((e as Error)?.message || '');
}

export class ReaderStore {
  private data: ReaderData = EMPTY_DATA;
  private timer: number | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;
  /** 写盘失败只报一次，避免翻页时每 500ms 弹一条 */
  private saveWarned = false;
  /**
   * 上次读/写时磁盘文件的签名（`mtime:size`）。
   *
   * 写盘前比一次：变了就说明有别的进程动过（Sync / 另一个窗口 / 手改），
   * 必须先读回来合并，否则这次写盘就是拿旧快照整份覆盖。
   */
  private diskSig = '';
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

  /** 磁盘签名：拿不到（文件不存在）返回空串，空串表示「还没有可比对的基线」 */
  private async sig(): Promise<string> {
    const st = await this.app.vault.adapter.stat(this.filePath()).catch(() => null);
    return st ? `${st.mtime}:${st.size}` : '';
  }

  private async markDisk(): Promise<void> {
    this.diskSig = await this.sig();
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

  private async readDisk(): Promise<SanitizeResult | null> {
    const text = await this.app.vault.adapter.read(this.filePath()).catch(() => null);
    return text === null ? null : this.parseText(text);
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
    let readFailed = false;
    try {
      text = await adapter.read(file);
    } catch (e) {
      if (isMissing(e)) {
        // 「不存在」是首次安装的正常态，顺带看看是不是从老版本升上来的
        missing = true;
        if (await this.adoptLegacy()) {
          text = await adapter.read(file).catch(() => null);
        }
      } else {
        /* 权限 / IO / 盘掉线：这**不是**首次安装。
           当成空库继续跑，下一次 touch() 就会用「一本书都没有」覆盖真数据，
           所以这里直接进只读，让 writeOnce() 早退。 */
        readFailed = true;
        this.readOnly = true;
        console.warn('[bz-reader] 读取数据失败：', (e as Error)?.message || e);
        notify(t('notice.data.loadFailed'), 'error');
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
        await this.markDisk();
        await this.flush(true);
        return this.data;
      }
      const recovered = await this.recoverTmp();
      if (recovered) {
        this.data = recovered;
        await this.markDisk();
        return this.data;
      }
    }

    if (text !== null) {
      const clean = this.parseText(text);
      if (clean) {
        this.data = clean.data;
        if (clean.dropped.length) await this.saveDropped(clean.dropped);
        await this.markDisk();
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
        await this.markDisk();
        await this.flush(true);
        return this.data;
      }

      console.warn('[bz-reader] 数据文件结构不符，按空库启动；原文件已留档');
      if (!(await this.quarantine())) this.readOnly = true;
    }

    this.data = { ...EMPTY_DATA, books: [] };
    await this.markDisk();
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
      /* 外部修改检测：无条件取一次签名（A-01）。以前只在 diskSig 非空时比，
         于是「load 时文件不存在、两次写盘之间 Sync 建出了文件」这一拍会被
         跳过——本地旧快照/空库整份盖掉刚同步来的数据。
         合并本身失败不拦写盘，否则一次坏文件会让整个会话再也存不下东西。 */
      const now = await this.sig();
      if (now && now !== this.diskSig) {
        const disk = await this.readDisk();
        if (disk) {
          const merged = mergeData(this.data, disk.data);
          /* 原地改 books 数组，不换引用：BookRepo 在构造时拿的是
             `store.get().books` 那一个数组（book-repo.ts 的 all() 直接返回它）。
             直接 `this.data = merged` 会让 repo 继续指向旧数组——
             合并一发生，新导入的书落不了盘、删掉的书重启又回来（P3-07 的坑）。 */
          const books = this.data.books;
          books.length = 0;
          books.push(...merged.books);
          this.data = { ...merged, books };
          if (disk.dropped.length) void this.saveDropped(disk.dropped);
        }
      }
      const text = JSON.stringify(this.data);
      /* 与上次写下去的一模一样：只刷新磁盘签名，不写文件（A-21）。
         否则「打开书翻一页又翻回来」「unload 时 force flush」都会白白 IO 一次。 */
      if (text === this.lastSaved) {
        this.saveWarned = false;
        await this.markDisk();
        return;
      }
      await adapter.mkdir(storageDirOf(this.app)).catch(() => undefined);
      await adapter.write(tmp, text);
      await this.replaceTarget(tmp, target, text);
      this.lastSaved = text;
      this.saveWarned = false;
      await this.markDisk();
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
