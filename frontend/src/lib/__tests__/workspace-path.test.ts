import { describe, expect, it } from "vitest";

import type { DaemonRuntimeRead } from "@/lib/daemon";
import {
  daemonRuntimeStatusVariant,
  formatDaemonRuntimeSummary,
} from "@/lib/workspace-path";

// task-11 / 2026-07-10-remove-server-local-workspace-mode：原 path-source 二元
// 映射三个 helper（isDaemonClientWorkspace/workspacePathSourceLabel/workspaceRootPathLabel）
// 随平台统一 daemon-client 语义移除，仅保留 runtime 展示工具函数的测试。

describe("workspace-path helpers", () => {
  it("formats daemon runtime summary", () => {
    const runtime: DaemonRuntimeRead = {
      id: "68c63051-fe2a-49ec-9678-85259f15700e",
      name: "cursor",
      provider: "cursor",
      version: "1.2.3",
      os: null,
      arch: null,
      status: "online",
      last_heartbeat_at: null,
      capabilities: null,
      allowed_roots: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(formatDaemonRuntimeSummary(runtime)).toBe("cursor v1.2.3（在线）");
    expect(formatDaemonRuntimeSummary(null)).toBe("未找到绑定运行时");
  });

  it("maps runtime status to badge variant", () => {
    const online = { status: "online" } as DaemonRuntimeRead;
    const offline = { status: "offline" } as DaemonRuntimeRead;
    const maintenance = { status: "maintenance" } as DaemonRuntimeRead;
    expect(daemonRuntimeStatusVariant(online)).toBe("success");
    expect(daemonRuntimeStatusVariant(offline)).toBe("destructive");
    expect(daemonRuntimeStatusVariant(maintenance)).toBe("outline");
    expect(daemonRuntimeStatusVariant(null)).toBe("destructive");
  });
});
