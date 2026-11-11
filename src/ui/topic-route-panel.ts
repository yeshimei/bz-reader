/* ============================================================
 * bz-reader · 主题书单面板（ui/topic-route-panel.ts）
 *
 * 输入一个主题 → 语义检索找书与章 → 模型排一条阅读路线 → 可存成笔记。
 *
 * 三步都在用户点「生成」之后才发生：检索要一次嵌入、路线要一次对话，
 * 没有自动触发的路径。
 *
 * 存笔记由插件注入（`onSave`）：面板不碰 vault 路径、也不碰导出目录设置。
 * ============================================================ */
import type { App } from 'obsidian';
import { semanticSearch } from '../data/book-search';
import { buildRouteMessages, routeCandidates, routeMarkdown, type RouteBook } from '../data/topic-route';
import { clear, el } from './dom';
import { renderAiMarkdown } from '../shell/ai-md';
import { uiModal } from '../core/ui/modal';
import { t } from '../i18n';

export interface TopicRouteDeps {
  app: App;
  /** 把主题与候选表交给模型（插件侧注入，面板不碰设置与计费） */
  ask: (topic: string, books: RouteBook[]) => Promise<string>;
  /** 存成笔记：返回写好的库内路径 */
  onSave: (topic: string, markdown: string) => Promise<string>;
}

export function openTopicRoute(deps: TopicRouteDeps): void {
  const root = el('div', 'bzr-sask bzr-route');

  const bar = el('div', 'bzr-xs-bar');
  const input = el('input');
  input.type = 'text';
  input.placeholder = t('route.ph');
  const go = el('button', 'bzr-btn is-primary', t('route.go'));
  go.type = 'button';
  bar.append(input, go);

  const status = el('div', 'bzr-xs-status', t('route.hint'));
  const body = el('div', 'bzr-sask-answer');
  body.dataset.aiMd = '';
  const foot = el('div', 'bzr-sask-sources');

  root.append(bar, status, body, foot);

  let running = false;
  let seq = 0;
  let last: { topic: string; markdown: string } | null = null;

  async function run(): Promise<void> {
    if (running) return;
    const topic = input.value.trim();
    if (!topic) return;
    const my = ++seq;
    running = true;
    go.disabled = true;
    clear(body);
    clear(foot);
    last = null;
    status.textContent = t('route.searching');

    const found = await semanticSearch(deps.app, topic);
    if (my !== seq) return;
    const books = found.problem ? [] : routeCandidates(found.hits);
    if (found.problem) {
      running = false;
      go.disabled = false;
      status.textContent = found.problem;
      return;
    }

    status.textContent = t('route.thinking', { n: books.length });
    let text = '';
    try {
      text = await deps.ask(topic, books);
    } catch (e) {
      if (my !== seq) return;
      running = false;
      go.disabled = false;
      status.textContent = (e as Error)?.message || t('common.unknownError');
      return;
    }
    if (my !== seq) return;

    running = false;
    go.disabled = false;
    status.textContent = books.length ? t('route.done', { n: books.length }) : t('route.none');
    body.textContent = text;
    delete body.dataset.aiRendered;
    renderAiMarkdown(body);

    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    last = { topic, markdown: routeMarkdown({ topic, body: text, day, books }) };

    if (books.length) {
      foot.appendChild(el('div', 'bzr-sask-srch', t('shelf.ask.sources')));
      for (const b of books) {
        foot.appendChild(el('span', 'bzr-sask-src', `${b.title}${b.chapters.length ? ` · ${b.chapters.join(' / ')}` : ''}`));
      }
    }
    if (last.markdown) {
      const save = el('button', 'bzr-btn', t('route.save'));
      save.type = 'button';
      save.addEventListener('click', () => {
        const payload = last;
        if (!payload) return;
        save.disabled = true;
        void deps
          .onSave(payload.topic, payload.markdown)
          .then((path) => {
            status.textContent = t('route.saved', { path });
          })
          .catch((e: unknown) => {
            status.textContent = (e as Error)?.message || t('common.unknownError');
            save.disabled = false;
          });
      });
      foot.prepend(save);
    }
  }

  go.addEventListener('click', () => void run());
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void run();
  });

  uiModal({
    content: root,
    className: 'bzr-sask-popup',
    title: t('route.title'),
    head: true,
    maxWidth: 620,
    autofocus: false,
    onClose: () => {
      seq += 1;
    },
  });
  window.setTimeout(() => input.focus(), 0);
}
