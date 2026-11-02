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
 * 勾选框是自绘的方框（.bzr-cb），真 input 压成 0×0 留在 label 里——
 * 原生 checkbox 一上一下两套外观，和这套界面放一起就是「另一个软件的控件」。
 * ============================================================ */
import { Platform, type App } from 'obsidian';
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
  node?: HTMLElement;
  box?: HTMLElement;
}

function sizeLabel(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function openImport(deps: ImportDeps): void {
  const { app, repo, store, formats, onDone } = deps;
  const mobile = Platform.isMobile;

  const root = el('div', 'bzr-imp' + (mobile ? ' is-mobile' : ''));
  const desc = el('p', 'bzr-imp-desc', '');
  const headBox = el('div', 'bzr-imp-h', '导入');
  headBox.appendChild(desc);

  const filterInput = el('input', 'bzr-imp-filter');
  filterInput.type = 'search';
  filterInput.placeholder = '筛选书名或路径';
  const selectAll = el('button', 'bzr-link', '全选未加入');
  selectAll.type = 'button';
  const tools = el('div', 'bzr-imp-tools');
  tools.append(filterInput, selectAll);

  const hint = el('div', 'bzr-imp-hint', '');
  const listWrap = el('div', 'bzr-imp-list');

  const grabBtn = el('button', 'bzr-btn', '选择本地文件…');
  grabBtn.type = 'button';
  const grab = el('div', 'bzr-imp-local');
  grab.append(el('span', 'd', `文件会被复制进库里，之后由笔记库统一管理。支持 ${BOOK_FORMATS_LABEL(formats)}。`), grabBtn);

  const confirmBtn = el('button', 'bzr-btn is-primary', '加入书架');
  confirmBtn.type = 'button';
  const foot = el('div', 'bzr-imp-f');
  foot.appendChild(confirmBtn);

  const bodyBox = el('div', 'bzr-imp-b');
  bodyBox.append(
    el('div', 'bzr-imp-sec', '在笔记库里找到的书'),
    tools,
    hint,
    listWrap,
    el('div', 'bzr-imp-sec', '从本地文件导入'),
    grab,
  );
  root.append(headBox, bodyBox, foot);

  let keyword = '';
  let rows: Row[] = [];

  const { close } = uiModal({
    content: root,
    className: 'bzr-import-popup' + (mobile ? ' is-mobile' : ''),
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

  function buildRow(row: Row): HTMLElement {
    const item = el('label', 'bzr-imp-row' + (row.inShelf ? ' is-in' : ''));
    const box = el('span', 'bzr-cb' + (row.inShelf ? ' is-dis' : row.checked ? ' is-on' : ''));
    const native = el('input', 'bzr-cb-native');
    native.type = 'checkbox';
    native.checked = row.checked;
    native.disabled = row.inShelf;
    native.tabIndex = -1;
    native.addEventListener('change', () => {
      row.checked = native.checked;
      box.classList.toggle('is-on', native.checked);
      syncConfirm();
    });

    const text = el('span', 'bzr-imp-t');
    const name = el('span', 'n', row.title);
    if (row.inShelf) name.appendChild(el('span', 'bzr-badge', '已在书架'));
    text.append(name, el('span', 'p', row.path));

    item.append(box, native, text, el('span', 'bzr-imp-m', sizeLabel(row.size)));
    row.node = item;
    row.box = box;
    return item;
  }

  function render(): void {
    const vis = visible();
    const fresh = rows.filter((r) => !r.inShelf).length;
    hint.textContent = rows.length
      ? `共 ${rows.length} 本，其中 ${fresh} 本还没加入书架。文件留在原地，不会复制。`
      : `笔记库里没有找到 ${BOOK_FORMATS_LABEL(formats)} 文件。可以从下面选本地文件。`;
    desc.textContent = `库里找到 ${rows.length} 本书，其中 ${fresh} 本还没上架。文件留在原地。`;
    selectAll.style.display = fresh ? '' : 'none';

    clear(listWrap);
    if (!vis.length) {
      listWrap.appendChild(
        el('div', 'bzr-imp-empty', rows.length ? '没有匹配项' : '库里的书都已经在书架上了'),
      );
    } else {
      for (const row of vis) listWrap.appendChild(buildRow(row));
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
