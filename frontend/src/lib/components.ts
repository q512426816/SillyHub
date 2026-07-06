/**
 * 组件清单 API 客户端（D-001@V1，变更 2026-07-06-component-readonly-split）。
 *
 * 组件从 projects/*.yaml 只读派生（GET /workspaces/{id}/components），不再是 workspace 行。
 * 本模块是 listComponents 的薄封装；Component 类型与 getWorkspaceComponents 客户端
 * 在 @/lib/workspaces（避免循环依赖，单一真相）。
 */
import { getWorkspaceComponents, type Component } from "@/lib/workspaces";

export type { Component };

/**
 * 列出项目组的一级子项目组件（只读，来自 projects/*.yaml）。
 */
export async function listComponents(
  workspaceId: string,
): Promise<{ items: Component[]; total: number }> {
  return getWorkspaceComponents(workspaceId);
}
