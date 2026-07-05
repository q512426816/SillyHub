/**
 * task-08: WorkspaceConfigCard 组件测试。
 *
 * 覆盖 design §5.3 六状态分支 + §5.4 编辑就地展开/保存/收起 + §5.5 cache_root tooltip
 * + §10 R-01 五个操作按钮行为（initPollRef/syncPollRef 轮询、5min 上限、visibilitychange
 * 暂停、409 重扫确认、owner 门禁、卸载清理）。
 *
 * 承载 AC-04/05/06/07/09，FR-006/007/008 的验证证据。
 *
 * 注：组件本身（task-01~06 产物）不变；测试以行为契约，断言文本/testid/role 而非实现细节。
 */
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceConfigCard } from "@/components/workspace-config-card";
import type { DaemonInstanceRead } from "@/lib/daemon";
import type { SpecWorkspace } from "@/lib/spec-workspaces";
import type { Workspace } from "@/lib/workspaces";
import type { MemberBindingView } from "@/lib/workspace-binding";

// ── next/link mock（AccessGuide 内部用 Link，避免 jsdom 警告）──────────────────
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── AgentRunPanel 整体 mock（隔离 SSE + markdown-text jsdom null 已知坑）─────────
vi.mock("@/components/agent-run-panel", () => ({
  AgentRunPanel: ({ onDone }: { onDone?: (status: string) => void }) => (
    <div data-testid="agent-run-panel-mock">
      <button onClick={() => onDone?.("completed")}>模拟扫描完成</button>
    </div>
  ),
}));

// ── WorkspaceAccessGuide mock（避免其内部 daemon 列表加载链）────────────────────
// 暴露最近一次 props（workspaceId/initial/onConfigured）以便编辑流程断言。
const accessGuideMock = vi.hoisted(() => ({
  lastProps: null as null | {
    workspaceId: string;
    initial?: { daemon_id: string | null; root_path: string; path_source: string } | null;
    onConfigured: () => void;
  },
  renderCount: 0,
}));
vi.mock("@/components/workspace-access-guide", () => ({
  WorkspaceAccessGuide: (props: {
    workspaceId: string;
    onConfigured: () => void;
    initial?: { daemon_id: string | null; root_path: string; path_source: string } | null;
  }) => {
    accessGuideMock.renderCount += 1;
    accessGuideMock.lastProps = props;
    const editing = !!props.initial;
    return (
      <div data-testid="workspace-access-guide">
        <span data-testid="access-guide-mode">{editing ? "edit" : "first"}</span>
        {editing && (
          <span data-testid="access-guide-initial">
            {JSON.stringify(props.initial)}
          </span>
        )}
        <button
          data-testid="access-guide-configured"
          onClick={() => props.onConfigured()}
        >
          模拟保存
        </button>
      </div>
    );
  },
}));

// ── lib mock（参考 page.test.tsx hoisted 模式）────────────────────────────────
const bindingApi = vi.hoisted(() => ({
  fetchMyBinding: vi.fn(),
  upsertMyBinding: vi.fn(),
}));
vi.mock("@/lib/workspace-binding", () => ({
  fetchMyBinding: bindingApi.fetchMyBinding,
  upsertMyBinding: bindingApi.upsertMyBinding,
}));

const specApi = vi.hoisted(() => ({
  getSpecWorkspace: vi.fn(),
  initDispatch: vi.fn(),
  syncManual: vi.fn(),
  listPendingSync: vi.fn(),
  importSpecWorkspace: vi.fn(),
  generateProjects: vi.fn(),
}));
vi.mock("@/lib/spec-workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/spec-workspaces")>(
    "@/lib/spec-workspaces",
  );
  return {
    ...actual,
    getSpecWorkspace: specApi.getSpecWorkspace,
    initDispatch: specApi.initDispatch,
    syncManual: specApi.syncManual,
    listPendingSync: specApi.listPendingSync,
    importSpecWorkspace: specApi.importSpecWorkspace,
    generateProjects: specApi.generateProjects,
  };
});

const workspacesApi = vi.hoisted(() => ({
  scanGenerate: vi.fn(),
}));
vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>(
    "@/lib/workspaces",
  );
  return { ...actual, scanGenerate: workspacesApi.scanGenerate };
});

const daemonApi = vi.hoisted(() => ({
  listDaemonInstances: vi.fn(),
}));
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, listDaemonInstances: daemonApi.listDaemonInstances };
});

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeWorkspace(
  overrides: Partial<Workspace> = {},
): Workspace {
  return {
    id: "ws-1",
    name: "multi-agent-platform",
    slug: "multi-agent-platform",
    root_path: "C:/proj/multi-agent-platform",
    status: "active",
    path_source: "daemon-client",
    daemon_runtime_id: null, // daemon-entity-binding 后新工作区恒 NULL（绑定存 member binding 行），见 ql-20260705-001
    default_agent: null,
    default_model: null,
    owner: { user_id: "user-1", email: "owner@test.com", display_name: "Owner" },
    created_at: "2026-06-30T00:55:11Z",
    last_scanned_at: "2026-06-30T00:55:11Z",
    ...overrides,
  } as unknown as Workspace;
}

function makeSpecWs(
  overrides: Partial<SpecWorkspace> = {},
): SpecWorkspace {
  return {
    id: "sw-1",
    workspace_id: "ws-1",
    spec_root: "/data/spec-workspaces/ws-1",
    strategy: "platform-managed",
    repo_sillyspec_path: null,
    profile_version: "0.1.0",
    sync_status: "clean",
    last_synced_at: "2026-06-30T00:55:27Z",
    created_at: "2026-06-30T00:55:12Z",
    updated_at: "2026-06-30T00:55:27Z",
    ...overrides,
  } as unknown as SpecWorkspace;
}

function makeBinding(
  overrides: Partial<MemberBindingView> = {},
): MemberBindingView {
  return {
    workspace_id: "ws-1",
    user_id: "user-1",
    daemon_id: "daemon-1",
    runtime_id: "rid-1",
    root_path: "C:/proj/multi-agent-platform",
    path_source: "daemon-client",
    synced_at: "2026-06-30T01:00:00Z",
    last_scan_at: null,
    init_synced_at: null,
    init_synced_spec_version: null,
    ...overrides,
  } as unknown as MemberBindingView;
}

function makeDaemon(
  overrides: Partial<DaemonInstanceRead> = {},
): DaemonInstanceRead {
  return {
    id: "daemon-1",
    hostname: "DESKTOP-ABC",
    display_alias: "我的本机守护进程",
    status: "online",
    providers: [{ provider: "claude", configured: true }],
    ...overrides,
  } as unknown as DaemonInstanceRead;
}

function renderCard(overrides: {
  workspace?: Workspace;
  specWs?: SpecWorkspace | null;
  myBinding?: MemberBindingView | null;
  boundDaemon?: DaemonInstanceRead | null;
  isOwner?: boolean;
  componentCount?: number;
  onRefresh?: () => void;
}) {
  const onRefresh = overrides.onRefresh ?? vi.fn();
  const utils = render(
    <WorkspaceConfigCard
      workspace={overrides.workspace ?? makeWorkspace()}
      specWs={overrides.specWs === undefined ? makeSpecWs() : overrides.specWs}
      myBinding={
        overrides.myBinding === undefined ? makeBinding() : overrides.myBinding
      }
      boundDaemon={
        overrides.boundDaemon === undefined
          ? makeDaemon()
          : overrides.boundDaemon
      }
      isOwner={overrides.isOwner ?? true}
      onRefresh={onRefresh}
      componentCount={overrides.componentCount ?? 0}
    />,
  );
  return { ...utils, onRefresh };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WorkspaceConfigCard 六状态分支（design §5.3 / AC-05）", () => {
  afterEach(() => {
    cleanup();
    accessGuideMock.lastProps = null;
    accessGuideMock.renderCount = 0;
  });

  it("① loading（myBinding=null + specWs=null）：仍渲染卡片骨架占位（不抛错）", () => {
    // 父组件 page.tsx 负责 fetch；本组件只需在 specWs=null 时显示空态、binding=null 时显示首次引导
    renderCard({ specWs: null, myBinding: null });
    // 「工作区文档存储」组未关联 Spec Workspace 空态
    expect(
      screen.getByText(/当前工作区尚未关联 Spec Workspace/),
    ).toBeInTheDocument();
    // 「我的接入」首次引导渲染
    expect(screen.getByTestId("workspace-access-guide")).toBeInTheDocument();
  });

  it("② error 上抛：组件本身不 fetch，渲染已有的 binding（不会进入错误态）", () => {
    // 组件不直接 fetch，错误处理由 page.tsx 负责；这里验证传入 binding=null 时不崩
    renderCard({ myBinding: null });
    expect(screen.getByText(/编辑|我的接入|未绑定/)).toBeTruthy();
  });

  it("③ 未绑定（myBinding=null）：渲染 AccessGuide 首次模式 + spec_root 仍展示", () => {
    renderCard({ myBinding: null });
    // AccessGuide 首次模式（无 initial）
    expect(screen.getByTestId("access-guide-mode")).toHaveTextContent("first");
    expect(screen.queryByTestId("config-edit-entry")).not.toBeInTheDocument();
    // 文档存储组 spec_root 仍展示
    expect(screen.getByText("/data/spec-workspaces/ws-1")).toBeInTheDocument();
  });

  it("④ 已绑定·未初始化（init_synced_at=null）：amber「未初始化」徽标 + 初始化按钮", () => {
    renderCard({ myBinding: makeBinding({ init_synced_at: null }) });
    expect(screen.getByText("未初始化")).toBeInTheDocument();
    expect(screen.queryByText("已初始化")).not.toBeInTheDocument();
    // 头部初始化按钮（platform-managed 策略下）
    expect(screen.getByRole("button", { name: "初始化" })).toBeInTheDocument();
  });

  it("⑤ 已绑定·已初始化（init_synced_at 非空）：emerald「已初始化」徽标 + 时间 + v{spec_version}", () => {
    renderCard({
      myBinding: makeBinding({
        init_synced_at: "2026-06-30T02:00:00Z",
        init_synced_spec_version: 3,
      }),
    });
    expect(screen.getByText("已初始化")).toBeInTheDocument();
    expect(screen.queryByText("未初始化")).not.toBeInTheDocument();
    // spec_version 展示
    expect(screen.getByText(/（v3）/)).toBeInTheDocument();
  });

  it("⑥ server-local（path_source==='server-local'）：隐藏「绑定守护进程」「守护进程本地缓存」+ 显示服务器本地说明", () => {
    const ws = makeWorkspace({ path_source: "server-local" });
    renderCard({
      workspace: ws,
      myBinding: makeBinding({ path_source: "server-local" }),
    });
    // 服务器本地说明
    expect(
      screen.getByTestId("server-local-no-daemon"),
    ).toHaveTextContent("服务器本地工作区，无需守护进程");
    // 「守护进程本地缓存」字段不渲染
    expect(screen.queryByText("守护进程本地缓存")).not.toBeInTheDocument();
    // 但「服务器文档目录」仍展示
    expect(screen.getByText("/data/spec-workspaces/ws-1")).toBeInTheDocument();
  });
});

describe("WorkspaceConfigCard 编辑流程（design §5.4 / AC-06）", () => {
  afterEach(() => {
    cleanup();
    accessGuideMock.lastProps = null;
    accessGuideMock.renderCount = 0;
  });

  it("点「编辑我的接入」→ 就地展开 AccessGuide 编辑模式（回填当前 binding）", () => {
    const binding = makeBinding({
      daemon_id: "daemon-1",
      root_path: "C:/proj/foo",
      path_source: "daemon-client",
    });
    renderCard({ myBinding: binding });

    // 默认未展开
    expect(screen.queryByTestId("access-guide-mode")).not.toBeInTheDocument();

    // 点击编辑
    fireEvent.click(screen.getByTestId("config-edit-entry"));
    // AccessGuide 编辑模式渲染，回填 initial
    expect(screen.getByTestId("access-guide-mode")).toHaveTextContent("edit");
    expect(accessGuideMock.lastProps).not.toBeNull();
    expect(accessGuideMock.lastProps?.initial).toEqual({
      daemon_id: "daemon-1",
      root_path: "C:/proj/foo",
      path_source: "daemon-client",
    });
  });

  it("保存（onConfigured 触发）→ onRefresh 调用 + 表单收起", () => {
    const onRefresh = vi.fn();
    renderCard({ onRefresh });

    // 展开
    fireEvent.click(screen.getByTestId("config-edit-entry"));
    expect(screen.getByTestId("workspace-access-guide")).toBeInTheDocument();

    // 模拟保存
    fireEvent.click(screen.getByTestId("access-guide-configured"));

    // onRefresh 被调用 + 表单收起
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("workspace-access-guide")).not.toBeInTheDocument();
    // 编辑按钮重新可见且文案恢复
    expect(screen.getByTestId("config-edit-entry")).toHaveTextContent("编辑我的接入");
  });
});

describe("WorkspaceConfigCard cache_root tooltip（design §5.5 / D-004 / AC-04）", () => {
  afterEach(() => cleanup());

  it("daemon-client 工作区「守护进程本地缓存」字段 title 含 ~ + Windows/macOS/Linux 三平台", () => {
    renderCard({});
    // dd 元素 title 含三平台解释
    const cacheDd = screen.getByText("~/.sillyhub/daemon/specs/ws-1");
    expect(cacheDd).toBeInTheDocument();
    const title = cacheDd.getAttribute("title") ?? "";
    expect(title).toContain("~");
    expect(title).toContain("C:\\Users\\<你>");
    expect(title).toContain("/home/<你>");
  });

  it("server-local 工作区不渲染「守护进程本地缓存」字段", () => {
    const ws = makeWorkspace({ path_source: "server-local" });
    renderCard({
      workspace: ws,
      myBinding: makeBinding({ path_source: "server-local" }),
    });
    expect(screen.queryByText("守护进程本地缓存")).not.toBeInTheDocument();
    expect(
      screen.queryByText("~/.sillyhub/daemon/specs/ws-1"),
    ).not.toBeInTheDocument();
  });
});

describe("WorkspaceConfigCard 操作按钮（design §10 R-01 / AC-07）", () => {
  beforeEach(() => {
    // 只 fake timer API，不 fake Date/performance；保留 microtask 正常 flush。
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  // 辅助：fake timer 下用 advanceTimersByTimeAsync(0) flush microtask，等待 mockResolvedValue resolve。
  async function flushMicrotasks(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  it("初始化：点击 → initDispatch 调用 → 2s 轮询 fetchMyBinding 直到 init_synced_at 非空 → onRefresh", async () => {
    const onRefresh = vi.fn();
    const binding = makeBinding({ init_synced_at: null });
    specApi.initDispatch.mockResolvedValue({
      lease_id: "lease-1",
      runtime_id: "rid-1",
      claim_token: "tok",
    });
    // 第一次轮询仍 null，第二次拿到 init_synced_at
    bindingApi.fetchMyBinding
      .mockResolvedValueOnce({ ...binding, init_synced_at: null })
      .mockResolvedValueOnce({
        ...binding,
        init_synced_at: "2026-07-01T00:00:00Z",
        init_synced_spec_version: 1,
      });

    renderCard({ myBinding: binding, onRefresh });

    fireEvent.click(screen.getByRole("button", { name: "初始化" }));
    // flush microtask 让 await initDispatch resolve + setInterval 注册
    await flushMicrotasks();
    await flushMicrotasks();
    expect(specApi.initDispatch).toHaveBeenCalledWith("ws-1");

    // 快进 2s：触发第一次轮询（仍 null）
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();
    expect(bindingApi.fetchMyBinding).toHaveBeenCalledTimes(1);

    // 快进 2s：第二次轮询拿到 init_synced_at → 停止轮询 + onRefresh
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();
    expect(bindingApi.fetchMyBinding).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalled();

    // 轮询已停止：再快进 4s 不应有第 3 次 fetch
    const callsAfter = bindingApi.fetchMyBinding.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    await flushMicrotasks();
    expect(bindingApi.fetchMyBinding.mock.calls.length).toBe(callsAfter);
  });

  it("初始化轮询：document.hidden=true 时跳过（visibilitychange 暂停 D-005）", async () => {
    const binding = makeBinding({ init_synced_at: null });
    specApi.initDispatch.mockResolvedValue({
      lease_id: "lease-1",
      runtime_id: "rid-1",
      claim_token: "tok",
    });
    bindingApi.fetchMyBinding.mockResolvedValue(binding);

    renderCard({ myBinding: binding });

    fireEvent.click(screen.getByRole("button", { name: "初始化" }));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(specApi.initDispatch).toHaveBeenCalled();

    // 模拟页面隐藏
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    // 快进 2s + 4s：document.hidden=true，轮询被跳过
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(4000);
    await flushMicrotasks();
    expect(bindingApi.fetchMyBinding).not.toHaveBeenCalled();

    // 恢复可见后下一 tick 轮询恢复
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();
    expect(bindingApi.fetchMyBinding).toHaveBeenCalled();
  });

  it("同步：syncManual 返 pending → 2s 轮询 listPendingSync 直到 done → 按钮显示「已同步」", async () => {
    const onRefresh = vi.fn();
    const binding = makeBinding({
      init_synced_at: "2026-06-30T02:00:00Z",
      init_synced_spec_version: 1,
    });
    specApi.syncManual.mockResolvedValue({ status: "pending", task_id: "t-1" });
    // 第一次 listPendingSync 仍 pending，第二次 done
    specApi.listPendingSync
      .mockResolvedValueOnce([
        { id: "t-1", workspace_id: "ws-1", runtime_id: "rid-1", change_key: "k", kind: "spec-sync", status: "pending", created_at: "2026-07-01T00:00:00Z" },
      ])
      .mockResolvedValueOnce([
        { id: "t-1", workspace_id: "ws-1", runtime_id: "rid-1", change_key: "k", kind: "spec-sync", status: "done", created_at: "2026-07-01T00:00:00Z" },
      ]);

    renderCard({ myBinding: binding, componentCount: 5, onRefresh });

    fireEvent.click(screen.getByRole("button", { name: "同步到服务器" }));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(specApi.syncManual).toHaveBeenCalledWith("ws-1");

    // 第一次轮询：pending → 继续
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();
    expect(specApi.listPendingSync).toHaveBeenCalledTimes(1);

    // 第二次轮询：done → 停止 + onRefresh + 按钮变「已同步」
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();
    expect(specApi.listPendingSync).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "已同步" })).toBeInTheDocument();

    // 轮询已停止：再快进 4s 不应有第 3 次
    const callsAfter = specApi.listPendingSync.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    await flushMicrotasks();
    expect(specApi.listPendingSync.mock.calls.length).toBe(callsAfter);
  });

  it("同步 5min 上限：超时后 syncStatus=failed + syncError 非空", async () => {
    const binding = makeBinding({
      init_synced_at: "2026-06-30T02:00:00Z",
      init_synced_spec_version: 1,
    });
    specApi.syncManual.mockResolvedValue({ status: "pending", task_id: "t-1" });
    // listPendingSync 始终返回 pending（永不 done）
    specApi.listPendingSync.mockResolvedValue([
      { id: "t-1", workspace_id: "ws-1", runtime_id: "rid-1", change_key: "k", kind: "spec-sync", status: "pending", created_at: "2026-07-01T00:00:00Z" },
    ]);

    renderCard({ myBinding: binding, componentCount: 5 });

    fireEvent.click(screen.getByRole("button", { name: "同步到服务器" }));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(specApi.syncManual).toHaveBeenCalled();

    // 快进 5min+：超时 setTimeout 触发
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    await flushMicrotasks();

    // 同步失败提示出现
    expect(screen.getByText("同步失败。")).toBeInTheDocument();
    expect(screen.getByText("仍在排队，请稍后再试")).toBeInTheDocument();
  });

  it("扫描：isOwner=false 时扫描按钮 disabled + title 提示", () => {
    const ws = makeWorkspace({ path_source: "daemon-client" });
    renderCard({ workspace: ws, isOwner: false });

    const scanBtn = screen.getByRole("button", { name: "扫描" });
    expect(scanBtn).toBeDisabled();
    expect(scanBtn).toHaveAttribute("title", "仅 owner 可扫描");
  });

  it("扫描：componentCount>0 弹 confirm（确认 false 不调用 scanGenerate）", () => {
    const ws = makeWorkspace({ path_source: "daemon-client" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    workspacesApi.scanGenerate.mockResolvedValue({
      workspace_id: "ws-1",
      agent_run_id: "run-1",
      stream_url: "",
      status: "pending",
      spec_root: "",
      message: "",
    });

    renderCard({ workspace: ws, componentCount: 3 });

    fireEvent.click(screen.getByRole("button", { name: "扫描" }));
    expect(confirmSpy).toHaveBeenCalledWith("该工作区已有扫描结果，是否重新扫描？");
    expect(workspacesApi.scanGenerate).not.toHaveBeenCalled();
  });

  it("扫描：409 冲突 + 用户确认 → 二次调用 scanGenerate", async () => {
    const ws = makeWorkspace({ path_source: "daemon-client" });
    // 模拟 ApiError 409
    const { ApiError } = await import("@/lib/api");
    const err409 = new ApiError(409, {
      code: "scan_conflict",
      message: "已扫描",
      request_id: null,
      details: null,
    });
    workspacesApi.scanGenerate
      .mockRejectedValueOnce(err409)
      .mockResolvedValueOnce({
        workspace_id: "ws-1",
        agent_run_id: "run-1",
        stream_url: "",
        status: "pending",
        spec_root: "",
        message: "",
      });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderCard({ workspace: ws, componentCount: 0 });

    fireEvent.click(screen.getByRole("button", { name: "扫描" }));
    // flush microtask 让第一次 scanGenerate reject + catch 块跑完
    await flushMicrotasks();
    await flushMicrotasks();

    // 第一次调用 → 抛 409 → confirm → 第二次调用
    expect(workspacesApi.scanGenerate).toHaveBeenCalledTimes(2);
    expect(confirmSpy).toHaveBeenCalledWith("该工作区已有扫描结果，是否重新扫描？");
  });

  it("扫描：daemon_runtime_id=null + myBinding.daemon_id 非空 → scanGenerate 用 daemon_id 派发（ql-20260705-003 回归）", async () => {
    // 真实新数据：workspace.daemon_runtime_id 恒 NULL，稳定绑定键是 myBinding.daemon_id
    // （runtime_id 也不稳定，常为 null）。旧实现守卫读废弃字段静默丢弃点击 → ql-001 改读
    // runtime_id 仍 null；本用例锁定最终修复：派发键为 daemon_id（scanGenerate 第 7 参 daemonId）。
    const ws = makeWorkspace({ daemon_runtime_id: null });
    const binding = makeBinding({ daemon_id: "binding-daemon-1", runtime_id: null });
    workspacesApi.scanGenerate.mockResolvedValue({
      workspace_id: "ws-1",
      agent_run_id: "run-1",
      stream_url: "",
      status: "pending",
      spec_root: "",
      message: "",
    });

    renderCard({ workspace: ws, myBinding: binding, componentCount: 0 });

    fireEvent.click(screen.getByRole("button", { name: "扫描" }));
    await flushMicrotasks();

    // 守卫不拦（binding.daemon_id 非空）+ scanGenerate 第 7 参（daemonId）= binding.daemon_id
    expect(workspacesApi.scanGenerate).toHaveBeenCalledTimes(1);
    const callArgs = workspacesApi.scanGenerate.mock.calls[0];
    expect(callArgs?.[0]).toBe("C:/proj/multi-agent-platform"); // root_path
    expect(callArgs?.[4]).toBeNull(); // daemonRuntimeId：新链路不传（legacy 字段）
    expect(callArgs?.[6]).toBe("binding-daemon-1"); // daemonId 取自 myBinding.daemon_id
  });

  it("扫描：myBinding.daemon_id=null → 不调 scanGenerate + 显示未绑定提示（不再静默 return）", () => {
    const ws = makeWorkspace({ daemon_runtime_id: null });
    const binding = makeBinding({ daemon_id: null, runtime_id: null });

    renderCard({ workspace: ws, myBinding: binding, componentCount: 0 });

    fireEvent.click(screen.getByRole("button", { name: "扫描" }));

    expect(workspacesApi.scanGenerate).not.toHaveBeenCalled();
    expect(screen.getByText(/未绑定守护进程，无法扫描/)).toBeInTheDocument();
  });

  it("卸载清理：unmount 后轮询停止（initPollRef 不泄漏，行为断言）", async () => {
    const binding = makeBinding({ init_synced_at: null });
    specApi.initDispatch.mockResolvedValue({
      lease_id: "lease-1",
      runtime_id: "rid-1",
      claim_token: "tok",
    });
    bindingApi.fetchMyBinding.mockResolvedValue(binding);

    const { unmount } = renderCard({ myBinding: binding });
    fireEvent.click(screen.getByRole("button", { name: "初始化" }));
    await flushMicrotasks();
    await flushMicrotasks();

    // 触发一次轮询，让 initPollRef 注册
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();
    const callsBeforeUnmount = bindingApi.fetchMyBinding.mock.calls.length;
    expect(callsBeforeUnmount).toBeGreaterThan(0);

    // unmount 触发清理 effect（initPollRef clearInterval）
    unmount();

    // unmount 后再快进 6s：fetchMyBinding 调用次数不再增加（轮询已清理）
    await vi.advanceTimersByTimeAsync(6000);
    await flushMicrotasks();
    expect(bindingApi.fetchMyBinding.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
