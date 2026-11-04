/**
 * 通知文案覆盖（tests/i18n-coverage.test.ts）
 *
 * 这条不是「测某个函数的行为」，而是守一条**一致性**：`notify()` 的第一参数
 * 不许再是裸中文。P0 把 91 处通知全部收进语言包，如果不设这道闸，下次加功能
 * 时随手写一句 `notify('保存成功')` 就能绕过去——英文用户那边立刻冒出中文，
 * 而这种漏翻在中文环境里永远看不见。
 *
 * 只认「字面量开头」的调用：`notify(someVariable)`、`notify()` 不在此列，
 * 因为它们的中文来自别处（data 层的错误消息，那是后续阶段要错误码化的部分）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = 'src';
const CJK = /[\u4e00-\u9fff]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('通知文案覆盖', () => {
  it('notify() 里没有裸中文字面量（新加的文案必须进语言包）', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // 注释行不算（说明里会引到旧文案）
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        // notify( 后面直接跟引号，且引号串里有汉字
        const m = /notify\(\s*(['"`])([^'"`]*)\1/.exec(line);
        if (m && CJK.test(m[2])) offenders.push(`${relative('.', file)}:${i + 1}  ${trimmed}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('语言包里的文案本身可以有中文，这条只是确认扫描器没扫空', () => {
    const zh = readFileSync(join(SRC, 'i18n', 'zh.ts'), 'utf8');
    expect(CJK.test(zh)).toBe(true);
  });
});
