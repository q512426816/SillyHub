"use client";

/**
 * task-03（2026-08-22-workspace-sessions-portal / FR-03 / D-002@v1）：变更级
 * 会话门户专属路由页——薄壳。
 *
 * 依据：
 *   - tasks/task-03.md（allowed_paths / implementation / acceptance）
 *   - design.md §5 文件变更清单（本文件为新建项：变更级门户路由薄壳）、§4.A
 *     （ChangeScope = kind=change + workspaceId + changeId，params.id/params.cid
 *     组装）、D-002@v1（变更详情承载形态 = 方案A 专属路由门户，侧边窄卡变入口
 *     跳本路由，2026-08-22 用户三轮拍板留痕）
 *
 * 页面结构对齐既有 workspaces 子页模式（同 workspaces/[id]/sessions/page.tsx：
 * "use client" + params 平铺对象直取，Next 14 无 Promise 解包）。
 * 仅薄壳无业务逻辑——列表/创建绑定/深链选中（?session= 恢复点）全在门户组件
 * （task-01 sessions-portal.tsx）；变更详情入口卡接线归 task-06。
 */

import { SessionsPortal } from "@/components/sessions/sessions-portal";

interface Props {
  params: { id: string; cid: string };
}

export default function ChangeSessionsPage({ params }: Props) {
  return (
    <SessionsPortal
      scope={{
        kind: "change",
        workspaceId: params.id,
        changeId: params.cid,
      }}
    />
  );
}
