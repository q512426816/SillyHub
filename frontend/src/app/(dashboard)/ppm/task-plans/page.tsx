"use client";

/**
 * 任务计划页面 (task-12 / FR-05)。
 *
 * 功能:
 *  - 列表分页 (task-plan/page),状态/月份/项目筛选。
 *  - 个人视图切换 (personal-task-plan/page,仅当前登录用户的任务)。
 *  - 新建/编辑/删除任务计划。
 *  - 执行任务 (task-plan/execute) — 联动生成/推进 TaskExecute。
 *
 * 依赖:lib/ppm/task (API) + lib/ppm/project (项目下拉) + stores/session。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { DatePicker, Input, Select, Table, type TableProps, Tag } from "antd";
import type { Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
import {
  PpmUserSelect,
  type PpmSelectOption,
} from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import {
  createPlanTask,
  deletePlanTask,
  executePlanTask,
  exportPlanTasks,
  listPersonalPlanTasks,
  listPlanTasks,
  updatePlanTask,
} from "@/lib/ppm/task";
import { listSimpleProjects } from "@/lib/ppm/project";
import type {
  PlanTask,
  PlanTaskCreate,
  PlanTaskPageReq,
  PlanTaskUpdate,
  ProjectSimpleItem,
} from "@/lib/ppm/types";
import { useSession } from "@/stores/session";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Toast,
  fmtDay,
  inputCls,
  taskStatusTag,
  useToast,
} from "../shared";

const { RangePicker } = DatePicker;

type ViewMode = "all" | "personal";

const STATUS_CODE_OPTIONS = [
  { label: "待执行", value: "10" },
  { label: "执行中", value: "20" },
  { label: "待验证", value: "30" },
  { label: "已完成", value: "40" },
  { label: "已关闭", value: "50" },
];

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  task?: PlanTask;
}

interface ExecuteState {
  task?: PlanTask;
  executeInfo: string;
  timeSpent: string;
  submit: boolean;
}

export default function TaskPlansPage() {
  const { user: currentUser } = useSession();
  const { toast, showToast } = useToast();

  const [view, setView] = useState<ViewMode>("all");
  const [rows, setRows] = useState<PlanTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // 筛选(后端 PlanTaskPageReq 支持:user_id/project_id/status/month/year)
  // status 多选 / dateRange / workPartner 后端不支持,前端本地过滤
  const [statusFilterList, setStatusFilterList] = useState<string[]>([]);
  const [monthFilter, setMonthFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(
    null,
  );
  const [workPartnerFilter, setWorkPartnerFilter] = useState<string>("");
  const [exporting, setExporting] = useState(false);

  const [projects, setProjects] = useState<ProjectSimpleItem[]>([]);

  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    mode: "create",
  });
  const [execute, setExecute] = useState<ExecuteState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PlanTask | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listSimpleProjects();
        setProjects(list ?? []);
      } catch (e) {
        console.error("[ppm/task-plans] load projects failed", e);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: PlanTaskPageReq = {
        page,
        page_size: pageSize,
      };
      // status 后端单值:多选时只传第一个,其余前端本地过滤。
      if (statusFilterList.length === 1) params.status = statusFilterList[0];
      if (monthFilter) params.month = monthFilter;
      if (projectFilter) params.project_id = projectFilter;
      if (userFilter) params.user_id = userFilter;
      const resp =
        view === "personal"
          ? await listPersonalPlanTasks(params)
          : await listPlanTasks(params);
      setRows(resp.items);
      setTotal(resp.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [
    view,
    page,
    pageSize,
    statusFilterList,
    monthFilter,
    projectFilter,
    userFilter,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // 本地过滤:status 多选 (>1) / dateRange / workPartner (后端不支持)
  const visibleRows = useMemo(() => {
    const [rangeStart, rangeEnd] = dateRange ?? [null, null];
    const wp = workPartnerFilter.trim().toLowerCase();
    const multiStatus =
      statusFilterList.length > 1 ? new Set(statusFilterList) : null;
    return rows.filter((t) => {
      if (multiStatus && !multiStatus.has(t.status)) return false;
      if (rangeStart && rangeEnd) {
        const s = t.start_time ? new Date(t.start_time) : null;
        if (s && !Number.isNaN(s.getTime())) {
          if (s < rangeStart.startOf("day").toDate()) return false;
          if (s > rangeEnd.endOf("day").toDate()) return false;
        }
      }
      if (wp && !(t.work_partner ?? "").toLowerCase().includes(wp)) {
        return false;
      }
      return true;
    });
  }, [rows, statusFilterList, dateRange, workPartnerFilter]);

  const resetFilters = () => {
    setStatusFilterList([]);
    setMonthFilter("");
    setProjectFilter("");
    setUserFilter(null);
    setDateRange(null);
    setWorkPartnerFilter("");
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params: PlanTaskPageReq = { page: 1, page_size: 1000 };
      if (statusFilterList.length === 1) params.status = statusFilterList[0];
      if (monthFilter) params.month = monthFilter;
      if (projectFilter) params.project_id = projectFilter;
      if (userFilter) params.user_id = userFilter;
      await exportPlanTasks(params);
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleSave = async (body: PlanTaskCreate | PlanTaskUpdate) => {
    if (drawer.mode === "create") {
      await createPlanTask(body as PlanTaskCreate);
      showToast(true, "任务计划已创建");
    } else if (drawer.task) {
      await updatePlanTask(drawer.task.id, body as PlanTaskUpdate);
      showToast(true, "任务计划已更新");
    }
    setDrawer({ open: false, mode: "create" });
    await load();
  };

  const handleExecute = async () => {
    if (!execute?.task) return;
    const task = execute.task;
    try {
      const timeSpent = execute.timeSpent
        ? Number(execute.timeSpent)
        : undefined;
      await executePlanTask({
        plan_task_id: task.id,
        submit: execute.submit,
        execute_info: execute.executeInfo || undefined,
        time_spent:
          timeSpent !== undefined && !Number.isNaN(timeSpent)
            ? timeSpent
            : undefined,
      });
      showToast(true, execute.submit ? "任务已提交(待验证)" : "执行进度已保存");
      setExecute(null);
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "执行失败");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deletePlanTask(target.id);
      showToast(true, "任务计划已删除");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<PlanTask>["columns"] = useMemo(
    () => [
      {
        title: "任务内容",
        dataIndex: "content",
        key: "content",
        ellipsis: true,
        render: (v: string | null, t: PlanTask) => (
          <div className="flex flex-col">
            <span className="text-sm">{v ?? "（未填写）"}</span>
            {t.remarks && (
              <span className="text-[10px] text-muted-foreground">
                {t.remarks}
              </span>
            )}
          </div>
        ),
      },
      {
        title: "项目",
        dataIndex: "project_name",
        key: "project_name",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "负责人",
        dataIndex: "user_name",
        key: "user_name",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "配合人员",
        dataIndex: "work_partner",
        key: "work_partner",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        render: (v: string) => {
          const tag = taskStatusTag(v);
          return <Tag color={tag.color}>{tag.text}</Tag>;
        },
      },
      {
        title: "计划时间",
        key: "time",
        render: (_v, t: PlanTask) => (
          <span className="text-xs text-muted-foreground">
            {t.start_time ? fmtDay(t.start_time) : "—"} ~{" "}
            {t.end_time ? fmtDay(t.end_time) : "—"}
          </span>
        ),
      },
      {
        title: "预估工时",
        dataIndex: "work_load",
        key: "work_load",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "操作",
        key: "actions",
        align: "right",
        render: (_v, t: PlanTask) => {
          const isOwner = currentUser?.id === t.user_id;
          // 编辑:status=10 (未开始/未提交) + user_id 归属
          const canEdit = t.status === "10" && isOwner;
          // 删除:user_id 归属(对齐源 handleDelete checkUser)
          const canDelete = isOwner;
          return (
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setExecute({
                    task: t,
                    executeInfo: "",
                    timeSpent: t.time_spent ? String(t.time_spent) : "",
                    submit: false,
                  })
                }
              >
                执行
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canEdit}
                title={
                  canEdit
                    ? undefined
                    : t.status !== "10"
                      ? "仅未开始状态可编辑"
                      : "仅负责人可编辑"
                }
                onClick={() => setDrawer({ open: true, mode: "edit", task: t })}
              >
                编辑
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!canDelete}
                title={canDelete ? undefined : "仅负责人可删除"}
                onClick={() => setConfirmDelete(t)}
              >
                删除
              </Button>
            </div>
          );
        },
      },
    ],
    [currentUser?.id],
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">任务计划</h1>
          <p className="text-xs text-muted-foreground">
            任务计划制定 / 执行推进 / 工时预估
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={view}
            onChange={(e) => {
              setView(e.target.value as ViewMode);
              setPage(1);
            }}
            className={`w-32 ${inputCls}`}
            aria-label="视图切换"
          >
            <option value="all">全部任务</option>
            <option value="personal">我的任务</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? "导出中…" : "导出"}
          </Button>
          <Button size="sm" onClick={() => setDrawer({ open: true, mode: "create" })}>
            + 新建任务
          </Button>
        </div>
      </header>

      <Toast toast={toast} />

      {view === "personal" && currentUser && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700">
          当前为「我的任务」视图:仅显示 {currentUser.displayName || currentUser.email}
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
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select<string[]>
              mode="multiple"
              allowClear
              style={{ minWidth: 180 }}
              placeholder="状态(可多选)"
              value={statusFilterList}
              onChange={(v) => {
                setStatusFilterList(v as string[]);
                setPage(1);
              }}
              options={STATUS_CODE_OPTIONS}
            />
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => {
                setMonthFilter(e.target.value);
                setPage(1);
              }}
              className={`${inputCls} w-40`}
              aria-label="月份筛选"
            />
            <select
              value={projectFilter}
              onChange={(e) => {
                setProjectFilter(e.target.value);
                setPage(1);
              }}
              className={`w-48 ${inputCls}`}
              aria-label="项目筛选"
            >
              <option value="">全部项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name ?? p.id}
                </option>
              ))}
            </select>
            <div className={`${inputCls} flex h-8 w-48 items-center px-1`}>
              <PpmUserSelect
                res="user"
                allowClear
                placeholder="负责人"
                value={userFilter}
                onChange={(v) => {
                  setUserFilter((v as string | null) ?? null);
                  setPage(1);
                }}
              />
            </div>
            <RangePicker
              size="middle"
              value={dateRange as [Dayjs, Dayjs] | null}
              onChange={(v) =>
                setDateRange(v as [Dayjs | null, Dayjs | null] | null)
              }
              placeholder={["开始", "结束"]}
            />
            <Input
              allowClear
              style={{ width: 140 }}
              placeholder="配合人员"
              value={workPartnerFilter}
              onChange={(e) => setWorkPartnerFilter(e.target.value)}
            />
            <Button size="sm" variant="outline" onClick={resetFilters}>
              清除筛选
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              共 {visibleRows.length} 条 / 总 {total}
            </span>
          </div>

          <Table<PlanTask>
            rowKey="id"
            columns={columns}
            dataSource={visibleRows}
            loading={loading}
            size="small"
            scroll={{ x: "max-content" }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              showTotal: (t) => `共 ${t} 条`,
              onChange: (p, s) => {
                setPage(p);
                setPageSize(s);
              },
            }}
            locale={{ emptyText: "暂无任务计划" }}
          />
        </>
      )}

      {drawer.open && (
        <TaskDrawer
          state={drawer}
          projects={projects}
          currentUserName={
            currentUser?.displayName || currentUser?.email || null
          }
          currentUserId={currentUser?.id ?? ""}
          onClose={() => setDrawer({ open: false, mode: "create" })}
          onSubmit={handleSave}
        />
      )}

      {execute && (
        <ExecuteDialog
          state={execute}
          onChange={setExecute}
          onConfirm={() => void handleExecute()}
          onCancel={() => setExecute(null)}
        />
      )}

      {confirmDelete && (
        <DeleteConfirm
          task={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}

function TaskDrawer({
  state,
  projects,
  currentUserName,
  currentUserId,
  onClose,
  onSubmit,
}: {
  state: DrawerState;
  projects: ProjectSimpleItem[];
  currentUserName: string | null;
  currentUserId: string;
  onClose: () => void;
  onSubmit: (_body: PlanTaskCreate | PlanTaskUpdate) => Promise<void>;
}) {
  const editing = state.task;
  const [content, setContent] = useState(editing?.content ?? "");
  const [userId, setUserId] = useState(editing?.user_id ?? currentUserId);
  const [userName, setUserName] = useState(
    editing?.user_name ?? currentUserName ?? "",
  );
  const [projectId, setProjectId] = useState(editing?.project_id ?? "");
  const [projectName, setProjectName] = useState(
    editing?.project_name ?? "",
  );
  const [moduleId, setModuleId] = useState(editing?.module_id ?? "");
  const [moduleName, setModuleName] = useState(editing?.module_name ?? "");
  const [startTime, setStartTime] = useState(editing?.start_time ?? "");
  const [endTime, setEndTime] = useState(editing?.end_time ?? "");
  const [workLoad, setWorkLoad] = useState(editing?.work_load ?? "");
  const [addWork, setAddWork] = useState(editing?.add_work ?? "");
  const [workPartner, setWorkPartner] = useState(editing?.work_partner ?? "");
  const [remarks, setRemarks] = useState(editing?.remarks ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    // 必填校验(对齐源 PlanForm.vue formRules)
    const missing: string[] = [];
    if (!content.trim()) missing.push("任务内容");
    if (!userId) missing.push("负责人");
    if (!startTime) missing.push("开始时间");
    if (!endTime) missing.push("结束时间");
    if (!projectName.trim() && !projectId) missing.push("所属项目");
    if (!moduleId.trim()) missing.push("模块");
    if (!workLoad.trim()) missing.push("工作量");
    if (missing.length > 0) {
      setErr(`请填写:${missing.join("、")}`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body: PlanTaskCreate | PlanTaskUpdate = {
        content: content.trim(),
        user_id: userId,
        user_name: userName,
        project_id: projectId || null,
        project_name: projectName || null,
        module_id: moduleId.trim() || null,
        module_name: moduleName.trim() || null,
        start_time: startTime || null,
        end_time: endTime || null,
        work_load: workLoad || null,
        add_work: addWork || null,
        work_partner: workPartner || null,
        remarks: remarks || null,
      };
      if (state.mode === "create") {
        (body as PlanTaskCreate).status = "10";
      }
      await onSubmit(body);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-[560px] rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">
          {state.mode === "create" ? "新建任务计划" : "编辑任务计划"}
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">任务内容 *</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={2}
              className={`mt-0.5 w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm focus:border-ring focus:outline-none`}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">负责人 *</label>
            <div className="mt-0.5">
              <PpmUserSelect
                res={projectId ? "projectMember" : "user"}
                searchData={
                  projectId ? { pm_project_id: projectId } : undefined
                }
                value={userId}
                onChange={(v) => {
                  setUserId((v as string | null) ?? "");
                  // userName 留空,提交时由后端 user_id 反查;若有选项则回填 label
                  if (!v) setUserName("");
                }}
                onLoadedOptions={(opts: PpmSelectOption[]) => {
                  const cur = userId;
                  if (!cur) return;
                  const hit = opts.find((o) => o.value === cur);
                  if (hit && hit.label && hit.label !== userName) {
                    setUserName(String(hit.label));
                  }
                }}
                placeholder="请选择负责人"
              />
            </div>
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">
              所属项目 *
            </label>
            <select
              value={projectId}
              onChange={(e) => {
                const v = e.target.value;
                setProjectId(v);
                const hit = projects.find((p) => p.id === v);
                setProjectName(hit?.project_name ?? "");
              }}
              className={`mt-0.5 ${inputCls}`}
            >
              <option value="">无</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name ?? p.id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">模块 *</label>
            <input
              value={moduleId}
              onChange={(e) => setModuleId(e.target.value)}
              placeholder="模块 ID"
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">模块名称</label>
            <input
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              placeholder="模块名称(可选)"
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">开始时间 *</label>
            <input
              type="date"
              value={startTime ? startTime.slice(0, 10) : ""}
              onChange={(e) => setStartTime(e.target.value)}
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">结束时间 *</label>
            <input
              type="date"
              value={endTime ? endTime.slice(0, 10) : ""}
              onChange={(e) => setEndTime(e.target.value)}
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">
              工作量(人天)*
            </label>
            <input
              value={workLoad}
              onChange={(e) => setWorkLoad(e.target.value)}
              placeholder="如 8 / 0.5"
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">加班</label>
            <input
              value={addWork}
              onChange={(e) => setAddWork(e.target.value)}
              placeholder="加班(可选)"
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">配合人员</label>
            <input
              value={workPartner}
              onChange={(e) => setWorkPartner(e.target.value)}
              placeholder="配合人员(可选)"
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">备注</label>
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
        </div>
        {err && <p className="mt-2 text-[11px] text-destructive">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ExecuteDialog({
  state,
  onChange,
  onConfirm,
  onCancel,
}: {
  state: ExecuteState;
  onChange: (_s: ExecuteState) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const task = state.task!;
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-[480px] rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">执行任务</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {task.content ?? "（未填写）"}
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground">
              本次耗时(人天)
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={state.timeSpent}
              onChange={(e) =>
                onChange({ ...state, timeSpent: e.target.value })
              }
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">
              执行情况说明
            </label>
            <textarea
              value={state.executeInfo}
              onChange={(e) =>
                onChange({ ...state, executeInfo: e.target.value })
              }
              rows={3}
              className={`mt-0.5 w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm focus:border-ring focus:outline-none`}
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={state.submit}
              onChange={(e) => onChange({ ...state, submit: e.target.checked })}
            />
            <span>提交到「待验证」（勾选则推进状态机）</span>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void confirm()}>
            {busy ? "提交中…" : "确认执行"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({
  task,
  onCancel,
  onConfirm,
}: {
  task: PlanTask;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-96 rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">确认删除任务计划？</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          将删除任务「{task.content ?? task.id}」,该操作不可恢复。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            确认删除
          </Button>
        </div>
      </div>
    </div>
  );
}
