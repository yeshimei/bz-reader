/* ============================================================
 * bz-reader · 建画像的流程（data/portrait-build.ts）
 *
 * 一个可以暂停、续跑、只重试失败块的**长任务**。放在数据层而不是弹层里，因为
 * 「关闭弹层 = 暂停，不丢进度」这条要求意味着：任务的生命周期不能跟着 DOM 走。
 *
 * 五条硬规矩（都来自用户拍板的决策）：
 *   1. **只有用户点了开始才跑**：没有任何自动/增量路径，构造与打开界面都不发请求；
 *   2. **每跑完一批就落一次盘**：中途关弹层、关 Obsidian、断网，下次回来接着跑；
 *   3. **暂停/取消不丢进度**：两者都只是「停下」，区别只在用户以为自己在干什么——
 *      真正的重建要用户显式点「重建」；
 *   4. **失败只重跑失败块**：块级记 error，重试按块补，不整本重来；
 *   5. **取消要能立刻停**：`AbortSignal` 一路传进嵌入/对话请求，不等超时。
 *
 * 续跑时重新读一遍书、重新切块：块切分对同一本书是确定性的（章节 + 字数 + 段界），
 * 所以下标可以直接对上；把每块原文也存进画像文件能省这一遍，但会让文件大出一倍，
 * 不值得——读书几秒，省下的是用户的磁盘与同步流量。
 * ============================================================ */
import {
  PORTRAIT_CHUNK_CHARS,
  chunkChapters,
  compressEvidence,
  encodeVector,
  estimateBlocks,
  estimateRequests,
  type ChapterText,
  type PortraitBlock,
  type PortraitFile,
  type PortraitPlan,
} from './portrait';

/** 向量方案的一次嵌入批块数：批小一点，暂停的响应更快，失败重试也更便宜 */
export const EMBED_BATCH_BLOCKS = 8;

export type BuildStatus = 'idle' | 'extract' | 'running' | 'paused' | 'done' | 'error';

export interface BuildProgress {
  status: BuildStatus;
  plan: PortraitPlan;
  bookId: string;
  bookTitle: string;
  /** 切完块才知道真实总数；之前为 0（界面显示「正在切块」） */
  total: number;
  /** 已经有内容的块数（含之前续跑完成的） */
  done: number;
  failed: number;
  /** 当前在干什么：extract 读书 / embed 向量化 / compress 压缩 / save 收尾 */
  phase: 'extract' | 'embed' | 'compress' | 'save' | '';
  /** 读书阶段：第几章 / 共几章 */
  extractDone: number;
  extractTotal: number;
  /** 最近一次错误（失败块的原因或整任务失败的原因） */
  message?: string;
  startedAt: number;
  /** 已用时（运行中实时增长，暂停/完成后定格） */
  elapsedMs: number;
}

export interface PortraitBuildDeps {
  /** 读回已有画像（续跑 / 判断是否已完成） */
  load: (bookId: string) => Promise<PortraitFile | null>;
  save: (p: PortraitFile) => Promise<boolean>;
  /** 逐章读全书正文 */
  extract: (
    onProgress: (done: number, total: number, title: string) => void,
    shouldStop: () => boolean,
  ) => Promise<ChapterText[]>;
  /** 批量嵌入（借 bz 的向量能力，见 data/bz-bridge 的 bzEmbedder） */
  embed: (texts: string[], signal: AbortSignal) => Promise<number[][]>;
  /** 单块压缩：返回「一句话 + 要点」 */
  summarise: (text: string, signal: AbortSignal) => Promise<{ digest: string; summary: string }>;
  /** 全书总述（压缩方案最后那一次请求） */
  overview?: (evidence: string, signal: AbortSignal) => Promise<string>;
  /** 当前嵌入模型名（写进画像，换代后据此提示重建） */
  embedModel: () => string;
  /** 当前对话模型名（压缩方案写进画像） */
  chatModel: () => string;
  now?: () => number;
}

export type BuildListener = (p: BuildProgress) => void;

function emptyProgress(plan: PortraitPlan, bookId: string, bookTitle: string): BuildProgress {
  return {
    status: 'idle',
    plan,
    bookId,
    bookTitle,
    total: 0,
    done: 0,
    failed: 0,
    phase: '',
    extractDone: 0,
    extractTotal: 0,
    startedAt: 0,
    elapsedMs: 0,
  };
}

/** 已经有内容的块（向量或摘要任一份就算完成） */
function filled(b: PortraitBlock): boolean {
  return !!((b.vec && b.vec.length) || (b.summary && b.summary.trim()));
}

export class PortraitBuilder {
  private deps: PortraitBuildDeps;
  private state: BuildProgress;
  private portrait: PortraitFile | null = null;
  private ctrl: AbortController | null = null;
  private stopped = false;
  private listeners = new Set<BuildListener>();

  constructor(deps: PortraitBuildDeps, plan: PortraitPlan = 'vector', book?: { id: string; title: string }) {
    this.deps = deps;
    this.state = emptyProgress(plan, book?.id ?? '', book?.title ?? '');
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  progress(): BuildProgress {
    /* 运行中把已用时算活：界面上的秒数是自己走的，不靠外部定时器喂 */
    if (this.state.status === 'running' || this.state.status === 'extract') {
      return { ...this.state, elapsedMs: Math.max(0, this.now() - this.state.startedAt) };
    }
    return { ...this.state };
  }

  subscribe(fn: BuildListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<BuildProgress> = {}): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.progress();
    for (const fn of [...this.listeners]) {
      try {
        fn(snapshot);
      } catch {
        /* 单个订阅者出错不连累其余 */
      }
    }
  }

  /** 换依赖（单例被另一次装配复用；测试与真机都走这里） */
  rebind(deps: PortraitBuildDeps): void {
    if (deps !== this.deps) this.deps = deps;
  }

  /** 已有画像（完成页 / 详情页要用） */
  current(): PortraitFile | null {
    return this.portrait;
  }

  /**
   * 开始跑。
   *
   * `rebuild` = 用户点的是「重建」：清掉旧块重来。否则同一方案且已完成 → 直接返回
   * （不做任何请求），未完成 → 续跑缺的块。
   */
  async start(book: { id: string; title: string }, plan: PortraitPlan, opts: { rebuild?: boolean } = {}): Promise<void> {
    if (this.state.status === 'running' || this.state.status === 'extract') return;
    const now = this.now();
    this.stopped = false;
    this.state = {
      ...emptyProgress(plan, book.id, book.title),
      status: 'extract',
      phase: 'extract',
      startedAt: now,
      elapsedMs: 0,
    };
    this.emit();

    const existing = opts.rebuild ? null : await this.deps.load(book.id);
    const resumable =
      existing && existing.plan === plan && !existing.done && existing.chunkChars === PORTRAIT_CHUNK_CHARS[plan]
        ? existing
        : null;
    if (existing && existing.done && existing.plan === plan && !opts.rebuild) {
      /* 已经建好且方案一致：不发请求，直接把成品交给界面 */
      this.portrait = existing;
      this.emit({ status: 'done', total: existing.total, done: existing.blocks.length, phase: '' });
      return;
    }

    try {
      const chapters = await this.deps.extract(
        (done, total) => {
          if (this.stopped) return;
          this.emit({ extractDone: done, extractTotal: total });
        },
        () => this.stopped,
      );
      if (this.stopped) {
        this.emit({ status: 'paused', phase: '' });
        return;
      }
      const chunks = chunkChapters(chapters, PORTRAIT_CHUNK_CHARS[plan]);
      if (!chunks.length) throw new Error('这本书没有可用的正文块');

      const blocks: PortraitBlock[] = chunks.map((c, i) => {
        const old = resumable?.blocks?.[i];
        /* 续跑时只认同一块：字数对不上说明切块口径变了，那块重算（不硬套旧向量） */
        const same = old && old.chars === c.chars;
        const base = same ? { ...old } : { chapter: c.chapter, chars: c.chars };
        /* 向量方案的原文要留着：检索之后得拿它拼上下文（没有原文就只能给一句摘要） */
        if (plan === 'vector') base.text = c.text;
        return base;
      });

      this.portrait = {
        version: 1,
        bookId: book.id,
        bookTitle: book.title,
        plan,
        model: plan === 'vector' ? this.deps.embedModel() : this.deps.chatModel(),
        chunkChars: PORTRAIT_CHUNK_CHARS[plan],
        total: chunks.length,
        blocks,
        overview: resumable?.overview,
        createdAt: resumable?.createdAt || now,
        updatedAt: now,
        done: false,
      };
      this.emit({
        status: 'running',
        phase: plan === 'vector' ? 'embed' : 'compress',
        total: chunks.length,
        done: blocks.filter(filled).length,
        failed: blocks.filter((b) => !filled(b) && b.error).length,
      });
      await this.deps.save(this.portrait);

      await this.runChunks(chunks.map((c) => c.text));
      if (this.stopped) {
        this.emit({ status: 'paused', phase: '' });
        return;
      }
      await this.finish();
    } catch (e) {
      this.ctrl = null;
      this.emit({ status: 'error', phase: '', message: (e as Error)?.message || '建画像失败' });
    }
  }

  /** 把还没内容的块补齐（首次跑与「只重跑失败块」共用这一条路） */
  private async runChunks(texts: string[]): Promise<void> {
    const p = this.portrait;
    if (!p) return;
    this.ctrl = new AbortController();
    const signal = this.ctrl.signal;

    if (p.plan === 'vector') {
      for (let start = 0; start < p.blocks.length; start += EMBED_BATCH_BLOCKS) {
        if (this.stopped) return;
        const slice: number[] = [];
        for (let i = start; i < Math.min(start + EMBED_BATCH_BLOCKS, p.blocks.length); i += 1) {
          if (!filled(p.blocks[i])) slice.push(i);
        }
        if (!slice.length) continue;
        try {
          const vectors = await this.deps.embed(slice.map((i) => texts[i]), signal);
          slice.forEach((blockIndex, k) => {
            const vec = vectors[k];
            if (!vec || !vec.length) {
              p.blocks[blockIndex].error = '嵌入服务没有返回向量';
              return;
            }
            p.blocks[blockIndex].vec = encodeVector(vec);
            delete p.blocks[blockIndex].error;
            p.dim = vec.length;
          });
        } catch (e) {
          if (signal.aborted || this.stopped) return;
          const reason = (e as Error)?.message || '嵌入失败';
          for (const blockIndex of slice) p.blocks[blockIndex].error = reason;
        }
        await this.deps.save(p);
        this.emit({
          done: p.blocks.filter(filled).length,
          failed: p.blocks.filter((b) => !filled(b) && b.error).length,
        });
      }
      return;
    }

    /* 压缩方案：一块一次对话，逐块落盘（一次请求可能几块钱，不能攒着写） */
    for (let i = 0; i < p.blocks.length; i += 1) {
      if (this.stopped) return;
      const block = p.blocks[i];
      if (filled(block)) continue;
      try {
        const res = await this.deps.summarise(texts[i], signal);
        block.digest = (res.digest || '').trim();
        block.summary = (res.summary || '').trim();
        if (!block.summary) block.error = '模型没有返回摘要';
        else delete block.error;
      } catch (e) {
        if (signal.aborted || this.stopped) return;
        block.error = (e as Error)?.message || '压缩失败';
      }
      await this.deps.save(p);
      this.emit({
        done: p.blocks.filter(filled).length,
        failed: p.blocks.filter((b) => !filled(b) && b.error).length,
      });
    }
  }

  /**
   * 收尾：压缩方案再要一次全书总述；全部块齐了才算完成。
   *
   * 顺序是「先落盘、再宣布完成」：侧栏在 status 变成 done 的那一刻
   * 就换到对话界面，它读的是盘上的画像（经 portrait-cache）。先 emit
   * 后 save 的话，界面会停在「索引已建好，可以提问了」不动，直到用户
   * 点别的页签再切回来——而这中间什么也没发生。
   */
  private async finish(): Promise<void> {
    const p = this.portrait;
    if (!p) return;
    this.emit({ phase: 'save' });
    const missing = p.blocks.filter((b) => !filled(b)).length;
    p.done = missing === 0;
    await this.deps.save(p);
    this.emit({
      status: p.done ? 'done' : 'error',
      phase: '',
      done: p.blocks.length - missing,
      failed: missing,
      message: p.done ? undefined : `还有 ${missing} 块没拿到内容，可只重试失败的块`,
    });
  }

  /** 压缩方案的全书总述（单独一步，失败不影响块级进度） */
  async buildOverview(): Promise<string | null> {
    const p = this.portrait;
    const fn = this.deps.overview;
    if (!p || p.plan !== 'compress' || !fn || p.overview) return p?.overview ?? null;
    const ctrl = new AbortController();
    try {
      const text = await fn(compressEvidence(p), ctrl.signal);
      if (text?.trim()) {
        p.overview = text.trim();
        await this.deps.save(p);
      }
      return p.overview ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 只重跑失败的块（用户拍板的口径：不整本重来）。
   *
   * 复用 `start` 的续跑分支：块已有内容的会被跳过，所以这里不需要另写一条循环。
   */
  async retryFailed(): Promise<void> {
    const p = this.portrait;
    if (!p) return;
    if (this.state.status === 'running' || this.state.status === 'extract') return;
    const book = { id: p.bookId, title: p.bookTitle };
    await this.start(book, p.plan, { rebuild: false });
  }

  /** 暂停：下一批之前停下，进度留在盘上（关闭弹层走这条） */
  pause(): void {
    if (this.state.status !== 'running' && this.state.status !== 'extract') return;
    this.stopped = true;
    this.ctrl?.abort();
    this.emit({ status: 'paused', phase: '' });
  }

  /** 继续（等价于重跑缺口，块已有内容不重算） */
  async resume(): Promise<void> {
    const p = this.portrait;
    if (!p || p.done) return;
    await this.start({ id: p.bookId, title: p.bookTitle }, p.plan, { rebuild: false });
  }

  /** 取消：停下并把状态收回 idle；**盘上的进度不删**，下次进来还能续 */
  cancel(): void {
    this.stopped = true;
    this.ctrl?.abort();
    this.ctrl = null;
    this.emit({ status: 'idle', phase: '', message: undefined });
  }

  /** 界面关掉后重置（不影响盘上的文件） */
  reset(): void {
    this.stopped = true;
    this.ctrl?.abort();
    this.ctrl = null;
    this.portrait = null;
    this.state = emptyProgress(this.state.plan, '', '');
  }
}

/* ─────────── 模块单例 ───────────
 * 同一时刻只允许一个建画像任务（它要占满嵌入服务/AI 额度，并发跑只会两边都慢）。
 * 弹层每次打开都从这一个实例取进度，所以「关掉再打开」看到的还是同一个任务。 */
let singleton: PortraitBuilder | null = null;

export function portraitBuilder(deps?: PortraitBuildDeps): PortraitBuilder {
  if (!singleton) {
    singleton = new PortraitBuilder(deps ?? (null as unknown as PortraitBuildDeps));
  } else if (deps) {
    singleton.rebind(deps);
  }
  return singleton;
}

/** 测试用：丢掉单例（真实模块里只在测试里调用） */
export function resetPortraitBuilder(): void {
  singleton = null;
}

/** 预估（界面用）：约几块、约几次请求 */
/**
 * 准备界面上的预估。
 *
 * 请求数的算法只有一份（`estimateRequests`）：这里再抄一遍，改批次大小时
 * 预估就会和实际跑数对不上，而预估正是用户决定「要不要花这个钱」的唯一依据。
 * 0 块时仍然给 0 次——还没切出块就说「约 1 次请求」是假话。
 */
export function estimateOf(chars: number, plan: PortraitPlan): { blocks: number; requests: number } {
  const blocks = estimateBlocks(chars, plan);
  return { blocks, requests: blocks > 0 ? estimateRequests(blocks, plan, EMBED_BATCH_BLOCKS) : 0 };
}
