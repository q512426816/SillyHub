"use client";

/**
 * 项目计划 (PsProjectPlan) 列表页。
 *
 * 走 lib/ppm/plan.ts:listProjectPlans + CRUD。AntD Table + 17 字段表单抽屉
 * (PpmProjectPlanForm) + 三联表详情抽屉 (PpmProjectPlanDetail)。
 * 「里程碑明细」入口跳转 /ppm/milestone-details?plan=xxx。
 *
 * 设计依据:tasks/task-03.md + tasks/task-11.md。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Table, type TableProps, Tag } from "antd";

import { Button } from "@/components/ui/button";
import { ProjectPlanCostBarChart } from "@/components/charts";
import { PpmProjectPlanDetail } from "@/components/ppm-project-plan-detail";
import { PpmProjectPlanForm } from "@/components/ppm-project-plan-form";
import { ApiError } from "@/lib/api";
import {
  deleteProjectPlan,
  listProjectPlans,
  type PsProjectPlan,
} from "@/lib/ppm";

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  plan?: PsProjectPlan;
}

interface DetailState {
  open: boolean;
  planId: string | null;
}

export default function ProjectPlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<PsProjectPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    mode: "create",
  });
  const [detail, setDetail] = useState<DetailState>({ open: false, planId: null });
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlans(await listProjectPlans({ page: 1, page_size: 100 }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDelete = async (p: PsProjectPlan) => {
    if (!confirm(`删除项目计划「${p.project_name ?? p.id}」?`)) return;
    try {
      await deleteProjectPlan(p.id);
      showToast(true, "已删除");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<PsProjectPlan>["columns"] = [
    {
      title: "项目",
      dataIndex: "project_name",
      key: "project_name",
      render: (v: string | null, p: PsProjectPlan) => (
        <button
          className="text-left font-medium hover:underline"
          onClick={() =>
            router.push(`/ppm/milestone-details?plan=${p.id}`)
          }
        >
          {v ?? p.id}
        </button>
      ),
    },
    {
      title: "项目经理",
      dataIndex: "project_manager_name",
      key: "project_manager_name",
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "合同",
      key: "contract",
      render: (_v: unknown, p: PsProjectPlan) => (
        <div className="text-xs">
          <div>{p.contract_name ?? "—"}</div>
          <div className="text-muted-foreground">
            {p.contract_amount ?? "—"} 元
          </div>
        </div>
      ),
    },
    {
      title: "预算人天",
      dataIndex: "budget_person_days",
      key: "budget_person_days",
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: string) => <Tag>{v || "—"}</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      align: "right",
      render: (_v: unknown, p: PsProjectPlan) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDetail({ open: true, planId: p.id })}
          >
            详情
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              router.push(`/ppm/milestone-details?plan=${p.id}`)
            }
          >
            里程碑明细
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDrawer({ open: true, mode: "edit", plan: p })}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void handleDelete(p)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">项目计划</h1>
          <p className="text-xs text-muted-foreground">
            ps_project_plan — 项目维度的计划主表
          </p>
        </div>
        <Button size="sm" onClick={() => setDrawer({ open: true, mode: "create" })}>
          + 新建项目计划
        </Button>
      </header>

      {toast && (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            toast.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-destructive/30 bg-red-50 text-destructive"
          }`}
        >
          {toast.text}
        </div>
      )}

      {error ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
          <Button
            size="sm"
            variant="outline"
            className="ml-3"
            onClick={() => void load()}
          >
            重新加载
          </Button>
        </div>
      ) : (
        <Table<PsProjectPlan>
          rowKey="id"
          columns={columns}
          dataSource={plans}
          loading={loading}
          size="small"
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "暂无项目计划" }}
        />
      )}

      {!error && (
        <div className="rounded border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">项目成本概览</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            预算 / 实际(优先 total_cost,缺省回退实际人天) / 剩余
          </p>
          <ProjectPlanCostBarChart plans={plans} />
        </div>
      )}

      <PpmProjectPlanForm
        open={drawer.open}
        mode={drawer.mode}
        plan={drawer.plan}
        onClose={() => setDrawer({ open: false, mode: "create" })}
        onSaved={() => {
          setDrawer({ open: false, mode: "create" });
          void load();
        }}
      />

      <PpmProjectPlanDetail
        open={detail.open}
        planId={detail.planId}
        onClose={() => setDetail({ open: false, planId: null })}
      />
    </div>
  );
}
