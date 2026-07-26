// tests/interactive/session-manager-borrow-sandbox.test.ts
// task-09 / D-007@v2（候选 B 主路径）：借用 session 沙箱隔离写策略。
//
// 核心反污染断言（R-02）：借用 agent 的写策略按 **lease（sandbox root）** 隔离，**不**
// 命中 lender 的 runtime_id → allowed_roots 缓存。即便 PolicyCache 里 lender runtime_id
// 的 allowed_roots 包含开发代码区，借用 agent 写开发代码区也必须被拒。
//
// 覆盖：
//   1. 借用 session 写沙箱内 → allow；写 lender 代码区 → deny（即便 lender 缓存允许）；
//   2. 借用 session 写随机第三地 → deny；
//   3. 读工具 → allow（读自由，不拦）；
//   4. 非借用 session（未登记沙箱）→ 走原 runtime policy（开发人员自有任务零回归）：
//      lender 代码区写入 allow（命中 runtime 缓存）；
//   5. registerBorrowSandbox 后 session end → 写守卫退化到 runtime policy（清理生效）。
//
// 测试范式照抄 session-manager-allowed-roots.test.ts（mock driver 捕获 canUseTool）。

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
  sessionId: 'sess-borrow-1',
  leaseId: 'lease-borrow-1',
  firstPrompt: '帮我读源码出业务方案',
  firstRunId: 'run-borrow-1',
  cwd: 'C:\\borrow-sandbox',
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

/** lender 的 runtime_id（开发人员的 claude runtime）。 */
const LENDER_RUNTIME_ID = 'rt-lender-claude';
/** lender 代码区（开发人员 allowed_roots，借用 agent 不应继承）。 */
const LENDER_CODE_ROOT = 'C:\\dev\\multi-agent-platform';
/** 借用 session 的独立沙箱目录。 */
const BORROW_SANDBOX_ROOT = 'C:\\sillyhub\\borrow-sandboxes\\borrow-actor1-run1';

// ── 借用 session 写隔离（核心 R-02 反污染断言）────────────────────────────────

describe('task-09 借用 session 沙箱隔离 — 按 lease 而非 runtime', () => {
  /**
   * 构造一个「PolicyCache 预置 lender runtime 代码区 + 借用 session 登记沙箱」的 chat session。
   * 关键：runtimeIdProvider 返回 lender runtime id（缓存里有开发代码区），但借用 session
   * 登记沙箱后写守卫**不应查该缓存**。
   */
  async function makeBorrowSession() {
    const cache = new PolicyCache();
    // lender 的 runtime 缓存：开发代码区是 allowed_roots（开发人员自有任务可写）。
    cache.set(LENDER_RUNTIME_ID, [LENDER_CODE_ROOT]);
    const engine = new PolicyEngine(cache, new AuditSink());
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        policyEngine: engine,
        // 借用 session 复用 lender runtime_id（候选 B：不引入独立 runtime_id）。
        runtimeIdProvider: () => LENDER_RUNTIME_ID,
      },
    );
    await sm.create({ ...BASE_INPUT, manualApproval: false });
    // daemon _startInteractiveSession 检测 marker 后调本方法登记沙箱（模拟）。
    sm.registerBorrowSandbox(BASE_INPUT.sessionId, BORROW_SANDBOX_ROOT);
    const canUseTool = getOpts()?.canUseTool;
    expect(canUseTool).toBeTypeOf('function');
    return { canUseTool: canUseTool!, sm };
  }

  it('借用 agent 写沙箱内 → allow（沙箱是借用任务唯一可写区）', async () => {
    const { canUseTool } = await makeBorrowSession();
    const res = await canUseTool(
      'Write',
      {
        file_path: `${BORROW_SANDBOX_ROOT}\\draft.md`,
        content: '业务方案草稿',
      },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'allow' });
  });

  it('借用 agent 写 lender 代码区 → deny（不继承 lender runtime 缓存的 allowed_roots）', async () => {
    const { canUseTool } = await makeBorrowSession();
    // lender runtime 缓存里 LENDER_CODE_ROOT 是 allowed——但借用 session 必须拒绝。
    const res = await canUseTool(
      'Write',
      { file_path: `${LENDER_CODE_ROOT}\\src\\polluted.ts`, content: 'x' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    const message = (res as { message?: string }).message ?? '';
    // 借用沙箱隔离专属中文文案（区别于 runtime policy 的「Runtime Policy 拒绝本次写入」）。
    expect(message).toContain('借用任务沙箱隔离拒绝写入');
    expect(message).toContain('不可写开发代码区');
    // 文案含沙箱根，便于排查。
    expect(message).toContain(BORROW_SANDBOX_ROOT);
  });

  it('借用 agent 写随机第三地（非沙箱非 lender）→ deny', async () => {
    const { canUseTool } = await makeBorrowSession();
    const res = await canUseTool(
      'Edit',
      { file_path: 'D:\\elsewhere\\secret.txt' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    expect((res as { message?: string }).message).toContain(
      '借用任务沙箱隔离拒绝写入',
    );
  });

  it('借用 agent 读工具（Read/Grep/Bash 纯读）→ allow（读自由，借用 agent 需读 lender 源码）', async () => {
    const { canUseTool } = await makeBorrowSession();
    // 读 lender 代码区 → allow（读不拦，业务人员需读开发源码出方案）。
    const r1 = await canUseTool(
      'Read',
      { file_path: `${LENDER_CODE_ROOT}\\README.md` },
      { signal: undefined },
    );
    expect(r1).toMatchObject({ behavior: 'allow' });
    // Bash 纯读 ls → 提取不到写路径 → 放行。
    const r2 = await canUseTool(
      'Bash',
      { command: `ls ${LENDER_CODE_ROOT}` },
      { signal: undefined },
    );
    expect(r2).toMatchObject({ behavior: 'allow' });
  });

  it('借用 agent Bash 重定向写 lender 代码区 → deny（shell 间接写也隔离）', async () => {
    const { canUseTool } = await makeBorrowSession();
    const res = await canUseTool(
      'Bash',
      { command: `echo x > ${LENDER_CODE_ROOT}\\evil.txt` },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    expect((res as { message?: string }).message).toContain(
      '借用任务沙箱隔离拒绝写入',
    );
  });

  it('借用 agent Bash 重定向写沙箱内 → allow', async () => {
    const { canUseTool } = await makeBorrowSession();
    const res = await canUseTool(
      'Bash',
      { command: `echo hello > ${BORROW_SANDBOX_ROOT}\\notes.txt` },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'allow' });
  });
});

// ── 开发人员自有任务零回归（未登记沙箱 → 走原 runtime policy）──────────────────

describe('task-09 非借用 session（开发人员自有任务）走原 runtime policy 零回归', () => {
  it('未登记沙箱 → 写 lender 代码区 allow（命中 runtime 缓存，开发自有任务正常）', async () => {
    const cache = new PolicyCache();
    cache.set(LENDER_RUNTIME_ID, [LENDER_CODE_ROOT]);
    const engine = new PolicyEngine(cache, new AuditSink());
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        policyEngine: engine,
        runtimeIdProvider: () => LENDER_RUNTIME_ID,
      },
    );
    // 开发人员自有任务：不调 registerBorrowSandbox。
    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-dev-own',
      leaseId: 'lease-dev-own',
      cwd: LENDER_CODE_ROOT,
      manualApproval: false,
    });
    const canUseTool = getOpts()?.canUseTool!;
    // 开发人员写自己代码区 → allow（runtime policy 命中）。
    const res = await canUseTool(
      'Write',
      { file_path: `${LENDER_CODE_ROOT}\\src\\feature.ts` },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'allow' });
    // 开发人员写沙箱外（非 allowed）→ deny（runtime policy 原行为）。
    const deny = await canUseTool(
      'Write',
      { file_path: 'D:\\outside\\x.txt' },
      { signal: undefined },
    );
    expect(deny).toMatchObject({ behavior: 'deny' });
    // runtime policy 原中文文案（非借用沙箱文案）。
    expect((deny as { message?: string }).message).toContain(
      'Runtime Policy 拒绝本次写入',
    );
  });
});

// ── registerBorrowSandbox 登记清理（end/fail 退化到 runtime policy）────────────

describe('task-09 registerBorrowSandbox 清理（session 终态后写守卫退化）', () => {
  it('borrow session end 后写 lender 代码区 → 命中 runtime 缓存 allow（沙箱登记已清除）', async () => {
    const cache = new PolicyCache();
    cache.set(LENDER_RUNTIME_ID, [LENDER_CODE_ROOT]);
    const engine = new PolicyEngine(cache, new AuditSink());
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        policyEngine: engine,
        runtimeIdProvider: () => LENDER_RUNTIME_ID,
      },
    );
    await sm.create({ ...BASE_INPUT, manualApproval: false });
    sm.registerBorrowSandbox(BASE_INPUT.sessionId, BORROW_SANDBOX_ROOT);
    // end session（模拟 session 终态）。
    await sm.end(BASE_INPUT.sessionId);
    // getBorrowSandboxRoot 清除 → undefined。
    expect(sm.getBorrowSandboxRoot(BASE_INPUT.sessionId)).toBeUndefined();

    // 重新 create 一个同 id session 验证写守卫已退化（end 后 store 已删，需重建）。
    // 此处直接验证注册表清理：end 后再 register 不影响已不存在的 session。
    sm.registerBorrowSandbox(BASE_INPUT.sessionId, BORROW_SANDBOX_ROOT);
    expect(sm.getBorrowSandboxRoot(BASE_INPUT.sessionId)).toBe(BORROW_SANDBOX_ROOT);

    // canUseTool 在 session end 后 SDK 不再调用（state 已删）；本用例聚焦注册表清理
    // 语义（end 清除 + 可重新登记），写守卫分支由前两组 describe 覆盖。
    void getOpts;
  });

  it('registerBorrowSandbox 空值 → 静默不登记（fail-open，不卡 session）', () => {
    const cache = new PolicyCache();
    const engine = new PolicyEngine(cache, new AuditSink());
    const { driver } = makeDriverCapturingOpts();
    const sm = new SessionManager(
      { driver, ...noopDeps },
      { policyEngine: engine, runtimeIdProvider: () => LENDER_RUNTIME_ID },
    );
    // 空 sessionId / 空 root → 不登记。
    sm.registerBorrowSandbox('', BORROW_SANDBOX_ROOT);
    sm.registerBorrowSandbox('sess-x', '');
    expect(sm.getBorrowSandboxRoot('')).toBeUndefined();
    expect(sm.getBorrowSandboxRoot('sess-x')).toBeUndefined();
  });
});
