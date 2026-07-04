"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, SearchBar, SectionCard } from "@/components/layout";
import { ApiError } from "@/lib/api";
import { listAuditLogs, type AuditLogEntry } from "@/lib/audit";
import { AUDIT_RESOURCE_TYPE_LABELS, labelOf } from "@/lib/status-labels";

interface Props {
  params: { id: string };
}

const RESOURCE_COLORS: Record<string, "default" | "success" | "warning" | "destructive" | "outline"> = {
  change: "success",
  task: "warning",
  release: "default",
  review: "outline",
  agent_run: "default",
};

const PAGE_SIZE = 20;

// details_json 后端是 JSON 字符串(Text 列)，需要解析为对象；非法 JSON 兜底为 null。
export function parseDetails(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function categorizeAction(action: string): { label: string; variant: "default" | "success" | "warning" | "destructive" | "outline" } {
  if (action.startsWith("git_") || action.includes("git") || action.includes("commit") || action.includes("branch") || action.includes("push") || action.includes("merge")) {
    return { label: "Git", variant: "default" };
  }
  if (action.includes("tool_") || action.includes("agent_run")) {
    return { label: "工具调用", variant: "success" };
  }
  if (action.includes("agent")) {
    return { label: "智能体", variant: "warning" };
  }
  if (action.includes("approval") || action.includes("approve") || action.includes("reject")) {
    return { label: "审批", variant: "outline" };
  }
  if (action.includes("credential") || action.includes("token") || action.includes("secret")) {
    return { label: "凭据", variant: "destructive" };
  }
  return { label: "其他", variant: "outline" };
}

function getResultStatus(entry: AuditLogEntry): { label: string; variant: "success" | "warning" | "destructive" | "outline" } {
  const raw = entry.details_json;
  const details = parseDetails(raw);
  if (!details || !raw) {
    return { label: "无详情", variant: "outline" };
  }
  // details_json 已是合法 JSON 字符串，关键字搜索等价于直接对原始字符串搜小写形式。
  const str = raw.toLowerCase();
  if (str.includes("error") || str.includes("fail") || str.includes("denied")) {
    return { label: "异常", variant: "destructive" };
  }
  if (str.includes("pending") || str.includes("running") || str.includes("in_progress")) {
    return { label: "进行中", variant: "warning" };
  }
  return { label: "成功", variant: "success" };
}

export default function AuditPage({ params }: Props) {
  const workspaceId = params.id;
  const [items, setItems] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [searchText, setSearchText] = useState("");
  const [offset, setOffset] = useState(0);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await listAuditLogs(workspaceId, {
        resource_type: filter || undefined,
        limit: 200,
      });
      setItems(list);
    } catch (err) {
      setItems([]);
      setError(err instanceof ApiError ? err.message : "加载审计日志失败");
    }
  }, [workspaceId, filter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Reset offset when filter or search changes
  useEffect(() => {
    setOffset(0);
  }, [filter, searchText]);

  const filteredItems = useMemo(() => {
    if (!items) return null;
    let result = items;
    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim();
      result = result.filter(
        (entry) =>
          entry.action.toLowerCase().includes(q) ||
          (entry.resource_id && entry.resource_id.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [items, searchText]);

  // Stats computation
  const stats = useMemo(() => {
    if (!items) return { total: 0, git: 0, toolCalls: 0, anomalies: 0 };
    const total = items.length;
    const git = items.filter(
      (e) =>
        e.resource_type.includes("git") ||
        e.action.startsWith("git_") ||
        e.action.includes("commit") ||
        e.action.includes("branch") ||
        e.action.includes("push") ||
        e.action.includes("merge"),
    ).length;
    const toolCalls = items.filter((e) => e.resource_type === "agent_run").length;
    const anomalies = items.filter((e) => {
      if (!e.details_json) return false;
      // details_json 已是 JSON 字符串，直接搜原始字符串即可覆盖所有 value。
      const str = e.details_json.toLowerCase();
      return str.includes("error") || str.includes("fail");
    }).length;
    return { total, git, toolCalls, anomalies };
  }, [items]);

  // Pagination
  const totalCount = filteredItems?.length ?? 0;
  const pageItems = filteredItems?.slice(offset, offset + PAGE_SIZE) ?? [];
  const pageStart = totalCount === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, totalCount);

  return (
    <PageContainer size="full">
      <PageHeader
        title={
          <span>
            <Link
              href={`/workspaces/${workspaceId}/components`}
              className="text-[11px] font-normal text-muted-foreground hover:underline"
            >
              ← 组件列表
            </Link>
            <span className="mt-0.5 block">审计日志</span>
          </span>
        }
      />
      <SearchBar>
        <input
          type="text"
          placeholder="搜索操作或资源 ID..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="h-7 w-48 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
        />
        <select
          className="h-7 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">全部类型</option>
          <option value="change">变更</option>
          <option value="task">任务</option>
          <option value="release">发布</option>
          <option value="review">审查</option>
          <option value="agent_run">智能体运行</option>
        </select>
        <Button size="sm" onClick={() => void reload()}>刷新</Button>
      </SearchBar>

      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <SectionCard bodyPadding="p-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border bg-card p-2.5 text-center">
            <div className="text-[11px] text-muted-foreground">今日审计事件</div>
            <div className="text-base font-medium">{stats.total}</div>
          </div>
          <div className="rounded-md border bg-card p-2.5 text-center">
            <div className="text-[11px] text-muted-foreground">Git 操作</div>
            <div className="text-base font-medium">{stats.git}</div>
          </div>
          <div className="rounded-md border bg-card p-2.5 text-center">
            <div className="text-[11px] text-muted-foreground">工具调用</div>
            <div className="text-base font-medium">{stats.toolCalls}</div>
          </div>
          <div className="rounded-md border bg-card p-2.5 text-center">
            <div className="text-[11px] text-muted-foreground">异常事件</div>
            <div className="text-base font-medium text-destructive">{stats.anomalies}</div>
          </div>
        </div>
      </SectionCard>

      <SectionCard bodyPadding="p-0">
        {filteredItems === null ? (
          <p className="py-12 text-center text-xs text-muted-foreground">加载中...</p>
        ) : filteredItems.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            暂无审计日志。
          </div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作</th>
                  <th>类型</th>
                  <th>资源类型</th>
                  <th>资源 ID</th>
                  <th>结果</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((entry) => {
                  const category = categorizeAction(entry.action);
                  const result = getResultStatus(entry);
                  return (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </td>
                      <td className="font-mono text-[11px]">{entry.action}</td>
                      <td>
                        <Badge variant={category.variant}>{category.label}</Badge>
                      </td>
                      <td>
                        <Badge variant={RESOURCE_COLORS[entry.resource_type] ?? "outline"}>
                          {labelOf(AUDIT_RESOURCE_TYPE_LABELS, entry.resource_type)}
                        </Badge>
                      </td>
                      <td className="max-w-[160px] truncate font-mono text-[11px]">
                        {entry.resource_id ? entry.resource_id.slice(0, 8) + "..." : "---"}
                      </td>
                      <td>
                        <Badge variant={result.variant}>{result.label}</Badge>
                      </td>
                      <td className="max-w-[200px] truncate text-[11px]">
                        {entry.details_json
                          ? entry.details_json.slice(0, 60)
                          : "---"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t px-3 py-2">
              <span className="text-[11px] text-muted-foreground">
                显示 {pageStart}-{pageEnd} / 共 {totalCount} 条
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset + PAGE_SIZE >= totalCount}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </>
        )}
      </SectionCard>
    </PageContainer>
  );
}
