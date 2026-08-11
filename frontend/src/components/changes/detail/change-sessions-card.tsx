"use client";

import { ChangeSessionSection } from "@/components/changes/change-session-section";
import { CollapsibleCard } from "./collapsible-card";

/**
 * 会话调试卡（次线侧栏，2026-08-11-change-detail-layout-rework / FR-02 / D-002）。
 *
 * 把「会话」（用户主动发起的交互问答）从主线移入次线，与主线「智能体执行日志」
 * （流程自动 run）彻底分离——这是本次重做消除概念重叠的核心落点。默认收起（次线卡
 * 默认折叠省空间，R-05）；包一层现有 ChangeSessionSection（黑盒复用不改其内部）。
 */
export interface ChangeSessionsCardProps {
  workspaceId: string;
  changeId: string;
}

export function ChangeSessionsCard({
  workspaceId,
  changeId,
}: ChangeSessionsCardProps) {
  return (
    <CollapsibleCard title="会话调试" defaultOpen={false}>
      <p className="mb-2 text-[11px] text-muted-foreground">
        在该变更上下文中提问 / 调试
      </p>
      <ChangeSessionSection workspaceId={workspaceId} changeId={changeId} />
    </CollapsibleCard>
  );
}
