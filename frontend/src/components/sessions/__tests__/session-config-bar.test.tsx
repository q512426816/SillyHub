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
 *   2026-09-11-session-provider-switch-codex-pi task-07（FR-03 / D-002@v1）：
 *     codex/pi 随 task-05 白名单（PROVIDER_SWITCH_ENGINES）解锁——原 D-010
 *     「engine≠claude 锁供应商」三用例改写为门禁矩阵（claude/codex/pi 放行、
 *     cursor/未知引擎锁定 + title 引擎中性「当前引擎不支持会话级供应商切换」）；
 *     补供应商下拉 agent_kind 按引擎过滤用例（engine null 全量，「不指定（本机
 *     默认）」全引擎保留）；fixture 补 agent_kind（LlmProviderRead 恒有值，
 *     缺省会被 claude 会话的 kind 过滤滤掉——task-05 实测 :276/:334 红的根因）。
 *   2026-09-14-session-thinking-level task-06（FR-06 / Grill P0-2 / P2-11 / R-04）：
 *     思考档位下拉两态——预会话静态七档镜像（off 显示「默认」+语义差异 tooltip/
 *     选档 onProvisionalThinkingLevelSwitch 上抛/模型变级联重置发 ""）与会话态
 *     thinkingLevel prop 动态档位控件（GET 列表+current 现值/running 禁用/切换
 *     POST+成功通知+invalidate 重拉/失败 notify error 带 error 原文）。
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
  // 2026-09-14-session-thinking-level task-06：会话态档位两 API（GET 动态列表 /
  // POST 切换）——照 injectSession 局部 mock 形态。
  getSessionThinkingLevels: vi.fn(),
  setSessionThinkingLevel: vi.fn(),
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
// task-06（thinking-level）：组件新增消费 getSessionThinkingLevels /
// setSessionThinkingLevel，同文件局部 mock（类型导入编译期擦除不受影响）。
vi.mock("@/lib/daemon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/daemon")>();
  return {
    ...actual,
    injectSession: (...args: unknown[]) => mocks.injectSession(...args),
    getSessionThinkingLevels: (...args: unknown[]) =>
      mocks.getSessionThinkingLevels(...args),
    setSessionThinkingLevel: (...args: unknown[]) =>
      mocks.setSessionThinkingLevel(...args),
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
  // task-07：fixture 补 agent_kind（真实后端 LlmProviderRead 恒有该字段；缺省
  // 项会被 kind 过滤滤掉——默认两供应商按 BASE_PROPS 引擎语境给 claude kind）。
  mocks.listProviders.mockReset().mockResolvedValue([
    { id: "prov-kimi", name: "Kimi 中转", model: "kimi-k2", agent_kind: "claude" },
    { id: "prov-glm", name: "GLM 平台", model: "glm-4.7", agent_kind: "claude" },
  ]);
  mocks.injectSession.mockReset().mockResolvedValue(INJECT_RESPONSE);
  // task-06（thinking-level）：GET 默认五档+现值 medium（会话态用例按需覆盖）；
  // POST 默认受理 ok（未挂 thinkingLevel prop 的既有用例查询 disabled 不会触达）。
  mocks.getSessionThinkingLevels.mockReset().mockResolvedValue({
    levels: ["off", "low", "medium", "high", "max"],
    current: "medium",
  });
  mocks.setSessionThinkingLevel.mockReset().mockResolvedValue({ ok: true });
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

  // ql-20260909-005：禁用态 title 按原因说明（原恒静态说明，点了没反应零解释）。
  it("禁用态 title 说明原因：ended→已结束或机器离线；running→本轮后可切换；idle→原默认说明", () => {
    const { unmount: u1 } = renderBar({ ended: true });
    expect(
      screen.getByRole("button", { name: "配置-供应商 本机默认" }),
    ).toHaveAttribute("title", "会话已结束或机器离线，不可切换供应商");
    expect(
      screen.getByRole("button", { name: "配置-档案 未指定" }),
    ).toHaveAttribute("title", "会话已结束或机器离线，不可切换档案");
    u1();

    const { unmount: u2 } = renderBar({ running: true });
    expect(
      screen.getByRole("button", { name: "配置-供应商 本机默认" }),
    ).toHaveAttribute("title", "会话运行中，本轮结束后可切换供应商");
    u2();

    renderBar();
    expect(
      screen.getByRole("button", { name: "配置-供应商 本机默认" }),
    ).toHaveAttribute("title", "供应商（不选=本机默认配置）");
  });
  // ql-20260909-006：trailing 行尾插槽（会话面板挂 ctx 用量圆环）——
  // 传入渲染在配置条行最右；不传零占位。
  it("trailing 插槽：传入内容渲染在行尾（running 提示之右），不传零占位", () => {
    renderBar({
      running: true,
      trailing: <span data-testid="trailing-slot-content">用量 12%</span>,
    });
    const slot = screen.getByTestId("trailing-slot-content");
    expect(slot).toBeInTheDocument();
    // 与 running 解锁提示同行——共享同一行容器（flex 行）。
    expect(
      slot.closest("div")?.contains(screen.getByText("本轮完成后解锁切换")),
    ).toBe(true);

    cleanup();
    renderBar();
    expect(screen.queryByTestId("trailing-slot-content")).toBeNull();
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

  // task-07（2026-09-11-session-provider-switch-codex-pi / FR-03）：原「Codex 引擎
  // （engine≠claude）→ 供应商控件禁用（D-010）」随 task-05 白名单化解锁，改写为
  // 门禁矩阵——白名单外引擎只剩 cursor/未知。
  it("claude/codex/pi 引擎解锁：供应商控件可用 + 可选「不指定（本机默认）」（档案控件不受影响）", () => {
    for (const engine of ["claude", "codex", "pi"] as const) {
      cleanup();
      renderBar({
        engine,
        configSnapshot: {
          machine_name: "machine-1",
          agent_name: engine,
          engine,
        },
      });
      expect(
        (screen.getByRole("button", { name: "配置-供应商 本机默认" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      expect(
        (screen.getByRole("button", { name: "配置-档案 未指定" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      // 解锁即可开下拉，「不指定（本机默认）」项全引擎保留（D-002）
      openCtrl("配置-供应商");
      expect(
        screen.getByRole("button", { name: "选择 不指定（本机默认）" }),
      ).toBeInTheDocument();
    }
  });

  it("cursor/未知引擎锁定：供应商控件禁用 + title 引擎中性「当前引擎不支持会话级供应商切换」（档案控件不受影响）", () => {
    for (const engine of ["cursor", "future-engine"] as const) {
      cleanup();
      renderBar({
        engine,
        configSnapshot: {
          machine_name: "machine-1",
          agent_name: engine,
          engine,
        },
      });
      const providerCtrl = screen.getByRole("button", {
        name: "配置-供应商 本机默认",
      });
      expect((providerCtrl as HTMLButtonElement).disabled).toBe(true);
      expect(providerCtrl).toHaveAttribute(
        "title",
        "当前引擎不支持会话级供应商切换",
      );
      expect(
        (screen.getByRole("button", { name: "配置-档案 未指定" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    }
  });

  it("切换失败 → message.error（点选即切换无确认行，可再点重试）", async () => {
    mocks.injectSession.mockRejectedValueOnce(new Error("daemon 离线"));
    renderBar();
    openCtrl("配置-供应商");
    fireEvent.click(await screen.findByRole("button", { name: "选择 Kimi 中转" }));
    await waitFor(() => expect(mocks.messageError).toHaveBeenCalled());
  });
});

// ── 4.1 task-07：供应商下拉 agent_kind 按引擎过滤（FR-03 / D-002@v1） ─────

describe("SessionConfigBar 供应商下拉 kind 过滤（task-07 / FR-03 / D-002@v1）", () => {
  /** 三 kind 混合列表——断言各引擎只列同 kind 项 + 「不指定（本机默认）」保留。 */
  const MIXED_PROVIDERS = [
    { id: "prov-kimi", name: "Kimi 中转", model: "kimi-k2", agent_kind: "claude" },
    { id: "prov-glm", name: "GLM 平台", model: "glm-4.7", agent_kind: "claude" },
    { id: "prov-codex-1", name: "Codex 专供", model: "gpt-5.2", agent_kind: "codex" },
    { id: "prov-pi-1", name: "Pi 专供", model: "glm-4.7-air", agent_kind: "pi" },
  ];

  /** 按引擎渲染并打开供应商下拉（engine null = provisional 悬浮助手形态）。 */
  function renderWithEngine(engine: string | null) {
    if (engine == null) {
      renderBar({ engine: null, configSnapshot: null });
    } else {
      renderBar({
        engine,
        configSnapshot: { machine_name: "machine-1", agent_name: engine, engine },
      });
    }
    openCtrl("配置-供应商");
  }

  it("codex 会话只列 agent_kind=codex 供应商（混入 claude/pi kind 项不出现）+「不指定（本机默认）」保留", async () => {
    mocks.listProviders.mockResolvedValue(MIXED_PROVIDERS as never);
    renderWithEngine("codex");
    expect(
      await screen.findByRole("button", { name: "选择 Codex 专供" }),
    ).toBeInTheDocument();
    for (const absent of [
      "选择 Kimi 中转",
      "选择 GLM 平台",
      "选择 Pi 专供",
    ]) {
      expect(screen.queryByRole("button", { name: absent })).not.toBeInTheDocument();
    }
    // 「不指定（本机默认）」全引擎保留（D-002）
    expect(
      screen.getByRole("button", { name: "选择 不指定（本机默认）" }),
    ).toBeInTheDocument();
  });

  it("claude 会话只列 claude kind；pi 会话只列 pi kind（各自保留「不指定」）", async () => {
    mocks.listProviders.mockResolvedValue(MIXED_PROVIDERS as never);
    renderWithEngine("claude");
    expect(
      await screen.findByRole("button", { name: "选择 Kimi 中转" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "选择 GLM 平台" }),
    ).toBeInTheDocument();
    for (const absent of ["选择 Codex 专供", "选择 Pi 专供"]) {
      expect(screen.queryByRole("button", { name: absent })).not.toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: "选择 不指定（本机默认）" }),
    ).toBeInTheDocument();

    cleanup();
    mocks.listProviders.mockResolvedValue(MIXED_PROVIDERS as never);
    renderWithEngine("pi");
    expect(
      await screen.findByRole("button", { name: "选择 Pi 专供" }),
    ).toBeInTheDocument();
    for (const absent of [
      "选择 Kimi 中转",
      "选择 GLM 平台",
      "选择 Codex 专供",
    ]) {
      expect(screen.queryByRole("button", { name: absent })).not.toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: "选择 不指定（本机默认）" }),
    ).toBeInTheDocument();
  });

  it("engine null（provisional 悬浮助手）→ 全量列出（创建时才定引擎）", async () => {
    mocks.listProviders.mockResolvedValue(MIXED_PROVIDERS as never);
    renderWithEngine(null);
    for (const label of [
      "选择 Kimi 中转",
      "选择 GLM 平台",
      "选择 Codex 专供",
      "选择 Pi 专供",
    ]) {
      expect(await screen.findByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: "选择 不指定（本机默认）" }),
    ).toBeInTheDocument();
  });
});

// ── 4.2 ql-20260904-010：外部信号打开供应商下拉（运行失败卡「切换供应商」
//      定位本配置条） ─────────────────────────────────────────────────────────

describe("SessionConfigBar providerOpenSignal（ql-20260904-010）", () => {
  /** rerender 需复用同一 QueryClientProvider（renderBar 不暴露 rerender）。 */
  function renderSignalBar(initial: Record<string, unknown> = {}) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, refetchInterval: false },
        mutations: { retry: false },
      },
    });
    const props = () => ({ ...BASE_PROPS, ...initial }) as any;
    const utils = render(
      <QueryClientProvider client={client}>
        <SessionConfigBar {...props()} />
      </QueryClientProvider>,
    );
    return {
      ...utils,
      rerenderWith: (over: Record<string, unknown>) =>
        utils.rerender(
          <QueryClientProvider client={client}>
            <SessionConfigBar {...({ ...BASE_PROPS, ...initial, ...over } as any)} />
          </QueryClientProvider>,
        ),
    };
  }

  it("signal 递增 → 打开供应商下拉（config-dd-provider 出现）", async () => {
    const { rerenderWith } = renderSignalBar({ providerOpenSignal: 0 });
    expect(screen.queryByTestId("config-dd-provider")).not.toBeInTheDocument();
    rerenderWith({ providerOpenSignal: 1 });
    expect(await screen.findByTestId("config-dd-provider")).toBeInTheDocument();
    // 下拉标题即「切换供应商 · 只影响本会话」——定位语义直接可见
    expect(screen.getByText("切换供应商 · 只影响本会话")).toBeInTheDocument();
  });

  it("挂载即 signal>0 → 直接打开（无需先渲染 0）", () => {
    renderSignalBar({ providerOpenSignal: 1 });
    expect(screen.getByTestId("config-dd-provider")).toBeInTheDocument();
  });

  it("signal 不变（其它 props 变化重渲染）→ 不重复动作，已开下拉保持", () => {
    const { rerenderWith } = renderSignalBar({ providerOpenSignal: 1 });
    expect(screen.getByTestId("config-dd-provider")).toBeInTheDocument();
    rerenderWith({ llmProviderId: "prov-kimi" });
    // 下拉仍开（未被重置）；档案下拉未开
    expect(screen.getByTestId("config-dd-provider")).toBeInTheDocument();
    expect(screen.queryByTestId("config-dd-profile")).not.toBeInTheDocument();
  });

  it("running 锁定 → 信号被吞不开下拉；解锁后不凭旧信号重放", () => {
    const { rerenderWith } = renderSignalBar({
      running: true,
      providerOpenSignal: 1,
    });
    expect(screen.queryByTestId("config-dd-provider")).not.toBeInTheDocument();
    rerenderWith({ running: false });
    expect(screen.queryByTestId("config-dd-provider")).not.toBeInTheDocument();
  });

  // task-07：codex 解锁——错误卡信号照常开下拉；锁定负例换 cursor（白名单外）。
  it("codex 引擎解锁 → 信号打开供应商下拉（config-dd-provider 出现）", () => {
    renderSignalBar({
      engine: "codex",
      providerOpenSignal: 1,
      configSnapshot: {
        machine_name: "machine-1",
        agent_name: "Codex",
        engine: "codex",
      },
    });
    expect(screen.getByTestId("config-dd-provider")).toBeInTheDocument();
  });

  it("cursor 引擎锁定 → 信号被吞不开下拉（白名单外负例承接）", () => {
    renderSignalBar({
      engine: "cursor",
      providerOpenSignal: 1,
      configSnapshot: {
        machine_name: "machine-1",
        agent_name: "Cursor",
        engine: "cursor",
      },
    });
    expect(screen.queryByTestId("config-dd-provider")).not.toBeInTheDocument();
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
    // task-07：kind 字段补齐（本组用例默认 claude 引擎语境；codex 分支内覆盖）。
    agent_kind: "claude",
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

  // task-07 语义翻转：原 Codex 锁定分支（D-010）改为 codex 解锁后选中供应商即
  // 渲染子下拉；「不指定」隐藏分支保留；锁定负例换 cursor，并等供应商列表到达
  // 再断言（原同步断言在 react-query resolve 前执行，碰巧空洞绿）。
  it("「不指定」/cursor 锁定两态隐藏模型子下拉；codex 解锁选中供应商后渲染", async () => {
    // 「不指定（本机默认）」：无具体供应商 → 隐藏
    renderBar({ llmProviderId: null });
    expect(
      screen.queryByRole("combobox", { name: "配置-模型" }),
    ).not.toBeInTheDocument();
    cleanup();
    // codex 解锁：选中供应商 → 模型子下拉渲染（与 claude 同构，级联候选不变）
    mocks.listProviders.mockResolvedValue([
      { ...GLM_PROVIDER, agent_kind: "codex" },
    ] as never);
    renderBar({
      llmProviderId: "prov-glm",
      engine: "codex",
      configSnapshot: {
        machine_name: "machine-1",
        agent_name: "Codex",
        engine: "codex",
      },
    });
    const select = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    // 候选照常三来源去重保序（首项「默认」）
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", "glm-4.7", "glm-4.6", "glm-4.5-air"]);
    cleanup();
    // cursor 锁定：供应商+模型整块锁定，子下拉同锁不渲染（白名单外负例承接）
    mocks.listProviders.mockResolvedValue([GLM_PROVIDER] as never);
    renderBar({
      llmProviderId: "prov-glm",
      engine: "cursor",
      configSnapshot: {
        machine_name: "machine-1",
        agent_name: "Cursor",
        engine: "cursor",
      },
    });
    // 等供应商名解析（列表已 resolve）后再断言，杜绝碰巧空洞绿
    expect(
      await screen.findByRole("button", { name: "配置-供应商 GLM 平台" }),
    ).toBeInTheDocument();
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
    // 既有渲染口径不受影响（task-13 冒烟断言）。2026-09-09-sessions-visual-
    // refresh task-06：对话视图轮尾改 RoundDivider 胶囊（label/状态分节点）。
    expect(screen.getByText("用户提问")).toBeInTheDocument();
    expect(screen.getByText("agent 答复")).toBeInTheDocument();
    expect(screen.getByText("第 1 轮")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });
});


// ── 2026-09-10-auto-resume-interrupted-turn / FR-06：中断自动续跑开关 ──────────

describe("SessionConfigBar 中断自动续跑开关（autoResume 可选控件）", () => {
  it("不传 autoResume 不渲染（存量调用方零回归）", () => {
    renderBar();
    expect(screen.queryByTestId("config-auto-resume-switch")).toBeNull();
  });

  it("传入渲染开关：默认开 + 点击触发 onToggle(false) + 禁用态不可点", async () => {
    const onToggle = vi.fn();
    const { rerender } = renderBar({ autoResume: { enabled: true, onToggle } });
    const sw = screen.getByTestId("config-auto-resume-switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith(false);
    });

    // 关态回显。
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SessionConfigBar
          {...({ ...BASE_PROPS, autoResume: { enabled: false, onToggle } } as any)}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("config-auto-resume-switch").getAttribute("aria-checked")).toBe(
      "false",
    );

    // 禁用态：点击不触发。
    const onToggle2 = vi.fn();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SessionConfigBar
          {...({
            ...BASE_PROPS,
            autoResume: { enabled: true, disabled: true, onToggle: onToggle2 },
          } as any)}
        />
      </QueryClientProvider>,
    );
    const disabledSw = screen.getByTestId("config-auto-resume-switch");
    expect(disabledSw.classList.contains("ant-switch-disabled")).toBe(true);
    fireEvent.click(disabledSw);
    expect(onToggle2).not.toHaveBeenCalled();
  });
});

// ── 7. 2026-09-14-session-thinking-level task-06：思考档位下拉（FR-06 /
//        Grill P0-2 静态七档镜像 / P2-11 off 语义差异 tooltip） ────────────────

describe("SessionConfigBar 思考档位下拉（task-06 / FR-06）", () => {
  it("caps.thinking_level=false（cursor/未知引擎）→ 预会话与会话态均不渲染档位下拉", () => {
    // 预会话态：静态镜像下拉不渲染（caps 门控在组件内，未知引擎默认拒绝）。
    for (const engine of ["cursor", "future-engine"] as const) {
      cleanup();
      renderBar({
        provisional: true,
        engine,
        configSnapshot: null,
      });
      expect(
        screen.queryByTestId("config-thinking-select"),
      ).not.toBeInTheDocument();
    }
    // 会话态：thinkingLevel prop 挂载（甚至显式传入）同样被 caps 门控拦下。
    cleanup();
    renderBar({
      engine: "cursor",
      configSnapshot: {
        machine_name: "machine-1",
        agent_name: "Cursor",
        engine: "cursor",
      },
      thinkingLevel: {},
    });
    expect(
      screen.queryByTestId("config-thinking-select"),
    ).not.toBeInTheDocument();
  });

  it("预会话：静态七档镜像渲染（off→max 逐项一致），off 显示「默认」带跨引擎语义差异 tooltip（P2-11）", () => {
    renderBar({ provisional: true, configSnapshot: null });
    const select = screen.getByTestId(
      "config-thinking-select",
    ) as HTMLSelectElement;
    // 七档镜像：与 daemon THINKING_LEVELS 单源逐项一致（含顺序，约束注释互指）。
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    // off 显示「默认」；tooltip 说明跨引擎语义差异（claude/codex=引擎默认思考
    // 通常开 ≠ pi=真关思考）。
    const offOption = select.options.item(0);
    expect(offOption?.textContent).toBe("默认");
    expect(offOption?.title).toContain("claude/codex=不设置档位");
    expect(offOption?.title).toContain("pi=真正关闭思考");
    // 未选择态显示归位「默认」（""=清空不随首句上送，与显式选 off 显示同形）。
    expect(select.value).toBe("off");
    // 其余档位中文标签可读（未知值兜底显原值不编造）。
    expect(select.options.item(6)?.textContent).toBe("最高");
  });

  it("预会话选档 → onProvisionalThinkingLevelSwitch 上抛档位值（不 inject，显式选「默认」=off 也上抛）", () => {
    const onLevel = vi.fn();
    renderBar({
      provisional: true,
      configSnapshot: null,
      onProvisionalThinkingLevelSwitch: onLevel,
    });
    const select = screen.getByTestId(
      "config-thinking-select",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "high" } });
    expect(onLevel).toHaveBeenCalledWith("high");
    expect(select.value).toBe("high");
    // 暂存不走 inject（无会话——preModelId 同款专用回调收值）。
    expect(mocks.injectSession).not.toHaveBeenCalled();
    // 显式选「默认」= off 也上抛（首句携带 off，daemon 按引擎映射）。
    fireEvent.change(select, { target: { value: "off" } });
    expect(onLevel).toHaveBeenLastCalledWith("off");
  });

  it("模型变更 → 档位级联重置（照「切供应商重置模型」模式）：清空选择发 \"\"，显示归位「默认」", async () => {
    const onLevel = vi.fn();
    const onModel = vi.fn();
    renderBar({
      provisional: true,
      configSnapshot: null,
      llmProviderId: "prov-kimi",
      onProvisionalModelSwitch: onModel,
      onProvisionalThinkingLevelSwitch: onLevel,
    });
    const level = screen.getByTestId(
      "config-thinking-select",
    ) as HTMLSelectElement;
    fireEvent.change(level, { target: { value: "max" } });
    expect(onLevel).toHaveBeenLastCalledWith("max");
    // 模型子下拉（供应商已选 prov-kimi → 候选 kimi-k2）变更触发级联重置。
    const model = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    fireEvent.change(model, { target: { value: "kimi-k2" } });
    expect(onModel).toHaveBeenCalledWith("kimi-k2");
    // 档位仅清自身选择（不动模型/provider 既有级联链）：回调收 ""，显示归位「默认」。
    expect(onLevel).toHaveBeenLastCalledWith("");
    expect(level.value).toBe("off");
    expect(level.options.item(0)?.textContent).toBe("默认");
  });
});

// ── 8. 2026-09-14-session-thinking-level task-06：会话态档位切换控件
//        （thinkingLevel prop / FR-06 / R-04 查询刷新） ────────────────────────

describe("SessionConfigBar 会话态档位切换控件（task-06 / FR-06 / R-04）", () => {
  it("不传 thinkingLevel prop（存量/预会话渲染点）→ 会话态控件不渲染（引擎有能力也不渲染）", () => {
    renderBar();
    expect(screen.queryByTestId("config-thinking-select")).not.toBeInTheDocument();
    // 预会话态走静态七档镜像（上一 describe），与本控件互斥。
    cleanup();
    renderBar({ provisional: true, configSnapshot: null });
    expect(screen.getByTestId("config-thinking-select")).toBeInTheDocument();
  });

  it("GET 动态档位渲染 + current 现值选中显示", async () => {
    renderBar({ thinkingLevel: {} });
    expect(mocks.getSessionThinkingLevels).toHaveBeenCalledWith("sess-1");
    const select = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).map((o) => o.value)).toEqual([
        "off",
        "low",
        "medium",
        "high",
        "max",
      ]);
    });
    // current=medium → 现值直显为选中项。
    expect(select.value).toBe("medium");
    expect(select.options.item(2)?.textContent).toBe("中");
  });

  it("current=null（claude SDK 不暴露现值）→「现值未知」占位项如实显示，不编造", async () => {
    mocks.getSessionThinkingLevels.mockResolvedValue({
      levels: ["off", "low", "high"],
      current: null,
    });
    renderBar({ thinkingLevel: {} });
    const select = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLSelectElement;
    await waitFor(() =>
      expect(screen.getByText("现值未知（引擎未上报）")).toBeInTheDocument(),
    );
    expect(select.value).toBe("");
  });

  it("turn running（thinkingLevel.disabled）→ 下拉禁用（档位切换仅空闲，D-002）", () => {
    renderBar({ thinkingLevel: { disabled: true } });
    expect(
      (screen.getByTestId("config-thinking-select") as HTMLSelectElement)
        .disabled,
    ).toBe(true);
  });

  it("点选即切换：setSessionThinkingLevel 调用 + 成功通知「已切换思考级别：X」+ invalidate 重拉档位（R-04）", async () => {
    renderBar({ thinkingLevel: {} });
    const select = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("medium"));
    fireEvent.change(select, { target: { value: "high" } });
    await waitFor(() =>
      expect(mocks.setSessionThinkingLevel).toHaveBeenCalledWith("sess-1", "high"),
    );
    await waitFor(() =>
      expect(mocks.messageSuccess).toHaveBeenCalledWith("已切换思考级别：高"),
    );
    // R-04：pi thinking_level_change 事件不透传——成功后 invalidate 档位查询重拉
    //（首拉 1 次 + 刷新 1 次）。
    await waitFor(() =>
      expect(mocks.getSessionThinkingLevels).toHaveBeenCalledTimes(2),
    );
  });

  it("200 结构化失败（ok=false + error）→ notify error 带 error 原文（如旧 daemon 升级提示）", async () => {
    mocks.setSessionThinkingLevel.mockResolvedValue({
      ok: false,
      error: "daemon 未支持思考级别，请升级 daemon",
    });
    renderBar({ thinkingLevel: {} });
    const select = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("medium"));
    fireEvent.change(select, { target: { value: "low" } });
    // notify.error(err, fallback) → message.error(errMessage(err)) → error 原文直出。
    await waitFor(() =>
      expect(mocks.messageError).toHaveBeenCalledWith(
        "daemon 未支持思考级别，请升级 daemon",
      ),
    );
    expect(mocks.messageSuccess).not.toHaveBeenCalled();
    // 失败不 invalidate（现值未变，无需刷新）。
    expect(mocks.getSessionThinkingLevels).toHaveBeenCalledTimes(1);
  });

  it("ApiError 抛出（4xx/5xx）→ notify error 带异常文案", async () => {
    mocks.setSessionThinkingLevel.mockRejectedValue(
      new Error("会话运行中，本轮结束后可切换"),
    );
    renderBar({ thinkingLevel: {} });
    const select = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("medium"));
    fireEvent.change(select, { target: { value: "low" } });
    await waitFor(() =>
      expect(mocks.messageError).toHaveBeenCalledWith(
        "会话运行中，本轮结束后可切换",
      ),
    );
  });
});
