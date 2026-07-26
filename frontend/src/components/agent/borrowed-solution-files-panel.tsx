"use client";

/**
 * change 2026-07-25-daemon-borrow-for-business task-13 / FR-06 live wiring。
 *
 * ``BorrowedSolutionFiles`` 的容器层：按工作空间 id 拉 owner_type=workspace 的方案
 * 文件（后端 ``GET /api/file/list``，借用 daemon 产出落 File 表 owner_type=workspace
 * owner_id=ws_id，design §5 Phase 5 / D-009@v1），把 file_ids 透传给纯展示组件
 * ``BorrowedSolutionFiles``（复用 FileViewer 预览/下载）。
 *
 * 分层：本组件负责「活数据」（fetch + loading/error），``BorrowedSolutionFiles``
 * 负责「展示」（fileIds → FileViewer），互不耦合——纯展示组件已有单测覆盖，本
 * 组件单测只覆盖 fetch 透传链路（mock listFiles）。
 */
import { useEffect, useState } from "react";

import { BorrowedSolutionFiles } from "@/components/agent/borrowed-solution-files";
import { ApiError } from "@/lib/api";
import { listFiles } from "@/lib/file/api";

export interface BorrowedSolutionFilesPanelProps {
  /** 工作空间 id（方案 owner_id）。 */
  workspaceId: string;
  /** 可选标题，透传 BorrowedSolutionFiles。 */
  title?: string;
  /** 可选刷新触发器（父传 refetch 计数变更 → 重拉）。 */
  refreshKey?: number;
}

export function BorrowedSolutionFilesPanel({
  workspaceId,
  title,
  refreshKey,
}: BorrowedSolutionFilesPanelProps): JSX.Element {
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listFiles({ owner_type: "workspace", owner_id: workspaceId })
      .then((files) => {
        if (!active) return;
        // 按 created_at 倒序（后端已排序），取 id 透传纯展示组件。
        setFileIds(files.map((f) => f.id));
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : "加载借用方案失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, refreshKey]);

  if (loading) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="borrowed-solution-loading">
        加载借用方案...
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-destructive" data-testid="borrowed-solution-error">
        {error}
      </p>
    );
  }
  return <BorrowedSolutionFiles fileIds={fileIds} title={title} />;
}
