#!/usr/bin/env node
// scripts/push-gitee.mjs — 码云（Gitee）镜像：Release 页 + 三件套资产 + 代码/tag
//
// 为什么有这一步：GitHub 在国内裸网时常连不上（Release 直下、API 一起挂），码云是同一份
// 内容的第二个出口。bz 主仓的安装器（src/core/reader-install.ts）按「GitHub 主 → 码云备」
// 两条通道拉三件套，少一边就等于备用线路缺一块。
//
// 三件事：
//   1. 推代码与 tag（git push gitee master + 当前 tag）
//   2. Release 页（标题 / 正文 = GitHub Release 的正文）
//   3. 三件套资产（main.js / styles.css / manifest.json；**从 GitHub Release 原样下载**，
//      不碰本地构建产物——两端字节一致才算镜像，本地工作区可能还没构建或构建了没提交）
//
// 用法：
//   node scripts/push-gitee.mjs            # 当前版本：推代码 + Release + 资产
//   node scripts/push-gitee.mjs --code     # 只推代码与当前 tag
//   node scripts/push-gitee.mjs --force    # 已存在的同名附件也重传（码云不支持同名覆盖）
//   node scripts/push-gitee.mjs --dry-run  # 只打印将要做的事
//
// token：~/.gitee-token（一行纯令牌）或环境变量 GITEE_TOKEN，权限需要 projects。
// **绝不写进仓库**——仓库是公开的，写进去等于把账号交出去。
//
// 顺序闸：只镜像**GitHub 上已经转正**的 Release（gh release view 回来不是 draft）。
// 备份通道同样是「对外可见」，先于正本上线等于给用户一条拿到半成品的路。
//
// 已知差异（不是 bug）：
//   - 码云没有 GitHub 的 releases/latest/download 别名，客户端要两步（API 拿 tag → 资产）；
//   - 码云附件不能同名覆盖，重传要先 DELETE 旧附件（--force 走这条）；
//   - tag 与 manifest.version **逐字相同、不带 v**（AGENTS 第 10 节）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 码云镜像 slug。与 bz 主仓 src/core/reader-install.ts 的 READER_GITEE_SLUG 对应，
 *  改这里要同步改那边（客户端备用通道就指着它）。 */
const SLUG = 'ntbl/bz-reader';
const GH_SLUG = 'yeshimei/bz-reader';
const API = 'https://gitee.com/api/v5';

const DRY = process.argv.includes('--dry-run');
const CODE_ONLY = process.argv.includes('--code');
const FORCE = process.argv.includes('--force');

const log = (m) => console.log(`[gitee] ${m}`);

function readToken() {
  if (process.env.GITEE_TOKEN) return process.env.GITEE_TOKEN.trim();
  const p = path.join(os.homedir(), '.gitee-token');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  console.error('[gitee] 缺令牌：把码云私人令牌写进 ~/.gitee-token（一行），或设 GITEE_TOKEN');
  process.exit(1);
}

const TOKEN = readToken();

async function api(method, p, json) {
  const url = `${API}${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url, {
    method,
    ...(json ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
const tag = version; // 本仓 tag 不带 v

/** 顺序闸：GitHub 上这个 tag 的 Release 必须已经转正 */
function githubRelease() {
  const raw = execFileSync('gh', ['release', 'view', tag, '--repo', GH_SLUG, '--json', 'isDraft,name,body'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const rel = JSON.parse(raw);
  if (rel.isDraft) {
    console.error(`[gitee] GitHub Release ${tag} 还是 draft —— 先转正，再把码云当备份通道对外`);
    process.exit(3);
  }
  return rel;
}

function pushCode() {
  log(`推送 master 与 tag ${tag}`);
  if (DRY) return;
  execFileSync('git', ['push', 'gitee', 'master'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('git', ['push', 'gitee', `refs/tags/${tag}`], { cwd: ROOT, stdio: 'inherit' });
}

/** 确保 Release 在位，标题/正文与 GitHub 一致 */
async function ensureRelease(body) {
  const name = `bz Reader ${tag}`;
  const list = await api('GET', `/repos/${SLUG}/releases?per_page=100`);
  let rel = (list || []).find((r) => r.tag_name === tag);
  if (!rel) {
    log(`创建 Release ${tag}`);
    if (DRY) return null;
    rel = await api('POST', `/repos/${SLUG}/releases`, {
      tag_name: tag,
      name,
      body,
      target_commitish: 'master',
      prerelease: false,
    });
  } else if (rel.name !== name || rel.body !== body) {
    log(`更新 Release ${tag} 的标题与正文`);
    if (!DRY) rel = await api('PATCH', `/repos/${SLUG}/releases/${rel.id}`, { name, body });
  } else {
    log(`Release ${tag} 已在位（正文一致）`);
  }
  return rel;
}

/** 三件套：从 GitHub Release 原样下载，再传码云（保证两端 sha256 相同） */
async function uploadAssets(rel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-reader-gitee-'));
  const have = await api('GET', `/repos/${SLUG}/releases/${rel.id}/attach_files`);
  const byName = new Map((have || []).map((a) => [a.name, a]));
  let sent = 0;
  for (const name of ['main.js', 'styles.css', 'manifest.json']) {
    const old = byName.get(name);
    if (old && !FORCE) {
      log(`跳过已有资产 ${name}`);
      continue;
    }
    if (old && FORCE) {
      log(`删除旧附件 ${name}（#${old.id}）`);
      if (!DRY) await api('DELETE', `/repos/${SLUG}/releases/${rel.id}/attach_files/${old.id}`);
    }
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      log(`从 GitHub Release 下载 ${name}`);
      execFileSync(
        'gh',
        ['release', 'download', tag, '--repo', GH_SLUG, '--pattern', name, '--dir', dir, '--clobber'],
        { cwd: ROOT, stdio: 'inherit' },
      );
    }
    const bytes = fs.readFileSync(file);
    log(`上传 ${name}（${(bytes.length / 1024).toFixed(0)} KB）`);
    if (DRY) continue;
    const fd = new FormData();
    fd.append('file', new Blob([bytes]), name);
    const res = await fetch(
      `${API}/repos/${SLUG}/releases/${rel.id}/attach_files?access_token=${encodeURIComponent(TOKEN)}`,
      { method: 'POST', body: fd },
    );
    if (!res.ok) throw new Error(`上传 ${name} 失败：${res.status} ${(await res.text()).slice(0, 200)}`);
    sent++;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return sent;
}

const ghRel = githubRelease();

if (CODE_ONLY) {
  pushCode();
  log('完成（只推代码与 tag）');
} else {
  pushCode();
  const rel = await ensureRelease(ghRel.body);
  if (rel) {
    const sent = await uploadAssets(rel);
    log(`Release ${tag}：本次上传 ${sent} 个资产`);
    log(`https://gitee.com/${SLUG}/releases/tag/${tag}`);
  }
}
