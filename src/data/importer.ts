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

export const IMPORT_FOLDER = 'bz-reader/books';

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

async function uniquePath(app: App, folder: string, name: string): Promise<string> {
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

/**
 * 把一批已选中的文件写进 vault，返回实际写入的路径。
 *
 * 失败语义（A-17）：单个文件写失败只记一次失败，继续写后面的；整批结束
 * 后 resolve 已写入的部分——**永不 reject**。以前这段循环是 change 回调里
 * 裸 async IIFE，任何一步 reject 都没人接，pickAndImport 的 Promise 永远
 * pending，导入面板就卡死在「正在写入…」。
 */
export async function importFiles(
  app: App,
  files: File[],
  accept: string[] = ['epub', 'txt'],
  folderRaw: string = IMPORT_FOLDER,
): Promise<string[]> {
  const written: string[] = [];
  const folder = importFolderOf(folderRaw);
  let failed = 0;
  if (folder && !(await app.vault.adapter.exists(folder).catch(() => false))) {
    await app.vault.adapter.mkdir(folder).catch(() => undefined);
  }
  for (const file of files) {
    if (!accept.includes(extOf(file.name))) continue;
    try {
      const buf = await file.arrayBuffer();
      const target = await uniquePath(app, folder, file.name);
      await app.vault.adapter.writeBinary(target, buf);
      written.push(target);
    } catch (e) {
      failed += 1;
      console.warn('[bz-reader] 导入文件失败：', file.name, (e as Error)?.message || e);
    }
  }
  if (failed) notify(t('notice.import.partial', { failed, ok: written.length }), 'error');
  return written;
}

/** 打开系统文件选择框，把选中的书写进 vault 的目标文件夹，返回写入后的 vault 路径（取消返回 null） */
export function pickAndImport(
  app: App,
  accept: string[] = ['epub', 'txt'],
  folderRaw: string = IMPORT_FOLDER,
): Promise<string[] | null> {
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
      void importFiles(app, files, accept, folderRaw).then(resolve, (e) => {
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
