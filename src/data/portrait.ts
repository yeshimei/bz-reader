/* ============================================================
 * bz-reader · 全书画像（data/portrait.ts）
 *
 * 「全书」这一档要的东西：把一本书变成可以检索或可通读的依据。只做数据与纯计算，
 * 不碰 UI、不碰网络（建画像的流程在 data/portrait-build.ts）。
 *
 * 落点（用户拍板）：**跟库走、单独一个文件**——`<数据目录>/portraits/<书 id>.json`。
 *   · 不进 `bz-reader.json`：那是一份要被 bz 读、被用户备份、被同步的数据契约，
 *     往里塞几十块向量会让它变成几百 KB 的二进制垃圾场；
 *   · 不进 bz 的向量库：那是笔记的索引，书的切片混进去会污染检索结果，
 *     而且两边的重建节奏完全不同（换书版本 = 另一本书，笔记是长期资产）。
 *
 * 两种方案共用一个文件形状，`plan` 决定块里装什么：
 *   vector   → 每块一份向量（base64 的 Float32Array，比 JSON 数组省四分之三体积）
 *   compress → 每块一句「一句话」+ 一段「要点」，问答时带整份要点
 *
 * 换版本 = 另一本书：id 变了就是另一份文件，不做迁移、不做自动清理（另留「清理无主」）。
 * ============================================================ */
import type { App } from 'obsidian';
import { storageDirOf } from '../core/plugin-path';
import type { ReaderBook } from './schema';

export type PortraitPlan = 'vector' | 'compress';

/**
 * 每块多少字。
 *
 * 两个方案的口径**故意不同**：
 *   · 向量方案要细：嵌入模型吃 8k token 但检索粒度跟着块大小走，块越大越糊；
 *     1000 字一块，一次问「这个概念哪里讲过」才可能指到具体那一段。
 *   · 压缩方案要粗：每一块都是一次大模型请求，按用户自己的 Key 计费，
 *     8000 字一块能把一本 30 万字的书压到三四十次请求。
 * 文档写的「建议 8000 字一块，实现时可微调」，微调的就是这一处。
 */
export const PORTRAIT_CHUNK_CHARS: Record<PortraitPlan, number> = {
  vector: 1000,
  compress: 8000,
};

export const PORTRAIT_VERSION = 1;

/** 画像目录（数据目录下的子目录） */
export const PORTRAIT_DIR = 'portraits';

/** 一问带几块依据（向量方案） */
export const PORTRAIT_TOP_K = 6;

/** 压缩方案带进上下文的字数上限（够讲清全书，又不至于把长书整份塞爆） */
export const PORTRAIT_EVIDENCE_LIMIT = 12000;

export interface ChapterText {
  title: string;
  text: string;
}

export interface PortraitBlock {
  /** 所属章节（块的第一段出自哪一章）——来源列表与鸟瞰的章节摘要都靠它 */
  chapter: string;
  chars: number;
  /** vector：base64(Float32Array)，见 encodeVector */
  vec?: string;
  /** compress：一句话（鸟瞰/章摘要用） */
  digest?: string;
  /** compress：要点（问答用） */
  summary?: string;
  /** 这一块上次失败的原因（重试之前留个痕，界面上能说清为什么少了一块） */
  error?: string;
  /**
   * 这一块的原文（**只给向量方案存**）。
   *
   * 向量本身答不了问题：检索出最相关的八块之后，要拿原文去拼上下文。
   * 不存的话，每次提问都得把整本书重新解析一遍——那是一分钟的等待。
   * 压缩方案不存：它的 summary 本身就是可读的依据，再留一份原文纯属翻倍。
   */
  text?: string;
}

export interface PortraitFile {
  version: 1;
  bookId: string;
  bookTitle: string;
  plan: PortraitPlan;
  /** 产出向量的嵌入模型名（vector 方案）或压缩用的对话模型名（compress 方案） */
  model: string;
  /** 向量维度（vector 方案；换模型维度就变，要重建） */
  dim?: number;
  /** 建的时候用的块大小（改了口径就能看出这份文件是旧尺子切的） */
  chunkChars: number;
  total: number;
  blocks: PortraitBlock[];
  /** compress：全书总述（最后那一次「合成」请求的产物；问答与详情页都用它开头） */
  overview?: string;
  createdAt: number;
  updatedAt: number;
  /** false = 建到一半（可续跑）；true = 全部块都拿到了内容 */
  done: boolean;
}

export interface PortraitChunk {
  chapter: string;
  text: string;
  chars: number;
}

/* ─────────── 切块（纯函数） ─────────── */

function normalizeText(raw: string): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 段落优先的硬切：单段就超长（整章没有换行）时按字数切开，不在句中硬断在半个词上做不到，只能按字数 */
function splitParagraph(para: string, size: number): string[] {
  if (para.length <= size) return [para];
  const out: string[] = [];
  for (let i = 0; i < para.length; i += size) out.push(para.slice(i, i + size));
  return out;
}

/**
 * 按字数切块，**章节只当边界参考**（用户拍板的口径）。
 *
 * 具体规则：
 *   1. 章内的段落（换行分隔）尽量整段进块，装不下就换块；单段超长才硬切；
 *   2. 跨章可以合并——短章节（前言、致谢）各自成块纯属浪费一次嵌入/请求；
 *   3. 但新章开始时，如果当前块已经过半，就收口换块：章首是天然的语义分界，
 *      粘在上一章尾巴里会让检索结果指错章。
 *
 * `chapter` 取这一块**第一段**所属的章节——后续来源列表按它显示「出自第几章」。
 */
export function chunkChapters(chapters: ChapterText[], size: number): PortraitChunk[] {
  const limit = Math.max(200, Math.floor(size) || PORTRAIT_CHUNK_CHARS.compress);
  const out: PortraitChunk[] = [];
  let buf = '';
  let bufChapter = '';

  const flush = (): void => {
    const text = buf.trim();
    if (text) out.push({ chapter: bufChapter, text, chars: text.length });
    buf = '';
    bufChapter = '';
  };

  for (const chapter of chapters ?? []) {
    const title = String(chapter?.title ?? '').trim();
    const body = normalizeText(chapter?.text ?? '');
    if (!body) continue;
    /* 章首：块已经过半就收口，让这一章从头开始 */
    if (buf && buf.length >= limit * 0.5) flush();
    const paras = body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    for (const para of paras) {
      for (const piece of splitParagraph(para, limit)) {
        if (buf && buf.length + piece.length + 1 > limit) flush();
        if (!buf) bufChapter = title;
        buf = buf ? `${buf}\n${piece}` : piece;
      }
    }
  }
  flush();
  return out;
}

/* ─────────── 预估 ─────────── */

/**
 * 估全书字数。
 *
 * 拿不到真字数：`meta.wordCount` 对 EPUB 记的是**章节文件字节数**（含标签），
 * 对 TXT 才是字符数。这里按格式折算，只求量级对——界面上写的是「约 N 块」，
 * 真块数在开始跑、切完块之后立刻纠正。
 */
export function estimateChars(book: Pick<ReaderBook, 'meta' | 'fileRef'> | null | undefined): number {
  const raw = Number(book?.meta?.wordCount) || 0;
  if (raw > 0) {
    /* UTF-8 中文 3 字节/字 + XHTML 标签，实测折算系数约 2.6；保守取 2.5（宁可高估） */
    return book?.fileRef?.format === 'txt' ? raw : Math.round(raw / 2.5);
  }
  const bytes = Number(book?.fileRef?.size) || 0;
  return bytes > 0 ? Math.round(bytes / 4) : 0;
}

/** 约多少块（0 字数也返回 1：空书也要有个「一块」的说法，免得界面出现 0 次请求） */
export function estimateBlocks(chars: number, plan: PortraitPlan): number {
  const size = PORTRAIT_CHUNK_CHARS[plan];
  return Math.max(1, Math.ceil(Math.max(0, chars) / size));
}

/**
 * 一次「开始」会发出多少次请求。
 *
 *   vector   → 嵌入按批走，界面上说「约 N 次嵌入请求」；
 *   compress → 每块一次对话，外加最后一次把块摘要合成全书总述。
 * 这两个数只用来让用户判断「值不值」，真实次数以运行时的进度为准。
 */
export function estimateRequests(blocks: number, plan: PortraitPlan, batch = 8): number {
  const n = Math.max(1, Math.floor(blocks) || 1);
  return plan === 'vector' ? Math.ceil(n / Math.max(1, batch)) : n + 1;
}

/* ─────────── 向量编解码 / 相似度 ─────────── */

/** Float32 → base64（little-endian）。JSON 里一份 1024 维向量约 5.5 KB，不编码要 10 KB+ */
export function encodeVector(vec: ArrayLike<number>): string {
  const f = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) f[i] = Number(vec[i]) || 0;
  const buf = new ArrayBuffer(f.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < f.length; i += 1) view.setFloat32(i * 4, f[i], true);
  const bytes = new Uint8Array(buf);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
  }
  try {
    return btoa(s);
  } catch {
    return '';
  }
}

/** base64 → Float32Array；坏数据返回空数组（不抛：一份坏块不该让整本书问不了） */
export function decodeVector(raw: string | undefined | null): Float32Array {
  const s = String(raw ?? '').trim();
  if (!s) return new Float32Array(0);
  try {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const out = new Float32Array(Math.floor(bytes.length / 4));
    for (let i = 0; i < out.length; i += 1) out[i] = view.getFloat32(i * 4, true);
    return out;
  } catch {
    return new Float32Array(0);
  }
}

/** 余弦相似度；任一向量为空 / 全零（模长 0）返回 0，不产生 NaN */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a?.length ?? 0, b?.length ?? 0);
  if (!n) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!(na > 0) || !(nb > 0)) return 0;
  return dot / Math.sqrt(na * nb);
}

/** 向量方案：按相似度取前 k 块（含分数，来源列表要显示出自哪一章） */
export function topBlocksByVector(
  p: PortraitFile,
  query: ArrayLike<number>,
  k = PORTRAIT_TOP_K,
): Array<{ block: PortraitBlock; index: number; score: number }> {
  const q = query ?? [];
  if (!q.length) return [];
  const scored = (p.blocks ?? [])
    .map((block, index) => ({ block, index, score: cosine(decodeVector(block.vec), q) }))
    .filter((x) => x.block.vec && x.score > 0);
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, Math.max(1, k));
}

/**
 * 向量方案：命中块的原文拼成依据。
 *
 * 老画像（2026-11-07 之前建的）没有存原文，只能退回 digest / summary——
 * 这时答得浅，但不至于一个字都没有。
 */
export function blocksEvidence(
  p: PortraitFile,
  picks: Array<{ block: PortraitBlock }>,
  limit = PORTRAIT_EVIDENCE_LIMIT,
): string {
  const parts: string[] = [];
  let chapter = '';
  for (const { block } of picks) {
    const body = (block.text || block.summary || block.digest || '').trim();
    if (!body) continue;
    if (block.chapter && block.chapter !== chapter) {
      chapter = block.chapter;
      parts.push(`【${chapter}】`);
    }
    parts.push(body);
  }
  const whole = parts.join('\n');
  return whole.length <= limit ? whole : `${whole.slice(0, limit)}\n…`;
}

/* ─────────── 问答依据 ─────────── */

/**
 * 压缩方案：把整份要点拼成依据。
 *
 * 超长时**头尾各留一段**而不是从头截断：书的开头给背景、结尾给结论，
 * 只留开头会让「这本书讲了什么」答成半本书。
 */
export function compressEvidence(p: PortraitFile, limit = PORTRAIT_EVIDENCE_LIMIT): string {
  const parts: string[] = [];
  const overview = (p.overview || '').trim();
  if (overview) parts.push(`【全书总述】\n${overview}`);
  let chapter = '';
  for (const block of p.blocks ?? []) {
    const body = (block.summary || block.digest || '').trim();
    if (!body) continue;
    if (block.chapter && block.chapter !== chapter) {
      chapter = block.chapter;
      parts.push(`【${chapter}】`);
    }
    parts.push(body);
  }
  const whole = parts.join('\n');
  if (whole.length <= limit) return whole;
  const head = Math.floor(limit * 0.7);
  return `${whole.slice(0, head)}\n…（中段省略）…\n${whole.slice(whole.length - (limit - head))}`;
}

/** 每章一句话（鸟瞰页用它替代「这一章只有几条划线」的空洞） */
export function chapterDigests(p: PortraitFile): Array<{ chapter: string; line: string }> {
  const seen = new Map<string, string>();
  for (const block of p.blocks ?? []) {
    const chapter = (block.chapter || '').trim();
    const line = (block.digest || '').trim();
    if (!chapter || !line || seen.has(chapter)) continue;
    seen.set(chapter, line);
  }
  return [...seen.entries()].map(([chapter, line]) => ({ chapter, line }));
}

/**
 * 从一段摘要里取「一句话」。
 *
 * 压缩方案块级请求只发一次（省一次调用），返回的整段既是问答依据，
 * 又要拆出一句给鸟瞰用。拆的规则就一条：第一个句末标点为止，最长 60 字——
 * 鸟瞰那一列只有半行宽，长了会换行把表格撑歪。
 */
export function firstSentence(text: string, max = 60): string {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  const m = s.match(/^[^。！？!?\n]{4,}?[。！？!?]/);
  const one = (m ? m[0] : s).trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/* ─────────── 状态 ─────────── */

/** none = 没建；building = 建到一半；ready = 可用；stale = 嵌入模型换了，向量不可比 */
export type PortraitState = 'none' | 'building' | 'ready' | 'stale';

export function portraitState(p: PortraitFile | null | undefined, model: string): PortraitState {
  if (!p) return 'none';
  if (!p.done) return 'building';
  /* 只有向量方案会被模型换代打废：摘要换了对话模型照样读得懂。
     两边都探测不到模型名时不凭猜测让人重建（bz 没装、缓存还没读到），
     真要提问会在取向量那一步给出明确的一句话。 */
  if (p.plan !== 'vector' || !model) return 'ready';
  /* 向上未知也要判废：画像里没记模型名，说明它不是这一套模型算出来的。
     以前「缺模型名按可用」是一条宽松规则，自建嵌入时代无伤大雅；现在模型
     由第二大脑给，宽松等于拿两套空间的向量互相检索——界面正常，结果全错。 */
  return p.model === model ? 'ready' : 'stale';
}

/* ─────────── 存储 ─────────── */

export function portraitDir(): string {
  return `${storageDirOf()}/${PORTRAIT_DIR}`;
}

export function portraitPath(bookId: string): string {
  const id = String(bookId ?? '').trim();
  /* 书 id 是本地生成的十六进制/摘要串，这里只做防御：路径分隔符与上跳一律挡掉 */
  const safe = id.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '');
  return `${portraitDir()}/${safe || 'unknown'}.json`;
}

/** 收口径：手改坏的 JSON、旧版本缺字段、块长度与 total 不一致，一律修成能用的样子 */
export function sanitizePortrait(raw: unknown, bookId: string): PortraitFile | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Partial<PortraitFile> | null;
  if (!r) return null;
  const plan: PortraitPlan = r.plan === 'compress' ? 'compress' : 'vector';
  const blocks = Array.isArray(r.blocks)
    ? r.blocks
        .filter((b) => !!b && typeof b === 'object')
        .map((b) => ({
          chapter: String(b.chapter ?? ''),
          chars: Number(b.chars) || 0,
          vec: typeof b.vec === 'string' ? b.vec : undefined,
          digest: typeof b.digest === 'string' ? b.digest : undefined,
          summary: typeof b.summary === 'string' ? b.summary : undefined,
          error: typeof b.error === 'string' ? b.error : undefined,
          text: typeof b.text === 'string' ? b.text : undefined,
        }))
    : [];
  if (!blocks.length && !r.done) return null;
  const total = Math.max(blocks.length, Number(r.total) || 0);
  return {
    version: 1,
    bookId: String(r.bookId || bookId),
    bookTitle: String(r.bookTitle ?? ''),
    plan,
    model: String(r.model ?? ''),
    dim: Number(r.dim) || undefined,
    chunkChars: Number(r.chunkChars) || PORTRAIT_CHUNK_CHARS[plan],
    total,
    blocks,
    overview: typeof r.overview === 'string' ? r.overview : undefined,
    createdAt: Number(r.createdAt) || 0,
    updatedAt: Number(r.updatedAt) || 0,
    done: r.done === true,
  };
}

/** 读画像；没有 / 坏文件都返回 null（坏文件不删——留着能让用户自己看看到底坏在哪） */
export async function readPortrait(app: App | null | undefined, bookId: string): Promise<PortraitFile | null> {
  const adapter = app?.vault?.adapter;
  const path = portraitPath(bookId);
  if (!adapter) return null;
  try {
    if (!(await adapter.exists(path))) return null;
    return sanitizePortrait(JSON.parse(await adapter.read(path)), bookId);
  } catch {
    return null;
  }
}

/**
 * 写画像：原子写（先写 `.tmp` 再 rename 覆盖）。
 *
 * 建画像会**每跑完一批就落一次盘**（关闭弹层 = 暂停、断了能续跑），
 * 中途崩掉留下半截 JSON 就等于整份白跑——和业务数据同一条理由。
 * rename 不支持（移动端 SAF）时退回直接写。
 */
export async function writePortrait(app: App | null | undefined, p: PortraitFile): Promise<boolean> {
  const adapter = app?.vault?.adapter;
  if (!adapter) return false;
  const dir = portraitDir();
  const path = portraitPath(p.bookId);
  const tmp = `${path}.tmp`;
  const body = JSON.stringify({ ...p, updatedAt: Date.now() });
  try {
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    await adapter.write(tmp, body);
    try {
      await adapter.rename(tmp, path);
    } catch {
      await adapter.write(path, body);
      await adapter.remove(tmp).catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}

export async function removePortrait(app: App | null | undefined, bookId: string): Promise<boolean> {
  const adapter = app?.vault?.adapter;
  if (!adapter) return false;
  const path = portraitPath(bookId);
  try {
    if (!(await adapter.exists(path))) return false;
    await adapter.remove(path);
    return true;
  } catch {
    return false;
  }
}

/** 列出已有的画像文件（清理无主 / 详情页批量判断用）；返回 `[{ bookId, mtime, size }]` */
export async function listPortraits(
  app: App | null | undefined,
): Promise<Array<{ bookId: string; mtime: number; size: number }>> {
  const adapter = app?.vault?.adapter;
  if (!adapter) return [];
  const dir = portraitDir();
  try {
    if (!(await adapter.exists(dir))) return [];
    const listed = await adapter.list(dir);
    const files = (listed?.files ?? []).filter((f) => /\.json$/i.test(f));
    const out: Array<{ bookId: string; mtime: number; size: number }> = [];
    for (const file of files) {
      const name = file.replace(/\\/g, '/').split('/').pop() ?? '';
      /* mtime 必须是真的：调用方（book-ai）拿它判断「这份画像读过之后
         有没有被重建」。恒给 0 会让缓存永远命中，重建后还在喂旧向量。 */
      let mtime = 0;
      let size = 0;
      try {
        const st = await adapter.stat(file);
        mtime = typeof st?.mtime === 'number' ? st.mtime : 0;
        size = typeof st?.size === 'number' ? st.size : 0;
      } catch {
        /* 读不到就按 0 处理：下一次调用照样会重新问一遍 */
      }
      out.push({ bookId: name.replace(/\.json$/i, ''), mtime, size });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 没有对应书的画像（换版本 / 移出书架 / 删了书）。
 *
 * 只算「文件在、书上没有」这一半；`archived` 的书算有主（软删除还留着数据，
 * 用户可能把书放回来）。真正删掉由用户点确认按钮，这里只给名单。
 */
export function orphanPortraits(
  files: ReadonlyArray<{ bookId: string }>,
  books: ReadonlyArray<Pick<ReaderBook, 'id'>>,
): string[] {
  const alive = new Set((books ?? []).map((b) => String(b.id)));
  return (files ?? []).map((f) => String(f.bookId)).filter((id) => !!id && !alive.has(id));
}
