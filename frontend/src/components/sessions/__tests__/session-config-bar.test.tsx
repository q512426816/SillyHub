/**
 * SessionConfigBar + 消息 who 行单测（2026-08-14-sessions-portal task-14 /
 * FR-05 / FR-07 / D-004@v2 / D-007@v1 / D-008@v1）。
 *
 * 依据：
 *   - components/sessions/session-config-bar.tsx（本 task 实现）
 *   - components/daemon/turn-timeline.tsx（whoLine 可选字段，task-14 追加）
 *   - tasks/task-14.md acceptance：idle 切档案/供应商走 inject 新配置、running 全置灰、
 *     机器/智能体仅展示、切换参数正确（含「不指定」空串 ""）、who 行按快照渲染、
 *     TurnTimeline 不传 whoLine 零回归。
 *
 * mock 策略（对齐 new-session-form.test.tsx）：直接 mock 组件消费的 hook/函数模块
 * （useDaemonMachines / useMineAgentProfiles / listProviders / injectSession），
 * @/lib/api 保留真实（ApiError instanceof 用）；antd message 局部 mock 便于断言 toast。
 *
 * jsdom 坑：TurnTimeline 的 MarkdownText 用 next/dynamic ssr:false，jsdom 同步 render
 * 得 null → mock 成纯文本渲染（与 turn-timeline-session-input-bar.test.tsx 一致）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";

import {
  SessionConfigBar,
  SWITCH_NO_PROVIDER_VALUE,
} from "@/components/sessions/session-config-bar";
import { TurnTimeline, type SessionTurnView } from "@/components/daemon/turn-timeline";
import type { DaemonMachineRead, DaemonRuntimeRead } from "@/lib/daemon";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  machinesHook: vi.fn(),
  profilesHook: vi.fn(),
  listProviders: vi.fn(),
  injectSession: vi.fn(),
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => mocks.machinesHook(),
}));

vi.mock("@/lib/agent-profiles", () => ({
  NO_PROFILE_VALUE: "",
  useMineAgentProfiles: () => mocks.profilesHook(),
}));

vi.mock("@/lib/api/llm-providers", () => ({
  listProviders: (...args: unknown[]) => mocks.listProviders(...args),
}));

// 组件运行时只消费 injectSession（类型导入编译期擦除），局部 mock 不加载真实 daemon.ts。
// ql-20260815-011：组件新增消费 PROVIDER_META（引擎显示名），importOriginal
// 保留真常量只 mock injectSession 网络函数。
vi.mock("@/lib/daemon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/daemon")>();
  return {
    ...actual,
    injectSession: (...args: unknown[]) => mocks.injectSession(...args),
  };
});

// antd message 静态方法局部 mock（Button/Input 走真实实现）。
vi.mock("antd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("antd")>();
  return {
    ...actual,
    message: { success: mocks.messageSuccess, error: mocks.messageError },
  };
});

// TurnTimeline 渲染依赖（jsdom 下 next/dynamic ssr:false 得 null）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

// ── 固件构造 ─────────────────────────────────────────────────────────────

function makeRuntime(
  overrides: Partial<DaemonRuntimeRead> = {},
): DaemonRuntimeRead {
  return {
    id: "rt-1",
    display_alias: null,
    name: null,
    provider: "claude",
    version: null,
    os: null,
    arch: null,
    status: "online",
    last_heartbeat_at: null,
    capabilities: null,
    allowed_roots: [],
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeMachine(
  overrides: Partial<DaemonMachineRead> = {},
): DaemonMachineRead {
  return {
    id: "m-1",
    hostname: "machine-1",
    display_alias: null,
    os: "windows",
    arch: "x64",
    status: "online",
    last_heartbeat_at: "2026-08-15T08:00:00Z",
    version: "1.0.0",
    build_id: null,
    started_at: null,
    created_at: "2026-08-01T00:00:00Z",
    runtime_count: 1,
    online_runtime_count: 1,
    runtimes: [makeRuntime({ id: "rt-m1-claude" })],
    ...overrides,
  } as DaemonMachineRead;
}

/** 当前会话机器：machine-1 上 Claude（rt-cur）+ Codex（rt-m1-codex）；另 machine-2 Claude。 */
function defaultMachines() {
  return [
    makeMachine({
      runtimes: [
        makeRuntime({ id: "rt-cur", provider: "claude", name: "Claude Code" }),
        makeRuntime({ id: "rt-m1-codex", provider: "codex", name: "Codex" }),
      ],
      runtime_count: 2,
    }),
    makeMachine({
      id: "m-2",
      hostname: "machine-2",
      runtimes: [makeRuntime({ id: "rt-m2-claude", name: "Claude Code" })],
    }),
  ];
}

const BASE_PROPS = {
  sessionId: "sess-1",
  running: false,
  ended: false,
  agentProfileId: null,
  llmProviderId: null,
  configSnapshot: {
    machine_name: "machine-1",
    agent_name: "Claude Code",
    engine: "claude",
  },
  runtimeId: "rt-cur",
  engine: "claude" as const,
};

const INJECT_RESPONSE = {
  session_id: "sess-1",
  run_id: "run-2",
  status: "pending",
};

function renderBar(overrides: Record<string, unknown> = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionConfigBar {...({ ...BASE_PROPS, ...overrides } as any)} />
    </QueryClientProvider>,
  );
}

function openCtrl(labelPart: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(labelPart) }));
}

beforeEach(() => {
  mocks.machinesHook.mockReset().mockReturnValue({
    items: defaultMachines(),
    total: 2,
    sessions: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mocks.profilesHook.mockReset().mockReturnValue({
    profiles: [
      { id: "prof-1", name: "知识经理" },
      { id: "prof-2", name: "严肃代码审查员" },
    ],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mocks.listProviders.mockReset().mockResolvedValue([
    { id: "prov-kimi", name: "Kimi 中转", model: "kimi-k2" },
    { id: "prov-glm", name: "GLM 平台", model: "glm-4.7" },
  ]);
  mocks.injectSession.mockReset().mockResolvedValue(INJECT_RESPONSE);
  mocks.messageSuccess.mockReset();
  mocks.messageError.mockReset();
});

afterEach(() => {
  cleanup();
});

// ── 1. 四控件渲染（样式 B） ───────────────────────────────────────────────

describe("SessionConfigBar 四控件渲染", () => {
  it("机器/智能体/供应商/档案四控件展示当前值（快照直显 + 本机默认/未指定如实显示）", () => {
    renderBar();
    expect(
      screen.getByRole("button", { name: "配置-机器 machine-1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "配置-智能体 Claude Code" }),
    ).toBeInTheDocument();
    // 未选供应商/档案 → 本机默认 / 未指定
    expect(
      screen.getByRole("button", { name: "配置-供应商 本机默认" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "配置-档案 未指定" }),
    ).toBeInTheDocument();
  });

  it("已选供应商/档案时展示列表名（id 解析优先，快照名兜底）", async () => {
    renderBar({
      llmProviderId: "prov-kimi",
      agentProfileId: "prof-1",
    });
    // 供应商列表经 react-query 异步到达 → findBy 等待解析后再断言
    expect(
      await screen.findByRole("button", { name: "配置-供应商 Kimi 中转" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "配置-档案 知识经理" }),
    ).toBeInTheDocument();
  });
});

// ── 2. running / ended 置灰（FR-05） ─────────────────────────────────────

describe("SessionConfigBar 状态置灰", () => {
  it("running：四控件全禁用 + 「🔒 本轮完成后解锁切换」提示，下拉不可开", () => {
    renderBar({ running: true });
    for (const name of [
      "配置-机器 machine-1",
      "配置-智能体 Claude Code",
      "配置-供应商 本机默认",
      "配置-档案 未指定",
    ]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    expect(screen.getByText("🔒 本轮完成后解锁切换")).toBeInTheDocument();
    // 点击置灰控件不开下拉
    fireEvent.click(screen.getByRole("button", { name: "配置-供应商 本机默认" }));
    expect(screen.queryByTestId("config-dd-provider")).not.toBeInTheDocument();
  });

  it("ended：全部禁用且无解锁提示（只读浏览）", () => {
    renderBar({ ended: true });
    expect(
      (screen.getByRole("button", { name: "配置-供应商 本机默认" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.queryByText("🔒 本轮完成后解锁切换"),
    ).not.toBeInTheDocument();
  });
});

// ── 3. 机器/智能体纯展示（D-004@v2） ─────────────────────────────────────

describe("SessionConfigBar 机器/智能体纯展示（D-004@v2）", () => {
  it("机器下拉：其它机器标「跨机器 · 二期」、离线标「离线」，全部项不可点、无确认行", () => {
    mocks.machinesHook.mockReturnValue({
      items: [
        ...defaultMachines(),
        makeMachine({ id: "m-3", hostname: "machine-off", status: "offline" }),
      ],
      total: 3,
      sessions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderBar();
    openCtrl("配置-机器");
    const dd = screen.getByTestId("config-dd-machine");
    expect(dd).toBeInTheDocument();
    expect(screen.getByText("跨机器 · 二期")).toBeInTheDocument();
    expect(screen.getByText("离线")).toBeInTheDocument();
    expect(screen.getByText("✓ 当前")).toBeInTheDocument();
    // 展示项为 aria-disabled div（非按钮，不可点）→ 不出现切换确认行
    expect(dd.querySelector("button")).toBeNull();
    expect(screen.queryByLabelText("切换确认行")).not.toBeInTheDocument();
  });

  it("智能体下拉：只列当前机器引擎——其它在线引擎可点引导开新会话、离线置灰、不列其它机器", () => {
    renderBar();
    openCtrl("配置-智能体");
    expect(screen.getByTestId("config-dd-agent")).toBeInTheDocument();
    // 同机其它引擎（Codex，在线）→ 可点，标注「换引擎需开新会话」
    const codex = screen.getByRole("button", { name: /Codex/ });
    expect(codex).toBeInTheDocument();
    expect(screen.getByText("换引擎需开新会话")).toBeInTheDocument();
    // 其它机器（machine-2）的引擎不出现在下拉里
    expect(screen.queryByText("跨机器 · 二期")).not.toBeInTheDocument();
    expect(screen.queryByText(/machine-2/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("切换确认行")).not.toBeInTheDocument();
  });
});

// ── 4. 供应商切换（含「不指定」空串语义，task-16 契约） ───────────────────

describe("SessionConfigBar 切换供应商", () => {
  it("idle 选择供应商 → 点选即静默切换（空 prompt）→ injectSession 参数正确 + 成功 toast", async () => {
    renderBar({ llmProviderId: "prov-kimi" });
    openCtrl("配置-供应商");
    // 供应商选项经 react-query 异步到达 → findBy 等待；点选即执行（无确认行）
    fireEvent.click(await screen.findByRole("button", { name: "选择 GLM 平台" }));

    await waitFor(() => expect(mocks.injectSession).toHaveBeenCalledTimes(1));
    // ql-20260817-010：静默切换——prompt 空串（daemon 只 reload 不喂消息）
    expect(mocks.injectSession).toHaveBeenCalledWith("sess-1", "", {
      llm_provider_id: "prov-glm",
    });
    await waitFor(() =>
      expect(mocks.messageSuccess).toHaveBeenCalledWith(
        expect.stringContaining("下一轮生效"),
      ),
    );
  });

  it("「不指定（本机默认）」→ llm_provider_id 空串 \"\" 切回本机默认", async () => {
    renderBar({ llmProviderId: "prov-kimi" });
    openCtrl("配置-供应商");
    fireEvent.click(
      await screen.findByRole("button", { name: "选择 不指定（本机默认）" }),
    );
    await waitFor(() => expect(mocks.injectSession).toHaveBeenCalledTimes(1));
    expect(mocks.injectSession).toHaveBeenCalledWith(
      "sess-1",
      expect.any(String),
      { llm_provider_id: SWITCH_NO_PROVIDER_VALUE },
    );
    // 空串语义钉死："" 必须作为字段下发（task-16：""=切回本机默认，undefined=不切换）
    const firstCall = mocks.injectSession.mock.calls.at(0);
    expect(firstCall?.[2]?.llm_provider_id).toBe("");
  });

  it("Codex 引擎（engine≠claude）→ 供应商控件禁用（D-010）", () => {
    renderBar({
      engine: "codex",
      configSnapshot: {
        machine_name: "machine-1",
        agent_name: "Codex",
        engine: "codex",
      },
    });
    expect(
      (screen.getByRole("button", { name: "配置-供应商 本机默认" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "配置-档案 未指定" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("切换失败 → message.error（点选即切换无确认行，可再点重试）", async () => {
    mocks.injectSession.mockRejectedValueOnce(new Error("daemon 离线"));
    renderBar();
    openCtrl("配置-供应商");
    fireEvent.click(await screen.findByRole("button", { name: "选择 Kimi 中转" }));
    await waitFor(() => expect(mocks.messageError).toHaveBeenCalled());
  });
});

// ── 5. 档案切换 ──────────────────────────────────────────────────────────

describe("SessionConfigBar 切换档案", () => {
  it("idle 选择档案 → 点选即切换（默认 prompt）→ injectSession 带 agent_profile_id + toast + onSwitched 回调", async () => {
    const onSwitched = vi.fn();
    renderBar({ onSwitched });
    openCtrl("配置-档案");
    fireEvent.click(screen.getByRole("button", { name: "选择 严肃代码审查员" }));

    await waitFor(() => expect(mocks.injectSession).toHaveBeenCalledTimes(1));
    expect(mocks.injectSession).toHaveBeenCalledWith(
      "sess-1",
      "",
      { agent_profile_id: "prof-2" },
    );
    await waitFor(() => expect(onSwitched).toHaveBeenCalledTimes(1));
    expect(onSwitched).toHaveBeenCalledWith(
      INJECT_RESPONSE,
      "agent_profile_id",
      "prof-2",
    );
  });

  it("「不指定」项为纯展示（inject 契约仅非空 id 切换，不支持会话内取消）", () => {
    renderBar({ agentProfileId: "prof-1" });
    openCtrl("配置-档案");
    expect(screen.getByText("暂不支持会话内取消")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择 不指定" })).not.toBeInTheDocument();
  });

  it("Codex 引擎下档案选项标注「人格暂不支持」（D-013 不做引擎过滤）", () => {
    renderBar({ engine: "codex" });
    openCtrl("配置-档案");
    expect(screen.getByText("知识经理（人格暂不支持）")).toBeInTheDocument();
  });
});

// ── 6. 消息 who 行（FR-07 / D-008@v1，TurnTimeline whoLine） ─────────────

describe("TurnTimeline whoLine 轮次快照渲染（D-008）", () => {
  function makeTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
    return {
      runId: "run-1",
      turn: 1,
      prompt: "用户提问",
      output: "agent 答复",
      status: "completed",
      seenLogIds: new Set<string>(),
      inputTokens: 10,
      outputTokens: 20,
      errorDetail: null,
      processItems: [],
      ...overrides,
    };
  }

  function setupTimeline(turns: SessionTurnView[]) {
    return render(
      <TurnTimeline
        turns={turns}
        viewMode="conversation"
        errorMsg={null}
        sessionStatus="active"
        pendingRequests={[]}
        dialogHistory={[]}
        onDialogResolved={vi.fn()}
        onResend={vi.fn()}
        onSwitchProvider={vi.fn()}
        hasOnlineProvider
        emptyProviderLabel="Claude Code"
      />,
    );
  }

  it("whoLine 按 run 快照渲染「📋 档案 · 智能体 · ☁ 供应商」", () => {
    setupTimeline([
      makeTurn({
        whoLine: {
          profileName: "知识经理",
          agentName: "Claude Code",
          providerName: "GLM 平台",
        },
      }),
    ]);
    const who = screen.getByLabelText("轮次配置快照");
    expect(who).toHaveTextContent("📋 知识经理");
    expect(who).toHaveTextContent("Claude Code");
    expect(who).toHaveTextContent("☁ GLM 平台");
  });

  it("profileName/providerName 为 null → 如实显示「未指定」/「本机默认」", () => {
    setupTimeline([
      makeTurn({
        whoLine: { profileName: null, agentName: "Codex", providerName: null },
      }),
    ]);
    const who = screen.getByLabelText("轮次配置快照");
    expect(who).toHaveTextContent("📋 未指定");
    expect(who).toHaveTextContent("☁ 本机默认");
  });

  it("多轮各读各的快照：切换后旧消息 who 行保持原配置不跟随", () => {
    setupTimeline([
      makeTurn({
        runId: "run-1",
        whoLine: { profileName: "知识经理", agentName: "Claude Code", providerName: "Kimi 中转" },
      }),
      makeTurn({
        runId: "run-2",
        turn: 2,
        prompt: "第二轮",
        whoLine: { profileName: null, agentName: "Claude Code", providerName: null },
      }),
    ]);
    const rows = screen.getAllByLabelText("轮次配置快照");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Kimi 中转");
    expect(rows[0]).not.toHaveTextContent("本机默认");
    expect(rows[1]).toHaveTextContent("本机默认");
  });

  it("不传 whoLine → 不渲染（弹窗零回归）", () => {
    setupTimeline([makeTurn()]);
    expect(screen.queryByLabelText("轮次配置快照")).not.toBeInTheDocument();
    // 既有渲染口径不受影响（task-13 冒烟断言）
    expect(screen.getByText("用户提问")).toBeInTheDocument();
    expect(screen.getByText("agent 答复")).toBeInTheDocument();
    expect(screen.getByText(/第 1 轮 · 已完成/)).toBeInTheDocument();
  });
});
