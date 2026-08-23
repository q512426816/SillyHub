"use client";

/**
 * 关联项目区块(change 2026-07-28-ppm-project-link-workspace task-11 / FR-03)。
 *
 * 嵌入工作区详情页,对该工作区绑定/解绑 PPM 项目。调工作区侧 API
 * (lib/workspace.ts listLinkedProjects/linkProject/unlinkProject),与项目维护页
 * LinkWorkspaceDialog 操作同一张 ppm_project_workspace 表(双边对称,数据自动一致)。
 *
 * UI 体系:shadcn/ui(与 workspaces/[id]/page.tsx 的 SectionCard/Button/Badge 一致,
 * CLAUDE.md 规则 19)。错误反馈用本地 state + errMessage。
 */
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/layout";
import { errMessage } from "@/lib/errors";
import { listProjects } from "@/lib/ppm/project";
import type { ProjectMaintenance } from "@/lib/ppm/types";
import {
  listLinkedProjects,
  linkProject,
  unlinkProject,
  type PpmProjectBrief,
} from "@/lib/workspace";

interface Props {
  workspaceId: string;
  /**
   * ql-20260824-005-aa13：绑定/解绑成功（自身 reload 完成后）通知宿主页。
   * 工作区详情页消费——刷新基本信息卡「关联项目」简要行,免手动刷新浏览器。
   * 失败不通知（错误已由本组件 errMessage 呈现）。
   */
  onChanged?: () => void;
}

// PPM 项目状态 code→中文标签(与 ppm/projects 页 PROJECT_STATUS_OPTIONS 一致);
// 若后端已存中文标签则原样返回(兼容两种存储)。
function projectStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "1":
      return "进行中";
    case "2":
      return "已完成";
    case "3":
      return "已暂停";
    default:
      return status ?? "—";
  }
}

export function LinkedProjectsSection({ workspaceId, onChanged }: Props) {
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<PpmProjectBrief[]>([]);
  const [all, setAll] = useState<ProjectMaintenance[]>([]);
  const [keyword, setKeyword] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [linkedRes, allProjects] = await Promise.all([
        listLinkedProjects(workspaceId),
        listProjects(),
      ]);
      setLinked(linkedRes);
      setAll(allProjects);
    } catch (err) {
      setError(errMessage(err, "加载关联项目失败"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const linkedIds = new Set(linked.map((p) => p.project_id));
  // 可选 = 全量项目里未关联的;按关键字过滤 project_name / project_code。
  const kw = keyword.trim().toLowerCase();
  const available = all.filter(
    (p) =>
      !linkedIds.has(p.id) &&
      (!kw ||
        (p.project_name ?? "").toLowerCase().includes(kw) ||
        p.project_code.toLowerCase().includes(kw)),
  );

  const handleBind = async (projectId: string) => {
    setActingId(projectId);
    setError(null);
    try {
      await linkProject(workspaceId, projectId);
      await reload();
      onChanged?.();
    } catch (err) {
      setError(errMessage(err, "绑定失败"));
    } finally {
      setActingId(null);
    }
  };

  const handleUnbind = async (projectId: string) => {
    setActingId(projectId);
    setError(null);
    try {
      await unlinkProject(workspaceId, projectId);
      await reload();
      onChanged?.();
    } catch (err) {
      setError(errMessage(err, "解绑失败"));
    } finally {
      setActingId(null);
    }
  };

  return (
    <SectionCard title="关联 PPM 项目">
      <div className="space-y-2.5">
        <p className="text-xs text-muted-foreground">
          将本工作区与 PPM 项目关联,便于按项目维度组织工作区(与项目维护页「关联工作区」操作同一份数据)。
        </p>

        {error && (
          <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* 已关联 */}
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">
            已关联项目({linked.length})
          </div>
          {loading && linked.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">加载中…</p>
          ) : linked.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">暂未关联项目</p>
          ) : (
            <ul className="divide-y rounded border">
              {linked.map((p) => (
                <li
                  key={p.project_id}
                  className="flex items-center justify-between px-2.5 py-1.5"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span className="font-medium">
                      {p.project_name ?? p.project_id}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {projectStatusLabel(p.project_status)}
                    </Badge>
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={actingId === p.project_id}
                    onClick={() => handleUnbind(p.project_id)}
                  >
                    {actingId === p.project_id ? "解绑中…" : "解绑"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 添加项目 */}
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">添加项目</div>
          <input
            type="text"
            placeholder="按项目名称 / 编号搜索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="mb-2 h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
          />
          {available.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {keyword ? "无匹配项目" : "无可关联项目"}
            </p>
          ) : (
            <ul className="divide-y overflow-y-auto rounded border max-h-[220px]">
              {available.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between px-2.5 py-1.5"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{p.project_name ?? p.id}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {p.project_code}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {projectStatusLabel(p.project_status)}
                    </Badge>
                  </span>
                  <Button
                    size="sm"
                    disabled={actingId === p.id}
                    onClick={() => handleBind(p.id)}
                  >
                    {actingId === p.id ? "绑定中…" : "绑定"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
