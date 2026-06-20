"use client";

/**
 * 项目计划 (PsProjectPlan) 列表页。
 *
 * 走 lib/ppm/plan.ts:listProjectPlans + CRUD。AntD Table + 表单抽屉。
 * 「里程碑明细」入口跳转 /ppm/milestone-details?plan=xxx。
 *
 * 设计依据:tasks/task-11.md。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Table, type TableProps, Tag } from "antd";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  createProjectPlan,
  deleteProjectPlan,
  listProjectPlans,
  updateProjectPlan,
  type PsProjectPlan,
} from "@/lib/ppm";

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  plan?: PsProjectPlan;
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

      {drawer.open && (
        <PlanFormDrawer
          mode={drawer.mode}
          plan={drawer.plan}
          onClose={() => setDrawer({ open: false, mode: "create" })}
          onSaved={async () => {
            setDrawer({ open: false, mode: "create" });
            await load();
          }}
        />
      )}
    </div>
  );
}

function PlanFormDrawer({
  mode,
  plan,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  plan?: PsProjectPlan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [projectId, setProjectId] = useState(plan?.project_id ?? "");
  const [projectName, setProjectName] = useState(plan?.project_name ?? "");
  const [managerName, setManagerName] = useState(
    plan?.project_manager_name ?? "",
  );
  const [managerId, setManagerId] = useState(plan?.project_manager_id ?? "");
  const [startTime, setStartTime] = useState(plan?.project_start_time ?? "");
  const [planEndTime, setPlanEndTime] = useState(
    plan?.project_plan_end_time ?? "",
  );
  const [contractName, setContractName] = useState(plan?.contract_name ?? "");
  const [contractAmount, setContractAmount] = useState(
    plan?.contract_amount ?? "",
  );
  const [budgetPersonDays, setBudgetPersonDays] = useState(
    plan?.budget_person_days ?? "",
  );
  const [status, setStatus] = useState(plan?.status ?? "draft");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const base = {
        project_name: projectName || null,
        project_manager_id: managerId || null,
        project_manager_name: managerName || null,
        project_start_time: startTime || null,
        project_plan_end_time: planEndTime || null,
        contract_name: contractName || null,
        contract_amount: contractAmount || null,
        budget_person_days: budgetPersonDays || null,
        status,
      };
      if (mode === "create") {
        if (!projectId.trim()) {
          setErr("项目 ID 必填");
          setBusy(false);
          return;
        }
        await createProjectPlan({ project_id: projectId.trim(), ...base });
      } else if (plan) {
        await updateProjectPlan(plan.id, base);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[560px] flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">
            {mode === "create" ? "新建项目计划" : "编辑项目计划"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <Field label="项目 ID *">
            <input
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={mode === "edit"}
              className={inputCls}
            />
          </Field>
          <Field label="项目名称">
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="项目经理">
              <input value={managerName} onChange={(e) => setManagerName(e.target.value)} className={inputCls} />
            </Field>
            <Field label="经理 ID">
              <input value={managerId} onChange={(e) => setManagerId(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="开始时间">
              <input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="YYYY-MM-DD" className={inputCls} />
            </Field>
            <Field label="计划结束">
              <input value={planEndTime} onChange={(e) => setPlanEndTime(e.target.value)} placeholder="YYYY-MM-DD" className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="合同名称">
              <input value={contractName} onChange={(e) => setContractName(e.target.value)} className={inputCls} />
            </Field>
            <Field label="合同金额">
              <input value={contractAmount} onChange={(e) => setContractAmount(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label="预算人天">
            <input value={budgetPersonDays} onChange={(e) => setBudgetPersonDays(e.target.value)} className={inputCls} />
          </Field>
          <Field label="状态">
            <input value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls} />
          </Field>
          {err && <p className="text-[11px] text-destructive">{err}</p>}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background px-4 py-3">
          <Button size="sm" variant="outline" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">{label}</label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
