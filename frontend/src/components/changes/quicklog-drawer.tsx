"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Drawer, Switch } from "antd";

import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import { getQuicklogDetail, type QuicklogEntryListItem } from "@/lib/quicklog";

// 状态徽标映射（与 quicklog-table 同口径，D-007 派生后 4 态）
const STATUS_META: Record<
  string,
  { label: string; kind: "success" | "warning" | "error" | "info" | "neutral" }
> = {
  completed: { label: "已完成", kind: "success" },
  in_progress: { label: "进行中", kind: "info" },
  partial_done: { label: "已暂存", kind: "warning" },
  stale: { label: "疑似中断", kind: "error" },
};

// 四段正文渲染顺序固定（design FR-06）
const BODY_ORDER = ["需求", "根因", "方案", "结果"] as const;

interface QuicklogDrawerProps {
  /** 当前列中选中的条目（列表项）；null 关闭抽屉。 */
  entry: QuicklogEntryListItem | null;
  workspaceId: string;
  onClose: () => void;
}

/**
 * quicklog 条目详情抽屉（task-09 / FR-06 / D-006：不建独立路由页）。
 * 打开时按 ql_id 拉详情；四段正文 + 文件括注清单 + 关联变更链接 +
 * 「原始 md」切换直出 raw_block。缺失字段逐项优雅降级（不空白不报错）。
 */
export function QuicklogDrawer({
  entry,
  workspaceId,
  onClose,
}: QuicklogDrawerProps) {
  const [showRaw, setShowRaw] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["quicklogDetail", workspaceId, entry?.ql_id],
    queryFn: () => getQuicklogDetail(workspaceId, entry!.ql_id),
    enabled: Boolean(entry),
  });

  const detail = detailQuery.data ?? null;
  const loading = detailQuery.isPending;
  const error = detailQuery.isError
    ? detailQuery.error instanceof ApiError
      ? detailQuery.error.message
      : "加载快速修复详情失败"
    : null;

  const meta = entry
    ? (STATUS_META[entry.status] ?? {
        label: entry.status,
        kind: "neutral" as const,
      })
    : null;

  const bodySections = detail?.body_sections ?? {};
  const hasBody = BODY_ORDER.some((k) => bodySections[k]);

  return (
    <Drawer
      title={
        <span className="flex items-center gap-2">
          {meta && <StatusBadge kind={meta.kind}>{meta.label}</StatusBadge>}
          <span className="truncate text-xs font-mono text-muted-foreground">
            {entry?.ql_id ?? ""}
          </span>
        </span>
      }
      placement="right"
      width={520}
      open={Boolean(entry)}
      onClose={onClose}
      destroyOnHidden={false}
    >
      {entry && (
        <div className="flex flex-col gap-4">
          {/* 标题 + 元信息 */}
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium text-foreground">
              {entry.placeholder ? (
                <span className="italic text-muted-foreground">
                  （空壳占位）
                </span>
              ) : (
                entry.title
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
              {/* ql-20260818-006：关联变更 owner 优先（与变更列表同源），author 链兜底 */}
              <span>
                负责人：{entry.owner_name || entry.author_name || entry.author_raw || "—"}
              </span>
              <span>
                时间：
                {entry.timestamp
                  ? new Date(entry.timestamp).toLocaleString("zh-CN", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </span>
              <span>来源：{entry.source === "pushed" ? "CLI 推送" : "文件同步"}</span>
            </div>
          </div>

          {error && (
            <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {loading && <p className="text-xs text-muted-foreground">加载中…</p>}

          {/* 原始 md 切换（raw_block 直出） */}
          {detail && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                条目详情
              </span>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                原始 md
                <Switch
                  size="small"
                  checked={showRaw}
                  onChange={setShowRaw}
                  data-testid="raw-switch"
                />
              </label>
            </div>
          )}

          {detail && showRaw && (
            <pre className="max-h-[50vh] overflow-auto rounded border bg-muted/40 p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all text-foreground">
              {detail.raw_block ?? "（无原始内容）"}
            </pre>
          )}

          {detail && !showRaw && (
            <>
              {/* 四段正文（缺失段省略） */}
              {hasBody ? (
                <div className="flex flex-col gap-3">
                  {BODY_ORDER.map((key) =>
                    bodySections[key] ? (
                      <section key={key} data-testid={`body-${key}`}>
                        <h3 className="mb-1 text-xs font-medium text-foreground">
                          {key}
                        </h3>
                        <p className="whitespace-pre-wrap text-xs leading-5 text-foreground">
                          {bodySections[key]}
                        </p>
                      </section>
                    ) : null,
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  （暂无正文记录）
                </p>
              )}

              {/* 文件清单（path + 括注） */}
              <section>
                <h3 className="mb-1 text-xs font-medium text-foreground">
                  变更文件
                </h3>
                {detail.files.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {detail.files.map((f) => (
                      <li
                        key={f.path}
                        className="font-mono text-[11px] leading-5 break-all text-foreground"
                      >
                        {f.path}
                        {f.note && (
                          <span className="ml-1 font-sans text-[11px] text-muted-foreground">
                            （{f.note}）
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">（无）</p>
                )}
              </section>

              {/* 关联变更（跳变更中心搜索） */}
              <section>
                <h3 className="mb-1 text-xs font-medium text-foreground">
                  关联变更
                </h3>
                {detail.linked_changes.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {detail.linked_changes.map((c) => (
                      <li key={c}>
                        <Link
                          href={`/workspaces/${workspaceId}/changes?search=${encodeURIComponent(c)}`}
                          prefetch={false}
                          className="font-mono text-[11px] break-all text-primary hover:underline"
                        >
                          {c}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">（无）</p>
                )}
              </section>

              {detail.truncated && (
                <p className="text-[11px] text-muted-foreground">
                  原始文件超出读取上限，以上内容为节选。
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
