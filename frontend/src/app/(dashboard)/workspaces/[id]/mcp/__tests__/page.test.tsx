/**
 * task-10 / 变更 2026-07-07-skills-mcp-management-ui：workspace 详情 MCP 子页单测。
 * 2026-08-26-workspace-mcp-edit task-10 增补：双态（查看/编辑）交互用例。
 *
 * 依据:
 *   - backend/app/modules/workspace/skills_view_service.py（McpConfigViewResponse）
 *   - backend/app/modules/settings/router.py:126（_redact_mcp_env → 值 "<set>"）
 *   - backend/app/modules/workspace/router.py:333（GET /api/workspaces/{id}/mcp-config）
 *
 * 覆盖:
 *   1. 渲染 server 名 + 配置字段
 *   2. env secret 脱敏值 <set> + 「密钥已脱敏」标注（AC-env 遮蔽）
 *   3. 空状态（mcpServers:{}）
 *   4. 错误态
 *   5. 只读：无编辑按钮
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
