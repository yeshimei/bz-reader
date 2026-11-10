/**
 * 命令注册表（tests/plugin-commands.test.ts）
 *
 * 命令 id 是**用户绑过快捷键就再也改不动**的契约：改了 id，用户的键位静默
 * 失效，命令面板里多一条永远点不到的死命令。文案反过来是要随语言走的。
 * 所以这张表把两件事拆开：id 固定，名字走 t()。
 *
 * 这里锁三件事：id 集合不许悄悄变、每条都有中英文、英文不许等于中文。
 */
import { describe, expect, it, vi } from 'vitest';
import { COMMANDS } from '../src/plugin-commands';
import { EN } from '../src/i18n/en';
import { ZH } from '../src/i18n/zh';
import { makeApp, makePlugin } from './helpers/plugin-harness';

describe('命令 id', () => {
  it('不重复', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('集合固定：改名会让用户已经绑好的快捷键静默失效', () => {
    expect(COMMANDS.map((c) => c.id).sort()).toEqual(
      [
        'bookmark',
        'bookmap',
        'continue',
        /* 排查用：手机上开不了控制台，只有这条命令能把链路计数显示出来 */
        'diag',
        'focus',
        'fullscreen',
        'import',
        'notes',
        'open',
        'page-next',
        'page-prev',
        'prefs',
        'search',
        'semantic',
        'shelf-ask',
        'sidebar',
        'stats',
        'tts',
        'typography',
        /* PDF 专用：头栏图标在手机上折进 ⋮，命令面板是另一条稳定入口 */
        'pdf-zoom-in',
        'pdf-zoom-out',
        'pdf-fit-width',
        'pdf-fit-page',
        'pdf-rotate',
        'pdf-spread',
        'pdf-paged',
        'pdf-thumbs',
        'pdf-copy-link',
        'pdf-export-page',
        'pdf-back',
      ].sort(),
    );
  });
});

describe('命令名', () => {
  it('每条命令在中英文包里都有非空文案', () => {
    for (const c of COMMANDS) {
      expect(ZH[c.key]?.trim(), `${c.id} 缺中文`).toBeTruthy();
      expect(EN[c.key]?.trim(), `${c.id} 缺英文`).toBeTruthy();
    }
  });

  it('英文名与中文名不同：抄漏了没翻会在这里红', () => {
    for (const c of COMMANDS) {
      expect(EN[c.key], c.id).not.toBe(ZH[c.key]);
    }
  });

  it('中文命令名保留域前缀，快捷键面板里能靠搜一个词过滤', () => {
    for (const c of COMMANDS) {
      expect(ZH[c.key], c.id).toMatch(/^(书架|阅读)：/);
    }
  });

  it('英文命令名同样带域前缀（Obsidian 的搜索按空格分词）', () => {
    for (const c of COMMANDS) {
      expect(EN[c.key], c.id).toMatch(/^(Shelf|Reader): /);
    }
  });

  it('「回到上一处」不再是 PDF 专属：EPUB 也能用，命令名里不该带 PDF', () => {
    /* id 仍是 pdf-back（用户绑过的快捷键不能失效），文案要去掉格式限定 */
    const back = COMMANDS.find((c) => c.id === 'pdf-back');
    expect(back).toBeTruthy();
    expect(ZH[back!.key]).not.toContain('PDF');
    expect(EN[back!.key]).not.toContain('PDF');
    expect(ZH[back!.key]).toContain('回到上一处');
  });
});

describe('命令分发', () => {
  it('阅读器类命令带动作，书架类不带', () => {
    const ids = (pred: (c: (typeof COMMANDS)[number]) => boolean) => COMMANDS.filter(pred).map((c) => c.id);
    expect(ids((c) => !!c.reader).sort()).toEqual(
      [
        'bookmark', 'bookmap', 'focus', 'fullscreen', 'page-next', 'page-prev', 'tts', 'typography',
        'pdf-zoom-in', 'pdf-zoom-out', 'pdf-fit-width', 'pdf-fit-page', 'pdf-rotate',
        'pdf-spread', 'pdf-paged', 'pdf-thumbs', 'pdf-copy-link', 'pdf-export-page', 'pdf-back',
      ].sort(),
    );
  });

  it('每条书架类命令都真的调到东西，没有点在原地不动的入口', () => {
    const app = makeApp();
    const p = makePlugin(app);
    /* 诊断角标命令的去处是「切开关 + 让当前阅读页立刻重画」：
       没有开书时 activeReader 为 null，那一半自然不调。 */
    const probeRefresh = vi.fn();
    const spy = {
      openStudy: vi.fn(),
      continueReading: vi.fn(async () => undefined),
      openImportPanel: vi.fn(),
      openSearch: vi.fn(),
      openTocSidebar: vi.fn(),
      /* 语义搜索要造 DOM，node 里没有 document：这里只验「命令走到了它」 */
      openSemanticSearchPanel: vi.fn(),
      openShelfAskPanel: vi.fn(),
      activeReader: vi.fn(() => ({ refreshProbe: probeRefresh })),
    };
    Object.assign(p, spy);

    for (const c of COMMANDS) {
      if (c.reader) continue;
      mockResetAll(spy);
      probeRefresh.mockClear();
      p.runCommandById(c.id);
      const hit =
        Object.values(spy).some((fn) => fn.mock.calls.length > 0) ||
        probeRefresh.mock.calls.length > 0;
      expect(hit, `${c.id} 没有任何去处`).toBe(true);
    }
  });

  it('带 tab 的三条命令传对了 tab 名', () => {
    const app = makeApp();
    const p = makePlugin(app);
    p.openStudy = vi.fn();
    p.runCommandById('notes');
    p.runCommandById('stats');
    p.runCommandById('prefs');
    expect(p.openStudy.mock.calls).toEqual([['notes'], ['stats'], ['settings']]);
  });

  it('侧栏命令打开目录页', () => {
    const app = makeApp();
    const p = makePlugin(app);
    p.openTocSidebar = vi.fn();
    p.runCommandById('sidebar');
    expect(p.openTocSidebar).toHaveBeenCalledWith('toc');
  });
});

function mockResetAll(map: Record<string, { mockClear(): void }>): void {
  for (const fn of Object.values(map)) fn.mockClear();
}
