"use client";

/**
 * 工作区移动段上下文 Provider（task-02 / FR-02 / D-004@V1，2026-08-26-mobile-workspace-page）。
 *
 * /m/workspaces/[id]/** 所有子页共享的工作区数据在段 layout 一次预取：
 *  - useQuery 预取 getWorkspace(id)（数据层 100% 复用 @/lib/workspaces，禁止自写请求）；
 *  - queryKey 逐字对齐桌面 (dashboard)/workspaces/[id]/git-log/page.tsx:64 的既有
 *    三段形态 ["workspaces", "detail", id]——与桌面共享 react-query 缓存（不新造
 *    ["workspaces", id] 直挂写法）；
 *  - Context 暴露 useMobileWorkspace()（workspaceId/workspace/isLoading/error），
 *    供子页（顶栏工作区名/在线状态等）消费，避免每页重复拉取；
 *  - 预取中/失败不阻塞子页渲染——children 无条件直出，子页按 isLoading/error 自行降级。
 *
 * 本 layout 纯 Provider、零视觉元素（段容器/钻取分支由上层 app/m/layout.tsx 提供）。
 */
import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { getWorkspace, type Workspace } from "@/lib/workspaces";

/** 子页共享的工作区上下文值（layout 预取注入）。 */
export interface MobileWorkspaceContextValue {
  /** 路由段 [id] 原值（URL 是工作区上下文真相源）。 */
  workspaceId: string;
  /** 预取解析后的 Workspace；未完成/失败为 undefined（子页按 isLoading/error 降级）。 */
  workspace: Workspace | undefined;
  /** 预取进行中。 */
  isLoading: boolean;
  /** 预取失败（null=无错误）；失败不阻塞渲染。 */
  error: Error | null;
}

/**
 * 工作区上下文（默认 null，必须经本 layout 的 Provider 注入；
 * 在 Provider 外消费由 useMobileWorkspace 抛错兜底）。
 */
export const MobileWorkspaceContext =
  createContext<MobileWorkspaceContextValue | null>(null);

/**
 * 取当前工作区上下文（workspaceId/workspace/isLoading/error）。
 * 必须在 /m/workspaces/[id] 段内使用（本 layout Provider 之下），否则抛错。
 */
export function useMobileWorkspace(): MobileWorkspaceContextValue {
  const ctx = useContext(MobileWorkspaceContext);
  if (!ctx) {
    throw new Error(
      "useMobileWorkspace() 必须在 /m/workspaces/[id] 段 layout（Provider）内使用",
    );
  }
  return ctx;
}

export default function MobileWorkspaceLayout({
  params,
  children,
}: {
  params: { id: string };
  children: ReactNode;
}) {
  const workspaceId = params.id ?? "";
  // queryKey 三段形态逐字对齐桌面 git-log 页（共享缓存，R-03 同类漂移防线）。
  const workspaceQuery = useQuery({
    queryKey: ["workspaces", "detail", workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: workspaceId !== "",
  });

  return (
    <MobileWorkspaceContext.Provider
      value={{
        workspaceId,
        workspace: workspaceQuery.data,
        isLoading: workspaceQuery.isLoading,
        error: workspaceQuery.error ?? null,
      }}
    >
      {children}
    </MobileWorkspaceContext.Provider>
  );
}
