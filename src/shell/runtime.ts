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
}

export const RT = {
  /** 搜索面板关键词（本书 / 全库共用） */
  searchKw: '',
  searchScope: 'book' as 'book' | 'all',
  /** AI 对话（侧栏 AI 页签与 AI 弹层共用一份） */
  aiLog: [] as AiLogItem[],
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
};

export function pushAi(me: boolean, tag: string, text: string): void {
  RT.aiLog.push({ me, tag, text });
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
