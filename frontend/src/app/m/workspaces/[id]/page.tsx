"use client";

/**
 * 工作区移动主页薄壳（task-02 / FR-02 / D-004@V1，2026-08-26-mobile-workspace-page）。
 *
 * D-004 主页入口：/m/workspaces/[id] 本身无内容，落变更列表 Tab——
 * client redirect 到 /m/workspaces/[id]/changes（design §5.1 主页 redirect 形态）。
 * 形态对齐 m/ 段既有 client redirect（m/login:156 / m/account:44 的
 * useEffect + router.replace），本段无 server redirect 先例。
 *
 * 薄壳约束：零数据请求、零 UI（渲染 null）；工作区预取由段 layout 承担。
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MobileWorkspaceHomePage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const workspaceId = params.id ?? "";

  useEffect(() => {
    router.replace(`/m/workspaces/${workspaceId}/changes`);
  }, [router, workspaceId]);

  return null;
}
