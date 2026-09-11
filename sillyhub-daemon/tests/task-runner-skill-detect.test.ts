// tests/task-runner-skill-detect.test.ts
// task-08（NFR-01 / D-001）：claude 调 skill 兜底检测单测。
// 覆盖 detectSkillInvoked 纯函数：明确失败标记 → false；skill 痕迹 → true；
// 灰区 → true（不误杀）；非 stage lease → true（零回归）。
//
// bridges task-04（2026-09-11-workspace-asset-bridges / D-007）：补任务选槽
// wiring——runLease 步骤 2.7 全局 link 之后按 lease 的 workspace 绑定调
// syncWorkspaceGitSkills（未绑定不调，零回归）。
//
// @module task-runner-skill-detect.test

import { describe, it, expect, vi } from 'vitest';

// 选槽 wiring 用例 mock skill-manager（其余用例不依赖它，mock 无副作用）。
vi.mock('../src/skill-manager.js', () => ({
  linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })),
  syncWorkspaceGitSkills: vi.fn(async () => ({ synced: false, skipped: false, linked: 0 })),
}));

import { detectSkillInvoked, buildSkillPrompt, TaskRunner } from '../src/task-runner.js';
import { linkSkillsToWorkdir, syncWorkspaceGitSkills } from '../src/skill-manager.js';
import type { LeaseCtx } from '../src/types.js';
import type { DaemonConfig } from '../src/config.js';

describe('task-08 detectSkillInvoked', () => {
  it('非 stage lease（stageMeta 空）→ true 零回归', () => {
    expect(detectSkillInvoked('任意输出')).toBe(true);
    expect(detectSkillInvoked('output', undefined)).toBe(true);
  });

  it('stageMeta 无 skill_name → true 不检测', () => {
    expect(detectSkillInvoked('output', { stage: 'verify' })).toBe(true);
  });

  it('输出含 "skill not found" → false', () => {
    expect(
      detectSkillInvoked('Error: skill not found', {
        skill_name: 'sillyspec-verify',
        stage: 'verify',
      }),
    ).toBe(false);
  });

  it('输出含 "No skill named" → false', () => {
    expect(
      detectSkillInvoked('No skill named sillyspec-verify available', {
        skill_name: 'sillyspec-verify',
      }),
    ).toBe(false);
  });

  it('输出含 "unknown skill" → false', () => {
    expect(
      detectSkillInvoked('unknown skill: sillyspec-verify', {
        skill_name: 'sillyspec-verify',
      }),
    ).toBe(false);
  });

  it('输出含 skill 调用痕迹 /<skill> → true', () => {
    expect(
      detectSkillInvoked('Running /sillyspec-verify --change chg-1', {
        skill_name: 'sillyspec-verify',
      }),
    ).toBe(true);
  });

  it('输出含 skill 名字符串 → true', () => {
    expect(
      detectSkillInvoked('sillyspec-verify completed checks', {
        skill_name: 'sillyspec-verify',
      }),
    ).toBe(true);
  });

  it('灰区（无失败标记无 skill 痕迹）→ true 不误杀', () => {
    expect(
      detectSkillInvoked('Task completed normally', {
        skill_name: 'sillyspec-verify',
      }),
    ).toBe(true);
  });
});

describe('task-08 buildSkillPrompt', () => {
  it('完整 stageMeta → /<skill> --change X --stage Y', () => {
    const p = buildSkillPrompt({
      skill_name: 'sillyspec-verify',
      change_id: 'chg-1',
      stage: 'verify',
    });
    expect(p).toBe('/sillyspec-verify --change chg-1 --stage verify');
  });

  it('无 skill_name → 空串', () => {
    expect(buildSkillPrompt({ stage: 'verify' })).toBe('');
    expect(buildSkillPrompt(undefined)).toBe('');
  });
});

// ── bridges task-04（D-007）：batch 任务按 workspace 绑定选槽 ──────────────────

/** 最小 LeaseCtx（task-runner.test.ts 同款，可带鸭子字段 workspaceId）。 */
function makeLease(overrides: Record<string, unknown> = {}): LeaseCtx {
  return {
    leaseId: 'lease-ws-slot-1',
    runtimeId: 'rt-1',
    claimToken: 'tok',
    workspaceName: 'test-ws',
    claudeMd: '',
    prompt: 'hello',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: 'run-1',
    ...overrides,
  } as LeaseCtx;
}

function makeMockClient(): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
  };
}

function makeMockWorkspace(workdir: string): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue(workdir),
    collectDiff: vi.fn().mockResolvedValue({ patch: '', files_changed: 0, insertions: 0, deletions: 0, stats: '' }),
    cleanWorkspace: vi.fn().mockResolvedValue(undefined),
    getWorkspacePath: vi.fn().mockReturnValue(workdir),
  };
}

function makeMockCred(): Record<string, unknown> {
  return {
    get: vi.fn(() => undefined),
    buildEnv: vi.fn().mockReturnValue({}),
  };
}

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000/',
    token: 'daemon-jwt-tok',
    api_key: 'daemon-apikey-k',
    runtime_id: 'rt-test',
    profile: 'default',
    workspace_dir: '/tmp/ws',
    poll_interval: 30,
    heartbeat_interval: 15,
    max_concurrent_tasks: 5,
    log_level: 'info',
    default_timeout_seconds: 1800,
    max_retries: 0,
    ...overrides,
  };
}

describe('bridges task-04: runLease workspace 选槽 wiring', () => {
  const WS_ID = 'dddddddd-0000-4000-8000-00000000000d';

  it('lease 带 workspaceId + 有 config → 全局 link 后调 syncWorkspaceGitSkills', async () => {
    const workdir = '/tmp/ws/test-ws-slot';
    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace(workdir) as never,
      makeMockCred() as never,
      makeConfig(),
    );
    vi.mocked(linkSkillsToWorkdir).mockClear();
    vi.mocked(syncWorkspaceGitSkills).mockClear();

    // 未知 provider → getBackend 抛错走 failed（步骤 2.7 已跑完，无需真实 spawn）
    const result = await runner.runLease(makeLease({ provider: 'no-such-provider', workspaceId: WS_ID }));

    expect(result.status).toBe('failed');
    expect(syncWorkspaceGitSkills).toHaveBeenCalledTimes(1);
    expect(syncWorkspaceGitSkills).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/',
      { apiKey: 'daemon-apikey-k', token: 'daemon-jwt-tok' },
      WS_ID,
      workdir,
    );
    // 顺序：全局 link 先于 ws 槽同步（并集覆盖语义的前提）
    const linkOrder = vi.mocked(linkSkillsToWorkdir).mock.invocationCallOrder[0];
    const wsOrder = vi.mocked(syncWorkspaceGitSkills).mock.invocationCallOrder[0];
    expect(linkOrder).toBeDefined();
    expect(wsOrder).toBeDefined();
    expect(linkOrder!).toBeLessThan(wsOrder!);
  });

  it('lease 无 workspaceId → 不调 syncWorkspaceGitSkills（零回归）', async () => {
    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace('/tmp/ws/test-plain') as never,
      makeMockCred() as never,
      makeConfig(),
    );
    vi.mocked(syncWorkspaceGitSkills).mockClear();

    const result = await runner.runLease(makeLease({ provider: 'no-such-provider' }));

    expect(result.status).toBe('failed');
    expect(syncWorkspaceGitSkills).not.toHaveBeenCalled();
  });

  it('lease 带 workspaceId 但 config 缺失（旧测试场景）→ 不调不抛', async () => {
    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace('/tmp/ws/test-noconfig') as never,
      makeMockCred() as never,
      undefined,
    );
    vi.mocked(syncWorkspaceGitSkills).mockClear();

    const result = await runner.runLease(makeLease({ provider: 'no-such-provider', workspaceId: WS_ID }));

    expect(result.status).toBe('failed');
    expect(syncWorkspaceGitSkills).not.toHaveBeenCalled();
  });
});
