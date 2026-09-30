/**
 * readOrCreateMachineId 单测（2026-09-30-tool-report-activation-wrong-machine
 * task-02 / FR-01）：生成/幂等/损坏自愈/随 SILLYHUB_DAEMON_DIR 隔离。
 *
 * 惯例对齐 config-server-isolation.test.ts：vi.resetModules + stubEnv 后动态
 * import（daemonStateDir 懒求值，隔离真实 ~/.sillyhub）。
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;

beforeEach(async () => {
  vi.resetModules();
  dir = await mkdtemp(join(tmpdir(), 'sillyhub-machine-id-'));
  vi.stubEnv('SILLYHUB_DAEMON_DIR', dir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('readOrCreateMachineId', () => {
  it('首次调用生成 uuid 并落盘，二次调用读回同值（幂等稳定）', async () => {
    const { readOrCreateMachineId, machineIdPath } = await import('../src/config.js');
    const id1 = await readOrCreateMachineId();
    expect(id1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const persisted = (await readFile(machineIdPath(), 'utf8')).trim();
    expect(persisted).toBe(id1);
    const id2 = await readOrCreateMachineId();
    expect(id2).toBe(id1);
  });

  it('既有文件优先——不重新生成（升级/重启后身份稳定）', async () => {
    const preset = '11111111-2222-3333-4444-555555555555';
    const { machineIdPath } = await import('../src/config.js');
    await writeFile(machineIdPath(), preset, 'utf8');
    const { readOrCreateMachineId } = await import('../src/config.js');
    expect(await readOrCreateMachineId()).toBe(preset);
  });

  it('损坏/空白文件自愈——重新生成覆写', async () => {
    const { machineIdPath, readOrCreateMachineId } = await import('../src/config.js');
    await writeFile(machineIdPath(), '   \n', 'utf8');
    const id = await readOrCreateMachineId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toBe('   ');
    expect((await readFile(machineIdPath(), 'utf8')).trim()).toBe(id);
  });
});
