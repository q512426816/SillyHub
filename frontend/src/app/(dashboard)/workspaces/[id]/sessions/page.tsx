"use client";

/**
 * task-08（FR-03 / D-002@v1）：工作区独立「会话」入口页（与变更中心平级）。
 *
 * 左侧 workspace 级会话列表（含已结束，listWorkspaceAgentSessions include_ended=true）
 * + 发起新会话入口，右侧复用 InteractiveSessionPanel（建会话 workspace 级，不绑 change_id）。
 * 两栏布局由 WorkspaceSessionSection 承载（从 change-session-section 抽取的通用组件）。
 * 本页不内嵌变更上下文的会话逻辑（那是 change-session-section 职责）。
 */

import { PageContainer, PageHeader } from "@/components/layout";
import { WorkspaceSessionSection } from "@/components/workspace-session-section";

interface Props {
  params: { id: string };
}

export default function WorkspaceSessionsPage({ params }: Props) {
  const workspaceId = params.id;
  return (
    <PageContainer size="full">
      <PageHeader
        title="会话"
        subtitle="工作区级会话：与 agent 对话、发起新会话（不绑定具体变更，与变更中心平级）。"
      />
      <WorkspaceSessionSection workspaceId={workspaceId} />
    </PageContainer>
  );
}
