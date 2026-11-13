/**
 * 剪藏成书 · 图片寻址（tests/clip-asset.test.ts）
 *
 * 真机 bug（2026-11-13 截图）：剪藏文章正文里的图是 `![[xxx.jpg]]` 短名，
 * 文件实际在 bz 的图片文件夹（如 CONFIG/APPENDIX），阅读器却只按库根路径
 * 找，找不到就落成「[图片]」占位——整篇文章的图全丢。
 *
 * 解析顺序（由准到宽）：
 *   1. 正文里写了目录（`附件/a.jpg`）→ 按库内路径直查；
 *   2. 短名 → 交给 Obsidian 的链接解析（它知道同名附件在哪个目录）；
 *   3. 仍找不到 → 全库按文件名兜底（老库、索引未就绪时）。
 */
import { describe, expect, it } from 'vitest';
import { pickClipImageFile, type ClipAssetLookup } from '../src/data/clip-asset';

interface F {
  path: string;
  name: string;
}

function lookup(files: F[], opts: { link?: (n: string) => F | null } = {}): ClipAssetLookup<F> & { calls: string[] } {
  const calls: string[] = [];
  const byPath = (p: string): F | null => {
    calls.push(`path:${p}`);
    return files.find((f) => f.path === p) ?? null;
  };
  const byLink = (n: string): F | null => {
    calls.push(`link:${n}`);
    return opts.link ? opts.link(n) : null;
  };
  return {
    calls,
    byPath,
    byLink,
    all: () => files,
  };
}

describe('pickClipImageFile', () => {
  it('正文带目录：按路径直查命中，不再走链接解析', () => {
    const files: F[] = [{ path: 'CONFIG/APPENDIX/a.jpg', name: 'a.jpg' }];
    const lk = lookup(files);
    expect(pickClipImageFile(lk, 'CONFIG/APPENDIX/a.jpg')).toEqual(files[0]);
    expect(lk.calls).toEqual(['path:CONFIG/APPENDIX/a.jpg']);
  });

  it('短名（真机场景）：路径直查落空，链接解析找到图片文件夹里的文件', () => {
    const files: F[] = [{ path: 'CONFIG/APPENDIX/a.jpg', name: 'a.jpg' }];
    const lk = lookup(files, { link: (n) => files.find((f) => f.name === n) ?? null });
    expect(pickClipImageFile(lk, 'a.jpg')).toEqual(files[0]);
  });

  it('链接解析也落空（索引未就绪 / 老库）：全库按文件名兜底', () => {
    const files: F[] = [
      { path: '归档/网页剪藏/a.jpg', name: 'a.jpg' },
      { path: 'CONFIG/APPENDIX/b.jpg', name: 'b.jpg' },
    ];
    const lk = lookup(files);
    expect(pickClipImageFile(lk, 'a.jpg')).toEqual(files[0]);
  });

  it('同名多份时取第一个，不随机跳', () => {
    const files: F[] = [
      { path: 'x/a.jpg', name: 'a.jpg' },
      { path: 'y/a.jpg', name: 'a.jpg' },
    ];
    const lk = lookup(files);
    expect(pickClipImageFile(lk, 'a.jpg')).toEqual(files[0]);
  });

  it('全找不到返回 null（调用方渲染占位）', () => {
    const lk = lookup([]);
    expect(pickClipImageFile(lk, 'missing.jpg')).toBeNull();
  });

  it('空名 / 纯空白返回 null，不白跑三次查询', () => {
    const lk = lookup([]);
    expect(pickClipImageFile(lk, '')).toBeNull();
    expect(pickClipImageFile(lk, '   ')).toBeNull();
    expect(lk.calls).toEqual([]);
  });

  it('反斜杠路径归一成 Obsidian 的斜杠路径', () => {
    const files: F[] = [{ path: 'CONFIG/APPENDIX/a.jpg', name: 'a.jpg' }];
    const lk = lookup(files);
    expect(pickClipImageFile(lk, 'CONFIG\\APPENDIX\\a.jpg')).toEqual(files[0]);
  });

  it('带 ./ 前缀的路径也能直查', () => {
    const files: F[] = [{ path: 'pics/a.png', name: 'a.png' }];
    const lk = lookup(files);
    expect(pickClipImageFile(lk, './pics/a.png')).toEqual(files[0]);
  });
});
