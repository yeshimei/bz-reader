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
 * 承载方式：它现在是书架里的**一整页**（S1 定稿），不是弹窗。
 * 页面体由 shelf-page 给出一个空容器，这里往里挂；离开页面时调用
 * 返回的 teardown，不留下监听和 DOM。
 *
 * 勾选框是自绘的方框（.bzr-cb），真 input 压成 0×0 留在 label 里——
 * 原生 checkbox 一上一下两套外观，和这套界面放一起就是「另一个软件的控件」。
 * ============================================================ */
import { Platform, type App } from 'obsidian';
import type { BookFormat, ReaderBook } from '../data/schema';
import { BOOK_FORMATS_LABEL, formatOf, scanVault, titleFromPath } from '../data/book-repo';
import type { BookRepo } from '../data/book-repo';
import { importFolderOf, pickAndImport } from '../data/importer';
import { backfillFingerprints, fillBookMetas, readFingerprint } from '../data/book-scan';
import { shellSettings } from '../shell/source';
import type { ReaderStore } from '../data/store';
import { notify } from '../core/notice';
import { t } from '../i18n';
import { clear, el } from './dom';

export interface ImportDeps {
  app: App;
  repo: BookRepo;
  store: ReaderStore;
  formats: BookFormat[];
  /** 面板里改完书架后通知外层刷新（书架页 / 侧栏） */
  onDone?: () => void;
  /** 导入完成或用户按返回：退出这一页，回到书库 */
  onExit?: () => void;
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

/**
 * 把导入页挂进 `host`，返回拆卸函数。
 *
 * 没有 headBox：「导入书籍」这四个字已经由头栏那颗亮着的导入图标说了，
 * 页内再写一遍就是同一句话说两次。
 */
export function mountImport(host: HTMLElement, deps: ImportDeps): () => void {
  const { app, repo, store, formats, onDone, onExit } = deps;
  const mobile = Platform.isMobile;
  // 本地文件写进哪个文件夹，由设置页统一决定（「数据 · 书籍导入位置」）
  const folder = importFolderOf(shellSettings().importDir);
  const folderText = folder || '库根目录';

  const root = el('div', 'bzr-imp is-page' + (mobile ? ' is-mobile' : ''));

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
  root.append(bodyBox, foot);
  host.appendChild(root);

  let keyword = '';
  let rows: Row[] = [];
  /** 解析书目/写盘期间锁住入口：重复点会把同一本书 ensure 两遍、并发解 zip */
  let busy = false;

  /**
   * 把选中的书登记进书架，并**当场**读一遍内嵌书目。
   *
   * 登记前先算内容指纹：同一份文件（改名、复制、从本地再导入一次）
   * 在书架上只允许一条记录，多出来的只更新路径，不新建。没有指纹的
   * （大文件/老数据）退回按路径去重。
   *
   * 以前这里只 `repo.ensure()`：书名从文件名来、作者留空，书架显示「佚名」，
   * 直到用户点开这本书、引擎解析完 OPF 才回填。导入完的第一眼就该是
   * 真书名 + 真作者，所以这一个 await 不能省——`onExit` 必须排在它后面。
   */
  async function addToShelf(
    picked: Array<{ path: string; format: BookFormat; size: number }>,
  ): Promise<{ added: number; skipped: number; revived: number }> {
    /* 老记录没有指纹就补算：不补的话，同一本书重新导入照样会新建一条 */
    await backfillFingerprints(app, repo.all());
    const books: ReaderBook[] = [];
    let skipped = 0;
    let revived = 0;
    for (const r of picked) {
      const fp = await readFingerprint(app, r.path, r.size);
      const { book, created, pathChanged, revived: cameBack } = repo.ensure(
        r.path,
        formatOf(r.path) ?? r.format,
        r.size,
        fp ?? undefined,
      );
      /* 指纹命中的是另一条路径：旧路径已经不可用了才把记录挪过来；
         旧路径还在（同一内容的另一份副本）就保持不动，免得来回跳 */
      if (pathChanged && !app.vault.getAbstractFileByPath(book.fileRef.vaultPath)) repo.relocate(book, r.path);
      if (created) books.push(book);
      else if (cameBack) revived += 1;
      else skipped += 1;
    }
    await fillBookMetas(app, books);
    store.touch();
    await store.flush();
    return { added: books.length, skipped, revived };
  }

  function load(): void {
    const found = scanVault(app, formats);
    rows = found.map((f) => {
      const rec = repo.byPath(f.path);
      /* 归档书虽然文件还在，但对书架来说等于没加入：显示成可勾选，
         勾了会走复活（进度划线接上），不该显示「已在书架」 */
      const onShelf = !!rec && !rec.archivedAt;
      return {
        path: f.path,
        format: f.format,
        size: f.size,
        title: titleFromPath(f.path),
        inShelf: onShelf,
        checked: !onShelf,
      };
    });
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
    selectAll.style.display = fresh ? '' : 'none';

    clear(listWrap);
    if (!vis.length) {
      listWrap.appendChild(el('div', 'bzr-imp-empty', rows.length ? '没有匹配项' : '库里的书都已经在书架上了'));
    } else {
      for (const row of vis) listWrap.appendChild(buildRow(row));
    }
    syncConfirm();
  }

  function syncConfirm(): void {
    const n = visible().filter((r) => r.checked && !r.inShelf).length;
    confirmBtn.disabled = n === 0;
    confirmBtn.textContent = n ? `加入书架（${n}）` : '加入书架';
  }

  filterInput.addEventListener('input', () => {
    keyword = filterInput.value.trim();
    render();
  });

  selectAll.addEventListener('click', () => {
    /* 只对屏幕上看得见的行生效：以前遍历全部 rows，筛出 3 本却把 42 本一起选了 */
    const vis = visible().filter((r) => !r.inShelf);
    const target = !vis.every((r) => r.checked);
    for (const r of vis) r.checked = target;
    render();
  });

  confirmBtn.addEventListener('click', () => {
    /* 同理：加入的只能是用户眼前勾中的那些 */
    const picked = visible().filter((r) => r.checked && !r.inShelf);
    if (!picked.length || busy) return;
    busy = true;
    confirmBtn.disabled = true;
    confirmBtn.textContent = '正在读取书目…';
    void (async () => {
      try {
        const { added, skipped, revived } = await addToShelf(picked);
        if (added) notify(t('notice.import.done', { n: added }), 'success');
        /* 归档过的书被重新导入：不是「新加入」，是原记录复活 */
        if (revived) notify(t('notice.book.revived', { n: revived }), 'success');
        /* 指纹命中（同一份文件已在书架）时不再建记录：告诉用户为什么数字对不上 */
        if (skipped) notify(t('notice.import.skipped', { n: skipped }), 'info');
        onDone?.();
        /* 加完就回书库：这一刻用户想看到的是新书出现在架子上，
           留在一张「已全部加入」的空列表前面没有意义。 */
        onExit?.();
      } catch (e) {
        notify(t('notice.import.failed', { why: (e as Error)?.message || t('common.unknownError') }), 'error');
      } finally {
        busy = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = '加入书架';
        syncConfirm();
      }
    })();
  });

  grabBtn.addEventListener('click', () => {
    if (grabBtn.disabled || busy) return;
    busy = true;
    grabBtn.disabled = true;
    grabBtn.textContent = '正在核对书库…';
    void (async () => {
      try {
        /* 写盘前先补算老记录的指纹：不然查重对升级前的书无效 */
        await backfillFingerprints(app, repo.all());
        grabBtn.textContent = '正在写入…';
        /* 传 repo：写盘前先按内容指纹查重，同一份文件不会写出第二份副本 */
        const results = await pickAndImport(app, formats, folder, repo);
        if (results && results.length) {
          /* 写进库里的文件同样当场读书目：不然新导入的书在书架上还是佚名 */
          grabBtn.textContent = '正在读取书目…';
          const books: ReaderBook[] = [];
          let skipped = 0;
          let revived = 0;
          for (const r of results) {
            const fmt = formatOf(r.path);
            if (!fmt) continue;
            const { book, created, pathChanged, revived: cameBack } = repo.ensure(
              r.path,
              fmt,
              r.size,
              r.fingerprint ?? undefined,
            );
            if (pathChanged && !app.vault.getAbstractFileByPath(book.fileRef.vaultPath)) repo.relocate(book, r.path);
            if (created) books.push(book);
            else if (cameBack) revived += 1;
            else skipped += 1;
          }
          await fillBookMetas(app, books);
          store.touch();
          const fresh = books.length;
          if (fresh) notify(t('notice.import.written', { n: fresh, folder: folderText }), 'success');
          if (revived) notify(t('notice.book.revived', { n: revived }), 'success');
          if (skipped) notify(t('notice.import.skipped', { n: skipped }), 'info');
          onDone?.();
          load();
          render();
        }
      } catch (e) {
        notify(t('notice.import.error', { why: (e as Error)?.message || t('common.unknownError') }), 'error');
      } finally {
        busy = false;
        grabBtn.disabled = false;
        grabBtn.textContent = '选择本地文件…';
      }
    })();
  });

  load();
  render();
  /* 打开导入页就顺手给老记录补指纹（后台，不挡列表）：补完下一次导入才认得出重复 */
  void backfillFingerprints(app, repo.all()).then((n) => {
    if (n) store.touch();
  });

  return () => {
    void store.flush();
    root.remove();
  };
}
