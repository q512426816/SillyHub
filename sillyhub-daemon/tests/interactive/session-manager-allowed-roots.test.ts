// tests/interactive/session-manager-allowed-roots.test.ts
// interactive CC 写拦截（2026-06-29）：canUseTool 对写工具（Write/Edit/MultiEdit）
// 按 daemon config.allowed_roots 白名单校验——白名单内 allow、越界 deny；
// 读工具（Read/Grep/Bash/Glob/...）不拦（读自由）。
//
// 覆盖：
//   1. 写校验纯函数 isWriteWithinAllowedRoots（白名单内 true / 越界 false / 读工具 true / 无 path true）；
//   2. enableApproval=false（默认 chat）注入 allowedRootsProvider 后也注入 canUseTool：
//      写白名单内 allow、写越界 deny（message "path outside allowed_roots"）、读工具 allow；
//   3. enableApproval=true（scan / 人审）路径也前置写校验（写越界 deny，不走远程人审）；
//   4. 不注入 allowedRootsProvider → 默认 chat 不注入 canUseTool（向后兼容）。

import { describe, it, expect, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { isWriteWithinAllowedRoots } from '../../src/interactive/write-guard.js';
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

// ── 纯函数 isWriteWithinAllowedRoots ──────────────────────────────────────────

describe('isWriteWithinAllowedRoots（写校验纯函数）', () => {
  it('写工具白名单内 → true', () => {
    expect(
      isWriteWithinAllowedRoots('Write', { file_path: 'C:\\work\\a.txt' }, [
        'C:\\work',
      ]),
    ).toBe(true);
  });

  it('写工具白名单外 → false', () => {
    expect(
      isWriteWithinAllowedRoots('Write', { file_path: 'C:\\evil\\a.txt' }, [
        'C:\\work',
      ]),
    ).toBe(false);
  });

  it('写工具 path 字段（非 file_path）→ 也校验', () => {
    expect(
      isWriteWithinAllowedRoots('Write', { path: 'C:\\work\\sub\\b.txt' }, [
        'C:\\work',
      ]),
    ).toBe(true);
    expect(
      isWriteWithinAllowedRoots('Write', { path: 'D:\\elsewhere' }, ['C:\\work']),
    ).toBe(false);
  });

  it('边界敏感：兄弟撞名目录不误匹配（/home/user vs /home/user-evil）', () => {
    expect(
      isWriteWithinAllowedRoots('Write', { file_path: '/home/user-evil/x' }, [
        '/home/user',
      ]),
    ).toBe(false);
    // 等于 root 本身允许（在 root 下）。
    expect(
      isWriteWithinAllowedRoots('Edit', { file_path: '/home/user' }, [
        '/home/user',
      ]),
    ).toBe(true);
  });

  it('.. 穿越被折叠（C:\\work\\..\\evil → C:\\evil 越界）', () => {
    expect(
      isWriteWithinAllowedRoots(
        'Write',
        { file_path: 'C:\\work\\..\\evil\\a.txt' },
        ['C:\\work'],
      ),
    ).toBe(false);
  });

  it('MultiEdit / Edit 同 Write 处理', () => {
    expect(
      isWriteWithinAllowedRoots('Edit', { file_path: 'C:\\work\\a.txt' }, [
        'C:\\work',
      ]),
    ).toBe(true);
    expect(
      isWriteWithinAllowedRoots('MultiEdit', { file_path: 'C:\\x' }, [
        'C:\\work',
      ]),
    ).toBe(false);
  });

  it('读工具 / 其他 → true（读自由，不校验）', () => {
    const roots = ['C:\\work'];
    expect(isWriteWithinAllowedRoots('Read', { file_path: 'C:\\anywhere' }, roots)).toBe(true);
    expect(isWriteWithinAllowedRoots('Grep', { path: 'C:\\anywhere' }, roots)).toBe(true);
    expect(isWriteWithinAllowedRoots('Bash', { command: 'rm -rf /' }, roots)).toBe(true);
    expect(isWriteWithinAllowedRoots('Glob', { pattern: '**/*' }, roots)).toBe(true);
    expect(isWriteWithinAllowedRoots('WebFetch', { url: 'http://x' }, roots)).toBe(true);
  });

  it('写工具但取不到 path → true（无法校验，放行交内层）', () => {
    expect(isWriteWithinAllowedRoots('Write', {}, ['C:\\work'])).toBe(true);
    expect(isWriteWithinAllowedRoots('Write', null, ['C:\\work'])).toBe(true);
  });

  it('allowedRoots 为空 → true（视为未启用）', () => {
    expect(
      isWriteWithinAllowedRoots('Write', { file_path: 'C:\\anywhere' }, []),
    ).toBe(true);
  });
});

// ── 默认 chat（enableApproval=false）写拦截 ──────────────────────────────────

describe('默认 chat（enableApproval=false）写拦截', () => {
  /**
   * 构造一个「注入 allowedRootsProvider + manualApproval=false」的 chat session，
   * 返回注入的 canUseTool 回调。模拟默认对话场景：不启用人审，仅写校验。
   */
  async function makeChatSession(roots: string[]) {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager({ driver, ...noopDeps }, {
      allowedRootsProvider: () => roots,
    });
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

  it('写工具白名单外 → deny（message 含 "path outside allowed_roots"）', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const res = await canUseTool(
      'Write',
      { file_path: 'C:\\secret\\pw.txt', content: 'x' },
      { signal: undefined },
    );
    expect(res).toMatchObject({ behavior: 'deny' });
    expect((res as { message?: string }).message).toContain(
      'path outside allowed_roots',
    );
    // message 携带越界 path 便于诊断。
    expect((res as { message?: string }).message).toContain('C:\\secret\\pw.txt');
  });

  it('读工具（Read/Grep/Bash）→ allow（不拦，读自由）', async () => {
    const { canUseTool } = await makeChatSession(['C:\\work']);
    const r1 = await canUseTool('Read', { file_path: 'C:\\anywhere' }, { signal: undefined });
    expect(r1).toMatchObject({ behavior: 'allow' });
    const r2 = await canUseTool('Bash', { command: 'ls /' }, { signal: undefined });
    expect(r2).toMatchObject({ behavior: 'allow' });
  });

  it('Edit / MultiEdit 越界同样 deny', async () => {
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

  it('provider 返回空数组 → 不拦（视为未启用，写越界也 allow）', async () => {
    const { canUseTool } = await makeChatSession([]);
    const res = await canUseTool(
      'Write',
      { file_path: 'C:\\anywhere' },
      { signal: undefined },
    );
    // 空数组 → 写守卫短路放行 → 内层 allow。
    expect(res).toMatchObject({ behavior: 'allow' });
  });
});

// ── enableApproval=true（人审）路径也前置写校验 ────────────────────────────────

describe('enableApproval=true（人审）路径前置写校验', () => {
  /**
   * 构造一个 manualApproval=true + allowedRootsProvider 的 session。
   * 验证写越界在到达远程人审（resolver.register → send）之前就被 deny。
   */
  async function makeApprovalSession(roots: string[]) {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sendMock = vi.fn(() => true);
    const sm = new SessionManager(
      { driver, ...noopDeps },
      {
        manualApproval: true,
        permissionWsClient: { send: sendMock },
        allowedRootsProvider: () => roots,
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

// ── 向后兼容：不注入 provider ──────────────────────────────────────────────────

describe('向后兼容：不注入 allowedRootsProvider', () => {
  it('默认 chat（manualApproval=false）不注入 canUseTool（旧行为不变）', async () => {
    const { driver, getOpts } = makeDriverCapturingOpts();
    const sm = new SessionManager({ driver, ...noopDeps });
    await sm.create({ ...BASE_INPUT, manualApproval: false });
    expect(getOpts()?.canUseTool).toBeUndefined();
  });
});
