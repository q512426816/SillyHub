/**
 * task-10 / 变更 2026-07-07-skills-mcp-management-ui：workspace 详情 MCP 子页单测。
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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

  it("只读——无编辑按钮", async () => {
    apiFetchMock.mockResolvedValueOnce({
      mcpServers: {
        "github": { command: "npx" },
      },
    });

    renderPage(<McpPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("github")).toBeInTheDocument();
    });

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/编辑|删除|新增|创建/);
  });
});
