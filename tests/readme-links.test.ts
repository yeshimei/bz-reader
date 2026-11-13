/**
 * README 对外链接（tests/readme-links.test.ts）
 *
 * README 是 markdown，import 不进来，视频地址只能手抄一份。手抄就会漂：
 * 换视频只改 `core/links.ts`，README 顶部仍是旧片，仓库门面上挂着一个
 * 放错的教程链接，而插件里点开的是新的——两边各说各话，谁都不会报错。
 *
 * 这条守两件事：
 *   1. README 顶部的推荐视频必须还是 `VIDEO_TUTORIAL_URL`；
 *   2. README 里出现的每条 B 站视频，必须是 `core/links.ts` 里登记过的那几条
 *      （2026-11-14 起功能表里还有两条专属教程：AI 知识盒与剪藏成书）。
 *
 * 加新视频时：先往 links.ts 加常量，再来这里登记，最后改 README——
 * 任何一步漏掉都会在这里红，而不是等用户点开一条 404。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_TUTORIAL_URL, CLIP_TUTORIAL_URL, VIDEO_TUTORIAL_URL } from '../src/core/links';

const VIDEO_LINK = /https:\/\/www\.bilibili\.com\/video\/[A-Za-z0-9]+/g;

/** 插件里登记过的全部教程视频 */
const KNOWN = new Set([VIDEO_TUTORIAL_URL, AI_TUTORIAL_URL, CLIP_TUTORIAL_URL]);

describe('README · 视频教程地址', () => {
  it('顶部推荐视频仍是 VIDEO_TUTORIAL_URL', () => {
    const readme = readFileSync('README.md', 'utf8');
    const found = readme.match(VIDEO_LINK) ?? [];
    expect(found.length).toBeGreaterThan(0);
    expect(found, 'README 顶部那条推荐视频必须指向 VIDEO_TUTORIAL_URL').toContain(
      VIDEO_TUTORIAL_URL,
    );
  });

  it('出现的每条视频地址都在 core/links.ts 里登记过', () => {
    const readme = readFileSync('README.md', 'utf8');
    const found = [...new Set(readme.match(VIDEO_LINK) ?? [])];
    for (const url of found) {
      expect(KNOWN.has(url), `README 里的视频地址不在 core/links.ts 里：${url}`).toBe(true);
    }
  });
});
