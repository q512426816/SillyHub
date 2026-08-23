"use client";

import { useQueries } from "@tanstack/react-query";

import { FileMessageCard } from "@/components/daemon/file-message-card";
import {
  listAgentFileArtifacts,
  type AgentFileArtifactMeta,
} from "@/lib/agent";

/**
 * 任务详情页「产出文件」区（2026-08-23-agent-file-upload-mcp task-09 /
 * FR-05 / D-010@v1）。
 *
 * 依据：tasks/task-09.md（allowed_paths / implementation / acceptance）、
 * design.md §7.2（GET /api/agent/file-artifacts?run_id= 返 {files}，按
 * created_at 倒序；不复用 /api/file/list）。
 *
 * - 逐 run 拉取（useQueries，run 级独立缓存与失败隔离），合并后按 file id
 *   去重、created_at 倒序（同 file 挂多个 run 的场景只显示一张卡）；
 * - 卡片复用 task-08 FileMessageCard（图片缩略图 / 通用下载两形态，下载走
 *   既有 downloadFile），props 契约 {fileId, name, size, mime, description}；
 * - 空态「暂无产出文件」、加载态、失败态错误行均有兜底，不阻断页面其余区块。
 *
 * queryKey 未进 lib/query-keys.ts 工厂：本卡 allowed_paths 不含该文件，沿用
 * change-sessions-card.tsx 的内联 key 惯例（["agentFileArtifacts", ...] 前缀，
 * run id 进 key）。
 */

export interface RunFileArtifactsProps {
  /** 该任务下全部 agent run id（页面 agentRuns.map(run => run.id)）。 */
  runIds: string[];
}

/**
 * 多 run 合并：file id 去重（同 id 后到丢弃，保首个 run 的元数据）+
 * created_at 倒序（同刻并列时按 id 稳定排序）。
 */
export function mergeFileArtifacts(
  lists: AgentFileArtifactMeta[][],
): AgentFileArtifactMeta[] {
  const byId = new Map<string, AgentFileArtifactMeta>();
  for (const list of lists) {
    for (const file of list) {
      if (!byId.has(file.id)) byId.set(file.id, file);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const diff = Date.parse(b.created_at) - Date.parse(a.created_at);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

export function RunFileArtifacts({ runIds }: RunFileArtifactsProps) {
  const queries = useQueries({
    queries: runIds.map((runId) => ({
      queryKey: ["agentFileArtifacts", "run", runId] as const,
      queryFn: () => listAgentFileArtifacts(runId),
    })),
  });

  // runIds 为空（页面 agentRuns 为空时不挂载，此处兜底）→ 整区不渲染。
  if (runIds.length === 0) return null;

  const files = mergeFileArtifacts(queries.map((q) => q.data ?? []));
  const loading = queries.some((q) => q.isPending);
  const failedRuns = queries.filter((q) => q.isError).length;

  return (
    <div className="rounded-md border bg-card">
      <div className="mb-2 flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium">📁 产出文件</span>
        {!loading && (
          <span className="text-[11px] text-muted-foreground">
            {files.length > 0 ? `${files.length} 个 · 点击下载` : ""}
          </span>
        )}
      </div>
      <div className="px-3 pb-3">
        {loading ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            加载中...
          </p>
        ) : files.length === 0 ? (
          failedRuns > 0 ? (
            <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
              产出文件加载失败
              {failedRuns > 1 ? `（${failedRuns} 个执行记录）` : ""}，请稍后刷新重试。
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">
              暂无产出文件
            </p>
          )
        ) : (
          <>
            {failedRuns > 0 && (
              <p className="mb-2 text-[11px] text-muted-foreground">
                {failedRuns} 个执行记录的产出文件加载失败，仅显示加载成功的部分。
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {files.map((file) => (
                <FileMessageCard
                  key={file.id}
                  fileId={file.id}
                  name={file.original_name}
                  size={file.size}
                  mime={file.mime_type}
                  description={file.description ?? ""}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
