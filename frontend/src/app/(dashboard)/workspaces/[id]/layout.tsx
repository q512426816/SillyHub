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
  // ql-20260707-004 的宽度理由与现码不符（AppShell 无 max-w，包裹层 max-w-[1440px] 并不裁切），
  // 双前缀剥离连带 changes/[cid] 等普通子页丢顶部菜单——普通页全部恢复统一布局；
  // 仅 topology 是 h-screen 整屏画布页，包裹后 +88px chrome 必然溢出裁切，保留其 standalone。
  const isStandalone = pathname.includes(
    `/workspaces/${params.id}/components/topology`,
  );
  // ql-20260827-008：sessions 门户页放开宽度帽（max-w-none）撑满内容区，对齐
  // /agent-profiles 等平台级列表页 PageContainer size="full" 的占满语义
  // （FRONTEND_PAGE_STYLE.md §「列表页 size=full 占满」）；其余子页维持 1440 收窄。
  const isFullWidth = pathname.startsWith(
    `/workspaces/${params.id}/sessions`,
  );
  if (isStandalone) {
    return <>{children}</>;
  }
  return (
    <main
      className={`mx-auto flex w-full ${
        isFullWidth ? "max-w-none" : "max-w-[1440px]"
      } flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8`}
    >
      <WorkspaceTabs workspaceId={params.id}>{children}</WorkspaceTabs>
    </main>
  );
}
