"use client";

/**
 * 任务计划页面 (task-12 / FR-05) — 对齐 project-plans 风格。
 *
 * 功能:
 *  - 列表分页 (task-plan/page),状态/月份/项目/负责人/时间区间/配合人员服务端过滤。
 *  - 个人视图切换 (personal-task-plan/page,仅当前登录用户的任务)。
 *  - 新建/编辑/删除任务计划。
 *  - 执行任务 (task-plan/execute) — 联动生成/推进 TaskExecute。
 *  - 导出 Excel (后端生成 `任务计划_YYYYMMDD_HHMMSS.xlsx`)。
 *
 * 依赖:lib/ppm/task (API) + lib/ppm/project (项目下拉) + stores/session。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DatePicker, Input, Select, Table, type TableProps, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
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
  listTaskExecutes,
  startPlanTask,
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
import {
  ExecuteTaskDialog,
  type ExecuteTaskState,
} from "../_components/execute-task-dialog";

const { RangePicker } = DatePicker;

type ViewMode = "all" | "personal";

// PlanTask.status 存中文(未开始/进行中/已完成,见 ppm_plan_task 模型),
// 筛选下拉值用中文以匹配后端 where status.in_(...)。
const STATUS_CODE_OPTIONS = [
  { label: "未开始", value: "未开始" },
  { label: "进行中", value: "进行中" },
  { label: "已完成", value: "已完成" },
];

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  task?: PlanTask;
}

// 查询条件外壳:垂直布局(标题在上,控件在下),对齐 project-plans 风格。
function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-xs leading-4 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export default function TaskPlansPage() {
  const { user: currentUser } = useSession();
  const { toast, showToast } = useToast();

  const [view, setView] = useState<ViewMode>("all");
  const [rows, setRows] = useState<PlanTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 筛选(全部走服务端 PlanTaskPageReq)
  const [statusFilterList, setStatusFilterList] = useState<string[]>([]);
  const [monthFilter, setMonthFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(
    null,
  );
  const [workPartnerFilter, setWorkPartnerFilter] = useState<string>("");
  // 搜索触发计数器:点搜索按钮强制触发查询(即使条件未变)
  const [searchNonce, setSearchNonce] = useState(0);
  // 查询条件展开/收起:默认只显示 4 个,展开后追加 3 个(参考 project-plans)
  const [expanded, setExpanded] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [projects, setProjects] = useState<ProjectSimpleItem[]>([]);

  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    mode: "create",
  });
  const [execute, setExecute] = useState<ExecuteTaskState | null>(null);
  const [executeBusy, setExecuteBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PlanTask | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listSimpleProjects();
        setProjects(list ?? []);
      } catch (e) {
        showToast(false, e instanceof Error ? e.message : "加载项目列表失败");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildParams = (
    p: number,
    ps: number,
    opts: { includeUserId: boolean },
  ): PlanTaskPageReq => {
    const params: PlanTaskPageReq = { page: p, page_size: ps };
    if (statusFilterList.length > 0) params.status = statusFilterList;
    if (monthFilter) params.month = monthFilter;
    if (projectFilter) params.project_id = projectFilter;
    if (opts.includeUserId && userFilter) params.user_id = userFilter;
    if (dateRange?.[0]) {
      params.start_time = dateRange[0].startOf("day").toISOString();
    }
    if (dateRange?.[1]) {
      params.end_time = dateRange[1].endOf("day").toISOString();
    }
    if (workPartnerFilter.trim()) {
      params.work_partner = workPartnerFilter.trim();
    }
    return params;
  };

  const load = useCallback(
    async (opts: { page?: number; page_size?: number } = {}) => {
      const p = opts.page ?? page;
      const ps = opts.page_size ?? pageSize;
      setLoading(true);
      setError(null);
      try {
        // personal 视图:user_id 由后端从 token 注入,前端不传
        const params = buildParams(p, ps, { includeUserId: view !== "personal" });
        const resp =
          view === "personal"
            ? await listPersonalPlanTasks(
                params as Omit<PlanTaskPageReq, "user_id">,
              )
            : await listPlanTasks(params);
        setRows(resp.items);
        setTotal(resp.total);
        setPage(p);
        setPageSize(ps);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    },
    // buildParams 内部读取的 state 全列入 dep,确保筛选条件变化时 load 引用变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      view,
      page,
      pageSize,
      statusFilterList,
      monthFilter,
      projectFilter,
      userFilter,
      dateRange,
      workPartnerFilter,
    ],
  );

  // 首屏 + 搜索按钮/回车(searchNonce)→ 回第 1 页重拉。
  // 注意:不监听 filter state — 用户改条件不会自动查询,必须点搜索/回车才生效。
  // 翻页/改 pageSize 走 pagination.onChange 直接调 load,绕过此 effect。
  useEffect(() => {
    void load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchNonce]);

  const commitSearch = () => setSearchNonce((n) => n + 1);

  const resetFilters = () => {
    setStatusFilterList([]);
    setMonthFilter("");
    setProjectFilter("");
    setUserFilter(null);
    setDateRange(null);
    setWorkPartnerFilter("");
    setSearchNonce((n) => n + 1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = buildParams(1, 1000, { includeUserId: view !== "personal" });
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

  const handleStart = async (task: PlanTask) => {
    setExecuteBusy(true);
    try {
      const exc = await startPlanTask({ plan_task_id: task.id });
      setExecute({
        task,
        executeInfo: "",
        timeSpent: task.time_spent ? String(task.time_spent) : "",
        taskExecuteId: exc.id,
      });
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "启动失败");
    } finally {
      setExecuteBusy(false);
    }
  };

  const handleResume = async (task: PlanTask) => {
    setExecuteBusy(true);
    try {
      const page = await listTaskExecutes({
        plan_task_id: task.id,
        status: "30",
        page: 1,
        page_size: 1,
      });
      const inflight = page.items?.[0];
      if (!inflight) {
        showToast(false, "未找到进行中的执行记录");
        return;
      }
      setExecute({
        task,
        executeInfo: inflight.execute_info ?? "",
        timeSpent:
          inflight.time_spent != null ? String(inflight.time_spent) : "",
        taskExecuteId: inflight.id,
      });
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "加载执行记录失败");
    } finally {
      setExecuteBusy(false);
    }
  };

  const handleExecute = async (action: "submit" | "complete") => {
    if (!execute?.task) return;
    const task = execute.task;
    if (!execute.taskExecuteId) {
      showToast(false, "缺少执行记录 id, 请先启动任务");
      return;
    }
    setExecuteBusy(true);
    try {
      const timeSpent = execute.timeSpent
        ? Number(execute.timeSpent)
        : undefined;
      await executePlanTask({
        plan_task_id: task.id,
        action,
        task_execute_id: execute.taskExecuteId,
        execute_info: execute.executeInfo || undefined,
        time_spent:
          timeSpent !== undefined && !Number.isNaN(timeSpent)
            ? timeSpent
            : undefined,
      });
      showToast(
        true,
        action === "complete" ? "任务已完成" : "执行已保存(可再次填报)",
      );
      setExecute(null);
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "执行失败");
    } finally {
      setExecuteBusy(false);
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

  // 可删除:负责人本人 或 超级管理员 (单删/批量删共用, ql-20260715-015/016)
  const canDeleteTask = (t: PlanTask) =>
    currentUser?.id === t.user_id || !!currentUser?.is_platform_admin;

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    if (
      !confirm(
        `确认删除选中的 ${selectedRowKeys.length} 条任务计划？此操作不可恢复。`,
      )
    )
      return;
    let ok = 0;
    let fail = 0;
    for (const id of selectedRowKeys) {
      try {
        await deletePlanTask(id);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setSelectedRowKeys([]);
    await load();
    if (fail === 0) showToast(true, `已删除 ${ok} 条任务计划`);
    else showToast(false, `成功 ${ok} 条，失败 ${fail} 条`);
  };

  const rowSelection: TableProps<PlanTask>["rowSelection"] = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys.map(String)),
    getCheckboxProps: (t: PlanTask) => ({ disabled: !canDeleteTask(t) }),
  };

  const columns: TableProps<PlanTask>["columns"] = [
    {
      title: "任务内容",
      dataIndex: "content",
      key: "content",
      width: 280,
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
      width: 140,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "负责人",
      dataIndex: "user_name",
      key: "user_name",
      width: 100,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "配合人员",
      dataIndex: "work_partner",
      key: "work_partner",
      width: 120,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (v: string) => {
        const tag = taskStatusTag(v);
        return <Tag color={tag.color}>{tag.text}</Tag>;
      },
    },
    {
      title: "计划时间",
      key: "time",
      width: 200,
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
      width: 90,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "操作",
      key: "actions",
      align: "center",
      width: 180,
      fixed: "right",
      render: (_v, t: PlanTask) => {
        const isOwner = currentUser?.id === t.user_id;
        // 编辑:status="未开始"(PlanTask 中文初始态) + user_id 归属
        const canEdit = t.status === "未开始" && isOwner;
        const canDelete = canDeleteTask(t);
        return (
          <div className="flex whitespace-nowrap gap-1 justify-center">
            {t.status === "未开始" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleStart(t)}
              >
                启动
              </Button>
            )}
            {t.status === "进行中" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleResume(t)}
              >
                执行
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={!canEdit}
              title={
                canEdit
                  ? undefined
                  : t.status !== "未开始"
                    ? "仅未开始状态可编辑"
                    : "仅负责人可编辑"
              }
              onClick={() => setDrawer({ open: true, mode: "edit", task: t })}
            >
              编辑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600 hover:text-red-700"
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
  ];

  return (
    <PageContainer size="full">
      <PageHeader
        title="任务计划"
        subtitle="任务计划制定 / 执行推进 / 工时预估"
      />

      <Toast toast={toast} />

      {view === "personal" && currentUser && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700">
          当前为「我的任务」视图:仅显示 {currentUser.displayName || currentUser.email}
        </div>
      )}

      <SectionCard bodyPadding="p-2">
        {/* 顶部按钮行(D-006):数据组(导出/新建)左 | 基础组(搜索/重置/展开)最右 */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={selectedRowKeys.length === 0}
            className="text-red-600 hover:text-red-700"
            onClick={() => void handleBatchDelete()}
          >
            批量删除{selectedRowKeys.length > 0 ? `(${selectedRowKeys.length})` : ""}
          </Button>
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
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button size="sm" onClick={commitSearch}>
            搜索
          </Button>
          <Button size="sm" variant="outline" onClick={resetFilters}>
            重置
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : "展开"}
          </Button>
        </div>

        {/* 查询条件:垂直 grid-cols-4 */}
        <div className="grid w-full grid-cols-4 gap-3">
          <Field label="状态">
            <Select<string[]>
              mode="multiple"
              allowClear
              className="w-full"
              placeholder="状态(可多选)"
              value={statusFilterList}
              onChange={(v) => {
                setStatusFilterList(v as string[]);
                setSearchNonce((n) => n + 1);
              }}
              options={STATUS_CODE_OPTIONS}
            />
          </Field>
          <Field label="月份">
            <DatePicker.MonthPicker
              className="w-full"
              placeholder="选择月份"
              value={monthFilter ? dayjs(monthFilter, "YYYY-MM") : null}
              onChange={(d) => {
                setMonthFilter(d ? d.format("YYYY-MM") : "");
                setSearchNonce((n) => n + 1);
              }}
            />
          </Field>
          <Field label="项目">
            <Select<string>
              className="w-full"
              placeholder="全部项目"
              allowClear
              value={projectFilter || undefined}
              onChange={(v) => {
                setProjectFilter(v ?? "");
                setSearchNonce((n) => n + 1);
              }}
              options={projects.map((p) => ({
                label: p.project_name ?? p.id,
                value: p.id,
              }))}
            />
          </Field>
          <Field label="负责人">
            <PpmUserSelect
              res="user"
              allowClear
              style={{ width: "100%" }}
              placeholder="负责人"
              value={userFilter}
              onChange={(v) => {
                setUserFilter((v as string | null) ?? null);
                setSearchNonce((n) => n + 1);
              }}
            />
          </Field>
          {expanded && (
            <>
              <Field label="计划时间区间">
                <RangePicker
                  className="w-full"
                  size="middle"
                  value={dateRange as [Dayjs, Dayjs] | null}
                  onChange={(v) =>
                    setDateRange(v as [Dayjs | null, Dayjs | null] | null)
                  }
                  placeholder={["开始", "结束"]}
                />
              </Field>
              <Field label="配合人员">
                <Input
                  allowClear
                  className="w-full"
                  placeholder="配合人员(回车查询)"
                  value={workPartnerFilter}
                  onChange={(e) => setWorkPartnerFilter(e.target.value)}
                  onPressEnter={commitSearch}
                />
              </Field>
              <Field label="视图">
                <Select<ViewMode>
                  className="w-full"
                  value={view}
                  onChange={(v) => {
                    setView(v as ViewMode);
                    setSearchNonce((n) => n + 1);
                  }}
                  options={[
                    { label: "全部任务", value: "all" },
                    { label: "我的任务", value: "personal" },
                  ]}
                />
              </Field>
            </>
          )}
        </div>
      </SectionCard>

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
        <Table<PlanTask>
          rowKey="id"
          rowSelection={rowSelection}
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="small"
          bordered
          rowClassName={(_row, idx) => (idx % 2 === 1 ? "bg-muted/40" : "")}
          scroll={{ x: "max-content", y: "calc(100vh - 430px)" }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, s) => void load({ page: p, page_size: s }),
          }}
          locale={{ emptyText: "暂无任务计划" }}
        />
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
        <ExecuteTaskDialog
          state={execute}
          onChange={setExecute}
          onConfirm={(action) => void handleExecute(action)}
          onCancel={() => setExecute(null)}
          busy={executeBusy}
        />
      )}

      {confirmDelete && (
        <DeleteConfirm
          task={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </PageContainer>
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
