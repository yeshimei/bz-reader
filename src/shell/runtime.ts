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
  /** 想法编辑器里选中的类型——真实数据没有分类，先留着不影响渲染 */
  ideaType: '想法',
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
