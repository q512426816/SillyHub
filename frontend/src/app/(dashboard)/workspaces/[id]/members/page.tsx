"use client";

import { useCallback, useEffect, useState } from "react";

import { Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { SharedDaemonManager } from "@/components/workspace/shared-daemon-manager";
import { WorkspaceMemberAddDialog } from "@/components/workspace-member-add-dialog";
import { WorkspaceMemberRow } from "@/components/workspace-member-row";
import { errMessage } from "@/lib/errors";
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
      setError(errMessage(err, "加载成员列表失败"));
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
      setError(errMessage(err, "修改角色失败"));
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
      setError(errMessage(err, "传递所有权失败"));
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
      setError(errMessage(err, "移除成员失败"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddClicked = () => {
    if (actionLoading) return;
    setShowAddDialog(true);
  };

  return (
    <PageContainer size="full">
      <PageHeader
        title="成员管理"
        subtitle="管理工作区成员：添加、修改角色、移除、传递所有权。"
        actions={
          <Button size="sm" onClick={handleAddClicked} disabled={actionLoading}>
            + 添加成员
          </Button>
        }
      />

      {error && (
        <ErrorBanner
          message={error}
          /* 重试接 refresh；loading 期间（refresh 已清 error，防御性兜底）不挂重试，等价原禁用 */
          onRetry={loading ? undefined : () => void refresh()}
        />
      )}

      {/* task-12 / FR-02 / D-003@v1：owner 共享 daemon 管理区（列表 + 撤销）。
          owner/有 WORKSPACE_MEMBER_MANAGE 权限可见；非 owner 调 GET /shared-daemons
          会 403 → SharedDaemonManager 内部降级空数组，不阻塞页面。 */}
      <SharedDaemonManager
        workspaceId={workspaceId}
        members={members ?? undefined}
      />

      {loading ? (
        <p className="py-12 text-center text-xs text-muted-foreground">
          加载中…
        </p>
      ) : !members || members.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="暂无成员"
            description="workspace 至少应有一个 workspace_owner；如出现空列表，请检查权限或联系平台管理员。"
          />
        </SectionCard>
      ) : (
        <SectionCard bodyPadding="p-0">
          <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">用户</th>
                <th className="px-4 py-3 font-semibold">角色</th>
                <th className="px-4 py-3 font-semibold">授权时间</th>
                <th className="px-4 py-3 text-right font-semibold">操作</th>
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
        </SectionCard>
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
    </PageContainer>
  );
}
