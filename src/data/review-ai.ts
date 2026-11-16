/* ============================================================
 * bz-reader · 让 AI 挑重点（data/review-ai.ts）
 *
 * 两种挑法，对应两条不同的产品意图：
 *
 *   1. **按划线挑**：用户已经划过线了，AI 只回答「哪几条值得长期记」。
 *      挑完交给 Review，题面由 Review 按它那边的复习方式生成。
 *   2. **按章节挑**：用户没划线、或者想让 AI 自己找。AI 读正文，自己挑句子
 *      并出题，一次调用把「挑什么」和「怎么问」都定下来。
 *
 * 条数口径（2026-11-16 用户拍板）：**默认不限制，由内容和章节决定**。
 * 所以 prompt 里不写死条数，只给「短章 / 中等 / 长章」的参考区间；
 * 用户显式设了上限才补一句「最多 N 张」。
 *
 * 这个文件里的中文全部是发给模型的 prompt，不进界面——与 data/ai.ts、
 * data/book-enrich.ts 同一性质（i18n 门禁按「新增文件预算 0」处理，
 * 已登记进 tests/no-hardcoded-zh.test.ts 的基线）。
 * ============================================================ */

/** 一条待挑的划线（prompt 里只需要这几样） */
export interface PickCandidate {
  id: string;
  text: string;
  comment?: string;
}

/**
 * 「按划线挑」的提示词。
 *
 * 为什么要强调「别为了凑比例硬删」：模型很容易把「挑重点」理解成「删掉一半」，
 * 于是一本划得很克制的书也被砍掉一半——用户划的时候已经筛过一遍了。
 */
export function buildMarkPickPrompt(bookTitle: string, chapterTitle: string, candidates: readonly PickCandidate[]): string {
  const where = chapterTitle ? `《${bookTitle}》${chapterTitle}` : `《${bookTitle}》`;
  const lines = candidates
    .map((c, i) => {
      const idea = String(c.comment ?? '').trim();
      return `${i + 1}. [id=${c.id}] ${String(c.text ?? '').trim()}${idea ? `\n   我的想法：${idea}` : ''}`;
    })
    .join('\n');
  return [
    `下面是${where}的读书划线，一共 ${candidates.length} 条。请判断哪些值得长期记住、反复复习。`,
    '',
    '判断标准：',
    '1. 有观点、讲因果、给方法、能独立成问的——值得记；',
    '2. 纯景物描写、纯过渡、纯抒情，读了也考不出东西的——不值得；',
    '3. 同一件事划了好几条的，只留信息量最大的一条。',
    '',
    '重要：用户划线时已经筛过一遍了，所以**不要为了凑比例硬删**。',
    '如果这一批都值得记，就全部保留；宁可少删，也不要删掉真正有观点的句子。',
    '',
    '只输出一个 JSON 对象，不要解释、不要代码块：',
    '{"keep": ["id1", "id2"]}',
    '',
    '划线：',
    lines,
  ].join('\n');
}

/**
 * 从回复里取保留的 id。
 *
 * 宽容解析（模型爱包一层代码块或前言），但**只认输入里真实存在的 id**：
 * 模型偶尔会自己编一个 `id3`，那种一律丢掉，不然调用方拿着一个不存在的
 * id 去查会查空。
 *
 * 返回值分两种「空」：
 *   · `null` = 解析不出来（模型没按格式回、或者回了一堆话）——调用方该保底
 *     全留，而不是把一整批划线全丢掉；
 *   · `[]` = 模型明确说「一条都不留」。这是有效答案，调用方要尊重。
 */
export function parsePickedIds(reply: string, validIds: readonly string[]): string[] | null {
  const text = String(reply ?? '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
  const raw = (parsed as { keep?: unknown })?.keep;
  if (!Array.isArray(raw)) return null;
  const valid = new Set(validIds.map((x) => String(x)));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = String(item ?? '').trim();
    if (!id || seen.has(id) || !valid.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 「按章节挑」的提示词。
 *
 * `limit` 为 0 表示不限制（默认）：让模型按这一章的长度自己定张数。
 * 给了上限才在末尾补一句，而且用的是「最多」——不是「必须出够」。
 */
export function buildChapterCardPrompt(bookTitle: string, chapterTitle: string, body: string, limit = 0): string {
  const where = chapterTitle ? `《${bookTitle}》${chapterTitle}` : `《${bookTitle}》`;
  const cap = Math.max(0, Math.round(Number(limit) || 0));
  const countRule = cap
    ? `4. 最多出 ${cap} 张，按这一章的信息密度自己决定实际出几张，不够就不出满。`
    : '4. 张数由这一章的长度和信息密度决定：短章 3~5 张，中等 5~8 张，长章 8~12 张。宁可少而精，不要凑数。';
  return [
    `下面是${where}的正文。请从中挑出值得长期记住的内容，做成问答卡。`,
    '',
    '要求：',
    '1. 每张卡一个知识点：text 是原文里的那句话（原样摘录，不改写、不概括）；',
    '2. q 是一个不能照抄原文的问句，要能独立读懂；a 是简短答案，可以引用原文；',
    '3. 不要出「这段出自哪本书」「作者是谁」「这章标题是什么」这类靠元信息就能猜的题；',
    countRule,
    '',
    '只输出一个 JSON 对象，不要解释、不要代码块：',
    '{"cards": [{"text": "原文那句", "q": "问题", "a": "答案"}]}',
    '',
    '正文：',
    String(body ?? ''),
  ].join('\n');
}

/** 从正文里挑出来的一张卡 */
export interface PickedCard {
  text: string;
  q: string;
  a: string;
}

/**
 * 解析「按章节挑」的回复。
 *
 * 三道校验：text 和 q 都得有；text 必须是正文里真实出现过的片段（模型有时
 * 会「概括」出一句原文里没有的话，那种卡复习时对不上原文）；同一条原文只留
 * 第一张。
 */
export function parseChapterCards(reply: string, body = ''): PickedCard[] {
  const text = String(reply ?? '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(first, last + 1));
  } catch {
    return [];
  }
  const raw = (parsed as { cards?: unknown })?.cards;
  if (!Array.isArray(raw)) return [];
  /* 比对前把空白全去掉：模型返回的句子常带多余空格或换行，按字面比会误杀。
     存下来的 text 仍然保留正常排版（只把连续空白压成一个空格）。 */
  const flat = (s: unknown): string => String(s ?? '').replace(/\s+/g, '');
  const source = flat(body);
  const seen = new Set<string>();
  const out: PickedCard[] = [];
  for (const item of raw) {
    const t = String((item as { text?: unknown })?.text ?? '').replace(/\s+/g, ' ').trim();
    const q = String((item as { q?: unknown })?.q ?? '').trim();
    if (!t || !q) continue;
    /* 原文校验：给了正文就必须能在正文里找到（去掉空白后比对，容错换行与空格） */
    if (source && !source.includes(flat(t))) continue;
    if (seen.has(flat(t))) continue;
    seen.add(flat(t));
    const a = String((item as { a?: unknown })?.a ?? '').trim();
    out.push({ text: t, q, a });
  }
  return out;
}
