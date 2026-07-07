/**
 * 2026-07-07-skills-mcp-management-ui task-09：MCP 管理页组件测试。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-07-07-skills-mcp-management-ui/design.md（§5.3 前端、D-008 遮蔽、D-009 zod）
 *   - tasks/task-09.md（验收标准 A-E）
 *
 * 覆盖:
 *   1. admin 渲染 JSON 编辑器 + 白名单编辑器（AC-A）
 *   2. JSON 非法语法 → 报错 + 保存禁用（AC-C）
 *   3. zod 结构校验失败（缺 mcpServers）→ 报错 + 保存禁用（AC-C）
 *   4. 有效配置改动 → 保存可点 + 调 mutateAsync + 成功提示「需重启 daemon」（AC-D）
 *   5. env secret 遮蔽展示 `<set>`（含 secret 计数徽标）（AC-B）
 *   6. 非 admin 只读：不渲染保存按钮 + 提示只读（AC-E）
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import McpSettingsPage from "@/app/(dashboard)/settings/mcp/page";

// ── session mock（admin / 非 admin 切换） ───────────────────────────────────

const session = vi.hoisted(() => ({
  user: { id: "u1", is_platform_admin: true } as {
    id: string;
    is_platform_admin?: boolean;
  },
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ user: session.user }),
}));

// ── mcp-settings hooks mock ────────────────────────────────────────────────
// 用 useRef 持久化可变返回值，便于各测试在 render 后再注入 mutation 结果。

const hooks = vi.hoisted(() => ({
  useConfig: vi.fn(),
  useUpdateConfig: vi.fn(),
  useWhitelist: vi.fn(),
  useUpdateWhitelist: vi.fn(),
}));

vi.mock("@/lib/mcp-settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp-settings")>(
    "@/lib/mcp-settings",
  );
  return {
    ...actual,
    useMcpConfig: hooks.useConfig,
    useUpdateMcpConfig: hooks.useUpdateConfig,
    useMcpWhitelist: hooks.useWhitelist,
    useUpdateMcpWhitelist: hooks.useUpdateWhitelist,
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

const ADMIN_CONFIG = {
  mcpServers: {
    "github-server": {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "<set>" },
    },
  },
};

const ADMIN_WHITELIST = ["github-server"];

beforeEach(() => {
  session.user = { id: "u1", is_platform_admin: true };

  hooks.useConfig.mockReturnValue({
    config: JSON.parse(JSON.stringify(ADMIN_CONFIG)),
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  hooks.useWhitelist.mockReturnValue({
    whitelist: [...ADMIN_WHITELIST],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  // mutation hooks 返回可变对象，便于在测试里控制 mutateAsync / isPending。
  const updateConfigMutate = vi.fn().mockResolvedValue(JSON.parse(JSON.stringify(ADMIN_CONFIG)));
  hooks.useUpdateConfig.mockReturnValue({
    mutateAsync: updateConfigMutate,
    isPending: false,
  });
  const updateWhitelistMutate = vi.fn().mockResolvedValue([...ADMIN_WHITELIST]);
  hooks.useUpdateWhitelist.mockReturnValue({
    mutateAsync: updateWhitelistMutate,
    isPending: false,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function getTextarea(): HTMLTextAreaElement {
  return screen.getByDisplayValue(/github-server/, { exact: false }) as HTMLTextAreaElement;
}

describe("MCP 管理页 task-09", () => {
  it("admin 渲染 JSON 编辑器 + 白名单编辑器", async () => {
    renderPage(<McpSettingsPage />);

    expect(await screen.findByText("平台默认 MCP 配置")).toBeInTheDocument();
    expect(await screen.findByText("MCP server 白名单")).toBeInTheDocument();
    expect(getTextarea().value).toContain("github-server");
  });

  it("JSON 语法错误 → 报错 + 保存禁用", async () => {
    renderPage(<McpSettingsPage />);
    await screen.findByText("平台默认 MCP 配置");

    fireEvent.change(getTextarea(), { target: { value: "{ invalid json" } });

    expect(await screen.findByText(/JSON 语法错误/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /保存配置/ })).toBeDisabled();
  });

  it("zod 结构校验失败（缺 mcpServers）→ 报错 + 保存禁用", async () => {
    renderPage(<McpSettingsPage />);
    await screen.findByText("平台默认 MCP 配置");

    fireEvent.change(getTextarea(), {
      target: { value: JSON.stringify({ servers: {} }, null, 2) },
    });

    expect(await screen.findAllByText(/mcpServers/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /保存配置/ })).toBeDisabled();
  });

  it("有效配置改动 → 保存调 mutateAsync + 成功提示需重启 daemon", async () => {
    renderPage(<McpSettingsPage />);
    await screen.findByText("平台默认 MCP 配置");

    const newConfig = {
      mcpServers: {
        "fs-server": { command: "npx", args: ["-y", "server"], env: {} },
      },
    };
    fireEvent.change(getTextarea(), {
      target: { value: JSON.stringify(newConfig, null, 2) },
    });

    const saveBtn = screen.getByRole("button", { name: /保存配置/ });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    const result = hooks.useUpdateConfig.mock.results[0];
    const mutate = result!.value.mutateAsync;
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject(newConfig);
    // 成功 toast（antd message-notice）应含「需重启 daemon 生效」
    await waitFor(() => {
      const notices = document.querySelectorAll(".ant-message-notice");
      const hit = Array.from(notices).some((n) =>
        /需重启 daemon 生效/.test(n.textContent ?? ""),
      );
      expect(hit).toBe(true);
    });
  });

  it("env secret 遮蔽展示 `<set>`（含 secret 计数徽标）", async () => {
    renderPage(<McpSettingsPage />);
    expect(await screen.findByText(/1 个 secret 已遮蔽/)).toBeInTheDocument();
    expect(getTextarea().value).toContain("<set>");
  });

  it("非 admin 只读：不渲染保存按钮 + 提示只读", async () => {
    session.user = { id: "u2", is_platform_admin: false };
    renderPage(<McpSettingsPage />);

    expect(await screen.findByText(/仅平台管理员可编辑/)).toBeInTheDocument();
    await screen.findByText("平台默认 MCP 配置");
    expect(screen.queryByRole("button", { name: /保存配置/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /保存白名单/ })).not.toBeInTheDocument();
  });
});
