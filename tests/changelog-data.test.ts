import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGELOG_RELEASES, compareVersions, pickReleaseFor, releaseEntryCount } from '../src/shell/changelog';

/* ============================================================
 * 内置更新日志与发布版本对账（发版门禁）。
 *
 * 0.3.1 的教训：manifest 升到了 0.3.1、release 也发出去了，但
 * `CHANGELOG_RELEASES` 忘了插这一块——升级后的用户不会弹「这版改了什么」。
 * pickReleaseFor 是全等匹配，忘插的代价不是弹错版本，而是**静默不弹**，
 * 这种失败方向只能靠代码对账兜住，不能靠记性。
 *
 * 以后每次发版：先把 manifest.version 改了，这条测试立刻红，逼着补日志。
 * ============================================================ */

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8')) as {
  version: string;
};

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
});
