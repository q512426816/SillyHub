/**
 * task-05 / 变更 2026-08-11-mcp-token-management-ui：workspace MCP 令牌管理页单测。
 *
 * 依据:
 *   - frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx
 *   - 变更 design D-001@v1：viewer 点入由服务端 WORKSPACE_WRITE 403 兜底，
 *     渲染「无权限」空态且不泄漏 token 存在性
 *
 * 覆盖:
 *   1. 正常列表：行渲染（名称/scope 徽章/状态）+ 统计卡计数 + 已吊销行无吊销按钮
 *   2. 403（ApiError status 403）→ 「无权限查看 MCP 令牌」空态，不渲染任何 token 行/列表区
 *   3. 非 403 错误 → 红条错误文案
 *   4. 空列表 → 「还没有 MCP 令牌」空态
 *   5. 吊销二次确认：confirm 取消不调 revokeMcpToken；确认后调用并重新加载列表
 *
 * mock @/lib/mcp-tokens（hoisted vi.fn），风格对齐 workspaces/[id]/mcp/__tests__/page.test.tsx。
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspaceMcpTokensPage from "@/app/(dashboard)/workspaces/[id]/mcp-tokens/page";
import { ApiError } from "@/lib/api";
import type { McpTokenRead } from "@/lib/mcp-tokens";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const mcpTokensApi = vi.hoisted(() => ({
  listMcpTokens: vi.fn(),
  revokeMcpToken: vi.fn(),
}));

vi.mock("@/lib/mcp-tokens", () => ({
  listMcpTokens: mcpTokensApi.listMcpTokens,
  revokeMcpToken: mcpTokensApi.revokeMcpToken,
}));

function makeToken(overrides: Partial<McpTokenRead> = {}): McpTokenRead {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    name: "ci-runner",
    scope: ["read", "dispatch"],
    last_used_at: null,
    revoked_at: null,
    created_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

const activeToken = makeToken();
const revokedToken = makeToken({
  id: "99999999-8888-7777-6666-555555555555",
  name: "old-token",
  scope: ["read"],
  revoked_at: "2026-08-05T10:00:00Z",
});

function renderPage() {
  return render(<WorkspaceMcpTokensPage params={{ id: "ws-1" }} />);
}

beforeEach(() => {
  mcpTokensApi.listMcpTokens.mockReset();
  mcpTokensApi.revokeMcpToken.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("workspace MCP 令牌管理页 · 正常列表", () => {
  it("渲染 token 行（名称/scope/状态）+ 统计卡计数，已吊销行无吊销按钮", async () => {
    mcpTokensApi.listMcpTokens.mockResolvedValueOnce([
      activeToken,
      revokedToken,
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("ci-runner")).toBeInTheDocument();
    });
    expect(screen.getByText("old-token")).toBeInTheDocument();
    // scope 徽章（read 两行各一枚，dispatch 仅活跃行）
    expect(screen.getAllByText("read")).toHaveLength(2);
    expect(screen.getByText("dispatch")).toBeInTheDocument();
    // 状态徽章 + 统计卡标签同名，各两处
    expect(screen.getAllByText("活跃").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("已吊销").length).toBeGreaterThanOrEqual(2);
    // 统计卡：全部 2 / 活跃 1 / 已吊销 1
    expect(screen.getByText("全部令牌")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    // 仅活跃行有吊销按钮（已吊销行不渲染）
    expect(screen.getAllByRole("button", { name: "吊销" })).toHaveLength(1);
    expect(mcpTokensApi.listMcpTokens).toHaveBeenCalledWith("ws-1");
  });
});

describe("workspace MCP 令牌管理页 · 403 无权限空态（D-001@v1）", () => {
  it("listMcpTokens 抛 ApiError(403) → 渲染无权限空态，不泄漏 token 存在性", async () => {
    mcpTokensApi.listMcpTokens.mockRejectedValueOnce(
      new ApiError(403, {
        code: "forbidden",
        message: "需要 WORKSPACE_WRITE 权限",
        request_id: null,
        details: null,
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("无权限查看 MCP 令牌")).toBeInTheDocument();
    });
    // 不渲染列表区与统计卡（不泄漏 token 存在性/数量）
    expect(screen.queryByText("令牌列表")).not.toBeInTheDocument();
    expect(screen.queryByText("全部令牌")).not.toBeInTheDocument();
    expect(screen.queryByText("ci-runner")).not.toBeInTheDocument();
    // 也不走通用错误红条
    expect(
      screen.queryByText(/需要 WORKSPACE_WRITE 权限/),
    ).not.toBeInTheDocument();
  });
});

describe("workspace MCP 令牌管理页 · 其它状态", () => {
  it("非 403 错误 → 红条展示错误文案", async () => {
    mcpTokensApi.listMcpTokens.mockRejectedValueOnce(
      new ApiError(500, {
        code: "internal_error",
        message: "服务内部错误",
        request_id: null,
        details: null,
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });
    expect(screen.queryByText("无权限查看 MCP 令牌")).not.toBeInTheDocument();
  });

  it("空列表 → 「还没有 MCP 令牌」空态", async () => {
    mcpTokensApi.listMcpTokens.mockResolvedValueOnce([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("还没有 MCP 令牌")).toBeInTheDocument();
    });
  });
});

describe("workspace MCP 令牌管理页 · 吊销二次确认", () => {
  it("confirm 取消 → 不调用 revokeMcpToken，不刷新", async () => {
    mcpTokensApi.listMcpTokens.mockResolvedValue([activeToken]);
    const confirmMock = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirmMock);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("ci-runner")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "吊销" }));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.calls[0]?.[0]).toContain("ci-runner");
    expect(mcpTokensApi.revokeMcpToken).not.toHaveBeenCalled();
    // 未触发二次加载
    expect(mcpTokensApi.listMcpTokens).toHaveBeenCalledTimes(1);
  });

  it("confirm 确认 → 调 revokeMcpToken(workspaceId, tokenId) 并重新加载列表", async () => {
    mcpTokensApi.listMcpTokens
      .mockResolvedValueOnce([activeToken])
      .mockResolvedValueOnce([
        makeToken({ revoked_at: "2026-08-11T09:00:00Z" }),
      ]);
    mcpTokensApi.revokeMcpToken.mockResolvedValueOnce(undefined);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("ci-runner")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "吊销" }));

    await waitFor(() => {
      expect(mcpTokensApi.revokeMcpToken).toHaveBeenCalledWith(
        "ws-1",
        activeToken.id,
      );
    });
    // 吊销成功后重新加载，列表刷新为已吊销态（统计卡标签 + 状态徽章）
    await waitFor(() => {
      expect(mcpTokensApi.listMcpTokens).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getAllByText("已吊销").length).toBeGreaterThanOrEqual(2);
    });
  });
});
