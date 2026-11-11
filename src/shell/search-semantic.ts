/* ============================================================
 * bz-reader · 按意思搜的调度（shell/search-semantic.ts）
 *
 * 与 search-run.ts 并列：那边逐本扫字面、边到边追加；这边一次嵌入请求、
 * 结果按书收口。两边共用同一个搜索词与输入框，所以现场各记一份——
 * 切回字面搜索时，字面结果不会被语义结果清掉。
 *
 * 三条取舍：
 *   · 只在用户明确动作（切到按意思 / 点搜索 / 回车）时发请求：一次嵌入要钱；
 *   · 打字只清旧结果、不自动重搜，界面回到「回车开始」的提示；
 *   · 请求回来先对轮次号，换词 / 换模式 / 关掉搜索之后回来的结果一律丢。
 * ============================================================ */
import { semanticSearch } from '../data/book-search';
import { getState } from './state';
import { getShellSource } from './source';
import { RT } from './runtime';
import { t } from '../i18n';

/** 两个入口：书架搜索页搜全库，阅读页搜索浮层只搜当前这本书 */
export type SearchSurface = 'shelf' | 'book';

/** 这个入口的语义检索范围（书架 = 全库，书内 = 当前书） */
export function semanticScopeFor(surface: SearchSurface): 'book' | 'all' {
  return surface === 'book' ? 'book' : 'all';
}

/** 当前动作是从哪一处搜索发出来的 */
export function currentSearchSurface(): SearchSurface {
  return getState().overlay?.kind === 'search' ? 'book' : 'shelf';
}

/** 结果到达时只通知宿主换命中列表，不整页重绘 */
function notify(): void {
  for (const fn of [...RT.semantic.listeners]) {
    try {
      fn();
    } catch {
      /* 单个宿主重绘出错忽略 */
    }
  }
}

/** 清空现场：换模式、清空关键词、离开搜索时都走这里 */
export function resetSemanticSearch(): void {
  const s = RT.semantic;
  s.seq += 1;
  s.kw = '';
  s.scope = 'all';
  s.bookId = '';
  s.ran = false;
  s.running = false;
  s.hits = [];
  s.problem = null;
  s.books = 0;
  notify();
}

/**
 * 输入框变了：旧结果不能再挂在界面上。
 *
 * 不自动发请求——用户还在打字，每敲一个字扣一次嵌入费是不可接受的。
 * 下一次回车 / 点「搜索」才真正检索。
 */
export function noteSemanticInput(kw: string): void {
  const s = RT.semantic;
  const q = String(kw ?? '').trim();
  if (q === s.kw && !s.running) return;
  s.seq += 1;
  s.kw = q;
  s.ran = false;
  s.running = false;
  s.hits = [];
  s.problem = null;
  s.books = 0;
  notify();
}

/**
 * 开一轮语义检索。
 *
 * @param kw      输入框里这一刻的值
 * @param surface 从哪个入口发起（决定搜全库还是只搜当前书）
 */
export function kickSemanticSearch(kw: string, surface: SearchSurface): void {
  const s = RT.semantic;
  const q = String(kw ?? '').trim();
  const scope = semanticScopeFor(surface);
  /* 同一句、同一个入口正在跑：连点 / 连按回车不再发第二次，一次嵌入是一笔钱。
     换了入口（书内 ↔ 全库）则是另一轮检索，必须重开。 */
  if (s.running && s.kw === q && s.scope === scope) return;
  s.seq += 1;
  const seq = s.seq;
  s.kw = q;
  s.scope = scope;
  s.bookId = '';
  s.ran = false;
  s.running = false;
  s.hits = [];
  s.problem = null;
  s.books = 0;

  if (!q) {
    notify();
    return;
  }
  const state = getState();
  /* 书内入口没有当前书：界面由 searchResultsHtml 统一给「先打开一本书」 */
  if (scope === 'book' && !state.bookId) {
    notify();
    return;
  }
  s.bookId = scope === 'book' ? String(state.bookId ?? '') : '';
  const src = getShellSource();
  if (!src) {
    s.problem = t('search.semantic.embedFail');
    notify();
    return;
  }

  s.ran = true;
  s.running = true;
  notify();

  const bookIds = scope === 'book' ? [state.bookId as string] : undefined;
  void (async () => {
    try {
      const res = await semanticSearch(src.app, q, undefined, bookIds);
      if (seq !== s.seq) return;
      s.running = false;
      s.hits = res.hits;
      s.problem = res.problem;
      s.books = res.books;
      notify();
    } catch {
      if (seq !== s.seq) return;
      s.running = false;
      s.problem = t('search.semantic.embedFail');
      notify();
    }
  })();
}
