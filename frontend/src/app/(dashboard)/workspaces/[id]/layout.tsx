"use client";

import { SpecSyncConflictBanner } from "@/components/spec-sync-conflict-banner";
import { WorkspaceTabs } from "@/components/workspace-tabs";

export default function WorkspaceDetailLayout({
  params,
  children,
}: {
  params: { id: string };
  children: React.ReactNode;
}) {
  // 2026-10-11-retire-components-page：components/topology 随组件页一并下线，
  // 无整屏画布子页——所有子页统一 WorkspaceTabs 布局（D-403 收窄理由随页退役）。
  // 2026-09-26-spec-sync-receipt-visibility：spec 同步冲突横幅（开放行非空才渲染）
  const conflictBanner = <SpecSyncConflictBanner workspaceId={params.id} />;
  // ql-20260827-011：main 彻底移除 max-w-[1440px] 宽度帽（含配套 mx-auto）——
  // 所在工作区子页撑满内容区，对齐 /agent-profiles 等平台级页（AppShell 无帽 +
  // PageContainer size="full" 占满语义，FRONTEND_PAGE_STYLE.md）；本条是
  // ql-20260827-008（仅 sessions 路由放开）的用户定案超集，isFullWidth 分支随之删除。
  return (
    <main className="flex w-full flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      {conflictBanner}
      <WorkspaceTabs workspaceId={params.id}>{children}</WorkspaceTabs>
    </main>
  );
}
