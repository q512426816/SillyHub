"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pagination, type TableProps } from "antd";

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
import { DaemonRequiredNotice } from "@/components/daemon-required-notice";
import {
  canBorrowSharedDaemon,
  fetchMyBinding,
  type MemberBindingView,
} from "@/lib/workspace-binding";
import { useSession } from "@/stores/session";

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

// 2026-08-20-runtime-readpoint-repo-first / FR-05（design §5.3）：user-inputs 是
// 追加式日志（末尾最新），本机文件已到 MB 级，前端超长时只渲染末尾片段，避免
// 一次性渲染巨型文本卡死页面；完整内容始终留在本机仓库文件中。
const USER_INPUTS_MAX_DISPLAY = 50000;

// 产物列表分页大小：仓库运行时可积累上千个产物（实测 1589），一次全渲染卡顿。
const ARTIFACTS_PAGE_SIZE = 20;

// 2026-08-19-runtime-live-daemon-read：实时读取链路的错误分级提示（design §6.3
// 映射表的消费端）。backend 消息已是中文，这里补状态码维度的行动指引；非 ApiError
// （网络中断等）无状态码，走通用文案。
function runtimeErrorHint(status: number | null): string | null {
  switch (status) {
    case 502:
      return "守护进程可能离线或连接中断，请确认本机守护进程在线后重试。";
    case 504:
      return "实时读取超时，请稍后重试。";
    case 422:
      return "本机守护进程版本过旧，请升级守护进程后重试。";
    case 403:
      return "守护进程拒绝了本次访问。";
    case 404:
      return "未找到对应文件，可能已被移动或删除。";
    default:
      return null;
  }
}

export default function RuntimePage({ params }: Props) {
  const workspaceId = params.id;
  const [progress, setProgress] = useState<RuntimeProgress | null>(null);
  const [userInputs, setUserInputs] = useState<string>("");
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [artifactPage, setArtifactPage] = useState(1);
  const [artifactContent, setArtifactContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageErrorStatus, setPageErrorStatus] = useState<number | null>(null);
  // 2026-07-26-ungate-workspace-entry / FR-04 + 2026-08-19-runtime-live-daemon-read：
  // 运行时数据经绑定 daemon WS RPC 实时读取（design §4.1），无 binding 时主区渲染
  // DaemonRequiredNotice（非阻断），有 binding 走实时展示。
  const [myBinding, setMyBinding] = useState<MemberBindingView | null>(null);
  const [bindingReady, setBindingReady] = useState(false);
  const permissions = useSession((s) => s.user?.permissions);
  const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);
  const canBorrow = canBorrowSharedDaemon(permissions, isPlatformAdmin);

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
      setArtifactPage(1);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载运行时状态失败");
      setPageErrorStatus(err instanceof ApiError ? err.status : null);
    } finally {
      setLoading(false);
    }
  };

  // 先判 binding：无 binding 不 fetch runtime（避免无谓失败），主区渲染 DaemonRequiredNotice。
  useEffect(() => {
    let active = true;
    setBindingReady(false);
    fetchMyBinding(workspaceId)
      .then((b) => {
        if (active) {
          setMyBinding(b);
          setBindingReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setMyBinding(null);
          setBindingReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const hasDaemon = !!myBinding?.daemon_id;

  // 仅在已绑定 daemon 时加载运行时数据（零回归：有 binding 路径完全不变）。
  useEffect(() => {
    if (!hasDaemon) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDaemon, workspaceId]);

  const handleSelectArtifact = async (filename: string) => {
    if (selectedArtifact === filename) {
      setSelectedArtifact(null);
      setArtifactContent("");
      return;
    }
    setSelectedArtifact(filename);
    try {
      const content = await getRuntimeArtifactContent(workspaceId, filename);
      setArtifactContent(content);
    } catch (err) {
      // 实时读取链路（design §6.3）：产物读取失败给出分级提示，不静默留空块。
      setPageError(err instanceof ApiError ? err.message : "读取产物内容失败");
      setPageErrorStatus(err instanceof ApiError ? err.status : null);
      setSelectedArtifact(null);
      setArtifactContent("");
    }
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
          {stage.started_at ? new Date(stage.started_at).toLocaleString("zh-CN") : "—"}
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
            ? new Date(stage.completed_at).toLocaleString("zh-CN")
            : "—"}
        </span>
      ),
    },
  ];

  const stageRows = toStageEntries(progress);

  // 2026-08-20-runtime-readpoint-repo-first / FR-05（design §5.3）：user-inputs 超
  // 上限时只显示末尾片段（追加式日志，末尾最新），并渲染含完整文件路径的提示行；
  // 未超限时与现状完全一致。
  const userInputsTooLong = userInputs.length > USER_INPUTS_MAX_DISPLAY;
  const userInputsDisplay = userInputsTooLong
    ? userInputs.slice(-USER_INPUTS_MAX_DISPLAY)
    : userInputs;

  // 产物分页派生值：换页只重渲染当页 20 行；列表重新加载时回第 1 页，
  // 展开态保留（selectedArtifact 未清，翻回原页自动重新展开）。
  const artifactPageCount = Math.ceil(artifacts.length / ARTIFACTS_PAGE_SIZE);
  const safeArtifactPage = Math.min(artifactPage, artifactPageCount || 1);
  const pagedArtifacts = artifacts.slice(
    (safeArtifactPage - 1) * ARTIFACTS_PAGE_SIZE,
    safeArtifactPage * ARTIFACTS_PAGE_SIZE,
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span>运行时状态</span>
            {/* 2026-08-19-runtime-live-daemon-read / FR-05：数据源切换为绑定
                daemon 实时读取（design §6.3），徽标与副标题同步更新。 */}
            <StatusBadge kind="info">守护进程运行态</StatusBadge>
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
              {/* 2026-08-20-runtime-readpoint-repo-first / FR-05：读点改为优先
                  本机仓库、回退同步缓存（design §5.3），副标题同步真实数据来源。 */}
              经绑定守护进程实时读取{" "}
              <code className="rounded bg-muted px-1 text-[11px]">
                .sillyspec/.runtime/
              </code>{" "}
              工作流状态（优先本机仓库，回退同步缓存）。
            </span>
          </>
        }
      />

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          <p>{pageError}</p>
          {runtimeErrorHint(pageErrorStatus) && (
            <p className="mt-1 text-muted-foreground">
              {runtimeErrorHint(pageErrorStatus)}
            </p>
          )}
        </div>
      )}

      {!bindingReady ? (
        <p className="py-12 text-center text-xs text-muted-foreground">
          加载中…
        </p>
      ) : !hasDaemon ? (
        <DaemonRequiredNotice
          feature="运行时"
          workspaceId={workspaceId}
          canBorrow={canBorrow}
          onConfigured={() => {
            void fetchMyBinding(workspaceId)
              .then((b) => setMyBinding(b))
              .catch(() => {});
          }}
        />
      ) : loading ? (
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
                        ? new Date(progress.last_active).toLocaleString("zh-CN")
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
              {userInputsTooLong && (
                <p className="mb-2 text-[11px] text-muted-foreground">
                  内容过长，已截断，仅显示末尾 {USER_INPUTS_MAX_DISPLAY} 字符；完整内容见本机{" "}
                  <code className="rounded bg-muted px-1">.sillyspec/.runtime/user-inputs.md</code>
                </p>
              )}
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                {userInputsDisplay}
              </pre>
            </SectionCard>
          )}

          {/* Artifacts */}
          {artifacts.length > 0 && (
            <SectionCard title={`步骤产物 (${artifacts.length})`} bodyPadding="p-0">
              <div className="divide-y">
                {pagedArtifacts.map((art) => (
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
                          <span>{new Date(art.last_modified).toLocaleString("zh-CN")}</span>
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
              {artifactPageCount > 1 && (
                <div className="flex items-center justify-end border-t px-3 py-2">
                  <Pagination
                    size="small"
                    total={artifacts.length}
                    pageSize={ARTIFACTS_PAGE_SIZE}
                    current={safeArtifactPage}
                    onChange={(p) => setArtifactPage(p)}
                    showSizeChanger={false}
                    showTotal={(t) => `共 ${t} 个`}
                  />
                </div>
              )}
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
