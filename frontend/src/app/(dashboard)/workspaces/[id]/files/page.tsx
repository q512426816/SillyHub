"use client";

/**
 * change 2026-07-25-daemon-borrow-for-business task-13 / FR-06 live wiring。
 *
 * 工作空间「方案文件」页（workspace 作用域，路径 /workspaces/[id]/files）：
 * 展示本工作空间借用共享 daemon 产出的业务方案（owner_type=workspace 的文件）。
 *
 * 守卫：路径 ``/workspaces/[id]/files`` 命中 ``app/(dashboard)/layout.tsx`` 的
 * ``/^\/workspaces\/[^/]+/`` 规则（有 wsId 一律放行），不会被 WORKSPACE_WHITELIST
 * 重定向回 /workspaces——故无需改白名单（design task-13 蓝图「挂到 workspace 作用域」方案）。
 *
 * 数据：``BorrowedSolutionFilesPanel`` 内部调 ``GET /api/file/list?owner_type=workspace
 * &owner_id=<ws_id>`` 拉方案文件，透传 ``BorrowedSolutionFiles`` 渲染预览/下载。
 */
import { FileText } from "lucide-react";

import { BorrowedSolutionFilesPanel } from "@/components/agent/borrowed-solution-files-panel";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";

interface Props {
  params: { id: string };
}

export default function WorkspaceFilesPage({ params }: Props) {
  const workspaceId = params.id;

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-card text-primary">
              <FileText className="h-4 w-4" />
            </span>
            <span>方案文件</span>
          </span>
        }
        subtitle="借用工作空间共享守护进程产出的业务方案"
      />

      <SectionCard>
        <BorrowedSolutionFilesPanel
          workspaceId={workspaceId}
          title="借用方案"
        />
      </SectionCard>
    </PageContainer>
  );
}
