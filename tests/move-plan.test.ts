import { describe, expect, it } from 'vitest';
import { planMove } from '../src/core/move-plan';

describe('planMove：目录迁移的文件清单', () => {
  it('只搬源目录下的文件，保持相对路径', () => {
    const p = planMove(['notes/a.md', 'notes/sub/b.md', 'other/c.md'], 'notes', 'moved');
    expect(p.ok).toBe(true);
    expect(p.moves).toEqual([
      { from: 'notes/a.md', to: 'moved/a.md' },
      { from: 'notes/sub/b.md', to: 'moved/sub/b.md' },
    ]);
  });

  it('源目录为空串 / 库根：拒绝', () => {
    expect(planMove(['a.md'], '', 'x').ok).toBe(false);
    expect(planMove(['a.md'], '/', 'x').ok).toBe(false);
    expect(planMove(['a.md'], 'a', '').ok).toBe(false);
  });

  it('目录相同：不搬', () => {
    expect(planMove(['a/x.md'], 'a', 'a').ok).toBe(false);
  });

  it('父子目录互迁：拒绝（会把自己复制进自己）', () => {
    expect(planMove(['a/x.md'], 'a', 'a/b').ok).toBe(false);
    expect(planMove(['a/b/x.md'], 'a/b', 'a').ok).toBe(false);
  });

  it('前后斜杠不影响判定', () => {
    const p = planMove(['notes/a.md'], '/notes/', '/moved/');
    expect(p.moves).toEqual([{ from: 'notes/a.md', to: 'moved/a.md' }]);
  });
});
