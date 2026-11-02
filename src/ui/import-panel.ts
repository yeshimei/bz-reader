/* ============================================================
 * bz-reader · 导入（ui/import-panel.ts）
 *
 * 两条来源分开说清楚，因为它们的语义完全不同：
 *   ① 从笔记库导入 —— 文件**已经在 vault 里**，这里只是把它登记进书架。
 *      不复制、不搬移，原文件原地不动。这是默认路径：Obsidian 用户
 *      的书本来就躺在库里某处，缺的只是一个入口。
 *   ② 从本地文件导入 —— 文件在 vault 外面，需要**写进** vault 才能被
 *      阅读器读到（foliate 走 vault adapter 读字节）。落到 Books/。
 *
 * 不做「导入即复制到统一书库」：那会在用户库里留一堆副本，
 * 违背「文件即数据」的直觉，也会让同步方案多传一份。
 * ============================================================ */
import type { App } from 'obsidian';
import type { BookFormat } from '../data/schema';
import { BOOK_FORMATS_LABEL, formatOf, scanVault, titleFromPath } from '../data/book-repo';
import type { BookRepo } from '../data/book-repo';
import { pickAndImport } from '../data/importer';
import type { ReaderStore } from '../data/store';
import { uiModal } from '../core/ui/modal';
import { notify } from '../core/notice';
import { clear, el } from './dom';

export interface ImportDeps {
  app: App;
  repo: BookRepo;
  store: ReaderStore;
  formats: BookFormat[];
  /** 面板里改完书架后通知外层刷新（书架弹窗） */
  onDone?: () => void;
}

interface Row {
  path: string;
  format: BookFormat;
  size: number;
  title: string;
  inShelf: boolean;
  checked: boolean;
}

function sizeLabel(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function openImport(deps: ImportDeps): void {
  const { app, repo, store, formats, onDone } = deps;

  const root = el('div', 'bzr-import');
  const listWrap = el('div', 'bzr-import-list');
  const toolbar = el('div', 'bzr-import-toolbar');
  const filterInput = el('input', 'bzr-import-filter');
  filterInput.type = 'search';
  filterInput.placeholder = '筛选书名或路径';
  const selectAll = el('button', 'bzr-link-btn', '全选未加入');
  selectAll.type = 'button';
  toolbar.append(filterInput, selectAll);

  const hint = el('div', 'bzr-import-hint', '');
  const grabBtn = el('button', 'bzr-btn', '选择本地文件…');
  grabBtn.type = 'button';
  const grab = el('div', 'bzr-import-local');
  grab.append(
    el(
      'div',
      'bzr-import-local-desc',
      `文件会被复制进库里，之后由笔记库统一管理。支持 ${BOOK_FORMATS_LABEL(formats)}。`,
    ),
    grabBtn,
  );

  const confirmBtn = el('button', 'bzr-btn bzr-btn-primary', '加入书架');
  confirmBtn.type = 'button';
  const footBar = el('div', 'bzr-import-foot');
  footBar.appendChild(confirmBtn);

  root.append(
    el('div', 'bzr-import-section-title', '在笔记库里找到的书'),
    toolbar,
    hint,
    listWrap,
    el('div', 'bzr-import-section-title', '从本地文件导入'),
    grab,
    footBar,
  );

  let keyword = '';
  let rows: Row[] = [];

  const { close } = uiModal({
    content: root,
    className: 'bzr-import-popup',
    maxWidth: 620,
    autofocus: false,
    onClose: () => {
      void store.flush();
    },
  });

  function load(): void {
    const found = scanVault(app, formats);
    rows = found.map((f) => ({
      path: f.path,
      format: f.format,
      size: f.size,
      title: titleFromPath(f.path),
      inShelf: !!repo.byPath(f.path),
      checked: !repo.byPath(f.path),
    }));
  }

  function visible(): Row[] {
    if (!keyword) return rows;
    const k = keyword.toLowerCase();
    return rows.filter((r) => r.title.toLowerCase().includes(k) || r.path.toLowerCase().includes(k));
  }

  function render(): void {
    const vis = visible();
    const fresh = rows.filter((r) => !r.inShelf).length;
    hint.textContent = rows.length
      ? `共 ${rows.length} 本，其中 ${fresh} 本还没加入书架。文件留在原地，不会复制。`
      : `笔记库里没有找到 ${BOOK_FORMATS_LABEL(formats)} 文件。可以从下面选本地文件。`;

    selectAll.style.display = fresh ? '' : 'none';

    clear(listWrap);
    if (!vis.length) {
      const empty = el('div', 'bzr-import-empty', rows.length ? '没有匹配项' : '库里的书都已经在书架上了');
      listWrap.appendChild(empty);
    } else {
      for (const row of vis) {
        const item = el('label', 'bzr-import-row' + (row.inShelf ? ' is-in' : ''));
        const box = el('input', 'bzr-import-check');
        box.type = 'checkbox';
        box.checked = row.checked;
        box.disabled = row.inShelf;
        box.addEventListener('change', () => {
          row.checked = box.checked;
          syncConfirm();
        });
        const body = el('div', 'bzr-import-row-body');
        const line = el('div', 'bzr-import-row-title');
        line.append(el('span', '', row.title));
        if (row.inShelf) line.appendChild(el('span', 'bzr-import-badge', '已在书架'));
        body.append(line, el('div', 'bzr-import-row-path', row.path));
        const meta = el('div', 'bzr-import-row-meta', [row.format.toUpperCase(), sizeLabel(row.size)].filter(Boolean).join(' · '));
        item.append(box, body, meta);
        listWrap.appendChild(item);
      }
    }
    syncConfirm();
  }

  function syncConfirm(): void {
    const n = rows.filter((r) => r.checked && !r.inShelf).length;
    confirmBtn.disabled = n === 0;
    confirmBtn.textContent = n ? `加入书架（${n}）` : '加入书架';
  }

  filterInput.addEventListener('input', () => {
    keyword = filterInput.value.trim();
    render();
  });

  selectAll.addEventListener('click', () => {
    const target = !rows.filter((r) => !r.inShelf).every((r) => r.checked);
    for (const r of rows) if (!r.inShelf) r.checked = target;
    render();
  });

  confirmBtn.addEventListener('click', () => {
    const picked = rows.filter((r) => r.checked && !r.inShelf);
    if (!picked.length) return;
    for (const r of picked) repo.ensure(r.path, formatOf(r.path) ?? r.format, r.size);
    store.touch();
    void store.flush();
    notify(`已加入 ${picked.length} 本`, 'success');
    onDone?.();
    close();
  });

  grabBtn.addEventListener('click', () => {
    if (grabBtn.disabled) return;
    grabBtn.disabled = true;
    grabBtn.textContent = '正在写入…';
    void (async () => {
      try {
        const written = await pickAndImport(app, formats);
        if (written && written.length) {
          for (const p of written) {
            const fmt = formatOf(p);
            if (fmt) repo.ensure(p, fmt, 0);
          }
          store.touch();
          await store.flush();
          notify(`已导入 ${written.length} 本到 Books/`, 'success');
          onDone?.();
          load();
          render();
        }
      } catch (e) {
        notify(`导入失败：${(e as Error)?.message || '未知错误'}`, 'error');
      } finally {
        grabBtn.disabled = false;
        grabBtn.textContent = '选择本地文件…';
      }
    })();
  });

  load();
  render();
}
