/* ============================================================
 * bz-reader · 导入（data/importer.ts）
 *
 * 只做一件事：把用户选的本地文件写进 vault。不搬移、不改名（重名才加后缀）。
 * 走 `<input type="file">` 而不是 Electron 对话框：移动端没有对话框 API，
 * 而这两种入口在桌面端行为一样。
 * ============================================================ */
import type { App } from 'obsidian';

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

/** 打开系统文件选择框，把选中的书写进 vault 的目标文件夹，返回写入后的 vault 路径（取消返回 null） */
export function pickAndImport(
  app: App,
  accept: string[] = ['epub', 'txt'],
  folderRaw: string = IMPORT_FOLDER,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept.map((e) => `.${e}`).join(',');
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = (): void => input.remove();

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      if (!files.length) {
        resolve(null);
        return;
      }
      void (async () => {
        const written: string[] = [];
        const folder = importFolderOf(folderRaw);
        if (folder && !(await app.vault.adapter.exists(folder))) {
          await app.vault.adapter.mkdir(folder).catch(() => undefined);
        }
        for (const file of files) {
          if (!accept.includes(extOf(file.name))) continue;
          const buf = await file.arrayBuffer();
          const target = await uniquePath(app, folder, file.name);
          await app.vault.adapter.writeBinary(target, buf);
          written.push(target);
        }
        resolve(written);
      })();
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
