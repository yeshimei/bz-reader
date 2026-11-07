#!/usr/bin/env node
// 生成 README 顶部两枚会变的自托管徽章：
//   version.svg   ← manifest.json 的 version
//   downloads.svg ← GitHub Release 里 main.js 资产的累计下载数（≈ 实际安装数）
// 其余三枚（obsidian / platform / license）不随版本变，手写在 docs/images/badges/。
//
// 用法：node scripts/update-badges.mjs [--downloads 123]

import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'docs', 'images', 'badges')
const REPO = 'yeshimei/bz-reader'

// 现有四枚徽章的实测度量，改了就全歪
const LABEL_CH = 6.59 // 9.5px 等宽 + 0.7 字距
const VALUE_CH = 6.62 // 11px 等宽
const LABEL_GAP = 8.3
const RIGHT_PAD = 14

function badge(label, value, dot, aria) {
  const valueX = 24 + label.length * LABEL_CH + LABEL_GAP
  const width = Math.round(valueX + value.length * VALUE_CH + RIGHT_PAD)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="27" viewBox="0 0 ${width} 27" role="img" aria-label="${aria}">
  <rect x="0.5" y="0.5" width="${width - 1}" height="26" rx="8" fill="#1f1f1e" stroke="#2e2d29"/>
  <circle cx="14.5" cy="13.5" r="2.5" fill="${dot}"/>
  <text x="24" y="16.7" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="9.5" letter-spacing="0.7" fill="#8a8478">${label}</text>
  <text x="${valueX.toFixed(2)}" y="17.4" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11" font-weight="600" fill="#e7e2d7">${value}</text>
</svg>
`
}

function downloadsFromGh() {
  const raw = execFileSync('gh', ['api', `repos/${REPO}/releases?per_page=100`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const releases = JSON.parse(raw)
  return releases
    .flatMap((r) => r.assets ?? [])
    .filter((a) => a.name === 'main.js')
    .reduce((sum, a) => sum + a.download_count, 0)
}

// 仓库 core.autocrlf=true，检出后是 CRLF，写回的是 LF；不归一化的话每次都会「已更新」
const sameText = (a, b) =>
  a !== null && a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')

async function write(file, content) {
  const target = path.join(OUT_DIR, file)
  const prev = await readFile(target, 'utf8').catch(() => null)
  if (sameText(prev, content)) {
    console.log(`${file} 无变化`)
    return
  }
  await writeFile(target, content, 'utf8')
  console.log(`${file} 已更新`)
}

const argIdx = process.argv.indexOf('--downloads')
const override = argIdx > -1 ? Number(process.argv[argIdx + 1]) : null

const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'))
const version = manifest.version

let downloads = Number.isFinite(override) ? override : null
if (downloads === null) {
  try {
    downloads = downloadsFromGh()
  } catch (err) {
    console.error(`取不到 GitHub 下载数（${err.message.split('\n')[0]}），下载量徽章保持原样`)
  }
}

await write('version.svg', badge('VERSION', version, '#a8a399', `VERSION: ${version}`))
if (downloads !== null) {
  const shown = downloads.toLocaleString('en-US')
  await write('downloads.svg', badge('DOWNLOADS', shown, '#8ea6b0', `DOWNLOADS: ${shown}`))
  console.log(`main.js 累计下载 ${shown}（跨全部 Release）`)
}
