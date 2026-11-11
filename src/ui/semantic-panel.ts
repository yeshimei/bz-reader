/* ============================================================
 * bz-reader · 按意思搜全库（ui/semantic-panel.ts）
 *
 * 跨书语义搜索的入口面板（2026-11-10）。与跨书全文搜索共用同一套外壳样式
 * （`bzr-xs-*`），但底下不是引擎：一次嵌入请求 + 每本画像的余弦。
 *
 * 三条体验取舍：
 *   · 回车才搜：一次嵌入要钱，边打字边搜等于每敲一个字扣一次费；
 *   · 结果按书分组：用户要的是「哪几本书讲过」，不是一长串散块；
 *   · 点一条跳原文：画像没有 CFI，落到书里后再用这一段的开头在书内搜一次
 *     ——定位交给已有的全文搜索，不另造一套坐标。
 * ============================================================ */
import type { App } from 'obsidian';
import { Platform } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import { semanticSearch, type SemanticHit } from '../data/book-search';
import { clear, el, setHtml } from './dom';
import { semanticGroupsHtml, semanticStatusText, type SemanticView } from '../shell/render/semantic';
import { uiModal } from '../core/ui/modal';
import { t } from '../i18n';
import { ACCENT_VAR, shellAccentColor } from '../shell/theme-accent';

export interface SemanticSearchDeps {
  app: App;
  books: ReaderBook[];
  /** 点一条命中：打开那本书并尽量落到这一段 */
  onJump: (book: ReaderBook, hit: SemanticHit) => void;
}

export function openSemanticSearch(deps: SemanticSearchDeps): void {
  /** 当前这一轮命中：行上只带下标，完整片段从这里取 */
  let currentHits: SemanticHit[] = [];
  /* 手机端要带 is-mobile：输入框 16px、结果 15px 那套字号只在真机生效，
     漏了会跟旁边的跨书搜索差一号（2026-11-11 上架 review）。 */
  const root = el('div', 'bzr-xs bzr-sem' + (Platform.isMobile ? ' is-mobile' : ''));
  const bar = el('div', 'bzr-xs-bar');
  const input = el('input');
  input.type = 'search';
  input.placeholder = t('search.semantic.ph');
  const go = el('button', 'bzr-btn is-primary', t('search.semantic.go'));
  go.type = 'button';
  bar.append(input, go);

  const status = el('div', 'bzr-xs-status', t('search.semantic.hint'));
  const hits = el('div', 'bzr-xs-hits');
  root.append(bar, status, hits);

  let seq = 0;
  let running = false;

  async function run(): Promise<void> {
    const q = input.value.trim();
    if (!q || running) return;
    const my = ++seq;
    running = true;
    go.disabled = true;
    currentHits = [];
    clear(hits);
    status.textContent = t('search.semantic.searching');

    try {
      const res = await semanticSearch(deps.app, q);
      if (my !== seq) return;
      currentHits = res.hits;
      const view: SemanticView = {
        kw: q,
        running: false,
        ran: true,
        hits: res.hits,
        problem: res.problem,
        books: res.books,
      };
      status.textContent = semanticStatusText(view, 'shelf', true);
      /* 按书分组：与两个搜索入口共用同一份结果呈现，不再各画一套 */
      setHtml(hits, res.hits.length ? semanticGroupsHtml(res.hits, deps.books) : '');
    } catch {
      /* 检索层自己会兜住常见失败；真漏到这里也不能把按钮永久禁掉——
         用户看到「正在检索…」再点不动，只能关窗重开。 */
      if (my !== seq) return;
      status.textContent = t('search.semantic.embedFail');
    } finally {
      /* seq 变了说明面板已关或已开下一轮，这一轮不该再改界面 */
      if (my === seq) {
        running = false;
        go.disabled = false;
      }
    }
  }

  /** 行上只带下标：完整片段从这一轮的 hits 里取，避免把长文塞进属性 */
  function jumpAt(row: HTMLElement): void {
    const hit = currentHits[Number(row.dataset.idx)];
    const book = hit ? deps.books.find((b) => b.id === hit.bookId) : undefined;
    if (!hit || !book) return;
    close();
    deps.onJump(book, hit);
  }

  hits.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-idx]');
    if (row) jumpAt(row);
  });
  hits.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-idx]');
    if (!row) return;
    e.preventDefault();
    jumpAt(row);
  });

  go.addEventListener('click', () => void run());
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void run();
  });

  const { close, popup } = uiModal({
    content: root,
    className: 'bzr-xs-popup',
    title: t('search.semantic.title'),
    head: true,
    maxWidth: 560,
    autofocus: false,
    onClose: () => {
      seq += 1;
    },
  });
  /* 弹窗挂在 body 上，拿不到壳层的 `--copper`：把当前强调色挂上去，
     主按钮才不会永远是默认那枚橙色（2026-11-11 上架 review）。 */
  const accent = shellAccentColor();
  if (accent) popup.style.setProperty(ACCENT_VAR, accent);
  window.setTimeout(() => input.focus(), 0);
}
