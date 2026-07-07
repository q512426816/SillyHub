"use client";

import { usePathname } from "next/navigation";

import { WorkspaceBindingGuard } from "@/components/workspace-binding-guard";
import { WorkspaceTabs } from "@/components/workspace-tabs";

export default function WorkspaceDetailLayout({
  params,
  children,
}: {
  params: { id: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // ql-20260707-004：变更中心页 + 项目组件页脱离 workspace layout（不加 main wrapper，
  // 不加 WorkspaceTabs），DOM 与 admin/roles 一致（dashboard layout main → page），
  // 宽度由 dashboard layout max-w-[1440px] 统一管理，且不显示头部 tab 行。
  // 用户反馈 components 页自带 PageContainer，不需要外层 WorkspaceTabs 的【概览/组件/变更/成员】。
  const isStandalone = pathname.includes(`/workspaces/${params.id}/changes`) ||
    pathname.includes(`/workspaces/${params.id}/components`);
  if (isStandalone) {
    return <>{children}</>;
  }
  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <WorkspaceBindingGuard workspaceId={params.id} />
      <WorkspaceTabs workspaceId={params.id}>{children}</WorkspaceTabs>
    </main>
  );
}
