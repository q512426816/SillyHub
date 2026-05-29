"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api";
import {
  getRuntimeProgress,
  getRuntimeUserInputsRaw,
  getRuntimeArtifacts,
  getRuntimeArtifactContent,
  type RuntimeProgress,
  type ArtifactEntry,
} from "@/lib/runtime";

interface Props {
  params: { id: string };
}

const STATUS_COLORS: Record<string, "success" | "outline" | "destructive" | "default"> = {
  completed: "success",
  in_progress: "default",
  pending: "outline",
  failed: "destructive",
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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header>
        <p className="text-[11px] text-muted-foreground">
          <Link href={`/workspaces/${workspaceId}`} className="hover:underline">
            &larr; Workspace
          </Link>
        </p>
        <div className="mt-1 flex items-center gap-3">
          <h1>运行时状态</h1>
          <Badge variant="outline" className="text-[10px]">本地运行态</Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          读取 <code className="rounded bg-muted px-1 text-[11px]">.sillyspec/.runtime/</code> 展示当前工作流状态。此数据为本地运行态，不作为长期事实源。
        </p>
      </header>

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-xs text-muted-foreground">加载中…</p>
      ) : progress === null && !userInputs && artifacts.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          当前 Workspace 没有运行时数据。当 SillySpec 工作流运行后，此处将展示进度、输入记录和步骤产物。
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary cards */}
          {progress && (
            <>
              <section className="grid grid-cols-2 gap-px rounded-md border bg-border lg:grid-cols-4">
                {[
                  ["项目", progress.project ?? "—"],
                  ["当前阶段", progress.current_stage ?? "—"],
                  ["当前变更", progress.current_change ?? "—"],
                  ["最后活动", progress.last_active ? new Date(progress.last_active).toLocaleString() : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="bg-card px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className="text-xs font-medium">{value}</p>
                  </div>
                ))}
              </section>

              <section className="rounded-md border bg-card">
                <div className="border-b px-3 py-2">
                  <h3 className="text-xs font-medium">流水线阶段</h3>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>阶段</th>
                      <th>状态</th>
                      <th>步骤数</th>
                      <th>开始时间</th>
                      <th className="text-right">完成时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(progress.stages).map(([name, stage]) => (
                      <tr key={name}>
                        <td className="font-mono text-[11px]">{name}</td>
                        <td>
                          <Badge variant={STATUS_COLORS[stage.status] ?? "outline"}>
                            {stage.status}
                          </Badge>
                        </td>
                        <td className="text-xs">{stage.steps.length}</td>
                        <td className="text-[11px] text-muted-foreground">
                          {stage.started_at ? new Date(stage.started_at).toLocaleString() : "—"}
                        </td>
                        <td className="text-right text-[11px] text-muted-foreground">
                          {stage.completed_at ? new Date(stage.completed_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}

          {/* User Inputs */}
          {userInputs && (
            <section className="rounded-md border bg-card">
              <div className="border-b px-3 py-2">
                <h3 className="text-xs font-medium">用户输入记录</h3>
              </div>
              <div className="px-3 py-2">
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                  {userInputs}
                </pre>
              </div>
            </section>
          )}

          {/* Artifacts */}
          {artifacts.length > 0 && (
            <section className="rounded-md border bg-card">
              <div className="border-b px-3 py-2">
                <h3 className="text-xs font-medium">步骤产物 ({artifacts.length})</h3>
              </div>
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
            </section>
          )}
        </div>
      )}
    </div>
  );
}
