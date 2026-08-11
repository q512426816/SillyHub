/**
 * task-05 / 变更 2026-08-11-mcp-token-management-ui：McpTokenCreateDialog 单测。
 *
 * 依据:
 *   - frontend/src/components/mcp-token-create-dialog.tsx（双 phase form|plaintext）
 *
 * 覆盖:
 *   1. 默认 scope 勾选 read+dispatch（Button toggle，aria-pressed 判定）
 *   2. toggle 行为：点击 converge 选中、点击 read 取消，提交体按规范顺序重组
 *   3. 名称为空 → 签发按钮禁用
 *   4. 提交成功 → 切 plaintext phase（明文回显 + 元信息）且 onCreated 触发
 *   5. 明文复制 → clipboard.writeText 收到明文，按钮变「已复制」
 *   6. 签发失败 → 停留 form phase 并展示错误
 *
 * mock @/lib/mcp-tokens（hoisted vi.fn），风格对齐 components/__tests__ 现有弹窗测试。
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpTokenCreateDialog } from "@/components/mcp-token-create-dialog";

const mcpTokensApi = vi.hoisted(() => ({
  createMcpToken: vi.fn(),
}));

vi.mock("@/lib/mcp-tokens", () => ({
  createMcpToken: mcpTokensApi.createMcpToken,
}));

const createdToken = {
  id: "11111111-2222-3333-4444-555555555555",
  token: "shk_live_plaintext_only_once",
  name: "ci-runner",
  scope: ["read", "dispatch"],
  created_at: "2026-08-11T08:00:00Z",
};

function renderDialog(overrides: Partial<{
  workspaceId: string;
  onCreated: () => void;
  onClose: () => void;
}> = {}) {
  return render(
    <McpTokenCreateDialog
      workspaceId={overrides.workspaceId ?? "ws-1"}
      onCreated={overrides.onCreated ?? (() => {})}
      onClose={overrides.onClose ?? (() => {})}
    />,
  );
}

function fillName(value: string) {
  fireEvent.change(screen.getByPlaceholderText("例如 ci-runner-token"), {
    target: { value },
  });
}

function scopeButton(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
}

beforeEach(() => {
  mcpTokensApi.createMcpToken.mockReset();
  mcpTokensApi.createMcpToken.mockResolvedValue(createdToken);
});

afterEach(() => {
  cleanup();
});

describe("McpTokenCreateDialog · form phase", () => {
  it("默认勾选 read 与 dispatch，converge 未选（aria-pressed 判定）", () => {
    renderDialog();

    expect(scopeButton("读取 (read)")).toHaveAttribute("aria-pressed", "true");
    expect(scopeButton("派发 (dispatch)")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(scopeButton("汇聚 (converge)")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("签发 MCP 令牌")).toBeInTheDocument();
  });

  it("名称为空 → 签发按钮禁用；填入名称后可用", () => {
    renderDialog();

    const submit = screen.getByRole("button", { name: "签发" });
    expect(submit).toBeDisabled();

    fillName("ci-runner");
    expect(submit).toBeEnabled();
  });

  it("toggle：点 converge 选中、点 read 取消，提交体按规范顺序重组且不含 read", async () => {
    renderDialog();
    fillName("ci-runner");

    fireEvent.click(scopeButton("汇聚 (converge)"));
    expect(scopeButton("汇聚 (converge)")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(scopeButton("读取 (read)"));
    expect(scopeButton("读取 (read)")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "签发" }));

    await waitFor(() => {
      expect(mcpTokensApi.createMcpToken).toHaveBeenCalledTimes(1);
    });
    expect(mcpTokensApi.createMcpToken).toHaveBeenCalledWith("ws-1", {
      name: "ci-runner",
      // SCOPE_OPTIONS 规范顺序：dispatch 在 converge 前，与 toggle 顺序无关
      scope: ["dispatch", "converge"],
    });
  });
});

describe("McpTokenCreateDialog · plaintext phase", () => {
  it("提交成功 → 切 plaintext：明文回显 + 名称/scope 元信息，onCreated 触发一次", async () => {
    const onCreated = vi.fn();
    renderDialog({ onCreated });
    fillName("ci-runner");

    fireEvent.click(screen.getByRole("button", { name: "签发" }));

    await waitFor(() => {
      expect(screen.getByText("MCP 令牌已签发")).toBeInTheDocument();
    });
    // 明文回显（唯一一次展示）
    expect(
      screen.getByText("shk_live_plaintext_only_once"),
    ).toBeInTheDocument();
    // 元信息
    expect(screen.getByText("ci-runner")).toBeInTheDocument();
    expect(screen.getByText("read、dispatch")).toBeInTheDocument();
    // form phase 的提交入口已消失
    expect(
      screen.queryByRole("button", { name: "签发" }),
    ).not.toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("点「复制」→ clipboard.writeText 收到明文，按钮文案变「已复制」", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderDialog();
    fillName("ci-runner");
    fireEvent.click(screen.getByRole("button", { name: "签发" }));
    await waitFor(() => {
      expect(screen.getByText("MCP 令牌已签发")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /复制/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("shk_live_plaintext_only_once");
    });
    expect(
      screen.getByRole("button", { name: /已复制/ }),
    ).toBeInTheDocument();
  });

  it("签发失败 → 停留 form phase 并展示错误，不触发明文 phase", async () => {
    mcpTokensApi.createMcpToken.mockRejectedValueOnce(new Error("冲突：同名令牌已存在"));
    const onCreated = vi.fn();
    renderDialog({ onCreated });
    fillName("ci-runner");

    fireEvent.click(screen.getByRole("button", { name: "签发" }));

    await waitFor(() => {
      expect(screen.getByText(/冲突：同名令牌已存在/)).toBeInTheDocument();
    });
    expect(screen.queryByText("MCP 令牌已签发")).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
