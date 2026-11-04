import { describe, expect, it } from 'vitest';
import { pickActiveReader } from '../src/view/active-reader';

interface FakeReader {
  kind: 'reader';
  currentBookId: string;
}

const isReader = (v: unknown): v is FakeReader =>
  !!v && typeof v === 'object' && (v as { kind?: string }).kind === 'reader';
const bookIdOf = (v: FakeReader): string => v.currentBookId;

function reader(id: string): FakeReader {
  return { kind: 'reader', currentBookId: id };
}

describe('activeReader 的选择顺序（A-25）', () => {
  it('活动视图是阅读视图时直接用它', () => {
    const active = reader('b2');
    const got = pickActiveReader(
      active,
      [{ view: reader('b1') }, { view: active }],
      'b1',
      isReader,
      bookIdOf,
    );
    expect(got).toBe(active);
  });

  it('没有活动视图时按 activeReaderId 找 currentBookId 匹配的 leaf', () => {
    const a = reader('b1');
    const b = reader('b2');
    const got = pickActiveReader(null, [{ view: a }, { view: b }], 'b2', isReader, bookIdOf);
    expect(got).toBe(b);
  });

  it('activeReaderId 过期时回退到第一个阅读视图', () => {
    const a = reader('b1');
    const b = reader('b2');
    expect(pickActiveReader(null, [{ view: a }, { view: b }], 'gone', isReader, bookIdOf)).toBe(a);
    expect(pickActiveReader(null, [{ view: a }, { view: b }], null, isReader, bookIdOf)).toBe(a);
  });

  it('非阅读视图永远不会被返回（包括伪装的 DeferredView）', () => {
    const fake = { getViewType: () => 'bzr-reader-view' };
    expect(pickActiveReader(fake, [{ view: fake }], 'x', isReader, bookIdOf)).toBeNull();
  });
});
