"use client";

/**
 * change 2026-07-25-daemon-borrow-for-business task-12 / FR-02 / D-003@v1
 *
 * owner「共享 daemon 管理」区段。
 *
 * 渲染在成员管理页。owner 可见：
 *  - 工作空间所有共享 daemon 列表（GET /shared-daemons）：出借人 / daemon 主机 / 在线状态
 *  - 撤销按钮（DELETE /members/{user_id}/shared）：confirm 后调 revokeSharedDaemon
 *
 * 给成员授 business_member 角色：复用现有成员管理页的角色下拉（ROLE_OPTIONS 含
 * business_member，见 workspace-member-row.tsx），本组件不再重复实现角色授予 UI。
 *
 * 数据装配：useEffect + fetchSharedDaemons（失败降级空数组，卡片不阻塞页面）。
 * lender 显示名：父级可传 members 列表用于反查 user_id → display_name，未传时回退短 id。
 */

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/layout";
import { ApiError } from "@/lib/api";
import {
  fetchSharedDaemons,
  revokeSharedDaemon,
  type SharedDaemonView,
} from "@/lib/workspace-binding";
import type { WorkspaceMemberView } from "@/lib/workspace-members";

export interface SharedDaemonManagerProps {
  workspaceId: string;
  /** 成员列表（父级成员管理页已有），用于把 lender_user_id 反查为展示名。 */
  members?: WorkspaceMemberView[];
  /** 撤销成功后回调（父级可按需刷新）。 */
  onRevoked?: () => void;
}

/** 把 user_id 映射为展示名；找不到时回退短 id（避免暴露完整 uuid 给用户）。 */
function resolveLenderLabel(
  lenderUserId: string,
  members: WorkspaceMemberView[] | undefined,
): string {
  const m = members?.find((x) => x.user_id === lenderUserId);
  if (!m) return lenderUserId.slice(0, 8);
  return m.display_name?.trim() || m.email;
}

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

export function SharedDaemonManager({
  workspaceId,
  members,
  onRevoked,
}: SharedDaemonManagerProps): JSX.Element {
  const [items, setItems] = useState<SharedDaemonView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchSharedDaemons(workspaceId);
      setItems(list);
    } catch (err) {
      // fetchSharedDaemons 内部已 try/catch 降级空数组；防御性兜底
      setItems([]);
      setError(err instanceof ApiError ? err.message : "加载共享 daemon 失败");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRevoke(lenderUserId: string, lenderLabel: string): Promise<void> {
    if (revokingId) return;
    const ok = window.confirm(
      `确定撤销「${lenderLabel}」共享的守护进程？\n业务/管理人员将无法再借用此守护进程。`,
    );
    if (!ok) return;
    setRevokingId(lenderUserId);
    setError(null);
    try {
      await revokeSharedDaemon(workspaceId, lenderUserId);
      await refresh();
      onRevoked?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "撤销共享失败");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <SectionCard
      title="共享守护进程"
      extra={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refresh()}
          disabled={loading}
        >
          刷新
        </Button>
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">
        本工作空间内开发人员主动共享的守护进程。业务/管理人员（业务成员角色）可借用其跑智能体出方案。
        授予「业务成员」角色请在上方成员列表的角色下拉中操作。
      </p>

      {error && (
        <div
          className="mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <p className="py-6 text-center text-xs text-muted-foreground">加载中…</p>
      ) : !items || items.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          当前工作空间暂无共享守护进程。开发人员可在「工作区设置」中共享自己的守护进程。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                  出借人
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                  守护进程
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                  状态
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const lenderLabel = resolveLenderLabel(d.lender_user_id, members);
                const online = d.daemon_status === "online";
                return (
                  <tr
                    key={d.lender_user_id}
                    className="border-t border-border"
                    data-testid="shared-daemon-row"
                  >
                    <td className="px-3 py-2 align-top text-xs">
                      <div className="flex flex-col">
                        <span className="font-medium">{lenderLabel}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {shortId(d.lender_user_id)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      <div className="flex flex-col">
                        <span className="truncate">
                          {d.daemon_hostname ?? "—"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {shortId(d.daemon_id)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {d.daemon_status ? (
                        <Badge variant={online ? "success" : "outline"} className="text-[10px]">
                          {online ? "在线" : "离线"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          未知
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="revoke-shared-daemon"
                        onClick={() => void handleRevoke(d.lender_user_id, lenderLabel)}
                        disabled={!d.revocable || revokingId === d.lender_user_id}
                        title={!d.revocable ? "不可撤销" : undefined}
                      >
                        {revokingId === d.lender_user_id ? "撤销中…" : "撤销共享"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
