// tests/sillyspec-flow-status-collector.test.ts
// thin flow 采集测试（2026-10-26-session-change-progress-hover task-06 / FR-03 /
// D-008@v2）。覆盖：buildThinFlowSummary 纯函数（active 形态白名单/非 active 形态
// null/类型防御）+ _collectThinFlowsForTarget 三态（ok 落槽 / error 保留旧值 /
// 名单驱动清理 / legacy 单槽位跳过）+ getThinFlows 拍平。
//
// ⚠ 落位说明（工程现实）：daemon vitest include 只扫 tests/**——TaskCard 写的
// src/__tests__/ 路径不会被拾取，按 include 现实落 tests/（task-06 卡内偏差，
// 组装断言（task-07）同文件追加）。

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  buildThinFlowSummary,
  type SillySpecManagerDeps,
  SillySpecManager,
  type SillySpecProgressOutcome,
  type SillySpecStatusSummary,
} from '../src/sillyspec-manager';

// ── buildThinFlowSummary（纯函数）────────────────────────────────────────────

describe('buildThinFlowSummary', () => {
  it('active 形态：白名单字段全透传（CLI JSON 键名 camelCase）', () => {
    const item = buildThinFlowSummary('ws-1', {
      change: '2026-10-26-thin-a',
      status: 'active',
      phase: '② 执行（已批准·写代码跑测试）',
      designFilled: true,
      frFilled: true,
      bindingsFilled: 2,
      bindingsTotal: 2,
      tasksChecked: 4,
      tasksTotal: 12,
      substeps: ['artifacts', 'ledger'],
      specApproved: true,
      autopilot: false,
    });
    expect(item).toEqual({
      workspace_id: 'ws-1',
      change: '2026-10-26-thin-a',
      phase: '② 执行（已批准·写代码跑测试）',
      design_filled: true,
      fr_filled: true,
      bindings_total: 2,
      bindings_filled: 2,
      tasks_total: 12,
      tasks_checked: 4,
      substeps: ['artifacts', 'ledger'],
      spec_approved: true,
      autopilot: false,
      legacy_fallback: false,
    });
  });

  it('非 active 形态（archived/dir-no-state）→ null（键不落槽）', () => {
    expect(buildThinFlowSummary('ws-1', { change: 'x', status: 'archived' })).toBeNull();
    expect(buildThinFlowSummary('ws-1', { change: 'x', status: 'dir-no-state' })).toBeNull();
  });

  it('类型防御：缺键按 falsy 缺省（宁宽勿断）；legacyFallback 仅 true 才透', () => {
    const item = buildThinFlowSummary('ws-1', {
      change: '2026-10-26-thin-b',
      status: 'active',
      legacyFallback: true,
    });
    expect(item).not.toBeNull();
    expect(item!.design_filled).toBe(false);
    expect(item!.tasks_total).toBe(0);
    expect(item!.substeps).toEqual([]);
    expect(item!.legacy_fallback).toBe(true);
  });

  it('change 非字符串/空 → null；非对象输入 → null', () => {
    expect(buildThinFlowSummary('ws-1', { change: 123, status: 'active' })).toBeNull();
    expect(buildThinFlowSummary('ws-1', { change: '', status: 'active' })).toBeNull();
    expect(buildThinFlowSummary('ws-1', null)).toBeNull();
    expect(buildThinFlowSummary('ws-1', 'str')).toBeNull();
  });
});

// ── _collectThinFlowsForTarget 三态（经 collectStatusOnce 集成驱动）─────────

const FLOW_JSON_OK = JSON.stringify({
  change: '2026-10-26-thin-a',
  status: 'active',
  phase: '② 执行（已批准·写代码跑测试）',
  designFilled: true,
  frFilled: true,
  bindingsFilled: 2,
  bindingsTotal: 2,
  tasksChecked: 4,
  tasksTotal: 12,
  substeps: [],
  specApproved: true,
});

const PROGRESS_ENVELOPE = (stages: Record<string, string>) => ({
  // machine-interface envelope 包装层（buildSillySpecStatusSummary 读 env.data.changes）
  generated_at: '2026-10-26T12:00:00Z',
  data: {
    project: 'p',
    active_changes: Object.keys(stages).length,
    changes: Object.entries(stages).map(([name, current_stage]) => ({
      name,
      ghost: false,
      current_stage,
      stage_label: current_stage,
      last_active: '2026-10-26T12:00:00Z',
      stages: {},
      steps: { total: 0, completed: 0 },
    })),
    pending_conflicts: [],
  },
});

function summaryFrom(stages: Record<string, string>): SillySpecStatusSummary {
  const env = PROGRESS_ENVELOPE(stages);
  return {
    ok: true,
    errors_count: 0,
    warnings_count: 0,
    generated_at: '2026-10-26T12:00:00Z',
    active_changes: env.data.active_changes,
    healthy_count: env.data.active_changes,
    ghost_count: 0,
    conflict_count: 0,
    conflict_types: {},
    changes: env.data.changes as SillySpecStatusSummary['changes'],
    pending_conflicts: [],
  };
}

interface RunnerSpec {
  /** 命令片段匹配（如 'progress show' / 'flow status'）→ 出参。 */
  match: string;
  outcome: SillySpecProgressOutcome;
}

function makeManager(runnerSpecs: RunnerSpec[]): {
  mgr: SillySpecManager;
} {
  const deps: Partial<SillySpecManagerDeps> = {
    runProgressJson: (async (_file: string, args: string[]) => {
      const joined = args.join(' ');
      for (const spec of runnerSpecs) {
        if (joined.includes(spec.match)) return spec.outcome;
      }
      return { code: 0, stdout: '', timedOut: false };
    }) as SillySpecManagerDeps['runProgressJson'],
    resolveSillySpecBin: () => 'C:/fake/sillyspec.js',
    statusTargets: () => [{ workspaceId: 'ws-1', rootPath: 'C:/fake/root' }],
    log: () => {},
  };
  return { mgr: new SillySpecManager(deps as SillySpecManagerDeps) };
}

describe('thin flow 采集三态（collectStatusOnce 集成）', () => {
  it('ok：progress 成功 + 名单含 thin → flow status 落槽，getThinFlows 拍平', async () => {
    const { mgr } = makeManager([
      {
        match: 'progress show',
        outcome: { code: 0, stdout: JSON.stringify(PROGRESS_ENVELOPE({ '2026-10-26-thin-a': 'thin' })), timedOut: false },
      },
      { match: 'flow status', outcome: { code: 0, stdout: FLOW_JSON_OK, timedOut: false } },
    ]);
    await mgr.collectStatusOnce();
    const flows = mgr.getThinFlows();
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({
      workspace_id: 'ws-1',
      change: '2026-10-26-thin-a',
      spec_approved: true,
      tasks_checked: 4,
    });
  });

  it('error：CLI 缺 flow 命令（exit 非零）静默保留旧值，progress 采集不受影响', async () => {
    const errOutcome: SillySpecProgressOutcome = { code: 1, stdout: '', timedOut: false, stderr: '未知命令: flow' };
    // 第一拍成功落槽 → 第二拍 flow 失败 → 槽保留旧值
    const { mgr } = makeManager([]);
    // 用原型替换法注入两拍不同行为
    let call = 0;
    const deps = mgr as unknown as { _runProgressJson: unknown };
    void deps;
    const mgrAny = mgr as unknown as {
      _runProgressJson: (f: string, a: string[], o: unknown) => Promise<SillySpecProgressOutcome>;
      _collectThinFlowsForTarget: (ws: string | null, cwd: string, s: SillySpecStatusSummary) => Promise<void>;
    };
    mgrAny._runProgressJson = async (_f, args) => {
      const joined = args.join(' ');
      call += 1;
      if (joined.includes('progress show')) {
        return { code: 0, stdout: JSON.stringify(PROGRESS_ENVELOPE({ '2026-10-26-thin-a': 'thin' })), timedOut: false };
      }
      // flow status：第一拍 ok，第二拍 exit 1
      return call <= 2 || joined.includes('progress')
        ? { code: 0, stdout: FLOW_JSON_OK, timedOut: false }
        : errOutcome;
    };
    const summary = summaryFrom({ '2026-10-26-thin-a': 'thin' });
    await mgrAny._collectThinFlowsForTarget('ws-1', 'C:/fake/root', summary);
    expect(mgr.getThinFlows()).toHaveLength(1);
    // 第二拍：flow 失败 → 保留
    call = 10;
    await mgrAny._collectThinFlowsForTarget('ws-1', 'C:/fake/root', summary);
    expect(mgr.getThinFlows()).toHaveLength(1);
  });

  it('名单驱动清理：变更不再活跃 thin（current_stage 翻转）→ 槽删除', async () => {
    const { mgr } = makeManager([]);
    const mgrAny = mgr as unknown as {
      _runProgressJson: (f: string, a: string[], o: unknown) => Promise<SillySpecProgressOutcome>;
      _collectThinFlowsForTarget: (ws: string | null, cwd: string, s: SillySpecStatusSummary) => Promise<void>;
    };
    mgrAny._runProgressJson = async (_f, args) =>
      args.join(' ').includes('flow status')
        ? { code: 0, stdout: FLOW_JSON_OK, timedOut: false }
        : { code: 0, stdout: '', timedOut: false };
    // 第一拍：thin 在名单 → 落槽
    await mgrAny._collectThinFlowsForTarget('ws-1', 'C:/fake/root', summaryFrom({ '2026-10-26-thin-a': 'thin' }));
    expect(mgr.getThinFlows()).toHaveLength(1);
    // 第二拍：名单里该变更 current_stage 已非 thin → 键清理
    await mgrAny._collectThinFlowsForTarget('ws-1', 'C:/fake/root', summaryFrom({ '2026-10-26-thin-a': 'execute' }));
    expect(mgr.getThinFlows()).toHaveLength(0);
  });

  it('legacy 单槽位（workspaceId=null）跳过采集；非 thin 变更不触发 flow status', async () => {
    const { mgr } = makeManager([]);
    let flowCalls = 0;
    const mgrAny = mgr as unknown as {
      _runProgressJson: (f: string, a: string[], o: unknown) => Promise<SillySpecProgressOutcome>;
      _collectThinFlowsForTarget: (ws: string | null, cwd: string, s: SillySpecStatusSummary) => Promise<void>;
    };
    mgrAny._runProgressJson = async (_f, args) => {
      if (args.join(' ').includes('flow status')) flowCalls += 1;
      return { code: 0, stdout: FLOW_JSON_OK, timedOut: false };
    };
    await mgrAny._collectThinFlowsForTarget(null, 'C:/fake/root', summaryFrom({ a: 'thin' }));
    expect(flowCalls).toBe(0); // legacy 无定位键
    await mgrAny._collectThinFlowsForTarget('ws-1', 'C:/fake/root', summaryFrom({ b: 'brainstorm' }));
    expect(flowCalls).toBe(0); // 非 thin 名单不采
  });
});

// ── task-07：hub-client 心跳载荷组装（thin_flows 嵌挂 sillyspec_status）────

/** 组装用例的清单条目类型视图（= ThinFlowSummary，顶部已 import）。 */
type ThinFlowSummaryLike = import('../src/sillyspec-manager').ThinFlowSummary;

describe('hub-client thin_flows 载荷组装（task-07）', () => {
  const emptySummary = summaryFrom({});

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchCapture(): { lastBody: () => Record<string, unknown> } {
    let body: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      (async (_url: unknown, init?: RequestInit) => {
        body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
        return new Response(JSON.stringify({ daemon_instance_id: 'x', status: 'online' }), {
          status: 200,
        });
      }) as unknown as typeof fetch,
    );
    return { lastBody: () => body as Record<string, unknown> };
  }

  it('非空清单 + 摘要对象 → body.sillyspec_status.thin_flows 携带（条目字段齐全）', async () => {
    const cap = mockFetchCapture();
    const { HubClient } = await import('../src/hub-client');
    const c = new HubClient('http://x:8000');
    const flows: ThinFlowSummaryLike[] = [
      {
        workspace_id: 'ws-1',
        change: '2026-10-26-thin-a',
        phase: '② 执行（已批准·写代码跑测试）',
        design_filled: true,
        fr_filled: true,
        bindings_total: 2,
        bindings_filled: 2,
        tasks_total: 12,
        tasks_checked: 4,
        substeps: [],
        spec_approved: true,
        autopilot: false,
        legacy_fallback: false,
      },
    ];
    // 平铺 13 参：前 12 参最小形态（machineId/网卡 undefined），第 13 参 thinFlows
    await c.heartbeat(
      'rt-1',
      [],
      null,
      undefined,
      undefined,
      emptySummary,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      flows as never,
    );
    const body = cap.lastBody();
    const status = body.sillyspec_status as Record<string, unknown>;
    expect(Array.isArray(status.thin_flows)).toBe(true);
    expect((status.thin_flows as Array<Record<string, unknown>>)[0]).toMatchObject({
      workspace_id: 'ws-1',
      change: '2026-10-26-thin-a',
      tasks_checked: 4,
    });
  });

  it('空槽（undefined）或能力缺失态（status=null）→ thin_flows 键不出现（FR-07）', async () => {
    const cap = mockFetchCapture();
    const { HubClient } = await import('../src/hub-client');
    const c = new HubClient('http://x:8000');
    // 空数组：键不出现
    await c.heartbeat('rt-1', [], null, undefined, undefined, emptySummary, undefined, undefined, undefined, undefined, undefined, undefined, []);
    expect((cap.lastBody().sillyspec_status as Record<string, unknown>).thin_flows).toBeUndefined();
    // 能力缺失态（status=null）：无载荷可嵌
    await c.heartbeat('rt-1', [], null, undefined, undefined, null, undefined, undefined, undefined, undefined, undefined, undefined, [{ change: 'x' } as never]);
    expect(cap.lastBody().sillyspec_status).toBeNull();
  });
});
