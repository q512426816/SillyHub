"use client";

/**
 * 智能体档案管理页（工作区内页，卡片墙版）。
 *
 * 变更 2026-08-04-agent-profile-ui-redesign task-05（重做）：
 *  - 废弃原 9 列 DataTable（useWorkspaceAgentProfiles + TableProps + Tag 列），改用
 *    <AgentProfileCardGrid workspaceId scopedToWorkspace />（D-002 卡片墙复用）。
 *  - 表单仍走 <AgentProfileForm>（task-04 双栏预览版）；工作区内页传 workspaceId，
 *    表单不渲染「工作区上下文」选择器（design §7.2：路由 ws 已知）。
 *  - 复制/删除仍用 useCopyAgentProfile/useDeleteAgentProfile（wsId 来自路由参数，
 *    成功后 invalidate workspaceList 桶，与 grid 的 useWorkspaceAgentProfiles 同桶，
 *    卡片墙自动刷新）。
 *
 * 系统预置档案（is_system_default）：卡片自身改显「只读」，不触发编辑/复制/删除回调
 * （AgentProfileCard 内部 isSystem 分支已拦截，见 agent-profile-card.tsx）。
 *
 * 设计依据：tasks/task-05.md §implementation / design §5 P5 / §6 / §10 R-02 /
 * FRONTEND_PAGE_STYLE.md（PageContainer/PageHeader；卡片墙为 agent-profile 目录特例）。
 * membership 校验由 workspace layout 的 WorkspaceBindingGuard 完成，本页不重复。
 */
import Link from "next/link";
import { useCallback, useState } from "react";
import { Button, Modal } from "antd";

import { PageContainer, PageHeader } from "@/components/layout";
import { AgentProfileCardGrid } from "@/components/agent-profile/agent-profile-card-grid";
import { AgentProfileForm } from "@/components/agent-profile-form";
import {
  useCopyAgentProfile,
  useDeleteAgentProfile,
  type AgentProfileAggregatedItem,
  type AgentProfileRead,
} from "@/lib/agent-profiles";
import { useNotify } from "@/lib/errors";

interface Props {
  params: { id: string };
}

export default function WorkspaceAgentProfilesPage({ params }: Props) {
  const workspaceId = params.id;
  const notify = useNotify();

  const copyProfile = useCopyAgentProfile(workspaceId);
  const deleteProfile = useDeleteAgentProfile(workspaceId);

  const [formState, setFormState] = useState<{
    open: boolean;
    mode: "create" | "edit";
    profile: AgentProfileRead | null;
  }>({ open: false, mode: "create", profile: null });
  const [confirmDelete, setConfirmDelete] =
    useState<AgentProfileAggregatedItem | null>(null);

  // 编辑：交给表单（ws 内页传 workspaceId，无「工作区上下文」选择器）。
  // AgentProfileAggregatedItem 是 AgentProfileRead 的结构超集，直接赋值类型安全。
  const handleEdit = (p: AgentProfileAggregatedItem) => {
    setFormState({ open: true, mode: "edit", profile: p });
  };

  const handleCopy = useCallback(
    async (p: AgentProfileAggregatedItem) => {
      try {
        const copied = await copyProfile.mutateAsync({
          profileId: p.id,
          body: {}, // name/visibility 省略 → 后端取「{原名}（副本）」+ private
        });
        notify.success(`已复制为「${copied.name}」（个人可见），可继续编辑`);
      } catch (err) {
        notify.error(err, "复制档案失败");
      }
    },
    [copyProfile, notify],
  );

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteProfile.mutateAsync(target.id);
      notify.success(`档案「${target.name}」已删除`);
    } catch (err) {
      notify.error(err, "删除档案失败");
    }
  };

  return (
    <PageContainer size="full">
      <PageHeader
        title={
          <span className="flex flex-col gap-0.5">
            <span>智能体档案</span>
            <Link
              href={`/workspaces/${workspaceId}`}
              className="text-[11px] font-normal text-muted-foreground hover:underline"
            >
              ← 工作区
            </Link>
          </span>
        }
        subtitle="管理本工作区可见的智能体配置：供应商/模型/系统提示词/MCP 与技能引用。系统预置档案只读。"
        actions={
          <Button
            type="primary"
            onClick={() =>
              setFormState({ open: true, mode: "create", profile: null })
            }
          >
            + 新建档案
          </Button>
        }
      />

      {/* 卡片墙（锁定到本工作区；隐藏「工作区」筛选；内部自管人设预览弹窗与加载/错误态） */}
      <AgentProfileCardGrid
        workspaceId={workspaceId}
        scopedToWorkspace
        onEdit={handleEdit}
        onCopy={(p) => void handleCopy(p)}
        onDelete={setConfirmDelete}
      />

      {/* 新建/编辑表单（ws 内页传 workspaceId，无「工作区上下文」选择器） */}
      {formState.open && (
        <AgentProfileForm
          mode={formState.mode}
          workspaceId={workspaceId}
          profile={formState.profile}
          onClose={() =>
            setFormState({ open: false, mode: "create", profile: null })
          }
        />
      )}

      {/* 删除确认 */}
      {confirmDelete && (
        <Modal
          open
          title="确认删除智能体档案？"
          onCancel={() => setConfirmDelete(null)}
          onOk={() => void handleConfirmDelete()}
          okText="确认删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          confirmLoading={deleteProfile.isPending}
          maskClosable={false}
          destroyOnClose
        >
          <p className="mt-2 text-xs text-muted-foreground">
            将删除档案 <span className="font-mono">{confirmDelete.name}</span>
            （v{confirmDelete.version}）。该操作不可恢复。
          </p>
        </Modal>
      )}
    </PageContainer>
  );
}
