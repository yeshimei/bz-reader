import { describe, expect, it } from 'vitest';
import {
  CHANGELOG_RELEASES,
  compareVersions,
  normalizeVersion,
  pickReleaseFor,
  planChangelog,
  releaseEntryCount,
  type ChangelogRelease,
} from '../src/shell/changelog';
import { activeIndex, changelogNoteHtml } from '../src/shell/changelog-note';

/* ============================================================
 * 更新日志弹窗（feat：第一次打开书库时弹一版）
 *
 * 逻辑与渲染分开测：版本比较 / 该不该弹 / 数据自检是纯函数，
 * 弹窗长什么样只看 HTML 字符串（不测真实布局，见 AGENTS 第 6 节）。
 * ============================================================ */

describe('版本号比较', () => {
  it('按段比数字，不是比字符串：0.1.10 比 0.1.9 新', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.9', '0.1.10')).toBeLessThan(0);
  });

  it('段数不同按补零处理：1.0 与 1.0.0 相等', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2', '0.10')).toBeLessThan(0);
  });

  it('认 v 前缀与首尾空白', () => {
    expect(compareVersions('v0.1.2', '0.1.2')).toBe(0);
    expect(compareVersions(' 0.1.2 ', '0.1.1')).toBeGreaterThan(0);
  });

  it('空版本当作最旧：任何真实版本都比它新', () => {
    expect(compareVersions('0.1.0', '')).toBeGreaterThan(0);
    expect(compareVersions('', '0.1.0')).toBeLessThan(0);
    expect(compareVersions('', '')).toBe(0);
  });
});

describe('normalizeVersion', () => {
  it('去掉 v 前缀与空白', () => {
    expect(normalizeVersion(' v0.1.2 ')).toBe('0.1.2');
    expect(normalizeVersion('0.1.2')).toBe('0.1.2');
  });

  it('空值给空串，不抛错', () => {
    expect(normalizeVersion('')).toBe('');
    expect(normalizeVersion(undefined as unknown as string)).toBe('');
  });
});

describe('pickReleaseFor', () => {
  const list: ChangelogRelease[] = [
    { version: '0.1.2', added: [{ domain: '书架', text: 'a' }] },
    { version: '0.1.1', added: [{ domain: '阅读', text: 'b' }] },
  ];

  it('完全相等的版本才命中（不做就近匹配）', () => {
    expect(pickReleaseFor(list, '0.1.1')?.version).toBe('0.1.1');
    expect(pickReleaseFor(list, 'v0.1.2')?.version).toBe('0.1.2');
  });

  it('数据里没有这一版就是 null——调用方据此不弹、只记账', () => {
    expect(pickReleaseFor(list, '0.1.3')).toBeNull();
    expect(pickReleaseFor(list, '')).toBeNull();
  });
});

describe('releaseEntryCount', () => {
  it('三段求和', () => {
    const r: ChangelogRelease = {
      version: '1.0.0',
      added: [{ domain: 'a', text: '1' }, { domain: 'b', text: '2' }],
      improved: [{ domain: 'c', text: '3' }],
      fixed: [{ domain: 'd', text: '4' }],
    };
    expect(releaseEntryCount(r)).toBe(4);
  });

  it('空的版本是 0（不弹空窗的判据）', () => {
    expect(releaseEntryCount({ version: '1.0.0' })).toBe(0);
  });
});

describe('planChangelog：该不该弹', () => {
  it('升级过（记录版本更旧）→ 弹', () => {
    expect(planChangelog({ current: '0.1.2', seen: '0.1.1', freshInstall: false })).toEqual({
      action: 'show',
      version: '0.1.2',
    });
  });

  it('本功能上线前的老库（没有记录）→ 当作升级，弹一次', () => {
    expect(planChangelog({ current: '0.1.2', seen: '', freshInstall: false })).toEqual({
      action: 'show',
      version: '0.1.2',
    });
  });

  it('真新装（data.json 本来就不存在）→ 只记账不弹：第一次用的人没经历过旧版', () => {
    expect(planChangelog({ current: '0.1.2', seen: '', freshInstall: true })).toEqual({
      action: 'record',
      version: '0.1.2',
    });
  });

  it('同一版已经记过 → 什么都不做（不写盘、不弹）', () => {
    expect(planChangelog({ current: '0.1.2', seen: '0.1.2', freshInstall: false })).toEqual({
      action: 'skip',
      version: '',
    });
  });

  it('降级 / 回滚（当前比记录旧）→ 只记账，不弹', () => {
    expect(planChangelog({ current: '0.1.1', seen: '0.1.2', freshInstall: false })).toEqual({
      action: 'record',
      version: '0.1.1',
    });
  });

  it('拿不到当前版本 → 跳过', () => {
    expect(planChangelog({ current: '', seen: '0.1.1', freshInstall: false })).toEqual({
      action: 'skip',
      version: '',
    });
  });
});

describe('内置更新日志数据', () => {
  it('至少有一版，且由新到旧排列', () => {
    expect(CHANGELOG_RELEASES.length).toBeGreaterThan(0);
    for (let i = 1; i < CHANGELOG_RELEASES.length; i += 1) {
      expect(compareVersions(CHANGELOG_RELEASES[i - 1].version, CHANGELOG_RELEASES[i].version)).toBeGreaterThan(0);
    }
  });

  it('版本号不重复（重复会让时间轴选错一版）', () => {
    const seen = new Set(CHANGELOG_RELEASES.map((r) => normalizeVersion(r.version)));
    expect(seen.size).toBe(CHANGELOG_RELEASES.length);
  });

  it('每一版都有条目，且条目都有域名与文案', () => {
    for (const r of CHANGELOG_RELEASES) {
      expect(releaseEntryCount(r)).toBeGreaterThan(0);
      for (const e of [...(r.added ?? []), ...(r.improved ?? []), ...(r.fixed ?? [])]) {
        expect(e.domain.trim()).not.toBe('');
        expect(e.text.trim()).not.toBe('');
      }
    }
  });

  it('日期都是 YYYY-MM-DD（弹窗里格式化成点号）', () => {
    for (const r of CHANGELOG_RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('activeIndex：弹窗先停在哪一版', () => {
  it('命中本次要提示的版本', () => {
    expect(activeIndex(CHANGELOG_RELEASES, '0.1.1')).toBe(1);
    expect(activeIndex(CHANGELOG_RELEASES, 'v0.1.2')).toBe(0);
  });

  it('找不到 / 没给 → 停在最新一版（0）', () => {
    expect(activeIndex(CHANGELOG_RELEASES, '9.9.9')).toBe(0);
    expect(activeIndex(CHANGELOG_RELEASES)).toBe(0);
    expect(activeIndex([], '0.1.0')).toBe(0);
  });
});

describe('更新日志弹窗的 DOM 结构', () => {
  const html = changelogNoteHtml(CHANGELOG_RELEASES, '0.1.2');

  it('桌面版有版本时间轴 + 单版正文', () => {
    expect(html).toContain('class="bzs-chgn-rail"');
    expect(html).toContain('class="bzs-chgn-pane"');
    expect(html).toContain('class="bzs-chgn-body"');
    expect(html).toContain('class="bzs-chgn-rail-list"');
  });

  it('时间轴里每个版本一颗按钮，当前版带 on 与 aria-current', () => {
    expect(html).toContain('data-i="0"');
    expect(html).toContain('data-i="1"');
    expect(html).toContain('aria-current="true"');
    expect((html.match(/class="bzs-chgn-v on"/g) ?? []).length).toBe(1);
  });

  it('正文先落在本次要提示的那一版，版本号与日期并排', () => {
    expect(html).toContain('v0.1.2');
    expect(html).toContain('2026.11.04');
    expect(html).toContain('本次更新');
  });

  it('三段按「新功能 / 体验优化 / 修复」排，且标题与条目都在', () => {
    expect(html).toContain('新功能');
    expect(html).toContain('体验优化');
    expect(html).toContain('修复');
    const first = CHANGELOG_RELEASES[0];
    for (const e of [...(first.added ?? []), ...(first.improved ?? []), ...(first.fixed ?? [])]) {
      expect(html).toContain(e.domain);
      expect(html).toContain(e.text);
    }
  });

  it('统计行报出总条数与各段条数', () => {
    expect(html).toContain('共 2 处改动');
  });

  it('手机版是整篇文档流：所有版本按新→旧铺开，不设版本栏', () => {
    expect(html).toContain('class="bzs-chgn-m"');
    expect(html).toContain('class="bzs-chgn-mpage"');
    const mob = html.slice(html.indexOf('class="bzs-chgn-m"'));
    for (const r of CHANGELOG_RELEASES) expect(mob).toContain(`v${r.version}`);
    expect(mob).toContain('当前');
  });

  it('关闭钮两端各一颗，外部入口给的是能被 JS 认出的 data 属性', () => {
    expect((html.match(/bzs-chgn-close/g) ?? []).length).toBe(2);
    expect(html).toContain('data-href="https://github.com/yeshimei/bz-reader"');
    expect(html).toContain('data-role="chgndone"');
  });

  it('没有条目的一段不画（构造一版只有修复）', () => {
    const only: ChangelogRelease[] = [
      { version: '0.1.2', date: '2026-11-04', fixed: [{ domain: '安装', text: '修好了' }] },
    ];
    const out = changelogNoteHtml(only, '0.1.2');
    expect(out).toContain('修复');
    expect(out).not.toContain('新功能');
    expect(out).not.toContain('体验优化');
  });

  it('一版都没有 → 空串，调用方不会开一个空窗', () => {
    expect(changelogNoteHtml([], '0.1.2')).toBe('');
    expect(changelogNoteHtml([{ version: '', added: [] }], '')).toBe('');
  });

  it('文案里的尖括号会被转义，不会把弹窗撑破', () => {
    const out = changelogNoteHtml(
      [{ version: '0.1.2', date: '2026-11-04', added: [{ domain: '<b>', text: '</div><script>x</script>' }] }],
      '0.1.2',
    );
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;/div&gt;');
  });
});
