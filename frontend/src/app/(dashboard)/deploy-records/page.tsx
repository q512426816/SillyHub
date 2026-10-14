"use client";

/**
 * 发布记录页（2026-10-14-deploy-release-notes task-04 / FR-05 / D-002@v1）。
 *
 * 平台级聚合视图（顶层一级菜单，协作治理组）：左记录列表 + 右详情。
 * - 数据源：各 workspace 仓库 docs/releases/*.md（agent 部署时经
 *   sillyhub-docker-deploy skill 写入），后端只读扫描（D-004@v1 零表零写端点）
 * - 布局对齐原型 .sillyspec/changes/2026-10-14-deploy-release-notes/
 *   prototype-deploy-records.html；工作台式页面走 primer 组件库
 *   （FRONTEND_PAGE_STYLE.md §13）：PageHead 页头 + IssueRow 列表行 +
 *   StateLabel 状态徽标 + EmptyState 空态；md 正文走 MarkdownText（统一
 *   sanitize，记录内容源自 agent 手写文件，按不可信处理）
 * - 基础版字段（D-003@v1）：序号/状态/时间/工作区/短SHA/提交数/摘要；
 *   无回滚按钮、无部署日志、无健康检查
 */
import { useState } from "react";
import { FileClock, Package } from "lucide-react";

import { MarkdownText } from "@/components/ui/markdown-text";
import {
  EmptyState,
  IssueRow,
  PageHead,
  StateLabel,
  type StateLabelVariant,
} from "@/components/primer";
import { cn } from "@/lib/utils";
import {
  useDeployRecordDetail,
  useDeployRecordsList,
  type DeployRecordSummary,
} from "@/lib/deploy-records";

/** status → StateLabel 变体（invalid 为后端 frontmatter 容错态）。 */
function stateVariantOf(status: string): StateLabelVariant {
  if (status === "success") return "done";
  if (status === "failed") return "error";
  return "neutral";
}

const STATUS_LABEL: Record<string, string> = {
  success: "成功",
  failed: "失败",
  invalid: "格式异常",
};

/** 空值统一破折号（FRONTEND_PAGE_STYLE.md §4 单元格渲染规范）。 */
function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function RecordRow({
  record,
  selected,
  onSelect,
}: {
  record: DeployRecordSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <IssueRow
      state={stateVariantOf(record.status)}
      onClick={onSelect}
      className={cn(
        "rounded-md px-2",
        selected && "bg-brand-50 shadow-[inset_3px_0_0_var(--color-brand-600)]",
      )}
      title={
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold text-brand-700">
            #{dash(record.seq !== null ? String(record.seq).padStart(3, "0") : null)}
          </span>
          <span className="truncate font-medium text-foreground">
            {record.summary}
          </span>
        </span>
      }
      meta={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-accent-foreground">{record.workspace_name}</span>
          <span className="font-mono">{dash(record.commit_to)}</span>
          <span>{dash(record.commits_count)} commits</span>
          <span>{dash(record.agent)}</span>
        </span>
      }
      right={
        <span className="flex flex-col items-end gap-1 whitespace-nowrap">
          <StateLabel variant={stateVariantOf(record.status)}>
            {STATUS_LABEL[record.status] ?? record.status}
          </StateLabel>
          <span className="text-xs text-muted-foreground">{dash(record.deployed_at)}</span>
        </span>
      }
    />
  );
}

export default function DeployRecordsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listQuery = useDeployRecordsList();

  const records = listQuery.data ?? [];
  // 选中态跟随列表：首条默认选中；选中项不在列表（刷新后）时回落首条。
  const effectiveSelectedId =
    selectedId !== null && records.some((r) => r.record_id === selectedId)
      ? selectedId
      : (records[0]?.record_id ?? null);
  const detailQuery = useDeployRecordDetail(effectiveSelectedId);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col gap-4 p-6">
      <PageHead
        title="发布记录"
        subtitle="每次 agent 部署后自动生成的版本变化记录（读取各项目仓库 docs/releases/ 目录）"
      />

      {listQuery.isError ? (
        <EmptyState
          title="发布记录加载失败"
          description="请确认后端服务可用后重试；workspace 根目录未挂载进平台容器时也会读不到记录。"
        >
          <span className="text-xs text-muted-foreground">
            {(listQuery.error as Error | null)?.message ?? ""}
          </span>
        </EmptyState>
      ) : listQuery.isLoading ? (
        <EmptyState title="加载中…" />
      ) : records.length === 0 ? (
        <EmptyState
          icon={<FileClock className="h-8 w-8 text-muted-foreground" />}
          title="暂无部署记录"
          description="首次让 agent 部署后（sillyhub-docker-deploy skill 会在部署后写发布记录），这里会出现按时间倒序的部署历史。"
        />
      ) : (
        <div className="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
          {/* 左：记录列表 */}
          <div className="flex max-h-[calc(100vh-16rem)] flex-col overflow-y-auto rounded-lg border bg-card shadow-sm">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-4 py-3">
              <span className="text-sm font-semibold">部署记录</span>
              <span className="text-xs text-muted-foreground">共 {records.length} 条</span>
            </div>
            <div className="flex flex-col gap-1 p-2">
              {records.map((record) => (
                <RecordRow
                  key={record.record_id}
                  record={record}
                  selected={record.record_id === effectiveSelectedId}
                  onSelect={() => setSelectedId(record.record_id)}
                />
              ))}
            </div>
          </div>

          {/* 右：详情 */}
          <div className="rounded-lg border bg-card shadow-sm">
            {detailQuery.isError ? (
              <EmptyState title="详情加载失败" description={(detailQuery.error as Error)?.message ?? ""} />
            ) : detailQuery.data ? (
              <>
                <div className="border-b px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Package className="h-4 w-4 text-brand-600" />
                    <h2 className="text-base font-bold">
                      #{dash(
                        detailQuery.data.seq !== null
                          ? String(detailQuery.data.seq).padStart(3, "0")
                          : null,
                      )}{" "}
                      {detailQuery.data.summary}
                    </h2>
                    <StateLabel variant={stateVariantOf(detailQuery.data.status)}>
                      {STATUS_LABEL[detailQuery.data.status] ?? detailQuery.data.status}
                    </StateLabel>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                    {[
                      ["部署时间", dash(detailQuery.data.deployed_at)],
                      ["工作区", detailQuery.data.workspace_name],
                      ["执行者", dash(detailQuery.data.agent)],
                      [
                        "提交范围",
                        detailQuery.data.commit_from
                          ? `${detailQuery.data.commit_from} → ${dash(detailQuery.data.commit_to)}`
                          : dash(detailQuery.data.commit_to),
                      ],
                    ].map(([k, v]) => (
                      <div key={k} className="min-w-0">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="truncate font-mono text-foreground" title={v}>
                          {v}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="px-6 py-4">
                  <MarkdownText content={detailQuery.data.content || "（无正文）"} />
                </div>
              </>
            ) : (
              <EmptyState title="加载详情中…" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
