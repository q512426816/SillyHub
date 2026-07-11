import type { DaemonRuntimeRead } from "@/lib/daemon";

// task-11 / 2026-07-10-remove-server-local-workspace-mode：平台统一
// daemon-client 语义后，原 path-source 二元映射四个导出（类型别名 + 三个判定
// /文案函数）已无意义，同步移除，仅保留 runtime 展示工具函数。

export function formatDaemonRuntimeSummary(
  runtime: DaemonRuntimeRead | null | undefined,
): string {
  if (!runtime) {
    return "未找到绑定运行时";
  }
  const label = runtime.name?.trim() || runtime.provider?.trim() || runtime.id.slice(0, 8);
  const version = runtime.version ? ` v${runtime.version}` : "";
  const status =
    runtime.status === "online"
      ? "在线"
      : runtime.status === "offline"
        ? "离线"
        : runtime.status ?? "未知";
  return `${label}${version}（${status}）`;
}

export function daemonRuntimeStatusVariant(
  runtime: DaemonRuntimeRead | null | undefined,
): "success" | "outline" | "destructive" {
  if (!runtime) return "destructive";
  if (runtime.status === "online") return "success";
  if (runtime.status === "offline") return "destructive";
  return "outline";
}
