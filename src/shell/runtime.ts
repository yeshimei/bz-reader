/* ============================================================
 * bz-reader · 壳层运行时状态（shell/runtime.ts）
 *
 * 这些是「关掉就该忘掉」的东西：搜索关键词、AI 对话、当前选区、
 * 朗读开关、弹层里的临时选项。它们**不落盘**——下次打开还停在上次的
 * 搜索结果里，不是记忆，是脏状态。
 *
 * 与 state.ts 的分界：state 是用户偏好（落 localStorage），
 * runtime 是一次会话里的临时量（内存）。
 * ============================================================ */
import type { AiSource } from '../data/ai-evidence';
import type { PortraitPlan } from '../data/portrait';

export interface SelectionPayload {
  /** 整段选区在宿主坐标系里的矩形：想法 / 书摘贴着它弹，而不是跑到屏幕中间 */
  anchor?: { left: number; top: number; width?: number; height?: number };
  text: string;
  bookId: string;
  chapterTitle: string;
  /** 用于生成 CFI 的原始字符串（划词时由阅读视图注入） */
  cfiRange: string;
}

export interface AiLogItem {
  me: boolean;
  tag: string;
  text: string;
  /** 这一条答完之后附的来源（知识库笔记能点开，全书的只有章节名） */
  sources?: AiSource[];
}

export const RT = {
  /** 正文搜索的命中（点一条跳到那一页） */
  textHits: [] as Array<{ cfi: string; excerpt: string; chapterLabel: string; chapterIndex: number }>,
  /** 正文搜索是否正在跑 */
  textSearching: false,
  /** 书摘卡上次用的版式（关闭弹层后仍记得，下次打开还是这一版） */
  cardTpl: 'classic' as string,
  /** 正在跑的 AI 请求（「取消请求」按钮用）；空表示没有在请求 */
  aiAbort: null as AbortController | null,
  /**
   * 侧栏 AI 页签的问答记录。
   *
   * **只有侧栏那条路写这里**（全书问答）。工具栏划词问的是另一件事——
   * 一小段、不要书的依据、花的是另一次钱——它记在 shell/ai-card 那本册子里。
   * 以前两边共用一份，侧栏会凭空多出一条没有提问的答案。
   */
  aiLog: [] as AiLogItem[],
  /**
   * 等用户确认「会把什么发给 AI」的那一次提问。
   *
   * 说明弹窗是状态驱动的（没有 await 的对话框），用户点「知道了」之后要
   * 原样重发这条提问——不存下来就等于让他白打一遍字。
   */
  ackPending: null as { q: string } | null,
  /** 画像方案：记住上次选的（两种方案差别很大，用户通常固定用同一种） */
  portraitPlan: 'vector' as PortraitPlan,
  /**
   * 侧栏 AI 页签：用户点了「建立索引」，正在选建法。
   *
   * 这一步以前是弹窗，现在就地展开——所以「展没展开」得有个地方记：
   * 选完方案开始跑、或者点取消，都要把它收回去。
   */
  aiIndexOpen: false,
  /** 待确认清理的无主画像（书号，给人看的清单在弹层里） */
  ptOrphans: [] as string[],
  /** 当前划词 */
  sel: null as SelectionPayload | null,
  /**
   * 手机上「选中即划」刚落下的那条标注 id。
   *
   * 有它，划词条里的色点就是「改这条的颜色」而不是「再划一条」，
   * 点想法/书摘也复用同一条——否则一次划词能在书里叠三四条线。
   */
  selMarkId: '',
  /** 朗读开关（真实 TTS 由阅读视图实现，这里只是界面态） */
  tts: false,
  /** 词典 / 翻译的查询词 */
  dictWord: '',
  /**
   * 设置页里「数据目录」输入框的草稿。
   * 不直接落盘——换目录要迁移整份数据，必须先弹二次确认；
   * 边打字边改指针会让人输到一半就发现书库空了。
   */
  dataDirDraft: '',
  /**
   * 侧栏目录里被折叠起来的父章节 href。
   *
   * 按 href 记而不是 label：目录里的标题会重名（每个部分下都有「-1-」），
   * 用 label 折叠一个会连带折掉同名的那几支。不落盘——重新打开书时
   * 回到「全部展开」，用户不必记着自己上次折了哪一支。
   */
  tocCollapsed: new Set<string>(),
};

export function pushAi(me: boolean, tag: string, text: string, sources?: AiSource[]): void {
  RT.aiLog.push({ me, tag, text, sources: sources?.length ? sources : undefined });
  // 只留最近 20 条：侧栏气泡不是聊天记录，不需要无限长
  if (RT.aiLog.length > 20) RT.aiLog = RT.aiLog.slice(-20);
}

export function resetAi(): void {
  RT.aiLog = [];
}

/* ─────────── 标注变更广播 ───────────
 *
 * 书页上的划线是引擎按 CFI 画的，壳层重绘（书架、侧栏）碰不到它。
 * 以前改色 / 写想法 / 删划线之后，书页要关掉重开才更新——因为没人
 * 通知阅读视图「数据变了」。这里放一个极小的订阅：阅读视图在开书时
 * 挂上，改标注的每个动作广播一次，视图就地重画当前章节。
 */
const noteListeners = new Set<() => void>();

export function onNotesChanged(fn: () => void): () => void {
  noteListeners.add(fn);
  return () => noteListeners.delete(fn);
}

export function emitNotesChanged(): void {
  for (const fn of [...noteListeners]) {
    try {
      fn();
    } catch {
      /* 单个订阅者出错不连累其余 */
    }
  }
}
