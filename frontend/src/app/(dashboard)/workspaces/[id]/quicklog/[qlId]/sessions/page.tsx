"use client";

/**
 * task-10（2026-08-25-session-spec-binding / FR-04 / D-006@v1）：快速修复级
 * 会话门户专属路由页——薄壳。
 *
 * 依据：
 *   - tasks/task-10.md（allowed_paths / implementation / acceptance）
 *   - design.md §5.W4.1（QuicklogScope 门户：新路由薄壳对齐变更级门户页）、
 *     §4.A（QuicklogScope = kind=quicklog + workspaceId + qlId，params.id/
 *     params.qlId 组装）、§10 D-006@v1（快速修复门户走 QuicklogScope 新路由
 *     /workspaces/[id]/quicklog/[qlId]/sessions，与变更门户同构，对齐
 *     2026-08-22-workspace-sessions-portal D-002@v1 模式）
 *
 * 页面结构对齐既有 workspaces 子页模式（同 workspaces/[id]/changes/[cid]/
 * sessions/page.tsx："use client" + params 平铺对象直取，Next 14 无 Promise
 * 解包）。仅薄壳无业务逻辑——列表（ql_id 端点过滤）/创建绑定（preContext
 * quickId 双传）/深链选中（?session= 恢复点）全在门户组件
 * （sessions-portal.tsx）；抽屉卡入口接线归 task-12（QuicklogSessionsCard
 * 「打开会话工作台」Link）。
 */

import { SessionsPortal } from "@/components/sessions/sessions-portal";

interface Props {
  params: { id: string; qlId: string };
}

export default function QuicklogSessionsPage({ params }: Props) {
  return (
    <SessionsPortal
      scope={{
        kind: "quicklog",
        workspaceId: params.id,
        qlId: params.qlId,
      }}
    />
  );
}
