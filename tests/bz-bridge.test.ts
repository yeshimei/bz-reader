/**
 * bz 门面探测（data/bz-bridge.ts）：没装 / 装了没启用 / 老版本缺半边 / 齐全。
 *
 * 这条路径每次重绘都可能走到，所以底线是「不抛错、有话说」：任何异常状态都要
 * 变成一句用户能照着做的人话，而不是控制台里一条红字。
 */
import { describe, expect, it, vi } from 'vitest';
import { aiBridgeProblem, bzPreviewReady, entryBridgeProblem, openBzEntry, openBzPreview, probeBz } from '../src/data/bz-bridge';

const term = vi.fn();
const passage = vi.fn();
const knowledge = { openTermNote: term, openPassageNote: passage };

function app(patch: Record<string, unknown> = {}, manifestVersion = '1.41.0') {
  return {
    plugins: {
      getPlugin: (id: string) => (id === 'bz' ? patch : null),
      plugins: { bz: patch },
      manifests: { bz: { version: manifestVersion } },
    },
  } as never;
}

describe('探测', () => {
  it('没有 bz：状态 missing，能力全空，提示引导安装', () => {
    const p = probeBz({ plugins: { plugins: {}, manifests: {} } } as never);
    expect(p.status).toBe('missing');
    expect(p.knowledge).toBeNull();
    expect(aiBridgeProblem(p)).toContain('还没装');
  });

  it('装了没启用（manifest 在、实例不在）：状态 disabled，提示引导启用', () => {
    const p = probeBz({ plugins: { plugins: {}, manifests: { bz: { version: '1.40.0' } } } } as never);
    expect(p.status).toBe('disabled');
    expect(p.version).toBe('1.40.0');
    expect(aiBridgeProblem(p)).toContain('启用');
  });

  it('插件列表完全拿不到（老宿主 / 被别的东西替换）：当没装处理，不抛', () => {
    expect(probeBz(null).status).toBe('missing');
    expect(probeBz({} as never).status).toBe('missing');
  });

  it('老版本 bz 只有录入门面：检索那半边判为版本旧', () => {
    const p = probeBz(app({ knowledge }));
    expect(p.status).toBe('ok');
    expect(p.knowledge).not.toBeNull();
    expect(p.ai).toBeNull();
    expect(aiBridgeProblem(p)).toContain('1.41.0');
    expect(entryBridgeProblem(p)).toBeNull();
  });

  it('门面只有一半方法（被裁剪 / 名字改了）：整半边判为不可用', () => {
    const p = probeBz(app({ knowledge, readerAi: { isIndexReady: () => true } }));
    expect(p.ai).toBeNull();
  });

  it('齐了：两个 capability 都拿到，不报问题', () => {
    const readerAi = {
      isIndexReady: () => true,
      embeddingModel: () => 'bge-m3',
      searchNotes: async () => [],
      embedDocuments: async () => [],
      embedQuery: async () => [],
    };
    const p = probeBz(app({ knowledge, readerAi }));
    expect(p.knowledge).toBe(knowledge);
    expect(p.ai).toBe(readerAi);
    expect(aiBridgeProblem(p)).toBeNull();
  });
});

describe('打开录入', () => {
  it('名词：选中文字作为名词预填，来源与回调原样透传', () => {
    term.mockClear();
    const probe = probeBz(app({ knowledge: { openTermNote: term, openPassageNote: passage } }));
    const onCreated = vi.fn();
    const res = openBzEntry(probe, 'term', '心流', { kind: 'note', path: 'obsidian://bz-reader?book=b1', name: '心流' }, onCreated);
    expect(res.ok).toBe(true);
    expect(term).toHaveBeenCalledWith('心流', {
      source: { kind: 'note', path: 'obsidian://bz-reader?book=b1', name: '心流' },
      onCreated,
    });
  });

  it('段落：正文走 opts.text（bz 侧优先于编辑器选区）', () => {
    passage.mockClear();
    const probe = probeBz(app({ knowledge: { openTermNote: term, openPassageNote: passage } }));
    openBzEntry(probe, 'passage', '一整段原文');
    expect(passage).toHaveBeenCalledWith({ text: '一整段原文', source: undefined, onCreated: undefined });
  });

  it('文献文件夹没配：仍然打开（bz 会把人送去设置），但回一句说明', () => {
    const probe = probeBz(
      app({
        knowledge: {
          openTermNote: vi.fn(),
          openPassageNote: vi.fn(),
          isFolderReady: () => false,
        },
      }),
    );
    const res = openBzEntry(probe, 'term', '词');
    expect(res.ok).toBe(true);
    expect(res.message).toContain('文献文件夹');
  });

  it('门面不在：不调用、给原因', () => {
    const res = openBzEntry(probeBz(null), 'term', '词');
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
  });

  it('bz 内部抛错：收敛成一句人话，不把异常抛给界面', () => {
    const probe = probeBz(
      app({
        knowledge: {
          openTermNote: () => {
            throw new Error('boom');
          },
          openPassageNote: vi.fn(),
        },
      }),
    );
    const res = openBzEntry(probe, 'term', '词');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('boom');
  });
});

/**
 * 老门面：bz 1.40 之前把内部函数**原样**挂到 plugin.knowledge 上，第一个参数是
 * Obsidian 的 app。bz-reader 按「第一个参数是文字」去调，bz 内部那句 `term.trim()`
 * 拿到的就是选项对象，当场抛 `term.trim is not a function`（2026-11-07 真机）。
 *
 * 只认参数个数：绑定写法是 2 / 1 个参数，原样挂出来是 3 / 2 个。
 */
describe('老门面的调用形状', () => {
  const hostApp = { vault: { adapter: {} } };

  it('名词：先补 app，文字仍落在第二个参数', () => {
    const calls: unknown[][] = [];
    function legacyTerm(host: unknown, text?: string, opts?: unknown) {
      calls.push([host, text, opts]);
    }
    const probe = probeBz(app({ knowledge: { openTermNote: legacyTerm, openPassageNote: () => undefined } }));
    const res = openBzEntry(probe, 'term', '心流', undefined, undefined, hostApp as never);
    expect(res.ok).toBe(true);
    expect(calls[0]).toEqual([hostApp, '心流', { source: undefined, onCreated: undefined }]);
  });

  it('段落：先补 app，正文仍走 opts.text', () => {
    const calls: unknown[][] = [];
    function legacyPassage(host: unknown, opts?: { text?: string }) {
      calls.push([host, opts]);
    }
    const probe = probeBz(app({ knowledge: { openTermNote: () => undefined, openPassageNote: legacyPassage } }));
    openBzEntry(probe, 'passage', '一整段原文', undefined, undefined, hostApp as never);
    expect(calls[0]).toEqual([hostApp, { source: undefined, onCreated: undefined, text: '一整段原文' }]);
  });

  it('要 app 却拿不到 app：不硬调，给一句「更新 bz」', () => {
    function legacyTerm(_host: unknown, _text?: string, _opts?: unknown) {
      throw new Error('不该被调用');
    }
    const probe = probeBz(app({ knowledge: { openTermNote: legacyTerm, openPassageNote: () => undefined } }));
    const res = openBzEntry(probe, 'term', '词');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('bz 版本太旧');
  });
});

/**
 * 打开知识盒预览（2026-11-08）：点划线 / 卡片上的知识盒标签时调。
 *
 * 门面是**可选**的：老版本 bz 没这个出口，探测不到就返回 false，由调用方
 * 退回「打开那篇笔记」——不能因为缺这一项就整块不可用。
 */
describe('打开知识盒预览', () => {
  it('门面没有 openPreview：判为不可用，不抛错', () => {
    const a = app({ knowledge });
    expect(bzPreviewReady(a)).toBe(false);
    expect(openBzPreview(a, '文献/心流.md')).toBe(false);
  });

  it('门面有 openPreview：把路径原样递过去', () => {
    const preview = vi.fn(async () => undefined);
    const a = app({ knowledge: { ...knowledge, openPreview: preview } });
    expect(bzPreviewReady(a)).toBe(true);
    expect(openBzPreview(a, '文献/心流.md')).toBe(true);
    expect(preview).toHaveBeenCalledWith('文献/心流.md');
  });

  it('路径为空：不调用', () => {
    const preview = vi.fn(async () => undefined);
    const a = app({ knowledge: { ...knowledge, openPreview: preview } });
    expect(openBzPreview(a, '   ')).toBe(false);
    expect(preview).not.toHaveBeenCalled();
  });

  it('bz 内部同步抛错：吞掉并返回 false（界面退回打开笔记）', () => {
    const preview = vi.fn(() => {
      throw new Error('boom');
    });
    const a = app({ knowledge: { ...knowledge, openPreview: preview } });
    expect(openBzPreview(a, '文献/心流.md')).toBe(false);
  });
});
