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
import { ConfigProvider, Modal } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceConfigCard } from "@/components/workspace-config-card";
import type { DaemonInstanceRead } from "@/lib/daemon";
import type { SpecWorkspace } from "@/lib/spec-workspaces";
import type { Workspace } from "@/lib/workspaces";
import type { MemberBindingView } from "@/lib/workspace-binding";
import { useSession } from "@/stores/session";

// ── next/navigation mock（handleScan 用 router.push 跳转会话页）────────────
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
}));

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
    initial?: { daemon_id: string | null; root_path: string } | null;
    onConfigured: () => void;
  },
  renderCount: 0,
}));
vi.mock("@/components/workspace-access-guide", () => ({
  WorkspaceAccessGuide: (props: {
    workspaceId: string;
    onConfigured: () => void;
    initial?: { daemon_id: string | null; root_path: string } | null;
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

// ── task-09：token-refresh 局部 mock（401 单飞刷新重试用；其余导出保留真实）──────
const tokenRefreshApi = vi.hoisted(() => ({
  ensureFreshAccessToken: vi.fn(),
}));
vi.mock("@/lib/token-refresh", async () => {
  const actual = await vi.importActual<typeof import("@/lib/token-refresh")>(
    "@/lib/token-refresh",
  );
  return {
    ...actual,
    ensureFreshAccessToken: tokenRefreshApi.ensureFreshAccessToken,
  };
});

// ── task-09：antd 局部 mock（Button/Tooltip/Modal 走真实实现）。组件下载结果 toast ──
// 走 useNotify → App.useApp() 上下文 message，故在 App.useApp 上挂 mock 断言
// （对齐 session-config-bar.test.tsx FR-04 先例）；静态 message 同步替换兜底。
const antdToast = vi.hoisted(() => ({
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
  messageWarning: vi.fn(),
}));
vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  const AppWithMockUseApp = Object.assign(actual.App, {
    useApp: () => ({
      message: {
        success: antdToast.messageSuccess,
        error: antdToast.messageError,
        warning: antdToast.messageWarning,
      },
    }),
  });
  return {
    ...actual,
    App: AppWithMockUseApp,
    message: {
      success: antdToast.messageSuccess,
      error: antdToast.messageError,
      warning: antdToast.messageWarning,
    },
  };
});

// ── task-09：jsdom 未实现 URL.createObjectURL/revokeObjectURL——可控替身追踪生命周期 ──
// （对齐 explorer/__tests__/file-preview.test.tsx 先例）
let objectUrlSeq = 0;
const createObjectURL = vi.fn((_blob: Blob) => `blob:spec-bundle-${++objectUrlSeq}`);
const revokeObjectURL = vi.fn();
Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  writable: true,
  value: createObjectURL,
});
Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  writable: true,
  value: revokeObjectURL,
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
    // FR-04：W2 改 antd Button 后，两字中文按钮默认 autoInsertSpace 在字间插空格
    //（"扫 描"），getByRole({name:"扫描"}) 精确匹配失败。测试用 ConfigProvider 关掉
    // autoInsertSpace 让按钮文本干净（生产环境用户不可见差异，仅 jsdom 匹配需要）。
    <ConfigProvider button={{ autoInsertSpace: false }}>
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
      />
    </ConfigProvider>,
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
    });
    renderCard({ myBinding: binding });

    // 默认未展开
    expect(screen.queryByTestId("access-guide-mode")).not.toBeInTheDocument();

    // 点击编辑
    fireEvent.click(screen.getByTestId("config-edit-entry"));
    // AccessGuide 编辑模式渲染，回填 initial（path_source 是 member 级字段，
    // 2026-07-10 后不再透传到 AccessGuideInitial）
    expect(screen.getByTestId("access-guide-mode")).toHaveTextContent("edit");
    expect(accessGuideMock.lastProps).not.toBeNull();
    expect(accessGuideMock.lastProps?.initial).toEqual({
      daemon_id: "daemon-1",
      root_path: "C:/proj/foo",
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

  it("「守护进程本地缓存」字段 title 含 ~ + Windows/macOS/Linux 三平台", () => {
    renderCard({});
    // dd 元素 title 含三平台解释
    const cacheDd = screen.getByText("~/.sillyhub/daemon/specs/ws-1");
    expect(cacheDd).toBeInTheDocument();
    const title = cacheDd.getAttribute("title") ?? "";
    expect(title).toContain("~");
    expect(title).toContain("C:\\Users\\<你>");
    expect(title).toContain("/home/<你>");
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
    routerPush.mockReset();
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

  it("同步中：轮询 pending 带 files_total/processed → 展示 Progress N/M（FR-06）", async () => {
    const binding = makeBinding({
      init_synced_at: "2026-06-30T02:00:00Z",
      init_synced_spec_version: 1,
    });
    specApi.syncManual.mockResolvedValue({ status: "pending", task_id: "t-1" });
    // daemon 已上报 total=20 processed=8（walkComplete/ops.length 后）
    specApi.listPendingSync.mockResolvedValue([
      { task_id: "t-1", status: "pending", runtime_id: "rid-1", created_at: "2026-07-01T00:00:00Z", files_total: 20, files_processed: 8 },
    ]);

    renderCard({ myBinding: binding, componentCount: 5 });

    fireEvent.click(screen.getByRole("button", { name: "同步到服务器" }));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();

    // FR-06：Progress 条 + N/M 文案
    expect(screen.getByText("正在推送文件变更 8/20，请稍候...")).toBeInTheDocument();
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
        { task_id: "t-1", status: "pending", runtime_id: "rid-1", created_at: "2026-07-01T00:00:00Z" },
      ])
      .mockResolvedValueOnce([
        { task_id: "t-1", status: "done", runtime_id: "rid-1", created_at: "2026-07-01T00:00:00Z", files_total: 35, files_processed: 35 },
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
    // FR-05：终态计数展示「已成功推送 N 个文件」
    expect(screen.getByText("已成功推送 35 个文件到服务器。")).toBeInTheDocument();

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
      { task_id: "t-1", status: "pending", runtime_id: "rid-1", created_at: "2026-07-01T00:00:00Z" },
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

  it("同步失败：透传后端 latest.error（FR-01，非写死文案）", async () => {
    const binding = makeBinding({
      init_synced_at: "2026-06-30T02:00:00Z",
      init_synced_spec_version: 1,
    });
    specApi.syncManual.mockResolvedValue({ status: "pending", task_id: "t-1" });
    // 后端返 failed + error（如 NUL 500 / 超时原因）
    specApi.listPendingSync.mockResolvedValue([
      { task_id: "t-1", status: "failed", runtime_id: "rid-1", error: "invalid byte sequence 0x00", created_at: "2026-07-01T00:00:00Z" },
    ]);

    renderCard({ myBinding: binding, componentCount: 5 });

    fireEvent.click(screen.getByRole("button", { name: "同步到服务器" }));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();

    // FR-01：失败框显示后端真实 error，非写死「同步到服务器失败」
    expect(screen.getByText("同步失败。")).toBeInTheDocument();
    expect(screen.getByText("invalid byte sequence 0x00")).toBeInTheDocument();
  });

  it("同步失败：latest.error 为空时兜底通用文案（FR-01）", async () => {
    const binding = makeBinding({
      init_synced_at: "2026-06-30T02:00:00Z",
      init_synced_spec_version: 1,
    });
    specApi.syncManual.mockResolvedValue({ status: "pending", task_id: "t-1" });
    // 后端返 failed 但 error 为空（如 claim 超时 gc 未写 error）
    specApi.listPendingSync.mockResolvedValue([
      { task_id: "t-1", status: "failed", runtime_id: "rid-1", error: null, created_at: "2026-07-01T00:00:00Z" },
    ]);

    renderCard({ myBinding: binding, componentCount: 5 });

    fireEvent.click(screen.getByRole("button", { name: "同步到服务器" }));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();

    expect(screen.getByText("同步失败。")).toBeInTheDocument();
    expect(screen.getByText("同步到服务器失败")).toBeInTheDocument();
  });

  it("扫描：isOwner=false 时扫描按钮 disabled（FR-03 原因经 Tooltip 展示）", () => {
    const ws = makeWorkspace();
    renderCard({ workspace: ws, isOwner: false });

    // FR-02/03：W2 改 antd Button + Tooltip 包裹后，title 移到 Tooltip（jsdom 不渲染
    // hover tooltip 文本），故只断言 disabled 状态（原因文案在 Tooltip 生产可见）。
    const scanBtn = screen.getByRole("button", { name: "扫描" });
    expect(scanBtn).toBeDisabled();
  });

  it("扫描：componentCount>0 弹 Modal.confirm（确认 false 不调用 scanGenerate）", () => {
    const ws = makeWorkspace();
    // FR-04：W2 改 antd Modal.confirm（不再用 window.confirm）。spy Modal.confirm
    // 模拟用户点「取消」（调 onCancel → resolve(false)），不触发 onOk。
    const confirmSpy = vi.spyOn(Modal, "confirm").mockImplementation((opts) => {
      opts.onCancel?.(undefined as never);
      return { destroy: () => {} } as never;
    });
    workspacesApi.scanGenerate.mockResolvedValue({
      workspace_id: "ws-1",
      agent_run_id: "run-1",
      session_id: "sess-1",
      stream_url: "",
      status: "pending",
      spec_root: "",
      message: "",
    });

    renderCard({ workspace: ws, componentCount: 3 });

    fireEvent.click(screen.getByRole("button", { name: "扫描" }));
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "重新扫描" }),
    );
    expect(workspacesApi.scanGenerate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("扫描：409 冲突 + 用户确认 → 二次调用 scanGenerate", async () => {
    const ws = makeWorkspace();
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
        session_id: "sess-2",
        stream_url: "",
        status: "pending",
        spec_root: "",
        message: "",
      });
    // FR-04：Modal.confirm 模拟用户点「确认」（调 onOk → resolve(true)）
    const confirmSpy = vi.spyOn(Modal, "confirm").mockImplementation((opts) => {
      opts.onOk?.(undefined as never);
      return { destroy: () => {} } as never;
    });

    renderCard({ workspace: ws, componentCount: 0 });

    fireEvent.click(screen.getByRole("button", { name: "扫描" }));
    // flush microtask 让第一次 scanGenerate reject + catch 块跑完
    await flushMicrotasks();
    await flushMicrotasks();

    // 第一次调用 → 抛 409 → Modal.confirm → 第二次调用
    expect(workspacesApi.scanGenerate).toHaveBeenCalledTimes(2);
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "重新扫描" }),
    );
    // 第二次成功 → router.push 跳转含 session 参数
    expect(routerPush).toHaveBeenCalledWith(
      "/workspaces/ws-1/sessions?session=sess-2",
    );
    confirmSpy.mockRestore();
  });

  it("扫描：myBinding.daemon_id 非空 → scanGenerate 用 daemon_id 派发（ql-20260705-003 回归）", async () => {
    // 2026-07-10 后 workspace.daemon_runtime_id/path_source 已删，稳定绑定键是
    // myBinding.daemon_id（runtime_id 也不稳定，常为 null）。本用例锁定派发键为
    // daemon_id（scanGenerate 第 5 参 daemonId —— 新签名 rootPath/provider/model/specStrategy/daemonId）。
    const ws = makeWorkspace();
    const binding = makeBinding({ daemon_id: "binding-daemon-1", runtime_id: null });
    workspacesApi.scanGenerate.mockResolvedValue({
      workspace_id: "ws-1",
      agent_run_id: "run-1",
      session_id: "sess-3",
      stream_url: "",
      status: "pending",
      spec_root: "",
      message: "",
    });

    renderCard({ workspace: ws, myBinding: binding, componentCount: 0 });

    fireEvent.click(screen.getByRole("button", { name: "扫描" }));
    await flushMicrotasks();

    // 守卫不拦（binding.daemon_id 非空）+ scanGenerate 第 5 参（daemonId）= binding.daemon_id
    expect(workspacesApi.scanGenerate).toHaveBeenCalledTimes(1);
    const callArgs = workspacesApi.scanGenerate.mock.calls[0];
    expect(callArgs?.[0]).toBe("C:/proj/multi-agent-platform"); // root_path
    expect(callArgs?.[4]).toBe("binding-daemon-1"); // daemonId 取自 myBinding.daemon_id（新签名第 5 参）
    // handleScan 成功后 router.push 跳转含 session 参数
    expect(routerPush).toHaveBeenCalledWith(
      "/workspaces/ws-1/sessions?session=sess-3",
    );
  });

  it("扫描成功：router.push 跳转会话页（session_id 存在时带 ?session= 参数）", async () => {
    const ws = makeWorkspace();
    const binding = makeBinding({ daemon_id: "daemon-1" });
    workspacesApi.scanGenerate.mockResolvedValue({
      workspace_id: "ws-1",
      agent_run_id: "run-1",
      session_id: "sess-push-1",
      stream_url: "",
      status: "pending",
      spec_root: "",
      message: "",
    });

    renderCard({ workspace: ws, myBinding: binding, componentCount: 0 });

    fireEvent.click(screen.getByRole("button", { name: "扫描" }));
    await flushMicrotasks();

    expect(workspacesApi.scanGenerate).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith(
      "/workspaces/ws-1/sessions?session=sess-push-1",
    );
  });

  it("扫描成功：session_id 为空时 router.push 不带 ?session= 参数", async () => {
    const ws = makeWorkspace();
    const binding = makeBinding({ daemon_id: "daemon-1" });
    workspacesApi.scanGenerate.mockResolvedValue({
      workspace_id: "ws-1",
      agent_run_id: "run-1",
      session_id: null,
      stream_url: "",
      status: "pending",
      spec_root: "",
      message: "",
    });

    renderCard({ workspace: ws, myBinding: binding, componentCount: 0 });

    fireEvent.click(screen.getByRole("button", { name: "扫描" }));
    await flushMicrotasks();

    expect(workspacesApi.scanGenerate).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith("/workspaces/ws-1/sessions");
  });

  it("扫描：myBinding.daemon_id=null → 不调 scanGenerate + 显示未绑定提示（不再静默 return）", () => {
    const ws = makeWorkspace();
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

describe("WorkspaceConfigCard 下载文档包（task-09 / FR-06 / FR-08，design §7.2-§7.4）", () => {
  // downloadSpecBundle 走真实实现（specApi mock 展开保留 actual）+ 全局 fetch stub，
  // 断言完整鉴权 blob 下载链路（裸 fetch + Bearer → blob → objectURL → <a download>）。
  let appendedAnchor: HTMLAnchorElement | null;

  beforeEach(() => {
    appendedAnchor = null;
    // anchor click 置空（防 jsdom 导航 "Not implemented" 报错）；anchor 实例经
    // document.body.appendChild 捕获（download 属性 = 落盘文件名，append 后紧跟 click）。
    // appendChild 须穿透原实现——RTL render 挂载容器也走 document.body.appendChild。
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const realAppendChild = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, "appendChild").mockImplementation((node: Node) => {
      if (node instanceof HTMLAnchorElement) appendedAnchor = node;
      return realAppendChild(node);
    });
    // 默认已登录带 token（断言 Authorization Bearer 用）；刷新默认不可用（防意外网络）。
    useSession.setState({ accessToken: "tok-1", refreshToken: null, hydrated: true });
    tokenRefreshApi.ensureFreshAccessToken.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // session store 是模块级单例：还原默认态防泄漏到其它 describe。
    useSession.setState({ accessToken: null, refreshToken: null, hydrated: false });
  });

  /** 构造 bundle 端点 Response（真实 Headers，走 downloadSpecBundle 的 headers.get）。 */
  function bundleResponse(opts: {
    status?: number;
    disposition?: string;
    version?: string;
  } = {}): Response {
    return new Response(new Blob(["fake-tar-bytes"]), {
      status: opts.status ?? 200,
      headers: {
        ...(opts.disposition !== undefined
          ? { "Content-Disposition": opts.disposition }
          : {}),
        ...(opts.version !== undefined ? { "X-Spec-Version": opts.version } : {}),
      },
    });
  }

  /** 已初始化已扫描的 fixture（「同步到服务器」可见，与下载按钮成对）。 */
  const syncedBinding = () =>
    makeBinding({
      init_synced_at: "2026-06-30T02:00:00Z",
      init_synced_spec_version: 1,
    });

  it("specWs 就绪 + 已初始化已扫描：「下载文档包」与「同步到服务器」成对渲染；Tooltip 明示快照语义", async () => {
    renderCard({ myBinding: syncedBinding(), componentCount: 5 });

    // 推送/拉取语义成对（design §7.2）
    expect(screen.getByRole("button", { name: "同步到服务器" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载文档包" })).toBeInTheDocument();

    // 快照语义文案（design §7.4）：非实时同步 + daemon 任务/会话开始自动取新
    fireEvent.mouseEnter(screen.getByRole("button", { name: "下载文档包" }));
    await waitFor(() => {
      expect(screen.getByText(/非实时同步/)).toBeInTheDocument();
    });
    expect(screen.getByText(/任务开始\/会话开始/)).toBeInTheDocument();
  });

  it("未初始化（同步按钮隐藏）：下载按钮仍在——拉取不依赖本地缓存初始化（FR-06 入口全员可用）", () => {
    renderCard({}); // 默认 binding init_synced_at=null + componentCount=0
    expect(screen.queryByRole("button", { name: "同步到服务器" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载文档包" })).toBeInTheDocument();
  });

  it("下载链路：fetch 带 Bearer → blob objectURL → <a download> click（文件名取 Content-Disposition）→ revoke → 成功 toast 含版本号", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      bundleResponse({
        disposition: 'attachment; filename="spec-bundle-ws-1.tar"',
        version: "128",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderCard({ myBinding: syncedBinding(), componentCount: 5 });

    fireEvent.click(screen.getByRole("button", { name: "下载文档包" }));

    // 成功 toast：版本号读 X-Spec-Version（R-07 仅此一次性展示）
    await waitFor(() => expect(antdToast.messageSuccess).toHaveBeenCalled());
    expect(antdToast.messageSuccess).toHaveBeenCalledWith(
      "文档包已下载（快照版本 v128）",
    );
    expect(antdToast.messageError).not.toHaveBeenCalled();

    // 请求：既有 bundle 端点 + Authorization Bearer（鉴权 blob 范式）
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [reqUrl, reqInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(reqUrl).toBe("/api/workspaces/ws-1/spec-workspace/bundle");
    expect((reqInit?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok-1",
    );

    // objectURL 生命周期：create → anchor click → revoke（D-009 无泄漏）
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(appendedAnchor).not.toBeNull();
    expect(appendedAnchor?.getAttribute("download")).toBe("spec-bundle-ws-1.tar");
    expect(appendedAnchor?.href).toContain("blob:spec-bundle-");
    expect(revokeObjectURL).toHaveBeenCalledWith(
      createObjectURL.mock.results[0]?.value,
    );
    // 刷新未触发（非 401 不刷新）
    expect(tokenRefreshApi.ensureFreshAccessToken).not.toHaveBeenCalled();
  });

  it("Content-Disposition 缺失：文件名回退 spec-bundle-{wsId}.tar；无版本头 toast 不带版本号", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      bundleResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderCard({ myBinding: syncedBinding(), componentCount: 5 });

    fireEvent.click(screen.getByRole("button", { name: "下载文档包" }));

    await waitFor(() => expect(antdToast.messageSuccess).toHaveBeenCalled());
    expect(antdToast.messageSuccess).toHaveBeenCalledWith("文档包已下载");
    expect(appendedAnchor?.getAttribute("download")).toBe("spec-bundle-ws-1.tar");
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it("失败：非 2xx 抛 ApiError → 失败 toast 非静默，不触发 anchor click", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      bundleResponse({ status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderCard({ myBinding: syncedBinding(), componentCount: 5 });

    fireEvent.click(screen.getByRole("button", { name: "下载文档包" }));

    await waitFor(() => expect(antdToast.messageError).toHaveBeenCalled());
    // errMessage 取 ApiError 中文文案
    expect(antdToast.messageError).toHaveBeenCalledWith("下载失败（HTTP 500）");
    expect(antdToast.messageSuccess).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(appendedAnchor).toBeNull();
  });

  it("401：单飞刷新拿新 token → 带新 Bearer 重试一次成功", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)
        ?.Authorization;
      return auth === "Bearer fresh-token"
        ? bundleResponse({
            disposition: 'attachment; filename="spec-bundle-ws-1.tar"',
            version: "9",
          })
        : new Response("unauthorized", { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    tokenRefreshApi.ensureFreshAccessToken.mockResolvedValue("fresh-token");

    renderCard({ myBinding: syncedBinding(), componentCount: 5 });

    fireEvent.click(screen.getByRole("button", { name: "下载文档包" }));

    await waitFor(() => expect(antdToast.messageSuccess).toHaveBeenCalled());
    expect(antdToast.messageSuccess).toHaveBeenCalledWith(
      "文档包已下载（快照版本 v9）",
    );
    // 旧 token 401 一次 + 新 token 成功一次，共 2 次；刷新单飞只发 1 次
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tokenRefreshApi.ensureFreshAccessToken).toHaveBeenCalledTimes(1);
    const [, retryInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit | undefined,
    ];
    expect((retryInit?.headers as Record<string, string>).Authorization).toBe(
      "Bearer fresh-token",
    );
    expect(appendedAnchor?.getAttribute("download")).toBe("spec-bundle-ws-1.tar");
  });

  it("401：刷新失败（null）→ 不重试 → 失败 toast 不静默", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response("unauthorized", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    tokenRefreshApi.ensureFreshAccessToken.mockResolvedValue(null);

    renderCard({ myBinding: syncedBinding(), componentCount: 5 });

    fireEvent.click(screen.getByRole("button", { name: "下载文档包" }));

    await waitFor(() => expect(antdToast.messageError).toHaveBeenCalled());
    expect(antdToast.messageError).toHaveBeenCalledWith("下载失败（HTTP 401）");
    expect(fetchMock).toHaveBeenCalledTimes(1); // 刷新拿不到 token 不重试
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
