"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { WorkspaceMemberAddDialog } from "@/components/workspace-member-add-dialog";
import { WorkspaceMemberRow } from "@/components/workspace-member-row";
import { ApiError } from "@/lib/api";
import {
  listMembers,
  removeMember,
  transferOwnership,
  updateMemberRole,
  type WorkspaceMemberRoleKey,
  type WorkspaceMemberView,
} from "@/lib/workspace-members";

interface Props {
  params: { id: string };
}

/**
 * Workspace Members 子页面：表格 + 行级操作（role dropdown / Set Owner / Remove）+ Add 对话框。
 *
 * 设计要点：
 * - 本页面由 task-08 的 layout.tsx 包裹（自动获得 tab 栏 + workspace header）；
 *   本文件只渲染"成员管理"标题 + 表格 + Add 按钮 + 对话框。
 * - 权限：客户端只判定"是否当前用户行"（is_current_user 来自 backend）；
 *   写入操作的权限校验完全在 backend WORKSPACE_MEMBER_MANAGE 完成；
 *   viewer/developer 点 Add/Set Owner/Remove 会被 backend 返 403 → 顶部错误条显示。
 * - 当前用户行（is_current_user）禁用 role dropdown / Set Owner / Remove（design R-04 防自我降级）。
 */
export default function MembersPage({ params }: Props) {
  const workspaceId = params.id;

  // null = 未加载；[] = 已加载但空（防御性）
  const [members, setMembers] = useState<WorkspaceMemberView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 全局写入操作锁：任一写入操作进行中时所有行按钮 + role dropdown + Add 按钮 disabled
  const [actionLoading, setActionLoading] = useState(false);

  const [showAddDialog, setShowAddDialog] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMembers(workspaceId);
      setMembers(list);
    } catch (err) {
      setMembers([]);
      setError(
        err instanceof ApiError
          ? `${err.code}: ${err.message}`
          : "加载成员列表失败",
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRoleChange = async (
    userId: string,
    nextRole: WorkspaceMemberRoleKey,
  ) => {
    if (actionLoading) return;
    setActionLoading(true);
    setError(null);
    try {
      await updateMemberRole(workspaceId, userId, { role_key: nextRole });
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.code}: ${err.message}`
          : "修改角色失败",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleTransferOwnership = async (
    userId: string,
    displayName: string,
  ) => {
    if (actionLoading) return;
    // design R-04：自我降级是不可逆，强制 confirm
    const ok = confirm(
      `确定把 workspace 所有权传递给 "${displayName}"？\n` +
        `你将降级为 developer，不再能管理成员（直到对方把所有权传回给你）。`,
    );
    if (!ok) return;

    setActionLoading(true);
    setError(null);
    try {
      await transferOwnership(workspaceId, userId);
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.code}: ${err.message}`
          : "传递所有权失败",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemove = async (userId: string, displayName: string) => {
    if (actionLoading) return;
    const ok = confirm(`确定从 workspace 移除成员 "${displayName}"？`);
    if (!ok) return;

    setActionLoading(true);
    setError(null);
    try {
      await removeMember(workspaceId, userId);
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.code}: ${err.message}`
          : "移除成员失败",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddClicked = () => {
    if (actionLoading) return;
    setShowAddDialog(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">成员管理</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            管理 workspace 成员：添加、修改角色、移除、传递所有权。
          </p>
        </div>
        <Button size="sm" onClick={handleAddClicked} disabled={actionLoading}>
          + Add Member
        </Button>
      </header>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          <span className="flex-1 break-all">{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="shrink-0 underline hover:no-underline disabled:opacity-50"
          >
            重试
          </button>
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-xs text-muted-foreground">
          加载中…
        </p>
      ) : !members || members.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center">
          <p className="text-sm">暂无成员</p>
          <p className="mt-1 text-xs text-muted-foreground">
            workspace 至少应有一个 workspace_owner；如出现空列表，请检查权限或联系平台管理员。
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                  User
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                  Role
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                  Granted At
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <WorkspaceMemberRow
                  key={m.user_id}
                  member={m}
                  actionLoading={actionLoading}
                  onRoleChange={(next) => handleRoleChange(m.user_id, next)}
                  onSetOwner={() =>
                    handleTransferOwnership(
                      m.user_id,
                      m.display_name ?? m.email,
                    )
                  }
                  onRemove={() =>
                    handleRemove(m.user_id, m.display_name ?? m.email)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddDialog && (
        <WorkspaceMemberAddDialog
          workspaceId={workspaceId}
          onAdded={() => {
            void refresh();
          }}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
}
