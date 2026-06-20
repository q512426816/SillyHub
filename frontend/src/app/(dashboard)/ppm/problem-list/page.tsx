"use client";

/**
 * 问题清单 (ProblemList) 页面 — task-11 审批流核心。
 *
 * 4 节点审批流 (D-004@v1):申请(10)→开发经理(20)→项目经理(30)→部门经理(40)
 * bug 类型跳过部门经理。状态机 status 1-7 + nowNode 10-40。
 *
 * 操作按钮按 status + 当前用户 checkUser 显隐 (对照源 problemlist/index.vue):
 * - status=1 已保存:creator → 提交审核(nextProcess)
 * - status=2 审核中:now_handle_user → 审核通过(nextProcess)/ 驳回(rejectProcess)
 * - status=3 处置中:duty_user → 完成处置(doneTask)
 * - status=6 待验证:audit_user → 验证关闭(closeTask)/ 打回处置(rejectProcess)
 * - status=4/5 终态
 * - effective_status=7 变更中:列表标记「变更中」
 *
 * now_handle_user 为 null 时(X-003)按钮禁用并提示待指派。
 *
 * 设计依据:tasks/task-11.md + backend problem/fsm.py + ppm-status-actions.tsx。
 */
import { useCallback, useEffect, useState } from "react";
import { Table, type TableProps, Tag } from "antd";

import { Button } from "@/components/ui/button";
import {
  PROBLEM_NODE_TEXT,
  PROBLEM_STATUS_COLOR,
  PROBLEM_STATUS_TEXT,
  PROBLEM_TYPE_TEXT,
  ProblemActions,
} from "@/components/ppm-status-actions";
import { ApiError } from "@/lib/api";
import {
  closeTaskProblem,
  createProblem,
  deleteProblem,
  doneTaskProblem,
  listProblems,
  nextProcessProblem,
  rejectProcessProblem,
  updateProblem,
  type ProblemCloseTaskReq,
  type ProblemDoneTaskReq,
  type ProblemList,
} from "@/lib/ppm";
import { useSession } from "@/stores/session";

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  problem?: ProblemList;
}

export default function ProblemListPage() {
  const { user: currentUser } = useSession();
  const currentUserId = currentUser?.id ?? "";

  const [items, setItems] = useState<ProblemList[]>([]);
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
      setItems(await listProblems({ page: 1, page_size: 100 }));
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

  const handleAction = async (
    problemId: string,
    action: "next" | "reject" | "done" | "close",
  ) => {
    try {
      if (action === "next") {
        const comment = prompt("审核意见(可选):") ?? "";
        await nextProcessProblem(problemId, { comment: comment || null });
        showToast(true, "已推进到下一节点");
      } else if (action === "reject") {
        const comment = prompt("驳回意见(必填):") ?? "";
        if (!comment.trim()) {
          showToast(false, "驳回意见不能为空");
          return;
        }
        await rejectProcessProblem(problemId, { comment });
        showToast(true, "已驳回");
      } else if (action === "done") {
        const handleInfo = prompt("处置情况(必填):") ?? "";
        if (!handleInfo.trim()) {
          showToast(false, "处置情况不能为空");
          return;
        }
        const timeStr = prompt("耗时(小时,可选):") ?? "";
        const body: ProblemDoneTaskReq = {
          handle_info: handleInfo,
          completed: true,
          time_spent: timeStr.trim() ? Number(timeStr) : null,
        };
        await doneTaskProblem(problemId, body);
        showToast(true, "已完成处置,进入待验证");
      } else {
        const checkInfo = prompt("验证情况(必填):") ?? "";
        if (!checkInfo.trim()) {
          showToast(false, "验证情况不能为空");
          return;
        }
        const pass = confirm("验证通过?取消=打回处置");
        const body: ProblemCloseTaskReq = {
          check_info: checkInfo,
          check_result: pass ? "1" : "0",
        };
        await closeTaskProblem(problemId, body);
        showToast(true, pass ? "已关闭" : "已打回处置");
      }
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "操作失败");
    }
  };

  const handleDelete = async (p: ProblemList) => {
    if (p.status !== "1") {
      showToast(false, "仅已保存状态可删除");
      return;
    }
    if (!confirm("删除该问题清单?")) return;
    try {
      await deleteProblem(p.id);
      showToast(true, "已删除");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<ProblemList>["columns"] = [
    {
      title: "问题描述",
      dataIndex: "pro_desc",
      key: "pro_desc",
      render: (v: string | null, p: ProblemList) => (
        <div>
          <div className="line-clamp-2 max-w-md">{v ?? "—"}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {p.model_name ?? "—"} · {p.func_name ?? "—"}
          </div>
        </div>
      ),
    },
    {
      title: "类型",
      dataIndex: "pro_type",
      key: "pro_type",
      width: 80,
      render: (v: string | null) =>
        v ? (
          <Tag>{PROBLEM_TYPE_TEXT[v] ?? v}</Tag>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      title: "紧急",
      dataIndex: "is_urgent",
      key: "is_urgent",
      width: 60,
      render: (v: string | null) =>
        v === "1" ? <Tag color="red">急</Tag> : null,
    },
    {
      title: "责任人",
      dataIndex: "duty_user_name",
      key: "duty_user_name",
      width: 100,
      render: (v: string | null, p: ProblemList) =>
        v ?? (p.duty_user_id ? p.duty_user_id : "待指派"),
    },
    {
      title: "当前节点",
      dataIndex: "now_node",
      key: "now_node",
      width: 120,
      render: (v: number | null) =>
        v != null ? PROBLEM_NODE_TEXT[v] ?? String(v) : "—",
    },
    {
      title: "当前处理人",
      dataIndex: "now_handle_user_name",
      key: "now_handle_user_name",
      width: 120,
      render: (v: string | null, p: ProblemList) =>
        v ?? (p.now_handle_user ? p.now_handle_user : "待指派"),
    },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_v: unknown, p: ProblemList) => {
        const display =
          p.effective_status === "7" ? "7" : p.status;
        return (
          <Tag color={PROBLEM_STATUS_COLOR[display] ?? "default"}>
            {PROBLEM_STATUS_TEXT[display] ?? display}
          </Tag>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      align: "right",
      width: 280,
      render: (_v: unknown, p: ProblemList) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDrawer({ open: true, mode: "edit", problem: p })}
          >
            详情
          </Button>
          {p.status === "1" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDrawer({ open: true, mode: "edit", problem: p })}
            >
              编辑
            </Button>
          )}
          <ProblemActions
            problem={{
              id: p.id,
              status: p.status,
              effective_status: p.effective_status,
              now_node: p.now_node,
              now_handle_user: p.now_handle_user,
              duty_user_id: p.duty_user_id,
              audit_user_id: p.audit_user_id,
            }}
            currentUserId={currentUserId}
            onAction={handleAction}
          />
          {p.status === "1" && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void handleDelete(p)}
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
          <h1 className="mt-0.5">问题清单</h1>
          <p className="text-xs text-muted-foreground">
            4 节点审批流:申请→开发经理→项目经理→部门经理,bug 跳过部门经理
          </p>
        </div>
        <Button size="sm" onClick={() => setDrawer({ open: true, mode: "create" })}>
          + 新建问题
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
        <Table<ProblemList>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading}
          size="small"
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "暂无问题" }}
        />
      )}

      {drawer.open && (
        <ProblemDrawer
          key={drawer.problem?.id ?? "new"}
          mode={drawer.mode}
          problem={drawer.problem}
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

// ---------------------------------------------------------------------------
// 问题表单抽屉
// ---------------------------------------------------------------------------

function ProblemDrawer({
  mode,
  problem,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  problem?: ProblemList;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editable = mode === "create" || problem?.status === "1";

  const [projectId, setProjectId] = useState(problem?.project_id ?? "");
  const [projectName, setProjectName] = useState(problem?.project_name ?? "");
  const [moduleName, setModuleName] = useState(problem?.model_name ?? "");
  const [funcName, setFuncName] = useState(problem?.func_name ?? "");
  const [proDesc, setProDesc] = useState(problem?.pro_desc ?? "");
  const [proType, setProType] = useState(problem?.pro_type ?? "bug");
  const [isUrgent, setIsUrgent] = useState(problem?.is_urgent ?? "0");
  const [dutyUserId, setDutyUserId] = useState(problem?.duty_user_id ?? "");
  const [dutyUserName, setDutyUserName] = useState(
    problem?.duty_user_name ?? "",
  );
  const [planStart, setPlanStart] = useState(problem?.plan_start_time ?? "");
  const [planEnd, setPlanEnd] = useState(problem?.plan_end_time ?? "");
  const [auditUserId, setAuditUserId] = useState(problem?.audit_user_id ?? "");
  const [remarks, setRemarks] = useState(problem?.remarks ?? "");
  const [workLoad, setWorkLoad] = useState(problem?.work_load ?? "");
  const [submitNow, setSubmitNow] = useState(false);
  const [fileUrls, setFileUrls] = useState<string[]>(problem?.file_urls ?? []);
  const [newUrl, setNewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      if (mode === "create") {
        if (!projectId.trim()) {
          setErr("项目 ID 必填");
          setBusy(false);
          return;
        }
        await createProblem({
          project_id: projectId.trim(),
          project_name: projectName || null,
          model_name: moduleName || null,
          func_name: funcName || null,
          pro_desc: proDesc || null,
          pro_type: proType || null,
          is_urgent: isUrgent,
          duty_user_id: dutyUserId || null,
          duty_user_name: dutyUserName || null,
          plan_start_time: planStart || null,
          plan_end_time: planEnd || null,
          remarks: remarks || null,
          work_load: workLoad || null,
          file_urls: fileUrls,
          submit: submitNow,
        });
        showToast(true, submitNow ? "已创建并提交审核" : "已保存为草稿");
      } else if (problem) {
        await updateProblem(problem.id, {
          project_name: projectName || null,
          model_name: moduleName || null,
          func_name: funcName || null,
          pro_desc: proDesc || null,
          pro_type: proType || null,
          is_urgent: isUrgent,
          duty_user_id: dutyUserId || null,
          duty_user_name: dutyUserName || null,
          plan_start_time: planStart || null,
          plan_end_time: planEnd || null,
          remarks: remarks || null,
          work_load: workLoad || null,
        });
        showToast(true, "已更新");
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  // showToast 闭包内联(组件内可见)
  const showToast = (ok: boolean, text: string) => {
    // 触发一个临时 alert 风格 — 实际由父页 toast 接管,这里仅 console
    if (!ok) console.warn("[problem] " + text);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[640px] flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">
            {mode === "create" ? "新建问题" : "问题详情"}
            {problem && (
              <span className="ml-2 text-[10px] text-muted-foreground">
                {PROBLEM_STATUS_TEXT[problem.status] ?? problem.status}
              </span>
            )}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {mode === "create" && (
            <Field label="项目 ID *">
              <input value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="项目名称">
              <input value={projectName} onChange={(e) => setProjectName(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
            <Field label="模块名">
              <input value={moduleName} onChange={(e) => setModuleName(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="功能名">
              <input value={funcName} onChange={(e) => setFuncName(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
            <Field label="问题类型">
              <select value={proType} onChange={(e) => setProType(e.target.value)} disabled={!editable} className={inputCls}>
                <option value="bug">系统BUG</option>
                <option value="change">变更</option>
              </select>
            </Field>
          </div>
          <Field label="问题描述">
            <textarea value={proDesc} onChange={(e) => setProDesc(e.target.value)} disabled={!editable} rows={3} className={inputCls} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="紧急">
              <select value={isUrgent} onChange={(e) => setIsUrgent(e.target.value)} disabled={!editable} className={inputCls}>
                <option value="0">否</option>
                <option value="1">是</option>
              </select>
            </Field>
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
          <div className="grid grid-cols-2 gap-2">
            <Field label="验证人 ID">
              <input value={auditUserId} onChange={(e) => setAuditUserId(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
            <Field label="工时">
              <input value={workLoad} onChange={(e) => setWorkLoad(e.target.value)} disabled={!editable} className={inputCls} />
            </Field>
          </div>
          <Field label="备注">
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!editable} rows={2} className={inputCls} />
          </Field>

          <Field label="附件 URL">
            <div className="space-y-1">
              {fileUrls.map((u, i) => (
                <div key={`${u}-${i}`} className="flex items-center gap-1">
                  <code className="flex-1 truncate rounded bg-muted/30 px-2 py-1 text-[11px]">{u}</code>
                  {editable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setFileUrls((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      删除
                    </Button>
                  )}
                </div>
              ))}
              {editable && (
                <div className="flex gap-1">
                  <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://..." className={inputCls} />
                  <Button size="sm" variant="outline" onClick={addUrl}>添加</Button>
                </div>
              )}
            </div>
          </Field>

          {mode === "create" && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={submitNow}
                onChange={(e) => setSubmitNow(e.target.checked)}
              />
              <span>保存后立即提交审核(进开发经理审批)</span>
            </label>
          )}

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
