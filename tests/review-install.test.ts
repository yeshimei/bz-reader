/**
 * bz review 的一键安装（data/review-install.ts）
 *
 * 安装是「下载三件套 → 写进插件目录 → 启用」，每一步都可能坏在用户机器上。
 * 地址拼装与文件校验是纯函数，先钉死；写盘与启用交给真机验证。
 */
import { describe, expect, it } from 'vitest';
import { isReviewManifest, reviewGiteeAssets, reviewGithubAssets } from '../src/data/review-install';

describe('reviewGithubAssets：GitHub 直链', () => {
  it('三件套都挂在 latest/download 下，版本随发布自动跟进', () => {
    const a = reviewGithubAssets();
    expect(a.main).toBe('https://github.com/yeshimei/bz-review/releases/latest/download/main.js');
    expect(a.manifest).toBe('https://github.com/yeshimei/bz-review/releases/latest/download/manifest.json');
    expect(a.styles).toBe('https://github.com/yeshimei/bz-review/releases/latest/download/styles.css');
  });
});

describe('reviewGiteeAssets：从码云 release JSON 里挑下载地址', () => {
  const json = {
    tag_name: '1.0.0',
    assets: [
      { name: 'main.js', browser_download_url: 'https://gitee.com/ntbl/bz-review/releases/download/1.0.0/main.js' },
      {
        name: 'manifest.json',
        browser_download_url: 'https://gitee.com/ntbl/bz-review/releases/download/1.0.0/manifest.json',
      },
      { name: 'styles.css', browser_download_url: 'https://gitee.com/ntbl/bz-review/releases/download/1.0.0/styles.css' },
      { name: '1.0.0.zip', browser_download_url: 'https://gitee.com/ntbl/bz-review/archive/refs/tags/1.0.0.zip' },
    ],
  };

  it('挑出三件套，zip 不进列表', () => {
    expect(reviewGiteeAssets(json)).toEqual({
      main: 'https://gitee.com/ntbl/bz-review/releases/download/1.0.0/main.js',
      manifest: 'https://gitee.com/ntbl/bz-review/releases/download/1.0.0/manifest.json',
      styles: 'https://gitee.com/ntbl/bz-review/releases/download/1.0.0/styles.css',
    });
  });

  it('缺任何一件都算拿不到，不拼半套地址', () => {
    expect(reviewGiteeAssets({ assets: [{ name: 'main.js', browser_download_url: 'x' }] })).toBeNull();
    expect(reviewGiteeAssets(null)).toBeNull();
    expect(reviewGiteeAssets({})).toBeNull();
  });
});

describe('isReviewManifest：别把别的插件装进来', () => {
  it('id 是 bz-review 且有版本号才认', () => {
    expect(isReviewManifest(JSON.stringify({ id: 'bz-review', version: '1.0.0' }))).toBe(true);
  });

  it('别的 id / 坏 JSON / 空版本都不认', () => {
    expect(isReviewManifest(JSON.stringify({ id: 'bz-reader', version: '1.0.0' }))).toBe(false);
    expect(isReviewManifest(JSON.stringify({ id: 'bz-review', version: '' }))).toBe(false);
    expect(isReviewManifest('<!DOCTYPE html><html>404</html>')).toBe(false);
    expect(isReviewManifest('')).toBe(false);
  });
});
