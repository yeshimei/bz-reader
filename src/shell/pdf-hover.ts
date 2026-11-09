/* ============================================================
 * bz-reader · PDF 链接悬浮预览（shell/pdf-hover.ts）
 *
 * 笔记里悬停 `[[论文.pdf#page=7&…]]` 时，右下方弹一页缩略图——PDF++ 的
 * hover preview。不碰 Obsidian 内部的 HoverPopover（那是内部类，随版本换
 * 签名），自己画一张小卡片，坏了也只是不弹，不影响点击。
 *
 * 两个成本点：
 *   · 大 PDF 首次加载要几百毫秒 —— 所以有 320ms 延迟，且只缓存最近两本；
 *   · 渲染缩略图要占主线程 —— 宽度 260px，一页几十毫秒，可接受。
 * ============================================================ */

import type { App } from 'obsidian';
import { parsePdfLinkHash } from '../data/pdf-link';
import { PdfDocument } from '../engine/pdf/document';
import { hrefCandidates } from './link-postprocessor';

const WAIT_MS = 320;
const HIDE_MS = 180;
/** 最多同时留几本 PDF 的解析结果：翻笔记时来回 hover 不用每次重开 */
const MAX_DOCS = 2;
const THUMB_WIDTH = 260;

interface CachedDoc {
  doc: PdfDocument | null;
  at: number;
}

const docs = new Map<string, CachedDoc>();

function pdfPathOf(href: string): { path: string; page: number } | null {
  const raw = String(href ?? '').trim();
  if (!raw) return null;
  const hashAt = raw.indexOf('#');
  if (hashAt <= 0) return null;
  const path = raw.slice(0, hashAt);
  if (!/\.pdf$/i.test(path)) return null;
  const target = parsePdfLinkHash(raw.slice(hashAt + 1));
  if (!target) return null;
  return { path, page: target.page };
}

async function loadDoc(app: App, path: string): Promise<PdfDocument | null> {
  const cached = docs.get(path);
  if (cached) {
    cached.at = Date.now();
    return cached.doc;
  }
  const file = app.vault.getFileByPath(path);
  if (!file) return null;
  let doc: PdfDocument | null = null;
  try {
    const buf = await app.vault.readBinary(file);
    doc = await PdfDocument.load(new Uint8Array(buf.slice(0)));
  } catch {
    doc = null;
  }
  docs.set(path, { doc, at: Date.now() });
  /* 超量的先销毁：一个 pdf.js 文档留着一整本的字模和页缓存 */
  while (docs.size > MAX_DOCS) {
    let oldestKey = '';
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, value] of docs) {
      if (value.at < oldestAt) {
        oldestAt = value.at;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    const drop = docs.get(oldestKey);
    docs.delete(oldestKey);
    void drop?.doc?.destroy().catch(() => undefined);
  }
  return doc;
}

function basename(path: string): string {
  const at = path.lastIndexOf('/');
  return at >= 0 ? path.slice(at + 1) : path;
}

/**
 * 装上悬停预览；返回卸载函数。
 *
 * 移动端不装：那里没有 hover，装了只会白挂两个监听。
 */
export function installPdfHover(app: App): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (document.body.classList.contains('is-mobile')) return () => undefined;

  let el: HTMLDivElement | null = null;
  let showTimer: number | null = null;
  let hideTimer: number | null = null;
  let pending = '';

  const clearTimers = (): void => {
    if (showTimer !== null) window.clearTimeout(showTimer);
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    showTimer = null;
    hideTimer = null;
  };

  const hide = (): void => {
    clearTimers();
    pending = '';
    el?.remove();
    el = null;
  };

  const show = async (path: string, page: number, anchor: DOMRect): Promise<void> => {
    if (pending !== `${path}#${page}`) return;
    const box = document.createElement('div');
    box.className = 'bzr-pdf-hover';
    const cap = document.createElement('div');
    cap.className = 'bzr-pdf-hover-cap';
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = basename(path);
    const pageEl = document.createElement('span');
    pageEl.className = 'page';
    pageEl.textContent = `· ${page}`;
    cap.append(nameEl, pageEl);
    const bodyEl = document.createElement('div');
    bodyEl.className = 'bzr-pdf-hover-body';
    bodyEl.textContent = '…';
    box.append(cap, bodyEl);
    document.body.appendChild(box);
    el = box;

    /* 贴鼠标右下；右边放不下就翻到左边，下面放不下就翻到上面 */
    const width = box.offsetWidth || 280;
    const height = box.offsetHeight || 120;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = anchor.right + 12 + width > vw ? Math.max(8, anchor.left - width - 12) : anchor.right + 12;
    const top = anchor.bottom + 10 + height > vh ? Math.max(8, anchor.top - height - 10) : anchor.bottom + 10;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;

    const doc = await loadDoc(app, path);
    if (!el || el !== box) return;
    const blob = doc ? await doc.renderThumb(page, THUMB_WIDTH).catch(() => null) : null;
    if (!el || el !== box) return;
    if (!blob || !bodyEl) {
      bodyEl?.remove();
      box.classList.add('is-empty');
      return;
    }
    const url = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    bodyEl.replaceChildren(img);
  };

  const onOver = (ev: MouseEvent): void => {
    const target = ev.target as Node | null;
    if (target && el?.contains(target)) return;
    const link = (ev.target as Element | null)?.closest?.('[data-href], a[href]') ?? null;
    if (!link) return;
    const href = hrefCandidates(link)[0] ?? '';
    const hit = pdfPathOf(href);
    if (!hit) return;
    clearTimers();
    pending = `${hit.path}#${hit.page}`;
    const rect = link.getBoundingClientRect();
    showTimer = window.setTimeout(() => {
      showTimer = null;
      void show(hit.path, hit.page, rect);
    }, WAIT_MS);
  };

  const onOut = (ev: MouseEvent): void => {
    const link = (ev.target as Element | null)?.closest?.('[data-href], a[href]') ?? null;
    if (!link) return;
    clearTimers();
    hideTimer = window.setTimeout(hide, HIDE_MS);
  };

  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  window.addEventListener('scroll', hide, true);
  return () => {
    clearTimers();
    el?.remove();
    el = null;
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('mouseout', onOut, true);
    window.removeEventListener('scroll', hide, true);
    for (const [, value] of docs) void value.doc?.destroy().catch(() => undefined);
    docs.clear();
  };
}
