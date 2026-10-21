// FR-01（2026-10-21-spec-conflict-autoheal）：推送冲突自动自愈测试。
//
// 覆盖：
//   - 连续 2 次冲突触发自愈：第一次照旧上抛（无 tar 调用）；第二次自动备份并删
//     manifest → 递归走全量 tar（本地为准）→ 返回 ok、manifest 重建、备份落盘。
//   - 单次冲突不触发；env SILLYHUB_DAEMON_CONFLICT_AUTOHEAL=0 禁用；成功清零重计。
//
// 隔离：SILLYHUB_DAEMON_DIR 重定向（manifests/ 读写、备份目录全部进临时目录）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  postSpecSync,
  parseAutohealDisabledEnv,
  resolveManifestCachePath,
  SpecPushConflict,
  SPEC_SYNC_CONFLICT_AUTOHEAL_THRESHOLD,
} from '../src/spec-sync.js';
import type { HubClient } from '../src/hub-client.js';

const AUTOHEAL_ENV = 'SILLYHUB_DAEMON_CONFLICT_AUTOHEAL';
const DIR_ENV = 'SILLYHUB_DAEMON_DIR';

let tmpState = '';
let tmpSpec = '';
let savedAutoheal: string | undefined;
let savedDir: string | undefined;

beforeEach(() => {
  savedAutoheal = process.env[AUTOHEAL_ENV];
  savedDir = process.env[DIR_ENV];
  tmpState = mkdtempSync(join(tmpdir(), 'autoheal-state-'));
  tmpSpec = mkdtempSync(join(tmpdir(), 'autoheal-spec-'));
  process.env[DIR_ENV] = tmpState;
  delete process.env[AUTOHEAL_ENV];
  // spec 镜像树：一个真实小文件（增量 walk / 全量打包都要读它）。
  writeFileSync(join(tmpSpec, 'a.md'), '# hello\n');
});

afterEach(() => {
  if (savedAutoheal === undefined) delete process.env[AUTOHEAL_ENV];
  else process.env[AUTOHEAL_ENV] = savedAutoheal;
  if (savedDir === undefined) delete process.env[DIR_ENV];
  else process.env[DIR_ENV] = savedDir;
  rmSync(tmpState, { recursive: true, force: true });
  rmSync(tmpSpec, { recursive: true, force: true });
});

/** manifest 缓存 fixture：让 impl 走增量路径而非首同步。 */
function seedManifestCache(wsId: string): void {
  const p = resolveManifestCachePath(wsId);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(
    p,
    JSON.stringify({
      version: 1,
      files: { 'a.md': { hash: 'deadbeef', version: 3, mtime: 0 } },
    }) + '\n',
  );
}

/** 恒 conflict 的 mock 客户端：增量恒 conflict，全量 tar 可编程。 */
function conflictClient(tarImpl?: () => Promise<unknown>) {
  return {
    postSpecSyncIncremental: vi
      .fn()
      .mockResolvedValue({ conflict: true, server_versions: { 'a.md': 5 } }),
    postSpecSync: vi.fn().mockImplementation(tarImpl ?? (() => Promise.resolve({ ok: true, reparsed: 1 }))),
  } as unknown as HubClient & {
    postSpecSyncIncremental: ReturnType<typeof vi.fn>;
    postSpecSync: ReturnType<typeof vi.fn>;
  };
}

describe('parseAutohealDisabledEnv', () => {
  it("'0'/'false' 禁用，缺席/其他值不禁用", () => {
    expect(parseAutohealDisabledEnv('0')).toBe(true);
    expect(parseAutohealDisabledEnv('false')).toBe(true);
    expect(parseAutohealDisabledEnv('FALSE')).toBe(true);
    expect(parseAutohealDisabledEnv(undefined)).toBe(false);
    expect(parseAutohealDisabledEnv('1')).toBe(false);
    expect(parseAutohealDisabledEnv('on')).toBe(false);
  });
});

describe('postSpecSync 冲突自愈', () => {
  it('第一次冲突照旧上抛；第二次触发自愈全量重推（备份+重建 manifest）', async () => {
    seedManifestCache('ws-h');
    const client = conflictClient();
    // 第一次：streak 1 < 阈值 → 照旧抛，无 tar 调用、无备份。
    await expect(postSpecSync(client, 'ws-h', tmpSpec)).rejects.toThrow(SpecPushConflict);
    expect(client.postSpecSync).not.toHaveBeenCalled();
    const backupDir = join(tmpState, 'manifests-backup');
    expect(existsSync(backupDir)).toBe(false);
    // 第二次：streak 达阈值 → 自愈：递归走首同步 tar → ok。
    const result = await postSpecSync(client, 'ws-h', tmpSpec);
    expect(result).toMatchObject({ ok: true });
    expect(client.postSpecSync).toHaveBeenCalledTimes(1);
    // manifest 缓存被全量路径重建；备份恰一份。
    expect(existsSync(resolveManifestCachePath('ws-h'))).toBe(true);
    expect(readdirSync(backupDir)).toHaveLength(1);
    expect(readdirSync(backupDir)[0]).toContain('ws-h');
  });

  it(`阈值为常量 ${SPEC_SYNC_CONFLICT_AUTOHEAL_THRESHOLD}`, () => {
    expect(SPEC_SYNC_CONFLICT_AUTOHEAL_THRESHOLD).toBe(2);
  });

  it('env=0 禁用自愈：连续冲突始终照旧上抛、manifest 不动', async () => {
    process.env[AUTOHEAL_ENV] = '0';
    seedManifestCache('ws-d');
    const client = conflictClient();
    for (let i = 0; i < 3; i++) {
      await expect(postSpecSync(client, 'ws-d', tmpSpec)).rejects.toThrow(SpecPushConflict);
    }
    expect(client.postSpecSync).not.toHaveBeenCalled();
    expect(existsSync(resolveManifestCachePath('ws-d'))).toBe(true);
    expect(existsSync(join(tmpState, 'manifests-backup'))).toBe(false);
  });

  it('成功清零：冲突 1 次后成功，再冲突从 1 重计不立即自愈', async () => {
    seedManifestCache('ws-r');
    // 可编程增量开关（避免 Once 队列与 rebase 重试的调用计数歧义）。
    let incrementalConflict = true;
    const client = {
      postSpecSyncIncremental: vi.fn().mockImplementation(() =>
        incrementalConflict
          ? Promise.resolve({ conflict: true, server_versions: { 'a.md': 5 } })
          : Promise.resolve({ conflict: false, new_versions: { 'a.md': 6 } })),
      postSpecSync: vi.fn().mockResolvedValue({ ok: true, reparsed: 1 }),
    } as unknown as HubClient & {
      postSpecSyncIncremental: ReturnType<typeof vi.fn>;
      postSpecSync: ReturnType<typeof vi.fn>;
    };
    // 第一轮：冲突 → streak 1 → 照旧抛。
    await expect(postSpecSync(client, 'ws-r', tmpSpec)).rejects.toThrow(SpecPushConflict);
    expect(client.postSpecSync).not.toHaveBeenCalled();
    // 第二轮：增量修好 → 成功 → 计数清零。
    incrementalConflict = false;
    await expect(postSpecSync(client, 'ws-r', tmpSpec)).resolves.toMatchObject({ ok: true });
    // 第三轮：本地再改（制造真实变更）+ 增量再坏 → 冲突从 1 重计 → 照旧抛、无备份、无 tar。
    // （不改内容会命中 impl 的「无变化」短路成功路径——连推送都不会发起，构造不出冲突。）
    writeFileSync(join(tmpSpec, 'a.md'), '# hello v2\n');
    incrementalConflict = true;
    await expect(postSpecSync(client, 'ws-r', tmpSpec)).rejects.toThrow(SpecPushConflict);
    expect(client.postSpecSync).not.toHaveBeenCalled();
    expect(existsSync(join(tmpState, 'manifests-backup'))).toBe(false);
  });
});
