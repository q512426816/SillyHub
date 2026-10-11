/**
 * 2026-10-11-apikey-mcp-copy-delete：API 密钥设置页单测。
 *
 * 依据:
 *   - frontend/src/app/(dashboard)/settings/api-keys/page.tsx
 *   - 变更 FR-02/FR-04/FR-05：活跃可恢复行复制明文；已吊销行物理删除；
 *     不可恢复行复制按钮禁用降级
 *
 * 覆盖:
 *   1. 活跃可恢复行 → 「复制密钥」写入剪贴板并回显已复制
 *   2. 存量不可恢复行（plaintext_recoverable=false）→ 复制按钮禁用 + tooltip
 *   3. 已吊销行 → 「删除」confirm 后调 deleteApiKey 并刷新；取消不调
 *   4. 活跃行有吊销无删除；已吊销行有删除无吊销/复制
 *
 * mock @/lib/api-keys（hoisted vi.fn），风格对齐 mcp-tokens/__tests__/page.test.tsx。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ApiKeysSettingsPage from "@/app/(dashboard)/settings/api-keys/page";
import type { ApiKeyRead } from "@/lib/api-keys";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ApiKeyCreateDialog 仅在点击签发时渲染，这里 stub 掉避免拉入真实组件树。
vi.mock("@/components/api-key-create-dialog", () => ({
  ApiKeyCreateDialog: () => <div data-testid="create-dialog-stub" />,
}));

const apiKeysApi = vi.hoisted(() => ({
  listApiKeys: vi.fn(),
  revokeApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  fetchApiKeyPlaintext: vi.fn(),
}));

vi.mock("@/lib/api-keys", () => ({
  listApiKeys: apiKeysApi.listApiKeys,
  revokeApiKey: apiKeysApi.revokeApiKey,
  deleteApiKey: apiKeysApi.deleteApiKey,
  fetchApiKeyPlaintext: apiKeysApi.fetchApiKeyPlaintext,
}));

function makeKey(overrides: Partial<ApiKeyRead> = {}): ApiKeyRead {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    name: "my-daemon",
    key_prefix: "shk_live_ab",
    last_used_at: null,
    expires_at: null,
    created_at: "2026-10-11T10:00:00Z",
    revoked_at: null,
    plaintext_recoverable: true,
    ...overrides,
  };
}

const activeKey = makeKey();
const legacyKey = makeKey({
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  name: "legacy-key",
  plaintext_recoverable: false,
});
const revokedKey = makeKey({
  id: "99999999-8888-7777-6666-555555555555",
  name: "old-key",
  revoked_at: "2026-10-01T10:00:00Z",
});

function renderPage() {
  return render(<ApiKeysSettingsPage />);
}

beforeEach(() => {
  apiKeysApi.listApiKeys.mockReset();
  apiKeysApi.revokeApiKey.mockReset();
  apiKeysApi.deleteApiKey.mockReset();
  apiKeysApi.fetchApiKeyPlaintext.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("API 密钥设置页 · 复制密钥（FR-02/FR-05）", () => {
  it("活跃可恢复行点「复制密钥」→ 明文写入剪贴板并回显已复制", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    apiKeysApi.listApiKeys.mockResolvedValueOnce([activeKey]);
    apiKeysApi.fetchApiKeyPlaintext.mockResolvedValueOnce("shk_live_secret123");

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("my-daemon")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /复制密钥/ }));

    await waitFor(() => {
      expect(apiKeysApi.fetchApiKeyPlaintext).toHaveBeenCalledWith(activeKey.id);
    });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("shk_live_secret123");
    });
    await waitFor(() => {
      expect(screen.getByText("已复制")).toBeInTheDocument();
    });
  });

  it("存量不可恢复行 → 复制按钮禁用 + tooltip 提示，不调明文端点", async () => {
    apiKeysApi.listApiKeys.mockResolvedValueOnce([legacyKey]);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("legacy-key")).toBeInTheDocument();
    });

    const btn = screen.getByRole("button", { name: /复制密钥/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(
      screen.getByTitle("旧版本签发的密钥未保存明文，无法复制；请新签发一把"),
    ).toBeInTheDocument();
    expect(apiKeysApi.fetchApiKeyPlaintext).not.toHaveBeenCalled();
  });
});

describe("API 密钥设置页 · 已吊销密钥物理删除（FR-04）", () => {
  it("confirm 确认 → 调 deleteApiKey 并重新加载列表", async () => {
    apiKeysApi.listApiKeys.mockResolvedValueOnce([revokedKey]).mockResolvedValueOnce([]);
    apiKeysApi.deleteApiKey.mockResolvedValueOnce(undefined);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("old-key")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /删除/ }));

    await waitFor(() => {
      expect(apiKeysApi.deleteApiKey).toHaveBeenCalledWith(revokedKey.id);
    });
    await waitFor(() => {
      expect(apiKeysApi.listApiKeys).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText("还没有 API 密钥")).toBeInTheDocument();
    });
  });

  it("confirm 取消 → 不调 deleteApiKey", async () => {
    apiKeysApi.listApiKeys.mockResolvedValueOnce([revokedKey]);
    const confirmMock = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirmMock);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("old-key")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /删除/ }));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.calls[0]?.[0]).toContain("old-key");
    expect(apiKeysApi.deleteApiKey).not.toHaveBeenCalled();
  });
});

describe("API 密钥设置页 · 按钮矩阵", () => {
  it("活跃行有吊销无删除；已吊销行有删除无吊销/复制", async () => {
    apiKeysApi.listApiKeys.mockResolvedValueOnce([activeKey, revokedKey]);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("old-key")).toBeInTheDocument();
    });

    expect(screen.getAllByRole("button", { name: "吊销" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /复制密钥/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /删除/ })).toHaveLength(1);
  });
});

describe("API 密钥设置页 · 过期行（评审 P1 修复回归）", () => {
  it("过期未吊销行不渲染复制按钮（明文端点对过期行 404，可点只会报错）", async () => {
    const expiredKey = makeKey({
      id: "eeeeeeee-0000-0000-0000-000000000000",
      name: "expired-key",
      expires_at: "2026-10-01T00:00:00Z",
    });
    apiKeysApi.listApiKeys.mockResolvedValueOnce([activeKey, expiredKey]);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("expired-key")).toBeInTheDocument();
    });

    // 状态列显示「已过期」；仅活跃行有复制按钮；过期行吊销按钮保留（仍可吊销清理）
    expect(screen.getAllByText("已过期").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: /复制密钥/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "吊销" })).toHaveLength(2);
    expect(apiKeysApi.fetchApiKeyPlaintext).not.toHaveBeenCalled();
  });
});
