/* ============================================================
 * bz-reader · AI 正文的 Markdown 渲染（shell/ai-md.ts）
 *
 * 2026-11-11：以前所有 AI 输出都是 `esc()` 直出，模型回的
 * `**加粗**`、`1.` 列表、`` `代码` `` 全以原始字符出现在卡片上。
 * 这一层把「纯文本」升级成「渲染后的正文」，用的就是宿主自己的
 * MarkdownRenderer——不另造一套解析器，行内链接、代码块、列表都跟
 * Obsidian 里看到的完全一致。
 *
 * 为什么是「扫描 data-ai-md」而不是在每个调用点渲染：
 *   · 卡片的 DOM 是整块字符串拼出来的，注入之后才有元素可渲染；
 *   · 同一份答案会在多处出现（划词卡、侧栏、导读、面板），
 *     调用点越多越容易漏。
 * 所以模板只管打 `data-ai-md` 标记，注入完调一次 renderAiMarkdown(root)。
 *
 * 渲染是异步的（图片要解码、链接要解析）。渲染期间元素可能已经被下一次
 * 重画换掉，写入旧节点是安全的——它已经不在文档里了。
 * ============================================================ */
import type { App, Component } from 'obsidian';
import { MarkdownRenderer } from 'obsidian';

interface RenderCtx {
  app: App;
  owner: Component;
}

let ctx: RenderCtx | null = null;

/** 由插件在 onload 装一次；卸载时拆掉（渲染器握着 app 与组件生命周期） */
export function installAiMarkdown(app: App, owner: Component): void {
  ctx = { app, owner };
}

export function uninstallAiMarkdown(): void {
  ctx = null;
}

/**
 * 把 root 里所有还没渲染过的 `[data-ai-md]` 渲染成 Markdown。
 *
 * 已渲染的靠 `data-ai-rendered` 认；元素被重画换掉后标记跟着没了，
 * 自然会重渲一遍——这正是不把状态记在模块里的原因。
 */
export function renderAiMarkdown(root: ParentNode | null | undefined): void {
  const c = ctx;
  if (!c || !root) return;
  const list = Array.from(root.querySelectorAll<HTMLElement>('[data-ai-md]'));
  /* root 自己也可能是目标（刷新单个节点时传的就是它）。
     nodeType 1 = Element：跨窗口时 instanceof 不可靠，审核规则也不认它。 */
  if (root.nodeType === 1 && (root as Element).matches('[data-ai-md]')) {
    list.unshift(root as HTMLElement);
  }
  for (const el of list) {
    if (el.dataset.aiRendered === '1') continue;
    const md = el.textContent ?? '';
    if (!md.trim()) continue;
    el.dataset.aiRendered = '1';
    el.textContent = '';
    /* 渲染失败退回纯文本：读得到比好看重要，且不能把答案弄丢 */
    void MarkdownRenderer.render(c.app, md, el, '', c.owner).catch((e: unknown) => {
      el.textContent = md;
      void e;
    });
  }
}
