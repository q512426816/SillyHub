/**
 * interactive/host-settings-watcher 单测（2026-10-19-host-settings-live-reload /
 * FR-02 / FR-04）。
 *
 * 覆盖（真定时器 + 15ms 短轮询 + waitFor/静默窗；tmp 文件）：
 *   - envBlockFingerprint：键序无关 / 无 env 块 / 非法 JSON / 非对象 → 各自口径；
 *   - 启动第一拍只建基线不触发；
 *   - env 块变化 → 连续两拍一致才触发一次（去抖），载荷 = 新指纹；
 *   - 非 env 字段变化（permissions/hooks）→ 不触发；
 *   - 半写（损坏 JSON）→ 跳过不触发不抛；恢复后正常确认；
 *   - 文件缺失 → 不抛不触发；
 *   - stop() 后变化不再触发。
 *
 * 不用 vitest fake timers：poll 走 node:fs/promises（libuv 线程池宏任务），
 * fake timers 的 advanceTimersByTimeAsync 只刷微任务，fs 完成事件不可确定性推进
 * （实测首拍 readFile 未落、基线建到新值上 → 用例假红）。
 *
 * @module host-settings-watcher.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  envBlockFingerprint,
  HOST_SETTINGS_POLL_INTERVAL_MS,
  startHostSettingsWatcher,
} from '../../src/interactive/host-settings-watcher.js';

describe('HOST_SETTINGS_POLL_INTERVAL_MS — 默认节拍单一源（2026-10-19-host-settings-reload-latency）', () => {
  it('默认轮询节拍为 1000ms（提速 3s→1s；注入覆盖口径不变）', () => {
    expect(HOST_SETTINGS_POLL_INTERVAL_MS).toBe(1000);
  });
});

const ENV_GLM = JSON.stringify({
  env: { ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic' },
});
const ENV_MINIMAX = JSON.stringify({
  env: { ANTHROPIC_BASE_URL: 'https://api.minimax.cn/anthropic' },
});
// 非 env 变化口径：env 块与 ENV_GLM 完全一致，只增/改 env 之外的字段。
const ENV_GLM_PLUS_NON_ENV = JSON.stringify({
  env: { ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic' },
  permissions: { allow: ['Bash(ls *)'] },
  hooks: { PreToolUse: [] },
});
const INTERVAL_MS = 15;

let root: string;
let settingsPath: string;

/** 等待条件成立（真定时器轮询；超时抛错信息带 timeout 标记）。 */
async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** 静默窗：走过 ≥N 拍且确认没有触发。 */
async function quietWindow(ms = 8 * INTERVAL_MS): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'host-watch-'));
  settingsPath = join(root, 'settings.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 建基线：写入初始文件、起监听、走过数拍（断言未触发）。 */
async function establishBaseline(onChange: ReturnType<typeof vi.fn>) {
  writeFileSync(settingsPath, ENV_GLM, 'utf-8');
  const handle = startHostSettingsWatcher({
    settingsPath,
    pollIntervalMs: INTERVAL_MS,
    onChange,
  });
  await quietWindow();
  expect(onChange).not.toHaveBeenCalled();
  return handle;
}

describe('envBlockFingerprint — 纯函数口径', () => {
  it('键序无关 + 值参与', () => {
    expect(envBlockFingerprint('{"env":{"B":"2","A":"1"}}')).toBe(
      envBlockFingerprint('{"env":{"A":"1","B":"2"}}'),
    );
    expect(envBlockFingerprint('{"env":{"A":"1"}}')).not.toBe(
      envBlockFingerprint('{"env":{"A":"2"}}'),
    );
  });

  it('无 env 块 → 常量；非法 JSON / 数组 / env 非对象 → null', () => {
    expect(envBlockFingerprint('{"permissions":{}}')).toBe('null-env');
    expect(envBlockFingerprint('not json{')).toBeNull();
    expect(envBlockFingerprint('[1,2]')).toBeNull();
    expect(envBlockFingerprint('{"env":["x"]}')).toBeNull();
  });
});

describe('startHostSettingsWatcher — 轮询/去抖/容错', () => {
  it('启动第一拍只建基线，不触发', async () => {
    const onChange = vi.fn();
    await establishBaseline(onChange);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('env 变化：去抖确认后触发一次并携带新指纹；基线推进后静默', async () => {
    const onChange = vi.fn();
    const handle = await establishBaseline(onChange);

    writeFileSync(settingsPath, ENV_MINIMAX, 'utf-8');
    await waitFor(() => onChange.mock.calls.length === 1);
    expect(onChange.mock.calls[0]![0]).toBe(envBlockFingerprint(ENV_MINIMAX));

    // 内容不变再走数拍（基线已推进）不再触发。
    await quietWindow();
    expect(onChange).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  it('非 env 字段变化（permissions/hooks）→ 不触发', async () => {
    const onChange = vi.fn();
    const handle = await establishBaseline(onChange);

    writeFileSync(settingsPath, ENV_GLM_PLUS_NON_ENV, 'utf-8');
    await quietWindow();
    expect(onChange).not.toHaveBeenCalled();

    handle.stop();
  });

  it('半写损坏 → 跳过不抛；恢复后正常确认', async () => {
    const onChange = vi.fn();
    const handle = await establishBaseline(onChange);

    writeFileSync(settingsPath, '{"env":{"ANTHROPIC_BASE_URL":"https://api.m', 'utf-8');
    await quietWindow();
    expect(onChange).not.toHaveBeenCalled();

    writeFileSync(settingsPath, ENV_MINIMAX, 'utf-8');
    await waitFor(() => onChange.mock.calls.length === 1);
    expect(onChange.mock.calls[0]![0]).toBe(envBlockFingerprint(ENV_MINIMAX));

    handle.stop();
  });

  it('文件缺失 → 不抛不触发', async () => {
    const onChange = vi.fn();
    const handle = await establishBaseline(onChange);

    rmSync(settingsPath, { force: true });
    await quietWindow();
    expect(onChange).not.toHaveBeenCalled();

    handle.stop();
  });

  it('stop() 后变化不再触发（幂等停）', async () => {
    const onChange = vi.fn();
    const handle = await establishBaseline(onChange);

    handle.stop();
    handle.stop(); // 幂等
    writeFileSync(settingsPath, ENV_MINIMAX, 'utf-8');
    await quietWindow();
    expect(onChange).not.toHaveBeenCalled();
  });
});
