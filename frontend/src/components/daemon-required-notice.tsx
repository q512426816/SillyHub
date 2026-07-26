"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { WorkspaceAccessGuide } from "@/components/workspace-access-guide";

/**
 * DaemonRequiredNotice — daemon 依赖功能的无 daemon 内联空态
 *（2026-07-26-ungate-workspace-entry / FR-04 / D-003）。
 *
 * 门禁后移后，工作区进门不再要求 daemon；仅在真正依赖 daemon 的功能点
 *（运行时 / 扫描文档 / 组件拓扑等读源码或 daemon 实体的页面）主区渲染本组件，
 * 引导成员配置自己的守护进程或借用共享。
 *
 * 非阻断：仅替换「该功能依赖 daemon 的主区」，页面其余部分正常（与文档/变更统计共存）。
 * - [配置我的守护进程]：内联展开 WorkspaceAccessGuide 首次绑定模式，
 *   成功后调 onConfigured 让调用方刷新 binding（主区切回正常数据视图）。
 * - canBorrow=true：额外提示已有借用能力，可去 Agent 页触发借用
 *   （借用发生在 agent 派发，非读源码页，此处仅引导）。
 *
 * 复用：canBorrowSharedDaemon 判定由调用方算好传入（本组件不直接读 session）；
 * WorkspaceAccessGuide 复用既有首次/编辑表单。
 */
interface Props {
  /** 功能名，用于标题「{feature}需要守护进程」，如 "运行时" / "扫描文档" / "组件拓扑"。 */
  feature: string;
  workspaceId: string;
  /** 调用方 canBorrowSharedDaemon(permissions, isPlatformAdmin) 的结果。 */
  canBorrow: boolean;
  /** 配置成功回调（调用方刷新 binding 后，主区切回正常数据视图）。 */
  onConfigured?: () => void;
}

export function DaemonRequiredNotice({
  feature,
  workspaceId,
  canBorrow,
  onConfigured,
}: Props): JSX.Element {
  const [configuring, setConfiguring] = useState(false);

  if (configuring) {
    return (
      <WorkspaceAccessGuide
        workspaceId={workspaceId}
        onConfigured={() => {
          setConfiguring(false);
          onConfigured?.();
        }}
      />
    );
  }

  return (
    <div
      data-testid="daemon-required-notice"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-warning/40 bg-warning/5 px-4 py-8 text-center"
    >
      <div className="text-2xl" aria-hidden>
        ⚠
      </div>
      <p className="text-sm font-medium text-foreground">
        {feature}需要守护进程
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        此功能需要读取本机守护进程上的项目文件。
        {canBorrow
          ? "你已有借用能力，可在此配置自己的守护进程，或直接去 Agent 页借用共享守护进程。"
          : "请配置你的守护进程；如需借用他人共享的守护进程，请联系管理员开通。"}
      </p>
      <Button
        size="sm"
        data-testid="daemon-required-config-btn"
        onClick={() => setConfiguring(true)}
      >
        配置我的守护进程
      </Button>
      {canBorrow ? (
        <p
          data-testid="daemon-required-borrow-hint"
          className="text-[11px] text-muted-foreground"
        >
          你已有借用能力，也可直接在 Agent 页触发借用共享守护进程。
        </p>
      ) : null}
    </div>
  );
}

export default DaemonRequiredNotice;
