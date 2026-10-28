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
 *   ql-20260922-001：思考档位控件 antd Dropdown 化（原生 select → 胶囊按钮 +
 *     antd 菜单）——第 7/8 节断言由 select.options/select.value/fireEvent.change
 *     改为点触发器开菜单 → menuitem 点击，现值经触发器文本直显断言（照
 *     page.m-change-detail antd Dropdown 测试先例）。
 *
 * mock 策略（对齐 new-session-form.test.tsx）：直接 mock 组件消费的 hook/函数模块
 * （useMineAgentProfiles / listProviders / injectSession），
 * @/lib/api 保留真实（ApiError instanceof 用）；antd message 局部 mock 便于断言 toast。
 *
 * jsdom 坑：TurnTimeline 的 MarkdownText 用 next/dynamic ssr:false，jsdom 同步 render
 * 得 null → mock 成纯文本渲染（与 turn-timeline-session-input-bar.test.tsx 一致）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
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
  // 2026-10-21-session-git-branch：分支指示项 GET。
  fetchSessionGitStatus: vi.fn(),
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

vi.mock("@/lib/api/llm-providers", async (importOriginal) => {
  // 2026-10-21-provider-default-ui-hint：noProviderLabel 走真实实现（纯函数），
  // listProviders 维持可控 mock。
  const actual =
    await importOriginal<typeof import("@/lib/api/llm-providers")>();
  return {
    ...actual,
    listProviders: (...args: unknown[]) => mocks.listProviders(...args),
  };
});

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
    // 2026-10-21-session-git-branch：分支指示项取数（照 injectSession 局部 mock）。
    fetchSessionGitStatus: (...args: unknown[]) =>
      mocks.fetchSessionGitStatus(...args),
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
  // 2026-10-21-session-git-branch：返回 client 供轮询配置断言（query options
  // 的 refetchInterval 直读，替代 fake timers 推进 60s 的脆弱写法）。
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <SessionConfigBar {...({ ...BASE_PROPS, ...overrides } as any)} />
      </QueryClientProvider>,
    ),
  };
}

/**
 * 2026-10-25-session-config-deferred-switch：受控暂存挂载——Harness 内部持
 * staged state（与面板 session-panel-page.handleStagedSwitch 同款合并/取消
 * 逻辑），点选上抛 → 合并 → 回传 staged，串起「暂存→受控显示」完整闭环。
 * 同时记录收到的全部 patch 供断言。
 */
function renderBarControlled(overrides: Record<string, unknown> = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  const patches: unknown[] = [];
  function Harness() {
    const [staged, setStaged] = useState<Record<string, string>>({});
    return (
      <QueryClientProvider client={client}>
        <SessionConfigBar
          {...({ ...BASE_PROPS, ...overrides, staged } as any)}
          onStagedSwitch={(patch: any) => {
            patches.push(patch);
            setStaged((prev) => {
              const next = { ...prev };
              if (patch.cancel) delete next[patch.field];
              else next[patch.field] = patch.value;
              return next;
            });
          }}
        />
      </QueryClientProvider>
    );
  }
  return { patches, ...render(<Harness />) };
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
    { id: "prov-kimi", name: "Kimi 中转", models: [{ name: "kimi-k2", roles: ["sonnet"] }], agent_kinds: ["claude"] },
    { id: "prov-glm", name: "GLM 平台", models: [{ name: "glm-4.7", roles: ["sonnet"] }], agent_kinds: ["claude"] },
  ]);
  mocks.injectSession.mockReset().mockResolvedValue(INJECT_RESPONSE);
  // task-06（thinking-level）：GET 默认五档+现值 medium（会话态用例按需覆盖）；
  // POST 默认受理 ok（未挂 thinkingLevel prop 的既有用例查询 disabled 不会触达）。
  mocks.getSessionThinkingLevels.mockReset().mockResolvedValue({
    levels: ["off", "low", "medium", "high", "max"],
    current: "medium",
  });
  mocks.setSessionThinkingLevel.mockReset().mockResolvedValue({ ok: true });
  // 2026-10-21-session-git-branch：默认正常 git 态（feature-x 分支）——既有
  // 用例不感知指示项；空态/失败态由本变更新增用例覆盖。root_source 缺省
  // cwd（2026-10-25-session-git-worktree-root 加字段，工作树形态另有用例）。
  mocks.fetchSessionGitStatus.mockReset().mockResolvedValue({
    git_mode: "git",
    root: "C:\\repo",
    root_source: "cwd",
    branch: "feature-x",
    detached: false,
    head_short: "1a2b3c4d",
    files_changed: 2,
    untracked_count: 1,
    synced_at: "2026-10-21T12:00:00Z",
  });
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

// ── 2. running / ended 置灰（FR-05；ql-20260917-008 起 running 放开） ──────

describe("SessionConfigBar 状态置灰", () => {
  it("running：两控件可点（受理即排队，本轮结束后生效），下拉可开", () => {
    renderBar({ running: true });
    for (const name of [
      "配置-供应商 本机默认",
      "配置-档案 未指定",
    ]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(false);
    }
    // 2026-10-22-session-composer-slim FR-02：运行中提示行移出配置条
    //（生效时机保留在各控件 title），释放行宽。
    expect(screen.queryByText("运行中切换将于本轮结束后生效")).not.toBeInTheDocument();
    // ql-20260917-008：运行中点开下拉可正常选择（请求落忙轮排队）
    fireEvent.click(screen.getByRole("button", { name: "配置-供应商 本机默认" }));
    expect(screen.getByTestId("config-dd-provider")).toBeInTheDocument();
  });

  it("ended：全部禁用且无运行中提示（只读浏览）", () => {
    renderBar({ ended: true });
    expect(
      (screen.getByRole("button", { name: "配置-供应商 本机默认" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.queryByText("运行中切换将于本轮结束后生效"),
    ).not.toBeInTheDocument();
  });

  // ql-20260909-005：禁用态 title 按原因说明（原恒静态说明，点了没反应零解释）。
  // ql-20260917-008：running title 改「可切换，本轮结束后生效」（控件不再禁用）。
  it("title 说明：ended→已结束或机器离线；running→可切换本轮后生效；idle→原默认说明", () => {
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
    ).toHaveAttribute("title", "运行中可切换，将于本轮结束后生效");
    u2();

    renderBar();
    expect(
      screen.getByRole("button", { name: "配置-供应商 本机默认" }),
    ).toHaveAttribute("title", "供应商（不选=本机默认配置）");
  });
  // ql-20260909-006：trailing 行尾插槽（会话面板挂 ctx 用量圆环）——
  // 传入渲染在配置条行最右；不传零占位。
  it("trailing 插槽：传入内容渲染在配置条行尾，不传零占位", () => {
    renderBar({
      running: true,
      trailing: <span data-testid="trailing-slot-content">用量 12%</span>,
    });
    const slot = screen.getByTestId("trailing-slot-content");
    expect(slot).toBeInTheDocument();
    // 与配置控件同行——共享同一行容器（flex 行）。
    expect(
      slot.closest('[aria-label="会话配置控件条"]'),
    ).not.toBeNull();

    cleanup();
    renderBar();
    expect(screen.queryByTestId("trailing-slot-content")).toBeNull();
  });
});

// ── 4. 供应商切换（含「不指定」空串语义，task-16 契约） ───────────────────

describe("SessionConfigBar 切换供应商", () => {
  // 2026-10-25-session-config-deferred-switch（D-001）：暂存模式下 idle 点选仅
  // 上抛暂存（不发请求、不产生空切换轮、无 toast），随下一条消息生效。
  it("暂存模式 idle 选择供应商 → onStagedSwitch 上抛（含级联 model 重置）不 inject 无 toast，控件显示暂存值", async () => {
    const { patches } = renderBarControlled({ llmProviderId: "prov-kimi" });
    openCtrl("配置-供应商");
    fireEvent.click(await screen.findByRole("button", { name: "选择 GLM 平台" }));

    // 不发请求（不产生空切换轮）、不弹 toast（D-001 静默）
    expect(mocks.injectSession).not.toHaveBeenCalled();
    expect(mocks.messageSuccess).not.toHaveBeenCalled();
    // 级联：切供应商同时重置模型暂存（""=跟随供应商配置，对齐 provisional 先例）
    expect(patches[0]).toEqual({
      field: "model",
      value: SWITCH_MODEL_DEFAULT_VALUE,
      label: "默认",
      cancel: undefined,
    });
    expect(patches[1]).toEqual({
      field: "llm_provider_id",
      value: "prov-glm",
      label: "GLM 平台",
      cancel: undefined,
    });
    // 控件直接显示暂存值（受控闭环；无待生效标记，D-001）
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "配置-供应商 GLM 平台" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("config-staged-dot")).not.toBeInTheDocument();
  });

  it("暂存模式「不指定（本机默认）」→ llm_provider_id 空串 \"\" 暂存上抛（cancel 未触发）", async () => {
    const onStagedSwitch = vi.fn();
    renderBar({ llmProviderId: "prov-kimi", onStagedSwitch });
    openCtrl("配置-供应商");
    fireEvent.click(
      await screen.findByRole("button", { name: "选择 不指定（本机默认）" }),
    );
    expect(mocks.injectSession).not.toHaveBeenCalled();
    expect(onStagedSwitch).toHaveBeenCalledWith({
      field: "llm_provider_id",
      value: SWITCH_NO_PROVIDER_VALUE,
      label: "不指定（本机默认）",
      cancel: undefined,
    });
  });

  it("暂存模式选回当前生效供应商 → cancel=true 取消暂存（不级联重置模型）", async () => {
    const onStagedSwitch = vi.fn();
    renderBar({ llmProviderId: "prov-kimi", onStagedSwitch });
    openCtrl("配置-供应商");
    fireEvent.click(
      await screen.findByRole("button", { name: "选择 Kimi 中转" }),
    );
    expect(mocks.injectSession).not.toHaveBeenCalled();
    expect(onStagedSwitch).toHaveBeenCalledWith({
      field: "llm_provider_id",
      value: "prov-kimi",
      label: "Kimi 中转",
      cancel: true,
    });
    // 选回当前值不是切换动作，不级联重置模型暂存
    expect(onStagedSwitch).toHaveBeenCalledTimes(1);
  });

  // 兼容锚：未挂 onStagedSwitch（存量调用面）保持点选即切换旧行为。
  it("未传 onStagedSwitch（兼容）→ idle 点选即静默切换 injectSession 参数正确 + 成功 toast", async () => {
    renderBar({ llmProviderId: "prov-kimi" });
    openCtrl("配置-供应商");
    fireEvent.click(await screen.findByRole("button", { name: "选择 GLM 平台" }));

    await waitFor(() => expect(mocks.injectSession).toHaveBeenCalledTimes(1));
    // ql-20260817-010：静默切换——prompt 空串；task-10：切供应商同请求级联重置 model=""。
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

  it("切换失败 → message.error（仅兼容路径未传 onStagedSwitch；暂存模式无请求无失败）", async () => {
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
    { id: "prov-kimi", name: "Kimi 中转", models: [{ name: "kimi-k2", roles: ["sonnet"] }], agent_kinds: ["claude"] },
    { id: "prov-glm", name: "GLM 平台", models: [{ name: "glm-4.7", roles: ["sonnet"] }], agent_kinds: ["claude"] },
    { id: "prov-codex-1", name: "Codex 专供", models: [{ name: "gpt-5.2", roles: ["sonnet"] }], agent_kinds: ["codex"] },
    { id: "prov-pi-1", name: "Pi 专供", models: [{ name: "glm-4.7-air", roles: ["sonnet"] }], agent_kinds: ["pi"] },
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

  it("running → 信号打开下拉（ql-20260917-008 运行中放开）；ended 才吞信号，解锁后不凭旧信号重放", () => {
    const { rerenderWith } = renderSignalBar({
      running: true,
      providerOpenSignal: 1,
    });
    // 运行中不再锁定——信号照常开下拉
    expect(screen.getByTestId("config-dd-provider")).toBeInTheDocument();
    rerenderWith({ running: false });
    expect(screen.getByTestId("config-dd-provider")).toBeInTheDocument();

    cleanup();
    // ended 吞信号；会话重开（新实例 ended=false）不凭旧信号重放
    const { rerenderWith: rerender2 } = renderSignalBar({
      ended: true,
      providerOpenSignal: 1,
    });
    expect(screen.queryByTestId("config-dd-provider")).not.toBeInTheDocument();
    rerender2({ ended: false });
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
    models: [
      { name: "glm-4.7", roles: ["sonnet"] },
      { name: "glm-4.6", roles: [] },
      { name: "glm-4.5-air", roles: [] },
    ],
    // task-07：kind 字段补齐（本组用例默认 claude 引擎语境；codex 分支内覆盖）。
    agent_kinds: ["claude"],
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
    expect(values).toEqual(["", "glm-4.7", "glm-4.6", "glm-4.5-air"]);  // D-001：主模型置顶后全部条目
    expect(select.options[0]?.textContent).toBe("默认（跟随供应商配置）");
    // 快照无 model → 当前值即「默认」首项
    expect(select.value).toBe("");
  });

  it("暂存模式选模型 → onStagedSwitch 上抛 model（不 inject），控件显示暂存模型", async () => {
    mocks.listProviders.mockResolvedValue([GLM_PROVIDER] as never);
    const { patches } = renderBarControlled({ llmProviderId: "prov-glm" });
    const select = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "glm-4.5-air" } });
    expect(mocks.injectSession).not.toHaveBeenCalled();
    expect(patches[0]).toEqual({
      field: "model",
      value: "glm-4.5-air",
      label: "glm-4.5-air",
      cancel: undefined,
    });
    // 控件直接显示暂存值（受控闭环），快照原值被覆盖
    await waitFor(() => expect(select.value).toBe("glm-4.5-air"));
  });

  // 2026-10-26-config-staged-all-states FR-02：模型子下拉显示与候选跟随暂存供应商
  //（会话真值无供应商时模型下拉隐藏，暂存供应商后必须立即出现且候选正确）。
  it("暂存供应商后模型下拉立即显示，候选=暂存供应商模型；取消暂存回退真值隐藏", async () => {
    mocks.listProviders.mockResolvedValue([GLM_PROVIDER] as never);
    // 真值无供应商 → 初始模型下拉隐藏
    const { patches } = renderBarControlled({ llmProviderId: null });
    expect(
      screen.queryByRole("combobox", { name: "配置-模型" }),
    ).not.toBeInTheDocument();
    // 暂存供应商 → 模型下拉立即出现，候选 = GLM 三模型
    openCtrl("配置-供应商");
    fireEvent.click(await screen.findByRole("button", { name: "选择 GLM 平台" }));
    const select = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", "glm-4.7", "glm-4.6", "glm-4.5-air"]);
    // 选回「不指定（本机默认）」= 真值(null) → cancel 暂存 → 模型下拉回退隐藏
    openCtrl("配置-供应商");
    fireEvent.click(
      await screen.findByRole("button", { name: "选择 不指定（本机默认）" }),
    );
    const lastPatch = patches.at(-1) as any;
    expect(lastPatch.cancel).toBe(true);
    await waitFor(() =>
      expect(
        screen.queryByRole("combobox", { name: "配置-模型" }),
      ).not.toBeInTheDocument(),
    );
  });

  // 兼容锚：未挂 onStagedSwitch（存量调用面）保持切模型同请求带供应商旧行为。
  it("未传 onStagedSwitch（兼容）→ 选模型 injectSession 同请求带 llm_provider_id + model", async () => {
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

  it("暂存模式切回「默认」→ model 空串上抛 cancel（值等于快照当前值）；未挂时兼容路径空串下发", async () => {
    mocks.listProviders.mockResolvedValue([GLM_PROVIDER] as never);
    const onStagedSwitch = vi.fn();
    renderBar({
      llmProviderId: "prov-glm",
      onStagedSwitch,
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
    expect(mocks.injectSession).not.toHaveBeenCalled();
    // 快照 model="glm-4.6" 非空 → 选「默认」是真实切换暂存（cancel 未触发；
    // 选回 glm-4.6 才是 cancel 场景，见供应商组 cancel 用例同构判定）
    expect(onStagedSwitch).toHaveBeenCalledWith({
      field: "model",
      value: "",
      label: "默认",
      cancel: undefined,
    });
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
      { ...GLM_PROVIDER, agent_kinds: ["codex"] },
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
    expect(values).toEqual(["", "glm-4.7", "glm-4.6", "glm-4.5-air"]);  // D-001：主模型置顶后全部条目
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
  // 2026-10-25-session-config-deferred-switch（D-001）：暂存模式 idle 点选仅
  // 上抛暂存，不 inject 不弹 toast；onSwitched 不触发（无请求）。
  it("暂存模式 idle 选择档案 → onStagedSwitch 上抛（不 inject 无 toast），控件显示暂存档案", async () => {
    const { patches } = renderBarControlled({});
    openCtrl("配置-档案");
    fireEvent.click(screen.getByRole("button", { name: "选择 严肃代码审查员" }));

    expect(mocks.injectSession).not.toHaveBeenCalled();
    expect(mocks.messageSuccess).not.toHaveBeenCalled();
    expect(patches[0]).toEqual({
      field: "agent_profile_id",
      value: "prof-2",
      label: "严肃代码审查员",
      cancel: undefined,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "配置-档案 严肃代码审查员" }),
      ).toBeInTheDocument(),
    );
  });

  // 兼容锚：未挂 onStagedSwitch（存量调用面）保持点选即切换旧行为。
  it("未传 onStagedSwitch（兼容）→ idle 选择档案点选即切换 + onSwitched 回调", async () => {
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

  it("暂存模式「不指定」→ agent_profile_id 空串暂存上抛（cancel 未触发，当前有档案）", async () => {
    const onStagedSwitch = vi.fn();
    renderBar({ agentProfileId: "prof-1", onStagedSwitch });
    openCtrl("配置-档案");
    fireEvent.click(
      screen.getByRole("button", { name: "选择 不指定（无人格）" }),
    );
    expect(mocks.injectSession).not.toHaveBeenCalled();
    expect(onStagedSwitch).toHaveBeenCalledWith({
      field: "agent_profile_id",
      value: "",
      label: "不指定",
      cancel: undefined,
    });
  });

  // 兼容锚：未挂 onStagedSwitch（存量调用面）保持点选即切换旧行为（空串语义钉死）。
  it("未传 onStagedSwitch（兼容）→「不指定」agent_profile_id 空串取消档案回无人格（ql-20260818-004）", async () => {
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
//        机器共享徽标用例随 task-09 机器块移除而退役）──
// 2026-10-19-hide-shared-profile-in-session：真会话下拉隐藏共享条目（防中途
// 误选——会话内切档案只换人格，与「共享智能体=整套环境」预期不符），当前
// 会话档案豁免；预会话保留且置顶。标识展示用例随之迁至预会话场景。

describe("SessionConfigBar 共享智能体条目可见性（2026-10-19-hide-shared-profile-in-session）", () => {
  /** active 共享智能体列表 fixture（agent_profile_id=prof-shared）。 */
  function mockActiveShared() {
    mocks.apiFetch.mockResolvedValue([
      {
        id: "grant-1",
        agent_profile_id: "prof-shared",
        display_name: "平台源码助手",
        provider: "claude",
        runtime_online: true,
      },
    ]);
  }

  it("真会话档案下拉隐藏共享智能体条目（按 active id 过滤，普通档案照常可选）", async () => {
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
    mockActiveShared();
    renderBar();
    openCtrl("配置-档案");
    // active 列表异步到达后才过滤——waitFor 轮询至共享条目消失；普通档案
    // 始终在列（到达前后都渲染）。
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "选择 平台源码助手" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "选择 知识经理" }),
    ).toBeInTheDocument();
  });

  it("当前会话档案为共享智能体时该条目保留可见（带当前项，其余共享档案仍隐藏）", async () => {
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
    // active 两条共享（prof-shared 当前 + prof-shared-2 其它）——豁免只保当前。
    mocks.apiFetch.mockResolvedValue([
      {
        id: "grant-1",
        agent_profile_id: "prof-shared",
        display_name: "平台源码助手",
        provider: "claude",
        runtime_online: true,
      },
      {
        id: "grant-2",
        agent_profile_id: "prof-shared-2",
        display_name: "另一共享",
        provider: "claude",
        runtime_online: true,
      },
    ]);
    renderBar({ agentProfileId: "prof-shared" });
    openCtrl("配置-档案");
    const currentShared = await screen.findByRole("button", {
      name: "选择 平台源码助手",
    });
    expect(currentShared.textContent).toContain("✓");
    expect(
      screen.queryByRole("button", { name: "选择 另一共享" }),
    ).not.toBeInTheDocument();
  });

  it("active 列表请求失败降级 [] → 真会话不过滤（零回归），共享档案照常可选", async () => {
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
    // 评审 P3-2：真实 rejection 走 useActiveSharedAgents 的 catch(()=>[])
    // 降级路径（空成功数组测不到 catch 分支）。
    mocks.apiFetch.mockRejectedValue(new Error("网络错误"));
    renderBar();
    openCtrl("配置-档案");
    expect(
      await screen.findByRole("button", { name: "选择 平台源码助手" }),
    ).toBeInTheDocument();
  });

  it("预会话档案下拉共享智能体置顶且带「共享」标识，普通档案无标识保持原序", async () => {
    mocks.profilesHook.mockReturnValue({
      profiles: [
        { id: "prof-1", name: "知识经理" },
        { id: "prof-shared", name: "平台源码助手" },
        { id: "prof-2", name: "严肃代码审查员" },
      ],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockActiveShared();
    renderBar({ provisional: true });
    openCtrl("配置-档案");
    // active 到达后：共享条目置顶（首个档案项）+「共享」Tag 落在其行内。
    const tag = await screen.findByText("共享");
    const sharedRow = tag.closest("button");
    expect(sharedRow).not.toBeNull();
    expect(sharedRow?.textContent).toContain("平台源码助手");
    // 档案项按钮顺序断言（含首项「不指定」）：不指定 → 共享 → 知识经理 →
    // 严肃代码审查员（共享置顶、普通档案保原序）。
    const itemLabels = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-label")?.startsWith("选择 "))
      .map((b) => b.getAttribute("aria-label"));
    expect(itemLabels.slice(0, 4)).toEqual([
      "选择 不指定（无人格）",
      "选择 平台源码助手",
      "选择 知识经理",
      "选择 严肃代码审查员",
    ]);
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
        dialogHistory={[]}
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


// ── 2026-10-22-session-composer-slim FR-02：续跑开关迁出配置条 ────────────────

describe("SessionConfigBar 不再渲染中断自动续跑开关（入口迁至 + 菜单）", () => {
  it("配置条无续跑开关与运行中提示（即使旧调用方残留传参也不渲染）", () => {
    renderBar({
      running: true,
      // 旧调用方兼容探针：prop 已移除，运行时传参不应产生任何渲染。
      ...({ autoResume: { enabled: true, onToggle: vi.fn() } } as any),
    });
    expect(screen.queryByTestId("config-auto-resume-switch")).toBeNull();
    expect(screen.queryByText("中断自动续跑")).toBeNull();
    expect(screen.queryByText("运行中切换将于本轮结束后生效")).toBeNull();
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

  it("预会话：静态七档镜像渲染（off→max 逐项一致），off 显示「默认」带跨引擎语义差异 tooltip（P2-11）", async () => {
    renderBar({ provisional: true, configSnapshot: null });
    const trigger = screen.getByTestId("config-thinking-select");
    // 未选择态显示归位「默认」（""=清空不随首句上送，与显式选 off 显示同形）。
    expect(trigger.textContent).toBe("默认");
    // ql-20260922-001：antd Dropdown 化——点触发器开菜单后逐项断言。
    fireEvent.click(trigger);
    // 七档镜像：与 daemon THINKING_LEVELS 单源逐项一致（含顺序，约束注释互指）。
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "默认",
      "极低",
      "低",
      "中",
      "高",
      "超高",
      "最高",
    ]);
    // off 显示「默认」；tooltip 说明跨引擎语义差异（claude/codex=引擎默认思考
    // 通常开 ≠ pi=真关思考）。
    const offItem = screen.getByRole("menuitem", { name: "默认" });
    // antd v6 菜单项 li 内多层容器包裹 label span，按 [title] 属性定位 tooltip 载体。
    const offTitle = offItem.querySelector("[title]")?.getAttribute("title");
    expect(offTitle).toContain("claude/codex=不设置档位");
    expect(offTitle).toContain("pi=真正关闭思考");
    // 当前档（默认）经 selectable + selectedKeys 高亮（antd selected 类）。
    expect(offItem.className).toContain("selected");
    // 其余档位中文标签可读（未知值兜底显原值不编造）。
    expect(items[6]?.textContent).toBe("最高");
  });

  it("预会话选档 → onProvisionalThinkingLevelSwitch 上抛档位值（不 inject，显式选「默认」=off 也上抛）", async () => {
    const onLevel = vi.fn();
    renderBar({
      provisional: true,
      configSnapshot: null,
      onProvisionalThinkingLevelSwitch: onLevel,
    });
    const trigger = screen.getByTestId("config-thinking-select");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "高" }));
    expect(onLevel).toHaveBeenCalledWith("high");
    // 触发器胶囊显示已选档名。
    expect(trigger.textContent).toBe("高");
    // 暂存不走 inject（无会话——preModelId 同款专用回调收值）。
    expect(mocks.injectSession).not.toHaveBeenCalled();
    // 显式选「默认」= off 也上抛（首句携带 off，daemon 按引擎映射）。
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "默认" }));
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
    const trigger = screen.getByTestId("config-thinking-select");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "最高" }));
    expect(onLevel).toHaveBeenLastCalledWith("max");
    // 模型子下拉（供应商已选 prov-kimi → 候选 kimi-k2）变更触发级联重置。
    const model = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    fireEvent.change(model, { target: { value: "kimi-k2" } });
    expect(onModel).toHaveBeenCalledWith("kimi-k2");
    // 档位仅清自身选择（不动模型/provider 既有级联链）：回调收 ""，显示归位「默认」。
    expect(onLevel).toHaveBeenLastCalledWith("");
    expect(trigger.textContent).toBe("默认");
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
    const trigger = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLButtonElement;
    // current=medium → 触发器胶囊直显「中」。
    await waitFor(() => expect(trigger.textContent).toBe("中"));
    // ql-20260922-001：antd Dropdown 化——点触发器开菜单逐项断言。
    fireEvent.click(trigger);
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "默认",
      "低",
      "中",
      "高",
      "最高",
    ]);
    // 现值档（中）经 selectable + selectedKeys 高亮。
    expect(
      screen.getByRole("menuitem", { name: "中" }).className,
    ).toContain("selected");
  });

  it("current=null（claude SDK 不暴露现值）→ 回退「默认」选项（不显示「现值未知」占位）", async () => {
    mocks.getSessionThinkingLevels.mockResolvedValue({
      levels: ["off", "low", "high"],
      current: null,
    });
    renderBar({ thinkingLevel: {} });
    const trigger = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLButtonElement;
    await waitFor(() => expect(trigger.textContent).toBe("默认"));
    // 不再渲染「现值未知」占位（UX 优化：引擎默认档=事实上的当前档）
    expect(screen.queryByText("现值未知（引擎未上报）")).not.toBeInTheDocument();
  });

  it("turn running（thinkingLevel.disabled）→ 下拉禁用（档位切换仅空闲，D-002）", () => {
    renderBar({ thinkingLevel: { disabled: true } });
    expect(
      (screen.getByTestId("config-thinking-select") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  // 2026-10-26-config-staged-all-states FR-01：stagedMode 下 running 不再禁用档位
  // 控件（点选仅暂存不发请求，禁用理由消失）；点选照常暂存上抛。
  it("暂存模式 running 档位控件可点且点选仅暂存（不 POST）", async () => {
    const { patches } = renderBarControlled({
      running: true,
      thinkingLevel: { disabled: true },
    });
    const trigger = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLButtonElement;
    // stagedMode 解除 running 禁用
    expect(trigger.disabled).toBe(false);
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "高" }));
    expect(mocks.setSessionThinkingLevel).not.toHaveBeenCalled();
    expect(patches[0]).toEqual({
      field: "thinking_level",
      value: "high",
      label: "高",
      cancel: undefined,
    });
  });

  // 2026-10-25-session-config-deferred-switch（D-001）：暂存模式档位点选仅上抛
  // 暂存（不 POST 不即时改引擎档位），随下一条消息发送时先调端点生效。
  it("暂存模式点选档位 → onStagedSwitch 上抛（不 POST 无 toast），控件直接显示暂存档", async () => {
    const { patches } = renderBarControlled({ thinkingLevel: {} });
    const trigger = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLButtonElement;
    await waitFor(() => expect(trigger.textContent).toBe("中"));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "高" }));
    expect(mocks.setSessionThinkingLevel).not.toHaveBeenCalled();
    expect(mocks.messageSuccess).not.toHaveBeenCalled();
    expect(patches[0]).toEqual({
      field: "thinking_level",
      value: "high",
      label: "高",
      cancel: undefined,
    });
    // 控件直接显示暂存档（高）——静默记住，无任何标记（D-001）
    await waitFor(() => expect(trigger.textContent).toBe("高"));
  });

  it("暂存模式选回当前档 → cancel=true 取消暂存", async () => {
    const { patches } = renderBarControlled({ thinkingLevel: {} });
    const trigger = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLButtonElement;
    await waitFor(() => expect(trigger.textContent).toBe("中"));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "中" }));
    expect(mocks.setSessionThinkingLevel).not.toHaveBeenCalled();
    expect(patches[0]).toEqual({
      field: "thinking_level",
      value: "medium",
      label: "中",
      cancel: true,
    });
  });

  // 兼容锚：未挂 onStagedSwitch（存量调用面）保持点选即 POST 旧行为。
  it("未传 onStagedSwitch（兼容）→ 点选即切换：setSessionThinkingLevel 调用 + 成功通知 + 乐观缓存 current（不 invalidate）", async () => {
    renderBar({ thinkingLevel: {} });
    const trigger = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLButtonElement;
    await waitFor(() => expect(trigger.textContent).toBe("中"));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "高" }));
    await waitFor(() =>
      expect(mocks.setSessionThinkingLevel).toHaveBeenCalledWith("sess-1", "high"),
    );
    await waitFor(() =>
      expect(mocks.messageSuccess).toHaveBeenCalledWith("已切换思考级别：高"),
    );
    // 乐观缓存：成功后触发器立即显示所选档（高），且**不 invalidate 重拉**
    // （claude/codex 回 current=null 会覆盖乐观值闪回默认——用户反馈：切档后
    // 提示成功但立马恢复默认）。
    await waitFor(() => expect(trigger.textContent).toBe("高"));
    // 只拉了 1 次（初始），没有第二次 invalidate 重拉。
    expect(mocks.getSessionThinkingLevels).toHaveBeenCalledTimes(1);
  });

  it("ql-20260917-008：running 时切档受理——queued=True 提示「已排队…本轮结束后生效」+ 乐观缓存照写", async () => {
    mocks.setSessionThinkingLevel.mockResolvedValue({ ok: true, queued: true });
    renderBar({ running: true, thinkingLevel: {} });
    const trigger = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLButtonElement;
    await waitFor(() => expect(trigger.textContent).toBe("中"));
    expect(trigger.disabled).toBe(false); // 运行中不再禁用
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "高" }));
    await waitFor(() =>
      expect(mocks.setSessionThinkingLevel).toHaveBeenCalledWith("sess-1", "high"),
    );
    await waitFor(() =>
      expect(mocks.messageSuccess).toHaveBeenCalledWith(
        "已排队切换思考级别：高（本轮结束后生效）",
      ),
    );
    await waitFor(() => expect(trigger.textContent).toBe("高"));
  });

  it("ql-20260917-008：running 时切换供应商照常受理——injectSession 调用 + 提示「已排队…本轮结束后生效」", async () => {
    renderBar({ running: true, llmProviderId: "prov-kimi" });
    openCtrl("配置-供应商");
    fireEvent.click(await screen.findByRole("button", { name: "选择 GLM 平台" }));
    await waitFor(() => expect(mocks.injectSession).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mocks.messageSuccess).toHaveBeenCalledWith(
        expect.stringContaining("已排队切换供应商"),
      ),
    );
    await waitFor(() =>
      expect(mocks.messageSuccess).toHaveBeenCalledWith(
        expect.stringContaining("本轮结束后生效"),
      ),
    );
  });

  // 2026-10-26-config-staged-all-states FR-01：暂存模式 running 点选同样仅暂存——
  // 四控件全状态统一（旧行为「运行中即时 inject 忙轮排队」撤销：排队条目派发
  // 会建静默切换轮，用户实测看到新轮次）。
  it("暂存模式 running 点选供应商/模型/档案 → 仅暂存上抛，不 inject", async () => {
    mocks.listProviders.mockResolvedValue([
      { id: "prov-glm", name: "GLM 平台", models: [{ name: "glm-4.7", roles: ["sonnet"] }], agent_kinds: ["claude"] },
    ] as never);
    const { patches } = renderBarControlled({
      running: true,
      llmProviderId: "prov-kimi",
    });
    // 供应商：running 态点选 → 暂存上抛（级联 model 重置 + provider）
    openCtrl("配置-供应商");
    fireEvent.click(await screen.findByRole("button", { name: "选择 GLM 平台" }));
    expect(mocks.injectSession).not.toHaveBeenCalled();
    expect(patches.some((p: any) => p.field === "llm_provider_id" && p.value === "prov-glm")).toBe(true);
    // 模型：running 态切模型 → 同样暂存
    const select = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "glm-4.7" } });
    expect(mocks.injectSession).not.toHaveBeenCalled();
    // 档案：running 态点选 → 同样暂存
    openCtrl("配置-档案");
    fireEvent.click(screen.getByRole("button", { name: "选择 严肃代码审查员" }));
    expect(mocks.injectSession).not.toHaveBeenCalled();
    expect(patches.some((p: any) => p.field === "agent_profile_id" && p.value === "prof-2")).toBe(true);
  });

  it("200 结构化失败（ok=false + error）→ notify error 带 error 原文（如旧 daemon 升级提示）", async () => {
    mocks.setSessionThinkingLevel.mockResolvedValue({
      ok: false,
      error: "daemon 未支持思考级别，请升级 daemon",
    });
    renderBar({ thinkingLevel: {} });
    const trigger = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLButtonElement;
    await waitFor(() => expect(trigger.textContent).toBe("中"));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "低" }));
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
    const trigger = (await screen.findByTestId(
      "config-thinking-select",
    )) as HTMLButtonElement;
    await waitFor(() => expect(trigger.textContent).toBe("中"));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "低" }));
    await waitFor(() =>
      expect(mocks.messageError).toHaveBeenCalledWith(
        "会话运行中，本轮结束后可切换",
      ),
    );
  });
});

// ── 9. ql-20260915-009 手机端降噪：variant="mobile" 收低频控件 ────────────────

describe("SessionConfigBar 手机端降噪（ql-20260915-009 variant=mobile）", () => {
  it("mobile：思考档位/档案不渲染，供应商控件保留（供应商+模型+额度形态）", async () => {
    renderBar({
      variant: "mobile",
      llmProviderId: "prov-kimi",
      agentProfileId: "prof-1",
      thinkingLevel: {},
    });
    // 低频设置项收走。
    expect(
      screen.queryByTestId("config-thinking-select"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("config-auto-resume-switch")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "配置-档案 知识经理" }),
    ).not.toBeInTheDocument();
    // 核心控件保留（供应商列表异步到达后解析名）。
    expect(
      await screen.findByRole("button", { name: "配置-供应商 Kimi 中转" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("config-model-select")).toBeInTheDocument();
  });

  it("desktop（默认不传 variant）：上述控件照旧渲染（零回归锚）", async () => {
    renderBar({
      llmProviderId: "prov-kimi",
      agentProfileId: "prof-1",
      thinkingLevel: {},
    });
    expect(
      await screen.findByRole("button", { name: "配置-供应商 Kimi 中转" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "配置-档案 知识经理" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("config-thinking-select")).toBeInTheDocument();
    // 续跑入口已迁出配置条（2026-10-22-session-composer-slim FR-02）。
    expect(screen.queryByTestId("config-auto-resume-switch")).toBeNull();
    // 「设置」展开钮仅 mobile 渲染。
    expect(screen.queryByTestId("config-mobile-more")).toBeNull();
  });

  it("mobile：点「设置」展开思考档位/档案，再点收起隐藏（ql-20260915-011 收入口不砍功能）", async () => {
    renderBar({
      variant: "mobile",
      llmProviderId: "prov-kimi",
      agentProfileId: "prof-1",
      thinkingLevel: {},
    });
    // 默认收起：三控件不可见，展开钮存在。
    expect(screen.getByTestId("config-mobile-more")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.queryByRole("button", { name: "配置-档案 知识经理" }),
    ).not.toBeInTheDocument();
    // 展开：三控件全部可达。
    fireEvent.click(screen.getByTestId("config-mobile-more"));
    expect(screen.getByTestId("config-mobile-more")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "配置-档案 知识经理" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("config-thinking-select")).toBeInTheDocument();
    // 收起：回到紧凑态。
    fireEvent.click(screen.getByTestId("config-mobile-more"));
    expect(
      screen.queryByRole("button", { name: "配置-档案 知识经理" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("config-thinking-select")).not.toBeInTheDocument();
  });

  it("desktop/mobile 均不渲染「运行中切换将于本轮结束后生效」提示（2026-10-22-session-composer-slim FR-02）", () => {
    renderBar({ running: true });
    expect(
      screen.queryByText("运行中切换将于本轮结束后生效"),
    ).not.toBeInTheDocument();
    cleanup();
    renderBar({ variant: "mobile", running: true });
    expect(
      screen.queryByText("运行中切换将于本轮结束后生效"),
    ).not.toBeInTheDocument();
  });
});

// ── 2026-10-21-provider-default-ui-hint：兜底项文案动态化 ────────────────────

describe("SessionConfigBar 不指定兜底文案（provider-default-ui-hint）", () => {
  it("用户有默认供应商 → 兜底项显示「不指定（默认：{name}）」", async () => {
    mocks.listProviders.mockReset().mockResolvedValue([
      { id: "prov-kimi", name: "Kimi 中转", models: [], agent_kinds: ["claude"] },
      { id: "prov-glm", name: "GLM 平台", models: [], agent_kinds: ["claude"], is_default: true },
    ]);
    renderBar();
    // 未选态按钮显示默认供应商名（claim 实际注入它）；下拉兜底项为动态文案。
    const btn = await screen.findByRole("button", {
      name: "配置-供应商 GLM 平台",
    });
    fireEvent.click(btn);
    expect(screen.getByTestId("config-dd-provider")).toBeInTheDocument();
    expect(screen.getByText("不指定（默认：GLM 平台）")).toBeInTheDocument();
  });

  it("未设默认供应商 → 保持「不指定（本机默认）」（零回归）", async () => {
    mocks.listProviders.mockReset().mockResolvedValue([
      { id: "prov-kimi", name: "Kimi 中转", models: [], agent_kinds: ["claude"] },
    ]);
    renderBar();
    const btn = await screen.findByRole("button", {
      name: "配置-供应商 本机默认",
    });
    fireEvent.click(btn);
    expect(screen.getByText("不指定（本机默认）")).toBeInTheDocument();
  });
});

// ── 2026-10-28-session-config-default-provider-fix：默认供应商引擎匹配 ──────

describe("SessionConfigBar 默认供应商引擎匹配（session-config-default-provider-fix）", () => {
  it("pi 会话 + 默认供应商不覆盖 pi（agent_kinds=[claude,codex]）→ 按钮显示「本机默认」，不误示该供应商名", async () => {
    mocks.listProviders.mockReset().mockResolvedValue([
      {
        id: "prov-glm",
        name: "GLM 平台",
        models: [{ name: "glm-4.7" }],
        agent_kinds: ["claude", "codex"],
        is_default: true,
      },
    ]);
    renderBar({
      engine: "pi",
      configSnapshot: { machine_name: "m", agent_name: "PI", engine: "pi" },
    });
    expect(
      await screen.findByRole("button", { name: "配置-供应商 本机默认" }),
    ).toBeInTheDocument();
    openCtrl("配置-供应商");
    // 兜底文案同样不跨引擎——claim 默认链不会把 claude/codex 默认注入 pi 会话。
    expect(screen.getByText("不指定（本机默认）")).toBeInTheDocument();
  });

  it("pi 会话 + 默认供应商覆盖 pi（agent_kinds 含 pi）→ 按钮显示该供应商名 + 模型下拉渲染且候选跟随", async () => {
    mocks.listProviders.mockReset().mockResolvedValue([
      {
        id: "prov-glm",
        name: "GLM 平台",
        models: [
          { name: "glm-4.7", roles: ["sonnet"] },
          { name: "glm-4.6", roles: [] },
        ],
        agent_kinds: ["pi"],
        is_default: true,
      },
    ]);
    renderBar({
      engine: "pi",
      configSnapshot: { machine_name: "m", agent_name: "PI", engine: "pi" },
    });
    expect(
      await screen.findByRole("button", { name: "配置-供应商 GLM 平台" }),
    ).toBeInTheDocument();
    // 模型下拉随显示层回退渲染（即将注入的默认供应商），候选=其模型列表。
    const select = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", "glm-4.7", "glm-4.6"]);
    expect(select.value).toBe("");
  });

  it("claude 会话未显式选供应商 + 引擎匹配默认存在 → 模型下拉渲染，「不指定」项保持当前高亮（显示层回退不改选择语义）", async () => {
    mocks.listProviders.mockReset().mockResolvedValue([
      {
        id: "prov-glm",
        name: "GLM 平台",
        models: [{ name: "glm-4.7" }],
        agent_kinds: ["claude"],
        is_default: true,
      },
    ]);
    renderBar({ llmProviderId: null });
    expect(
      await screen.findByRole("combobox", { name: "配置-模型" }),
    ).toBeInTheDocument();
    openCtrl("配置-供应商");
    // 未显式选择 → 「不指定（默认：…）」项仍是当前项（✓ 高亮）。
    const noItem = await screen.findByRole("button", {
      name: "选择 不指定（默认：GLM 平台）",
    });
    expect(noItem.textContent).toContain("✓");
  });

  it("provisional（预会话）未选供应商 + 引擎匹配默认存在 → 模型下拉渲染，候选跟随默认供应商（此前「显示将用默认却不给选模型」）", async () => {
    mocks.listProviders.mockReset().mockResolvedValue([
      {
        id: "prov-glm",
        name: "GLM 平台",
        models: [{ name: "glm-4.7" }],
        agent_kinds: ["claude"],
        is_default: true,
      },
    ]);
    renderBar({ provisional: true, engine: "claude" });
    const select = (await screen.findByRole("combobox", {
      name: "配置-模型",
    })) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "",
      "glm-4.7",
    ]);
  });
});

// ── 2026-10-21-profile-default-prehint：预会话档案显示对齐默认 ───────────────

describe("SessionConfigBar 档案默认预示（profile-default-prehint）", () => {
  it("provisional 未选档案 + 用户默认档案 → 按钮显示默认档案名；下拉兜底项动态文案", async () => {
    mocks.profilesHook.mockReset().mockReturnValue({
      profiles: [
        { id: "prof-1", name: "SillySpec 极速变更", is_user_default: true },
        { id: "prof-2", name: "普通档案" },
      ],
    });
    renderBar({ provisional: true });
    const btn = await screen.findByRole("button", {
      name: "配置-档案 SillySpec 极速变更",
    });
    fireEvent.click(btn);
    expect(screen.getByTestId("config-dd-profile")).toBeInTheDocument();
    expect(screen.getByText("不指定（默认：SillySpec 极速变更）")).toBeInTheDocument();
  });

  it("非 provisional 未选档案 → 保持「未指定」真值（存量会话不追溯注入）", async () => {
    mocks.profilesHook.mockReset().mockReturnValue({
      profiles: [
        { id: "prof-1", name: "SillySpec 极速变更", is_user_default: true },
      ],
    });
    renderBar();
    // 非 provisional：agentProfileId null（BASE_PROPS 缺省）→ 未指定
    expect(
      await screen.findByRole("button", { name: "配置-档案 未指定" }),
    ).toBeInTheDocument();
  });
});
// ── 14. 会话 git 分支指示项（2026-10-21-session-git-branch / FR-01..03）─────

describe("SessionConfigBar git 分支指示项（2026-10-21-session-git-branch）", () => {
  const GIT_OK = {
    git_mode: "git",
    root: "C:\\wt\\feature-x",
    root_source: "cwd",
    branch: "feature-x",
    detached: false,
    head_short: "1a2b3c4d",
    files_changed: 2,
    untracked_count: 1,
    synced_at: "2026-10-21T12:00:00Z",
  };

  it("renders git branch indicator after profile control（FR-01：档案控件后显示当前分支）", async () => {
    renderBar();
    const badge = await screen.findByTestId("session-git-branch");
    expect(badge).toHaveTextContent("feature-x");
    // DOM 顺序：档案按钮在前、指示项紧随其后（用户指定位置）。
    const profile = screen.getByRole("button", { name: /配置-档案/ });
    expect(
      profile.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("detached HEAD 显示 head 短 sha（FR-01 场景）", async () => {
    mocks.fetchSessionGitStatus.mockResolvedValue({
      ...GIT_OK,
      branch: null,
      detached: true,
    });
    renderBar();
    expect(await screen.findByTestId("session-git-branch")).toHaveTextContent(
      "1a2b3c4d",
    );
  });

  it("git branch indicator polls with refetchInterval（FR-02：60s 轮询动态刷新）", async () => {
    // 轮询配置直读 query options（fake timers 推进 60s 在 jsdom + react-query
    // 组合下不稳，用例间污染实证）；动态性用 refetch 驱动验证——数据更新展示
    // 随之变化（非创建快照）。
    const { client } = renderBar();
    await screen.findByTestId("session-git-branch");
    const query = client
      .getQueryCache()
      .find({ queryKey: ["sessionGitStatus", "sess-1"] });
    // Query.options 的公开类型是收窄子集（不含 refetchInterval），运行时携带
    // 完整 useQuery options——断言收窄读取。
    const opts = query?.options as { refetchInterval?: number | false } | undefined;
    expect(opts?.refetchInterval).toBe(60_000);

    mocks.fetchSessionGitStatus.mockResolvedValue({ ...GIT_OK, branch: "main" });
    await client.refetchQueries({ queryKey: ["sessionGitStatus", "sess-1"] });
    expect(await screen.findByTestId("session-git-branch")).toHaveTextContent(
      "main",
    );
  });

  it("hides git branch indicator on no_git / no_root（FR-03 空态静默隐藏）", async () => {
    mocks.fetchSessionGitStatus.mockResolvedValue({ ...GIT_OK, git_mode: "no_git" });
    renderBar();
    await waitFor(() => expect(mocks.fetchSessionGitStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("session-git-branch")).not.toBeInTheDocument();

    mocks.fetchSessionGitStatus.mockResolvedValue({ ...GIT_OK, git_mode: "no_root" });
    renderBar();
    await waitFor(() => expect(mocks.fetchSessionGitStatus).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("session-git-branch")).not.toBeInTheDocument();
  });

  it("查询失败降级占位 ⎇ — 不阻塞其余控件（FR-03 故障形态）", async () => {
    mocks.fetchSessionGitStatus.mockRejectedValue(new Error("offline"));
    renderBar();
    const badge = await screen.findByTestId("session-git-branch");
    expect(badge).toHaveTextContent("—");
    // 档案/供应商控件照常渲染。
    expect(screen.getByRole("button", { name: /配置-档案/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /配置-供应商/ })).toBeInTheDocument();
  });

  it("预会话（sessionId 空串）不渲染指示项", () => {
    renderBar({ sessionId: "" });
    expect(screen.queryByTestId("session-git-branch")).not.toBeInTheDocument();
    expect(mocks.fetchSessionGitStatus).not.toHaveBeenCalled();
  });
});

// ── 15. 工作树标识（2026-10-25-session-git-worktree-root / FR-03）───────────

describe("SessionConfigBar git 指示项工作树标识（2026-10-25-session-git-worktree-root）", () => {
  const WT_OK = {
    git_mode: "git",
    root: "C:\\repo\\.sillyspec\\.runtime\\worktrees\\2026-10-25-wt-demo",
    root_source: "worktree",
    branch: "wt-branch",
    detached: false,
    head_short: "9f8e7d6c",
    files_changed: 3,
    untracked_count: 0,
    synced_at: "2026-10-25T12:00:00Z",
  };

  it("shows worktree badge when root_source is worktree（FR-03：工作树可见标识）", async () => {
    mocks.fetchSessionGitStatus.mockResolvedValue(WT_OK);
    renderBar();
    const badge = await screen.findByTestId("session-git-branch");
    expect(badge).toHaveTextContent("wt-branch");
    expect(badge).toHaveAttribute("data-root-source", "worktree");
    expect(screen.getByTestId("session-git-worktree-tag")).toHaveTextContent(
      "工作树",
    );
  });

  it("cwd 来源无工作树标识（FR-03：非工作树形态展示与现状一致）", async () => {
    renderBar(); // beforeEach 默认 mock root_source=cwd
    const badge = await screen.findByTestId("session-git-branch");
    expect(badge).toHaveAttribute("data-root-source", "cwd");
    expect(screen.queryByTestId("session-git-worktree-tag")).not.toBeInTheDocument();
  });
});

describe("SessionConfigBar 模型名截断放宽（2026-10-26-mobile-four-page-layout-fix task-06 / FR-04）", () => {
  const RENDER_OVERRIDES = {
    llmProviderId: "prov-kimi",
    agentProfileId: "prof-1",
    thinkingLevel: {},
  };

  it("mobile 下模型 select 宽度放宽至 150px（原 110px 截断「glm-5.3-fla…」观感差）", async () => {
    renderBar({ variant: "mobile", ...RENDER_OVERRIDES });
    expect(
      await screen.findByRole("button", { name: "配置-供应商 Kimi 中转" }),
    ).toBeInTheDocument();
    const select = screen.getByTestId("config-model-select") as HTMLSelectElement;
    expect(select.className).toContain("max-w-[150px]");
    expect(select.className).not.toContain("max-w-[110px]");
  });

  it("desktop 锚：模型 select 宽度保持 150px 不变", async () => {
    renderBar({ ...RENDER_OVERRIDES });
    expect(
      await screen.findByRole("button", { name: "配置-供应商 Kimi 中转" }),
    ).toBeInTheDocument();
    const select = screen.getByTestId("config-model-select") as HTMLSelectElement;
    expect(select.className).toContain("max-w-[150px]");
  });
});
