"use client";

/**
 * ql-20260619-006：daemon-client workspace 的「切换 Daemon」改绑组件。
 *
 * 动机：workspace 详情页「绑定 Daemon」此前只读（WorkspacePathFields 仅展示），
 * 绑定的 daemon 一旦离线，扫描/阶段派发走 daemon-client 强绑路由会直接
 * NoOnlineDaemonError（run 失败、无日志）。backend PATCH /api/workspaces/{id}
 * 的 WorkspaceUpdate 已支持 daemon_runtime_id，此处补前端入口。
 *
 * 职责：
 *   - listDaemonRuntimes() 拉当前用户全部 runtime（online 排前）。
 *   - 「切换 Daemon」按钮展开列表；online 可直接选，offline/disabled 标注
 *     状态但仍可选（用户可能马上启用 / 重启该 daemon）。
 *   - 选中非当前项 → updateWorkspace({ daemon_runtime_id }) → onChanged 刷新父级。
 *
 * 仅 daemon-client workspace 渲染（由父级 [id]/page.tsx 条件判断）。
 */
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  listDaemonRuntimes,
  PROVIDER_META,
  type DaemonRuntimeRead,
} from "@/lib/daemon";
import { updateWorkspace } from "@/lib/workspaces";

interface Props {
  workspaceId: string;
  /** 当前绑定的 daemon runtime id（workspace.daemon_runtime_id）。 */
  currentRuntimeId: string | null;
  /** 改绑成功后回调（父级 reload workspace + boundRuntime）。 */
  onChanged?: () => void;
}

function providerLabel(provider: string | null): string {
  if (!provider) return "未知";
  return PROVIDER_META[provider]?.label ?? provider;
}

/** online 排前；同级按 provider label 稳定排序。 */
function sortRuntimes(list: DaemonRuntimeRead[]): DaemonRuntimeRead[] {
  return [...list].sort((a, b) => {
    const ra = a.status === "online" ? 0 : 1;
    const rb = b.status === "online" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return providerLabel(a.provider).localeCompare(providerLabel(b.provider), "zh-CN");
  });
}

export function WorkspaceDaemonSwitcher({
  workspaceId,
  currentRuntimeId,
  onChanged,
}: Props) {
  const [runtimes, setRuntimes] = useState<DaemonRuntimeRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listDaemonRuntimes();
      setRuntimes(sortRuntimes(list));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载 daemon 列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = useCallback(() => {
    setOpen((v) => !v);
    void load();
  }, [load]);

  const handleSwitch = useCallback(
    async (rt: DaemonRuntimeRead) => {
      // 点击当前绑定项：仅收起，不重复提交。
      if (rt.id === currentRuntimeId) {
        setOpen(false);
        return;
      }
      setSwitchingId(rt.id);
      setError(null);
      try {
        await updateWorkspace(workspaceId, { daemon_runtime_id: rt.id });
        setOpen(false);
        onChanged?.();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "切换失败");
      } finally {
        setSwitchingId(null);
      }
    },
    [workspaceId, currentRuntimeId, onChanged],
  );

  return (
    <div className="space-y-1.5" data-testid="daemon-switcher">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          绑定 Daemon 可在此切换（当前绑定的离线/禁用会导致派发失败）
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px]"
          onClick={handleToggle}
          disabled={loading && runtimes.length === 0}
          aria-expanded={open}
        >
          {loading && runtimes.length === 0 ? "加载中…" : "切换 Daemon"}
        </Button>
      </div>

      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}

      {open && (
        <div className="rounded border bg-card p-1 shadow-sm">
          {loading ? (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
              加载中…
            </p>
          ) : runtimes.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
              暂无 daemon runtime，请先在 /runtimes 启动一个。
            </p>
          ) : (
            <ul className="space-y-0.5" data-testid="daemon-switcher-list">
              {runtimes.map((rt) => {
                const isCurrent = rt.id === currentRuntimeId;
                const status = rt.status ?? "unknown";
                const healthy = status === "online";
                return (
                  <li key={rt.id}>
                    <button
                      type="button"
                      disabled={switchingId !== null}
                      onClick={() => void handleSwitch(rt)}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-current={isCurrent || undefined}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="font-medium">
                          {providerLabel(rt.provider)}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {rt.name ?? rt.id.slice(0, 8)}
                        </span>
                        {isCurrent && (
                          <Badge variant="default" className="text-[10px]">
                            当前
                          </Badge>
                        )}
                      </span>
                      <Badge
                        variant={
                          healthy
                            ? "success"
                            : status === "disabled"
                              ? "destructive"
                              : "outline"
                        }
                        className="text-[10px]"
                      >
                        {status}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
