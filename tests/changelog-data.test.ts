import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGELOG_RELEASES, compareVersions, pickReleaseFor, releaseEntryCount } from '../src/shell/changelog';
import type { ChangelogEntry } from '../src/shell/changelog';

/* ============================================================
 * 内置更新日志与发布版本对账（发版门禁）。
 *
 * 0.3.1 的教训：manifest 升到了 0.3.1、release 也发出去了，但
 * `CHANGELOG_RELEASES` 忘了插这一块——升级后的用户不会弹「这版改了什么」。
 * pickReleaseFor 是全等匹配，忘插的代价不是弹错版本，而是**静默不弹**，
 * 这种失败方向只能靠代码对账兜住，不能靠记性。
 *
 * 0.4.0 的教训（第二次）：note 改稿之后只更新了 Release 正文，内置日志
 * 还是旧稿——弹窗与 Release 页说的不是同一件事。现在 note 是唯一真理源，
 * 两处文案**逐条**对账：少一条、多一条、换一句话都会在这里红。
 *
 * 以后每次发版：先改 note、再改内置日志，这条测试就是那道闸。
 * ============================================================ */

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8')) as {
  version: string;
};

interface NoteEntry {
  domain: string;
  text: string;
}

type NoteGroups = Record<'added' | 'improved' | 'fixed', NoteEntry[]>;

/**
 * 把 `docs/note-v<版本>.md` 的「更新日志」节解析成三组条目。
 *
 * 只认 `- **标签** ：说明` 这一种写法（全角或半角冒号都收）——模板以外的
 * 排版解析不了就让它解析成空，再由逐条对账把问题暴露出来。
 */
function parseNoteLog(version: string): NoteGroups {
  const path = join(__dirname, '..', 'docs', `note-v${version}.md`);
  const md = readFileSync(path, 'utf8');
  const start = md.indexOf('# 更新日志');
  expect(start, `${path} 里没有「# 更新日志」`).toBeGreaterThanOrEqual(0);
  const rest = md.slice(start);
  const next = rest.indexOf('\n# ', 1);
  const section = next < 0 ? rest : rest.slice(0, next);

  const groups: NoteGroups = { added: [], improved: [], fixed: [] };
  let cur: keyof NoteGroups | null = null;
  for (const line of section.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const t = heading[1];
      cur = t.includes('新增') ? 'added' : t.includes('优化') ? 'improved' : t.includes('修复') ? 'fixed' : null;
      continue;
    }
    const item = /^-\s+\*\*(.+?)\*\*\s*[：:]\s*(.+?)\s*$/.exec(line);
    if (item && cur) groups[cur].push({ domain: item[1].trim(), text: item[2].trim() });
  }
  return groups;
}

/** 取内置日志里的中文半边，形状与 note 对齐 */
function packEntries(list: readonly ChangelogEntry[] | undefined): NoteEntry[] {
  return (list ?? []).map((e) => ({ domain: e.domain.zh, text: e.text.zh }));
}

describe('内置更新日志对账（发版门禁）', () => {
  it('manifest.version 必须有对应的内置日志块', () => {
    const hit = pickReleaseFor(CHANGELOG_RELEASES, manifest.version);
    expect(
      hit,
      `发版前忘了在 src/shell/changelog.ts 里加 ${manifest.version}：升级后不会弹更新提示`,
    ).toBeTruthy();
    /* 连写法一起对：日志块写成 `v0.3.1` 也能被 pickReleaseFor 认出来，
       但两处版本号应当逐字一致，免得下一个人以为是两个版本。 */
    expect(hit?.version).toBe(manifest.version);
  });

  it('版本号不重复，且最新在最前', () => {
    const versions = CHANGELOG_RELEASES.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let i = 1; i < versions.length; i += 1) {
      expect(
        compareVersions(versions[i - 1]!, versions[i]!),
        `${versions[i - 1]} 应当比 ${versions[i]} 新（日志按最新在前排）`,
      ).toBeGreaterThan(0);
    }
  });

  it('每块至少一条内容，日期是 YYYY-MM-DD', () => {
    for (const r of CHANGELOG_RELEASES) {
      expect(releaseEntryCount(r), `${r.version} 没有条目`).toBeGreaterThan(0);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  /* 2026-11-09 立的第二条门禁（v1.40.0 式的第二次事故）：
     note 是真理源，内置日志必须逐条同口径。用户改稿后只改一处，
     用户看到的弹窗与 Release 页就会是两份说法。 */
  it('最新一块与 docs/note-v<版本>.md 逐条一致（note 改稿必须回灌）', () => {
    const rel = CHANGELOG_RELEASES[0]!;
    const note = parseNoteLog(rel.version);
    expect(packEntries(rel.added), '「新增」与 note 不一致').toEqual(note.added);
    expect(packEntries(rel.improved), '「优化」与 note 不一致').toEqual(note.improved);
    expect(packEntries(rel.fixed), '「修复」与 note 不一致').toEqual(note.fixed);
  });
});
