/* ============================================================
 * bz-reader · 写作素材包面板（ui/material-panel.ts）
 *
 * 输入几个主题词 → 本地匹配划线与想法 → 按书分组 → 可存成笔记。
 *
 * 全程不发网络请求：这是「本地向量库 / 本地数据」这一档里最便宜的一件，
 * 用户点一下就能看到结果，没有等待、没有计费，也没有「模型觉得相关」的
 * 黑箱。
 * ============================================================ */
import { groupMaterials, matchMarks, materialMarkdown, type MaterialGroup, type MaterialMark } from '../data/material-kit';
import { clear, el } from './dom';
import { uiModal } from '../core/ui/modal';
import { t } from '../i18n';

export interface MaterialDeps {
  /** 当前库里的全部划线（调用方已按归档状态过滤） */
  marks: MaterialMark[];
  /** 存成笔记：返回写好的库内路径 */
  onSave: (topic: string, markdown: string) => Promise<string>;
}

export function openMaterials(deps: MaterialDeps): void {
  const root = el('div', 'bzr-sask bzr-mat');

  const bar = el('div', 'bzr-xs-bar');
  const input = el('input');
  input.type = 'text';
  input.placeholder = t('material.ph');
  const go = el('button', 'bzr-btn is-primary', t('material.go'));
  go.type = 'button';
  bar.append(input, go);

  const status = el('div', 'bzr-xs-status', t('material.hint'));
  const hits = el('div', 'bzr-xs-hits');
  const foot = el('div', 'bzr-sask-sources');
  root.append(bar, status, hits, foot);

  let last: { topic: string; markdown: string } | null = null;

  function dayOf(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function render(topic: string, groups: MaterialGroup[]): void {
    clear(hits);
    clear(foot);
    last = null;
    for (const group of groups) {
      const box = el('div', 'bzr-xs-group');
      box.appendChild(el('span', 'bzr-xs-group-t', group.bookTitle || t('common.untitled')));
      for (const hit of group.rows) {
        const row = el('div', 'bzr-xs-hit');
        if (hit.mark.chapterTitle) row.appendChild(el('span', 'bzr-xs-loc', hit.mark.chapterTitle));
        row.appendChild(document.createTextNode(String(hit.mark.text ?? '').replace(/\s+/g, ' ').trim()));
        if (hit.mark.comment && String(hit.mark.comment).trim()) {
          row.appendChild(el('div', 'bzr-mat-idea', `${t('material.idea')}：${String(hit.mark.comment).trim()}`));
        }
        box.appendChild(row);
      }
      hits.appendChild(box);
    }
    last = { topic, markdown: materialMarkdown({ topic, day: dayOf(), groups }) };
    if (last.markdown) {
      const save = el('button', 'bzr-btn', t('route.save'));
      save.type = 'button';
      save.addEventListener('click', () => {
        const payload = last;
        if (!payload) return;
        save.disabled = true;
        void deps
          .onSave(payload.topic, payload.markdown)
          .then((path) => {
            status.textContent = t('route.saved', { path });
          })
          .catch((e: unknown) => {
            status.textContent = (e as Error)?.message || t('common.unknownError');
            save.disabled = false;
          });
      });
      foot.appendChild(save);
    }
  }

  function run(): void {
    const topic = input.value.trim();
    if (!topic) return;
    const found = matchMarks(deps.marks, topic);
    if (!found.length) {
      clear(hits);
      clear(foot);
      status.textContent = t('material.none');
      return;
    }
    const groups = groupMaterials(found);
    status.textContent = t('material.found', { n: found.length, books: groups.length });
    render(topic, groups);
  }

  go.addEventListener('click', run);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    run();
  });

  uiModal({
    content: root,
    className: 'bzr-sask-popup',
    title: t('material.panel'),
    head: true,
    maxWidth: 620,
    autofocus: false,
    onClose: () => {
      last = null;
    },
  });
  window.setTimeout(() => input.focus(), 0);
}
