"use client";

/**
 * task-06（2026-07-09-workspace-prioritization / FR-05 / D-003 / CB-2 / CB-1）
 *
 * daemon 绑定弹窗 —— 容器化包裹现有 `WorkspaceAccessGuide`（首次绑定模式）。
 *
 * **CB-2 强制**：本组件只做 Radix `Dialog` 壳，内部渲染 `WorkspaceAccessGuide`，
 * 不重写 daemon 下拉 / root_path / path_source 表单，也不直接调 `upsertMyBinding`。
 * 表单逻辑全部由 AccessGuide 维护，避免双份维护。
 *
 * **CB-1 分工**：本弹窗只管「首次绑定」（列表页/顶栏切换器点击未绑定项时弹出）；
 * 详情页 `WorkspaceBindingGuard` 保留为「编辑入口」，本 task 不动 Guard。
 *
 * 回调桥接：AccessGuide 保存成功触发 `onConfigured` → 本组件 `await fetchMyBinding`
 * 回读最新绑定对象 → `onBound(binding|null)` 上抛父级（父级刷新列表/进入工作区）
 * → `onClose()` 关窗。回读失败退化为 `onBound(null)`，但写入已在 AccessGuide 内
 * 确认成功，不因回读失败卡住用户，仍关窗。
 *
 * `open` 由父级受控（与 `runtime-session-dialog.tsx` 一致），本组件不持有 open state。
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkspaceAccessGuide } from "@/components/workspace-access-guide";
import { fetchMyBinding, type MemberBindingView } from "@/lib/workspace-binding";

export interface WorkspaceBindingDialogProps {
  workspaceId: string;
  /** 外层受控（Radix Dialog open）。 */
  open: boolean;
  /** AccessGuide 保存成功后上抛最新绑定；null = fetchMyBinding 回读失败兜底。 */
  onBound: (binding: MemberBindingView | null) => void;
  onClose: () => void;
}

export function WorkspaceBindingDialog({
  workspaceId,
  open,
  onBound,
  onClose,
}: WorkspaceBindingDialogProps) {
  async function handleConfigured() {
    let binding: MemberBindingView | null = null;
    try {
      binding = await fetchMyBinding(workspaceId);
    } catch {
      // 回读失败：写入已在 AccessGuide 内确认成功，退化为 null 兜底，不卡住用户。
      binding = null;
    }
    onBound(binding);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>配置此工作空间的守护进程</DialogTitle>
          <DialogDescription>
            绑定你的守护进程和本地路径后才能进入工作区。
          </DialogDescription>
        </DialogHeader>
        <WorkspaceAccessGuide
          workspaceId={workspaceId}
          onConfigured={() => void handleConfigured()}
        />
      </DialogContent>
    </Dialog>
  );
}
