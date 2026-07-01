"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Input, Select, type TableProps } from "antd";

import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import { listDaemonRuntimes, type DaemonRuntimeRead } from "@/lib/daemon";
import {
  listChanges,
  reparseChanges,
  type ChangeReparseStats,
  type ChangeSummary,
  type ChangeWarning,
} from "@/lib/changes";
import { getWorkspace, type Workspace } from "@/lib/workspaces";

interface Props {
  params: { id: string };
}

// 查询条件垂直 Field（label 在上，控件在下），对齐 admin/roles / admin/users。
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-xs leading-4 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

const TABS = [
  { key: "active", label: "进行中" },
  { key: "archive", label: "已归档" },
] as const;

const GATE_LABELS: Record<string, { label: string; kind: "warning" | "error" }> = {
  need_proposal_review: { label: "待提案审核", kind: "warning" },
  need_plan_review: { label: "待计划审核", kind: "warning" },
  need_human_test: { label: "待人工测试", kind: "warning" },
  need_archive_confirm: { label: "待归档确认", kind: "warning" },
  blocked: { label: "阻塞中", kind: "error" },
};

const TYPE_KIND: Record<string, "neutral" | "warning" | "success"> = {
  feature: "neutral",
  quick: "warning",
  prototype: "success",
};

const TYPE_LABEL: Record<string, string> = {
  feature: "功能",
  quick: "快速",
  prototype: "原型",
};

const STAGE_KIND: Record<string, StatusKind> = {
  draft: "neutral",
  scan: "info",
  brainstorm: "warning",
  propose: "warning",
  plan: "info",
  execute: "info",
  verify: "success",
  rework_required: "error",
  accepted: "success",
  archive: "neutral",
  quick: "info",
};

const STAGE_LABEL: Record<string, string> = {
  draft: "草稿",
  scan: "扫描",
  brainstorm: "需求分析",
  propose: "提案",
  plan: "规划",
  execute: "执行",
  verify: "验证",
  rework_required: "需返工",
  accepted: "已验收",
  archive: "归档",
  quick: "快速",
};

const STAGE_OPTIONS = [
  { value: "", label: "全部阶段" },
  { value: "draft", label: "草稿" },
  { value: "scan", label: "扫描" },
  { value: "brainstorm", label: "需求分析" },
  { value: "propose", label: "提案" },
  { value: "plan", label: "规划" },
  { value: "execute", label: "执行" },
  { value: "verify", label: "验证" },
  { value: "rework_required", label: "需返工" },
  { value: "accepted", label: "已验收" },
  { value: "archive", label: "归档" },
  { value: "quick", label: "快速" },
] as const;

type StatusKind = "info" | "success" | "warning" | "error" | "neutral";

export default function ChangesPage({ params }: Props) {
  const workspaceId = params.id;
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [items, setItems] = useState<ChangeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [reparsing, setReparsing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [stats, setStats] = useState<ChangeReparseStats | null>(null);
  const [warnings, setWarnings] = useState<ChangeWarning[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [runtimes, setRuntimes] = useState<DaemonRuntimeRead[]>([]);

  const daemonRuntimeId = workspace?.daemon_runtime_id ?? null;
  const boundRuntime = useMemo(() => {
    if (!daemonRuntimeId) return null;
    return runtimes.find((r) => r.id === daemonRuntimeId) ?? null;
  }, [daemonRuntimeId, runtimes]);
  const isDaemonClient = workspace?.path_source === "daemon-client";
  const newChangeDisabledReason = isDaemonClient
    ? !daemonRuntimeId || boundRuntime?.status !== "online"
      ? "需要在线 daemon 才能在客户端工作区创建变更"
      : null
    : null;

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [resp, ws, runtimeList] = await Promise.all([
        listChanges(workspaceId, {
          location: tab,
          search: search || undefined,
          page,
          pageSize,
        }),
        getWorkspace(workspaceId),
        listDaemonRuntimes().catch(() => [] as DaemonRuntimeRead[]),
      ]);
      setItems(resp.items);
      setTotal(resp.total);
      setWorkspace(ws);
      setRuntimes(runtimeList);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载变更列表失败");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, tab, search, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
  };

  const handleSearchClick = () => {
    const noChange = searchInput === search && page === 1;
    setSearch(searchInput);
    setPage(1);
    if (noChange) void load();
  };

  const handleResetClick = () => {
    setSearchInput("");
    setSearch("");
    setStageFilter("");
    setPage(1);
  };

  const handleTabChange = (newTab: "active" | "archive") => {
    if (newTab === tab) return;
    setTab(newTab);
    setPage(1);
  };

  const handleReparse = async () => {
    setReparsing(true);
    setPageError(null);
    try {
      const resp = await reparseChanges(workspaceId);
      setStats(resp.stats);
      setWarnings(resp.warnings);
      await load();
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "重新解析失败");
    } finally {
      setReparsing(false);
    }
  };

  const columns: TableProps<ChangeSummary>["columns"] = [
    {
      title: "变更 Key",
      dataIndex: "change_key",
      key: "change_key",
      render: (v: string, c: ChangeSummary) => (
        <Link
          href={`/workspaces/${workspaceId}/changes/${c.id}`}
          className="font-mono text-[11px] text-primary hover:underline"
        >
          {v}
        </Link>
      ),
    },
    {
      title: "标题",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (v: string | null) => (
        <span className="font-medium">{v ?? "—"}</span>
      ),
    },
    {
      title: "类型",
      dataIndex: "change_type",
      key: "change_type",
      width: 80,
      render: (v: string | null) =>
        v ? (
          <StatusBadge kind={TYPE_KIND[v] ?? "neutral"}>
            {TYPE_LABEL[v] ?? v}
          </StatusBadge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      title: "状态",
      key: "status",
      width: 110,
      render: (_v: unknown, c: ChangeSummary) => {
        const gate = GATE_LABELS[c.human_gate ?? ""];
        if (gate) {
          return <StatusBadge kind={gate.kind}>{gate.label}</StatusBadge>;
        }
        if (c.current_stage === "accepted") {
          return <StatusBadge kind="success">已完成</StatusBadge>;
        }
        if (c.current_stage && c.current_stage !== "draft") {
          return <StatusBadge kind="info">进行中</StatusBadge>;
        }
        return <StatusBadge kind="neutral">空闲</StatusBadge>;
      },
    },
    {
      title: "阶段",
      key: "stage",
      width: 96,
      render: (_v: unknown, c: ChangeSummary) => (
        <StatusBadge kind={STAGE_KIND[c.current_stage ?? "draft"] ?? "neutral"}>
          {STAGE_LABEL[c.current_stage ?? "draft"] ?? c.current_stage ?? "draft"}
        </StatusBadge>
      ),
    },
    {
      title: "影响组件",
      key: "affected_components",
      ellipsis: true,
      render: (c: ChangeSummary) => (
        <span className="text-[11px]">
          {c.affected_components.length > 0
            ? c.affected_components.join(", ")
            : "—"}
        </span>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      key: "updated_at",
      align: "right",
      render: (v: string) => (
        <span className="text-[11px] text-muted-foreground">
          {new Date(v).toLocaleDateString()}
        </span>
      ),
    },
  ];

  return (
    <PageContainer size="full">
      <PageHeader
        title="变更中心"
        subtitle={
          <Link
            href={`/workspaces/${workspaceId}/components`}
            className="hover:underline"
          >
            ← 组件列表
          </Link>
        }
      />

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {stats && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          已重新扫描：解析 {stats.parsed}，新增 {stats.created} · 更新{" "}
          {stats.updated} · 删除 {stats.deleted}。
          {warnings.length > 0 && ` ${warnings.length} 个 warning。`}
        </div>
      )}

      {warnings.length > 0 && (
        <SectionCard title="解析警告">
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-600">
            {warnings.map((w, i) => (
              <li key={i}>
                <span className="font-mono">[{w.code}]</span>{" "}
                {w.change_key ?? "—"}: {w.detail}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="变更生命周期">
        <div className="flex items-center justify-center gap-0">
          {[
            "需求输入",
            "Change 创建",
            "Task 拆分",
            "执行",
            "验证",
            "归档",
          ].map((step, i) => (
            <div key={step} className="flex items-center">
              <div className="whitespace-nowrap rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-foreground">
                {step}
              </div>
              {i < 5 && (
                <span className="mx-2 text-muted-foreground">&rarr;</span>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard bodyPadding="p-2">
        {/* 顶部操作按钮行（对齐 admin/roles） */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button size="sm" onClick={handleSearchClick}>
            搜索
          </Button>
          <Button size="sm" variant="outline" onClick={handleResetClick}>
            重置
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button size="sm" onClick={handleReparse} disabled={reparsing}>
            {reparsing ? "解析中…" : "重新扫描"}
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button
            size="sm"
            variant="outline"
            disabled={loading || newChangeDisabledReason !== null}
            title={newChangeDisabledReason ?? undefined}
            onClick={() =>
              router.push(`/workspaces/${workspaceId}/create-change`)
            }
          >
            + 新建变更
          </Button>
        </div>
        {/* 查询条件：grid-cols-4 垂直 Field */}
        <div className="grid w-full grid-cols-4 gap-3">
          <Field label="关键词">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜索 Key / 标题 / 组件…"
              allowClear
              onPressEnter={() => handleSearchClick()}
            />
          </Field>
          <Field label="阶段">
            <Select
              value={stageFilter}
              onChange={(v) => setStageFilter(v ?? "")}
              className="w-full"
            >
              {STAGE_OPTIONS.map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Option>
              ))}
            </Select>
          </Field>
        </div>
      </SectionCard>

      {/* 进行中/已归档 tab，放 DataTable 上方左侧（不在查询条件上面） */}
      <div className="flex items-center gap-1">
        {TABS.map((t) => {
          return (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key as "active" | "archive")}
              className={`border-b-2 pb-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              } mr-3 last:mr-0`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <DataTable<ChangeSummary>
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={loading}
        size="small"
        bordered
        scroll={{ y: "calc(100vh - 430px)" }}
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
        emptyText={
          items.length === 0
            ? `当前没有${tab === "active" ? "进行中" : "已归档"}的变更。`
            : "没有匹配的变更。"
        }
      />
    </PageContainer>
  );
}
