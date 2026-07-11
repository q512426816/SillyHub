"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  WorkspaceAccessGuide,
  type AccessGuideInitial,
} from "@/components/workspace-access-guide";
import {
  fetchMyBinding,
  type MemberBindingView,
} from "@/lib/workspace-binding";

interface Props {
  workspaceId: string;
}

/**
 * Detects whether the current user has a binding for this workspace.
 *
 * - 未绑定（unbound）：直接渲染首次绑定引导卡片（WorkspaceAccessGuide 首次模式）。
 * - 已绑定（bound）：不再 return null，而是渲染「编辑我的接入配置」入口按钮，
 *   点击展开 AccessGuide 编辑模式（回填当前 daemon_id / root_path）。
 *   保存调 upsertMyBinding（task-05 / D-007），保存成功后收起并刷新 binding。
 *
 * Owner is auto-seeded (task-05) so the unbound branch only fires for new members.
 */
export function WorkspaceBindingGuard({ workspaceId }: Props) {
  const [state, setState] = useState<"loading" | "bound" | "unbound">("loading");
  const [binding, setBinding] = useState<MemberBindingView | null>(null);
  const [editing, setEditing] = useState(false);

  const check = async () => {
    const current = await fetchMyBinding(workspaceId);
    setBinding(current);
    setState(current ? "bound" : "unbound");
    if (!current) {
      // 已绑定时退出编辑态需在外部切换；未绑定时无编辑态。
      setEditing(false);
    }
  };

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  if (state === "loading") return null;

  if (state === "unbound") {
    return <WorkspaceAccessGuide workspaceId={workspaceId} onConfigured={check} />;
  }

  // 已绑定：渲染「编辑我的接入配置」入口（详情页规范管理区顶部）。
  if (editing && binding) {
    const initial: AccessGuideInitial = {
      daemon_id: binding.daemon_id ?? null,
      root_path: binding.root_path,
    };
    return (
      <WorkspaceAccessGuide
        workspaceId={workspaceId}
        onConfigured={() => {
          void check();
          setEditing(false);
        }}
        initial={initial}
      />
    );
  }

  return (
    <div className="flex justify-end" data-testid="binding-edit-entry">
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => setEditing(true)}
      >
        编辑我的接入配置
      </Button>
    </div>
  );
}
