import { describe, expect, it } from 'vitest';
import { TFolder } from 'obsidian';
import { FolderPickModal } from '../src/core/folder-pick';

function folder(path: string): TFolder {
  const f = new TFolder();
  f.path = path;
  return f;
}

/**
 * Obsidian 的 `FuzzySuggestModal.selectSuggestion` 是「先 close、后
 * onChooseItem」。以前 `onClose` 立刻 settle(null) 并上锁，真正的选择
 * 全被吞掉——三个目录选择器点了等于没点。
 */
describe('FolderPickModal：关闭不能吞掉选择', () => {
  it('先 close 后 onChooseItem 的顺序下仍返回选中路径', async () => {
    const m = new FolderPickModal({} as never, '/old');
    const p = m.pick();
    m.onClose();
    m.onChooseItem(folder('new/dir'));
    await expect(p).resolves.toBe('new/dir');
  });

  it('真正的取消（只 close 不选）返回 null', async () => {
    const m = new FolderPickModal({} as never, '/old');
    const p = m.pick();
    m.onClose();
    await expect(p).resolves.toBeNull();
  });

  it('选库根目录返回 /', async () => {
    const m = new FolderPickModal({} as never, '/old');
    const p = m.pick();
    m.onClose();
    m.onChooseItem(folder(''));
    await expect(p).resolves.toBe('/');
  });
});
