/**
 * 侧栏 AI · 连接笔记浮层：纯计算层。
 *
 * 只做三件事：按所在目录分组、维护勾选集合、在全库笔记里按词找。
 * 不碰 DOM 也不读 Obsidian API，才能在 node 里直接断言行为。
 */

export interface PickerNote {
  title: string;
  path: string;
  /** 所在目录，根目录下的笔记为空串 */
  desc: string;
}

export interface NoteGroup {
  group: string;
  rows: PickerNote[];
}

/** 默认只画最近修改的这些行；全库几千篇一次性塞进 DOM 会卡住侧栏 */
export const NOTE_PICKER_ROWS = 40;
/** 搜到很多时最多给这些行，够找了 */
export const NOTE_SEARCH_LIMIT = 60;

/** 按所在目录分组，组与组按第一次出现的顺序排，组内保持原顺序 */
export function groupNotes(rows: readonly PickerNote[]): NoteGroup[] {
  const out: NoteGroup[] = [];
  const at = new Map<string, NoteGroup>();
  for (const row of rows) {
    const key = row.desc ?? '';
    let g = at.get(key);
    if (!g) {
      g = { group: key, rows: [] };
      at.set(key, g);
      out.push(g);
    }
    g.rows.push(row);
  }
  return out;
}

/** 切换一条笔记的选中状态；返回新数组，不改入参 */
export function togglePicked(picked: readonly string[], path: string): string[] {
  return picked.includes(path) ? picked.filter((p) => p !== path) : [...picked, path];
}

/**
 * 全库过滤：标题、路径、所在目录任意一处命中即可。
 * 没关键词时按原顺序取前 limit 条（调用方传进来的已经是最近修改顺序）。
 */
export function searchNotes(
  rows: readonly PickerNote[],
  kw: string,
  limit: number,
): PickerNote[] {
  const key = kw.trim().toLowerCase();
  if (!key) return rows.slice(0, limit);
  const out: PickerNote[] = [];
  for (const row of rows) {
    const hay = `${row.title} ${row.path} ${row.desc ?? ''}`.toLowerCase();
    if (!hay.includes(key)) continue;
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}
