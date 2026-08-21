/**
 * cleanup.test.ts — performCleanup 单元测试。
 *
 * 覆盖：dry-run 统计 / 实际删除 / 保留文件校验 / 不存在目录容错。
 */

import { mkdtemp, mkdir, writeFile, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { performCleanup } from '../src/cleanup.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'cleanup-test-'));
});

afterEach(async () => {
  // cleanup if exists
  try {
    const { rm } = await import('node:fs/promises');
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

/** 在 tmpDir 下创建模拟 daemon 目录结构。 */
async function createDaemonLayout() {
  // 清理目标目录
  await mkdir(join(tmpDir, 'specs', 'sub'), { recursive: true });
  await writeFile(join(tmpDir, 'specs', 'sub', 'file.txt'), 'hello');

  await mkdir(join(tmpDir, 'claude-config', 'projects', 'proj1'), { recursive: true });
  await writeFile(join(tmpDir, 'claude-config', 'projects', 'proj1', 'log.jsonl'), '{}');

  await mkdir(join(tmpDir, 'claude-config', 'backups'), { recursive: true });
  await writeFile(join(tmpDir, 'claude-config', 'backups', 'backup.json'), '{}');

  await mkdir(join(tmpDir, 'manifests'), { recursive: true });
  await writeFile(join(tmpDir, 'manifests', 'manifest.json'), '{}');

  await mkdir(join(tmpDir, 'skills'), { recursive: true });
  await writeFile(join(tmpDir, 'skills', 'skill.json'), '{}');

  // bin 备份文件
  await mkdir(join(tmpDir, 'bin'), { recursive: true });
  await writeFile(join(tmpDir, 'bin', 'sillyhub-daemon.js'), 'code');
  await writeFile(join(tmpDir, 'bin', 'sillyhub-daemon.js.bak.20260820'), 'old');

  // 根目录日志
  await writeFile(join(tmpDir, 'daemon-err.log'), 'error');
  await writeFile(join(tmpDir, 'daemon-detached.out'), 'output');
  await writeFile(join(tmpDir, 'daemon-detached.err'), 'error');
  await writeFile(join(tmpDir, 'config.json.bak-20260815'), 'old config');

  // 保留文件
  await writeFile(join(tmpDir, 'config.json'), '{"key":"value"}');
  await mkdir(join(tmpDir, 'locks'), { recursive: true });
  await writeFile(join(tmpDir, 'locks', 'lock.json'), '{}');
  await mkdir(join(tmpDir, 'workspaces'), { recursive: true });
  await writeFile(join(tmpDir, 'workspaces', 'ws.json'), '{}');
  // outbox（断线补发队列）与 runs（活跃任务终端日志）不在清理范围，必须保留
  await mkdir(join(tmpDir, 'outbox'), { recursive: true });
  await writeFile(join(tmpDir, 'outbox', 'run-1.jsonl'), '{}');
  await mkdir(join(tmpDir, 'runs', 'lease-1'), { recursive: true });
  await writeFile(join(tmpDir, 'runs', 'lease-1', 'terminal.log'), 'log');
  // claude-config 下的活跃配置
  await writeFile(join(tmpDir, 'claude-config', '.claude.json'), '{}');
}

describe('performCleanup', () => {
  it('dry-run 模式只统计不删除', async () => {
    await createDaemonLayout();
    const result = await performCleanup(tmpDir, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.totalFreedBytes).toBeGreaterThan(0);

    // dry-run 后文件仍在
    const specsStat = await stat(join(tmpDir, 'specs'));
    expect(specsStat.isDirectory()).toBe(true);
    const configFile = await stat(join(tmpDir, 'config.json'));
    expect(configFile.isFile()).toBe(true);
  });

  it('实际删除清理目标目录', async () => {
    await createDaemonLayout();
    const result = await performCleanup(tmpDir, { dryRun: false });

    expect(result.dryRun).toBe(false);
    expect(result.totalFreedBytes).toBeGreaterThan(0);

    // 清理目标应被删除
    await expect(access(join(tmpDir, 'specs'))).rejects.toThrow();
    await expect(access(join(tmpDir, 'claude-config', 'projects'))).rejects.toThrow();
    await expect(access(join(tmpDir, 'claude-config', 'backups'))).rejects.toThrow();
    await expect(access(join(tmpDir, 'manifests'))).rejects.toThrow();
    await expect(access(join(tmpDir, 'skills'))).rejects.toThrow();

    // outbox（未投递消息）与 runs（活跃任务日志）必须保留
    await expect(access(join(tmpDir, 'outbox', 'run-1.jsonl'))).resolves.toBeUndefined();
    await expect(access(join(tmpDir, 'runs', 'lease-1', 'terminal.log'))).resolves.toBeUndefined();

    // bin 备份文件应被删除
    await expect(access(join(tmpDir, 'bin', 'sillyhub-daemon.js.bak.20260820'))).rejects.toThrow();

    // 日志文件应被删除
    await expect(access(join(tmpDir, 'daemon-err.log'))).rejects.toThrow();
    await expect(access(join(tmpDir, 'daemon-detached.out'))).rejects.toThrow();
    await expect(access(join(tmpDir, 'config.json.bak-20260815'))).rejects.toThrow();
  });

  it('保留 config.json、locks/、workspaces/、outbox/、runs/', async () => {
    await createDaemonLayout();
    await performCleanup(tmpDir, { dryRun: false });

    // 保留文件应仍在
    const configStat = await stat(join(tmpDir, 'config.json'));
    expect(configStat.isFile()).toBe(true);

    const locksStat = await stat(join(tmpDir, 'locks'));
    expect(locksStat.isDirectory()).toBe(true);

    const wsStat = await stat(join(tmpDir, 'workspaces'));
    expect(wsStat.isDirectory()).toBe(true);

    // outbox（断线补发队列）与 runs（活跃任务终端日志）不在清理范围
    const outboxStat = await stat(join(tmpDir, 'outbox', 'run-1.jsonl'));
    expect(outboxStat.isFile()).toBe(true);
    const runsStat = await stat(join(tmpDir, 'runs', 'lease-1', 'terminal.log'));
    expect(runsStat.isFile()).toBe(true);

    // bin/*.js 非备份文件应保留
    const binJs = await stat(join(tmpDir, 'bin', 'sillyhub-daemon.js'));
    expect(binJs.isFile()).toBe(true);
  });

  it('保留 claude-config/.claude.json 活跃配置', async () => {
    await createDaemonLayout();
    await performCleanup(tmpDir, { dryRun: false });

    const claudeConfig = await stat(join(tmpDir, 'claude-config', '.claude.json'));
    expect(claudeConfig.isFile()).toBe(true);
  });

  it('不存在的目录不报错', async () => {
    // 空 tmpDir，没有任何子目录
    const result = await performCleanup(tmpDir, { dryRun: false });
    expect(result.entries.length).toBe(0);
    expect(result.totalFreedBytes).toBe(0);
  });
});
