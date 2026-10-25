// tests/interactive/session-header-snapshot.test.ts
// 2026-10-25-trajectory-source-model task-03/04：配置面请求头快照——纯函数
// （采集/比较/决策/消息形态）+ SessionManager 生命周期接线（create 直发 /
// reloadWithConfig 直发 / restoreAndReconnect pending → inject 补发）。
//
// 覆盖：
//   (1) buildSessionHeaderSnapshot：三字段取数（systemPrompt 原值 ?? null、
//       allowedTools 原序拷贝、mcpServers 键名去重排序）。
//   (2) headerEquals：三字段逐一差异；decideHeaderReport：undefined prev →
//       initial、不等 → change、相等 → null（不上报）。
//   (3) buildHeaderReportMessage：event_type=text / channel=session_header /
//       metadata.reason / content 为快照 JSON 序列化（round-trip 还原）。
//   (4) 接线冒烟（mock driver，对齐 session-manager.test.ts 基建）：
//       create 后 onTurnMessage 收到 initial 快照（runId=firstRunId）；
//       reloadWithConfig 后收到 change；restoreAndReconnect 后不直发（pending），
//       首次 inject 时补发。

import { describe, it, expect, vi } from 'vitest';
import type {
  Query,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import {
  buildHeaderReportMessage,
  buildSessionHeaderSnapshot,
  decideHeaderReport,
  headerEquals,
} from '../../src/interactive/session-header-snapshot.js';
import type {
  SessionHeaderSnapshot,
  SessionHeaderSpecSource,
} from '../../src/interactive/session-header-snapshot.js';
import type { PersistedSessionRecord } from '../../src/interactive/types.js';
import type { SessionSwitchConfigPayload } from '../../src/interactive/types.js';
import type {
  ClaudeSdkDriver,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';
import type {
  InteractiveDriverCallbacks,
  TurnMessageEnvelope,
} from '../../src/interactive/driver.js';

// ── (1)-(3) 纯函数 ────────────────────────────────────────────────────────────

describe('buildSessionHeaderSnapshot', () => {
  it('三字段取数：systemPrompt 原值 / allowedTools 原序 / mcpServers 键名排序', () => {
    const spec: SessionHeaderSpecSource = {
      systemPrompt: '你是档案人格 A',
      allowedTools: ['Read', 'Write', 'Bash'],
      mcpServers: {
        zeta: { command: 'z' },
        alpha: { command: 'a' },
        mid: { command: 'm' },
      },
    };
    const snap = buildSessionHeaderSnapshot(spec);
    // systemPrompt 取 spec 原值（档案配置段），非 preset 展开全文。
    expect(snap.systemPrompt).toBe('你是档案人格 A');
    // allowedTools 原序拷贝（顺序即配置面的一部分，不排序）。
    expect(snap.allowedTools).toEqual(['Read', 'Write', 'Bash']);
    // mcpServers 取 server name 键，字典序排序（对象键插入序不稳定，排序保证
    // 同一配置面恒产同一快照）。
    expect(snap.mcpServers).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('缺省容错：systemPrompt undefined → null；allowedTools/mcpServers 缺省 → []', () => {
    const snap = buildSessionHeaderSnapshot({});
    expect(snap).toEqual({ systemPrompt: null, allowedTools: [], mcpServers: [] });
  });

  it('systemPrompt null（取消档案）原样保留 null', () => {
    const snap = buildSessionHeaderSnapshot({ systemPrompt: null });
    expect(snap.systemPrompt).toBeNull();
  });

  it('allowedTools 拷贝隔离：后续改动源数组不污染快照', () => {
    const allowed = ['Read'];
    const snap = buildSessionHeaderSnapshot({ allowedTools: allowed });
    allowed.push('Write');
    expect(snap.allowedTools).toEqual(['Read']);
  });
});

describe('headerEquals / decideHeaderReport', () => {
  const base: SessionHeaderSnapshot = {
    systemPrompt: '人格 A',
    allowedTools: ['Read', 'Write'],
    mcpServers: ['sillyhub-daemon', 'sillyhub-file'],
  };

  it('相同快照 → headerEquals true / decide null（不上报）', () => {
    const same = buildSessionHeaderSnapshot({
      systemPrompt: '人格 A',
      allowedTools: ['Read', 'Write'],
      // 键插入序不同但集合相同——排序后相等，不误报 change。
      mcpServers: {
        'sillyhub-file': { command: 'f' },
        'sillyhub-daemon': { command: 'd' },
      },
    });
    expect(headerEquals(base, same)).toBe(true);
    expect(decideHeaderReport(base, same)).toBeNull();
  });

  it('prev undefined → initial（首条 / daemon 重启缓存丢失）', () => {
    expect(decideHeaderReport(undefined, base)).toBe('initial');
  });

  it('systemPrompt / allowedTools / mcpServers 任一差异 → change', () => {
    expect(decideHeaderReport(base, { ...base, systemPrompt: '人格 B' })).toBe('change');
    expect(decideHeaderReport(base, { ...base, systemPrompt: null })).toBe('change');
    expect(decideHeaderReport(base, { ...base, allowedTools: ['Read'] })).toBe('change');
    // allowedTools 顺序变化 = 配置面变化。
    expect(
      decideHeaderReport(base, { ...base, allowedTools: ['Write', 'Read'] }),
    ).toBe('change');
    expect(
      decideHeaderReport(base, { ...base, mcpServers: ['sillyhub-daemon'] }),
    ).toBe('change');
    expect(
      decideHeaderReport(base, {
        ...base,
        mcpServers: ['sillyhub-daemon', 'sillyhub-file', 'extra'],
      }),
    ).toBe('change');
  });
});

describe('buildHeaderReportMessage', () => {
  it('消息形态：event_type=text / channel=session_header / reason 进 metadata / content JSON', () => {
    const snap = buildSessionHeaderSnapshot({
      systemPrompt: '人格 A',
      allowedTools: ['Read'],
      mcpServers: { 'sillyhub-daemon': { command: 'd' } },
    });
    const msg = buildHeaderReportMessage(snap, 'change');
    expect(msg['event_type']).toBe('text');
    expect(msg['channel']).toBe('session_header');
    expect(msg['metadata']).toEqual({ reason: 'change' });
    // content 为快照 JSON 序列化——round-trip 还原三字段（前端 JSON.parse 口径）。
    expect(JSON.parse(msg['content'] as string)).toEqual(snap);
  });

  it('reason=initial 同款形态', () => {
    const msg = buildHeaderReportMessage(
      { systemPrompt: null, allowedTools: [], mcpServers: [] },
      'initial',
    );
    expect(msg['channel']).toBe('session_header');
    expect(msg['metadata']).toEqual({ reason: 'initial' });
    expect(JSON.parse(msg['content'] as string)).toEqual({
      systemPrompt: null,
      allowedTools: [],
      mcpServers: [],
    });
  });
});

// ── (4) 生命周期接线冒烟 ──────────────────────────────────────────────────────

/** mock driver：每次 start 返回新 fakeQuery；consume 捕获回调供注入 system/init。 */
function makeMockDriver() {
  let capturedCallbacks: InteractiveDriverCallbacks | null = null;
  let handleSeq = 0;
  const startCalls: Array<{ opts: Record<string, unknown> }> = [];

  const makeFakeQuery = (): Query =>
    ({ interrupt: vi.fn(async () => {}), close: vi.fn(() => {}) }) as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        handleSeq += 1;
        startCalls.push({ opts: opts as Record<string, unknown> });
        return makeFakeQuery();
      },
    ),
    consume: vi.fn(async (_q: Query, cb: InteractiveDriverCallbacks): Promise<void> => {
      capturedCallbacks = cb;
      // 不自动 yield；测试按需注入消息。
    }),
    interrupt: vi.fn(async (q: Query | null): Promise<boolean> => {
      if (!q) return false;
      await (q.interrupt as () => Promise<void>)();
      return true;
    }),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    startCalls,
    /** 注入 system/init 事件（写 state.agentSessionId，reload 前置条件）。 */
    emitSessionInit: (sessionId: string) =>
      capturedCallbacks?.onTurnMessage?.({
        events: [
          { type: 'status', subtype: 'session_started', content: '', session_id: sessionId },
        ],
      } satisfies TurnMessageEnvelope),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(
      async (_s: string, _r: string, _res: unknown) => {},
    ),
    onTurnMessage: vi.fn(
      async (_s: string, _r: string, _m: Record<string, unknown>) => {},
    ),
    onSessionEnd: vi.fn(async (_s: string, _st: string) => {}),
  };
}

/** 从 onTurnMessage 调用记录中筛出 session_header 消息。 */
type HeaderCall = [string, string, Record<string, unknown>];
function headerCalls(deps: ReturnType<typeof makeDeps>): HeaderCall[] {
  return (
    deps.onTurnMessage as ReturnType<typeof vi.fn>
  ).mock.calls.filter(
    (c: unknown[]) =>
      (c[2] as Record<string, unknown>)['channel'] === 'session_header',
  ) as HeaderCall[];
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

describe('生命周期接线（task-03/04 冒烟）', () => {
  it('create：driver.start 成功后直发 initial 快照（runId=firstRunId）', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({
      ...BASE_INPUT,
      systemPrompt: '档案人格 A',
      allowedTools: ['Read', 'Bash'],
    });

    const headers = headerCalls(deps);
    expect(headers).toHaveLength(1);
    const [sessionId, runId, msg] = headers[0]!;
    expect(sessionId).toBe('sess-1');
    expect(runId).toBe('run-1');
    expect(msg['channel']).toBe('session_header');
    expect(msg['metadata']).toEqual({ reason: 'initial' });
    expect(JSON.parse(msg['content'] as string)).toEqual({
      systemPrompt: '档案人格 A',
      allowedTools: ['Read', 'Bash'],
      mcpServers: [],
    });
  });

  it('reloadWithConfig：配置变化 → 直发 change 快照（runId=切换轮 runId）', async () => {
    const { driver, emitSessionInit } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT, systemPrompt: '档案人格 A' });
    expect(headerCalls(deps)).toHaveLength(1); // initial

    // 写 agentSessionId（reload 内核守卫：无可恢复 jsonl 的会话拒绝 reload）。
    await emitSessionInit('sdk-sess-1');

    const payload: SessionSwitchConfigPayload = {
      sessionId: 'sess-1',
      runId: 'run-2',
      claimToken: 'tok-2',
      prompt: '切换轮',
      profile: { systemPrompt: '新档案人格 B' },
    };
    await sm.reloadWithConfig('sess-1', payload);

    const headers = headerCalls(deps);
    expect(headers).toHaveLength(2);
    const [sessionId, runId, msg] = headers[1]!;
    expect(sessionId).toBe('sess-1');
    expect(runId).toBe('run-2');
    expect(msg['metadata']).toEqual({ reason: 'change' });
    expect(JSON.parse(msg['content'] as string)).toEqual({
      systemPrompt: '新档案人格 B',
      allowedTools: [],
      mcpServers: [],
    });
  });

  it('restoreAndReconnect：无 runId 不直发（pending），首次 inject 补发 initial', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    const record: PersistedSessionRecord = {
      sessionId: 'sess-1',
      leaseId: 'lease-1',
      agentSessionId: 'sdk-sess-1',
      cwd: 'C:\\work',
      provider: 'claude',
      turnCount: 0,
      lastActiveAt: Date.now(),
      pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
      systemPrompt: '恢复档案人格 C',
    };
    await sm.restoreAndReconnect(record);
    // 恢复点无 runId / claimToken → 不直发，暂存 pending。
    expect(headerCalls(deps)).toHaveLength(0);

    // daemon 恢复编排：backend confirm 后切回 active（inject 前置条件）。
    await sm.markReconnected('sess-1');

    // 恢复后首次 inject（backend SESSION_INJECT 带新 runId）→ 补发落锚。
    await sm.inject('sess-1', '恢复后首问', 'run-9');

    const headers = headerCalls(deps);
    expect(headers).toHaveLength(1);
    const [sessionId, runId, msg] = headers[0]!;
    expect(sessionId).toBe('sess-1');
    expect(runId).toBe('run-9');
    expect(msg['metadata']).toEqual({ reason: 'initial' });
    expect(JSON.parse(msg['content'] as string)).toEqual({
      systemPrompt: '恢复档案人格 C',
      allowedTools: [],
      mcpServers: [],
    });

    // 补发一次性：再 inject 不重复上报（pending 已清）。
    await sm.inject('sess-1', '第二轮', 'run-10');
    expect(headerCalls(deps)).toHaveLength(1);
  });
});
