/**
 * AI 对话留档（aiLog）的运行期门禁（2026-11-16）。
 *
 * 对照表把「AI 对话留档并导出至笔记」单独列为高级版一行之后，所有入口
 * 都要自己判权限：书架「对话」页签、导出、归档、删除、划词浮框归档。
 * 只改表不加拦截 = 基础版白送（AGENTS 核心原则 2）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { aiSessionById, seedAiSessions } from '../src/data/ai-session';
import { buildShelfPage } from '../src/shell/shelf-page';
import { studyShell } from '../src/shell/render/study';
import { t } from '../src/i18n';
import { makeApp, makeStore } from './helpers/plugin-harness';

const canMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: canMock };
});

const notices = vi.hoisted(() => [] as string[]);
vi.mock('../src/core/notice', () => ({
  notify: (text: string) => void notices.push(text),
}));

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  canMock.mockReset();
  canMock.mockReturnValue(false);
  seedAiSessions([]);
  notices.length = 0;
});

function el(dataset: Record<string, string> = {}): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

function installSource(): void {
  setShellSource({
    app: makeApp(),
    repo: { all: () => [] },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS }),
  } as unknown as ShellSource);
}

function seedOne(): void {
  seedAiSessions([
    {
      id: 's1',
      bookId: 'b1',
      bookTitle: '围城',
      kind: 'explain',
      when: 1,
      turns: [
        { me: true, text: '问' },
        { me: false, text: '答' },
      ],
    },
  ]);
}

describe('未解锁：对话留档的每个入口都在门口拦', () => {
  it('导出全部：开解锁层，不写确认层', () => {
    installSource();
    seedOne();

    dispatchAction('aiexportall', el());

    expect(getState().overlay?.kind).toBe('unlock');
    expect(getState().overlay?.mode).toBe('aiLog');
    expect(getState().aiExport).toBeFalsy();
  });

  it('导出本书：开解锁层，不写确认层', () => {
    installSource();
    seedOne();

    dispatchAction('aiexportbook', el({ id: 'b1' }));

    expect(getState().overlay?.kind).toBe('unlock');
    expect(getState().overlay?.mode).toBe('aiLog');
    expect(getState().aiExport).toBeFalsy();
  });

  it('归档一轮：开解锁层，会话的 archivedAt 不动', () => {
    installSource();
    seedOne();

    dispatchAction('aiarchive', el({ id: 's1' }));

    expect(getState().overlay?.mode).toBe('aiLog');
    expect(aiSessionById('s1')?.archivedAt).toBeUndefined();
    /* 也不能假报「已归档到某处」 */
    expect(notices.join('')).toBe('');
  });

  it('删除一轮：开解锁层，会话还在', () => {
    installSource();
    seedOne();

    dispatchAction('aidelete', el({ id: 's1' }));

    expect(getState().overlay?.mode).toBe('aiLog');
    expect(aiSessionById('s1')).toBeTruthy();
  });

  it('点「对话」页签：开解锁层，仍停在下拉之前的页', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, studyPage: 'notes' });

    dispatchAction('study', el({ p: 'ai' }));

    expect(getState().overlay?.kind).toBe('unlock');
    expect(getState().overlay?.mode).toBe('aiLog');
    expect(getState().studyPage).toBe('notes');
  });

  it('划词浮框的归档：开解锁层', () => {
    installSource();

    dispatchAction('aifloatarchive', el());

    expect(getState().overlay?.mode).toBe('aiLog');
  });

  it('未解锁时不列「对话」页签', () => {
    const html = studyShell('library', '', { books: 0, notes: 0, chats: 0 });
    expect(html).not.toContain('data-p="ai"');
  });

  it('授权过期后停在对话页：退回书库，不渲染对话内容', () => {
    installSource();
    seedOne();
    setState({ ...DEFAULT_SHELL_STATE, studyPage: 'ai' });

    const page = buildShelfPage(getState(), [], false);

    expect(page.body).toContain(t('shelf.empty.all'));
    /* 空库给一颗能点的导入按钮，不用去猜右上角（2026-11-17） */
    expect(page.body).toContain('data-act="import"');
    expect(page.body).not.toContain('bzs-hist');
  });
});

describe('已解锁：原行为不变', () => {
  it('导出全部：照常弹确认层', () => {
    canMock.mockReturnValue(true);
    installSource();
    seedOne();

    dispatchAction('aiexportall', el());

    expect(getState().aiExport?.ids).toEqual(['s1']);
  });

  it('归档一轮：只标记归档，提示不再假报笔记路径', () => {
    canMock.mockReturnValue(true);
    installSource();
    seedOne();

    dispatchAction('aiarchive', el({ id: 's1' }));

    expect(aiSessionById('s1')?.archivedAt).toBeTypeOf('number');
    const said = notices.join('');
    expect(said).toContain(t('shelf.ai.archived'));
    expect(said).not.toContain('/');
  });

  it('页签恢复显示', () => {
    canMock.mockReturnValue(true);
    const html = studyShell('library', '', { books: 0, notes: 0, chats: 0 });
    expect(html).toContain('data-p="ai"');
  });
});
