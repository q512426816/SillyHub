// tests/spec-sync-conflict-banner.test.tsx
// 2026-09-26-spec-sync-receipt-visibility：横幅三态——开放行非空渲染警示 /
// 空不渲染 / 请求失败静默（retry:false 横幅缺位不阻塞页面）。

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listSpecConflicts: vi.fn() }));
vi.mock("@/lib/spec-workspaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/spec-workspaces")>()),
  listSpecConflicts: mocks.listSpecConflicts,
}));

import { SpecSyncConflictBanner } from "@/components/spec-sync-conflict-banner";

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SpecSyncConflictBanner workspaceId="ws-1" />
    </QueryClientProvider>,
  );
}

describe("SpecSyncConflictBanner", () => {
  beforeEach(() => mocks.listSpecConflicts.mockReset());
  afterEach(cleanup);

  it("开放行非空 → 细条警示（数量 + 镜像滞后提示）", async () => {
    mocks.listSpecConflicts.mockResolvedValue([
      { id: "c1", stage: "spec-sync", conflict_type: "sync", status: "open" },
    ]);
    renderBanner();
    await waitFor(() =>
      expect(screen.getByTestId("spec-sync-conflict-banner")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("spec-sync-conflict-banner")).toHaveTextContent(
      "spec 同步有 1 条冲突待裁决",
    );
    expect(screen.getByTestId("spec-sync-conflict-banner")).toHaveTextContent(
      "镜像可能滞后",
    );
  });

  it("无开放行 → 不渲染", async () => {
    mocks.listSpecConflicts.mockResolvedValue([]);
    const { container } = renderBanner();
    await waitFor(() => expect(mocks.listSpecConflicts).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="spec-sync-conflict-banner"]')).toBeNull();
  });

  it("请求失败 → 静默不渲染（不白屏）", async () => {
    // 返回 rejected promise 且预挂 catch 兜底：react-query 捕获进 error 态；
    // vitest 对跨测试边界的未处理拒绝会计失败，故在 mock 侧先消化一份。
    const err = new Error("网络错误");
    const p = Promise.reject(err);
    p.catch(() => undefined);
    mocks.listSpecConflicts.mockReturnValueOnce(p);
    const { container } = renderBanner();
    await waitFor(() => expect(mocks.listSpecConflicts).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('[data-testid="spec-sync-conflict-banner"]')).toBeNull();
  });
});
