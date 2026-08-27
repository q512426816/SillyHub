// tests/interactive/session-manager-write-guard.test.ts
// task-12（2026-08-28-daemon-agent-share / D-011 / spike-02 结论 B 修复）：
// daemon 写守卫 session 级 overlay 增量——policyEngine 装配（生产主路径）下
// state.effectiveAllowedRoots 非空时交集收紧。
//
// 覆盖（任务卡 implementation / acceptance）：
//   1. overlay 三态（policyEngine 存在）：
//      - writable_dir 内（且 PolicyCache 内）→ allow；
//      - writable_dir 外（但 PolicyCache 内）→ deny（overlay 文案，新增强制）；
//      - overlay 命中但 PolicyCache deny → 仍 deny（PolicyEngine 中文文案，
//        session roots 不得绕过机器级边界）；
//      - effective 全越出物理 provider 兜底 → 交集为空 deny（fail-closed，只收紧）。
//   2. 无字段零变化：无 effectiveAllowedRoots（含空数组）的会话写守卫行为与
//      既有 policyEngine 语义逐字节一致（allow / PolicyEngine 文案 deny）。
//   3. Bash 提取器与 overlay 组合：shell 间接写的提取路径同样过 overlay 收紧。
//
// 与 session-manager-allowed-roots.test.ts（task-14 policyEngine 基础语义）和
// session-manager-profile.test.ts（task-10 fallback 路径 overlay）互补；本文件
// 只测 policyEngine 主路径的 overlay 增量（D-011 收窄的一处判定）。

import { describe, it, expect, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { winPath as P } from '../helpers.js';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { PolicyEngine } from '../../src/policy/filesystem-policy.js';
import { PolicyCache } from '../../src/policy/runtime-policy.js';
import { AuditSink } from '../../src/policy/audit-sink.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造（对齐 session-manager-allowed-roots.test.ts 惯例）──────────────────

/** mock driver：捕获 start 的 options（取出注入的 canUseTool）。 */
function makeDriverCapturingOpts() {
  let capturedOpts: StartOptions | null = null;
  let capturedCb: ConsumeCallbacks | null = null;
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        capturedOpts = opts;
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCb = cb;
    }),
    interrupt: vi.fn(async (): Promise<boolean> => true),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    fakeQuery,
    getOpts: (): StartOptions | null => capturedOpts,
    emitResult: (r: SDKResultMessage) => capturedCb?.onResult(r),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-wg-1',
  leaseId: 'lease-wg-1',
  firstPrompt: 'hi',
  firstRunId: 'run-wg-1',
  cwd: P('C:\\work'),
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

const noopDeps = {
  onTurnResult: vi.fn(
    async (_s: string, _r: string, _res: SDKResultMessage) => {},
  ),
  onTurnMessage: vi.fn(async (_s: string, _r: string, _m: SDKMessage) => {}),
  onSessionEnd: vi.fn(async (_s: string, _st: string) => {}),
};

/** 构造真实 PolicyEngine + 预置 runtimeId 的机器级 allowed_roots。 */
function makePolicyEngine(
  runtimeId: string,
  roots: string[],
): { engine: PolicyEngine; cache: PolicyCache } {
  const cache = new PolicyCache();
  cache.set(runtimeId, roots);
  // AuditSink 不注入 sender → 默认 nullSender（不真正上报，仅落 buffer）。
  const engine = new PolicyEngine(cache, new AuditSink());
  return { engine, cache };
}

/**
 * 构造「policyEngine 装配 + 可选 session 级 effectiveAllowedRoots」的 chat
 * session（manualApproval=false，写校验 only canUseTool），返回注入的回调。
 * opts.allowedRootsProvider 同时注入时模拟 policyEngine + 物理兜底并存装配。
 */
async function makeChatSession(opts: {
  runtimeRoots: string[];
  effectiveRoots?: string[];
  allowedRootsProvider?: () => string[];
}) {
  const RUNTIME_ID = 'rt-overlay-1';
  const { engine } = makePolicyEngine(RUNTIME_ID, opts.runtimeRoots);
  const { driver, getOpts } = makeDriverCapturingOpts();
  const sm = new SessionManager(
    { driver, ...noopDeps },
    {
      policyEngine: engine,
      runtimeIdProvider: () => RUNTIME_ID,
      ...(opts.allowedRootsProvider
        ? { allowedRootsProvider: opts.allowedRootsProvider }
        : {}),
    },
  );
  await sm.create({
    ...BASE_INPUT,
    sessionId: `sess-wg-${Math.random().toString(36).slice(2, 8)}`,
    manualApproval: false,
    ...(opts.effectiveRoots !== undefined
      ? { effectiveAllowedRoots: opts.effectiveRoots }
      : {}),
  });
  const canUseTool = getOpts()?.canUseTool;
  expect(canUseTool).toBeTypeOf('function');
  return { canUseTool: canUseTool!, sm };
}

// ── 1. overlay 三态（policyEngine 装配，D-011 交集收紧）────────────────────────

describe('task-12: policyEngine 装配下 session 级 overlay 交集收紧（D-011）', () => {
  // 机器级边界（PolicyCache）= C:\work；session overlay = C:\work\writable
  // （platform 会话 backend 注入 [writable_dir] 的形态）。
  const RUNTIME_ROOTS = [P('C:\\work')];
  const OVERLAY = [P('C:\\work\\writable')];

  it('writable_dir 内（且 PolicyCache 内）→ allow（透传 updatedInput）', async () => {
    const { canUseTool } = await makeChatSession({
      runtimeRoots: RUNTIME_ROOTS,
      effectiveRoots: OVERLAY,
    });
    const res = await canUseTool(
      'Write',
      { file_path: P('C:\\work\\writable\\a.txt'), content: 'x' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'allow' });
    expect((res as { updatedInput?: unknown }).updatedInput).toMatchObject({
      file_path: P('C:\\work\\writable\\a.txt'),
    });
  });

  it('writable_dir 外（但 PolicyCache 内）→ deny（overlay 新增强制，session roots 不命中）', async () => {
    const { canUseTool } = await makeChatSession({
      runtimeRoots: RUNTIME_ROOTS,
      effectiveRoots: OVERLAY,
    });
    // C:\work\src 在机器级 PolicyCache 内、在 session overlay 外 → 旧实现
    // （overlay 不进 policyEngine 分支）会 allow，新实现 deny。
    const res = await canUseTool(
      'Write',
      { file_path: P('C:\\work\\src\\b.txt'), content: 'x' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    // overlay 文案与 fallback 块一致（session 级统一文案）。
    expect((res as { message?: string }).message).toContain(
      'path outside allowed_roots',
    );
    expect((res as { message?: string }).message).toContain(
      P('C:\\work\\src\\b.txt'),
    );
  });

  it('overlay 命中但 PolicyCache deny → 仍 deny（机器级边界不被 session roots 绕过）', async () => {
    // overlay 含 C:\elsewhere（PolicyCache 外）——session roots 命中该前缀，
    // 但 PolicyCache 未配置 → canWrite deny（交集语义只收紧）。
    const { canUseTool } = await makeChatSession({
      runtimeRoots: RUNTIME_ROOTS,
      effectiveRoots: [P('C:\\work\\writable'), P('C:\\elsewhere')],
    });
    const res = await canUseTool(
      'Write',
      { file_path: P('C:\\elsewhere\\c.txt'), content: 'x' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    // PolicyEngine 统一中文文案（非 overlay 文案）。
    expect((res as { message?: string }).message).toContain(
      'Runtime Policy 拒绝本次写入',
    );
    expect((res as { message?: string }).message).toContain(
      '目标目录未配置为可写目录',
    );
  });

  it('effective 全越出物理 provider 兜底 → 交集为空 deny（fail-closed，只收紧）', async () => {
    // policyEngine + allowedRootsProvider 并存装配：effective=[C:\stale] 全部
    // 越出 provider 物理边界 [C:\work] → overlay 交集为空 → 任何写路径 deny
    // （_sessionOverlayRoots 语义：非 null 即生效，空数组 = 无路径可命中）。
    const { canUseTool } = await makeChatSession({
      runtimeRoots: RUNTIME_ROOTS,
      effectiveRoots: [P('C:\\stale')],
      allowedRootsProvider: () => [P('C:\\work')],
    });
    // C:\work\a.txt 在 PolicyCache 与 provider 内，但不在（被滤空的）overlay 内 → deny。
    const res = await canUseTool(
      'Write',
      { file_path: P('C:\\work\\a.txt'), content: 'x' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    expect((res as { message?: string }).message).toContain(
      'path outside allowed_roots',
    );
  });
});

// ── 2. 无字段零变化（既有 policyEngine 语义逐字节不变）─────────────────────────

describe('task-12: 无 effectiveAllowedRoots 的会话零行为变化', () => {
  it('无字段 → PolicyCache 内 allow / 外 deny（PolicyEngine 文案，与 task-14 语义一致）', async () => {
    const { canUseTool } = await makeChatSession({
      runtimeRoots: [P('C:\\work')],
    });
    // 白名单内 allow。
    expect(
      await canUseTool(
        'Write',
        { file_path: P('C:\\work\\a.txt') },
        { signal: undefined },
      ),
    ).toMatchObject({ behavior: 'allow' });
    // 白名单外 deny（PolicyEngine 中文文案，非 overlay 文案）。
    const res = await canUseTool(
      'Write',
      { file_path: P('C:\\secret\\pw.txt') },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    expect((res as { message?: string }).message).toContain(
      'Runtime Policy 拒绝本次写入',
    );
    // overlay 命中前缀 C:\work\writable 的路径（无字段时不受 overlay 影响）。
    expect(
      await canUseTool(
        'Write',
        { file_path: P('C:\\work\\writable\\b.txt') },
        { signal: undefined },
      ),
    ).toMatchObject({ behavior: 'allow' });
  });

  it('effectiveAllowedRoots 空数组 → 视为未启用（同无字段，PolicyCache 口径）', async () => {
    const { canUseTool } = await makeChatSession({
      runtimeRoots: [P('C:\\work')],
      effectiveRoots: [],
    });
    expect(
      await canUseTool(
        'Write',
        { file_path: P('C:\\work\\anywhere\\a.txt') },
        { signal: undefined },
      ),
    ).toMatchObject({ behavior: 'allow' });
    const res = await canUseTool(
      'Write',
      { file_path: P('C:\\evil\\a.txt') },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    expect((res as { message?: string }).message).toContain(
      'Runtime Policy 拒绝本次写入',
    );
  });
});

// ── 3. Bash 提取器与 overlay 组合（shell 间接写同受收紧）───────────────────────

describe('task-12: Bash 提取器与 overlay 组合', () => {
  it('Bash 重定向 writable_dir 内 allow / writable_dir 外（PolicyCache 内）deny', async () => {
    const { canUseTool } = await makeChatSession({
      runtimeRoots: [P('C:\\work')],
      effectiveRoots: [P('C:\\work\\writable')],
    });
    // 提取到的写目标在 overlay 内 → allow。
    expect(
      await canUseTool(
        'Bash',
        { command: `echo hello > ${P('C:\\work\\writable\\out.txt')}` },
        { signal: undefined },
      ),
    ).toMatchObject({ behavior: 'allow' });
    // 提取到的写目标在 PolicyCache 内、overlay 外 → deny（overlay 文案）。
    const res = await canUseTool(
      'Bash',
      { command: `echo hello > ${P('C:\\work\\out.txt')}` },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    expect((res as { message?: string }).message).toContain(
      'path outside allowed_roots',
    );
    expect((res as { message?: string }).message).toContain(P('C:\\work\\out.txt'));
  });
});
