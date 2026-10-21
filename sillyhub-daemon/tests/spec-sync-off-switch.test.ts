// FR-01（2026-10-21-daemon-sync-hardening）：daemon spec 自动推送关闭开关测试。
//
// 覆盖：
//   - parseSpecSyncOffEnv 真值表（'1'/'true' 大小写不敏感；'0'/脏值/缺席=false）。
//   - postSpecSync 关闭态 = mock 等价语义：env 整机关闭返回 null 且零请求；
//     per-ws flag 关闭只影响该 ws，未设 flag 的 ws 照常走推送路径（以传输失败
//     落 pending_push 标记为「推送路径已走」的行为证据）。
//   - 关闭态 pending_push 标记不写不清（关闭是运维决策非传输失败）。
//
// 隔离：SILLYHUB_DAEMON_DIR 重定向 daemonStateDir 到临时目录（flag 落点与
// manifests/ 读写全部隔离，零真实用户态污染）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  postSpecSync,
  parseSpecSyncOffEnv,
  specSyncOffFlagPath,
  isDaemonSpecSyncOff,
} from '../src/spec-sync.js';
import type { HubClient } from '../src/hub-client.js';

const OFF_ENV = 'SILLYHUB_DAEMON_SPEC_SYNC_OFF';
const DIR_ENV = 'SILLYHUB_DAEMON_DIR';

let tmpState = '';
let tmpSpec = '';
let savedOff: string | undefined;
let savedDir: string | undefined;

beforeEach(() => {
  savedOff = process.env[OFF_ENV];
  savedDir = process.env[DIR_ENV];
  tmpState = mkdtempSync(join(tmpdir(), 'sync-off-state-'));
  tmpSpec = mkdtempSync(join(tmpdir(), 'sync-off-spec-'));
  process.env[DIR_ENV] = tmpState;
  delete process.env[OFF_ENV];
});

afterEach(() => {
  if (savedOff === undefined) delete process.env[OFF_ENV];
  else process.env[OFF_ENV] = savedOff;
  if (savedDir === undefined) delete process.env[DIR_ENV];
  else process.env[DIR_ENV] = savedDir;
  rmSync(tmpState, { recursive: true, force: true });
  rmSync(tmpSpec, { recursive: true, force: true });
});

/** 最小 mock client：postSpecSync spy（off 分支不应触达）。 */
function mockClient() {
  return { postSpecSync: vi.fn() } as unknown as HubClient & {
    postSpecSync: ReturnType<typeof vi.fn>;
  };
}

describe('parseSpecSyncOffEnv', () => {
  it("'1'/'true' 大小写不敏感视为关，'0'/脏值/缺席视为开", () => {
    expect(parseSpecSyncOffEnv('1')).toBe(true);
    expect(parseSpecSyncOffEnv('true')).toBe(true);
    expect(parseSpecSyncOffEnv('TRUE')).toBe(true);
    expect(parseSpecSyncOffEnv('True')).toBe(true);
    expect(parseSpecSyncOffEnv('0')).toBe(false);
    expect(parseSpecSyncOffEnv('false')).toBe(false);
    expect(parseSpecSyncOffEnv('yes')).toBe(false);
    expect(parseSpecSyncOffEnv('')).toBe(false);
    expect(parseSpecSyncOffEnv(undefined)).toBe(false);
  });
});

describe('isDaemonSpecSyncOff', () => {
  it("返回值细化：env 命中 'env'、flag 命中 'flag'、双缺省 null", async () => {
    expect(await isDaemonSpecSyncOff('ws-x')).toBeNull();

    process.env[OFF_ENV] = '1';
    expect(await isDaemonSpecSyncOff('ws-x')).toBe('env');
    delete process.env[OFF_ENV];

    mkdirSync(join(tmpState, 'spec-sync-off'), { recursive: true });
    writeFileSync(specSyncOffFlagPath('ws-x'), 'off\n');
    expect(await isDaemonSpecSyncOff('ws-x')).toBe('flag');
    expect(await isDaemonSpecSyncOff('ws-y')).toBeNull();
  });
});

describe('postSpecSync 关闭开关', () => {
  it('env 整机关闭：返回 null 且零请求', async () => {
    process.env[OFF_ENV] = '1';
    const client = mockClient();
    const result = await postSpecSync(client, 'ws-env', tmpSpec);
    expect(result).toBeNull();
    expect(client.postSpecSync).not.toHaveBeenCalled();
  });

  it('跳过日志标明命中来源（FR-03：来源=env / 来源=flag）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // env 命中。
      process.env[OFF_ENV] = '1';
      await postSpecSync(mockClient(), 'ws-src-env', tmpSpec);
      const envHit = warnSpy.mock.calls.find((c) => String(c[0]).includes('ws-src-env'));
      expect(String(envHit?.[0])).toContain('来源=env');
      delete process.env[OFF_ENV];
      // flag 命中。
      mkdirSync(join(tmpState, 'spec-sync-off'), { recursive: true });
      writeFileSync(specSyncOffFlagPath('ws-src-flag'), 'off\n');
      await postSpecSync(mockClient(), 'ws-src-flag', tmpSpec);
      const flagHit = warnSpy.mock.calls.find((c) => String(c[0]).includes('ws-src-flag'));
      expect(String(flagHit?.[0])).toContain('来源=flag');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('flag 按工作区关闭：该 ws 跳过，未设 flag 的 ws 照常走推送路径', async () => {
    mkdirSync(join(tmpState, 'spec-sync-off'), { recursive: true });
    writeFileSync(specSyncOffFlagPath('ws-a'), 'off\n');
    const client = mockClient();
    // ws-a：flag 命中 → null 且零请求。
    expect(await postSpecSync(client, 'ws-a', tmpSpec)).toBeNull();
    expect(client.postSpecSync).not.toHaveBeenCalled();
    // ws-b：无 flag → 走推送路径；传输失败时包装器落 pending_push 标记（行为证据）。
    client.postSpecSync.mockRejectedValue(new Error('net down'));
    await expect(postSpecSync(client, 'ws-b', tmpSpec)).rejects.toThrow('net down');
    expect(client.postSpecSync).toHaveBeenCalledTimes(1);
    expect(existsSync(join(tmpSpec, '.runtime', 'pending_push'))).toBe(true);
  });

  it('关闭态 pending_push 不写不清', async () => {
    mkdirSync(join(tmpSpec, '.runtime'), { recursive: true });
    const marker = join(tmpSpec, '.runtime', 'pending_push');
    writeFileSync(marker, '2026-10-21T00:00:00.000Z\n');
    process.env[OFF_ENV] = '1';
    const client = mockClient();
    expect(await postSpecSync(client, 'ws-marker', tmpSpec)).toBeNull();
    expect(client.postSpecSync).not.toHaveBeenCalled();
    expect(existsSync(marker)).toBe(true);
  });
});
