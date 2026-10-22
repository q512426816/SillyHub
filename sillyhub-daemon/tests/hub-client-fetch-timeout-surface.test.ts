// FR-05（2026-10-21-daemon-sync-hardening）：hub-client fetch 超时源码面断言。
//
// 背景：2026-10-21 daemon 宿主冻结事故里，唯一一处无 signal 的 fetch
// （fetchMcpWhitelist）与 spec-sync 长超时共同遮蔽了故障定位——「全部 fetch
// 必须带显式 AbortSignal.timeout」钉成源码面硬门禁，新增无 signal 的 fetch 即红。
//
// 扫描方式：纯 fs 读取 + 括号深度匹配截取每个 fetch( 调用的实参块（源码为
// 受控 TypeScript，实参块内无括号内嵌字符串字面量的病态形态；若未来出现，
// 该用例会以「块内无 signal」失败而暴露，届时改用 TS Scanner 与
// d004-no-taskkill-source-gate.test.ts 同款词法方案）。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HUB_CLIENT = join(__dirname, '..', 'src', 'hub-client.ts');

interface FetchCallSite {
  line: number;
  argsBlock: string;
}

/** 找出全部 fetch( 调用点并按括号深度截取实参块。 */
function scanFetchCallSites(source: string): FetchCallSite[] {
  const sites: FetchCallSite[] = [];
  const pattern = /\bfetch\s*\(/g;
  for (let m = pattern.exec(source); m !== null; m = pattern.exec(source)) {
    const openIdx = m.index + m[0].length - 1;
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }
    if (closeIdx < 0) continue; // 截断异常交由其他 lint 面，不在此误报
    const before = source.slice(0, m.index);
    sites.push({
      line: before.split('\n').length,
      argsBlock: source.slice(openIdx + 1, closeIdx),
    });
  }
  return sites;
}

describe('FR-05 hub-client 全部 fetch 带显式 AbortSignal 超时', () => {
  it('每个 fetch( 调用点的实参块内均含 signal:', () => {
    const source = readFileSync(HUB_CLIENT, 'utf-8');
    const sites = scanFetchCallSites(source);
    // 防扫描器失效（fetch 被全部移除时测试空转）。
    expect(sites.length).toBeGreaterThanOrEqual(9);
    const naked = sites.filter((s) => !/\bsignal\s*:/.test(s.argsBlock));
    expect(
      naked.map((s) => `hub-client.ts:${s.line} fetch(...) 缺 signal`),
    ).toEqual([]);
  });
});
