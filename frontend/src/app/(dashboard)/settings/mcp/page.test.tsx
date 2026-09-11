/**
 * MCP 资产库页组件测试（变更 2026-09-10-mcp-central-registry / task-11 重写）。
 *
 * 旧 7 用例（2026-07-07-skills-mcp-management-ui task-09）mock mcp-settings hooks
 * 断言 JSON 编辑器形态，页面重构为双 tab 卡片后全部失效删除，本文件按新页面重写。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-09-10-mcp-central-registry/design.md（D-001 双层可见性、FR-03 启用绑定）
 *   - .sillyspec/changes/2026-09-10-mcp-central-registry/tasks/task-11.md（acceptance）
 *
 * 覆盖:
 *   1. admin 双 tab 渲染 + 平台库卡片列表（stdio 徽标 / 平台默认徽标 / cmd 单行）
 *   2. 切「我的库」tab → scope=mine 数据渲染（我的私有徽标）
 *   3. 搜索回车 → 列表 hook 收到 search 参数
 *   4. 「对我启用」开关 → user binding mutate（FR-03）
 *   5. admin 平台库 tab「设为平台默认」→ platform binding mutate
 *   6. 非 admin 平台库只读：无编辑/删除入口 + 只读提示（D-001）
 *   7. 新建弹窗：加密开关用户逐键指定（缺省按键名建议）+ 保存调 POST 形状
 *   8. 白名单编辑器不回归（admin 仍可增删保存）
 */

import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import McpRegistryPage from "@/app/(dashboard)/settings/mcp/page";
import type { McpServerRead } from "@/lib/api/mcp-registry";

// ── session mock（admin / 非 admin 切换） ───────────────────────────────────

const session = vi.hoisted(() => ({
  user: { id: "u1", is_platform_admin: true } as {
    id: string;
    is_platform_admin?: boolean;
  },
}));

vi.mock("@/stores/session", () => ({
  useSession: (selector: (_s: { user: typeof session.user }) => unknown) =>
    selector({ user: session.user }),
}));

// ── mcp-registry hooks mock（纯函数/类型保留真实实现） ──────────────────────

const registry = vi.hoisted(() => ({
  useServers: vi.fn(),
  useToggleBinding: vi.fn(),
  useCreate: vi.fn(),
  useUpdate: vi.fn(),
  useDelete: vi.fn(),
}));

// task-12（导入三入口 + 诊断）hooks mock（文件级——第二个 vi.mock 工厂引用）。
const task12 = vi.hoisted(() => ({
  useImportJson: vi.fn(),
  useScan: vi.fn(),
  useApplyImport: vi.fn(),
  useTemplates: vi.fn(),
  useDiagnostics: vi.fn(),
}));

vi.mock("@/lib/api/mcp-registry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/mcp-registry")>(
    "@/lib/api/mcp-registry",
  );
  return {
    ...actual,
    useMcpServers: registry.useServers,
    useToggleMcpBinding: registry.useToggleBinding,
    useCreateMcpServer: registry.useCreate,
    useUpdateMcpServer: registry.useUpdate,
    useDeleteMcpServer: registry.useDelete,
  };
});

// ── mcp-settings 白名单 hooks mock（白名单不回归用） ────────────────────────

const whitelistHooks = vi.hoisted(() => ({
  useWhitelist: vi.fn(),
  useUpdateWhitelist: vi.fn(),
}));

vi.mock("@/lib/mcp-settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp-settings")>(
    "@/lib/mcp-settings",
  );
  return {
    ...actual,
    useMcpWhitelist: whitelistHooks.useWhitelist,
    useUpdateMcpWhitelist: whitelistHooks.useUpdateWhitelist,
  };
});

// ── next/link mock（jsdom 下不导航） ────────────────────────────────────────

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>{ui}</AntApp>
    </QueryClientProvider>,
  );
}

// ── mock 数据（McpServerRead 生成类型全字段） ───────────────────────────────

function makeServer(over: Partial<McpServerRead> & { id: string; name: string }): McpServerRead {
  return {
    owner_user_id: null,
    server_type: "stdio",
    secret_env_keys: [],
    server_config: {
      command: "npx",
      args: ["-y", `${over.name}-mcp`],
      env: {},
    },
    tags: [],
    note: "",
    enabled: true,
    source: "manual",
    dedup_key: null,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    platform_bound: false,
    user_bound: false,
    diagnostic_codes: [],
    ...over,
  };
}

const PLATFORM_SERVERS: McpServerRead[] = [
  makeServer({
    id: "s-ctx7",
    name: "context7",
    tags: ["文档"],
    platform_bound: true,
    user_bound: true,
  }),
  makeServer({ id: "s-fetch", name: "fetch", tags: ["网络"] }),
];

const MINE_SERVERS: McpServerRead[] = [
  makeServer({
    id: "s-mysql",
    name: "mysql-dev",
    owner_user_id: "u1",
    server_config: {
      command: "npx",
      args: ["-y", "@benborla29/mcp-server-mysql"],
      env: { MYSQL_HOST: "127.0.0.1", MYSQL_KEY: "<set>" },
    },
    tags: ["数据库"],
    user_bound: true,
  }),
];

const ADMIN_WHITELIST = ["github-server"];

beforeEach(() => {
  session.user = { id: "u1", is_platform_admin: true };

  // 列表 hook：按调用参数里的 scope 分桶返回（页面每次渲染传 {scope, search, tag}）。
  registry.useServers.mockImplementation(
    (params: { scope: "platform" | "mine" | "visible" }) => ({
      servers: params.scope === "mine" ? MINE_SERVERS : PLATFORM_SERVERS,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
  );
  registry.useToggleBinding.mockReturnValue({ mutate: vi.fn(), isPending: false });
  registry.useCreate.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(makeServer({ id: "s-new", name: "new-server" })),
    isPending: false,
  });
  registry.useUpdate.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(null),
    isPending: false,
  });
  registry.useDelete.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  });

  // task-12 hooks 默认空态（弹窗常驻挂载即调用；vi.mock 文件级提升对全部 describe 生效）
  task12.useImportJson.mockReturnValue({ mutate: vi.fn(), isPending: false, reset: vi.fn() });
  task12.useScan.mockReturnValue({ mutate: vi.fn(), isPending: false, data: undefined, isError: false, reset: vi.fn() });
  task12.useApplyImport.mockReturnValue({ mutate: vi.fn(), isPending: false });
  task12.useTemplates.mockReturnValue({ templates: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
  task12.useDiagnostics.mockReturnValue({ diagnostics: [], isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() });

  whitelistHooks.useWhitelist.mockReturnValue({
    whitelist: [...ADMIN_WHITELIST],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  const updateWhitelistMutate = vi.fn().mockResolvedValue([...ADMIN_WHITELIST]);
  whitelistHooks.useUpdateWhitelist.mockReturnValue({
    mutateAsync: updateWhitelistMutate,
    isPending: false,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MCP 资产库页 task-11", () => {
  it("admin 双 tab 渲染 + 平台库卡片列表（徽标 / cmd 行 / 加密计数）", async () => {
    renderPage(<McpRegistryPage />);

    // 双 tab
    expect(screen.getByRole("tab", { name: /平台共享库/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /我的库/ })).toBeInTheDocument();

    // 平台库卡片：context7（平台默认 + stdio + cmd 单行 + 密钥计数）
    expect(await screen.findByText("context7")).toBeInTheDocument();
    expect(screen.getByText("平台默认")).toBeInTheDocument();
    expect(screen.getAllByText("stdio")).toHaveLength(2);
    expect(screen.getByText(/npx -y context7-mcp/)).toBeInTheDocument();
    expect(screen.getAllByText(/个密钥/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("#文档")).toBeInTheDocument();
    // fetch 卡也在
    expect(screen.getByText("#网络")).toBeInTheDocument();
  });

  it("切「我的库」tab → scope=mine 列表渲染（我的私有徽标）", async () => {
    renderPage(<McpRegistryPage />);
    await screen.findByText("context7");

    fireEvent.click(screen.getByRole("tab", { name: /我的库/ }));

    expect(await screen.findByText("mysql-dev")).toBeInTheDocument();
    expect(screen.getByText("我的私有")).toBeInTheDocument();
    // 平台库卡片不再渲染
    expect(screen.queryByText("平台默认")).not.toBeInTheDocument();
    // 列表 hook 收到 scope=mine
    const lastCall =
      registry.useServers.mock.calls[registry.useServers.mock.calls.length - 1];
    expect(lastCall?.[0]).toMatchObject({ scope: "mine" });
  });

  it("搜索回车 → 列表 hook 收到 search 参数（回车才查）", async () => {
    renderPage(<McpRegistryPage />);
    await screen.findByText("context7");

    const input = screen.getByPlaceholderText("搜索名称 / 命令 / 标签，回车生效");
    fireEvent.change(input, { target: { value: "mysql" } });
    // 仅输入不触发
    expect(
      registry.useServers.mock.calls.some((c) => c[0]?.search === "mysql"),
    ).toBe(false);

    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });

    await waitFor(() => {
      const lastCall =
        registry.useServers.mock.calls[registry.useServers.mock.calls.length - 1];
      expect(lastCall?.[0]).toMatchObject({ scope: "platform", search: "mysql" });
    });
  });

  it("「对我启用」开关 → user binding mutate（FR-03）", async () => {
    renderPage(<McpRegistryPage />);
    await screen.findByText("context7");

    // fetch 未绑定 → 开关点击调加绑定
    fireEvent.click(screen.getByRole("switch", { name: "对我启用 fetch" }));
    const toggle = registry.useToggleBinding.mock.results[0]!.value;
    expect(toggle.mutate).toHaveBeenCalledTimes(1);
    expect(toggle.mutate.mock.calls[0]![0]).toEqual({
      serverId: "s-fetch",
      scopeType: "user",
      enabled: true,
    });
  });

  it("admin 平台库 tab「设为平台默认」→ platform binding mutate", async () => {
    renderPage(<McpRegistryPage />);
    await screen.findByText("fetch");

    fireEvent.click(screen.getByRole("button", { name: "设为平台默认" }));
    const toggle = registry.useToggleBinding.mock.results[0]!.value;
    expect(toggle.mutate).toHaveBeenCalledTimes(1);
    expect(toggle.mutate.mock.calls[0]![0]).toEqual({
      serverId: "s-fetch",
      scopeType: "platform",
      enabled: true,
    });
  });

  it("非 admin 平台库只读：无编辑/删除入口 + 只读提示 + 白名单不渲染", async () => {
    session.user = { id: "u2", is_platform_admin: false };
    renderPage(<McpRegistryPage />);

    expect(
      await screen.findByText(/平台共享库由管理员维护，当前为只读视图/),
    ).toBeInTheDocument();
    await screen.findByText("context7");

    // 无编辑/删除/存模板入口（D-001 非 admin 平台库只读）
    expect(
      screen.queryByRole("button", { name: "编辑 context7" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除 context7" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "存为模板 context7" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("设为平台默认")).not.toBeInTheDocument();
    // 「对我启用」开关仍在（user binding 任意登录用户可用）
    expect(screen.getByRole("switch", { name: "对我启用 context7" })).toBeInTheDocument();
    // 白名单治理层仅 admin 可见
    expect(screen.queryByText("MCP server 白名单")).not.toBeInTheDocument();
  });

  it("新建弹窗：加密开关用户逐键指定 + 保存调 POST 形状（ql-20260911-003-355a）", async () => {
    renderPage(<McpRegistryPage />);
    await screen.findByText("context7");

    fireEvent.click(screen.getByRole("button", { name: /新建 Server/ }));
    expect(
      await screen.findByText("新建 MCP Server（stdio）"),
    ).toBeInTheDocument();

    // 加两行 env：明文键 + 键名含 KEY 的键（缺省建议加密——用户可改）
    fireEvent.click(screen.getByRole("button", { name: "+ 添加 env 键值" }));
    fireEvent.click(screen.getByRole("button", { name: "+ 添加 env 键值" }));
    const keyInputs = screen.getAllByPlaceholderText("MYSQL_HOST");
    fireEvent.change(keyInputs[0]!, { target: { value: "MYSQL_HOST" } });
    fireEvent.change(keyInputs[1]!, { target: { value: "MYSQL_KEY" } });
    const valueInputs = screen.getAllByPlaceholderText(/^(值|值（编辑保留)/);
    fireEvent.change(valueInputs[0]!, { target: { value: "127.0.0.1" } });
    fireEvent.change(valueInputs[1]!, { target: { value: "p@ss" } });

    // 名称 + command 必填
    fireEvent.change(screen.getByPlaceholderText("如 mysql-dev"), {
      target: { value: "mysql-dev" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/如 npx -y @modelcontextprotocol/),
      { target: { value: "npx -y @benborla29/mcp-server-mysql" } },
    );

    fireEvent.click(screen.getByRole("button", { name: /^保\s*存$/ }));

    const create = registry.useCreate.mock.results[0]!.value;
    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalledTimes(1));
    expect(create.mutateAsync).toHaveBeenCalledWith({
      name: "mysql-dev",
      server_config: {
        type: "stdio",
        command: "npx -y @benborla29/mcp-server-mysql",
        args: [],
        env: { MYSQL_HOST: "127.0.0.1", MYSQL_KEY: "p@ss" },
      },
      // MYSQL_KEY 未显式触碰开关 → 按键名缺省建议进指定清单（用户自定义可改）
      secret_env_keys: ["MYSQL_KEY"],
      scope: "platform", // admin 当前在平台 tab，保存到缺省平台共享库
      source: "manual",
    });
  });

  it("白名单编辑器不回归：admin 仍可增删保存", async () => {
    renderPage(<McpRegistryPage />);
    expect(await screen.findByText("MCP server 白名单")).toBeInTheDocument();
    // mock 白名单条目渲染
    expect(await screen.findByText("github-server")).toBeInTheDocument();

    // 添加 fs-server → 保存按钮点亮 → mutate 收到含新条目的数组
    const draft = screen.getByPlaceholderText("输入 server 名，回车添加");
    fireEvent.change(draft, { target: { value: "fs-server" } });
    fireEvent.click(screen.getByRole("button", { name: /添\s*加/ }));

    const saveBtn = screen.getByRole("button", { name: /保存白名单/ });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    const update = whitelistHooks.useUpdateWhitelist.mock.results[0]!.value;
    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalledTimes(1));
    expect(update.mutateAsync).toHaveBeenCalledWith(["github-server", "fs-server"]);
  });
});

// ---------------------------------------------------------------------------
// task-12（2026-09-10-mcp-central-registry / FR-06~09）：导入三入口 + 诊断面板
// ---------------------------------------------------------------------------

describe("MCP 资产库页 task-12：导入入口 + 诊断面板", () => {
  // task12 mock 对象声明在文件顶部（vi.hoisted 提升后此处直接引用）。
  vi.mock("@/lib/api/mcp-registry", async () => {
    const actual = await vi.importActual<typeof import("@/lib/api/mcp-registry")>(
      "@/lib/api/mcp-registry",
    );
    return {
      ...actual,
      useMcpServers: registry.useServers,
      useToggleMcpBinding: registry.useToggleBinding,
      useCreateMcpServer: registry.useCreate,
      useUpdateMcpServer: registry.useUpdate,
      useDeleteMcpServer: registry.useDelete,
      useImportMcpJson: task12.useImportJson,
      useScanMcpWorkspaces: task12.useScan,
      useApplyMcpWorkspaceImport: task12.useApplyImport,
      useMcpTemplates: task12.useTemplates,
      useMcpDiagnostics: task12.useDiagnostics,
    };
  });

  // vi.mock 是文件级提升——直接跑 describe 需重建页面级 mock 状态（复用上层
  // registry mock 的 beforeEach）。task-12 用例只验入口/面板渲染，不深验弹窗
  // 内部交互（各弹窗组件自身的单测空间留后续；本页接线断言到位即可）。

  it("工具栏三导入入口 + admin 诊断按钮渲染（FR-06/07/08/09 接线）", async () => {
    // task-12 hooks 默认态（页面渲染即调用）
    task12.useImportJson.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      reset: vi.fn(),
    });
    task12.useScan.mockReturnValue({ mutate: vi.fn(), isPending: false, data: undefined, isError: false, reset: vi.fn() });
    task12.useApplyImport.mockReturnValue({ mutate: vi.fn(), isPending: false });
    task12.useTemplates.mockReturnValue({ templates: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
    task12.useDiagnostics.mockReturnValue({ diagnostics: [], isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() });

    renderPage(<McpRegistryPage />);
    expect(
      await screen.findByTestId("mcp-import-json-btn"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mcp-scan-btn")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-template-btn")).toBeInTheDocument();
    // admin 可见诊断入口；非 admin 不渲染
    expect(screen.getByTestId("mcp-diagnostics-btn")).toBeInTheDocument();

    session.user = { id: "u2", is_platform_admin: false };
    cleanup();
    renderPage(<McpRegistryPage />);
    await waitFor(() =>
      expect(screen.queryByTestId("mcp-diagnostics-btn")).not.toBeInTheDocument(),
    );
    session.user = { id: "u1", is_platform_admin: true };
  });

  it("admin 点「注入诊断」→ 诊断面板打开并渲染五类项中的命中项（FR-08）", async () => {
    task12.useImportJson.mockReturnValue({ mutate: vi.fn(), isPending: false, reset: vi.fn() });
    task12.useScan.mockReturnValue({ mutate: vi.fn(), isPending: false, data: undefined, isError: false, reset: vi.fn() });
    task12.useApplyImport.mockReturnValue({ mutate: vi.fn(), isPending: false });
    task12.useTemplates.mockReturnValue({ templates: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
    task12.useDiagnostics.mockReturnValue({
      diagnostics: [
        {
          code: "platform_name_shadow",
          server_id: "s1",
          server_name: "playwright",
          detail: "workspace「demo」的 .mcp.json 存在同名 server，workspace 位优先",
        },
        {
          code: "workspace_blocked_by_whitelist",
          server_id: null,
          server_name: null,
          detail: "internal-tools",
        },
      ],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage(<McpRegistryPage />);
    fireEvent.click(await screen.findByTestId("mcp-diagnostics-btn"));

    expect(
      await screen.findByTestId("mcp-diagnostics-panel"),
    ).toBeInTheDocument();
    expect(await screen.findByText("同名遮蔽")).toBeInTheDocument();
    expect(screen.getByText(/playwright/)).toBeInTheDocument();
    expect(screen.getByText("白名单拦截")).toBeInTheDocument();
  });

  it("「从模板新建」→ 模板列表渲染，选中后预填新建表单（FR-09）", async () => {
    task12.useImportJson.mockReturnValue({ mutate: vi.fn(), isPending: false, reset: vi.fn() });
    task12.useScan.mockReturnValue({ mutate: vi.fn(), isPending: false, data: undefined, isError: false, reset: vi.fn() });
    task12.useApplyImport.mockReturnValue({ mutate: vi.fn(), isPending: false });
    task12.useDiagnostics.mockReturnValue({ diagnostics: [], isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() });
    task12.useTemplates.mockReturnValue({
      templates: [
        {
          id: "t1",
          name: "memory",
          server_config: { type: "stdio", command: "npx -y @modelcontextprotocol/server-memory", args: [], env: {} },
          secret_env_keys: [],
          is_preset: true,
          owner_user_id: null,
          created_at: "2026-09-10T00:00:00",
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage(<McpRegistryPage />);
    fireEvent.click(await screen.findByTestId("mcp-template-btn"));

    // 模板列表渲染（预置标识 + 命令）
    expect(await screen.findByTestId("mcp-template-list")).toBeInTheDocument();
    expect(screen.getByText("memory")).toBeInTheDocument();

    // 选中 → 弹窗关、新建表单打开且预填模板名
    fireEvent.click(screen.getByTestId("mcp-template-row"));
    await waitFor(() =>
      expect(screen.getByDisplayValue("memory")).toBeInTheDocument(),
    );
  });
});
