"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type TableProps } from "antd";

import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import {
  getRuntimeProgress,
  getRuntimeUserInputsRaw,
  getRuntimeArtifacts,
  getRuntimeArtifactContent,
  type RuntimeProgress,
  type StageProgress,
  type ArtifactEntry,
} from "@/lib/runtime";

interface Props {
  params: { id: string };
}

const STATUS_KIND: Record<string, "success" | "neutral" | "error" | "info"> = {
  completed: "success",
  in_progress: "info",
  pending: "neutral",
  failed: "error",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RuntimePage({ params }: Props) {
  const workspaceId = params.id;
  const [progress, setProgress] = useState<RuntimeProgress | null>(null);
  const [userInputs, setUserInputs] = useState<string>("");
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [data, ui, arts] = await Promise.all([
        getRuntimeProgress(workspaceId),
        getRuntimeUserInputsRaw(workspaceId),
        getRuntimeArtifacts(workspaceId),
      ]);
      setProgress(data);
      setUserInputs(ui);
      setArtifacts(arts);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载运行时状态失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const handleSelectArtifact = async (filename: string) => {
    if (selectedArtifact === filename) {
      setSelectedArtifact(null);
      setArtifactContent("");
      return;
    }
    setSelectedArtifact(filename);
    const content = await getRuntimeArtifactContent(workspaceId, filename);
    setArtifactContent(content);
  };

  const stageColumns: TableProps<[string, StageProgress]>["columns"] = [
    {
      title: "阶段",
      key: "name",
      render: (_v: unknown, [name]: [string, StageProgress]) => (
        <span className="font-mono text-[11px]">{name}</span>
      ),
    },
    {
      title: "状态",
      key: "status",
      render: (_v: unknown, [, stage]: [string, StageProgress]) => (
        <StatusBadge kind={STATUS_KIND[stage.status] ?? "neutral"}>
          {stage.status}
        </StatusBadge>
      ),
    },
    {
      title: "步骤数",
      key: "steps",
      render: (_v: unknown, [, stage]: [string, StageProgress]) => (
        <span className="text-xs">{stage.steps?.length ?? 0}</span>
      ),
    },
    {
      title: "开始时间",
      key: "started_at",
      render: (_v: unknown, [, stage]: [string, StageProgress]) => (
        <span className="text-[11px] text-muted-foreground">
          {stage.started_at ? new Date(stage.started_at).toLocaleString() : "—"}
        </span>
      ),
    },
    {
      title: "完成时间",
      key: "completed_at",
      align: "right",
      render: (_v: unknown, [, stage]: [string, StageProgress]) => (
        <span className="text-[11px] text-muted-foreground">
          {stage.completed_at
            ? new Date(stage.completed_at).toLocaleString()
            : "—"}
        </span>
      ),
    },
  ];

  const stageRows = toStageEntries(progress);

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span>运行时状态</span>
            <StatusBadge kind="neutral">本地运行态</StatusBadge>
          </span>
        }
        subtitle={
          <>
            <Link
              href={`/workspaces/${workspaceId}`}
              className="hover:underline"
            >
              ← 工作区
            </Link>
            <span className="ml-2">
              读取{" "}
              <code className="rounded bg-muted px-1 text-[11px]">
                .sillyspec/.runtime/
              </code>{" "}
              展示当前工作流状态。此数据为本地运行态，不作为长期事实源。
            </span>
          </>
        }
      />

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-xs text-muted-foreground">
          加载中…
        </p>
      ) : progress === null && !userInputs && artifacts.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          当前工作区没有运行时数据。当 SillySpec 工作流运行后，此处将展示进度、输入记录和步骤产物。
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Summary cards */}
          {progress && (
            <>
              <SectionCard bodyPadding="p-0">
                <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
                  {[
                    ["项目", progress.project ?? "—"],
                    ["当前阶段", progress.current_stage ?? "—"],
                    ["当前变更", progress.current_change ?? "—"],
                    [
                      "最后活动",
                      progress.last_active
                        ? new Date(progress.last_active).toLocaleString()
                        : "—",
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-card px-3 py-2.5">
                      <p className="text-[11px] text-muted-foreground">{label}</p>
                      <p className="text-xs font-medium">{value}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="流水线阶段" bodyPadding="p-0">
                <DataTable<[string, StageProgress]>
                  rowKey={([name]) => name}
                  columns={stageColumns}
                  dataSource={stageRows}
                  size="small"
                  pagination={false}
                  emptyText="暂无阶段数据"
                />
              </SectionCard>
            </>
          )}

          {/* User Inputs */}
          {userInputs && (
            <SectionCard title="用户输入记录">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                {userInputs}
              </pre>
            </SectionCard>
          )}

          {/* Artifacts */}
          {artifacts.length > 0 && (
            <SectionCard title={`步骤产物 (${artifacts.length})`} bodyPadding="p-0">
              <div className="divide-y">
                {artifacts.map((art) => (
                  <div key={art.filename}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/50"
                      onClick={() => void handleSelectArtifact(art.filename)}
                    >
                      <span className="font-mono text-[11px]">{art.filename}</span>
                      <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{formatBytes(art.size_bytes)}</span>
                        {art.last_modified && (
                          <span>{new Date(art.last_modified).toLocaleString()}</span>
                        )}
                        <span>{selectedArtifact === art.filename ? "▲" : "▼"}</span>
                      </span>
                    </button>
                    {selectedArtifact === art.filename && artifactContent && (
                      <div className="border-t bg-muted/30 px-3 py-2">
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                          {artifactContent.slice(0, 10000)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      )}
    </PageContainer>
  );
}

function toStageEntries(progress: RuntimeProgress | null): [string, StageProgress][] {
  if (!progress) return [];
  return Object.entries(progress.stages ?? {});
}
