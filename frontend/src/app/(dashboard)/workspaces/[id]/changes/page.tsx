"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Checkbox, Input, Select, type TableProps } from "antd";

import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge, type StatusKind } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import {
  listChanges,
  reparseChanges,
  type ChangeReparseStats,
  type ChangeSummary,
  type ChangeWarning,
} from "@/lib/changes";
import { cn } from "@/lib/utils";
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

// task-06 / design §7：待办徽标映射（替代死代码 GATE_LABELS）。
// 数据源 = ChangeSummary.pending_review（PG 镜像 _map 投影，task-03）+ status=blocked。
// 纯前端展示映射，后端 task-03 已统一投影为 4 个新取值（不再 need_* 兼容）。
const PENDING_REVIEW_LABEL: Record<string, string> = {
  proposal_review: "待提案审核",
  plan_review: "待计划审核",
  human_test: "待人工测试",
  archive_confirm: "待归档确认",
};

// 主线 stage 标签（对齐工具 STAGE_ORDER：scan→brainstorm→plan→execute→verify→archive）。
// quick（2026-08-12-quick-independent-stage）：辅助阶段，warning 色突出。
const STAGE_KIND: Record<string, StatusKind> = {
  quick: "warning",
  brainstorm: "warning",
  plan: "info",
  execute: "info",
  verify: "success",
  archive: "neutral",
};

const STAGE_LABEL: Record<string, string> = {
  draft: "草稿", // 兜底旧数据（新建已改 brainstorm，旧 change 仍可能 draft）
  scan: "扫描",
  quick: "快速任务",
  brainstorm: "需求分析",
  plan: "规划",
  execute: "执行",
  verify: "验证",
  archive: "归档",
};

const STAGE_OPTIONS = [
  { value: "", label: "全部阶段" },
  { value: "brainstorm", label: "需求分析" },
  { value: "plan", label: "规划" },
  { value: "execute", label: "执行" },
  { value: "verify", label: "验证" },
  { value: "archive", label: "归档" },
] as const;

// 排序方向（task-06 / D-004）：默认最近活动优先。
type SortDir = "updated_at_desc" | "updated_at_asc";

export default function ChangesPage({ params }: Props) {
  const workspaceId = params.id;
  const [tab, setTab] = useState<"active" | "archive">("active");
  // D-007：进行中视图默认套「只看待我处理」聚焦
  const [focusMine, setFocusMine] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("updated_at_desc");
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
  // tab 计数（进行中=不聚焦的总数 M；已归档=archive total），用于 tab 挂数量 + 副标题 M。
  // 单独 effect 拉（pageSize=1 只为拿 total），不随 filter/聚焦变化——避免聚焦时 tab 计数
  // 被污染成 N。首次渲染无值时 tab 不显示计数，请求完成后回填。
  const [tabTotals, setTabTotals] = useState<{
    active?: number;
    archive?: number;
  }>({});

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      // task-11 / 2026-07-10-remove-server-local-workspace-mode：平台统一
      // daemon-client 语义，前端不再校验 daemon 在线状态。
      const [resp, ws] = await Promise.all([
        listChanges(workspaceId, {
          location: tab,
          search: search || undefined,
          currentStage: stageFilter || undefined,
          sort: sortDir,
          // D-007：进行中 + 聚焦 → 只看待我处理（pending_review 非空）
          pendingReviewOnly: tab === "active" && focusMine,
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
  }, [
    workspaceId,
    tab,
    search,
    stageFilter,
    sortDir,
    focusMine,
    page,
    pageSize,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // 单独 effect：拉两个 tab 的总数（不带 filter、不聚焦），用于 tab 挂数量 + 副标题 M。
  // 与主 load 解耦：filter/聚焦变化不重发，tab 计数稳定不被污染。
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listChanges(workspaceId, { location: "active", pageSize: 1 }),
      listChanges(workspaceId, { location: "archive", pageSize: 1 }),
    ])
      .then(([a, b]) => {
        if (!cancelled) {
          setTabTotals({ active: a.total, archive: b.total });
        }
      })
      .catch(() => {
        // tab 计数非关键，静默
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

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

  const toggleSort = () => {
    setSortDir((prev) =>
      prev === "updated_at_desc" ? "updated_at_asc" : "updated_at_desc",
    );
    setPage(1);
  };

  const handleReparse = async () => {
    setReparsing(true);
    setPageError(null);
    try {
      const resp = await reparseChanges(workspaceId);
      setStats(resp.stats);
      setWarnings(resp.warnings ?? []);
      await load();
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "重新解析失败");
    } finally {
      setReparsing(false);
    }
  };

  // 待办徽标渲染（D-007 / design §7）：blocked 优先，否则 pending_review 投影，否则空占位。
  const renderTodoBadge = (c: ChangeSummary): ReactNode => {
    if (c.status === "blocked") {
      return <StatusBadge kind="error">阻塞中</StatusBadge>;
    }
    if (c.pending_review && PENDING_REVIEW_LABEL[c.pending_review]) {
      return (
        <StatusBadge kind="warning">
          {PENDING_REVIEW_LABEL[c.pending_review]}
        </StatusBadge>
      );
    }
    return <span className="text-xs text-muted-foreground">—</span>;
  };

  // 负责人列渲染（task-06）：ChangeSummary 有 owner_id(UUID) 无 owner_name（零 migration，
  // design §6 文件清单未新增字段）。务实处理：空→"—"；有值→前 8 位短标识（mono 字体）。
  // 勿为此加后端字段——列表行不阻断业务，短标识已足够区分；详情页可显示完整信息。
  const renderOwner = (c: ChangeSummary): ReactNode => {
    if (!c.owner_id) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    return (
      <span className="font-mono text-[11px] text-primary">
        {c.owner_id.slice(0, 8)}
      </span>
    );
  };

  const columns: TableProps<ChangeSummary>["columns"] = [
    {
      title: "待办状态",
      key: "todo",
      width: 120,
      render: (_v: unknown, c: ChangeSummary) => renderTodoBadge(c),
    },
    {
      title: "标题",
      key: "title",
      render: (_v: unknown, c: ChangeSummary) => (
        <Link
          href={`/workspaces/${workspaceId}/changes/${c.id}`}
          prefetch={false}
          className="group inline-block"
        >
          <span className="block font-mono text-[11px] text-primary group-hover:underline">
            {c.change_key}
          </span>
          {c.title && (
            <span className="block text-[11px] text-muted-foreground">
              {c.title}
            </span>
          )}
        </Link>
      ),
    },
    {
      title: "负责人",
      key: "owner",
      width: 90,
      render: (_v: unknown, c: ChangeSummary) => renderOwner(c),
    },
    {
      title: "阶段",
      key: "stage",
      width: 90,
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
      title: (
        <button
          type="button"
          onClick={toggleSort}
          className="inline-flex items-center gap-0.5 font-normal text-primary hover:underline"
          title="点击切换升序/降序"
        >
          更新时间
          <span aria-hidden>{sortDir === "updated_at_desc" ? "↓" : "↑"}</span>
        </button>
      ),
      dataIndex: "updated_at",
      key: "updated_at",
      align: "right",
      width: 140,
      render: (v: string) => (
        <span className="text-[11px] text-muted-foreground">
          {new Date(v).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ),
    },
  ];

  // 副标题（task-06）：workspace 名 + 计数。
  // 聚焦时 N=total（当前待我处理），M=tabTotals.active（进行中总数，单独 effect 拉）。
  const renderSubtitle = (): ReactNode => {
    const wsName = workspace?.name ?? "—";
    if (tab === "archive") {
      return `${wsName} · 已归档变更`;
    }
    const m = tabTotals.active;
    if (focusMine) {
      const n = total;
      if (m !== undefined) {
        return `${wsName} · ${n} 个变更正在等你处理（共 ${m} 个进行中）`;
      }
      // 首次未拉到 M 时降级（只显示 N）
      return `${wsName} · ${n} 个变更正在等你处理`;
    }
    return `${wsName} · 共 ${total} 个进行中`;
  };

  // 空状态（分场景，对齐原型 ③）
  // task-09 / FR-04a（D-001@v1）：删「+ 新建变更」入口后，进行中空态引导去会话页
  // （/workspaces/[id]/sessions），由 agent 在会话里自动立项并推进；「重新扫描」仍在
  // PageHeader 作全量兜底（FR-04c）。archive 空态不引导（归档无新建语义）。
  const sessionGuide = (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      <span className="text-xs text-muted-foreground">
        还没有进行中的变更。去会话跟 agent 对话，描述你的需求，agent 会自动立项并推进。
      </span>
      <Link
        href={`/workspaces/${workspaceId}/sessions`}
        className={cn(buttonVariants({ variant: "default", size: "sm" }))}
      >
        去会话页
      </Link>
    </div>
  );
  const renderEmpty = (): ReactNode => {
    if (items.length > 0) return null;
    // 有 filter 无匹配 → 简短文案（不显示 CTA，避免误导）
    if (search || stageFilter) {
      return (
        <div className="py-10 text-center text-xs text-muted-foreground">
          没有匹配的变更。
        </div>
      );
    }
    if (tab === "active" && focusMine) {
      return (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="text-[15px] font-medium text-foreground">
            🎉 暂无待你处理的变更
          </div>
          <div className="text-xs text-muted-foreground">
            所有变更都在正常推进，或已全部处理完。
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFocusMine(false)}
          >
            查看全部进行中
          </Button>
          {sessionGuide}
        </div>
      );
    }
    if (tab === "active" && !focusMine) {
      return (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="text-[15px] font-medium text-foreground">
            当前没有进行中的变更
          </div>
          {sessionGuide}
        </div>
      );
    }
    // archive
    return (
      <div className="py-10 text-center text-[15px] font-medium text-foreground">
        还没有归档的变更
      </div>
    );
  };

  return (
    <PageContainer size="full">
      <PageHeader
        title="变更中心"
        subtitle={renderSubtitle()}
        actions={
          // FR-04c：删「+ 新建变更」后，「重新扫描」保留作全量兜底（含 scoped 不做删除的收敛）
          <Button
            size="sm"
            variant="outline"
            onClick={handleReparse}
            disabled={reparsing}
          >
            {reparsing ? "解析中…" : "重新扫描"}
          </Button>
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

      {/* 主 tab：进行中 / 已归档（按 location，D-007），挂数量（tabTotals 单独 effect 拉） */}
      <div className="flex items-center gap-1">
        {TABS.map((t) => {
          const cnt = t.key === "active" ? tabTotals.active : tabTotals.archive;
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
              {cnt !== undefined && (
                <span className="ml-1 inline-block min-w-[18px] rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                  {cnt}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 聚焦开关（D-007）：仅进行中视图显示，默认勾上。黄色高亮框对齐原型聚焦框。 */}
      {tab === "active" && (
        <div className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs">
          <Checkbox
            checked={focusMine}
            onChange={(e) => {
              setFocusMine(e.target.checked);
              setPage(1);
            }}
          >
            <span className="font-medium text-foreground">只看待我处理</span>
            <span className="ml-1 inline-block min-w-[18px] rounded-full bg-amber-200 px-1.5 text-[11px] font-medium text-amber-800">
              {total}
            </span>
          </Checkbox>
          <span className="text-muted-foreground">
            取消勾选 → 显示全部进行中（含 AI 正在跑的）
          </span>
        </div>
      )}

      <SectionCard bodyPadding="p-2">
        {/* 工具栏：搜索 + 重置（右对齐，对齐 FRONTEND_PAGE_STYLE §2） */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button size="sm" onClick={handleSearchClick}>
            搜索
          </Button>
          <Button size="sm" variant="outline" onClick={handleResetClick}>
            重置
          </Button>
        </div>
        {/* 查询区：grid-cols-2 消留白（task-06，原 grid-cols-4 右半空） */}
        <div className="grid w-full grid-cols-2 gap-3">
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
        // 空态走自定义 ReactNode（分场景 + CTA），透传给 antd Table locale.emptyText
        locale={{ emptyText: renderEmpty() }}
      />
    </PageContainer>
  );
}
