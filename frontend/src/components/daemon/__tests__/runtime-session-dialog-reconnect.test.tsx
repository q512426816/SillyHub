// task-07（2026-07-31-offline-session-readonly）：RuntimeSessionDialog 重连恢复测试（D-005）。
// 验证 runtimeOffline 从实时 runtimes 重查（非 stale runtime prop）：runtimes 翻转 offline→online
// 时，panel offlineReadOnly 跟随翻转（横幅消失），即使 dialog 的 runtime prop（stale 快照）不变。

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    listAgentSessions: vi.fn().mockResolvedValue({ items: [] }),
    getAgentSessionLogs: vi.fn().mockResolvedValue([]),
    reopenSession: vi.fn().mockResolvedValue(undefined),
  };
});

import { RuntimeSessionDialog } from "../runtime-session-dialog";
import type { DaemonRuntimeRead } from "@/lib/daemon";

function makeRuntime(status: "online" | "offline"): DaemonRuntimeRead {
  return {
    id: "rt-1",
    provider: "claude",
    status,
    name: "test-runtime",
    display_alias: null,
    allowed_roots: [],
  } as unknown as DaemonRuntimeRead;
}

describe("RuntimeSessionDialog reconnect (task-07 / D-005)", () => {
  it("runtimes offline→online 翻转：离线横幅消失（证明从 runtimes 重查，非 stale runtime prop）", () => {
    // runtime prop = offline 快照（stale，全程不变）；runtimes 实时（先 offline 后 online）。
    const staleRuntime = makeRuntime("offline");
    const { rerender } = render(
      <RuntimeSessionDialog
        open
        runtime={staleRuntime}
        runtimes={[staleRuntime]}
        onClose={vi.fn()}
      />,
    );
    // runtimes 中 rt-1 offline → runtimeOffline=true → 离线横幅出现
    expect(screen.getByText(/运行时离线，当前为只读浏览/)).toBeInTheDocument();

    // rerender：runtime prop 不变（stale offline），但 runtimes 中 rt-1 翻转为 online
    rerender(
      <RuntimeSessionDialog
        open
        runtime={staleRuntime}
        runtimes={[makeRuntime("online")]}
        onClose={vi.fn()}
      />,
    );
    // 从实时 runtimes 重查 → runtimeOffline=false → 离线横幅消失（D-005 成立）
    expect(screen.queryByText(/运行时离线，当前为只读浏览/)).toBeNull();
  });
});
