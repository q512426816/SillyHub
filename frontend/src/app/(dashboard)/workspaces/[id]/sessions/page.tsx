"use client";

/**
 * task-02（2026-08-22-workspace-sessions-portal / FR-02 / D-001@v1）：工作区级
 * 会话入口页——薄壳渲染 workspace scope 的 SessionsPortal（三入口统一组件）。
 *
 * 依据：
 *   - tasks/task-02.md（allowed_paths / implementation / acceptance）
 *   - design.md §4.A（workspaceId 取自路由 params.id 组装 WorkspaceScope）、
 *     §4.E（原 dialog 模式两栏装配组件自本页解绑，本页不再消费）
 *   - components/sessions/sessions-portal.tsx（task-01 共享门户：scope 派生
 *     workspace 级列表数据源 + NewSessionForm 锁定 bindWorkspaceId + 标题
 *     「智能体会话 · 工作区」后缀；?session= 深链恢复）
 *
 * 原 dialog 模式会话装配组件自本页解绑，组件本体退役归 task-07。本页不内嵌
 * 任何会话列表/面板逻辑（全在门户组件）。
 */

import { SessionsPortal } from "@/components/sessions/sessions-portal";

interface Props {
  params: { id: string };
}

export default function WorkspaceSessionsPage({ params }: Props) {
  return <SessionsPortal scope={{ kind: "workspace", workspaceId: params.id }} />;
}
