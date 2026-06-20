"use client";

/**
 * 里程碑明细 (PsPlanNodeDetail) 页面 — task-11 核心。
 *
 * 状态机驱动的操作按钮 (D-002@v1):
 * - draft  → 提交审核 (save)
 * - review → 审核通过 (save) / 驳回 (reject) — 由 audit_user 处理
 * - approve→ 审批通过 (save→done) / 驳回 (reject) — 由 approve_user 处理
 * - rejected → 重新提交 (save)
 * - done / archived → 终态无操作
 * - 任意非终态 → 变更 (change,生成 parent_id 新草稿版本)
 *
 * 变更版本链:listPsPlanNodeDetailVersions(parent_id 链)。
 * 流程履历:listPlanNodeDetailProcesses。
 * 附件 file_urls(JSON 数组,D-007) — 简单 url 列表增删。
 *
 * 设计依据:tasks/task-11.md + backend plan/fsm.py + ppm-status-actions.tsx。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Table, type TableProps, Tag } from "antd";

import { Button } from "@/components/ui/button";
import {
  PLAN_DETAIL_STATUS_COLOR,
  PLAN_DETAIL_STATUS_TEXT,
  PlanDetailActions,
} from "@/components/ppm-status-actions";
import { ApiError } from "@/lib/api";
import {
  changePlanNodeDetailProcess,
  createPsPlanNodeDetail,
  deletePsPlanNodeDetail,
  listPlanNodeDetailProcesses,
  listPsPlanNodeDetails,
  listPsPlanNodeDetailVersions,
  listPsPlanNodes,
  rejectPlanNodeDetailProcess,
  savePlanNodeDetailProcess,
  updatePsPlanNodeDetail,
  type PlanProcessActionReq,
  type PlanChangeProcessReq,
  type PsPlanNode,
  type PsPlanNodeDetail,
  type PsPlanNodeDetailProcess,
} from "@/lib/ppm";
import { useSession } from "@/stores/session";

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

interface DetailDrawerState {
  open: boolean;
  mode: "create" | "edit";
  detail?: PsPlanNodeDetail;
}

export default function MilestoneDetailsPage() {
  const params = useSearchParams();
  const planId = params.get("plan") ?? "";
  const { user: currentUser } = useSession();
  const currentUserId = currentUser?.id ?? "";

  const [psNodes, setPsNodes] = useState<PsPlanNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [details, setDetails] = useState<PsPlanNodeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DetailDrawerState>({
    open: false,
    mode: "create",
  });
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  // 里程碑下拉加载
  useEffect(() => {
    if (!planId) return;
    void (async () => {
      try {
        const list = await listPsPlanNodes(planId);
        setPsNodes(list);
        if (list.length > 0) setSelectedNodeId(list[0]?.id ?? "");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载里程碑失败");
      }
    })();
  }, [planId]);

  const loadDetails = useCallback(async () => {
    if (!selectedNodeId) {
      setDetails([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDetails(await listPsPlanNodeDetails(selectedNodeId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载明细失败");
    } finally {
      setLoading(false);
    }
  }, [selectedNodeId]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSubmit = async (
    detailId: string,
    action: "save" | "reject" | "change",
  ) => {
    let rejectBody: PlanProcessActionReq | undefined;
    let changeBody: PlanChangeProcessReq | undefined;
    if (action === "reject") {
      const handleInfo = prompt("驳回意见(可选):") ?? "";
      rejectBody = { handle_info: handleInfo || null };
    } else if (action === "change") {
      const changeReason = prompt("变更原因(必填):") ?? "";
      if (!changeReason.trim()) {
        showToast(false, "变更原因不能为空");
        return;
      }
      changeBody = { change_reason: changeReason };
    }
    try {
      if (action === "save") {
        await savePlanNodeDetailProcess(detailId);
        showToast(true, "已提交");
      } else if (action === "reject") {
        await rejectPlanNodeDetailProcess(detailId, rejectBody);
        showToast(true, "已驳回");
      } else {
        await changePlanNodeDetailProcess(detailId, changeBody);
        showToast(true, "已创建变更新版本");
      }
      await loadDetails();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "操作失败");
    }
  };

  const handleDelete = async (d: PsPlanNodeDetail) => {
    if (d.status !== "draft") {
      showToast(false, "仅草稿状态可删除");
      return;
    }
    if (!confirm("删除该里程碑明细?")) return;
    try {
      await deletePsPlanNodeDetail(d.id);
      showToast(true, "已删除");
      await loadDetails();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<PsPlanNodeDetail>["columns"] = useMemo(
    () => [
      {
        title: "明细阶段",
        dataIndex: "detailed_stage",
        key: "detailed_stage",
        render: (v: string | null, d: PsPlanNodeDetail) => (
          <div className="flex items-center gap-2">
            <span>{v ?? "—"}</span>
            {d.parent_id && (
              <Tag color="purple" className="text-[10px]">
                变更版
              </Tag>
            )}
          </div>
        ),
      },
      {
        title: "任务主题",
        dataIndex: "task_theme",
        key: "task_theme",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "角色",
        dataIndex: "role_name",
        key: "role_name",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "计划工时",
        dataIndex: "plan_workload",
        key: "plan_workload",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "审核人",
        dataIndex: "audit_user_name",
        key: "audit_user_name",
        render: (v: string | null, d: PsPlanNodeDetail) =>
          v ?? (d.audit_user_id ? d.audit_user_id : "待指派"),
      },
      {
        title: "审批人",
        dataIndex: "approve_user_name",
        key: "approve_user_name",
        render: (v: string | null, d: PsPlanNodeDetail) =>
          v ?? (d.approve_user_id ? d.approve_user_id : "待指派"),
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        render: (v: string) => (
          <Tag color={PLAN_DETAIL_STATUS_COLOR[v] ?? "default"}>
            {PLAN_DETAIL_STATUS_TEXT[v] ?? v}
          </Tag>
        ),
      },
      {
        title: "操作",
        key: "actions",
        align: "right",
        width: 280,
        render: (_v: unknown, d: PsPlanNodeDetail) => (
          <div className="flex flex-wrap justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDrawer({ open: true, mode: "edit", detail: d })}
            >
              详情
            </Button>
            {d.status === "draft" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDrawer({ open: true, mode: "edit", detail: d })}
              >
                编辑
              </Button>
            )}
            <PlanDetailActions
              detail={d}
              currentUserId={currentUserId}
              onSubmit={handleSubmit}
            />
            {d.status === "draft" && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void handleDelete(d)}
              >
                删除
              </Button>
            )}
          </div>
        ),
      },
    ],
    [currentUserId],
  );

  if (!planId) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10 text-center text-sm text-muted-foreground">
        请从「项目计划」页选择一条计划进入里程碑明细。
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">里程碑明细</h1>
          <p className="text-xs text-muted-foreground">
            计划 {planId} · 状态机驱动:草稿→审核→审批→完成,支持驳回/变更
          </p>
        </div>
        <Button
          size="sm"
          disabled={!selectedNodeId}
          onClick={() =>
            selectedNodeId &&
            setDrawer({
              open: true,
              mode: "create",
            })
          }
        >
          + 新建明细
        </Button>
      </header>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">里程碑:</span>
        <select
          value={selectedNodeId ?? ""}
          onChange={(e) => setSelectedNodeId(e.target.value || null)}
          className={`w-80 ${inputCls}`}
        >
          {psNodes.length === 0 && <option value="">(无里程碑)</option>}
          {psNodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.overall_stage ?? n.id} {n.no ? `· ${n.no}` : ""}
            </option>
          ))}
        </select>
      </div>

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
            onClick={() => void loadDetails()}
          >
            重新加载
          </Button>
        </div>
      ) : (
        <Table<PsPlanNodeDetail>
          rowKey="id"
          columns={columns}
          dataSource={details}
          loading={loading}
          size="small"
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: selectedNodeId ? "暂无明细" : "请选择里程碑" }}
        />
      )}

      {drawer.open && selectedNodeId && (
        <DetailDrawer
          key={drawer.detail?.id ?? "new"}
          mode={drawer.mode}
          planNodeId={selectedNodeId}
          detail={drawer.detail}
          currentUserId={currentUserId}
          onClose={() => setDrawer({ open: false, mode: "create" })}
          onSaved={async () => {
            setDrawer({ open: false, mode: "create" });
            await loadDetails();
          }}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 明细详情/编辑抽屉 — 含 file_urls 增删 + 版本链 + 流程履历
// ---------------------------------------------------------------------------

function DetailDrawer({
  mode,
  planNodeId,
  detail,
  currentUserId,
  onClose,
  onSaved,
  onSubmit,
}: {
  mode: "create" | "edit";
  planNodeId: string;
  detail?: PsPlanNodeDetail;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
  onSubmit: (
    detailId: string,
    action: "save" | "reject" | "change",
  ) => void;
}) {
  const editable = mode === "create" || detail?.status === "draft";

  const [detailedStage, setDetailedStage] = useState(
    detail?.detailed_stage ?? "",
  );
  const [taskTheme, setTaskTheme] = useState(detail?.task_theme ?? "");
  const [taskDesc, setTaskDesc] = useState(detail?.task_description ?? "");
  const [requirements, setRequirements] = useState(detail?.requirements ?? "");
  const [roleName, setRoleName] = useState(detail?.role_name ?? "");
  const [achievement, setAchievement] = useState(detail?.achievement ?? "");
  const [planWorkload, setPlanWorkload] = useState(detail?.plan_workload ?? "");
  const [planBegin, setPlanBegin] = useState(detail?.plan_begin_time ?? "");
  const [planComplete, setPlanComplete] = useState(
    detail?.plan_complete_time ?? "",
  );
  const [auditUserId, setAuditUserId] = useState(detail?.audit_user_id ?? "");
  const [approveUserId, setApproveUserId] = useState(
    detail?.approve_user_id ?? "",
  );
  const [fileUrls, setFileUrls] = useState<string[]>(detail?.file_urls ?? []);
  const [newUrl, setNewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [versions, setVersions] = useState<PsPlanNodeDetail[]>([]);
  const [logs, setLogs] = useState<PsPlanNodeDetailProcess[]>([]);

  useEffect(() => {
    if (!detail) return;
    void (async () => {
      try {
        const [v, l] = await Promise.all([
          listPsPlanNodeDetailVersions(detail.id),
          listPlanNodeDetailProcesses(detail.id),
        ]);
        setVersions(v);
        setLogs(l);
      } catch {
        // 历史加载失败不阻塞编辑
      }
    })();
  }, [detail]);

  const addUrl = () => {
    const u = newUrl.trim();
    if (!u) return;
    setFileUrls((prev) => [...prev, u]);
    setNewUrl("");
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        detailed_stage: detailedStage || null,
        task_theme: taskTheme || null,
        task_description: taskDesc || null,
        requirements: requirements || null,
        role_name: roleName || null,
        achievement: achievement || null,
        plan_workload: planWorkload || null,
        plan_begin_time: planBegin || null,
        plan_complete_time: planComplete || null,
        audit_user_id: auditUserId || null,
        approve_user_id: approveUserId || null,
        file_urls: fileUrls,
      };
      if (mode === "create") {
        await createPsPlanNodeDetail({ plan_node_id: planNodeId, ...body });
      } else if (detail) {
        await updatePsPlanNodeDetail(detail.id, body);
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
      <div className="fixed right-0 top-0 z-50 flex h-full w-[640px] flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">
            {mode === "create"
              ? "新建里程碑明细"
              : `里程碑明细${detail ? ` · ${PLAN_DETAIL_STATUS_TEXT[detail.status] ?? detail.status}` : ""}`}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2">
            <Field label="明细阶段">
              <input value={detailedStage} onChange={(e) => setDetailedStage(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
            <Field label="任务主题">
              <input value={taskTheme} onChange={(e) => setTaskTheme(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
          </div>
          <Field label="任务描述">
            <textarea value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} disabled={!editable} rows={3} className={inputCls} />
          </Field>
          <Field label="要求">
            <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} disabled={!editable} rows={2} className={inputCls} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="角色">
              <input value={roleName} onChange={(e) => setRoleName(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
            <Field label="成果">
              <input value={achievement} onChange={(e) => setAchievement(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
            <Field label="计划工时">
              <input value={planWorkload} onChange={(e) => setPlanWorkload(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="计划开始">
              <input value={planBegin} onChange={(e) => setPlanBegin(e.target.value)} placeholder="YYYY-MM-DD" disabled={!editable} className={inputCls} />
            </Field>
            <Field label="计划完成">
              <input value={planComplete} onChange={(e) => setPlanComplete(e.target.value)} placeholder="YYYY-MM-DD" disabled={!editable} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="审核人 ID">
              <input value={auditUserId} onChange={(e) => setAuditUserId(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
            <Field label="审批人 ID">
              <input value={approveUserId} onChange={(e) => setApproveUserId(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
          </div>

          {/* 附件 file_urls (D-007) */}
          <Field label="附件 URL">
            <div className="space-y-1">
              {fileUrls.map((u, i) => (
                <div key={`${u}-${i}`} className="flex items-center gap-1">
                  <code className="flex-1 truncate rounded bg-muted/30 px-2 py-1 text-[11px]">
                    {u}
                  </code>
                  {editable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setFileUrls((prev) => prev.filter((_, idx) => idx !== i))
                      }
                    >
                      删除
                    </Button>
                  )}
                </div>
              ))}
              {editable && (
                <div className="flex gap-1">
                  <input
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://..."
                    className={inputCls}
                  />
                  <Button size="sm" variant="outline" onClick={addUrl}>
                    添加
                  </Button>
                </div>
              )}
            </div>
          </Field>

          {/* 变更版本链 */}
          {detail && versions.length > 0 && (
            <Field label={`变更版本链(${versions.length})`}>
              <div className="space-y-1 rounded border bg-card p-2">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 text-[11px]">
                    <Tag color={PLAN_DETAIL_STATUS_COLOR[v.status] ?? "default"}>
                      {PLAN_DETAIL_STATUS_TEXT[v.status] ?? v.status}
                    </Tag>
                    <span className="truncate">{v.task_theme ?? v.id}</span>
                    <span className="text-muted-foreground">
                      {v.change_reason ?? ""}
                    </span>
                  </div>
                ))}
              </div>
            </Field>
          )}

          {/* 流程履历 */}
          {detail && logs.length > 0 && (
            <Field label={`流程履历(${logs.length})`}>
              <div className="space-y-1 rounded border bg-card p-2 text-[11px]">
                {logs.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-muted-foreground">
                      {l.node_key ?? "—"}
                    </span>
                    <span>{l.handle_user_name ?? "—"}</span>
                    <span className="truncate text-muted-foreground">
                      {l.handle_info ?? ""}
                    </span>
                  </div>
                ))}
              </div>
            </Field>
          )}

          {err && <p className="text-[11px] text-destructive">{err}</p>}
        </div>
        <div className="sticky bottom-0 flex flex-wrap justify-between gap-2 border-t bg-background px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {detail && (
              <PlanDetailActions
                detail={detail}
                currentUserId={currentUserId}
                onSubmit={(id, action) => {
                  onClose();
                  void onSubmit(id, action);
                }}
              />
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>关闭</Button>
            {editable && (
              <Button size="sm" disabled={busy} onClick={() => void submit()}>
                {busy ? "保存中…" : "保存"}
              </Button>
            )}
          </div>
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
