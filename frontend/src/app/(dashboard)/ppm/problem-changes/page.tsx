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
import {
  PpmUserSelect,
  type PpmSelectOption,
} from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import {
  createProblemChange,
  deleteProblemChange,
  getProblem,
  listProblemChanges,
  nextProcessProblemChange,
  rejectProcessProblemChange,
  updateProblemChange,
  type ProblemChange,
  type ProblemList,
} from "@/lib/ppm";

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

const STATUS_COLOR: Record<string, string> = {
  "1": "processing",
  "2": "success",
  "3": "default",
};

/**
 * 问题类型 (task-06 多态,对照源 pro_type)。
 *
 * 后端 pro_type 当前仅 bug / change 两值;多态纯前端字段显隐,
 * 不动后端 schema。其他值 (含 undefined) 走「默认」全字段表单。
 */
type ProblemType = "bug" | "change" | "demand" | "other";

interface ChangeFieldPolicy {
  /** 是否显示「变更原因」区段 (bug 隐藏 — bug 修复无业务变更原因)。 */
  showReason: boolean;
  /** 变更原因是否必填 (change 显式标星)。 */
  reasonRequired: boolean;
  /** 是否显示「需求背景」占位 (demand 场景,当前仅占位提示)。 */
  showDemandCtx: boolean;
}

/** pro_type → 字段显隐策略映射 (AC-10)。 */
const PROBLEM_CHANGE_FIELDS: Record<ProblemType, ChangeFieldPolicy> = {
  bug: { showReason: false, reasonRequired: false, showDemandCtx: false },
  change: { showReason: true, reasonRequired: true, showDemandCtx: false },
  demand: { showReason: true, reasonRequired: false, showDemandCtx: true },
  other: { showReason: true, reasonRequired: false, showDemandCtx: false },
};

function resolvePolicy(proType: string | null | undefined): ChangeFieldPolicy {
  if (proType === "bug") return PROBLEM_CHANGE_FIELDS.bug;
  if (proType === "change") return PROBLEM_CHANGE_FIELDS.change;
  if (proType === "demand") return PROBLEM_CHANGE_FIELDS.demand;
  return PROBLEM_CHANGE_FIELDS.other;
}

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

  const handleNext = async (c: ProblemChange) => {
    if (c.status !== "1") {
      showToast(false, "仅审核中状态可推进");
      return;
    }
    const comment = window.prompt("推进审批意见 (可留空):", "") ?? "";
    try {
      await nextProcessProblemChange(c.id, { comment: comment || null });
      showToast(true, "已推进到下一节点");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "推进失败");
    }
  };

  const handleReject = async (c: ProblemChange) => {
    if (c.status !== "1") {
      showToast(false, "仅审核中状态可驳回");
      return;
    }
    const comment = window.prompt("驳回意见 (可留空):", "") ?? "";
    if (!window.confirm("确认驳回该变更 (置为已作废)?")) return;
    try {
      await rejectProcessProblemChange(c.id, { comment: comment || null });
      showToast(true, "已驳回");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "驳回失败");
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
            <>
              <Button size="sm" onClick={() => void handleNext(c)}>
                推进
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleReject(c)}
              >
                驳回
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void handleDelete(c)}
              >
                删除
              </Button>
            </>
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

  // 多态 (task-06):按源 ProblemList.pro_type 切换字段显隐。
  // 编辑态直接用 change.resource_id 反查;新建态随 resourceId 输入反查。
  const [sourceProType, setSourceProType] = useState<string | null>(null);
  const policy = resolvePolicy(sourceProType);

  useEffect(() => {
    const rid = (change?.resource_id ?? resourceId ?? "").trim();
    if (!rid) {
      setSourceProType(null);
      return;
    }
    let cancelled = false;
    getProblem(rid)
      .then((p: ProblemList) => {
        if (!cancelled) setSourceProType(p.pro_type ?? null);
      })
      .catch(() => {
        // 源问题读取失败 (不存在 / 无权限) → 降级走「默认」全字段表单
        if (!cancelled) setSourceProType(null);
      });
    return () => {
      cancelled = true;
    };
  }, [change?.resource_id, resourceId]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      // 多态校验 (AC-10):change 类型变更原因必填
      if (policy.reasonRequired && !changeReason.trim()) {
        setErr("当前问题类型要求填写「变更原因」");
        setBusy(false);
        return;
      }
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
          {sourceProType && (
            <div className="rounded border border-muted bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground">
              源问题类型：<span className="font-mono">{sourceProType}</span>
              {policy.showReason
                ? policy.reasonRequired
                  ? "（变更原因必填）"
                  : ""
                : "（当前类型隐藏变更原因）"}
            </div>
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
          {policy.showReason && (
            <Field label={policy.reasonRequired ? "变更原因 *" : "变更原因"}>
              <textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} disabled={!editable} rows={2} className={inputCls} />
            </Field>
          )}
          {policy.showDemandCtx && (
            <Field label="需求背景（可选）">
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                disabled={!editable}
                rows={2}
                placeholder="补充需求背景、来源、验收标准等"
                className={inputCls}
              />
            </Field>
          )}
          <Field label="责任人">
            <div className="-mt-0.5">
              <PpmUserSelect
                res="projectMember"
                searchData={{ pm_project_id: projectId || null }}
                value={dutyUserId}
                disabled={!editable}
                onChange={(v) => {
                  setDutyUserId((v as string | null) ?? "");
                  if (!v) setDutyUserName("");
                }}
                onLoadedOptions={(opts: PpmSelectOption[]) => {
                  const cur = dutyUserId;
                  if (!cur) return;
                  const hit = opts.find((o) => o.value === cur);
                  if (hit && hit.label && hit.label !== dutyUserName) {
                    setDutyUserName(String(hit.label));
                  }
                }}
                placeholder={
                  projectId ? "请选择责任人" : "请先选择项目"
                }
              />
            </div>
          </Field>
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
