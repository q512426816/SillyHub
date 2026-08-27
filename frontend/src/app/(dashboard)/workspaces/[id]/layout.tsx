"use client";

import { usePathname } from "next/navigation";

import { WorkspaceTabs } from "@/components/workspace-tabs";

export default function WorkspaceDetailLayout({
  params,
  children,
}: {
  params: { id: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // 2026-08-20-workspace-nav-consolidate（D-403）：standalone 收窄为仅 components/topology。
  // ql-20260707-004 的宽度理由与现码不符（AppShell 无 max-w，包裹层不裁切宽度），
  // 双前缀剥离连带 changes/[cid] 等普通子页丢顶部菜单——普通页全部恢复统一布局；
  // 仅 topology 是 h-screen 整屏画布页，包裹后 +88px chrome 必然溢出裁切，保留其 standalone。
  const isStandalone = pathname.includes(
    `/workspaces/${params.id}/components/topology`,
  );
  if (isStandalone) {
    return <>{children}</>;
  }
  // ql-20260827-011：main 彻底移除 max-w-[1440px] 宽度帽（含配套 mx-auto）——
  // 所在工作区子页撑满内容区，对齐 /agent-profiles 等平台级页（AppShell 无帽 +
  // PageContainer size="full" 占满语义，FRONTEND_PAGE_STYLE.md）；本条是
  // ql-20260827-008（仅 sessions 路由放开）的用户定案超集，isFullWidth 分支随之删除。
  return (
    <main className="flex w-full flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <WorkspaceTabs workspaceId={params.id}>{children}</WorkspaceTabs>
    </main>
  );
}
