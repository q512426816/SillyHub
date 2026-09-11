/**
 * task-10 / 变更 2026-07-07-skills-mcp-management-ui：workspace 详情 MCP 子页单测。
 * 2026-08-26-workspace-mcp-edit task-10 增补：双态（查看/编辑）交互用例。
 * 2026-09-11-workspace-asset-bridges task-06 增补：「从资产库选入」弹窗
 * （桥③ / FR-04）——列表加载（visible 范围）、选入 POST 调用 + 页面刷新、
 * 同名改名与停用 warning 反馈、解密失败 422 中文提示。
 *
 * 依据:
 *   - backend/app/modules/workspace/skills_view_service.py（McpConfigViewResponse）
 *   - backend/app/modules/settings/router.py:126（_redact_mcp_env → 值 "<set>"）
 *   - backend/app/modules/workspace/router.py:333（GET /api/workspaces/{id}/mcp-config）
 *   - backend/app/modules/workspace/router.py（POST /mcp/import-from-registry）
 *   - backend/app/modules/mcp_registry/router.py（GET /api/mcp-servers?scope=visible）
 *
 * 覆盖:
 *   1. 渲染 server 名 + 配置字段
 *   2. env secret 脱敏值 <set> + 「密钥已脱敏」标注（AC-env 遮蔽）
 *   3. 空状态（mcpServers:{}）
 *   4. 错误态
 *   5. 只读：无编辑按钮
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import McpPage from "@/app/(dashboard)/workspaces/[id]/mcp/page";
import { ApiError } from "@/lib/api";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: apiFetchMock };
});

// useNotify mock（2026-08-26 双态改造新增依赖：保存成功/失败通知，不依赖 antd 运行时）
const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/errors", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return { ...actual, useNotify: () => notifyMock };
});

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("workspace MCP 子页（task-10）", () => {
  it("渲染 server 名 + 配置字段", async () => {
    apiFetchMock.mockResolvedValueOnce({
      mcpServers: {
        "github": {
          command: "npx",
          url: "https://api.github.dev/mcp",
        },
      },
    });

    renderPage(<McpPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("github")).toBeInTheDocument();
    });
    expect(screen.getByText("npx")).toBeInTheDocument();
    expect(screen.getByText("https://api.github.dev/mcp")).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/mcp-config",
    );
  });

  it("env secret 脱敏值展示 + 标注", async () => {
    // backend _redact_mcp_env 已把 secret value 替换为 "<set>"，
    // 前端原样展示并标注「密钥已脱敏」。
    apiFetchMock.mockResolvedValueOnce({
      mcpServers: {
        "github": {
          command: "npx",
          env: {
            GITHUB_TOKEN: "<set>",
            NODE_ENV: "production",
          },
        },
      },
    });

    renderPage(<McpPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("GITHUB_TOKEN")).toBeInTheDocument();
    });
    // 脱敏值 + 标注
    expect(screen.getByText(/<set>/)).toBeInTheDocument();
    expect(screen.getByText("（密钥已脱敏）")).toBeInTheDocument();
    // 非密钥 env 值原样
    expect(screen.getByText("production")).toBeInTheDocument();
    // 不应出现「密钥已脱敏」标注在 NODE_ENV 上（production 不含标注）
    const nodeEnvDd = screen
      .getByText("production")
      .closest("dd");
    expect(nodeEnvDd?.textContent).not.toContain("密钥已脱敏");
  });

  it("空状态展示", async () => {
    apiFetchMock.mockResolvedValueOnce({ mcpServers: {} });

    renderPage(<McpPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("暂无 MCP 服务器配置")).toBeInTheDocument();
    });
  });

  it("错误态展示", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(500, {
        code: "internal_error",
        message: "读取 .mcp.json 失败",
        request_id: null,
        details: null,
      }),
    );

    renderPage(<McpPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("读取 .mcp.json 失败")).toBeInTheDocument();
    });
  });

  it("查看态有「编辑」按钮，进入编辑态后展示 textarea 与提示（2026-08-26 双态改造）", async () => {
    apiFetchMock.mockResolvedValueOnce({
      mcpServers: {
        "github": { command: "npx" },
      },
    });

    renderPage(<McpPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("github")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /编辑/ })).toBeInTheDocument();

    // 进入编辑态：textarea 初始值 = 当前配置序列化；提示文案可见
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe(JSON.stringify({ mcpServers: { github: { command: "npx" } } }, null, 2));
    expect(screen.getByText(/保留 <set> 保存即表示不修改该密钥/)).toBeInTheDocument();
    expect(screen.getByText(/平台白名单/)).toBeInTheDocument();

    // 取消：回查看态，不保存（无 PUT 请求）
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("github")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledTimes(1); // 仅初始 GET
  });

  it("编辑态保存：校验通过时 PUT 请求体正确且回查看态", async () => {
    apiFetchMock.mockResolvedValueOnce({ mcpServers: {} }); // 初始 GET（空）
    apiFetchMock.mockResolvedValueOnce({ mcpServers: { db: { command: "postgres" } } }); // PUT 响应

    renderPage(<McpPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("暂无 MCP 服务器配置")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: '{ "mcpServers": { "db": { "command": "postgres" } } }' },
    });
    expect(screen.getByText("配置格式正确")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledTimes(3); // 初始 GET + PUT + invalidate 后 refetch GET
    });
    const putCall = apiFetchMock.mock.calls.find(
      (c) => (c[1] as { method?: string } | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    expect(putCall![0]).toBe("/api/workspaces/ws-1/mcp-config");
    expect(putCall![1]).toMatchObject({
      json: {
        mcpServers: { db: { type: "stdio", command: "postgres", args: [] } },
      },
    });
    // 保存成功回查看态
    await waitFor(() => {
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  it("编辑态校验拦截：非法 JSON / 非 stdio / 缺 command → 中文报错且不发请求", async () => {
    apiFetchMock.mockResolvedValueOnce({ mcpServers: {} });
    renderPage(<McpPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("暂无 MCP 服务器配置")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    // 非法 JSON
    fireEvent.change(textarea, { target: { value: "{ not json" } });
    expect(screen.getByText(/JSON 语法错误/)).toBeInTheDocument();

    // 非 stdio 类型（含 server 名定位）
    fireEvent.change(textarea, {
      target: { value: '{ "mcpServers": { "r": { "type": "sse", "command": "x" } } }' },
    });
    expect(screen.getByText(/server "r"：仅支持 stdio 类型/)).toBeInTheDocument();

    // 缺 command
    fireEvent.change(textarea, {
      target: { value: '{ "mcpServers": { "r": { "args": [] } } }' },
    });
    expect(screen.getByText(/server "r"：command 不能为空/)).toBeInTheDocument();

    // 保存按钮禁用（校验不通过）
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(apiFetchMock).toHaveBeenCalledTimes(1); // 仅初始 GET，无 PUT
  });
});

/* ════════ 从资产库选入弹窗（bridges task-06，桥③ / FR-04 / D-004/D-009） ════════ */

interface CallInit {
  method?: string;
  json?: unknown;
  query?: Record<string, unknown>;
}

/** 资产库 visible 列表 fixture（字段口径同 api-types McpServerRead）。 */
const REGISTRY_SERVERS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    owner_user_id: null,
    name: "github",
    server_type: "stdio",
    server_config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    },
    secret_env_keys: ["GITHUB_TOKEN"],
    tags: ["git"],
    note: "",
    enabled: true,
    source: "manual",
    dedup_key: null,
    created_at: "2026-09-11T00:00:00Z",
    updated_at: "2026-09-11T00:00:00Z",
    platform_bound: true,
    user_bound: true,
    diagnostic_codes: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    owner_user_id: "user-1",
    name: "my-db",
    server_type: "stdio",
    server_config: { command: "postgres-mcp" },
    secret_env_keys: [],
    tags: [],
    note: "",
    enabled: false, // 停用 → 选入响应带 warning（不阻断）
    source: "manual",
    dedup_key: null,
    created_at: "2026-09-11T00:00:00Z",
    updated_at: "2026-09-11T00:00:00Z",
    platform_bound: false,
    user_bound: false,
    diagnostic_codes: [],
  },
];

/**
 * 组装内存态后端：mcp-config（GET 可多次返回不同视图——invalidate 后 refetch
 * 取第二份）、registry visible 列表、import-from-registry POST。
 */
function setupImportApi({
  initialConfig = { mcpServers: {} },
  refreshedConfig,
  registry = REGISTRY_SERVERS,
  importResp,
  importError,
}: {
  initialConfig?: { mcpServers: Record<string, Record<string, unknown>> };
  refreshedConfig?: { mcpServers: Record<string, Record<string, unknown>> };
  registry?: typeof REGISTRY_SERVERS;
  importResp?: { written_name: string; renamed: boolean; warning?: string | null };
  importError?: unknown;
} = {}) {
  let configCalls = 0;
  apiFetchMock.mockImplementation(async (url: string, init?: CallInit) => {
    if (url === "/api/workspaces/ws-1/mcp-config") {
      configCalls += 1;
      return configCalls === 1 ? initialConfig : (refreshedConfig ?? initialConfig);
    }
    if (url === "/api/mcp-servers") {
      return { items: registry };
    }
    if (
      url === "/api/workspaces/ws-1/mcp/import-from-registry" &&
      init?.method === "POST"
    ) {
      if (importError) throw importError;
      return importResp ?? { written_name: "github", renamed: false, warning: null };
    }
    throw new Error(`unexpected apiFetch: ${url}`);
  });
}

describe("workspace MCP 子页 · 从资产库选入（bridges task-06，桥③）", () => {
  /** 打开页面 + 弹窗，等 visible 列表就绪。 */
  async function openImportDialog() {
    fireEvent.click(screen.getByRole("button", { name: /从资产库选入/ }));
    await screen.findByTestId("registry-import-list");
  }

  it("弹窗列 visible server（name/类型/归属徽标），请求带 scope=visible", async () => {
    setupImportApi();
    renderPage(<McpPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("暂无 MCP 服务器配置")).toBeInTheDocument();
    });

    await openImportDialog();
    // 列表请求：scope=visible（复用 lib/api/mcp-registry.ts 既有查询）
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/mcp-servers",
      expect.objectContaining({
        query: expect.objectContaining({ scope: "visible" }),
      }),
    );
    // 两个 server 均可见 + 徽标（类型/归属/停用）
    expect(screen.getByTestId("registry-import-item-github")).toBeInTheDocument();
    expect(screen.getByTestId("registry-import-item-my-db")).toBeInTheDocument();
    expect(screen.getAllByText("stdio")).toHaveLength(2);
    expect(screen.getByText("平台默认")).toBeInTheDocument();
    expect(screen.getByText("我的私有")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    // 密钥计数提示（选入时解密为明文）
    expect(screen.getByText(/1 个密钥已加密/)).toBeInTheDocument();

    // 未选中时「选入」按钮禁用
    expect(screen.getByRole("button", { name: "选入" })).toBeDisabled();
  });

  it("选入调用：POST server_id + 结果反馈 + 页面 .mcp.json 列表刷新", async () => {
    setupImportApi({
      refreshedConfig: {
        mcpServers: { github: { type: "stdio", command: "npx", args: [] } },
      },
      importResp: { written_name: "github", renamed: false, warning: null },
    });
    renderPage(<McpPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("暂无 MCP 服务器配置")).toBeInTheDocument();
    });

    await openImportDialog();
    fireEvent.click(screen.getByRole("radio", { name: "选入 github" }));
    expect(screen.getByRole("button", { name: "选入" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "选入" }));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/mcp/import-from-registry",
        {
          method: "POST",
          json: { server_id: "11111111-1111-1111-1111-111111111111" },
        },
      );
    });

    // 结果反馈：written_name 展示（未改名不出现改名提示）
    await screen.findByTestId("registry-import-result");
    expect(screen.getByText("已选入")).toBeInTheDocument();
    expect(screen.queryByText(/已自动改名为/)).not.toBeInTheDocument();
    expect(notifyMock.success).toHaveBeenCalledWith("已选入 github");

    // 成功后页面 .mcp.json 编辑区刷新：新 server 卡片出现（dialog 仍在，两处 github）
    await waitFor(() => {
      expect(screen.getAllByText("github").length).toBeGreaterThanOrEqual(2);
    });

    // 关闭弹窗 → 列表卡片仍在（command 字段可见）。弹窗右上角 X（sr-only
    // 「关闭」）与底部按钮同名，取第一个（footer 在 DialogContent 子节点内、
    // X 是其后兄弟节点，DOM 序确定）。
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[0]!);
    await waitFor(() => {
      expect(
        screen.queryByTestId("registry-import-list"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("github")).toBeInTheDocument();
    expect(screen.getByText("npx")).toBeInTheDocument();
  });

  it("同名改名 + 停用 warning：改名提示与黄色 warning 反馈", async () => {
    setupImportApi({
      refreshedConfig: {
        mcpServers: { "my-db-registry": { type: "stdio", command: "postgres-mcp", args: [] } },
      },
      importResp: {
        written_name: "my-db-registry",
        renamed: true,
        warning:
          "该 server 在资产库中已停用；导入的是配置定义，写入 .mcp.json 后即生效，与平台启用/绑定状态无关。",
      },
    });
    renderPage(<McpPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("暂无 MCP 服务器配置")).toBeInTheDocument();
    });

    await openImportDialog();
    fireEvent.click(screen.getByRole("radio", { name: "选入 my-db" }));
    fireEvent.click(screen.getByRole("button", { name: "选入" }));

    await screen.findByTestId("registry-import-result");
    // 改名提示：-registry 后缀最终名（结果区内徽标旁 code + 改名提示两处）
    expect(screen.getByText(/已自动改名为/)).toBeInTheDocument();
    const resultPanel = screen.getByTestId("registry-import-result");
    expect(
      within(resultPanel).getAllByText("my-db-registry").length,
    ).toBeGreaterThanOrEqual(1);
    expect(notifyMock.success).toHaveBeenCalledWith(
      "已选入（同名冲突，改名为 my-db-registry）",
    );
    // warning 黄色提示（停用不阻断导入）
    const warning = screen.getByTestId("registry-import-warning");
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).toContain("该 server 在资产库中已停用");
    expect(warning.className).toContain("text-warning");

    // 「继续选入」回列表态
    fireEvent.click(screen.getByRole("button", { name: "继续选入" }));
    await screen.findByTestId("registry-import-list");
  });

  it("解密失败 422：后端中文文案内联展示，弹窗不关闭", async () => {
    setupImportApi({
      importError: new ApiError(422, {
        code: "HTTP_422_MCP_REGISTRY_ENV_UNDECRYPTABLE",
        message:
          "资产库 server 的密文无法解密（加密密钥可能已轮换），请先在 MCP 资产库修复后再导入。",
        request_id: null,
        details: null,
      }),
    });
    renderPage(<McpPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("暂无 MCP 服务器配置")).toBeInTheDocument();
    });

    await openImportDialog();
    fireEvent.click(screen.getByRole("radio", { name: "选入 github" }));
    fireEvent.click(screen.getByRole("button", { name: "选入" }));

    // 422 中文提示内联展示（弹窗保持打开，可换选重试）
    const errorBox = await screen.findByTestId("registry-import-error");
    expect(errorBox.textContent).toContain("资产库 server 的密文无法解密");
    expect(errorBox.className).toContain("text-destructive");
    expect(screen.getByTestId("registry-import-list")).toBeInTheDocument();
    expect(notifyMock.success).not.toHaveBeenCalled();
    // 页面列表未被刷新（仍空态，无 server 卡片）
    expect(screen.getByText("暂无 MCP 服务器配置")).toBeInTheDocument();
  });
});
