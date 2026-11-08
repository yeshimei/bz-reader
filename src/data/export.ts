/* ============================================================
 * bz-reader · 标注导出（data/export.ts）
 *
 * 一本书 → 一份 Markdown。导出的东西必须能当笔记直接用，而不是
 * 「数据 dump 到一个 .md 里」：
 *   · frontmatter 带书名/作者/进度/条数，Obsidian 的搜索与 Dataview 才认；
 *   · 按章节分组，组内按书中位置排——顺序乱了，读第二遍时对不上；
 *   · 想法压在引用下面一行，不缩进、不套 callout，正文里能直接读。
 *
 * 三条不做的事：
 *   1. **不覆盖别人的笔记**。同名文件若不含本插件的标记，改名让开
 *      （`书名 (2).md`）。用户手写的读书笔记被一次导出冲掉是灾难。
 *   2. **不增量追加**。每次整份重写：增删改划线之后，追加会让同一段
 *      原文在文件里出现两遍，而用户没法判断哪条是删掉的。
 *   3. **不碰原文**。摘录里带 `>`、`#`、`*` 一律不转义（引用块里是安全的），
 *      但会把换行压平——多行摘录在 blockquote 里会断成两块，读起来像两条。
 * ============================================================ */
import type { App } from 'obsidian';
import type { KbLink, ReaderBook } from './schema';
import type { ReaderSettings } from './settings';
import { bookmarksOf, highlightsOf } from './notes';
import { kbLinkMarkdown } from './kb-link';
import { t } from '../i18n';

/** 导出文件第一行。再次导出靠它判断「这份是不是我们写的」 */
const MARK = '<!-- bz-reader:export -->';

export interface ExportResult {
  /** vault 相对路径 */
  path: string;
  highlights: number;
  bookmarks: number;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function stamp(ts: number): string {
  const d = new Date(ts);
  return `${ymd(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * YAML 双引号值。
 *
 * 换行必须压平：dc:title / dc:creator 来自导入的 EPUB（外部文件，不可信），
 * `title: "x"\n恶意键: 1` 能截断引号串、注入 frontmatter，甚至用 `---` 提前
 * 结束整个头部。书名里的换行本来也没有保留意义。
 */
function yamlStr(v: string): string {
  const one = String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+/g, ' ');
  return `"${one.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Windows 上「有名字也不能用」的那些：带扩展名一样被系统挡住 */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 文件名里不能出现的字符。斜杠留着会变成目录，必须换掉。
 *
 * 另外三件事，都是「文件在 vault 里建不出来 / 建到别处」的真实故障：
 *   · Windows 保留名（`CON` / `NUL` / `COM1`…）：`CON.md` 在 Windows 上写不进去，
 *     导出直接抛错，用户只看到「导出失败」；
 *   · 控制字符：换行会把文件名断成两截，`\u0000` 让整个 write 抛；
 *   · 结尾的点和空格：Windows 会静默吃掉，`书.` 和 `书` 变成同一个文件。
 *
 * 首尾的点也一并去掉：`..` / `.hidden` 不想让导出悄悄写出隐藏文件。
 *
 * 导出给 shell 复用（`appendToExport` 追加导出到同一个目录），两处规则必须
 * 一模一样——否则同一本书在两个入口下会落成两个文件名，用户看到两份笔记。
 */
export function safeName(name: string, fallback = '未命名'): string {
  const s = Array.from(String(name ?? ''))
    /* 控制字符逐个换空格，不写成正则：`no-control-regex` 会拦它，
       而这里本来也不需要正则（字符集只有 32 个码位）。 */
    .map((ch) => (ch.codePointAt(0)! < 0x20 ? ' ' : ch))
    .join('')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!s) return fallback;
  return WIN_RESERVED.test(s) ? `_${s}` : s;
}


/** 多行摘录压成一行：引用块里换行会被当成两段 */
function oneLine(text: string): string {
  let s = text.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  // 中文之间的换行不该变成空格：`她转过身， 没有回头` 读起来像多打了个空格。
  // 只在两侧都是全角字符时吃掉这个空格，英文单词之间照旧保留。
  s = s.replace(/([\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])\s+(?=[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])/g, '$1');
  return s;
}

interface Group {
  key: string;
  title: string;
  order: number;
  items: Array<{ text: string; comment?: string; kb?: KbLink[]; createdAt: number }>;
}

export function buildNotesMarkdown(book: ReaderBook, settings: ReaderSettings, now = Date.now()): string {
  const highlights = highlightsOf(book);
  const bookmarks = bookmarksOf(book);
  const percent = Math.round((book.reading.position.percent || 0) * 100);
  const author = book.meta.author?.trim() || '';

  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: ${yamlStr(book.meta.title)}`);
  /* bookId 是「同名书认领自己那份导出」的唯一依据（A-16）：
     两本都叫《活着》时，只按书名找文件会让后导出的那本覆盖前一本。 */
  lines.push(`bookId: ${yamlStr(book.id)}`);
  if (author) lines.push(`author: ${yamlStr(author)}`);
  lines.push(`progress: ${percent}`);
  lines.push(`highlights: ${highlights.length}`);
  lines.push(`bookmarks: ${bookmarks.length}`);
  lines.push(`exported: ${ymd(now)}`);
  lines.push('tags:');
  lines.push('  - 书摘');
  lines.push('---');
  lines.push(MARK);
  lines.push('');
  lines.push(`# ${oneLine(book.meta.title)}`);
  lines.push('');

  const sub = [oneLine(author || ''), `读到 ${percent}%`, `${highlights.length} 条划线`, bookmarks.length ? `${bookmarks.length} 个书签` : '']
    .filter(Boolean)
    .join(' · ');
  lines.push(`> ${sub}`);
  lines.push('');

  /* 按章分组：章号相同归一组；没有章号的（老数据、TXT）统一落到最后 */
  const groups = new Map<string, Group>();
  for (const h of highlights) {
    const title = (h.chapterTitle || '').trim() || '未标注章节';
    const index = typeof h.chapterIndex === 'number' ? h.chapterIndex : Number.MAX_SAFE_INTEGER;
    const key = `${index}\u0000${title}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, title, order: index, items: [] };
      groups.set(key, g);
    }
    g.items.push({ text: oneLine(h.text), comment: h.comment?.trim(), kb: h.kb, createdAt: h.createdAt });
  }

  const ordered = [...groups.values()].sort((a, b) => a.order - b.order);
  for (const g of ordered) {
    g.items.sort((a, b) => a.createdAt - b.createdAt);
  }

  for (const g of ordered) {
    if (!g.items.length) continue;
    /* 章标题可能带换行（EPUB 里标题常被拆成两行），直接插进 `## ` 会把
       下面那半句变成正文段落（P3-08）。压成一行再进标题。 */
    lines.push(`## ${oneLine(g.title)}`);
    lines.push('');
    g.items.forEach((it, i) => {
      if (i > 0) lines.push('');
      lines.push(`> ${it.text}`);
      if (settings.exportComments && it.comment) {
        lines.push('');
        lines.push(`想法：${oneLine(it.comment)}`);
      }
      /* 知识盒链接单独一行：它不算想法（导出时不受「带想法」开关影响——
         没有这一行，导出到库里的笔记就看不出这段存过名词 / 段落了）。 */
      for (const kb of it.kb ?? []) {
        const link = kbLinkMarkdown(kb.path);
        if (!link) continue;
        lines.push('');
        lines.push(`${t(kb.kind === 'term' ? 'export.kb.term' : 'export.kb.passage')}：${link}`);
      }
    });
    lines.push('');
  }

  if (bookmarks.length) {
    lines.push('## 书签');
    lines.push('');
    const sorted = [...bookmarks].sort((a, b) => (a.percent || 0) - (b.percent || 0));
    for (const b of sorted) {
      const where = b.chapterTitle ? oneLine(b.chapterTitle) : '';
      const p = `${Math.round((b.percent || 0) * 100)}%`;
      // 书签标签同理：带换行会把一条列表拆成两条（P3-08）
      const label = b.label ? oneLine(b.label) : '';
      const parts = [`**${p}**`, where, label, ymd(b.createdAt)].filter(Boolean);
      lines.push(`- ${parts.join(' · ')}`);
    }
    lines.push('');
  }

  if (!highlights.length && !bookmarks.length) {
    lines.push('_这本书还没有划线或书签。_');
    lines.push('');
  }

  return lines.join('\n');
}

/** 取 frontmatter 段；没有头部就是空串（正文里恰好以 bookId: 开头的行不算） */
function frontmatterOf(text: string): string {
  if (!text.startsWith('---')) return '';
  const end = text.indexOf('\n---', 3);
  return end < 0 ? '' : text.slice(0, end);
}

/** 从已有导出里读回 bookId；没有就是空串（旧版导出、别人的笔记） */
function bookIdOf(text: string): string {
  const m = /^bookId:\s*(.+)$/m.exec(frontmatterOf(text));
  if (!m) return '';
  let v = m[1].trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  } else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    v = v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

/**
 * 目标路径：`<exportDir>/<书名>.md`；同名文件不是这本书的就往后让。
 *
 * 判断「是不是这本书的」只认 frontmatter 里的 bookId + 插件标记。
 * 旧版导出没有 bookId，按「不是同一本」处理——宁可多出一份 `(2)`，
 * 也不能让两本同名书继续互相覆盖（A-16 的取舍，升级后首次导出会见到一次）。
 */
async function resolveTarget(app: App, dir: string, book: ReaderBook): Promise<string> {
  const base = safeName(book.meta.title);
  const adapter = app.vault.adapter;
  for (let n = 1; n <= 50; n += 1) {
    const name = n === 1 ? base : `${base} (${n})`;
    const path = joinPath(dir, `${name}.md`);
    if (!(await adapter.exists(path))) return path;
    // 这本书自己写的：覆盖。别人的（或认不出是哪本的）：让开
    try {
      const text = await adapter.read(path);
      if (text.includes(MARK) && bookIdOf(text) === book.id) return path;
    } catch {
      /* 读不出来就别赌它是不是自己的：以前这里 `return path`，等于「读失败 →
         覆盖」。一次权限抖动 / 同步锁文件就能把别人的同名笔记整份冲掉，
         而用户看到的结果是「导出成功」。让开，换下一个候选名。 */
      continue;
    }
  }
  return joinPath(dir, `${base} (${Date.now()}).md`);
}

/** 空目录 = 库根。直接拼 `${dir}/${name}` 会得到 `/书.md`（绝对路径），写不进去 */
function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

async function ensureDir(app: App, dir: string): Promise<void> {
  const adapter = app.vault.adapter;
  const parts = dir.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    if (!(await adapter.exists(acc))) {
      try {
        await adapter.mkdir(acc);
      } catch {
        /* 并发建目录时可能already exists，忽略 */
      }
    }
  }
}

/**
 * 导出并落盘。调用方负责提示结果（这里不弹通知，保持数据层不碰 UI）。
 * 没有划线也没有书签时返回 null——不生成一份只有标题的空笔记。
 */
export async function exportBookNotes(
  app: App,
  book: ReaderBook,
  settings: ReaderSettings,
  now = Date.now(),
): Promise<ExportResult | null> {
  const highlights = highlightsOf(book);
  const bookmarks = bookmarksOf(book);
  if (!highlights.length && !bookmarks.length) return null;

  /* '/' 与空串都是「库根」（见 data/settings.ts 的 cleanDir）。
     去掉斜杠之后变成空串就退回默认目录的话，用户显式选的根目录会被
     悄悄换成 `bz-reader/notes`——他找了半天以为导出没成功。 */
  const raw = String(settings.exportDir ?? '').trim();
  const dir = raw === '' || raw === '/' ? '' : raw.replace(/^\/+|\/+$/g, '');
  await ensureDir(app, dir);
  const path = await resolveTarget(app, dir, book);
  const text = buildNotesMarkdown(book, settings, now);
  /* 原子写（P3-19）：直接 `adapter.write` 是「打开正本、截断、写入」，
     中途崩溃/盘满就留半截 Markdown。先写 .tmp 再改名，要么旧要么新。
     rename 不覆盖目标的平台（部分移动端）退回就地写。 */
  const tmp = `${path}.tmp`;
  try {
    await app.vault.adapter.write(tmp, text);
    await app.vault.adapter.rename(tmp, path);
  } catch {
    await app.vault.adapter.write(path, text);
    await app.vault.adapter.remove(tmp).catch(() => undefined);
  }
  return { path, highlights: highlights.length, bookmarks: bookmarks.length };
}

/** 导出的文件最后一行写了什么，测试与「已导出」提示都要用 */
export function exportStampOf(markdown: string): string {
  const m = markdown.match(/^exported: (.+)$/m);
  return m ? m[1].trim() : '';
}

export { MARK as EXPORT_MARK, stamp as formatExportStamp, ymd as formatDay };
