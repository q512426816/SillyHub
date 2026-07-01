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
  // 变更中心页完全脱离 workspace layout（不加 main wrapper，不加 WorkspaceTabs），
  // DOM 结构与 admin/roles 完全一致：dashboard layout main → page。
  // 这样宽度由 dashboard layout 的 max-w-[1440px] 统一管理，不会多一层 wrapper。
  if (pathname.includes(`/workspaces/${params.id}/changes`)) {
    return <>{children}</>;
  }
  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <WorkspaceTabs workspaceId={params.id}>{children}</WorkspaceTabs>
    </main>
  );
}
