"use client";

/**
 * 「文件与对账」面板（2026-10-15-change-detail-redesign / FR-07 / FR-11 / D-004@v1 / D-012@v1）。
 *
 * 三块自上而下，全部为既有组件编排（本面板零取数逻辑，取数在各子组件内部）：
 *   ① 变更文件——**复用路径**：直接挂载 `frontend/src/components/change-file-tree.tsx`
 *      的 `ChangeFileTree`（组件自渲染左树 + 右预览/diff、自持取数、无 Dialog 依赖），
 *      MUST NOT 再包一层「打开」按钮 + Dialog（`change-files-card.tsx` 的 Dialog 形态属
 *      既有消费面，不改不删）；
 *   ② 范围对账——`ScopeAuditCommandCard` 由侧栏常驻改为挂载在本面板（D-004）；
 *   ③ 关联的快速任务——`QuicklogLinkedCard`（空/失败仍静默隐藏，沿用其既有语义）。
 *
 * 懒挂载：本面板由页面层以「仅当前 tab 挂载」方式接线（见 task-07），面板本体不自行
 * 判断 tab；故切到「文件与对账」前不发生本面板内任何取数。
 */
import { ChangeFileTree } from "@/components/change-file-tree";
import { ScopeAuditCommandCard } from "@/components/changes/scope-audit-command-card";
import { QuicklogLinkedCard } from "@/components/changes/detail/quicklog-linked-card";

export interface ChangeFilesPanelProps {
  workspaceId: string;
  changeId: string;
  /** 变更 key（scope-audit 的 identifier 与快速任务反查锚点）。 */
  changeKey: string;
  /** 已归档（终态）——透传给范围对账卡以启用归档降级指路文案。 */
  archived: boolean;
}

export function ChangeFilesPanel({
  workspaceId,
  changeId,
  changeKey,
  archived,
}: ChangeFilesPanelProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="change-files-panel">
      {/* 变更文件：ChangeFileTree 自带「变更文件」卡头（2026-10-16 用户反馈：去掉
          面板外包的一层重复标题）。外层定高 560px 激活组件内部 min-h-0/flex-1 限高链
          ——树与预览各自内滚，整列不再无限高（2026-10-16 用户反馈：无限高左右点击不方便）。 */}
      <div className="flex h-[560px] flex-col" data-testid="change-files-panel-tree">
        <ChangeFileTree workspaceId={workspaceId} changeId={changeId} />
      </div>

      <ScopeAuditCommandCard
        target={{ kind: "change", workspaceId, changeKey }}
        archived={archived}
      />

      <QuicklogLinkedCard workspaceId={workspaceId} changeKey={changeKey} />
    </div>
  );
}
