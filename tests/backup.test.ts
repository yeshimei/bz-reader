import { describe, expect, it } from 'vitest';
import { backupFileName, buildBackup, parseBackup, replaceWithBackup } from '../src/data/backup';
import type { ReaderData } from '../src/data/schema';

function data(books = 2): ReaderData {
  return {
    version: 1,
    books: Array.from({ length: books }, (_, i) => ({
      id: `b${i}`,
      meta: { title: `书${i}` },
      fileRef: { vaultPath: `书/${i}.epub`, format: 'epub' as const, size: 10 },
      reading: { position: { percent: 0.5 }, stats: { totalReadTime: 60, lastReadTime: 1 }, sessions: [] },
      notes: { highlights: [], excerpts: [], bookmarks: [] },
      addedAt: 1,
      updatedAt: 1,
    })),
    goal: 30,
  };
}

describe('备份文件（数据一键备份）', () => {
  it('生成的文件带 app / version / exportedAt，能被 parseBackup 读回来', () => {
    const text = buildBackup(data(3), 12345);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.books).toHaveLength(3);
    expect(parsed.exportedAt).toBe(12345);
    expect(parsed.data.goal).toBe(30);
  });

  it('**不备份**激活码与 AI 配置', () => {
    /* 这是产品约束，不是实现细节：备份带上码就等于把授权复制到
       每一台恢复过备份的机器上。 */
    const text = buildBackup({ ...data(1), settings: { license: 'BZR1.a.b' } } as ReaderData, 1);
    expect(text).not.toContain('BZR1');
    expect(text).not.toContain('license');
    expect(text).not.toContain('apiKey');
  });

  /**
   * 版式是两个平台槽存的（prefsDesktop / prefsMobile）。以前备份只搬旧的
   * 全局 prefs，换设备恢复后两份槽都空着 —— 字号、行距全回到默认。
   */
  it('桌面 / 手机两套版式一起进备份文件', () => {
    const text = buildBackup(
      { ...data(1), prefsDesktop: { fontSize: 16 }, prefsMobile: { fontSize: 23 } } as ReaderData,
      1,
    );
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect((parsed.data.prefsMobile as { fontSize: number }).fontSize).toBe(23);
    expect((parsed.data.prefsDesktop as { fontSize: number }).fontSize).toBe(16);
  });

  it('坏 JSON 给人话，不是「恢复失败」四个字', () => {
    const r = parseBackup('{ 这不是 JSON');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('JSON');
  });

  it('拿别的 JSON 来恢复会被 app 标记挡住', () => {
    const r = parseBackup(JSON.stringify({ version: 1, books: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('bz 阅读');
  });

  it('books 不是数组时拒绝', () => {
    const r = parseBackup(JSON.stringify({ app: 'bz-reader', version: 1, data: { books: 'oops' } }));
    expect(r.ok).toBe(false);
  });

  it('半截书记录被 sanitize 丢掉，并报出丢弃条数', () => {
    const text = JSON.stringify({
      app: 'bz-reader',
      version: 1,
      exportedAt: 1,
      data: { version: 1, books: [data(1).books[0], { id: 'bad' }] },
    });
    const r = parseBackup(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.books).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });

  it('文件名带日期与时间，同一天多次备份不覆盖', () => {
    const a = backupFileName(new Date(2026, 10, 4, 8, 12));
    expect(a).toBe('bz-reader-backup-20261104-0812.json');
    const b = backupFileName(new Date(2026, 10, 4, 8, 13));
    expect(b).not.toBe(a);
  });

  it('打卡记录与每日目标也进备份（都是用户数据）', () => {
    const text = buildBackup(
      { ...data(1), checkins: { '2026-11-04': 1200 }, dailyGoalMinutes: 25 } as ReaderData,
      1,
    );
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.checkins).toEqual({ '2026-11-04': 1200 });
    expect(parsed.data.dailyGoalMinutes).toBe(25);
  });
});

describe('恢复 = 整份替换（replaceWithBackup）', () => {
  const book = (id: string, updatedAt: number, pct: number) => ({
    id,
    meta: { title: id },
    fileRef: { vaultPath: `书/${id}.epub`, format: 'epub' as const, size: 1 },
    reading: { position: { percent: pct }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: { highlights: [], excerpts: [], bookmarks: [] },
    addedAt: 1,
    updatedAt,
  });

  /**
   * 2026-11-08 用户拍板：恢复不再合并，当前数据不保留。
   * 这条锁的就是「本地 3 本、备份 2 本 → 恢复完正好 2 本」。
   */
  it('备份里有几本，恢复完就是几本：本地独有的书不保留', () => {
    const out = replaceWithBackup(
      { version: 1, books: [book('a', 1, 0.1), book('b', 1, 0.1), book('c', 1, 0.1)] },
      { version: 1, books: [book('a', 9, 0.8), book('z', 9, 0.5)] },
    );
    expect(out.books.map((b) => b.id)).toEqual(['a', 'z']);
    expect(out.books[0]!.reading.position.percent).toBe(0.8);
  });

  it('目标 / 打卡 / 排版偏好一律按备份来，不跟本机取大', () => {
    const out = replaceWithBackup(
      {
        version: 1,
        books: [],
        goal: 20,
        prefs: { fontSize: 18 },
        prefsMobile: { fontSize: 15 },
        prefsDesktop: { fontSize: 16 },
        dailyGoalMinutes: 20,
        checkins: { '2026-11-04': 1200, '2026-11-03': 600 },
      },
      {
        version: 1,
        books: [],
        goal: 30,
        prefs: { fontSize: 22 },
        prefsMobile: { fontSize: 23 },
        prefsDesktop: { fontSize: 24 },
        dailyGoalMinutes: 30,
        checkins: { '2026-11-04': 300 },
      },
    );
    expect(out.goal).toBe(30);
    expect((out.prefs as { fontSize: number }).fontSize).toBe(22);
    expect((out.prefsMobile as { fontSize: number }).fontSize).toBe(23);
    expect((out.prefsDesktop as { fontSize: number }).fontSize).toBe(24);
    expect(out.dailyGoalMinutes).toBe(30);
    expect(out.checkins).toEqual({ '2026-11-04': 300 });
  });

  it('数据目录保留本机的：备份里的路径在这台机器上不存在', () => {
    const out = replaceWithBackup(
      { version: 1, books: [], dataDir: '我的库/数据' },
      { version: 1, books: [], dataDir: '旧电脑/数据' },
    );
    expect(out.dataDir).toBe('我的库/数据');
  });
});
