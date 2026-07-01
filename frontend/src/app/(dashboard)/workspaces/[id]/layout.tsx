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
  // 变更中心页脱离 workspace tabs（概览/组件/变更/成员），改独立布局对齐 admin/roles。
  const hideTabs = pathname.includes(`/workspaces/${params.id}/changes`);
  // 变更中心页脱离 workspace tabs + 外层宽度限制（让 PageContainer 全权管理宽度，
  // 不与 dashboard layout 的 max-w-[1440px] 嵌套成双倍限制 + 双倍 padding）。
  return (
    <main
      className={
        hideTabs
          ? "flex w-full flex-col"
          : "mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8"
      }
    >
      {hideTabs ? children : <WorkspaceTabs workspaceId={params.id}>{children}</WorkspaceTabs>}
    </main>
  );
}
