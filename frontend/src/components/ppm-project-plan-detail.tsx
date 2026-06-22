"use client";

/**
 * 项目计划三联表详情抽屉 (task-03)。
 *
 * 复用 ``PpmSubTable`` 展开行模式,渲染 4 层嵌套:
 *   PsProjectPlan → PsPlanNode → PsPlanNodeDetail → PlanTask
 *
 * - 顶层摘要区展示 plan 基本信息 + 派生成本 (D-014@v1,remaining_*),
 *   超支 (负值) 用红色标注。
 * - nodes 表 (展开行模式) 每行一个里程碑;展开后嵌 details 表,
 *   details 展开行嵌 tasks 表。
 * - 空态显式「—」/「暂无里程碑」。
 *
 * 设计依据:tasks/task-03.md §三联表 + AC-13/AC-14。
 */
import { useEffect, useState } from "react";
import { Table, type TableColumnsType, type TableProps } from "antd";

import {
  PpmSubTable,
  type PpmSubMasterColumns,
} from "@/components/ppm-sub-table";
import {
  getProjectPlanThreeLevel,
  statusLabel,
  type PlanTaskSimple,
  type ProjectPlanThreeLevel,
  type PsPlanNodeDetailWithTasks,
  type PsPlanNodeWithDetail,
} from "@/lib/ppm";

interface PpmProjectPlanDetailProps {
  open: boolean;
  planId: string | null;
  onClose: () => void;
}

// 派生展示:负值 (超支) 红色,None 显示「—」
function RemainingCell({ value }: { value: string | null | undefined }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const num = Number(value);
  if (!Number.isNaN(num) && num < 0) {
    return <span className="text-xs font-medium text-red-600">{value}（超支）</span>;
  }
  return <span className="text-xs">{value}</span>;
}

export function PpmProjectPlanDetail({
  open,
  planId,
  onClose,
}: PpmProjectPlanDetailProps) {
  // 用 AntD Drawer 之外,这里采用轻量侧抽屉布局 (与 page 抽屉风格一致)
  if (!open) return null;

  return (
    <DetailInner
      planId={planId}
      onClose={onClose}
    />
  );
}

function DetailInner({
  planId,
  onClose,
}: {
  planId: string | null;
  onClose: () => void;
}) {
  // 数据加载 + 渲染由内部 hook 管理 (避免把整页 useState 拉到外层)
  return (
    <DetailData planId={planId} onClose={onClose} />
  );
}

// ── 数据加载 + 主渲染 ────────────────────────────────────────────────────

function DetailData({
  planId,
  onClose,
}: {
  planId: string | null;
  onClose: () => void;
}) {
  // useEffect 内拉数据 (与 page.tsx 风格一致,手写 load 避免引入 SWR 依赖)
  const [data, setData] = useState<ProjectPlanThreeLevel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProjectPlanThreeLevel(planId)
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [planId]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[920px] flex-col border-l bg-background shadow-xl">
        <Header onClose={onClose} />
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {error ? (
            <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : loading ? (
            <div className="text-xs text-muted-foreground">加载中…</div>
          ) : data ? (
            <>
              <PlanSummary plan={data} />
              <NodesSection nodes={data.nodes} />
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <h3 className="text-sm font-medium">项目计划详情（三联表）</h3>
      <button
        onClick={onClose}
        className="text-muted-foreground hover:text-foreground"
      >
        ✕
      </button>
    </div>
  );
}

// ── 顶层摘要 (含派生成本) ───────────────────────────────────────────────

function PlanSummary({ plan }: { plan: ProjectPlanThreeLevel }) {
  return (
    <div className="rounded border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-medium text-foreground">
        {plan.project_name ?? plan.project_id}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <SummaryItem label="项目 ID" value={plan.project_id} />
        <SummaryItem
          label="项目经理"
          value={plan.project_manager_name ?? null}
        />
        <SummaryItem label="状态" value={statusLabel(plan.status)} />
        <SummaryItem
          label="预算人天"
          value={plan.budget_person_days ?? null}
        />
        <SummaryItem
          label="实际消耗人天"
          value={plan.actual_consumption_person_days ?? null}
        />
        <SummaryItem label="剩余人天（派生）">
          <RemainingCell value={plan.remaining_available_person_days} />
        </SummaryItem>
        <SummaryItem label="总成本" value={plan.total_cost ?? null} />
        <SummaryItem label="人力成本" value={plan.labor_cost ?? null} />
        <SummaryItem label="剩余成本（派生）">
          <RemainingCell value={plan.remaining_cost} />
        </SummaryItem>
      </div>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  children,
}: {
  label: string;
  value?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5">
        {children ??
          (value && value !== "" ? (
            <span>{value}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ))}
      </div>
    </div>
  );
}

// ── 节点 → 明细 → 任务 三层嵌套 ─────────────────────────────────────────

function NodesSection({ nodes }: { nodes: PsPlanNodeWithDetail[] }) {
  if (nodes.length === 0) {
    return (
      <div className="rounded border border-dashed p-6 text-center text-xs text-muted-foreground">
        暂无里程碑
      </div>
    );
  }

  const nodeColumns: PpmSubMasterColumns<PsPlanNodeWithDetail> = [
    { title: "里程碑", dataIndex: "overall_stage", key: "overall_stage" },
    { title: "序号", dataIndex: "no", key: "no", width: 80 },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (v: unknown) => statusLabel(v as string | null | undefined) ?? "—",
    },
    {
      title: "明细数",
      key: "detail_count",
      width: 80,
      render: (_v: unknown, row: PsPlanNodeWithDetail) => row.details.length,
    },
  ];

  return (
    <PpmSubTable<PsPlanNodeWithDetail>
      title="里程碑列表（点击展开查看明细与任务）"
      masterRows={nodes}
      masterColumns={nodeColumns}
      expandRender={(node) => <DetailsSection details={node.details} />}
    />
  );
}

function DetailsSection({
  details,
}: {
  details: PsPlanNodeDetailWithTasks[];
}) {
  if (details.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">暂无明细</div>
    );
  }

  const detailColumns: PpmSubMasterColumns<PsPlanNodeDetailWithTasks> = [
    { title: "明细阶段", dataIndex: "detailed_stage", key: "detailed_stage" },
    { title: "主题", dataIndex: "task_theme", key: "task_theme" },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (v: unknown) => statusLabel(v as string | null | undefined) ?? "—",
    },
    {
      title: "任务数",
      key: "task_count",
      width: 80,
      render: (_v: unknown, row: PsPlanNodeDetailWithTasks) => row.tasks.length,
    },
  ];

  return (
    <div className="px-3 py-2">
      <PpmSubTable<PsPlanNodeDetailWithTasks>
        masterRows={details}
        masterColumns={detailColumns}
        expandRender={(detail) => <TasksTable tasks={detail.tasks} />}
      />
    </div>
  );
}

function TasksTable({ tasks }: { tasks: PlanTaskSimple[] }) {
  if (tasks.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">暂无任务</div>
    );
  }

  const columns: TableColumnsType<PlanTaskSimple> = [
    { title: "任务内容", dataIndex: "content", key: "content" },
    { title: "负责人", dataIndex: "user_name", key: "user_name", width: 100 },
    { title: "工时", dataIndex: "work_load", key: "work_load", width: 80 },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (v: unknown) => statusLabel(v as string | null | undefined) ?? "—",
    },
  ];
  const tableProps: Partial<TableProps<PlanTaskSimple>> = { pagination: false };
  return (
    <div className="px-3 py-2">
      <Table<PlanTaskSimple>
        rowKey="id"
        columns={columns}
        dataSource={tasks}
        size="small"
        scroll={{ x: "max-content" }}
        {...tableProps}
      />
    </div>
  );
}
