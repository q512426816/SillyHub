// tests/interactive/session-manager-allowed-roots.test.ts
// task-14（design §5.2 D-002 D-006）：interactive canUseTool 写拦截改调
// PolicyEngine.canWrite(runtimeId, path, provider, tool)。
//
// 覆盖：
//   1. enableApproval=false（默认 chat）注入 policyEngine 后也注入 canUseTool：
//      写白名单内 allow（透传 updatedInput）、写越界 deny（reason = PolicyEngine 统一
//      中文文案）、读工具 allow；
//   2. enableApproval=true（scan / 人审）路径也前置写校验（写越界直接 deny，不触发
//      远程人审 send）；
//   3. Bash/PowerShell/CMD shell 间接写：经 shell-paths 提取写路径，逐条 canWrite，
//      越界 deny；
//   4. runtimeId 透传：runtimeIdProvider 返回的 id 经 PolicyCache 隔离（A runtime
//      allow 的路径对 B runtime 不可见）；
//   5. fallback（不注入 policyEngine）→ allowedRootsProvider 旧行为兼容。
//
// 旧的 write-guard.test.ts 已删除（isWriteWithinAllowedRoots + extractBashWritePaths
// 逻辑已迁 policy/path-utils.ts + policy/shell-paths.ts 且已有单测覆盖，见
// tests/policy/path-utils.test.ts + tests/policy/shell-paths.test.ts）。

import { describe, it, expect, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { PolicyEngine } from '../../src/policy/filesystem-policy.js';
import { PolicyCache } from '../../src/policy/runtime-policy.js';
import { AuditSink } from '../../src/policy/audit-sink.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造 ───────────────────────────────────────────────────────────────────

/** mock driver：捕获 start 的 options（验证 canUseTool 是否注入）。 */
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
  sessionId: 'sess-1',
  leaseId: 'lease-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
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

/** 构造真实 PolicyEngine + 预置 runtimeId 的 allowed_roots。 */
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

// ── 默认 chat（enableApproval=false）写拦截（走 PolicyEngine）─────────────────

describe('默认 chat（enableApproval=false）写拦截 — PolicyEngine.canWrite', () => {
  const RUNTIME_ID = 'rt-claude-1';

  /**
   * 构造一个「注入 policyEngine + manualApproval=false」的 chat session，
   * 返回注入的 canUseTool 回调。模拟默认对话场景：不启用人审，仅写校验。
   */
  async function makeChatSession(roots: string[]) {
    const { engine } = makePolicyEngine(RUNTIME_ID, roots);
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        policyEngine: engine,
        runtimeIdProvider: () => RUNTIME_ID,
      },
    );
    await sm.create({ ...BASE_INPUT, manualApproval: false });
    const canUseTool = getOpts()?.canUseTool;
    expect(canUseTool).toBeTypeOf('function');
    return { canUseTool: canUseTool!, sm };
  }

  it('写工具白名单内 → allow（透传 updatedInput）', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'Write',
      { file_path: 'C:\\work\\a.txt', content: 'x' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'allow' });
    expect((res as { updatedInput?: unknown }).updatedInput).toMatchObject({
      file_path: 'C:\\work\\a.txt',
    });
  });

  it('写工具白名单外 → deny（reason = PolicyEngine 统一中文文案，含路径/原因）', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'Write',
      { file_path: 'C:\\secret\\pw.txt', content: 'x' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    const message = (res as { message?: string }).message ?? '';
    // 统一中文文案标题。
    expect(message).toContain('Runtime Policy 拒绝本次写入');
    // Agent 透传（claude）。
    expect(message).toContain('Agent：claude');
    // 原因 = 未配置为可写目录。
    expect(message).toContain('目标目录未配置为可写目录');
  });

  it('读工具（Read/Grep/Bash 纯读）→ allow（不拦，读自由）', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const r1 = await canUseTool('Read', { file_path: 'C:\\anywhere' }, { signal: undefined });
    expect(r1).toMatchObject({ behavior: 'allow' });
    // Bash 纯读命令（无重定向/cp/mv/tee/mkdir/touch）→ 提取不到写路径 → 放行。
    const r2 = await canUseTool('Bash', { command: 'ls -la /' }, { signal: undefined });
    expect(r2).toMatchObject({ behavior: 'allow' });
  });

  it('Edit / MultiEdit 越界同样 deny（中文文案）', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const e = await canUseTool('Edit', { file_path: 'C:\\out\\x' }, { signal: undefined });
    expect(e).toMatchObject({ behavior: 'deny' });
    const m = await canUseTool(
      'MultiEdit',
      { file_path: 'C:\\out\\y' },
      { signal: undefined },
    );
    expect(m).toMatchObject({ behavior: 'deny' });
  });

  it('path 字段（非 file_path）→ 也校验', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    // 白名单内 path 字段 → allow。
    const inside = await canUseTool(
      'Write',
      { path: 'C:\\work\\sub\\b.txt' },
      { signal: undefined },
    );
    expect(inside).toMatchObject({ behavior: 'allow' });
    // 白名单外 path 字段 → deny。
    const outside = await canUseTool('Write', { path: 'D:\\elsewhere' }, { signal: undefined });
    expect(outside).toMatchObject({ behavior: 'deny' });
  });
});

// ── Bash / PowerShell / CMD shell 间接写 ──────────────────────────────────────

describe('Shell 工具间接写 — extractShellWritePaths + canWrite', () => {
  const RUNTIME_ID = 'rt-shell-1';

  async function makeChatSession(roots: string[]) {
    const { engine } = makePolicyEngine(RUNTIME_ID, roots);
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        policyEngine: engine,
        runtimeIdProvider: () => RUNTIME_ID,
      },
    );
    await sm.create({ ...BASE_INPUT, manualApproval: false });
    const canUseTool = getOpts()?.canUseTool;
    expect(canUseTool).toBeTypeOf('function');
    return { canUseTool: canUseTool!, sm };
  }

  it('Bash 重定向 > 白名单外 → deny', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'Bash',
      { command: 'echo hello > C:\\evil\\out.txt' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
  });

  it('Bash 重定向 > 白名单内 → allow', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'Bash',
      { command: 'echo hello > C:\\work\\out.txt' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'allow' });
  });

  it('Bash cp 目标在白名单外 → deny', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'Bash',
      { command: 'cp C:\\work\\src.txt C:\\evil\\dst.txt' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
  });

  it('Bash 混合读+写，写越界 → deny', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'Bash',
      { command: 'ls C:\\work && echo x > C:\\evil\\out.txt' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
  });

  it('Bash 2>&1 不算写路径（fd 重定向）→ allow', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'Bash',
      { command: 'cmd 2>&1' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'allow' });
  });

  it('PowerShell Out-File 白名单外 → deny', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'PowerShell',
      { command: 'Out-File -FilePath C:\\evil\\p.txt -InputObject x' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
  });

  it('CMD echo > 白名单外 → deny', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'CMD',
      { command: 'echo x > C:\\evil\\c.txt' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
  });

  // ql-20260703-001：claude 只暴露 Bash tool（无独立 PowerShell/CMD tool），
  // agent 用 Bash tool 跑跨 shell 命令（powershell/pwsh/cmd）。修复前
  // _shellKindOfTool('Bash')→'bash' 仅 bash 提取，漏 PowerShell cmdlet →
  // Set-Content 绕过（真机 e2e 发现）。修复后合并 bash+powershell+cmd 三提取。
  it('ql-20260703-001: Bash tool 跑 powershell Set-Content -Path 越界 → deny', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'Bash',
      { command: 'powershell -Command "Set-Content -Path C:\\evil\\a.txt -Value x"' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
  });

  it('ql-20260703-001: Bash tool 跑 powershell Set-Content 位置参数越界 → deny', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'Bash',
      { command: 'powershell -Command "Set-Content C:\\evil\\a.txt x"' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
  });

  it('ql-20260703-001: Bash tool 跑 pwsh Out-File 越界 → deny', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'Bash',
      { command: 'pwsh -Command "Out-File -FilePath C:\\evil\\b.txt -InputObject y"' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
  });
});

// ── runtimeId 透传 + per-runtime 隔离 ──────────────────────────────────────────

describe('runtimeId 透传到 PolicyEngine（per-runtime 隔离 D-002）', () => {
  it('A runtime allow 的路径对 B runtime 不可见（deny）', async () => {
    const cache = new PolicyCache();
    cache.set('rt-A', ['C:\\workA']);
    cache.set('rt-B', ['C:\\workB']);
    const engine = new PolicyEngine(cache, new AuditSink());

    let currentRid = 'rt-A';
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        policyEngine: engine,
        runtimeIdProvider: () => currentRid,
      },
    );
    await sm.create({ ...BASE_INPUT, manualApproval: false });
    const canUseTool = getOpts()?.canUseTool!;

    // rt-A：C:\workA\x allow；C:\workB\x deny。
    currentRid = 'rt-A';
    expect(
      await canUseTool('Write', { file_path: 'C:\\workA\\x.txt' }, { signal: undefined }),
    ).toMatchObject({ behavior: 'allow' });
    expect(
      await canUseTool('Write', { file_path: 'C:\\workB\\x.txt' }, { signal: undefined }),
    ).toMatchObject({ behavior: 'deny' });

    // rt-B：C:\workB\x allow；C:\workA\x deny。
    currentRid = 'rt-B';
    expect(
      await canUseTool('Write', { file_path: 'C:\\workB\\x.txt' }, { signal: undefined }),
    ).toMatchObject({ behavior: 'allow' });
    expect(
      await canUseTool('Write', { file_path: 'C:\\workA\\x.txt' }, { signal: undefined }),
    ).toMatchObject({ behavior: 'deny' });
  });

  it('runtimeId 为空 → PolicyCache 未命中 deny（fail-closed D-007）', async () => {
    const cache = new PolicyCache();
    cache.set('rt-real', ['C:\\work']);
    const engine = new PolicyEngine(cache, new AuditSink());
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        policyEngine: engine,
        runtimeIdProvider: () => '', // 空 runtimeId
      },
    );
    await sm.create({ ...BASE_INPUT, manualApproval: false });
    const canUseTool = getOpts()?.canUseTool!;
    const res = await canUseTool(
      'Write',
      { file_path: 'C:\\work\\a.txt' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    expect((res as { message?: string }).message).toContain('策略未加载');
  });
});

// ── enableApproval=true（人审）路径也前置写校验 ────────────────────────────────

describe('enableApproval=true（人审）路径前置写校验', () => {
  const RUNTIME_ID = 'rt-approval-1';
  /**
   * 构造一个 manualApproval=true + policyEngine 的 session。
   * 验证写越界在到达远程人审（resolver.register → send）之前就被 deny。
   */
  async function makeApprovalSession(roots: string[]) {
    const { engine } = makePolicyEngine(RUNTIME_ID, roots);
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sendMock = vi.fn(() => true);
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        manualApproval: true,
        permissionWsClient: { send: sendMock },
        policyEngine: engine,
        runtimeIdProvider: () => RUNTIME_ID,
      },
    );
    await sm.create({ ...BASE_INPUT, manualApproval: true, askUserOnly: true });
    const canUseTool = getOpts()?.canUseTool;
    expect(canUseTool).toBeTypeOf('function');
    return { canUseTool: canUseTool!, sendMock };
  }

  it('写越界 → 直接 deny，不触发远程人审（send 未调用）', async () => {
    const { canUseTool, sendMock } = await makeApprovalSession(['C:\\work']);
    const res = await canUseTool(
      'Write',
      { file_path: 'C:\\out\\secret.txt' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    // 写守卫短路在前，远程人审 register（发 PERMISSION_REQUEST）不应被触发。
    expect(sendMock).not.toHaveBeenCalled();
  });
});

// ── 向后兼容：不注入 policyEngine → allowedRootsProvider fallback ──────────────

describe('向后兼容：不注入 policyEngine → allowedRootsProvider fallback', () => {
  it('默认 chat（manualApproval=false）不注入任何写守卫 → 不注入 canUseTool', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager({ driver, ...noopDeps });
    await sm.create({ ...BASE_INPUT, manualApproval: false });
    expect(getOpts()?.canUseTool).toBeUndefined();
  });

  it('注入 allowedRootsProvider（无 policyEngine）→ fallback 旧写校验', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager(
      { driver, ...noopDeps },
      { allowedRootsProvider: () => ['C:\\work'] },
    );
    await sm.create({ ...BASE_INPUT, manualApproval: false });
    const canUseTool = getOpts()?.canUseTool!;
    // 白名单内 allow。
    expect(
      await canUseTool('Write', { file_path: 'C:\\work\\a.txt' }, { signal: undefined }),
    ).toMatchObject({ behavior: 'allow' });
    // 越界 deny（fallback 文案：path outside allowed_roots）。
    const deny = await canUseTool(
      'Write',
      { file_path: 'C:\\evil\\a.txt' },
      { signal: undefined },
    );
    expect(deny).toMatchObject({ behavior: 'deny' });
    expect((deny as { message?: string }).message).toContain('path outside allowed_roots');
  });
});
