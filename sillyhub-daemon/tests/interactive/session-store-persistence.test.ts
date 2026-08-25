// tests/interactive/session-store-persistence.test.ts
// task-10 Step 1：sessions.json schema / 原子写 / 串行 / 损坏隔离 / 0o600。
//
// 覆盖（蓝图 §4.1/§4.2 + §7 边界 3/13 + AC-10-01/06）：
//   - 不存在文件 → load 返回 []（不 warn、不创建）。
//   - 合法 v1（1-2 条记录）→ load 返回原结构。
//   - 非法 version（version=2 / 缺 version）→ quarantine + 空集合。
//   - 损坏 JSON（截断）→ 重命名 sessions.json.corrupt-<epoch> + 空集合。
//   - save 用临时文件 + rename（原子）；并发 save 经 promise queue 串行（最后一条 win）。
//   - save 内容不含 token/prompt/output（白名单元数据）。
//   - 0o600 权限调用（Windows 无效但保留）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonSessionPersistence } from '../../src/interactive/session-store-persistence.js';
import {
  SESSION_FILE_VERSION,
  type PersistedSessionRecord,
} from '../../src/interactive/types.js';

// ── 辅助 ──────────────────────────────────────────────────────────────────────

function mkRecord(over: Partial<PersistedSessionRecord> = {}): PersistedSessionRecord {
  return {
    sessionId: 'sess-1',
    leaseId: 'lease-1',
    agentSessionId: 'sdk-sess-1',
    cwd: 'C:\\work',
    provider: 'claude',
    turnCount: 2,
    lastActiveAt: 1_700_000_000_000,
    ...over,
  };
}

function mkdtempDir(): string {
  return mkdtempSync(join(tmpdir(), 'sess-persist-'));
}

// ── load ──────────────────────────────────────────────────────────────────────

describe('JsonSessionPersistence.load', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempDir();
    file = join(dir, 'sessions.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('文件不存在 → load 返回 []（不创建文件）', async () => {
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('合法 v1（含 1 条记录）→ load 返回原结构', async () => {
    const rec = mkRecord();
    writeFileSync(
      file,
      JSON.stringify({
        version: SESSION_FILE_VERSION,
        savedAt: '2026-06-18T00:00:00Z',
        sessions: [rec],
      }),
    );
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toEqual([rec]);
  });

  it('合法 v1（含 2 条 + 可选字段）→ load 返回完整结构', async () => {
    const rec1 = mkRecord({ model: 'glm-5.2', pathToClaudeCodeExecutable: 'C:\\b\\c.exe' });
    const rec2 = mkRecord({
      sessionId: 'sess-2',
      leaseId: 'lease-2',
      agentSessionId: 'sdk-sess-2',
      cwd: '/home/x',
      currentRunId: 'run-9',
      provider: 'claude',
      turnCount: 5,
      lastActiveAt: 1_700_000_001_000,
    });
    writeFileSync(
      file,
      JSON.stringify({
        version: SESSION_FILE_VERSION,
        savedAt: '2026-06-18T00:00:00Z',
        sessions: [rec1, rec2],
      }),
    );
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ model: 'glm-5.2', pathToClaudeCodeExecutable: 'C:\\b\\c.exe' });
    expect(records[1]).toMatchObject({ currentRunId: 'run-9', cwd: '/home/x' });
  });

  it('version=2（不支持）→ quarantine + 空集合', async () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 2, savedAt: 'x', sessions: [mkRecord()] }),
    );
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toEqual([]);
    // 原文件被重命名为 .corrupt-<epoch>。
    const leftover = existsSync(file);
    expect(leftover).toBe(false);
    const dirEntries = require('node:fs').readdirSync(dir) as string[];
    const corrupt = dirEntries.find((e) => e.startsWith('sessions.json.corrupt-'));
    expect(corrupt).toBeDefined();
  });

  it('缺 version 字段 → quarantine + 空集合', async () => {
    writeFileSync(file, JSON.stringify({ savedAt: 'x', sessions: [mkRecord()] }));
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('损坏 JSON（截断）→ 重命名 .corrupt-<epoch> + 空集合（不抛）', async () => {
    writeFileSync(file, '{ "version": 1, "sessions": ['); // 截断
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('单条记录 schema 非法（cwd 空）→ 该条被丢弃，其余保留（损坏隔离）', async () => {
    const good = mkRecord();
    const badCwd = { ...mkRecord({ sessionId: 'sess-bad' }), cwd: '' };
    writeFileSync(
      file,
      JSON.stringify({
        version: SESSION_FILE_VERSION,
        savedAt: 'x',
        sessions: [good, badCwd],
      }),
    );
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toHaveLength(1);
    expect(records[0].sessionId).toBe('sess-1');
  });

  it('单条记录 provider 非 claude/codex → 该条丢弃', async () => {
    const bad = { ...mkRecord({ sessionId: 's2' }), provider: 'foo' as never };
    writeFileSync(
      file,
      JSON.stringify({
        version: SESSION_FILE_VERSION,
        savedAt: 'x',
        sessions: [mkRecord(), bad],
      }),
    );
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toHaveLength(1);
    expect(records[0].sessionId).toBe('sess-1');
  });

  it('agentSessionId 空 → 该条丢弃（不可恢复，D-003）', async () => {
    const noAgent = { ...mkRecord({ sessionId: 's2', agentSessionId: '' }) };
    writeFileSync(
      file,
      JSON.stringify({
        version: SESSION_FILE_VERSION,
        savedAt: 'x',
        sessions: [mkRecord(), noAgent],
      }),
    );
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toHaveLength(1);
    expect(records[0].sessionId).toBe('sess-1');
  });
});

// ── save ──────────────────────────────────────────────────────────────────────

describe('JsonSessionPersistence.save', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempDir();
    file = join(dir, 'sessions.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('原子写：写完后 load 返回相同记录；version=1', async () => {
    const p = new JsonSessionPersistence(file);
    const rec = mkRecord();
    await p.save([rec]);
    const records = await p.load();
    expect(records).toEqual([rec]);

    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw.version).toBe(SESSION_FILE_VERSION);
    expect(typeof raw.savedAt).toBe('string');
    expect(raw.sessions).toEqual([rec]);
  });

  it('白名单：写出的内容不含 token/prompt/output/credential', async () => {
    const p = new JsonSessionPersistence(file);
    // save 接口只收 PersistedSessionRecord，但防御性断言磁盘上不含敏感字段。
    await p.save([mkRecord()]);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toMatch(/claim_token|claimToken/);
    expect(raw).not.toMatch(/api[_-]?key/i);
    expect(raw).not.toMatch(/credential/i);
    expect(raw).not.toMatch(/prompt/);
    expect(raw).not.toMatch(/output_redacted/);
  });

  it('空数组 → 写合法空文件（无 sessions），load 返回 []', async () => {
    const p = new JsonSessionPersistence(file);
    await p.save([]);
    const records = await p.load();
    expect(records).toEqual([]);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw.sessions).toEqual([]);
  });

  it('并发 save 经 promise queue 串行，最后一条 win', async () => {
    const p = new JsonSessionPersistence(file);
    // 不 await：并发触发 3 次。
    const p1 = p.save([mkRecord({ sessionId: 'a', agentSessionId: 'sa' })]);
    const p2 = p.save([mkRecord({ sessionId: 'b', agentSessionId: 'sb' })]);
    const p3 = p.save([mkRecord({ sessionId: 'c', agentSessionId: 'sc' })]);
    await Promise.all([p1, p2, p3]);
    const records = await p.load();
    expect(records).toHaveLength(1);
    expect(records[0].sessionId).toBe('c');
  });

  it('0o600 权限调用（POSIX；Windows 无效但调用不抛）', async () => {
    const p = new JsonSessionPersistence(file);
    await p.save([mkRecord()]);
    // 文件存在即可（chmod 在 Windows 是 no-op，不抛错为通过）。
    expect(existsSync(file)).toBe(true);
    if (process.platform !== 'win32') {
      const st = statSync(file);
      // 仅校验 owner 位（group/other 受 umask）。
      // eslint-disable-next-line no-bitwise
      expect(st.mode & 0o700).toBe(0o600);
    }
  });
});

// ── quarantine（手动调） ────────────────────────────────────────────────────────

describe('JsonSessionPersistence.quarantine', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempDir();
    file = join(dir, 'sessions.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('quarantine 把当前文件重命名 .corrupt-<epoch>，原路径不再存在', async () => {
    writeFileSync(file, 'garbage-not-json');
    const p = new JsonSessionPersistence(file);
    await p.quarantine('test_corrupt');
    expect(existsSync(file)).toBe(false);
    const dirEntries = require('node:fs').readdirSync(dir) as string[];
    const corrupt = dirEntries.find((e) => e.startsWith('sessions.json.corrupt-'));
    expect(corrupt).toBeDefined();
  });

  it('quarantine 文件不存在时为 no-op（不抛）', async () => {
    const p = new JsonSessionPersistence(file);
    await expect(p.quarantine('none')).resolves.toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });
});

// ── ql-20260825-f6#1：tmp 残留恢复 / 回收 ─────────────────────────────────────

describe('tmp 残留恢复与回收（ql-20260825-f6#1）', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempDir();
    file = join(dir, 'sessions.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** 写一个 save 同命名的 tmp 残留文件。 */
  function writeTmp(name: string, content: string, ageMs = 0): string {
    const p = join(dir, name);
    writeFileSync(p, content);
    if (ageMs > 0) {
      const at = new Date(Date.now() - ageMs);
      utimesSync(p, at, at);
    }
    return p;
  }

  it('目标缺失 + tmp 存在（合法）→ load 恢复 tmp 记录 + 落位（tmp 被回收）', async () => {
    const rec = mkRecord();
    const tmp = writeTmp(
      'sessions.json.tmp-1234-1700000000000',
      JSON.stringify({
        version: SESSION_FILE_VERSION,
        savedAt: '2026-08-25T00:00:00Z',
        sessions: [rec],
      }),
    );
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toEqual([rec]);
    // 落位：目标重建为 tmp 内容，tmp 残留被 rename 消费。
    expect(existsSync(file)).toBe(true);
    expect(existsSync(tmp)).toBe(false);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw.sessions).toEqual([rec]);
  });

  it('目标为空文件 + tmp 存在 → 同样恢复（空视同缺失，不产 .corrupt 垃圾）', async () => {
    writeFileSync(file, '');
    const rec = mkRecord();
    writeTmp(
      'sessions.json.tmp-1234-1700000000000',
      JSON.stringify({
        version: SESSION_FILE_VERSION,
        savedAt: 'x',
        sessions: [rec],
      }),
    );
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toEqual([rec]);
    const dirEntries = require('node:fs').readdirSync(dir) as string[];
    expect(dirEntries.find((e) => e.startsWith('sessions.json.corrupt-'))).toBeUndefined();
  });

  it('tmp 损坏（截断 JSON）→ 忽略不炸，load 返回 []（不 quarantine）', async () => {
    writeTmp('sessions.json.tmp-1234-1700000000000', '{ "version": 1, "sessions": [');
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records).toEqual([]);
    // 目标未被凭空创建；损坏 tmp 留给过期清理（不在此删，防误删并发在写）。
    expect(existsSync(file)).toBe(false);
  });

  it('多个 tmp → 取 mtime 最新的合法者', async () => {
    const oldTmp = writeTmp(
      'sessions.json.tmp-1000-1700000000000',
      JSON.stringify({
        version: SESSION_FILE_VERSION,
        savedAt: 'x',
        sessions: [mkRecord({ sessionId: 'old', agentSessionId: 'sdk-old' })],
      }),
      // 旧 10 分钟
      10 * 60 * 1000,
    );
    const newTmp = writeTmp(
      'sessions.json.tmp-2000-1700000900000',
      JSON.stringify({
        version: SESSION_FILE_VERSION,
        savedAt: 'x',
        sessions: [mkRecord({ sessionId: 'new', agentSessionId: 'sdk-new' })],
      }),
    );
    const p = new JsonSessionPersistence(file);
    const records = await p.load();
    expect(records[0]?.sessionId).toBe('new');
    // 新 tmp 被落位消费；旧 tmp 保留（恢复只消费选中的那个）。
    expect(existsSync(newTmp)).toBe(false);
    expect(existsSync(oldTmp)).toBe(true);
  });

  it('目标正常 + 过期 tmp（>1h）→ save 成功后 tmp 被清理', async () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: SESSION_FILE_VERSION,
        savedAt: 'x',
        sessions: [mkRecord()],
      }),
    );
    const staleTmp = writeTmp('sessions.json.tmp-999-1', 'anything', 2 * 60 * 60 * 1000);
    expect(existsSync(staleTmp)).toBe(true);
    const p = new JsonSessionPersistence(file);
    await p.save([mkRecord()]);
    expect(existsSync(staleTmp)).toBe(false);
    expect(existsSync(file)).toBe(true);
  });

  it('新鲜 tmp（<1h）不被 save 清理（防误删并发在写）', async () => {
    const freshTmp = writeTmp('sessions.json.tmp-999-2', 'in-flight');
    const p = new JsonSessionPersistence(file);
    await p.save([mkRecord()]);
    expect(existsSync(freshTmp)).toBe(true);
  });
});
