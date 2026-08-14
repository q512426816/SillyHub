"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ChangeRead } from "@/lib/changes";
import type { AgentSessionListItem } from "@/lib/daemon";

/**
 * 审批卡（2026-08-14-change-center-conversation-driven task-10 / D-003@v1 / D-006@v2）。
 *
 * 变更详情页**唯一操作区**：意见输入 + 绑定会话只读展示 + 「通过/打回并通知绑定会话」。
 * 执行控制（推进 / 重新派发 / 验证门禁 / 选档案 / 团队配置，含 quick 分支）已全部删除——
 * 变更由 agent 在会话里经 sillyspec 驱动，平台只做展示板 + 人工审批（D-003@v1）。
 * quick 类变更由 agent 在会话里跑 ``sillyspec run quick`` 触发，无需平台按钮。
 *
 * 审批走单端点调用（submitStageReview 透传 notify_session），注入由后端以服务身份
 * best-effort 完成；据响应 notified_session / notify_error 展示三类降级提示
 * （turn_conflict / session_inactive / 其它），审批记录与状态不受注入失败影响。
 *
 * 纯受控展示组件：不调任何 lib API、不自带数据请求，state/handler 由 page.tsx 注入。
 */

// 审批卡按钮 → action 映射（plan.md 前置钉死，对齐 lib/changes.ts submitStageReview 分发）。
// 通过/打回各一主项；archive_confirm 无打回（仅 comment 透传）。
const APPROVAL_PANELS: Record<
  string,
  {
    title: string;
    description: string;
    pass: { label: string; action: string };
    reject: { label: string; action: string } | null;
  }
> = {
  proposal_review: {
    title: "四件套已生成，请确认",
    description: "智能体 已生成 proposal / requirements / design / tasks，请审阅后决定",
    pass: { label: "通过并通知绑定会话", action: "proposal_approve" },
    reject: { label: "打回并通知绑定会话", action: "proposal_revise" },
  },
  plan_review: {
    title: "执行计划已生成，请确认",
    description: "智能体 已生成执行计划，请审阅后决定",
    pass: { label: "通过并通知绑定会话", action: "plan_approve" },
    reject: { label: "打回并通知绑定会话", action: "plan_replan" },
  },
  human_test: {
    title: "自动验证通过，请人工测试",
    description: "智能体 已完成自动验证，请进行人工测试（发现 BUG 即返工反馈）",
    pass: { label: "通过并通知绑定会话", action: "test_pass" },
    reject: { label: "打回并通知绑定会话", action: "test_bug" },
  },
  archive_confirm: {
    title: "归档确认",
    description: "所有验证已通过，确认归档此变更",
    pass: { label: "归档并通知绑定会话", action: "archive_confirm" },
    reject: null,
  },
};

/** 会话状态中文标签（只读展示用）。 */
const SESSION_STATUS_LABELS: Record<string, string> = {
  pending: "等待中",
  active: "进行中",
  reconnecting: "重连中",
  ended: "已结束",
  failed: "已失败",
};

/** 审批注入结果（D-006@v2：notified_session=false 时 notify_error 语义化）。 */
export type NotifyResult = {
  notified_session: boolean;
  notify_error: string | null;
};

export interface ChangeStageActionsProps {
  change: ChangeRead;
  /** 绑定会话（change_session_links 最新；前端取工作区最近活跃会话近似展示，可空）。 */
  boundSession: AgentSessionListItem | null;
  gateComment: string;
  onGateCommentChange: (_v: string) => void;
  /** 审批动作（action 词表，comment 由卡片内意见输入携带）。 */
  onGateAction: (_action: string) => void;
  transitioning: boolean;
  /** 最近一次审批的注入结果（用于降级提示；null=尚未审批）。 */
  notifyResult: NotifyResult | null;
}

/** 降级提示语义化：返回 { title, copyable }；注入成功时返回 null。 */
function degradeMessage(
  notify: NotifyResult,
  change: ChangeRead,
): { title: string; copyable: string } | null {
  if (notify.notified_session) return null;
  const key = change.change_key ?? change.id;
  switch (notify.notify_error) {
    case "turn_conflict":
      return {
        title: "审批已生效，agent 忙，请稍后在会话中告知继续",
        copyable: `变更 ${key} 的审批已生效，请继续推进。`,
      };
    case "session_inactive":
      return {
        title: "绑定会话已结束，审批已生效，请去会话页开启新会话",
        copyable: `变更 ${key} 的审批已生效，请开启新会话后继续推进。`,
      };
    default:
      return {
        title: "审批已生效，但通知绑定会话失败（审批记录与状态不受影响）",
        copyable: `变更 ${key} 的审批已生效，请继续推进。`,
      };
  }
}

export function ChangeStageActions({
  change,
  boundSession,
  gateComment,
  onGateCommentChange,
  onGateAction,
  transitioning,
  notifyResult,
}: ChangeStageActionsProps) {
  const [copied, setCopied] = useState(false);
  const currentStage = change.current_stage ?? "draft";
  const gatePanel = APPROVAL_PANELS[change.pending_review ?? ""];

  // quick 独立阶段（D-003）：无平台执行控制，仅只读说明。
  if (currentStage === "quick") {
    return (
      <section className="space-y-2 rounded-md border border-amber-500/40 bg-amber-50/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">⚡ 快速修复</span>
          <span className="text-xs text-muted-foreground">
            快速通道，不走完整流程
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          快速修复由智能体在会话中执行（sillyspec run quick），平台无需操作；完成态经同步链路回写。
        </p>
      </section>
    );
  }

  // 无待审阶段：无操作区（只读展示区由其它卡片承载）。
  if (!gatePanel) {
    return (
      <section className="rounded-md border border-muted bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">
          当前无可审批事项，阶段推进由智能体在会话中驱动。
        </p>
      </section>
    );
  }

  const degrade = notifyResult ? degradeMessage(notifyResult, change) : null;

  const handleCopy = async () => {
    if (!degrade || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(degrade.copyable);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard 写入被拒时静默 */
    }
  };

  return (
    <section className="space-y-2.5 rounded-md border-2 border-primary/20 bg-primary/5 px-4 py-3">
      <div>
        <p className="text-sm font-semibold">{gatePanel.title}</p>
        <p className="text-xs text-muted-foreground">{gatePanel.description}</p>
      </div>

      {/* 绑定会话只读展示（change_session_links 最新；前端取工作区最近活跃会话近似） */}
      {boundSession ? (
        <div className="rounded border bg-background px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            绑定会话（审批结果将通知此会话）
          </p>
          <p className="truncate text-xs font-medium">
            {boundSession.title ?? `会话 ${boundSession.id.slice(0, 8)}`}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {boundSession.provider} ·{" "}
            {SESSION_STATUS_LABELS[boundSession.status] ?? boundSession.status}
            {boundSession.last_active_at
              ? ` · 最近活跃 ${new Date(boundSession.last_active_at).toLocaleString("zh-CN")}`
              : ""}
          </p>
        </div>
      ) : (
        <div className="rounded border border-dashed bg-background px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            暂无可通知的绑定会话，审批结果仅落库展示
          </p>
        </div>
      )}

      <textarea
        className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
        rows={2}
        placeholder="审核意见（可选）"
        value={gateComment}
        onChange={(e) => onGateCommentChange(e.target.value)}
      />

      {/* 通过/打回并通知绑定会话（archive_confirm 无打回） */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => onGateAction(gatePanel.pass.action)}
          disabled={transitioning}
        >
          {gatePanel.pass.label}
        </Button>
        {gatePanel.reject ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onGateAction(gatePanel.reject!.action)}
            disabled={transitioning}
          >
            {gatePanel.reject.label}
          </Button>
        ) : null}
      </div>

      {/* 注入降级提示（三类，R-03：审批已落库，注入失败不回滚） */}
      {degrade ? (
        <div
          className="space-y-1.5 rounded border border-amber-500/40 bg-amber-50/60 px-3 py-2"
          data-testid="approval-notify-degrade"
        >
          <p className="text-xs font-medium text-amber-800">{degrade.title}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded bg-background px-2 py-1 text-[11px] text-foreground">
              {degrade.copyable}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopy()}
              disabled={copied}
            >
              {copied ? "已复制" : "复制文案"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
