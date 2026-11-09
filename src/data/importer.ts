/* ============================================================
 * bz-reader · 导入（data/importer.ts）
 *
 * 只做一件事：把用户选的本地文件写进 vault。不搬移、不改名（重名才加后缀）。
 * 走 `<input type="file">` 而不是 Electron 对话框：移动端没有对话框 API，
 * 而这两种入口在桌面端行为一样。
 * ============================================================ */
import type { App } from 'obsidian';
import { notify } from '../core/notice';
import { t } from '../i18n';
import type { BookRepo } from './book-repo';
import { MAX_FINGERPRINT_BYTES, fingerprintOf } from './fingerprint';

export const IMPORT_FOLDER = 'bz-reader/books';

/**
 * 单个文件的上限：超过就不在插件里导。
 *
 * `file.arrayBuffer()` 是「把整本书读进内存」，而不是流式写盘——一本 400MB 的
 * 漫画在手机上就是一次必然的 OOM（而且发生在 `try` 里，用户只拿到一句
 * 「导入失败」，谁也想不到是内存不够）。桌面端确实导得动，所以文案要指路。
 */
const MAX_IMPORT_BYTES = 300 * 1024 * 1024;

/**
 * 目标文件夹 → 实际写入前缀。
 * '/' 或空串表示库根目录；其余去掉首尾斜杠。返回空串时路径直接拼文件名。
 */
export function importFolderOf(raw: string | null | undefined): string {
  const s = String(raw ?? '').replace(/\\/g, '/').trim();
  if (!s || s === '/') return '';
  return s.replace(/^\/+|\/+$/g, '');
}

function extOf(name: string): string {
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** 目标文件夹里给同名文件找一个不冲突的路径（重名才加 `(2)` 后缀） */
export async function uniquePath(app: App, folder: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const join = (n: string): string => (folder ? `${folder}/${n}` : n);
  let candidate = join(name);
  let n = 2;
  while (await app.vault.adapter.exists(candidate)) {
    candidate = join(`${base} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

export interface ImportResult {
  /** 最终路径：这次写进去的，或命中已有记录后复用的路径 */
  path: string;
  /** 这次真的写了文件 */
  written: boolean;
  /** 命中书架上已有的同一份内容：不写盘、不新建记录，直接用已有那条 */
  reused: boolean;
  /** 文件字节数（写盘前从内存里拿，不用再 stat 一次） */
  size: number;
  /** 内容指纹；大文件（>64MB）或空文件为 null，此时退回按路径去重 */
  fingerprint: string | null;
}

function fingerprintOfBuffer(buf: ArrayBuffer): string | null {
  if (buf.byteLength > MAX_FINGERPRINT_BYTES) return null;
  return fingerprintOf(new Uint8Array(buf));
}

/**
 * 把一批已选中的文件写进 vault，返回每个文件的处置结果。
 *
 * **查重在写盘之前**：先算内容指纹，命中书架上的同一份内容就跳过，
 * 不会在磁盘上多出一份 `(2)` 副本，也不会多一条记录。
 *
 * 失败语义（A-17）：单个文件写失败只记一次失败，继续写后面的；整批结束
 * 后 resolve 已处理的部分——**永不 reject**。以前这段循环是 change 回调里
 * 裸 async IIFE，任何一步 reject 都没人接，pickAndImport 的 Promise 永远
 * pending，导入面板就卡死在「正在写入…」。
 */
export async function importDetailed(
  app: App,
  files: File[],
  accept: string[] = ['epub', 'txt', 'pdf'],
  folderRaw: string = IMPORT_FOLDER,
  repo?: BookRepo,
): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  const folder = importFolderOf(folderRaw);
  let failed = 0;
  let oversized = 0;
  if (folder && !(await app.vault.adapter.exists(folder).catch(() => false))) {
    await app.vault.adapter.mkdir(folder).catch(() => undefined);
  }
  for (const file of files) {
    if (!accept.includes(extOf(file.name))) continue;
    /* 先看 size 再读内容：`arrayBuffer()` 一旦开始就没有「取消」的余地了 */
    if (file.size > MAX_IMPORT_BYTES) {
      oversized += 1;
      continue;
    }
    try {
      const buf = await file.arrayBuffer();
      const fingerprint = fingerprintOfBuffer(buf);
      if (fingerprint && repo) {
        const hit = repo.byFingerprint(fingerprint);
        /* 记录指向的文件还在：直接复用，把「重复导入」挡在写盘之前 */
        if (hit && (await app.vault.adapter.exists(hit.fileRef.vaultPath).catch(() => false))) {
          out.push({ path: hit.fileRef.vaultPath, written: false, reused: true, size: buf.byteLength, fingerprint });
          continue;
        }
      }
      const target = await uniquePath(app, folder, file.name);
      await app.vault.adapter.writeBinary(target, buf);
      out.push({ path: target, written: true, reused: false, size: buf.byteLength, fingerprint });
    } catch (e) {
      failed += 1;
      console.warn('[bz-reader] 导入文件失败：', file.name, (e as Error)?.message || e);
    }
  }
  if (failed) {
    const ok = out.filter((r) => r.written).length;
    notify(t('notice.import.partial', { failed, ok }), 'error');
  }
  if (oversized) notify(t('notice.import.tooBig', { n: oversized }), 'error');
  return out;
}

/** 老接口：只返回写进库里的路径（被指纹查重跳过的不算）。 */
export async function importFiles(
  app: App,
  files: File[],
  accept: string[] = ['epub', 'txt', 'pdf'],
  folderRaw: string = IMPORT_FOLDER,
): Promise<string[]> {
  const results = await importDetailed(app, files, accept, folderRaw);
  return results.filter((r) => r.written).map((r) => r.path);
}

/** 打开系统文件选择框，把选中的书写进 vault 的目标文件夹（取消返回 null） */
export function pickAndImport(
  app: App,
  accept: string[] = ['epub', 'txt', 'pdf'],
  folderRaw: string = IMPORT_FOLDER,
  repo?: BookRepo,
): Promise<ImportResult[] | null> {
  return new Promise((resolve) => {
    const input = createEl('input');
    input.type = 'file';
    input.accept = accept.map((e) => `.${e}`).join(',');
    input.multiple = true;
    input.setCssProps({ display: 'none' });
    document.body.appendChild(input);

    const cleanup = (): void => input.remove();

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      if (!files.length) {
        resolve(null);
        return;
      }
      /* 无论成功失败都要落定：导入面板 await 的是这个 Promise */
      void importDetailed(app, files, accept, folderRaw, repo).then(resolve, (e) => {
        notify(t('notice.import.error', { why: (e as Error)?.message || t('common.unknownError') }), 'error');
        resolve([]);
      });
    });

    // 用户点取消时 change 不触发，靠窗口重新聚焦兜底
    window.addEventListener(
      'focus',
      () => {
        window.setTimeout(() => {
          if (!input.isConnected) return;
          cleanup();
          resolve(null);
        }, 500);
      },
      { once: true },
    );

    input.click();
  });
}
