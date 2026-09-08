"use client";

/**
 * 分身会话浮层（task-14 / 2026-08-25-team-subsession-governance；自 session-panel.tsx
 * 拆出，2026-09-07-arch-large-file-split，原样搬移零行为变化）。
 */

import { type LlmProviderRead } from "@/lib/api/llm-providers";
import { type DaemonMachineRead } from "@/lib/daemon";

import { SessionPanel } from "./index";

/**
 * task-14（2026-08-25-team-subsession-governance / FR-08 / design §5.E）：分身
 * 会话浮层——TeamTaskBlock 分身行（有 sub_session_id）点击后，以浮层复用
 * SessionPanel（mode=dialog、sessionId=分身 sub_session_id、attach 续聊形态）
 * 打开该分身子会话；实时流与追问全走面板既有链路（constraints：不新建分身
 * 专用面板/流渲染组件，流与追问逻辑零复制）。page/dialog 两模式共用；关闭
 * 只卸浮层——主控面板常驻不动（流/输入 state 原样保留，验收「关闭返回主控」）。
 *
 * 嵌套安全：worker 子会话非 mission 锚定会话，listSessionTeamMissions 对其
 * 恒空（后端按 AgentMission.session_id 直查），浮层面板不会再渲染团队块，
 * 无递归嵌套。样式走 AI-Native 双主题 token（brand-* 语义阶 + shadow-lg
 * 主题投影，FRONTEND_PAGE_STYLE §0.5 铁律）；黑色半透明遮罩为中性色（同
 * workspace-member-add-dialog 既有浮层惯例）。
 */
export interface WorkerSessionOverlayProps {
  /** 分身子会话 id（TeamTaskBlock onOpenWorkerSession 上抛）。 */
  subSessionId: string;
  /** 关闭浮层（返回主控面板）。 */
  onClose: () => void;
  /** page 模式 SessionPanel 必需 props（2026-09-02 版式统一：内嵌场景与
   * /sessions 全页同一渲染分支）。page 宿主透传全量；dialog 宿主（runtime 卡
   * idle 新建分支）无页面级数据，传空数组——machines 空时 machineHit=null 走
   * 「找不到不判离线」既有兜底，llmProviders 空仅供应商名解析降级。 */
  machines?: DaemonMachineRead[];
  llmProviders?: LlmProviderRead[];
}

export function WorkerSessionOverlay({
  subSessionId,
  onClose,
  machines,
  llmProviders,
}: WorkerSessionOverlayProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="分身会话"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 md:p-8"
    >
      <div className="flex h-full min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <span className="text-sm font-semibold text-foreground">分身会话</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            #{subSessionId.slice(0, 8)}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭分身会话"
            className="shrink-0 rounded-md border border-border px-2.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            返回主控
          </button>
        </div>
        {/* key 按分身会话驱动整体 remount（R6 同款契约：切换分身即重建建流）。
            2026-09-02 版式统一：改 page 分支渲染——与 /sessions 全页完全同构
            （头部工具栏/搜索/加载更早/视图切换/用量条），dialog 紧凑形态退役。 */}
        <div className="min-h-0 flex-1">
          <SessionPanel
            key={subSessionId}
            mode="page"
            sessionId={subSessionId}
            machines={machines ?? []}
            llmProviders={llmProviders ?? []}
          />
        </div>
      </div>
    </div>
  );
}
