"use client";

/**
 * 问题变更 (ProblemChange) 列表页。
 *
 * 问题变更状态 (简化,不走完整 4 节点):
 * - status=1 审核中
 * - status=2 已完成(变更生效,源问题清单标记变更中解除)
 * - status=3 已作废
 *
 * 设计依据:tasks/task-11.md + backend problem/fsm.py(ProblemChangeStatus)。
 */
import { useCallback, useEffect, useState } from "react";
import { Table, type TableProps, Tag } from "antd";

import { Button } from "@/components/ui/button";
import { PROBLEM_CHANGE_STATUS_TEXT } from "@/components/ppm-status-actions";
import { ApiError } from "@/lib/api";
import {
  createProblemChange,
  deleteProblemChange,
  listProblemChanges,
  updateProblemChange,
  type ProblemChange,
} from "@/lib/ppm";

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

const STATUS_COLOR: Record<string, string> = {
  "1": "processing",
  "2": "success",
  "3": "default",
};

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  change?: ProblemChange;
}

export default function ProblemChangesPage() {
  const [items, setItems] = useState<ProblemChange[]>([]);
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
      setItems(await listProblemChanges({ page: 1, page_size: 100 }));
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

  const handleDelete = async (c: ProblemChange) => {
    if (c.status !== "1") {
      showToast(false, "仅审核中状态可删除");
      return;
    }
    if (!confirm("删除该问题变更?")) return;
    try {
      await deleteProblemChange(c.id);
      showToast(true, "已删除");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<ProblemChange>["columns"] = [
    {
      title: "源问题",
      dataIndex: "resource_id",
      key: "resource_id",
      render: (v: string, c: ProblemChange) => (
        <div className="text-xs">
          <div className="font-mono">{v}</div>
          <div className="text-muted-foreground">{c.project_name ?? "—"}</div>
        </div>
      ),
    },
    {
      title: "变更内容",
      dataIndex: "pro_desc",
      key: "pro_desc",
      render: (v: string | null) => (
        <span className="line-clamp-2 max-w-md">{v ?? "—"}</span>
      ),
    },
    {
      title: "变更原因",
      dataIndex: "change_reason",
      key: "change_reason",
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "责任人",
      dataIndex: "duty_user_name",
      key: "duty_user_name",
      render: (v: string | null, c: ProblemChange) =>
        v ?? (c.duty_user_id ? c.duty_user_id : "待指派"),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: string) => (
        <Tag color={STATUS_COLOR[v] ?? "default"}>
          {PROBLEM_CHANGE_STATUS_TEXT[v] ?? v}
        </Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      align: "right",
      render: (_v: unknown, c: ProblemChange) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDrawer({ open: true, mode: "edit", change: c })}
          >
            {c.status === "1" ? "编辑" : "详情"}
          </Button>
          {c.status === "1" && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void handleDelete(c)}
            >
              删除
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">问题变更</h1>
          <p className="text-xs text-muted-foreground">
            问题清单的变更申请:审核中 → 已完成 / 已作废
          </p>
        </div>
        <Button size="sm" onClick={() => setDrawer({ open: true, mode: "create" })}>
          + 新建变更
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
        <Table<ProblemChange>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading}
          size="small"
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "暂无问题变更" }}
        />
      )}

      {drawer.open && (
        <ChangeDrawer
          key={drawer.change?.id ?? "new"}
          mode={drawer.mode}
          change={drawer.change}
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

function ChangeDrawer({
  mode,
  change,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  change?: ProblemChange;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editable = mode === "create" || change?.status === "1";

  const [resourceId, setResourceId] = useState(change?.resource_id ?? "");
  const [projectId, setProjectId] = useState(change?.project_id ?? "");
  const [projectName, setProjectName] = useState(change?.project_name ?? "");
  const [proDesc, setProDesc] = useState(change?.pro_desc ?? "");
  const [changeReason, setChangeReason] = useState(change?.change_reason ?? "");
  const [dutyUserId, setDutyUserId] = useState(change?.duty_user_id ?? "");
  const [dutyUserName, setDutyUserName] = useState(
    change?.duty_user_name ?? "",
  );
  const [planStart, setPlanStart] = useState(change?.plan_start_time ?? "");
  const [planEnd, setPlanEnd] = useState(change?.plan_end_time ?? "");
  const [remarks, setRemarks] = useState(change?.remarks ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        pro_desc: proDesc || null,
        change_reason: changeReason || null,
        duty_user_id: dutyUserId || null,
        duty_user_name: dutyUserName || null,
        plan_start_time: planStart || null,
        plan_end_time: planEnd || null,
        remarks: remarks || null,
      };
      if (mode === "create") {
        if (!resourceId.trim()) {
          setErr("源问题 ID 必填");
          setBusy(false);
          return;
        }
        await createProblemChange({
          resource_id: resourceId.trim(),
          project_id: projectId || null,
          project_name: projectName || null,
          ...body,
        });
      } else if (change) {
        await updateProblemChange(change.id, body);
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
            {mode === "create" ? "新建问题变更" : "问题变更详情"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {mode === "create" && (
            <Field label="源问题 ID *">
              <input value={resourceId} onChange={(e) => setResourceId(e.target.value)} className={inputCls} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="项目 ID">
              <input value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
            <Field label="项目名称">
              <input value={projectName} onChange={(e) => setProjectName(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
          </div>
          <Field label="变更内容">
            <textarea value={proDesc} onChange={(e) => setProDesc(e.target.value)} disabled={!editable} rows={3} className={inputCls} />
          </Field>
          <Field label="变更原因">
            <textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} disabled={!editable} rows={2} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="责任人 ID">
              <input value={dutyUserId} onChange={(e) => setDutyUserId(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
            <Field label="责任人名">
              <input value={dutyUserName} onChange={(e) => setDutyUserName(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="计划开始">
              <input value={planStart} onChange={(e) => setPlanStart(e.target.value)} placeholder="YYYY-MM-DD" disabled={!editable} className={inputCls} />
            </Field>
            <Field label="计划结束">
              <input value={planEnd} onChange={(e) => setPlanEnd(e.target.value)} placeholder="YYYY-MM-DD" disabled={!editable} className={inputCls} />
            </Field>
          </div>
          <Field label="备注">
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!editable} rows={2} className={inputCls} />
          </Field>
          {err && <p className="text-[11px] text-destructive">{err}</p>}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background px-4 py-3">
          <Button size="sm" variant="outline" onClick={onClose}>关闭</Button>
          {editable && (
            <Button size="sm" disabled={busy} onClick={() => void submit()}>
              {busy ? "保存中…" : "保存"}
            </Button>
          )}
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
