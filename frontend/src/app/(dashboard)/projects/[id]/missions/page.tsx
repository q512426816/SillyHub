"use client";

/**
 * task-15 / 2026-08-19-cross-workspace-team-mission / design §7.3 / FR-07：
 * 项目维度会话页（/projects/{id}/missions）。
 *
 * 页面职责（数据装配 + 布局骨架，交互细节全部下沉 MissionConsole projectMode）：
 * - 从 URL 取 project id，listProjectWorkspaces 加载 scope 候选
 *   （项目关联工作区，含 name/status/type/description）；
 * - 由候选构建 wsTypeById / wsNameById 映射传给 MissionConsole——
 *   目标工作区徽标列的 type 配色来源 + 后端暂不回填
 *   target_workspace_name / getMission 不回填 workspace_name 的名称兜底；
 * - 历史加载（listProjectMissions）在 MissionConsole projectMode 内完成，
 *   详情沿用 ?mission= 选中态内嵌（与单工作区 /workspaces/{id}/missions 同款交互）；
 * - scope 越界 / anchor 越界由后端 422 拦截，MissionConsole 捕获 ApiError
 *   展示中文 detail，本页不重复处理。
 *
 * 机器在线状态（task-15 D 项）：按 WorkspaceBrief.status 展示（活跃/待启用/
 * 已归档），不做 daemon 心跳聚合。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "antd";

import { PageContainer, PageHeader } from "@/components/layout";
import { MissionConsole } from "@/components/mission-console";
import { errMessage } from "@/lib/errors";
import { listProjectWorkspaces, type WorkspaceBrief } from "@/lib/workspace";

export default function ProjectMissionsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? "";

  const [candidates, setCandidates] = useState<WorkspaceBrief[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadFlag, setReloadFlag] = useState(0);

  const reload = useCallback(() => setReloadFlag((n) => n + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setCandidates(null);
    setLoadError(null);
    listProjectWorkspaces(projectId)
      .then((list) => {
        if (!cancelled) setCandidates(list);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errMessage(err, "加载项目关联工作区失败"));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadFlag]);

  // workspace_id → type / name 映射（worker 目标工作区徽标 + 名称兜底）。
  const wsTypeById = useMemo(
    () =>
      Object.fromEntries(
        (candidates ?? []).map((w) => [w.workspace_id, w.type ?? null]),
      ),
    [candidates],
  );
  const wsNameById = useMemo(
    () =>
      Object.fromEntries((candidates ?? []).map((w) => [w.workspace_id, w.name])),
    [candidates],
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title="项目团队会话"
        subtitle="从项目维度发起跨工作区团队会话：圈选派发范围与主工作区，主控按任务性质把工作派到对应工作区的机器上执行"
        actions={
          <Link
            href="/ppm/projects"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> 返回项目列表
          </Link>
        }
      />

      {loadError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {loadError}
          <Button className="ml-3" size="small" onClick={reload}>
            重新加载
          </Button>
        </div>
      )}

      {candidates === null && !loadError && (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          正在加载项目关联的工作区…
        </div>
      )}

      {candidates !== null && candidates.length === 0 && (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          该项目尚未关联工作区。先在
          <Link
            href="/ppm/projects"
            className="mx-1 text-blue-600 hover:underline"
          >
            项目维护页
          </Link>
          的「关联工作区」入口绑定工作区，再回来发起团队会话。
        </div>
      )}

      {candidates !== null && candidates.length > 0 && (
        <MissionConsole
          projectMode
          projectId={projectId}
          scopeCandidates={candidates}
          wsTypeById={wsTypeById}
          wsNameById={wsNameById}
        />
      )}
    </PageContainer>
  );
}
