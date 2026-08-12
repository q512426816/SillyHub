"use client";

import { AgentProfileSelect } from "@/components/agent-profile-select";
import {
  StageTeamConfig,
  type StageWorkerPreset,
} from "@/components/stage-team-config";
import { Button } from "@/components/ui/button";
import type {
  ChangeRead,
  DispatchResponse,
  VerifyGateResponse,
} from "@/lib/changes";

import { WORKFLOW_STAGE_LABELS } from "./change-stage-header";

/**
 * 当前阶段操作区（主线，2026-08-11-change-detail-layout-rework / FR-05 / D-004）。
 *
 * 把原 page.tsx 散落 5+ 处的智能体操作入口统一收口到一处：
 *   - gate 审核面板（pending_review 投影）
 *   - 「完成待触发」推进横幅（推进下一阶段 + 运行验证门禁）
 *   - 触发智能体（重派当前阶段）
 *   - Agent Provider/Model 覆盖
 *   - 团队开关 + StageTeamConfig
 *
 * 纯受控展示组件：不调任何 lib/changes API、不自带数据请求，全部 state/handler 由
 * page.tsx 经 Props 注入。GATE_PANELS 配置从 page.tsx 原样搬入（语义不变）。
 *
 * team toggle 的 role="switch" + aria-label="用团队执行" 为硬 DOM 契约，
 * page-team-toggle 测试迁移依赖，严禁破坏（R-06）。
 */

// Gate panel config：由 change.pending_review 投影驱动（对齐 task-03 PendingReview 枚举）。
// 4 个面板分别对应 proposal_review / plan_review / human_test / archive_confirm。
const GATE_PANELS: Record<
  string,
  {
    title: string;
    description: string;
    actions: {
      label: string;
      variant: "default" | "outline" | "destructive";
      action: string;
    }[];
  }
> = {
  proposal_review: {
    title: "四件套已生成，请确认",
    description: "智能体 已生成 proposal / requirements / design / tasks，请审阅后决定",
    actions: [
      { label: "确认通过", variant: "default", action: "proposal_approve" },
      { label: "需要修改", variant: "outline", action: "proposal_revise" },
      { label: "需求不明确", variant: "destructive", action: "proposal_unclear" },
    ],
  },
  plan_review: {
    title: "执行计划已生成，请确认",
    description: "智能体 已生成执行计划，请审阅后决定",
    actions: [
      { label: "确认计划", variant: "default", action: "plan_approve" },
      { label: "重新计划", variant: "outline", action: "plan_replan" },
      { label: "退回文档", variant: "destructive", action: "plan_back_to_propose" },
      { label: "退回需求", variant: "destructive", action: "plan_back_to_brainstorm" },
    ],
  },
  human_test: {
    title: "自动验证通过，请人工测试",
    description: "智能体 已完成自动验证，请进行人工测试（发现 BUG / 文档不符即返工反馈）",
    actions: [
      { label: "测试通过", variant: "default", action: "test_pass" },
      { label: "发现 BUG", variant: "destructive", action: "test_bug" },
      { label: "文档不符", variant: "outline", action: "test_doc_mismatch" },
    ],
  },
  archive_confirm: {
    title: "归档确认",
    description: "所有验证已通过，确认归档此变更",
    actions: [{ label: "确认归档", variant: "default", action: "archive_confirm" }],
  },
};

export interface ChangeStageActionsProps {
  change: ChangeRead;
  agentStatus: DispatchResponse | null;
  nextStage: string | null;
  verifyGate: VerifyGateResponse | null;
  gateComment: string;
  onGateCommentChange: (_v: string) => void;
  // 入口回调
  onGateAction: (_action: string) => void;
  onAdvance: () => void;
  onRunVerifyGate: () => void;
  onDispatch: () => void;
  // loading 态
  transitioning: boolean;
  dispatching: boolean;
  advancing: boolean;
  // 2026-08-12-dispatch-bind-agent-profile：阶段操作区改选档案（方案A 仅档案）。
  // workspaceId 供 AgentProfileSelect 拉档案；stageProfileId null=跟随工作区默认。
  workspaceId: string;
  stageProfileId: string | null;
  onStageProfileChange: (_v: string | null) => void;
  teamMode: boolean;
  onTeamModeChange: (_v: boolean) => void;
  stageWorkers: StageWorkerPreset[];
  onStageWorkersChange: (_w: StageWorkerPreset[]) => void;
}

export function ChangeStageActions({
  change,
  agentStatus,
  nextStage,
  verifyGate,
  gateComment,
  onGateCommentChange,
  onGateAction,
  onAdvance,
  onRunVerifyGate,
  onDispatch,
  transitioning,
  dispatching,
  advancing,
  workspaceId,
  stageProfileId,
  onStageProfileChange,
  teamMode,
  onTeamModeChange,
  stageWorkers,
  onStageWorkersChange,
}: ChangeStageActionsProps) {
  const gatePanel = GATE_PANELS[change.pending_review ?? ""];
  const hasActiveRun = agentStatus?.has_active_run ?? false;
  const configEnabled = agentStatus?.config_enabled ?? false;
  const currentStage = change.current_stage ?? "draft";

  // 团队开关渲染条件（与现 page.tsx 一致）
  const teamVisible =
    change.pending_review === "plan_review" ||
    currentStage === "execute" ||
    currentStage === "verify" ||
    change.pending_review === "human_test";

  return (
    <div className="space-y-3">
      {/* gate 审核面板 */}
      {gatePanel ? (
        <section className="space-y-2.5 rounded-md border-2 border-primary/20 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{gatePanel.title}</p>
            <p className="text-xs text-muted-foreground">
              {gatePanel.description}
            </p>
          </div>
          <textarea
            className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
            rows={2}
            placeholder="审核意见（可选）"
            value={gateComment}
            onChange={(e) => onGateCommentChange(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {gatePanel.actions.map((a) => (
              <Button
                key={a.action}
                variant={a.variant}
                size="sm"
                onClick={() => onGateAction(a.action)}
                disabled={transitioning}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {/* 统一阶段操作卡片（2026-08-12 ql：合并推进横幅 + 档案选择 + 触发按钮，
          对齐 prototype-option-a 的单卡片 violet 布局）。
          标题 + 档案选择器常驻；推进/验证门禁按钮按条件显示。 */}
      <section className="space-y-3 rounded-md border border-violet-500/40 bg-violet-50/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">阶段操作</span>
          <span className="text-xs text-muted-foreground">
            选档案 → 用档案配置派发；不选 → 按默认
          </span>
        </div>

        {/* 档案选择器（常驻） */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            智能体档案
          </span>
          <AgentProfileSelect
            workspaceId={workspaceId}
            value={stageProfileId}
            onChange={onStageProfileChange}
            includeDefault="跟随工作区默认"
          />
        </div>
        {/* FR-08 已知 gap 提示：本次仅 provider/凭证/allowed_roots 生效，
            system_prompt/skill/mcp 链路修复放下个变更。 */}
        <p className="text-[11px] text-muted-foreground">
          选档案后生效：供应商/模型/凭证/可访问根目录；系统提示/技能/MCP 下版本支持
        </p>

        {/* 底部按钮区：推进（无 gate + 有下一阶段 + 无活跃 run）/ 验证门禁（verify）/
            触发智能体（configEnabled + 无活跃 run）共用档案选择 */}
        {!gatePanel && nextStage && !hasActiveRun ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-violet-500/20 pt-2.5">
            <p className="text-[11px] text-muted-foreground">
              当前阶段已完成，待触发下一阶段
              {verifyGate ? (
                <>
                  {"　验证门禁："}
                  {verifyGate.source === "unavailable"
                    ? "暂不可用（请人工核验）"
                    : verifyGate.exit_code === 0
                      ? "✓ 通过"
                      : verifyGate.exit_code === null
                        ? "无结果"
                        : `✗ 未通过（exit ${verifyGate.exit_code}）`}
                  {verifyGate.errors.length > 0
                    ? ` · ${verifyGate.errors.slice(0, 3).join("；")}`
                    : ""}
                </>
              ) : null}
            </p>
            <div className="flex items-center gap-2">
              {currentStage === "verify" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRunVerifyGate}
                  disabled={advancing || dispatching}
                >
                  {advancing ? "核验中…" : "运行验证门禁"}
                </Button>
              ) : null}
              {configEnabled ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDispatch}
                  disabled={dispatching}
                >
                  {dispatching ? "触发中…" : "🤖 触发智能体"}
                </Button>
              ) : null}
              <Button
                size="sm"
                onClick={onAdvance}
                disabled={dispatching || advancing}
              >
                {dispatching
                  ? "推进中…"
                  : `推进到「${WORKFLOW_STAGE_LABELS[nextStage] ?? nextStage}」`}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-t border-violet-500/20 pt-2.5">
            {configEnabled && !hasActiveRun ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onDispatch}
                disabled={dispatching}
              >
                {dispatching ? "触发中…" : "🤖 触发智能体"}
              </Button>
            ) : null}
            {hasActiveRun ? (
              <span className="text-[11px] text-muted-foreground">
                智能体执行中…
              </span>
            ) : null}
          </div>
        )}
      </section>

      {/* 团队开关 + StageTeamConfig */}
      {teamVisible ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 rounded-md border border-violet-500/40 bg-violet-50 px-3 py-2 text-xs">
            <button
              type="button"
              role="switch"
              aria-checked={teamMode}
              aria-label="用团队执行"
              onClick={() => onTeamModeChange(!teamMode)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                teamMode ? "bg-violet-500" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  teamMode ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
            <span className="font-medium text-violet-900">
              用团队{currentStage === "verify" ? "验证" : "执行"}
            </span>
            <span className="text-muted-foreground">
              （多 worker 并行
              {currentStage === "verify" ? "核验" : "写"}，主 agent 指挥 + 合并）
            </span>
          </label>

          {teamMode ? (
            <StageTeamConfig
              stage={currentStage === "verify" ? "verify" : "execute"}
              workers={stageWorkers}
              onWorkersChange={onStageWorkersChange}
              workspaceId={workspaceId}
              mainProfileId={stageProfileId}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
