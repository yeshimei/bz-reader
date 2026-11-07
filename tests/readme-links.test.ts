/**
 * README 对外链接（tests/readme-links.test.ts）
 *
 * README 是 markdown，import 不进来，视频地址只能手抄一份。手抄就会漂：
 * 换视频只改 `core/links.ts`，README 顶部仍是旧片，仓库门面上挂着一个
 * 放错的教程链接，而插件里点开的是新的——两边各说各话，谁都不会报错。
 *
 * 这条只守一件事：README 里出现的 B 站视频链接，有且只有 `VIDEO_TUTORIAL_URL`。
 * 加第二条视频（比如分 P 补充）时这里会红，那就该想清楚是改这里还是改 README。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VIDEO_TUTORIAL_URL } from '../src/core/links';

const VIDEO_LINK = /https:\/\/www\.bilibili\.com\/video\/[A-Za-z0-9]+/g;

describe('README · 视频教程地址', () => {
  it('与插件内的 VIDEO_TUTORIAL_URL 完全一致', () => {
    const readme = readFileSync('README.md', 'utf8');
    const found = readme.match(VIDEO_LINK) ?? [];

    expect(found.length).toBeGreaterThan(0);
    expect([...new Set(found)]).toEqual([VIDEO_TUTORIAL_URL]);
  });
});
