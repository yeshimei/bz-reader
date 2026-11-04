/* ============================================================
 * bz-reader · 封面缓存文件名（data/cover-name.ts）
 *
 * 封面缓存原来叫 `<bookId>-<size>`（没有扩展名），只有插件自己认识。
 * 但这份数据文件还要被外部（bz 书库）读，`meta.coverPath` 必须是一条
 * **能直接当 vault 图片路径用**的值：没有扩展名时，app:// 资源按扩展名
 * 推 MIME，`<img>` 拿到 octet-stream 就渲染不出来。
 *
 * 所以这里把「mime ↔ 扩展名」「索引读写」抽成纯函数：
 * cover.ts 负责 IO，本文件负责命名，两件事可以分开测。
 *
 * 索引格式向后兼容：
 *   v1  `{ "<key>": "<mime>" }`                 （旧缓存，文件无扩展名）
 *   v2  `{ "<key>": { mime, file } }`           （新缓存，src 里带扩展名）
 * ============================================================ */

export interface CoverIndexEntry {
  /** 图片 MIME（`image/jpeg` 等） */
  mime: string;
  /** 缓存目录内的文件名（相对路径） */
  file: string;
}

export type CoverIndex = Record<string, CoverIndexEntry>;

/** MIME → 扩展名；认不出按 jpg 处理（EPUB 封面绝大多数是 JPEG） */
export function extOfMime(mime: string): string {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('svg')) return 'svg';
  if (m.includes('avif')) return 'avif';
  return 'jpg';
}

/** 缓存文件名：`<bookId>-<size>.<ext>` */
export function coverFileName(key: string, mime: string): string {
  return `${key}.${extOfMime(mime)}`;
}

/**
 * 规范化索引。坏值（数字、空 mime）直接丢弃——留着只会在读缓存时抛错。
 * 旧格式的 `file` 就是 key（当时文件无扩展名），这样老用户已经解出来的封面
 * 不会因为升级白丢一次。
 */
export function normalizeCoverIndex(raw: unknown): CoverIndex {
  if (!raw || typeof raw !== 'object') return {};
  const out: CoverIndex = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) continue;
    if (typeof value === 'string') {
      const mime = value.trim();
      if (mime) out[key] = { mime, file: key };
      continue;
    }
    if (value && typeof value === 'object') {
      const rec = value as { mime?: unknown; file?: unknown };
      const mime = typeof rec.mime === 'string' ? rec.mime.trim() : '';
      if (!mime) continue;
      const file = typeof rec.file === 'string' && rec.file.trim() ? rec.file.trim() : key;
      out[key] = { mime, file };
    }
  }
  return out;
}
