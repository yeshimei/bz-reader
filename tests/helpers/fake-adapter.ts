/**
 * 内存版 vault adapter。
 *
 * 只实现 store / migrate 真正调用的那几个方法；用来验证「写盘失败时的退路」
 * 这类不靠真机就说不清的行为。可注入 rename 失败，模拟移动端
 * 「rename 不覆盖目标」的平台差异。
 */
export class FakeAdapter {
  files = new Map<string, string>();
  dirs = new Set<string>();
  writes: string[] = [];
  renames: Array<[string, string]> = [];

  constructor(private opts: { renameFails?: number } = {}) {}

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT: no such file or directory, ${path}`);
    return v;
  }

  async write(path: string, data: string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, data);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT: no such file or directory, ${path}`);
    return new TextEncoder().encode(v).buffer as ArrayBuffer;
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, new TextDecoder().decode(data));
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.opts.renameFails && this.opts.renameFails > 0) {
      this.opts.renameFails -= 1;
      throw new Error('EPERM: rename not supported');
    }
    const v = this.files.get(from);
    if (v === undefined) throw new Error(`ENOENT: no such file or directory, ${from}`);
    this.files.delete(from);
    this.files.set(to, v);
    this.renames.push([from, to]);
  }

  async stat(path: string): Promise<{ size: number; mtime: number; ctime: number; type: 'file' }> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT: no such file or directory, ${path}`);
    return { size: v.length, mtime: 0, ctime: 0, type: 'file' };
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = `${path.replace(/\/+$/, '')}/`;
    const files: string[] = [];
    const folders = new Set<string>();
    for (const p of this.files.keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) files.push(p);
      else folders.add(`${prefix}${rest.slice(0, slash)}`);
    }
    return { files, folders: [...folders] };
  }

  async rmdir(path: string, recursive?: boolean): Promise<void> {
    const prefix = `${path.replace(/\/+$/, '')}/`;
    for (const p of [...this.files.keys()]) if (p.startsWith(prefix)) this.files.delete(p);
    if (recursive) for (const d of [...this.dirs]) if (d === path || d.startsWith(prefix)) this.dirs.delete(d);
  }
}
