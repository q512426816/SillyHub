/**
 * SessionConfigBar + 消息 who 行单测（2026-08-14-sessions-portal task-14 /
 * FR-05 / FR-07 / D-004@v2 / D-007@v1 / D-008@v1）。
 *
 * 依据：
 *   - components/sessions/session-config-bar.tsx（本 task 实现）
 *   - components/daemon/turn-timeline.tsx（whoLine 可选字段，task-14 追加）
 *   - tasks/task-14.md acceptance：idle 切档案/供应商走 inject 新配置、running 全置灰、
 *     切换参数正确（含「不指定」空串 ""）、who 行按快照渲染、
 *     TurnTimeline 不传 whoLine 零回归。
 *   - 2026-08-29-usage-by-provider-model task-09：配置条四块→两块，机器/智能体
 *     纯展示用例随之移除（useDaemonMachines mock 一并退役）。
 *   - 同变更 task-10：供应商+模型级联——供应商 Ctrl 内嵌模型子下拉（候选三来源
 *     去重保序 + 首项「默认」）；切模型 injectSession 同请求带 llm_provider_id +
 *     model；切供应商级联重置 model=""；providerLocked/「不指定」两态隐藏。
 *
 * mock 策略（对齐 new-session-form.test.tsx）：直接 mock 组件消费的 hook/函数模块
 * （useMineAgentProfiles / listProviders / injectSession），
 * @/lib/api 保留真实（ApiError instanceof 用）；antd message 局部 mock 便于断言 toast。
 *
 * jsdom 坑：TurnTimeline 的 MarkdownText 用 next/dynamic ssr:false，jsdom 同步 render
 * 得 null → mock 成纯文本渲染（与 turn-timeline-session-input-bar.test.tsx 一致）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  SessionConfigBar,
  SWITCH_MODEL_DEFAULT_VALUE,
  SWITCH_NO_PROVIDER_VALUE,
} from "@/components/sessions/session-config-bar";
import { TurnTimeline, type SessionTurnView } from "@/components/daemon/turn-timeline";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  profilesHook: vi.fn(),
  listProviders: vi.fn(),
  injectSession: vi.fn(),
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
  // task-10：useActiveSharedAgents 直取 /api/daemon/shared-agents/active（apiFetch）。
  apiFetch: vi.fn(),
}));

// task-10：apiFetch 局部 mock（useActiveSharedAgents 数据源）——ApiError 等其余
// 导出保留真实（ApiError instanceof 语义不变）。
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
  };
});

vi.mock("@/lib/agent-profiles", () => ({
  NO_PROFILE_VALUE: "",
  useMineAgentProfiles: () => mocks.profilesHook(),
}));

vi.mock("@/lib/api/llm-providers", () => ({
  listProviders: (...args: unknown[]) => mocks.listProviders(...args),
}));

// 组件运行时只消费 injectSession（类型导入编译期擦除），局部 mock 不加载真实 daemon.ts。
vi.mock("@/lib/daemon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/daemon")>();
  return {
    ...actual,
    injectSession: (...args: unknown[]) => mocks.injectSession(...args),
  };
});

// antd 局部 mock（Tag/Button 走真实实现）。组件 toast 走 useNotify → App.useApp()
// 上下文 message（message→useNotify 迁移，FR-04），故在 App.useApp 上挂 mock 断言；
// 静态 message mock 保留兜底（若有第三方直调静态方法不至于崩）。
vi.mock("antd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("antd")>();
  const AppWithMockUseApp = Object.assign(actual.App, {
    useApp: () => ({
      message: {
        success: mocks.messageSuccess,
        error: mocks.messageError,
      },
    }),
  });
  return {
    ...actual,
    App: AppWithMockUseApp,
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
  // task-10：active 共享智能体默认空列表（用例内按需覆盖）。
  mocks.apiFetch.mockReset().mockResolvedValue([]);
  mocks.messageSuccess.mockReset();
  mocks.messageError.mockReset();
});

afterEach(() => {
  cleanup();
});

// ── 1. 两控件渲染（样式 B，task-09 四块→两块） ────────────────────────────

describe("SessionConfigBar 两控件渲染", () => {
  it("供应商/档案两控件展示当前值（未选 → 本机默认/未指定如实显示），机器/智能体块不再渲染", () => {
    renderBar();
    // 未选供应商/档案 → 本机默认 / 未指定
    expect(
      screen.getByRole("button", { name: "配置-供应商 本机默认" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "配置-档案 未指定" }),
    ).toBeInTheDocument();
    // task-09：机器/智能体块已移除，控件条只剩两块
    expect(screen.queryByRole("button", { name: /^配置-机器/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^配置-智能体/ })).not.toBeInTheDocument();
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
  it("running：两控件全禁用 + 「本轮完成后解锁切换」(Lock 图标)提示，下拉不可开", () => {
    renderBar({ running: true });
    for (const name of [
      "配置-供应商 本机默认",
      "配置-档案 未指定",
    ]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    expect(screen.getByText("本轮完成后解锁切换")).toBeInTheDocument();
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
      screen.queryByText("本轮完成后解锁切换"),
    ).not.toBeInTheDocument();
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
    // ql-20260817-010：静默切换——prompt 空串（daemon 只 reload 不喂消息）；
    // task-10：切供应商同请求级联重置 model=""（候选随供应商变）。
    expect(mocks.injectSession).toHaveBeenCalledWith("sess-1", "", {
      llm_provider_id: "prov-glm",
      model: "",
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
      { llm_provider_id: SWITCH_NO_PROVIDER_VALUE, model: "" },
    );
    // 空串语义钉死：两键的 "" 都必须下发（task-16：llm_provider_id ""=切回本机
    // 默认；task-10：model ""=跟随供应商配置；undefined=不切换）
    const firstCall = mocks.injectSession.mock.calls.at(0);
    expect(firstCall?.[2]?.llm_provider_id).toBe("");
    expect(firstCall?.[2]?.model).toBe("");
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

// ── 4.5 task-10：供应商+模型级联（2026-08-29-usage-by-provider-model /
//        FR-03-2/3/5 / D-002@v1） ────────────────────────────────────────────

describe("SessionConfigBar 供应商+模型级联（task-10）", () => {
  /** 三来源齐备的供应商：model / default_fallback_model / role_mappings（含
   *  重复项与空串/缺键——用例据此断言去重保序 + 过滤）。 */
  const GLM_PROVIDER = {
    id: "prov-glm",
    name: "GLM 平台",
    model: "glm-4.7",
    default_fallback_model: "glm-4.6",
    model_role_mappings: {
      sonnet: { model: "glm-4.7" }, // 与 model 重复 → 去重
      opus: { model: "glm-4.5-air" },
      haiku: { model: "" }, // 空串 → 过滤
      fable: { display: "无模型角色" }, // 缺 model 键 → 过滤
    },
  };

  it("选中供应商 → 模型子下拉出现，候选 = 三来源去重保序 + 首项「默认」", async () => {
    mocks.listProviders.mockResolvedValue([GLM_PROVIDER] as never);
    renderBar({ llmProviderId: "prov-glm" });
    const select = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    // 首项固定「默认（跟随供应商配置）」value=""；随后 model → default_fallback
    // → role_mappings 按序去重（glm-4.7 重复只留一次；空串/缺键已过滤）。
    expect(values).toEqual(["", "glm-4.7", "glm-4.6", "glm-4.5-air"]);
    expect(select.options[0]?.textContent).toBe("默认（跟随供应商配置）");
    // 快照无 model → 当前值即「默认」首项
    expect(select.value).toBe("");
  });

  it("选模型 → injectSession 同请求带 llm_provider_id + model", async () => {
    mocks.listProviders.mockResolvedValue([GLM_PROVIDER] as never);
    renderBar({ llmProviderId: "prov-glm" });
    const select = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "glm-4.5-air" } });
    await waitFor(() => expect(mocks.injectSession).toHaveBeenCalledTimes(1));
    expect(mocks.injectSession).toHaveBeenCalledWith("sess-1", "", {
      llm_provider_id: "prov-glm",
      model: "glm-4.5-air",
    });
  });

  it("切回「默认」→ model 空串下发（当前值来自 config_snapshot.model）", async () => {
    mocks.listProviders.mockResolvedValue([GLM_PROVIDER] as never);
    renderBar({
      llmProviderId: "prov-glm",
      configSnapshot: {
        ...BASE_PROPS.configSnapshot,
        provider_name: "GLM 平台",
        model: "glm-4.6",
      },
    });
    const select = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    // 快照模型直显为当前选中项
    expect(select.value).toBe("glm-4.6");
    fireEvent.change(select, { target: { value: SWITCH_MODEL_DEFAULT_VALUE } });
    await waitFor(() => expect(mocks.injectSession).toHaveBeenCalledTimes(1));
    const call = mocks.injectSession.mock.calls.at(0);
    expect(call?.[2]?.llm_provider_id).toBe("prov-glm");
    expect(call?.[2]?.model).toBe("");
  });

  it("providerLocked（Codex）/「不指定」两态 → 模型子下拉不渲染", async () => {
    // 「不指定（本机默认）」：无具体供应商 → 隐藏
    renderBar({ llmProviderId: null });
    expect(
      screen.queryByRole("combobox", { name: "配置-模型" }),
    ).not.toBeInTheDocument();
    cleanup();
    // Codex 锁定：供应商+模型整块锁定（D-010），子下拉同锁不渲染
    mocks.listProviders.mockResolvedValue([GLM_PROVIDER] as never);
    renderBar({
      llmProviderId: "prov-glm",
      engine: "codex",
      configSnapshot: {
        machine_name: "machine-1",
        agent_name: "Codex",
        engine: "codex",
      },
    });
    expect(
      screen.queryByRole("combobox", { name: "配置-模型" }),
    ).not.toBeInTheDocument();
  });

  it("provisional：选模型不 inject 只暂存（专用回调收值）；切供应商级联重置暂存", async () => {
    mocks.listProviders.mockResolvedValue([GLM_PROVIDER] as never);
    const onProvisionalSwitch = vi.fn();
    const onProvisionalModelSwitch = vi.fn();
    renderBar({
      provisional: true,
      llmProviderId: "prov-glm",
      configSnapshot: null,
      onProvisionalSwitch,
      onProvisionalModelSwitch,
    });
    const select = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "glm-4.6" } });
    // 暂存不走 inject（无会话）；模型值走专用回调，绝不混进 onProvisionalSwitch
    expect(mocks.injectSession).not.toHaveBeenCalled();
    expect(onProvisionalModelSwitch).toHaveBeenCalledWith("glm-4.6");
    expect(onProvisionalSwitch).not.toHaveBeenCalled();
    expect(select.value).toBe("glm-4.6");

    // 切回「默认」→ 暂存重置回空串
    fireEvent.change(select, { target: { value: "" } });
    expect(onProvisionalModelSwitch).toHaveBeenLastCalledWith("");
    expect(select.value).toBe("");
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

  it("「不指定」→ agent_profile_id 空串取消档案回无人格（ql-20260818-004）", async () => {
    renderBar({ agentProfileId: "prof-1" });
    openCtrl("配置-档案");
    fireEvent.click(
      screen.getByRole("button", { name: "选择 不指定（无人格）" }),
    );
    await waitFor(() => expect(mocks.injectSession).toHaveBeenCalledTimes(1));
    // 空串语义："" 必须下发（取消档案），undefined=不切换
    const call = mocks.injectSession.mock.calls.at(0);
    expect(call?.[1]).toBe("");
    expect(call?.[2]?.agent_profile_id).toBe("");
  });

  it("Codex 引擎下档案选项标注「人格暂不支持」（D-013 不做引擎过滤）", () => {
    renderBar({ engine: "codex" });
    openCtrl("配置-档案");
    expect(screen.getByText("知识经理（人格暂不支持）")).toBeInTheDocument();
  });
});

// ── 5.5 task-10：共享智能体档案标识（2026-08-28-daemon-agent-share / FR-05 / D-004@v2；
//        机器共享徽标用例随 task-09 机器块移除而退役） ──

describe("SessionConfigBar 共享标识（task-10 / D-004@v2 仅展示）", () => {
  it("档案下拉：active 共享智能体档案带「共享」标识，普通档案无标识", async () => {
    mocks.profilesHook.mockReturnValue({
      profiles: [
        { id: "prof-1", name: "知识经理" },
        { id: "prof-shared", name: "平台源码助手" },
      ],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mocks.apiFetch.mockResolvedValue([
      {
        id: "grant-1",
        agent_profile_id: "prof-shared",
        display_name: "平台源码助手",
        provider: "claude",
        runtime_online: true,
      },
    ]);
    renderBar();
    openCtrl("配置-档案");
    // active 列表经 react-query 异步到达 → findBy 等待「共享」Tag 出现，
    // 且 Tag 落在共享档案行（按钮）内。
    const tag = await screen.findByText("共享");
    const sharedRow = tag.closest("button");
    expect(sharedRow).not.toBeNull();
    expect(sharedRow?.textContent).toContain("平台源码助手");
    // 普通档案行无共享标识。
    const normalRow = screen.getByRole("button", { name: "选择 知识经理" });
    expect(normalRow.textContent).not.toContain("共享");
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

  it("whoLine 按 run 快照渲染「档案 · 智能体 · 供应商」(BookUser/Cloud 图标)", () => {
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
    expect(who).toHaveTextContent("知识经理");
    expect(who).toHaveTextContent("Claude Code");
    expect(who).toHaveTextContent("GLM 平台");
  });

  it("profileName/providerName 为 null → 如实显示「未指定」/「本机默认」", () => {
    setupTimeline([
      makeTurn({
        whoLine: { profileName: null, agentName: "Codex", providerName: null },
      }),
    ]);
    const who = screen.getByLabelText("轮次配置快照");
    expect(who).toHaveTextContent("未指定");
    expect(who).toHaveTextContent("本机默认");
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
    // 既有渲染口径不受影响（task-13 冒烟断言）。task-03 antd 化后状态文本进
    // Badge status 的 text 节点，与「第 1 轮 ·」分属不同文本节点，分别断言。
    expect(screen.getByText("用户提问")).toBeInTheDocument();
    expect(screen.getByText("agent 答复")).toBeInTheDocument();
    expect(screen.getByText(/第 1 轮 ·/)).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });
});
