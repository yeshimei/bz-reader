/* ============================================================
 * bz-reader · 引文校验（data/ai-quote.ts）
 *
 * 问答最怕的不是「答错」，是「引了一段原文，但那句话书里没有」。
 * 模型很擅长把两段话揉成一句、把「他」换成「方鸿渐」、把数字改一位，
 * 然后照样打上引号——用户看到引号就信了。
 *
 * 社区里 Readwise 的 Ghostreader、MindMax 都做同一件事：答案回来之后，
 * 把每条引文拿去原文里核一遍，核不上就标出来（MindMax 叫 checked quotes）。
 * 这里做的是同一件事的本地版本，不额外发请求：
 *
 *   1. 从答案里取出引号内的片段（「」『』“”""）；
 *   2. 两侧都去掉空白与标点再比——模型改标点是常态，不该算错；
 *   3. 一字不差找不到时，按二字组算覆盖率：≥ 80% 才算「同一句话」。
 *      整句替换、同义改写会掉到 50% 上下，正好被挡在外面。
 * ============================================================ */

/** 引号内的片段：太短（「他」）没有校验价值，太长（整段）多半不是原文 */
const QUOTE_RE = /[「『“"]([^」』”"]{4,80})[」』”"]/g;

/** 一字不差找不到时，允许的局部差异：按**二字组**比，八成二字组能在原文里找到 */
const PASS_COVERAGE = 0.8;

/** 短于这个长度的引文只认一字不差：四个字的「命运共同体」到处都有，模糊比对没有意义 */
const MIN_FUZZY = 8;

/**
 * 归一化：只留字母、数字与汉字。
 *
 * 标点、空白、全半角都不参与比较——模型抄原文时最常改的就是这些，
 * 把它们算成错，会把「抄对了但换了个逗号」的引文标成假的。
 */
export function normalizeQuote(text: string): string {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 答案里出现的引文（去重、保序） */
export function extractQuotes(answer: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(answer ?? '').matchAll(QUOTE_RE)) {
    const raw = String(m[1] ?? '').trim();
    const key = normalizeQuote(raw);
    if (key.length < 4 || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

/**
 * 一句话在原文里的覆盖率。
 *
 * 用**二字组**而不是六字窗口：模型多抄一个「的」、少抄一个「了」，
 * 六字窗口会让后面所有窗口跟着错位，一句话从 1 掉到 0.4；二字组只损失
 * 跨过改动点的那一两个，仍在 0.8 以上。整句改写则掉到 0.5 上下，
 * 正好被门槛挡住。
 *
 * 短引文（少于 8 字）不做模糊比对：四个字的短语在书里遍地都是，
 * 放过它就等于没有校验。
 */
export function quoteCoverage(quote: string, corpus: string): number {
  const q = normalizeQuote(quote);
  const c = normalizeQuote(corpus);
  if (!q || !c) return 0;
  if (q.length < MIN_FUZZY) return c.includes(q) ? 1 : 0;
  if (c.includes(q)) return 1;
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 2 <= q.length; i += 1) {
    total += 1;
    if (c.includes(q.slice(i, i + 2))) hit += 1;
  }
  return total ? hit / total : 0;
}

export interface QuoteCheck {
  /** 答案里那段引文（原样，给界面用） */
  quote: string;
  /** 覆盖率 0–1 */
  coverage: number;
  ok: boolean;
}

export interface QuoteReport {
  /** 答案里一共几段引文 */
  total: number;
  /** 核不上的条数 */
  bad: number;
  /** 逐条结果（按出现顺序） */
  checks: QuoteCheck[];
}

/**
 * 核一遍答案里的所有引文。
 *
 * `corpus` 是**这次真正发给模型的依据**，不是整本书：模型只能从它看得见的
 * 东西里抄，拿整本书去核会把「依据里没有、但书里别处有」的引文放过去，
 * 那正是「模型凭记忆编了一句书里的话」的典型症状。
 */
export function verifyQuotes(answer: string, corpus: string, pass = PASS_COVERAGE): QuoteReport {
  const quotes = extractQuotes(answer);
  const checks: QuoteCheck[] = quotes.map((quote) => {
    const coverage = quoteCoverage(quote, corpus);
    return { quote, coverage, ok: coverage >= pass };
  });
  const bad = checks.filter((c) => !c.ok).length;
  return { total: checks.length, bad, checks };
}
