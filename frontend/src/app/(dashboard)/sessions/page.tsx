"use client";

/**
 * 智能体会话总入口页 /sessions —— 薄壳（2026-08-14-sessions-portal task-10 建页；
 * 2026-08-22-workspace-sessions-portal task-02 薄壳化）。
 *
 * 依据：
 *   - tasks/task-02.md（allowed_paths / implementation / acceptance）
 *   - design.md §4.A（页面外壳整体让位门户组件，本页仅渲染无参 SessionsPortal）、
 *     §4.E（三入口统一渲染体：全局 / 工作区 / 变更）
 *   - components/sessions/sessions-portal.tsx（task-01 提取的共享门户；本页原
 *     外壳逻辑——机器/供应商 react-query、selectedSessionId 状态、SessionListPanel
 *     + SessionPanel 两态、key 重挂载契约、删除后清选中、?session= 深链——已
 *     整块迁移至该组件，本页零自持逻辑；task-06/07 起右侧=真会话/预会话/空
 *     门户三分支，NewSessionForm 已退役 D-109）
 *
 * 薄壳职责：仅提供路由文件与默认导出；无参 SessionsPortal = 全局门户
 * （scope 缺省，D-001@v1），行为与提取前的本页零回归。
 * page.test.tsx 18 用例预会话语义迁移归 task-07（2026-08-23-sessions-
 * workspace-hub）。
 */

import { SessionsPortal } from "@/components/sessions/sessions-portal";

export default function SessionsPortalPage() {
  return <SessionsPortal />;
}
