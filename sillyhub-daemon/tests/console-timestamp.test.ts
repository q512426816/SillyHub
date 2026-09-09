/**
 * console-timestamp.test.mjs/.ts —— daemon console 时间戳包装测试
 *
 * 覆盖（2026-09-08 temp 投毒排障衍生）：
 *   1. logTimestamp 格式：本地零填充 `YYYY-MM-DD HH:mm:ss.SSS`；
 *   2. install 后 console.log 输出带 `[ts]` 前缀（经 spy 透传验证原始实参不变）；
 *   3. 幂等：二次 install 零效果（console.log 引用不变，不叠加前缀）。
 *
 * console 是进程级全局——测试内保存/恢复四个通道引用，防污染同进程后续用例
 *（vitest 默认隔离按文件进程，文件内仍需自律）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { logTimestamp, installConsoleTimestamps } from '../src/console-timestamp.js';

const saved = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
const WRAP_FLAG = '__consoleTsWrapped';

afterEach(() => {
  console.log = saved.log;
  console.info = saved.info;
  console.warn = saved.warn;
  console.error = saved.error;
  delete (console as unknown as Record<string, unknown>)[WRAP_FLAG];
});

describe('2026-09-08 console 时间戳包装', () => {
  it('logTimestamp：本地零填充 YYYY-MM-DD HH:mm:ss.SSS', () => {
    expect(logTimestamp()).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/,
    );
  });

  it('install 后输出带 [ts] 前缀（wrap 持有的原通道收到时间戳首参）', () => {
    const calls: unknown[][] = [];
    const origLog = console.log;
    // spy 先于 install 替换：install 捕获 spy 当作原通道 → 输出经 wrap 前缀后
    // 到达 spy，首参即 `[ts]`。
    console.log = (...args: unknown[]) => {
      calls.push(args);
    };
    installConsoleTimestamps();
    console.log('[daemon.test_event]', 'key=value');
    expect(calls).toHaveLength(1);
    expect(String(calls[0]![0])).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]$/);
    expect(calls[0]![1]).toBe('[daemon.test_event]');
    expect(calls[0]![2]).toBe('key=value');
    void origLog;
  });

  it('既有测试零扰动：install 后再 spy 的用例记录的仍是调用点原始实参（无 ts）', () => {
    installConsoleTimestamps();
    // 模拟既有测试形态（silenceConsole / vi.spyOn 在包装之后替换 console.log）：
    // spy 直接替换 wrap → 调用点实参原样到达，既有断言语义不变。
    const calls: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      calls.push(args);
    };
    console.log('[daemon.test_event]', 'key=value');
    expect(calls).toEqual([['[daemon.test_event]', 'key=value']]);
  });

  it('幂等：二次 install 后 console.log 引用不变（不叠加前缀）', () => {
    installConsoleTimestamps();
    const afterFirst = console.log;
    installConsoleTimestamps();
    expect(console.log).toBe(afterFirst);
  });
});
