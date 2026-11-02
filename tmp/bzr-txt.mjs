// src/engine/txt.ts
var CHAPTER_RE = /^\s*(?:第[0-9零一二三四五六七八九十百千两]+[章节回卷部篇]|序章|楔子|引子|尾声|后记|番外|Chapter\s+\d+)\b.*$/i;
var HARD_SPLIT_CHARS = 12e3;
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function toParagraphs(text) {
  return text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean).map((block) => {
    const inner = escapeHtml(block).replace(/\n/g, "<br>");
    return `<p>${inner}</p>`;
  }).join("\n");
}
function splitChapters(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const chapters = [];
  let title = "\u6B63\u6587";
  let buf = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) chapters.push({ title, text: body, size: body.length });
    buf = [];
  };
  for (const line of lines) {
    if (CHAPTER_RE.test(line) && line.trim().length <= 40) {
      flush();
      title = line.trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  if (chapters.length > 1) return chapters;
  const all = text.trim();
  if (all.length <= HARD_SPLIT_CHARS) return [{ title: "\u6B63\u6587", text: all, size: all.length }];
  const out = [];
  for (let i = 0, n = 1; i < all.length; i += HARD_SPLIT_CHARS, n++) {
    const seg = all.slice(i, i + HARD_SPLIT_CHARS);
    out.push({ title: `\u7B2C ${n} \u8282`, text: seg, size: seg.length });
  }
  return out;
}
function htmlDoc(title, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${bodyHtml}</body></html>`;
}
function makeTxtBook(raw, meta) {
  const chapters = splitChapters(raw);
  const urls = [];
  const sections = chapters.map((c, i) => {
    const href = `${i}.xhtml`;
    const html = htmlDoc(c.title, `<h2>${escapeHtml(c.title)}</h2>${toParagraphs(c.text)}`);
    return {
      id: `txt-${i}`,
      href,
      linear: "yes",
      size: c.size,
      load: async () => {
        const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        urls.push(url);
        return url;
      },
      createDocument: async () => new DOMParser().parseFromString(html, "text/html"),
      unload: () => void 0,
      resolveHref: () => href
    };
  });
  const toc = chapters.map((c, i) => ({ label: c.title, href: `${i}.xhtml` }));
  const book = {
    metadata: { title: meta.title, author: meta.author, language: "zh" },
    toc,
    sections,
    rendition: { layout: "reflowable" },
    dir: "ltr",
    // 有这两个，View 才会建 SectionProgress —— 否则百分比永远是 0
    splitTOCHref: async (href) => {
      const [file, frag] = String(href).split("#");
      return [file, frag ?? null];
    },
    getTOCFragment: (doc, id) => doc.getElementById(id),
    resolveHref: (href) => {
      const [file, frag] = String(href).split("#");
      const index = chapters.findIndex((_, i) => `${i}.xhtml` === file);
      return {
        index: index >= 0 ? index : 0,
        anchor: frag ? (doc) => doc.getElementById(frag) ?? 0 : 0
      };
    },
    isExternal: (href) => /^https?:/i.test(href),
    destroy: () => {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    }
  };
  return book;
}
function countWords(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + words;
}
export {
  countWords,
  makeTxtBook
};
