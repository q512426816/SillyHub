"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
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

// 审核面板投影（D-004）：对齐 task-03 DTO 的 pending_review 取值
// proposal_review/plan_review/human_test/archive_confirm + blocked 业务态。
// brownfield 兜底：旧 change 仍带 need_* 风格 human_gate 时降级映射，不崩。
const GATE_LABELS: Record<string, { label: string; kind: "warning" | "error" }> = {
  proposal_review: { label: "待提案审核", kind: "warning" },
  plan_review: { label: "待计划审核", kind: "warning" },
  human_test: { label: "待人工测试", kind: "warning" },
  archive_confirm: { label: "待归档确认", kind: "warning" },
  // 旧 human_gate 兼容（task-03 切换前的 brownfield 投影）
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

// 主线 6 stage（对齐工具 STAGE_ORDER：scan→brainstorm→plan→execute→verify→archive）。
// status 投影（blocked/archived）作为业务态徽标，不再作为 stage 枚举值。
const STAGE_KIND: Record<string, StatusKind> = {
  brainstorm: "warning",
  plan: "info",
  execute: "info",
  verify: "success",
  archive: "neutral",
  // status 投影（业务态徽标）
  blocked: "error",
  archived: "neutral",
};

const STAGE_LABEL: Record<string, string> = {
  brainstorm: "需求分析",
  plan: "规划",
  execute: "执行",
  verify: "验证",
  archive: "归档",
  // status 投影
  blocked: "阻塞",
  archived: "已归档",
};

const STAGE_OPTIONS = [
  { value: "", label: "全部阶段" },
  { value: "brainstorm", label: "需求分析" },
  { value: "plan", label: "规划" },
  { value: "execute", label: "执行" },
  { value: "verify", label: "验证" },
  { value: "archive", label: "归档" },
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

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      // task-11 / 2026-07-10-remove-server-local-workspace-mode：平台统一
      // daemon-client 语义，前端不再校验 daemon 在线状态（runtime 由后端从
      // member binding 现算，离线返 DAEMON_CLIENT_NO_SESSION）。故移除
      // listDaemonRuntimes 拉取 + runtime/binding 四段派生。
      const [resp, ws] = await Promise.all([
        listChanges(workspaceId, {
          location: tab,
          search: search || undefined,
          currentStage: stageFilter || undefined,
          page,
          pageSize,
        }),
        getWorkspace(workspaceId),
      ]);
      setItems(resp.items);
      setTotal(resp.total);
      setWorkspace(ws);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载变更列表失败");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, tab, search, stageFilter, page, pageSize]);

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
          prefetch={false}
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
        if (c.status === "archived" || c.current_stage === "archive") {
          return <StatusBadge kind="neutral">已归档</StatusBadge>;
        }
        if (c.current_stage && c.current_stage !== "scan") {
          return <StatusBadge kind="info">进行中</StatusBadge>;
        }
        return <StatusBadge kind="neutral">空闲</StatusBadge>;
      },
    },
    {
      title: "阶段",
      key: "stage",
      width: 96,
      render: (_v: unknown, c: ChangeSummary) => {
        const stage = c.current_stage ?? "scan";
        return (
          <StatusBadge kind={STAGE_KIND[stage] ?? "neutral"}>
            {STAGE_LABEL[stage] ?? stage}
          </StatusBadge>
        );
      },
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
          {warnings.length > 0 && ` ${warnings.length} 个警告。`}
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
            disabled={loading}
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
