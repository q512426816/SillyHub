import { describe, expect, it } from "vitest";

import type { DaemonRuntimeRead } from "@/lib/daemon";
import {
  formatDaemonRuntimeSummary,
  isDaemonClientWorkspace,
  workspacePathSourceLabel,
  workspaceRootPathLabel,
} from "@/lib/workspace-path";

describe("workspace-path helpers", () => {
  it("labels path sources", () => {
    expect(workspacePathSourceLabel("daemon-client")).toBe("本机守护进程路径");
    expect(workspacePathSourceLabel("server-local")).toBe("服务器本地路径");
  });

  it("labels root path field", () => {
    expect(workspaceRootPathLabel("daemon-client")).toBe("客户端路径");
    expect(workspaceRootPathLabel("server-local")).toBe("root_path");
  });

  it("detects daemon-client workspace", () => {
    expect(isDaemonClientWorkspace({ path_source: "daemon-client" })).toBe(true);
    expect(isDaemonClientWorkspace({ path_source: "server-local" })).toBe(false);
  });

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
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(formatDaemonRuntimeSummary(runtime)).toBe("cursor v1.2.3（在线）");
    expect(formatDaemonRuntimeSummary(null)).toBe("未找到绑定运行时");
  });
});
