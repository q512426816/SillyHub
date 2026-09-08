"use client";

/**
 * 输入区上方团队触发行（task-11；自 session-panel.tsx 拆出，task-14 /
 * 2026-09-07-arch-large-file-split design §5 Wave 3，原样搬移零行为变化）。
 */

import { Users } from "lucide-react";
import {
  TeamTriggerPopover, type TeamTriggerInitialConfig,
} from "@/components/daemon/team-trigger-popover";
import { type TeamMissionTriggerRequest } from "@/lib/daemon";


/**
 * task-11：输入区上方团队触发行（原型 §01 .team-trigger-row + §02 弹层锚点），
 * page/dialog 两模式共用：活跃状态 chip（可关闭收回）+ TeamTriggerPopover 挂载
 * （relative 锚点 + absolute bottom-full，同 SessionConfigBar 浮层风格）+ 触发
 * 错误提示（409/403/422 中文文案）。纯受控：API 调用/弹层开关归父层（本组件
 * 不含团队业务状态）。
 *
 * ql-20260827-020：「派团队」按钮迁入 SessionInputBar ＋ 功能菜单——本行只保留
 * chip / 错误文案 / 弹层挂载，三者皆空时整行不渲染（原按钮位不再占一行）。
 */
export interface TeamTriggerRowProps {
  /** 活跃 mission 分身数（chip 文案「团队进行中 · N 分身」）；null = 隐藏。 */
  activeWorkers: number | null;
  /**
   * ql-20260828-009-4a13：chip × 改真取消——调父层 cancelTeamMission(活跃
   * mission) + 刷新（原 onDismissChip 仅收起提示条、mission 仍在，用户以为
   * 删了再派却 409；收起记忆 teamChipDismissedId 一并下线）。
   */
  onCancelMission: () => void;
  /** 取消在途（× 禁用防重复提交）。 */
  cancelling?: boolean;
  /**
   * ql-20260828-009-4a13：chip 主体点击——打开派团队弹层更新指派（父层
   * openTeamPopover；确认时 handleTeamTrigger 前置取消活跃 mission）。
   */
  onChipClick: () => void;
  /**
   * ql-20260828-009-4a13：存在活跃 mission（弹层提示「确认后取消并重新指派」，
   * 透传 TeamTriggerPopover.hasActiveMission）。
   */
  hasActiveMission?: boolean;
  /**
   * ql-20260828-011-1ec7：预会话待生效 chip——弹层确认后 preTeamMission 已
   * 暂存（随首句创建落库 D-009），无会话无 mission 期间以此反馈「已配置」。
   */
  pendingTeam?: boolean;
  /** 待生效 chip × ——放弃暂存的团队配置（同时清回填的 /team 输入框）。 */
  onRemovePendingTeam?: () => void;
  /** 弹层开关（父层 state）。 */
  popoverOpen: boolean;
  /**
   * task-13（FR-05）：预会话实例——true 时透传弹层 preSession（渲染主 agent
   * 选择器 + 确认按钮文案「派团队（随首句创建生效）」+ payload 追加
   * orchestrator_workspace_id，task-12 组件契约）；缺省 false 弹层零变化。
   */
  preSession?: boolean;
  /** 会话绑定工作区（弹层 scope 默认「当前工作区」数据源）。 */
  workspaceId: string | null;
  workspaceName: string | null;
  /** 目标预填（/team 指令文本 /「用团队分析」提示句）。 */
  defaultObjective: string | null;
  /**
   * task-07 Phase 5（FR-06 / D-004@v2）：项目预选 id（ppm_project 页面上下文
   * 派生，仅预会话实例传）——弹层 projectId 初值 + scopeMode=project + 关联
   * 工作区自动预选；缺省弹层行为零变化。
   */
  defaultProjectId?: string;
  /** triggerSessionTeamMission 在途（确认按钮禁用）。 */
  submitting: boolean;
  /** 触发错误文案（弹层保持打开时行内展示）。 */
  errorText: string | null;
  /** ql-20260828-012-4425：编辑回显初始配置（chip 点击派生，透传弹层）。 */
  popoverInitial?: TeamTriggerInitialConfig | null;
  onTrigger: (payload: TeamMissionTriggerRequest) => void;
  onClose: () => void;
}

export function TeamTriggerRow({
  activeWorkers,
  onCancelMission,
  cancelling = false,
  onChipClick,
  hasActiveMission = false,
  pendingTeam = false,
  onRemovePendingTeam,
  popoverOpen,
  preSession = false,
  workspaceId,
  workspaceName,
  defaultObjective,
  defaultProjectId,
  submitting,
  errorText,
  popoverInitial,
  onTrigger,
  onClose,
}: TeamTriggerRowProps) {
  // ql-20260827-020：按钮迁走后按需渲染——无 chip / 无错误 / 弹层未开时不占位
  //（弹层仍以本行为锚点，开层时行随之出现）。
  if (activeWorkers === null && !pendingTeam && !errorText && !popoverOpen) {
    return null;
  }
  return (
    <div className="relative flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-5 pb-1.5 pt-2">
      {activeWorkers !== null && (
        <span
          data-testid="team-active-chip"
          title="点击可更新团队指派（确认后取消当前任务重新派发）"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2.5 py-0.5 text-[11.5px] font-medium text-brand-700"
        >
          <Users aria-hidden className="h-3.5 w-3.5" />
          <button
            type="button"
            onClick={onChipClick}
            className="rounded-full px-0.5 py-0 transition-colors hover:text-brand-800"
          >
            团队进行中 · {activeWorkers} 分身
          </button>
          <button
            type="button"
            aria-label="取消团队任务"
            title="取消当前团队任务（分身停止，进度保留在会话记录）"
            onClick={onCancelMission}
            disabled={cancelling}
            className="ml-0.5 rounded-full px-1 leading-none text-brand-500 transition-colors hover:bg-brand-100 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelling ? "…" : "×"}
          </button>
        </span>
      )}
      {/* ql-20260828-011-1ec7：预会话待生效 chip——虚线边框区分「进行中」实线；
          mission 随首句创建落库（D-009），此处反馈配置已暂存。 */}
      {pendingTeam && (
        <span
          data-testid="team-pending-chip"
          title="点击可修改团队配置（随首条消息创建会话时生效）"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-brand-400 bg-brand-50/60 px-2.5 py-0.5 text-[11.5px] font-medium text-brand-700"
        >
          <Users aria-hidden className="h-3.5 w-3.5" />
          <button
            type="button"
            onClick={onChipClick}
            className="rounded-full px-0.5 py-0 transition-colors hover:text-brand-800"
          >
            团队已配置 · 随首句创建生效
          </button>
          <button
            type="button"
            aria-label="放弃团队配置"
            title="放弃本次团队配置（不随首条消息创建团队）"
            onClick={onRemovePendingTeam}
            className="ml-0.5 rounded-full px-1 leading-none text-brand-500 transition-colors hover:bg-brand-100 hover:text-brand-700"
          >
            ×
          </button>
        </span>
      )}
      {errorText && (
        <p role="alert" className="min-w-0 flex-1 truncate text-[11px] text-destructive">
          {errorText}
        </p>
      )}
      {popoverOpen && (
        <TeamTriggerPopover
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          defaultObjective={defaultObjective}
          initialConfig={popoverInitial ?? undefined}
          defaultProjectId={defaultProjectId}
          preSession={preSession}
          submitting={submitting}
          hasActiveMission={hasActiveMission}
          onTrigger={onTrigger}
          onClose={onClose}
        />
      )}
    </div>
  );
}
