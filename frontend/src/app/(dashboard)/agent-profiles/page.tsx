"use client";

/**
 * 智能体档案全局卡片墙页（一级菜单落地）。
 *
 * 变更 2026-08-04-agent-profile-ui-redesign task-05 / D-001@v1 / D-007@v1。
 *
 * 与工作区内页（workspaces/[id]/agent-profiles）复用同一套卡片墙 + 表单组件：
 *  - 列表：<AgentProfileCardGrid />（不传 workspaceId → useMineAgentProfiles 跨工作区聚合，
 *    数据 = 当前 actor 可见全集：个人 private + 各 ws 的 workspace 级 + platform + 系统预置）。
 *  - 新建：<AgentProfileForm mode="create" />（不传 workspaceId → 表单首字段「工作区上下文」
 *    选择器决定 sourcing/归属，D-006）。
 *  - 编辑：<AgentProfileForm mode="edit" profile={p} />（form 内部按 profile.workspace_id
 *    或「参考工作区」selector 决定 effectiveWsId，已由 task-04 覆盖 private/platform 场景）。
 *
 * 复制/删除的数据流注意点（全局页特有）：
 *  - 现有 useCopyAgentProfile/useDeleteAgentProfile hook 需要 workspaceId 作 instantiation
 *    参数，且只 invalidate workspaceList 桶、不 invalidate mineList 桶。全局页档案来自
 *    多个工作区，无法在 mount 时固定单一 wid，故这里改用裸 fetch 函数
 *    （copyWorkspaceAgentProfile / deleteWorkspaceAgentProfile）+ 手动 invalidate
 *    agentProfileQueryKeys.mineList，确保 CRUD 后卡片墙刷新。
 *  - private/platform 级档案 workspace_id=null：lib/agent-profiles.ts 仅暴露 workspace 级
 *    copy/delete 端点（无 platform 级 copy/delete 客户端，见该文件 §platform 级注释），
 *    故这类档案在此页不支持复制/删除，提示用户进入归属工作区操作（仅 workspace 级档案
 *    可在全局页直接复制/删除；编辑仍可走表单的「参考工作区」路径）。
 *
 * 设计依据：tasks/task-05.md §implementation / design §5 P5 / §6 / §10 R-02 /
 * FRONTEND_PAGE_STYLE.md §0（antd + tailwind token）/ §9（空值/错误展示）。
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Modal } from "antd";

import { PageContainer, PageHeader } from "@/components/layout";
import { AgentProfileCardGrid } from "@/components/agent-profile/agent-profile-card-grid";
import { AgentProfileForm } from "@/components/agent-profile-form";
import {
  agentProfileQueryKeys,
  copyWorkspaceAgentProfile,
  deleteWorkspaceAgentProfile,
  type AgentProfileAggregatedItem,
  type AgentProfileRead,
} from "@/lib/agent-profiles";
import { useNotify } from "@/lib/errors";

export default function AgentProfilesGlobalPage() {
  const notify = useNotify();
  const qc = useQueryClient();

  const [formState, setFormState] = useState<{
    open: boolean;
    mode: "create" | "edit";
    profile: AgentProfileRead | null;
  }>({ open: false, mode: "create", profile: null });
  const [confirmDelete, setConfirmDelete] =
    useState<AgentProfileAggregatedItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const invalidateMine = () => {
    void qc.invalidateQueries({
      queryKey: agentProfileQueryKeys.mineList,
    });
  };

  // 编辑：交给表单（task-04 已覆盖 private/platform 无 workspace_id 的 sourcing 路径）。
  // AgentProfileAggregatedItem 结构是 AgentProfileRead 的超集（多 workspace_name 可选字段），
  // 直接赋值给 formState.profile 类型安全。
  const handleEdit = (p: AgentProfileAggregatedItem) => {
    setFormState({ open: true, mode: "edit", profile: p });
  };

  // 复制：仅 workspace 级档案（workspace_id 非空）可在全局页复制；private/platform 引导。
  const handleCopy = async (p: AgentProfileAggregatedItem) => {
    if (!p.workspace_id) {
      notify.warning("个人/平台级档案暂不支持在此复制，请进入归属工作区操作。");
      return;
    }
    try {
      const copied = await copyWorkspaceAgentProfile(p.workspace_id, p.id, {});
      notify.success(`已复制为「${copied.name}」（个人可见），可继续编辑`);
      invalidateMine();
    } catch (err) {
      notify.error(err, "复制档案失败");
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    // 双保险：打开弹窗前已拦截无 workspace_id 的档案，此处再校验一次。
    if (!target.workspace_id) {
      setConfirmDelete(null);
      notify.warning("个人/平台级档案暂不支持在此删除，请进入归属工作区操作。");
      return;
    }
    setDeleting(true);
    try {
      await deleteWorkspaceAgentProfile(target.workspace_id, target.id);
      notify.success(`档案「${target.name}」已删除`);
      setConfirmDelete(null);
      invalidateMine();
    } catch (err) {
      notify.error(err, "删除档案失败");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageContainer size="full">
      <PageHeader
        title="智能体档案"
        subtitle="管理可复用的智能体人设：跨工作区查看全部可见档案，可按工作区/可见范围/供应商筛选。"
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

      {/* 卡片墙（搜索 + 三筛选 + 网格；内部自管人设预览弹窗与加载/错误态） */}
      <AgentProfileCardGrid
        onEdit={handleEdit}
        onCopy={(p) => void handleCopy(p)}
        onDelete={setConfirmDelete}
      />

      {/* 新建/编辑表单（全局页不传 workspaceId → 表单渲染「工作区上下文」选择器） */}
      {formState.open && (
        <AgentProfileForm
          mode={formState.mode}
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
          confirmLoading={deleting}
          maskClosable={false}
          destroyOnClose
        >
          <p className="mt-2 text-xs text-muted-foreground">
            将删除档案 <span className="font-mono">{confirmDelete.name}</span>
            （v{confirmDelete.version}
            {confirmDelete.workspace_name
              ? ` · ${confirmDelete.workspace_name}`
              : ""}
            ）。该操作不可恢复。
          </p>
        </Modal>
      )}
    </PageContainer>
  );
}
