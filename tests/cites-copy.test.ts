/**
 * 引用页签的对外文案（tests/cites-copy.test.ts）
 *
 * 页签列的是「笔记里指向本书具体位置的链接」，不是插件替用户攒出来的笔记；
 * 生成这类链接最顺手的「划线复制为双向链接」是高级版。1.0.0 定稿时把它
 * 一并归入高级版，与双向链接共用一道门禁，在功能对照弹层里紧排其下。
 * 于是三处口径都得对上：空态提示、README 常见问题、README 功能表勾叉。
 * 八种语言都要讲，不然某个界面里又只剩一句英文。
 *
 * 顺便钉住靛蓝的色名：德法两种语言曾经直接照抄英文 Indigo。
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { colorLabel } from '../src/data/notes';
import { LOCALES, PACK_OF, setLocale, type Locale } from '../src/i18n';

afterEach(() => setLocale('zh'));

const README_LINES = readFileSync('README.md', 'utf8').split(/\r?\n/);

/** 各语言「链接」这个词，用来确认文案真的讲到了依赖，不只是换了句空话 */
const LINK_WORD: Record<Locale, string> = {
  zh: '链接',
  'zh-TW': '連結',
  en: 'link',
  ja: 'リンク',
  de: 'Link',
  fr: 'lien',
  es: 'enlace',
  pt: 'link',
};

/** 各语言「高级版」的说法，确认常见问题讲清了付费归属 */
const PRO_WORD: Record<Locale, string> = {
  zh: '高级版',
  'zh-TW': '高級版',
  en: 'Pro',
  ja: 'プロ版',
  de: 'Pro-Version',
  fr: 'version Pro',
  es: 'versión Pro',
  pt: 'versão Pro',
};

/** 八种语言常见问题里那一条的标题 */
const FAQ_TITLE: Record<Locale, string> = {
  zh: '引用页签为什么是空的？',
  'zh-TW': '引用頁籤為什麼是空的？',
  en: 'Why is the Citations tab empty?',
  ja: '「引用」タブが空なのはなぜ？',
  de: 'Warum bleibt die Registerkarte „Zitate“ leer?',
  fr: "Pourquoi l'onglet Citations est-il vide ?",
  es: '¿Por qué la pestaña Citas está vacía?',
  pt: 'Por que a aba Citações está vazia?',
};

/** 功能表里「引用页签」那一行 */
const TABLE_CITES: Record<Locale, string> = {
  zh: '引用页签：看哪些笔记引了这本书',
  'zh-TW': '引用頁籤：看哪些筆記引用了本書',
  en: 'Citations tab: see which notes cite this book',
  ja: '引用タブ：この本を引用したノート',
  de: 'Zitate-Tab: welche Notizen dieses Buch zitieren',
  fr: 'Onglet Citations : quelles notes citent ce livre',
  es: 'Pestaña Citas: qué notas citan este libro',
  pt: 'Aba Citações: quais notas citam este livro',
};

/** 功能表里「双向链接」那一行 */
const TABLE_BILINK: Record<Locale, string> = {
  zh: '划线复制为双向链接',
  'zh-TW': '劃線複製為雙向連結',
  en: 'Copy highlights as wikilinks',
  ja: 'ハイライトを双方向リンクとしてコピー',
  de: 'Markierungen als Wikilink kopieren',
  fr: 'Copier les surlignages en wikiliens',
  es: 'Copiar subrayados como wikienlaces',
  pt: 'Copiar destaques como wikilinks',
};

describe('引用页签 · 空态提示', () => {
  it('八种语言都说明内容来自笔记里的链接', () => {
    for (const l of LOCALES) {
      const text = PACK_OF[l]['side.cites.empty'];
      expect(text.toLowerCase(), l).toContain(LINK_WORD[l].toLowerCase());
      expect(text.length, l).toBeGreaterThan(18);
    }
  });

  it('不写 PDF 专用语法：EPUB 上照着写会教错话', () => {
    for (const l of LOCALES) {
      expect(PACK_OF[l]['side.cites.empty'], l).not.toContain('#page=');
    }
  });
});

describe('README · 引用页签的依赖说明', () => {
  it('八种语言的常见问题里都有这一条，且提到链接与高级版', () => {
    for (const l of LOCALES) {
      const line = README_LINES.find((x) => x.startsWith('- **') && x.includes(FAQ_TITLE[l]));
      expect(line, l).toBeTruthy();
      expect(line?.toLowerCase(), l).toContain(LINK_WORD[l].toLowerCase());
      expect(line?.toLowerCase(), l).toContain(PRO_WORD[l].toLowerCase());
    }
  });
});

describe('README · 功能表把引用页签归到高级版', () => {
  it('八种语言都是「基础版 — / 高级版 ✓」，且紧排在双向链接下面', () => {
    for (const l of LOCALES) {
      const at = README_LINES.findIndex((x) => x.startsWith('|  |') && x.includes(TABLE_CITES[l]));
      expect(at, l).toBeGreaterThan(-1);
      expect(README_LINES[at], l).toMatch(/\| — \| ✓ \|$/);
      expect(README_LINES[at - 1], l).toContain(TABLE_BILINK[l]);
    }
  });
});

describe('划线颜色 · 色名不照抄英文', () => {
  it('德语的靛蓝是本地说法', () => {
    setLocale('de');
    expect(colorLabel('blue')).toBe('Indigoblau');
  });

  it('法语的靛蓝是本地说法', () => {
    setLocale('fr');
    expect(colorLabel('blue')).toBe('Bleu indigo');
  });
});
