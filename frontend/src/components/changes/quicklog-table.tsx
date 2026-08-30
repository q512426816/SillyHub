"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Checkbox, Input, Select, type TableProps } from "antd";

import { DataTable } from "@/components/layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import type { components } from "@/lib/api-types";
import {
  listQuicklogEntries,
  quicklogPollInterval,
  type QuicklogEntryListItem,
  type QuicklogStatus,
} from "@/lib/quicklog";

// ── 状态徽标映射（FR-05 / D-007 派生后 4 态）──────────────────────────

const STATUS_META: Record<
  string,
  { label: string; kind: "success" | "warning" | "error" | "info" | "neutral" }
> = {
  completed: { label: "已完成", kind: "success" },
  in_progress: { label: "进行中", kind: "info" },
  partial_done: { label: "已暂存", kind: "warning" },
  stale: { label: "疑似中断", kind: "error" },
};

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "completed", label: "已完成" },
  { value: "in_progress", label: "进行中" },
  { value: "partial_done", label: "已暂存" },
  { value: "stale", label: "疑似中断" },
] as const;

function StatusColumn({ status, note }: { status: string; note?: string | null }) {
  const meta = STATUS_META[status] ?? { label: status, kind: "neutral" as const };
  return (
    <span title={note ?? undefined} className="inline-flex flex-col gap-0.5">
      <StatusBadge kind={meta.kind}>{meta.label}</StatusBadge>
      {note && (
        <span className="max-w-[160px] truncate text-[10px] text-muted-foreground">
          {note}
        </span>
      )}
    </span>
  );
}

// ── 「执行」列（task-08 / FR-05 / D-004@v1，视觉对齐 prototype-change-center-
// usage.html 场景二 .exec-cell）──────────────────────────────────────────
// 与 changes/page.tsx 的同名列互为镜像实现（allowed_paths 不含公共模块文件，
// 不抽公共组件）；token/次数格式化 helper 复制自会话页 session-usage-bar.tsx
// 私有先例（同款写法），耗时/起止时间为本列新增。

/** 列表「执行」列用量摘要（api-types 生成，禁止手写）。 */
type UsageSummaryRead = components["schemas"]["UsageSummaryRead"];

/** token 数中文紧凑格式化（session-usage-bar formatTokensZh 同款）：
 * >= 1 万 →「X.X 万」（一位小数）；万以下原数千分位（如 9,800）。 */
function formatTokensZh(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万`;
  return n.toLocaleString("en-US");
}

/** 请求次数千分位（计数语义不做万缩写，session-usage-bar 同款）。 */
function formatCount(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

/** 耗时紧凑中文格式化（原型「3.6 小时 / 34 分钟」）：>= 1 小时一位小数，
 * 不足 1 小时取整分钟（不足 1 分钟按 1 分钟起步）；null/缺 →「—」。 */
function formatDurationZh(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(1)} 小时`;
  return `${Math.max(1, Math.round(ms / 60_000))} 分钟`;
}

/** 起止时间悬浮段格式（原型「08-28 10:12」）：本地时区 MM-DD HH:mm；
 * 畸形串防御性降级「—」（对齐 change-activity-badge 的畸形时间戳先例）。 */
function formatMmDdHm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * UsageExecCell —— 「执行」列单元格：紧凑两行（首行耗时 + 可选「进行中」
 * 小标记，次行 token 总量·次数·轮数），整格 title 悬浮起止时间（无值段
 * 显示「—」，进行中时结束段显示「进行中」）。
 *
 * usage 判空分两档：null（后端显式无关联执行，D-004@v1）→「—」占位；
 * undefined（字段整体缺失：旧后端响应 / mock 未带）→ 整格不渲染——对齐
 * 本页/列表页操作列先例，避免「—」与待办/负责人等列占位叠加。
 */
function UsageExecCell({
  usage,
  showTurns = false,
}: {
  usage?: UsageSummaryRead | null;
  /** quicklog 列表次行追加「N 轮」（totals.num_turns）。 */
  showTurns?: boolean;
}) {
  if (usage === undefined) return null;
  if (usage === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  // 进行中 = started_at 有值且 finished_at 缺（R-05 时间三元组语义）
  const running = Boolean(usage.started_at) && !usage.finished_at;
  // token 总量 = totals 四维之和（input + output + cache_read + cache_creation）
  const tokenTotal =
    usage.totals.input_tokens +
    usage.totals.output_tokens +
    usage.totals.cache_read_tokens +
    usage.totals.cache_creation_tokens;
  const counts = showTurns
    ? `${formatCount(usage.totals.api_requests)} 次 · ${formatCount(usage.totals.num_turns)} 轮`
    : `${formatCount(usage.totals.api_requests)} 次`;
  const title = `开始 ${
    usage.started_at ? formatMmDdHm(usage.started_at) : "—"
  } · 结束 ${
    usage.finished_at ? formatMmDdHm(usage.finished_at) : running ? "进行中" : "—"
  }`;
  return (
    <div className="whitespace-nowrap" title={title}>
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-semibold tabular-nums text-foreground">
          {formatDurationZh(usage.duration_ms)}
        </span>
        {running && (
          <span className="rounded-full bg-brand-50 px-1.5 py-px text-[10px] font-medium text-brand-700">
            进行中
          </span>
        )}
      </div>
      <div className="text-[11px] tabular-nums text-muted-foreground">
        {`${formatTokensZh(tokenTotal)} tok · ${counts}`}
      </div>
    </div>
  );
}

// ── 组件 ──────────────────────────────────────────────────────────────

interface QuicklogTableProps {
  workspaceId: string;
  /** 行点击开抽屉（task-09 已接线；组件本身不持有 Drawer）。 */
  onSelect?: (_entry: QuicklogEntryListItem) => void;
}

export function QuicklogTable({ workspaceId, onSelect }: QuicklogTableProps) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  // 默认显示空壳占位（ql-20260820-008）：进行中 quick 会话 CLI 只落「(quick 任务)」
  // 占位标题，隐藏会让会话全程在平台不可见；取消勾选=收窄筛选
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const query = useQuery({
    queryKey: [
      "quicklogEntries",
      workspaceId,
      { search, status: statusFilter, author: authorFilter, showPlaceholder, page, pageSize },
    ],
    queryFn: () =>
      listQuicklogEntries(workspaceId, {
        search: search || undefined,
        status: (statusFilter || undefined) as QuicklogStatus | undefined,
        author: authorFilter || undefined,
        include_placeholder: showPlaceholder || undefined,
        page,
        page_size: pageSize,
      }),
    placeholderData: keepPreviousData,
    // FR-05：存在 in_progress|stale 条目 30s 轮询，全终态停轮（复用变更列表轮询模式）
    refetchInterval: (q) => quicklogPollInterval(q.state.data?.items ?? []),
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const loading = query.isPending;
  const error = query.isError
    ? query.error instanceof ApiError
      ? query.error.message
      : "加载快速修复列表失败"
    : null;

  // 负责人候选（ql-20260818-006）：展示口径 = owner_name（关联变更 owner，与
  // 进行中/已归档同源）优先 → author_name → author_raw；下拉去重同口径
  const authors = Array.from(
    new Set(
      items
        .map((it) => it.owner_name || it.author_name || it.author_raw)
        .filter((a): a is string => Boolean(a)),
    ),
  );

  const columns: TableProps<QuicklogEntryListItem>["columns"] = [
    {
      title: "状态",
      key: "status",
      width: 130,
      render: (_v: unknown, e: QuicklogEntryListItem) => (
        <StatusColumn status={e.status} note={e.status_note} />
      ),
    },
    {
      title: "标题",
      key: "title",
      render: (_v: unknown, e: QuicklogEntryListItem) => (
        <button
          type="button"
          onClick={() => onSelect?.(e)}
          className="group max-w-[420px] text-left"
          title={e.placeholder ? "空壳占位条目" : e.title}
        >
          <span className="block truncate text-xs text-foreground group-hover:underline">
            {e.placeholder ? (
              <span className="italic text-muted-foreground">（空壳占位）</span>
            ) : (
              e.title
            )}
          </span>
          <span className="block font-mono text-[10px] text-muted-foreground">
            {e.ql_id}
            {e.source === "pushed" && (
              <span className="ml-1 text-primary" title="CLI 实时推送">
                ●
              </span>
            )}
          </span>
        </button>
      ),
    },
    {
      title: "负责人",
      key: "author",
      width: 90,
      // ql-20260818-006：关联变更 owner（owner_name，与进行中/已归档列表同源）
      // 优先；无关联/未解析 → 回退既有 author 链兜底
      render: (_v: unknown, e: QuicklogEntryListItem) => (
        <span className="text-xs text-foreground">
          {e.owner_name || e.author_name || e.author_raw || "—"}
        </span>
      ),
    },
    {
      title: "影响模块",
      key: "modules",
      width: 130,
      ellipsis: true,
      render: (_v: unknown, e: QuicklogEntryListItem) =>
        e.affected_modules.length > 0 ? (
          <span className="text-[11px]">{e.affected_modules.join(", ")}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      title: "关联变更",
      key: "linked",
      width: 150,
      render: (_v: unknown, e: QuicklogEntryListItem) =>
        e.linked_changes.length > 0 ? (
          <span className="flex flex-col gap-0.5">
            {e.linked_changes.slice(0, 2).map((c) => (
              <Link
                key={c}
                href={`/workspaces/${workspaceId}/changes?search=${encodeURIComponent(c)}`}
                prefetch={false}
                className="truncate font-mono text-[10px] text-primary hover:underline"
              >
                {c}
              </Link>
            ))}
            {e.linked_changes.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{e.linked_changes.length - 2}
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      // task-08（D-004@v1）：执行列——紧凑两行（耗时+进行中标记 / token·次·轮），
      // 起止时间走整格 title 悬浮；次行比变更列表多「N 轮」（num_turns）
      title: "执行",
      key: "usage",
      width: 190,
      render: (_v: unknown, e: QuicklogEntryListItem) => (
        <UsageExecCell usage={e.usage} showTurns />
      ),
    },
    {
      title: "时间",
      dataIndex: "timestamp",
      key: "timestamp",
      align: "right",
      width: 130,
      render: (v: string | null) =>
        v ? (
          <span className="text-[11px] text-muted-foreground">
            {new Date(v).toLocaleString("zh-CN", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  // 隐藏占位=收窄筛选（ql-20260820-008 默认显示后，取消勾选才偏离全量口径）
  const hasFilter = search || statusFilter || authorFilter || !showPlaceholder;

  const renderEmpty = (): ReactNode => {
    if (items.length > 0) return null;
    if (hasFilter) {
      return (
        <div className="py-10 text-center text-xs text-muted-foreground">
          没有匹配的快速修复记录。
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="text-[15px] font-medium text-foreground">
          还没有快速修复记录
        </div>
        <div className="text-xs text-muted-foreground">
          在仓库跑 sillyspec quick 后，条目会实时出现在这里（CLI 推送 +
          文件同步双链路）。
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Checkbox
          checked={showPlaceholder}
          onChange={(e) => {
            setShowPlaceholder(e.target.checked);
            setPage(1);
          }}
        >
          <span className="text-xs text-muted-foreground">显示空壳占位</span>
        </Checkbox>
      </div>

      <div className="grid w-full grid-cols-3 gap-3">
        <div className="flex w-full flex-col gap-1">
          <span className="text-xs leading-4 text-muted-foreground">关键词</span>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索标题 / 正文全文…"
            allowClear
            onPressEnter={() => {
              setSearch(searchInput);
              setPage(1);
            }}
          />
        </div>
        <div className="flex w-full flex-col gap-1">
          <span className="text-xs leading-4 text-muted-foreground">状态</span>
          <Select
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v ?? "");
              setPage(1);
            }}
            className="w-full"
          >
            {STATUS_OPTIONS.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div className="flex w-full flex-col gap-1">
          <span className="text-xs leading-4 text-muted-foreground">负责人</span>
          <Select
            value={authorFilter}
            onChange={(v) => {
              setAuthorFilter(v ?? "");
              setPage(1);
            }}
            className="w-full"
            allowClear
          >
            {authors.map((a) => (
              <Select.Option key={a} value={a}>
                {a}
              </Select.Option>
            ))}
          </Select>
        </div>
      </div>

      <DataTable<QuicklogEntryListItem>
        rowKey="ql_id"
        columns={columns}
        dataSource={items}
        loading={loading}
        size="small"
        bordered
        scroll={{ y: "calc(100vh - 470px)" }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => {
            setPage(p);
            setPageSize(s);
          },
        }}
        locale={{ emptyText: renderEmpty() }}
      />
    </div>
  );
}
