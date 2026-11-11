/* ============================================================
 * bz-reader · 问这摞书（ui/shelf-ask-panel.ts）
 *
 * 书架侧的面板：勾几本书、问一个问题，答案带出处。
 *
 * 与「问这本书」的两处不同：
 *   1. **先选书**：不偷偷扩成全库，勾了什么就是什么；
 *   2. **来源是书 + 章节**：几条依据可能来自同一本书的不同章，来源要能
 *      分别点回去（用的还是「打开书 + 书内搜一次」那条定位路）。
 *
 * 面板只负责收集与展示：检索在 data/shelf-ask，调模型由插件注入
 * （`ask`），这里不碰设置、不算计费。
 * ============================================================ */
import type { App } from 'obsidian';
import { Platform } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import { askShelf, mergeShelfEvidence, shelfSources } from '../data/shelf-ask';
import { clear, el } from './dom';
import { renderAiMarkdown } from '../shell/ai-md';
import { uiModal } from '../core/ui/modal';
import { t } from '../i18n';
import { ACCENT_VAR, shellAccentColor } from '../shell/theme-accent';

export interface ShelfAskDeps {
  app: App;
  /** 可选书目：调用方已经剔掉归档与失联的 */
  books: ReaderBook[];
  /** 把依据与问题交给模型（插件侧注入） */
  ask: (question: string, evidence: string) => Promise<string>;
  /** 点来源：打开那本书，并用这段字在书内定位 */
  onJump: (book: ReaderBook, snippet: string) => void;
}

export function openShelfAsk(deps: ShelfAskDeps): void {
  const books = deps.books ?? [];
  const chosen = new Set<string>();

  const root = el('div', 'bzr-sask' + (Platform.isMobile ? ' is-mobile' : ''));

  const head = el('div', 'bzr-sask-h', t('shelf.ask.pick'));
  const list = el('div', 'bzr-sask-list');
  const status = el('div', 'bzr-xs-status', t('shelf.ask.hint'));

  function updateHint(): void {
    status.textContent = chosen.size ? t('shelf.ask.ready', { n: chosen.size }) : t('shelf.ask.hint');
  }

  for (const book of books) {
    const row = el('label', 'bzr-sask-book');
    const box = el('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      if (box.checked) chosen.add(book.id);
      else chosen.delete(book.id);
      updateHint();
    });
    row.append(box, el('span', 'bzr-sask-name', book.meta.title || t('common.untitled')));
    list.appendChild(row);
  }
  if (!books.length) list.appendChild(el('div', 'bzr-xs-more', t('shelf.ask.noBooks')));

  const bar = el('div', 'bzr-xs-bar');
  const input = el('input');
  input.type = 'text';
  input.placeholder = t('shelf.ask.ph');
  const go = el('button', 'bzr-btn is-primary', t('shelf.ask.go'));
  go.type = 'button';
  bar.append(input, go);

  const answer = el('div', 'bzr-sask-answer');
  answer.dataset.aiMd = '';
  const sources = el('div', 'bzr-sask-sources');
  root.append(head, list, bar, status, answer, sources);

  let running = false;
  let seq = 0;

  async function run(): Promise<void> {
    if (running) return;
    const q = input.value.trim();
    if (!q) return;
    if (!chosen.size) {
      status.textContent = t('shelf.ask.needPick');
      return;
    }
    const my = ++seq;
    running = true;
    go.disabled = true;
    clear(answer);
    clear(sources);
    status.textContent = t('shelf.ask.searching');

    try {
      /* 检索层自己会兜住常见失败；这里再包一层，万一漏出来也不能让
         按钮永久变成灰的（用户只能关窗重开）。 */
      let res;
      try {
        res = await askShelf(deps.app, q, [...chosen]);
      } catch {
        if (my !== seq) return;
        status.textContent = t('search.semantic.embedFail');
        return;
      }
      if (my !== seq) return;
      if (res.problem) {
        status.textContent = res.problem;
        return;
      }
      if (!res.hits.length) {
        status.textContent = t('shelf.ask.empty');
        return;
      }

      status.textContent = t('shelf.ask.thinking');
      let text = '';
      try {
        text = await deps.ask(q, mergeShelfEvidence(res.hits));
      } catch (e) {
        if (my !== seq) return;
        status.textContent = (e as Error)?.message || t('common.unknownError');
        return;
      }
      if (my !== seq) return;

      status.textContent = t('shelf.ask.done', { n: res.books });
      answer.textContent = text;
      /* 答案可能是 Markdown（列表、加粗）：注入后统一渲染 */
      delete answer.dataset.aiRendered;
      renderAiMarkdown(answer);

      const label = el('div', 'bzr-sask-srch', t('shelf.ask.sources'));
      sources.appendChild(label);
      for (const src of shelfSources(res.hits)) {
        const book = books.find((b) => b.id === src.bookId);
        const chip = el('button', 'bzr-sask-src', `${src.title}${src.chapter ? ` · ${src.chapter}` : ''}`);
        chip.type = 'button';
        chip.addEventListener('click', () => {
          if (!book) return;
          close();
          /* 有章节名就按章名定位，没有就退回用命中片段 */
          deps.onJump(book, src.chapter || src.note);
        });
        sources.appendChild(chip);
      }
    } finally {
      /* 面板已关或已开下一轮就不再复位，免得把新那轮的按钮提前解锁 */
      if (my === seq) {
        running = false;
        go.disabled = false;
      }
    }
  }

  go.addEventListener('click', () => void run());
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void run();
  });

  const { close, popup } = uiModal({
    content: root,
    className: 'bzr-sask-popup',
    title: t('shelf.ask.title'),
    head: true,
    maxWidth: 620,
    autofocus: false,
    onClose: () => {
      seq += 1;
    },
  });
  const accent = shellAccentColor();
  if (accent) popup.style.setProperty(ACCENT_VAR, accent);
  window.setTimeout(() => input.focus(), 0);
}
