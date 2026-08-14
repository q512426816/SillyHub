/**
 * 智能体档案全局页（/agent-profiles）单测（task-07 / FR-08 / D-001）。
 *
 * 依据：
 *   - app/(dashboard)/agent-profiles/page.tsx（task-05 实现）
 *   - design §5 P5 / §6 / §12 验收 1/4（全局页渲染卡片墙 + 新建表单）
 *
 * 覆盖：
 *   1. 渲染：PageHeader 标题/副标题 + 「+ 新建档案」按钮 + 卡片墙（mine 数据源）
 *   2. 点「+ 新建档案」→ 以 create 模式打开 AgentProfileForm（全局页不传 workspaceId
 *      → 表单内部渲染「工作区上下文」选择器，由 form 自测，此处只验 mode/workspaceId）
 *   3. 点卡片编辑按钮 → 以 edit 模式打开 form，profile 透传
 *   4. 复制 workspace 级档案 → copyWorkspaceAgentProfile(ws_id, pid, {})
 *      私人/平台级（workspace_id=null）→ 提示不支持，不发复制请求
 *   5. 删除确认流程：workspace 级 → deleteWorkspaceAgentProfile；
 *      private/platform（workspace_id=null）admin → deleteAgentProfile；非 admin → 提示
 *
 * mock 策略：
 *   - AgentProfileForm mock 为纯占位组件（避免其内部复杂 hook 依赖），暴露 mode/profile
 *   - AgentProfileCardGrid 保留真实实现，mock 底层 useMineAgentProfiles 提供测试档案
 *   - copy/delete 裸 fetch 函数 mock（含 deleteAgentProfile platform 级），useNotify + useSession mock
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";

import AgentProfilesGlobalPage from "@/app/(dashboard)/agent-profiles/page";
import type { AgentProfileAggregatedItem } from "@/lib/agent-profiles";

// ── mocks ────────────────────────────────────────────────────────────────

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@/lib/errors", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return { ...actual, useNotify: () => notifyMock };
});

const fetchMock = vi.hoisted(() => ({
  copy: vi.fn(),
  del: vi.fn(),
  delPlatform: vi.fn(),
  invalidate: vi.fn(),
}));

// session mock：控制 is_platform_admin（admin 可删 workspace_id=null 档案）
const sessionMock = vi.hoisted(() => ({ isAdmin: false }));
vi.mock("@/stores/session", () => ({
  useSession: (
    selector: (_s: { user?: { is_platform_admin?: boolean } }) => unknown,
  ) => selector({ user: { is_platform_admin: sessionMock.isAdmin } }),
}));

// hook mock：控制 mine 数据源
const mineHook = vi.hoisted(() => ({ profiles: vi.fn() }));

// 统一 mock @/lib/agent-profiles：保留 VISIBILITY_LABEL 等纯常量 + queryKeys，
// 替换 copy/delete 裸 fetch + useMineAgentProfiles hook（vitest 多次 vi.mock 同模块
// 时只有最后一个 hoisted 生效，故必须合并到一个 factory）。
vi.mock("@/lib/agent-profiles", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/agent-profiles")>(
      "@/lib/agent-profiles",
    );
  return {
    ...actual,
    copyWorkspaceAgentProfile: fetchMock.copy,
    deleteWorkspaceAgentProfile: fetchMock.del,
    deleteAgentProfile: fetchMock.delPlatform,
    useMineAgentProfiles: () => ({
      profiles: mineHook.profiles(),
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

// AgentProfileForm 占位：避免其内部 hook 链；断言 mode/workspaceId/profile
const formMock = vi.hoisted(() => ({ calls: vi.fn() }));
vi.mock("@/components/agent-profile-form", () => ({
  AgentProfileForm: (props: {
    mode: string;
    workspaceId?: string;
    profile?: { id?: string; name?: string } | null;
  }) => {
    // 记录每次渲染时的 props，便于断言
    formMock.calls(props);
    return (
      <div data-testid="profile-form-mock" data-mode={props.mode}>
        {props.profile?.name ? `edit:${props.profile.name}` : "create"}
      </div>
    );
  },
}));

/** 构造最小 AggregatedItem。 */
function makeProfile(
  overrides: Partial<AgentProfileAggregatedItem> = {},
): AgentProfileAggregatedItem {
  return {
    id: "p-1",
    name: "代码审查助手",
    visibility: "workspace",
    provider: "claude",
    model: "claude-sonnet-4",
    system_prompt: "你是审查员。",
    tool_policy_id: null,
    mcp_refs: [],
    skill_refs: [],
    owner_user_id: "u-1",
    workspace_id: "ws-1",
    workspace_name: "前端组",
    version: 2,
    is_system_default: false,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  } as unknown as AgentProfileAggregatedItem;
}

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  // 监听 invalidateQueries 调用（验证 CRUD 后刷新 mineList 桶）
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  fetchMock.invalidate =
    invalidateSpy as unknown as typeof fetchMock.invalidate;
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  notifyMock.success.mockReset();
  notifyMock.error.mockReset();
  notifyMock.warning.mockReset();
  fetchMock.copy.mockReset();
  fetchMock.del.mockReset();
  fetchMock.delPlatform.mockReset();
  fetchMock.invalidate.mockReset();
  formMock.calls.mockReset();
  mineHook.profiles.mockReturnValue([]);
  sessionMock.isAdmin = false;
});

afterEach(() => {
  cleanup();
});

// ── 1. 渲染 ──────────────────────────────────────────────────────────────

describe("全局页渲染（task-05 / design §12 验收 1）", () => {
  it("PageHeader 标题/副标题 + 「+ 新建档案」按钮 + 卡片墙（mine 数据源）", () => {
    mineHook.profiles.mockReturnValue([makeProfile()]);
    renderPage(<AgentProfilesGlobalPage />);

    expect(screen.getByText("智能体档案")).toBeInTheDocument();
    expect(
      screen.getByText(/跨工作区查看全部可见档案/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /\+\s*新建档案/ }),
    ).toBeInTheDocument();
    // 卡片墙渲染了档案
    expect(screen.getByText("代码审查助手")).toBeInTheDocument();
  });

  it("空档案 → 卡片墙显「暂无智能体档案」", () => {
    mineHook.profiles.mockReturnValue([]);
    renderPage(<AgentProfilesGlobalPage />);
    expect(screen.getByText(/暂无智能体档案/)).toBeInTheDocument();
  });
});

// ── 2. 新建 ──────────────────────────────────────────────────────────────

describe("新建档案（D-006 全局页不传 workspaceId → form 渲染工作区上下文选择器）", () => {
  it("点「+ 新建档案」→ AgentProfileForm 以 mode=create + 无 workspaceId 打开", async () => {
    mineHook.profiles.mockReturnValue([]);
    renderPage(<AgentProfilesGlobalPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /\+\s*新建档案/ }));
    });

    const form = screen.getByTestId("profile-form-mock");
    expect(form).toHaveAttribute("data-mode", "create");
    // 全局页不传 workspaceId（form 内部据此渲染「工作区上下文」选择器）
    const lastCall = formMock.calls.mock.calls.at(-1)?.[0];
    expect(lastCall.workspaceId).toBeUndefined();
    expect(lastCall.profile).toBeNull();
  });
});

// ── 3. 编辑 ──────────────────────────────────────────────────────────────

describe("编辑档案（点卡片编辑按钮）", () => {
  it("点编辑 → AgentProfileForm 以 mode=edit + profile 透传打开", async () => {
    mineHook.profiles.mockReturnValue([
      makeProfile({ id: "p-edit", name: "待编辑档" }),
    ]);
    renderPage(<AgentProfilesGlobalPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^编辑$/ }));
    });

    const form = screen.getByTestId("profile-form-mock");
    expect(form).toHaveAttribute("data-mode", "edit");
    expect(screen.getByText("edit:待编辑档")).toBeInTheDocument();
  });
});

// ── 4. 复制 ──────────────────────────────────────────────────────────────

describe("复制档案（全局页特有：跨工作区数据流）", () => {
  it("workspace 级档案（workspace_id 非空）→ copyWorkspaceAgentProfile(ws_id, pid, {})", async () => {
    mineHook.profiles.mockReturnValue([
      makeProfile({ id: "p-copy", workspace_id: "ws-9", name: "复制源" }),
    ]);
    fetchMock.copy.mockResolvedValue({ id: "p-new", name: "复制源（副本）" });
    renderPage(<AgentProfilesGlobalPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^复制$/ }));
    });

    await waitFor(() => {
      expect(fetchMock.copy).toHaveBeenCalledWith("ws-9", "p-copy", {});
    });
    expect(notifyMock.success).toHaveBeenCalled();
  });

  it("private/platform 级档案（workspace_id=null）→ 提示不支持，不发复制请求", async () => {
    mineHook.profiles.mockReturnValue([
      makeProfile({ id: "p-priv", workspace_id: null, visibility: "private" }),
    ]);
    renderPage(<AgentProfilesGlobalPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^复制$/ }));
    });

    expect(fetchMock.copy).not.toHaveBeenCalled();
    expect(notifyMock.warning).toHaveBeenCalledWith(
      expect.stringContaining("暂不支持在此复制"),
    );
  });
});

// ── 5. 删除确认流程 ───────────────────────────────────────────────────────

describe("删除档案（确认弹窗 + deleteWorkspaceAgentProfile）", () => {
  it("点删除 → 确认弹窗 → 确认 → deleteWorkspaceAgentProfile + 成功提示", async () => {
    mineHook.profiles.mockReturnValue([
      makeProfile({ id: "p-del", workspace_id: "ws-del", name: "待删档" }),
    ]);
    fetchMock.del.mockResolvedValue(undefined);
    renderPage(<AgentProfilesGlobalPage />);

    // 点卡片的「删除」按钮 → 弹出确认 Modal
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    });
    expect(screen.getByText(/确认删除智能体档案/)).toBeInTheDocument();

    // 点确认删除（Modal okText「确认删除」，antd 两字以上中文按钮用 \s* 兼容 autoLetterSpacing）
    const okBtn = screen.getByRole("button", { name: /确\s*认\s*删\s*除/ });
    await act(async () => {
      fireEvent.click(okBtn);
    });

    await waitFor(() => {
      expect(fetchMock.del).toHaveBeenCalledWith("ws-del", "p-del");
    });
    expect(notifyMock.success).toHaveBeenCalledWith(
      expect.stringContaining("已删除"),
    );
    // CRUD 后 invalidate mineList 桶 → 卡片墙自动刷新
    expect(fetchMock.invalidate).toHaveBeenCalledWith({
      queryKey: ["agentProfiles", "mine"],
    });
  });

  it("非 admin 删 private/platform 级档案（workspace_id=null）→ 拦截提示，不发删除请求", async () => {
    sessionMock.isAdmin = false;
    mineHook.profiles.mockReturnValue([
      makeProfile({ id: "p-priv", workspace_id: null, visibility: "platform" }),
    ]);
    renderPage(<AgentProfilesGlobalPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    });
    // 即便确认弹窗弹出，双保险也会在确认时拦截
    const okBtn = screen.queryByRole("button", { name: /确\s*认\s*删\s*除/ });
    if (okBtn) {
      await act(async () => {
        fireEvent.click(okBtn);
      });
    }
    expect(fetchMock.del).not.toHaveBeenCalled();
    expect(fetchMock.delPlatform).not.toHaveBeenCalled();
    expect(notifyMock.warning).toHaveBeenCalledWith(
      expect.stringContaining("请联系管理员"),
    );
  });

  it("admin 删 private/platform 级档案（workspace_id=null）→ deleteAgentProfile(pid)", async () => {
    sessionMock.isAdmin = true;
    mineHook.profiles.mockReturnValue([
      makeProfile({ id: "p-priv", workspace_id: null, visibility: "private" }),
    ]);
    fetchMock.delPlatform.mockResolvedValue(undefined);
    renderPage(<AgentProfilesGlobalPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    });
    const okBtn = screen.getByRole("button", { name: /确\s*认\s*删\s*除/ });
    await act(async () => {
      fireEvent.click(okBtn);
    });

    await waitFor(() => {
      expect(fetchMock.delPlatform).toHaveBeenCalledWith("p-priv");
    });
    // 没走 workspace 级端点
    expect(fetchMock.del).not.toHaveBeenCalled();
    expect(notifyMock.success).toHaveBeenCalledWith(
      expect.stringContaining("已删除"),
    );
    expect(fetchMock.invalidate).toHaveBeenCalledWith({
      queryKey: ["agentProfiles", "mine"],
    });
  });
});
