"use client";

import { ChangeFileTree } from "@/components/change-file-tree";
import { CollapsibleCard } from "./collapsible-card";

/**
 * 变更文件卡（次线侧栏，2026-08-11-change-detail-layout-rework / FR-01）。
 * 包一层现有 ChangeFileTree（黑盒复用，不改其内部），默认展开（文件树是次线主信息）。
 */
export interface ChangeFilesCardProps {
  workspaceId: string;
  changeId: string;
}

export function ChangeFilesCard({
  workspaceId,
  changeId,
}: ChangeFilesCardProps) {
  return (
    <CollapsibleCard title="变更文件" defaultOpen={true}>
      <ChangeFileTree workspaceId={workspaceId} changeId={changeId} />
    </CollapsibleCard>
  );
}
