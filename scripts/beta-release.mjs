#!/usr/bin/env node
/**
 * 测试通道：一条命令把当前代码打成 GitHub prerelease，给 iPhone 用 BRAT 拉取。
 *
 * 跟正式发版（bz-release / AGENTS.md「上架」）是两条路，这里只做四件事：
 *   1. 补丁号 +1（0.3.1 → 0.3.2）
 *   2. production 构建三件套
 *   3. gh release create <ver> --prerelease，附 main.js / manifest.json / styles.css
 *   4. 删掉上一个测试包，保持列表里只有一个 beta 包在滚
 *
 * 不做：changelog、多语言补全、obsidian lint、versions.json、badge、码云镜像、git commit。
 * 代码改完现场就能发，不用先提交（tag 落在 origin/master 的 HEAD 上，产物是本地构建）。
 *
 * 为什么必须涨号：BRAT 判定「有没有更新」是拿本地 manifest.version 与远程比，
 * 远程不涨就不下载。同一个 Release 反复覆盖资产，手机上点检查更新永远是「已是最新」。
 * 非语义 tag（beta / nightly）在 BRAT 的排序里还会排在所有版本号后面，选不中。
 *
 * 用法：
 *   node scripts/beta-release.mjs            # 构建 + 发版 + 清旧包
 *   node scripts/beta-release.mjs --check    # 发之前先过 tsc
 *   node scripts/beta-release.mjs --keep-old # 留下历史测试包
 *   node scripts/beta-release.mjs --dry-run  # 只说到哪个版本、不发
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const ASSETS = ["main.js", "manifest.json", "styles.css"];

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const KEEP_OLD = argv.includes("--keep-old");
const DRY = argv.includes("--dry-run");

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.quiet ? "pipe" : "inherit",
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (res.status !== 0) {
    const detail = opts.quiet ? `\n${res.stdout || ""}${res.stderr || ""}` : "";
    throw new Error(`${cmd} ${args.join(" ")} 失败（exit ${res.status}）${detail}`);
  }
  return (res.stdout || "").trim();
}

function gh(args) {
  return run("gh", args, { quiet: true });
}

/** 从 tag 里抠 major.minor.patch，非语义 tag 返回 null（git 里的 beta / nightly 之类）。 */
function baseVersion(tag) {
  const m = String(tag).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

function bumpPatch(version) {
  const [maj, min, patch] = version.split(".").map(Number);
  return `${maj}.${min}.${patch + 1}`;
}

function cmp(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// ---------- 1. 算下一个版本号 ----------
const manifestRaw = fs.readFileSync(MANIFEST_PATH, "utf8");
const manifest = JSON.parse(manifestRaw);
const localVersion = baseVersion(manifest.version);
if (!localVersion) throw new Error(`manifest.version 不是 x.y.z：${manifest.version}`);

const releases = JSON.parse(gh(["release", "list", "-L", "100", "--json", "tagName,isPrerelease"]) || "[]");
const tags = releases.map((r) => baseVersion(r.tagName)).filter(Boolean);
const highest = [localVersion, ...tags].sort(cmp).pop();
const nextVersion = bumpPatch(highest);

console.log(`当前 manifest：${manifest.version}`);
console.log(`已有最高版本：${highest}`);
console.log(`本轮测试包：  ${nextVersion}${DRY ? "（dry-run，不执行）" : ""}`);
if (DRY) process.exit(0);

// ---------- 2. 可选门禁 ----------
if (CHECK) {
  console.log("\n[1/4] tsc --noEmit");
  run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
} else {
  console.log("\n[1/4] 跳过 tsc（要过就加 --check）");
}

// ---------- 3. 改版本 → 构建 → 恢复 ----------
// 构建时 esbuild 从 manifest.json 读版本写进 __BZ_BUILD_TAG__，产物里的版本
// 必须跟 release tag 一致，所以得先临时改写，构建完再原样写回（仓库里的
// manifest 保持开发态版本，等正式发版才动）。
// 三件套先复制到暂存区再恢复 manifest：上传时读的是暂存区，否则
// gh 会把手已改回开发版本的 manifest 传上去，Release 里就还是旧版本号。
const staging = path.join(ROOT, "tmp", "beta-release", nextVersion);
const staged = { ...manifest, version: nextVersion };
try {
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(staged, null, 2) + "\n", "utf8");
  console.log(`\n[2/4] production 构建（manifest 临时标记为 ${nextVersion}）`);
  run(process.execPath, ["esbuild.config.mjs", "production"], {
    // 指向一个不存在的目录：只产三件套，不往任何库同步半成品
    env: { BZ_READER_VAULT: path.join(ROOT, ".no-vault") },
  });
  for (const asset of ASSETS) {
    const src = path.join(ROOT, asset);
    if (!fs.existsSync(src)) throw new Error(`构建产物缺失：${asset}`);
    fs.copyFileSync(src, path.join(staging, asset));
  }
} finally {
  fs.writeFileSync(MANIFEST_PATH, manifestRaw, "utf8");
}

// 上传前把暂存区的版本号再核一遍，防止哪次重构又把顺序写反
const stagedManifest = JSON.parse(fs.readFileSync(path.join(staging, "manifest.json"), "utf8"));
if (stagedManifest.version !== nextVersion) {
  throw new Error(`暂存 manifest 版本是 ${stagedManifest.version}，与 tag ${nextVersion} 不一致，拒绝发布`);
}

// ---------- 4. 发 prerelease ----------
// tag 落在远程 master 的 HEAD 上。本地未提交的改动不会进仓库，但已经进了
// 构建产物——测试通道要的就是这个：改完现场发，不用先收拾 git。
let target = "";
try {
  target = run("git", ["rev-parse", "origin/master"], { quiet: true });
} catch {
  /* 没有 origin/master 就让 gh 用默认分支 */
}

const repo = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
const notes = [
  `测试通道构建，对应本地工作区（tag 指向 ${target ? target.slice(0, 7) : "默认分支"}）。`,
  "",
  "安装 / 更新：Obsidian → BRAT → Add Beta Plugin 填 `" + repo + "`，之后点 Check for updates。",
].join("\n");

console.log(`\n[3/4] 发布 Release ${nextVersion}（prerelease）`);
const createArgs = [
  "release", "create", nextVersion,
  ...ASSETS.map((asset) => path.join(staging, asset)),
  "--prerelease",
  "--title", `${nextVersion} 测试版`,
  "--notes", notes,
];
if (target) createArgs.push("--target", target);
gh(createArgs);

// ---------- 5. 清掉旧的测试包 ----------
if (!KEEP_OLD) {
  const stale = releases.filter((r) => r.isPrerelease && baseVersion(r.tagName) !== nextVersion);
  if (stale.length) {
    console.log(`\n[4/4] 清理 ${stale.length} 个旧测试包：${stale.map((r) => r.tagName).join(", ")}`);
    for (const r of stale) {
      try {
        gh(["release", "delete", r.tagName, "--yes", "--cleanup-tag"]);
      } catch (e) {
        console.warn(`  清理 ${r.tagName} 失败（不影响本次）：${e.message.split("\n")[0]}`);
      }
    }
  } else {
    console.log("\n[4/4] 没有旧测试包要清");
  }
} else {
  console.log("\n[4/4] --keep-old：保留历史测试包");
}

console.log(`\n✓ ${nextVersion} 已上线（prerelease）`);
console.log(`  https://github.com/${repo}/releases/tag/${nextVersion}`);
console.log("\niPhone 上：BRAT → Check for updates for all plugins");
console.log("首次安装：BRAT → Add Beta Plugin → 填 " + repo);
