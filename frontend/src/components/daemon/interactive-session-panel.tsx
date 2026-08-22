"use client";

/**
 * InteractiveSessionPanel —— 薄适配层（task-07 / 2026-08-21-session-message-queue）。
 *
 * 演进史（原 ~1300 行实现体已删除）：
 *   - task-11（FR-10 / D-006@v1）：交互式会话面板初创（/runtimes 弹窗单一交互式会话）；
 *   - task-13：消息流 / 输入区抽为共享子组件 TurnTimeline / SessionInputBar；
 *   - task-10：onLog 日志处理收敛为共享装配器调用（session-log-assembler）；
 *   - task-05（2026-08-21-session-message-queue）：渲染主体整体迁入共享 SessionPanel
 *     （./session-panel.tsx）——其 mode="dialog" 分支 = 本组件逐段搬运 + 队列化改造；
 *   - task-07（本卡，design D-005 组件统一第 3 步）：本文件降级为 props 适配层，
 *     依据 changes/2026-08-21-session-message-queue/diff-analysis.md §5 替换策略：
 *       * 导出面零变更（symbol-impact 备案承诺）：InteractiveSessionPanel 组件 +
 *         InteractiveSessionPanelProps + turn-timeline 类型 re-export 原样保留，
 *         4 个消费方（runtime-session-dialog / runtime-session-helpers /
 *         workspace-session-section / change-session-section）及其 import 不动；
 *       * props 按 diff-analysis §5.1 映射表逐项转换（旧 13 项全部有落点）：唯一
 *         语义迁移 attachSessionId ?? null → sessionId（undefined = idle 新建 → null）；
 *         mode 固定 "dialog"；page 专属 props（machines / llmProviders /
 *         onSessionListRefresh）与 viewMode 受控对本层不透传（dialog 内部自持）。
 *
 * 有意行为变更（design §3.3 状态机，非回归，经新实现渲染生效）：
 *   - D-001：running / reconnecting 期间输入保持可用，消息入队（MessageQueueBar）
 *     等待 turn_completed / 恢复 active 后自动投递——替代旧「运行中禁用输入」；
 *   - D-003：inject 409 TURN_CONFLICT 旧「回填输入框草稿」改为队头 failed 条目 +
 *     重试/删除按钮（D-003 失败留队头语义）。
 */

import { SessionPanel } from "@/components/daemon/session-panel";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";

// task-13：类型定义已迁至 turn-timeline.tsx（共享子组件持有数据契约）。
// 此处 re-export 维持既有 import 路径（runtime-session-helpers / change-session-section
// / runtime-session-dialog 均从本文件导入，不在本 task 改动范围）。
export type {
  SessionProcessItem,
  SessionToolEvent,
  SessionTurnView,
  SessionUiStatus,
  TurnUiStatus,
} from "@/components/daemon/turn-timeline";

export interface InteractiveSessionPanelProps {
  providers: string[];
  defaultProvider: string;
  model: string | null;
  onModelChange: (next: string | null) => void;
  hasOnlineProvider: boolean;
  /**
   * task-10 attach 模式：给定 attachSessionId 时不走 idle→create 新建，
   * 而是建 SSE 订阅 + 预填 initialTurns + 轮询 getAgentSession 直到 active。
   * 成功 active 后续发送走 active 分支（inject）。
   * 适配层归一为 SessionPanel.sessionId：undefined（idle 新建）→ null（§5.1 唯一
   * 语义迁移项，消费方传参不变）。
   */
  attachSessionId?: string;
  initialTurns?: SessionTurnView[];
  /**
   * ql-20260623：createSession 成功后上报新建 session_id 给父级，
   * 父级可据此把 `?session=<id>` 写入 URL（刷新恢复用）。
   */
  onSessionCreated?: (sessionId: string) => void;
  /**
   * ql-20260623：面板重置回 idle（新建会话）时通知父级，
   * 父级据此清除 URL `?session=` param。
   */
  onSessionReset?: () => void;
  /** 2026-07-09-change-detail-session：变更会话绑定透传（D-001）。可选，runtimes 页不传。 */
  changeId?: string;
  /** 工作空间绑定透传（D-003）。可选。 */
  workspaceId?: string;
  /**
   * task-08（FR-08 / D-001@v2）：「用团队分析」成功创建 mission 后上报 missionId。
   * 父级可据此挂 TeamProgress 组件展示主 agent 决策 + worker 进度。
   * task-11（2026-08-22-team-session-unify / D-004）：「用团队分析」改为打开触发
   * 弹层，本回调语义更新 = 弹层确认后 triggerSessionTeamMission 预建成功的
   * mission_id 上报（SessionPanel dialog 分支内部触发，本层仅原样透传）。
   */
  onTeamMissionCreated?: (missionId: string) => void;
  /**
   * 2026-07-31-offline-session-readonly：运行时离线只读模式。true 时禁用 4 操作
   * （新建/发送/打断/结束）+ 顶部离线横幅 + attach 不建 SSE 直接以 initialTurns 只读。
   * 由 RuntimeSessionDialog 据 runtime.status!=='online' 传入；change-session-section
   * 不传（默认 false）→ 原行为不变（D-003）。
   */
  offlineReadOnly?: boolean;
}

/**
 * 适配层（diff-analysis §5 替换策略）：旧 13 项 props → SessionPanelProps 逐项映射，
 * 渲染 <SessionPanel mode="dialog">。会话态 100% 由 SessionPanel 内部持有（R6：
 * 消费方 key 重挂载清 SSE/轮询/队列的契约不变），本层不缓存任何状态。
 */
export function InteractiveSessionPanel({
  providers,
  defaultProvider,
  model,
  onModelChange,
  hasOnlineProvider,
  attachSessionId,
  initialTurns,
  onSessionCreated,
  onSessionReset,
  changeId,
  workspaceId,
  onTeamMissionCreated,
  offlineReadOnly,
}: InteractiveSessionPanelProps) {
  return (
    <SessionPanel
      mode="dialog"
      // §5.1 唯一语义迁移：undefined（idle 新建）→ null（dialog 分支语义）
      sessionId={attachSessionId ?? null}
      providers={providers}
      defaultProvider={defaultProvider}
      model={model}
      onModelChange={onModelChange}
      hasOnlineProvider={hasOnlineProvider}
      initialTurns={initialTurns}
      onSessionCreated={onSessionCreated}
      onSessionReset={onSessionReset}
      changeId={changeId}
      workspaceId={workspaceId}
      onTeamMissionCreated={onTeamMissionCreated}
      offlineReadOnly={offlineReadOnly}
    />
  );
}
