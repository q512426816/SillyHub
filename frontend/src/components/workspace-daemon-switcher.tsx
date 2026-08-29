"use client";

/**
 * task-10 (2026-07-03-daemon-entity-binding)：守护进程切换器——下拉选 daemon 实体。
 *
 * 职责：
 *   - listDaemonInstances() 拉当前用户在线守护进程实体（含已启用 provider 列表）。
 *   - 每项展示 hostname/display_alias 为主文 + 副位 provider 徽标。
 *   - 选中非当前项进入路径确认态：项目本地路径是机器相关的（跨机多半不同），
 *     用 WorkspacePathPicker 绑定新 daemon 预填旧路径、可改可浏览（ql-20260828-010-ca22）；
 *     确认后调 upsertMyBinding({ daemon_id, root_path }) => onChanged 刷新父级。
 *   - 空列表展示「暂无在线守护进程」空态引导。
 */
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import WorkspacePathPicker from "@/components/workspace-path-picker";
import { ApiError } from "@/lib/api";
import {
  listDaemonInstances,
  PROVIDER_META,
  type DaemonInstanceRead,
} from "@/lib/daemon";
import {
  upsertMyBinding,
  type MemberBindingView,
} from "@/lib/workspace-binding";

interface Props {
  workspaceId: string;
  /** 当前用户 member binding（binding.daemon_id 作为当前高亮项）。null = 未绑定。 */
  currentBinding: MemberBindingView | null;
  /** 改绑成功后回调（父级 reload workspace + binding）。 */
  onChanged?: () => void;
}

function providerLabel(provider: string | null): string {
  if (!provider) return "未知";
  return PROVIDER_META[provider]?.label ?? provider;
}

function providerIcon(provider: string | null): string {
  if (!provider) return "";
  return PROVIDER_META[provider]?.icon ?? "";
}

function providerColor(provider: string | null): string {
  if (!provider) return "";
  return PROVIDER_META[provider]?.color ?? "";
}

export function WorkspaceDaemonSwitcher({
  workspaceId,
  currentBinding,
  onChanged,
}: Props) {
  const [instances, setInstances] = useState<DaemonInstanceRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  // 路径确认态：点选的目标 daemon + 待确认路径（预填当前绑定路径）。
  const [pending, setPending] = useState<DaemonInstanceRead | null>(null);
  const [pendingPath, setPendingPath] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listDaemonInstances();
      setInstances(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载守护进程列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = useCallback(() => {
    setOpen((v) => !v);
    setPending(null);
    void load();
  }, [load]);

  const currentDaemonId = (currentBinding as any)?.daemon_id ?? null;

  // 点选列表项：当前项仅收起；非当前项进入路径确认态（不立即提交）。
  const handlePick = useCallback(
    (di: DaemonInstanceRead) => {
      if (di.id === currentDaemonId) {
        setOpen(false);
        return;
      }
      setPending(di);
      setPendingPath(currentBinding?.root_path ?? "");
    },
    [currentDaemonId, currentBinding],
  );

  const handleCancel = useCallback(() => setPending(null), []);

  const handleConfirmSwitch = useCallback(async () => {
    if (!pending || !pendingPath) return;
    setSwitchingId(pending.id);
    setError(null);
    try {
      // path_source 固定 daemon-client（member 级 spec 策略，server-local 模式已移除）。
      await upsertMyBinding(workspaceId, {
        daemon_id: pending.id,
        root_path: pendingPath,
        path_source: "daemon-client",
      });
      setOpen(false);
      setPending(null);
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "切换失败");
    } finally {
      setSwitchingId(null);
    }
  }, [workspaceId, pending, pendingPath, onChanged]);

  return (
    <div className="space-y-1.5" data-testid="daemon-switcher">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          绑定守护进程可在此切换（当前绑定的离线/禁用会导致派发失败）
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px]"
          onClick={handleToggle}
          disabled={loading && instances.length === 0}
          aria-expanded={open}
        >
          {loading && instances.length === 0 ? "加载中…" : "切换守护进程"}
        </Button>
      </div>

      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}

      {open && pending ? (
        <div
          className="rounded border bg-card p-2 shadow-sm"
          data-testid="daemon-switcher-confirm"
        >
          <p className="px-1 pb-1.5 text-[11px] text-muted-foreground">
            切换到「{pending.display_alias ?? pending.hostname}」：请确认项目在该机器上的本地路径
            （不同机器的检出路径通常不同）
          </p>
          <WorkspacePathPicker
            daemonId={pending.id}
            value={pendingPath}
            onChange={setPendingPath}
            disabled={switchingId !== null}
            inputClassName="text-xs"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px]"
              onClick={handleCancel}
              disabled={switchingId !== null}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="h-6 text-[11px]"
              onClick={() => void handleConfirmSwitch()}
              disabled={switchingId !== null || !pendingPath}
            >
              {switchingId ? "切换中…" : "确认切换"}
            </Button>
          </div>
        </div>
      ) : open ? (
        <div className="rounded border bg-card p-1 shadow-sm">
          {loading ? (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
              加载中…
            </p>
          ) : instances.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
              暂无在线守护进程，请先启动守护进程
            </p>
          ) : (
            <ul className="space-y-0.5" data-testid="daemon-switcher-list">
              {instances.map((di) => {
                const isCurrent = di.id === currentDaemonId;
                return (
                  <li key={di.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(di)}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/50"
                      aria-current={isCurrent || undefined}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex items-center gap-1.5">
                          <span className="font-medium">
                            {di.display_alias ?? di.hostname}
                          </span>
                          {isCurrent && (
                            <Badge variant="default" className="text-[10px]">
                              当前
                            </Badge>
                          )}
                        </span>
                        {di.providers.length > 0 && (
                          <span className="flex flex-wrap gap-1">
                            {di.providers.map((p) => (
                              <Badge
                                key={p.provider}
                                variant="outline"
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0 text-[10px] leading-none ${providerColor(p.provider)}`}
                              >
                                <span className="text-[10px]">{providerIcon(p.provider)}</span>
                                {providerLabel(p.provider)}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
