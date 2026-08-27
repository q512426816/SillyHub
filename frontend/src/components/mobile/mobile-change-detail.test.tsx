/**
 * task-08 · MobileChangeDetail 单测（FR-04 / design §5.3 详情页 / §7，
 * change 2026-08-26-mobile-workspace-page）。
 *
 * 覆盖任务卡指定契约：
 *  1. 审批通过/驳回（含 archive_confirm 无驳回、无待办折叠只读）：
 *     mock submitStageReview 断言 action/comment 入参 + invalidate
 *     ["changes", workspaceId] 前缀与详情 key 断言；
 *  2. 文档点击打开 FilePreviewModal（defaultFullscreen=true 全屏直出，
 *     target.fetch 走 fetchChangeFileRaw raw 端点封装）；
 *  3. 任务区桌面引导条（D-002）渲染；
 *  4. 阶段步骤条横向滚动容器（overflow-x-auto）+ 六阶段标签 + 当前高亮 + 非线性降级；
 *  5. 关联会话卡 onOpenSession 回调 + 仅本人过滤计数；
 *  6. 时间线纯内容复用（change-step-timeline 挂载渲染 steps）；
 *  7. quicklog 关联折叠卡（有条目渲染 / 失败静默隐藏）；
 *  8. 详情 query key 逐字对齐桌面 ["change", workspaceId, changeId]（缓存落键）。
 *
 * mock 范式：importActual 部分 mock（数据层只换页面用到的请求函数）+ 真实
 * QueryClient；FilePreviewModal 打桩断言 props 契约（open/target/
 * defaultFullscreen，stub 内按钮触发 target.fetch 断言 raw 封装接线）——真弹窗
 * 依赖 URL.createObjectURL（jsdom 未实现），契约桩是既有测试惯例。
 * stores/session 打桩提供当前用户 id（仅本人过滤依据）。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── FilePreviewModal 契约桩（props 直出 + target.fetch 触发按钮）──────────────
vi.mock("@/components/files/file-preview-modal", () => ({
  FilePreviewModal: (props: {
    target: { fetch: () => Promise<Blob>; meta: { name: string } } | null;
    open: boolean;
    defaultFullscreen?: boolean;
  }) => (
    <div
      data-testid="file-preview-modal-stub"
      data-open={String(props.open)}
      data-fullscreen={String(props.defaultFullscreen ?? false)}
      data-name={props.target?.meta.name ?? ""}
    >
      <button type="button" onClick={() => void props.target?.fetch()}>
        桩拉取
      </button>
    </div>
  ),
}));

// ── 数据层部分 mock ─────────────────────────────────────────────────────────
const changesApi = vi.hoisted(() => ({
  getChange: vi.fn(),
  submitStageReview: vi.fn(),
  getAgentStatus: vi.fn(),
}));
vi.mock("@/lib/changes", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/changes")>("@/lib/changes");
  return {
    ...actual,
    getChange: changesApi.getChange,
    submitStageReview: changesApi.submitStageReview,
    getAgentStatus: changesApi.getAgentStatus,
  };
});

const changeFilesApi = vi.hoisted(() => ({
  listChangeFiles: vi.fn(),
  fetchChangeFileRaw: vi.fn(),
}));
vi.mock("@/lib/change-files", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/change-files")>(
      "@/lib/change-files",
    );
  return {
    ...actual,
    listChangeFiles: changeFilesApi.listChangeFiles,
    fetchChangeFileRaw: changeFilesApi.fetchChangeFileRaw,
  };
});

const daemonApi = vi.hoisted(() => ({ listChangeSessions: vi.fn() }));
vi.mock("@/lib/daemon", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, listChangeSessions: daemonApi.listChangeSessions };
});

const quicklogApi = vi.hoisted(() => ({ listQuicklogEntries: vi.fn() }));
vi.mock("@/lib/quicklog", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/quicklog")>("@/lib/quicklog");
  return { ...actual, listQuicklogEntries: quicklogApi.listQuicklogEntries };
});

// 当前用户 id（关联会话仅本人过滤依据）
vi.mock("@/stores/session", () => ({
  useSession: (
    selector: (s: {
      user: { id: string } | null;
      accessToken: string | null;
      hydrated: boolean;
    }) => unknown,
  ) =>
    selector({ user: { id: "user-1" }, accessToken: "tok", hydrated: true }),
}));

import { MobileChangeDetail } from "@/components/mobile/mobile-change-detail";
import type { ChangeRead } from "@/lib/changes";

// ── fixtures ────────────────────────────────────────────────────────────────

function makeChange(overrides: Partial<ChangeRead> = {}): ChangeRead {
  return {
    id: "c1",
    workspace_id: "ws-1",
    change_key: "2026-08-26-mobile-workspace-page",
    title: "工作区移动端页面",
    status: "in_progress",
    location: "active",
    path: ".sillyspec/changes/2026-08-26-mobile-workspace-page",
    affected_components: [],
    change_type: null,
    owner_id: null,
    current_stage: "plan",
    pending_review: "plan_review",
    stages: null,
    approval_status: null,
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    created_at: "2026-08-26T10:00:00Z",
    updated_at: "2026-08-26T15:00:00Z",
    archived_at: null,
    step_progress: null,
    steps: [
      {
        name: "代码扫描完成",
        stage: "brainstorm",
        status: "completed",
        output: null,
        completed_at: "2026-08-26T15:00:00Z",
        ordering: 1,
        wait_reason: null,
        kind: "step",
      },
      {
        name: "需求探索",
        stage: "brainstorm",
        status: "in-progress",
        output: null,
        completed_at: null,
        ordering: 2,
        wait_reason: null,
        kind: "step",
      },
    ],
    owner_name: null,
    ...overrides,
  };
}

describe("MobileChangeDetail 审批操作卡（submitStageReview 唯一入口）", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    changesApi.getChange.mockResolvedValue(makeChange());
    changesApi.submitStageReview.mockResolvedValue({
      change: makeChange({ pending_review: null }),
      agent_dispatch: null,
      notified_session: true,
      notify_error: null,
    });
    changesApi.getAgentStatus.mockResolvedValue({
      has_active_run: false,
      config_enabled: false,
      last_dispatch: null,
    });
    changeFilesApi.listChangeFiles.mockResolvedValue({
      change_id: "c1",
      items: [
        {
          path: "design.md",
          name: "design.md",
          size: 23000,
          last_modified_at: null,
          is_text: true,
        },
      ],
    });
    changeFilesApi.fetchChangeFileRaw.mockResolvedValue(
      new Blob(["# design"], { type: "text/markdown" }),
    );
    daemonApi.listChangeSessions.mockResolvedValue([
      {
        id: "s1",
        provider: "claude",
        status: "active",
        turn_count: 2,
        mode: "page",
        author: { user_id: "user-1", display_name: "qinyi" },
        last_active_at: "2026-08-26T15:30:00Z",
        title: "主控会话",
      },
      {
        id: "s2",
        provider: "claude",
        status: "ended",
        turn_count: 1,
        mode: "page",
        author: { user_id: "user-2", display_name: "other" },
        last_active_at: "2026-08-25T15:30:00Z",
        title: "他人会话",
      },
    ]);
    quicklogApi.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.clearAllMocks();
  });

  function renderDetail() {
    const onOpenSession = vi.fn();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MobileChangeDetail
          changeId="c1"
          workspaceId="ws-1"
          onOpenSession={onOpenSession}
        />
      </QueryClientProvider>,
    );
    return { onOpenSession, ...view };
  }

  it("审批通过：内联二次确认后 submitStageReview(plan_approve, comment) + invalidate 列表前缀与详情 key", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    renderDetail();
    // 有待办 → 审批卡默认展开，标题经 PENDING_REVIEW_LABEL 映射（task-05 契约）
    expect(await screen.findByTestId("m-change-review-card")).toBeVisible();
    expect(screen.getByText(/待计划审核/)).toBeInTheDocument();
    // 详情 query key 逐字对齐桌面 ["change", wid, cid]（缓存落键即证 key 形态）
    await waitFor(() => {
      expect(queryClient.getQueryData(["change", "ws-1", "c1"])).toBeTruthy();
    });
    // 填意见 → 点通过 → 内联二次确认 → 确认提交
    fireEvent.change(screen.getByTestId("m-change-review-comment"), {
      target: { value: "同意，按方案 A 推进" },
    });
    fireEvent.click(screen.getByRole("button", { name: /通过并推进/ }));
    expect(await screen.findByTestId("m-change-review-confirm")).toBeVisible();
    fireEvent.click(screen.getByTestId("m-change-review-confirm-ok"));
    await waitFor(() => {
      expect(changesApi.submitStageReview).toHaveBeenCalledWith(
        "ws-1",
        "c1",
        "plan_approve",
        "同意，按方案 A 推进",
        true,
      );
    });
    // 成功提示 + invalidate ["changes", workspaceId] 前缀 + 详情 key 重取
    expect(await screen.findByTestId("m-change-review-success")).toBeVisible();
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["changes", "ws-1"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["change", "ws-1", "c1"],
      });
    });
  });

  it("审批驳回：human_test → test_bug，无意见时 comment=undefined", async () => {
    changesApi.getChange.mockResolvedValue(
      makeChange({ pending_review: "human_test" }),
    );
    renderDetail();
    await screen.findByTestId("m-change-review-card");
    fireEvent.click(screen.getByRole("button", { name: /驳回/ }));
    fireEvent.click(await screen.findByTestId("m-change-review-confirm-ok"));
    await waitFor(() => {
      expect(changesApi.submitStageReview).toHaveBeenCalledWith(
        "ws-1",
        "c1",
        "test_bug",
        undefined,
        true,
      );
    });
  });

  it("archive_confirm：无驳回按钮，通过动作 action=archive_confirm", async () => {
    changesApi.getChange.mockResolvedValue(
      makeChange({ pending_review: "archive_confirm" }),
    );
    renderDetail();
    await screen.findByTestId("m-change-review-card");
    expect(screen.queryByRole("button", { name: /驳回/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /确认归档/ }));
    fireEvent.click(await screen.findByTestId("m-change-review-confirm-ok"));
    await waitFor(() => {
      expect(changesApi.submitStageReview).toHaveBeenCalledWith(
        "ws-1",
        "c1",
        "archive_confirm",
        undefined,
        true,
      );
    });
  });

  it("无待办：折叠只读卡替代审批操作区", async () => {
    changesApi.getChange.mockResolvedValue(makeChange({ pending_review: null }));
    const { container } = renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("m-change-review-idle")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("m-change-review-card"),
    ).not.toBeInTheDocument();
    expect(container.querySelector("textarea")).not.toBeInTheDocument();
  });
});

describe("MobileChangeDetail 文档卡 / 引导条 / 步骤条 / 会话 / 时间线 / quicklog", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    changesApi.getChange.mockResolvedValue(makeChange());
    changesApi.submitStageReview.mockResolvedValue({
      change: makeChange({ pending_review: null }),
      agent_dispatch: null,
      notified_session: true,
      notify_error: null,
    });
    changesApi.getAgentStatus.mockResolvedValue({
      has_active_run: false,
      config_enabled: false,
      last_dispatch: null,
    });
    changeFilesApi.listChangeFiles.mockResolvedValue({
      change_id: "c1",
      items: [
        {
          path: "design.md",
          name: "design.md",
          size: 23000,
          last_modified_at: null,
          is_text: true,
        },
      ],
    });
    changeFilesApi.fetchChangeFileRaw.mockResolvedValue(
      new Blob(["# design"], { type: "text/markdown" }),
    );
    daemonApi.listChangeSessions.mockResolvedValue([]);
    quicklogApi.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.clearAllMocks();
  });

  function renderDetail() {
    const onOpenSession = vi.fn();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MobileChangeDetail
          changeId="c1"
          workspaceId="ws-1"
          onOpenSession={onOpenSession}
        />
      </QueryClientProvider>,
    );
    return { onOpenSession, ...view };
  }

  it("文档 chip 点击打开 FilePreviewModal（defaultFullscreen=true，fetch 走 fetchChangeFileRaw）", async () => {
    renderDetail();
    const stub = await screen.findByTestId("file-preview-modal-stub");
    // 初始关闭
    expect(stub.getAttribute("data-open")).toBe("false");
    fireEvent.click(
      screen.getByRole("button", { name: /全屏预览 design\.md/ }),
    );
    await waitFor(() => {
      expect(stub.getAttribute("data-open")).toBe("true");
    });
    // 全屏直出 + 目标文件名
    expect(stub.getAttribute("data-fullscreen")).toBe("true");
    expect(stub.getAttribute("data-name")).toBe("design.md");
    // target.fetch 走 raw 端点封装（fetchChangeFileRaw(ws, cid, path)）
    fireEvent.click(screen.getByRole("button", { name: "桩拉取" }));
    await waitFor(() => {
      expect(changeFilesApi.fetchChangeFileRaw).toHaveBeenCalledWith(
        "ws-1",
        "c1",
        "design.md",
      );
    });
  });

  it("任务区桌面引导条渲染（D-002）", async () => {
    renderDetail();
    const guide = await screen.findByTestId("m-change-desktop-guide");
    expect(guide.textContent).toContain("任务看板与任务执行页请到电脑端操作");
  });

  it("步骤条：横向滚动容器 + 六阶段标签 + 当前阶段高亮 + 非线性阶段降级不渲染", async () => {
    const { container } = renderDetail();
    const stepper = await screen.findByTestId("m-change-stage-steps");
    // 横向滚动容器（自绘紧凑版核心约束，C-15）
    expect(stepper.className).toContain("overflow-x-auto");
    // 六阶段标签（scan + 主线五阶段，STAGE_LABELS 复用；within 限定步骤条内，
    // 避免与时间线 stage 组头同名标签（需求分析）冲突）
    for (const label of ["扫描", "需求分析", "规划", "执行", "验证", "归档"]) {
      expect(within(stepper).getByText(label)).toBeInTheDocument();
    }
    // 当前阶段（current_stage=plan）节点高亮，标签为「规划」
    const current = container.querySelector(
      '[data-testid="m-change-stage-steps"] [data-status="current"]',
    );
    expect(current).toBeTruthy();
    expect(current?.nextElementSibling?.textContent).toBe("规划");
    // 非线性阶段（quick）不渲染步骤条（对齐桌面 null 降级）。
    // 同 key 缓存先显旧数据（plan 步骤条），后台 refetch 落 quick 后步骤条卸载。
    changesApi.getChange.mockResolvedValue(makeChange({ current_stage: "quick" }));
    cleanup();
    renderDetail();
    await screen.findByTestId("m-change-desktop-guide");
    await waitFor(() => {
      expect(screen.queryByTestId("m-change-stage-steps")).not.toBeInTheDocument();
    });
  });

  it("关联会话卡：仅本人过滤计数 + 点击触发 onOpenSession 回调", async () => {
    daemonApi.listChangeSessions.mockResolvedValue([
      {
        id: "s1",
        provider: "claude",
        status: "active",
        turn_count: 2,
        mode: "page",
        author: { user_id: "user-1", display_name: "qinyi" },
        last_active_at: "2026-08-26T15:30:00Z",
        title: "主控会话",
      },
      {
        id: "s2",
        provider: "claude",
        status: "ended",
        turn_count: 1,
        mode: "page",
        author: { user_id: "user-2", display_name: "other" },
        last_active_at: "2026-08-25T15:30:00Z",
        title: "他人会话",
      },
    ]);
    const { onOpenSession } = renderDetail();
    const card = await screen.findByTestId("m-change-sessions-card");
    // 仅本人过滤 → 计数 1（他人会话不计）；副行含进行中数
    await waitFor(() => {
      expect(card.textContent).toContain("关联会话 · 1");
      expect(card.textContent).toContain("含 1 个进行中会话");
    });
    fireEvent.click(card.querySelector("button")!);
    expect(onOpenSession).toHaveBeenCalledTimes(1);
  });

  it("时间线：纯内容复用 ChangeStepTimeline（默认展开渲染 steps 明细）", async () => {
    renderDetail();
    await screen.findByTestId("change-step-timeline");
    expect(screen.getByText("代码扫描完成")).toBeInTheDocument();
    expect(screen.getByText("需求探索")).toBeInTheDocument();
  });

  it("quicklog 关联：有条目渲染折叠卡；拉取失败静默隐藏", async () => {
    quicklogApi.listQuicklogEntries.mockResolvedValue({
      items: [
        {
          ql_id: "ql-20260826-011",
          timestamp: "2026-08-26T15:00:00Z",
          title: "会话输入框 @提及防抖",
          status: "in_progress",
          status_note: null,
          placeholder: false,
        },
      ],
      total: 1,
    });
    renderDetail();
    const card = await screen.findByTestId("m-change-quicklog-card");
    expect(card.textContent).toContain("关联的快速任务（1）");
    // 失败静默：区块隐藏，不影响详情主内容（对齐桌面卡约束）。
    // 换新 QueryClient 复刻「首载即失败」场景（旧缓存会保住旧数据短时可见）。
    cleanup();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    quicklogApi.listQuicklogEntries.mockRejectedValue(new Error("网络失败"));
    renderDetail();
    await screen.findByTestId("m-change-desktop-guide");
    expect(screen.queryByTestId("m-change-quicklog-card")).not.toBeInTheDocument();
  });
});
