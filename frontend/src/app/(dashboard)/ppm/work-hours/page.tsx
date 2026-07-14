"use client";

/**
 * 工时录入页面 (task-12 / FR-06) — 对齐 project-plans 风格。
 *
 * 功能:
 *  - 列表分页 (work-hour/page),日期区间 / 项目 / 类型 / 录入人服务端过滤。
 *  - 新建/编辑/删除工时记录。
 *  - 顶部按钮跳转「工时统计」。
 *
 * 依赖:lib/ppm/task (work-hour API) + lib/ppm/project (项目下拉) + stores/session。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DatePicker, Input, Select, Table, type TableProps } from "antd";
import type { Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import {
  PpmUserSelect,
  type PpmSelectOption,
} from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import {
  createWorkHour,
  deleteWorkHour,
  exportWorkHours,
  listPlanTasks,
  listWorkHours,
  updateWorkHour,
} from "@/lib/ppm/task";
import { listSimpleProjects } from "@/lib/ppm/project";
import type {
  PlanTask,
  ProjectSimpleItem,
  WorkHour,
  WorkHourCreate,
  WorkHourPageReq,
  WorkHourUpdate,
} from "@/lib/ppm/types";
import { useSession } from "@/stores/session";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Toast,
  fmtDay,
  inputCls,
  today,
  useToast,
} from "../shared";

const { RangePicker } = DatePicker;

// type 枚举语义: 1-任务工时, 2-项目工时 (对照后端 task/model.py:223 + 源 form.vue)
const TYPE_OPTIONS = [
  { value: 1, label: "任务工时" },
  { value: 2, label: "项目工时" },
];

function typeLabel(t: number): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? String(t);
}

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  item?: WorkHour;
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

export default function WorkHoursPage() {
  const { user: currentUser } = useSession();
  const { toast, showToast } = useToast();

  const [rows, setRows] = useState<WorkHour[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 筛选(全部走服务端 WorkHourPageReq)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(
    null,
  );
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<number | null>(null);
  const [userFilter, setUserFilter] = useState<string | null>(null);
  // 搜索触发计数器:点搜索按钮强制触发查询(即使条件未变)
  const [searchNonce, setSearchNonce] = useState(0);

  const [exporting, setExporting] = useState(false);
  const [projects, setProjects] = useState<ProjectSimpleItem[]>([]);
  // 用户 id → label 映射 (供列表「填报人」列反向解析;PpmUserSelect res=user 全量拉取)
  const [userOptions, setUserOptions] = useState<PpmSelectOption[]>([]);

  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    mode: "create",
  });
  const [confirmDelete, setConfirmDelete] = useState<WorkHour | null>(null);

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

  const buildParams = (p: number, ps: number): WorkHourPageReq => {
    const params: WorkHourPageReq = { page: p, page_size: ps };
    if (dateRange?.[0]) {
      params.work_date_start = dateRange[0].format("YYYY-MM-DD");
    }
    if (dateRange?.[1]) {
      params.work_date_end = dateRange[1].format("YYYY-MM-DD");
    }
    if (projectFilter) params.project_id = projectFilter;
    if (typeFilter !== null) params.type = typeFilter;
    if (userFilter) params.user_id = userFilter;
    return params;
  };

  const load = useCallback(
    async (opts: { page?: number; page_size?: number } = {}) => {
      const p = opts.page ?? page;
      const ps = opts.page_size ?? pageSize;
      setLoading(true);
      setError(null);
      try {
        const resp = await listWorkHours(buildParams(p, ps));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize, dateRange, projectFilter, typeFilter, userFilter],
  );

  // 首屏 + 搜索按钮/回车(searchNonce)→ 回第 1 页重拉。
  // 不监听 filter state — 用户改条件不会自动查询,必须点搜索/回车才生效。
  // 翻页/改 pageSize 走 pagination.onChange 直接调 load,绕过此 effect。
  useEffect(() => {
    void load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchNonce]);

  const commitSearch = () => setSearchNonce((n) => n + 1);

  const resetFilters = () => {
    setDateRange(null);
    setProjectFilter("");
    setTypeFilter(null);
    setUserFilter(null);
    setSearchNonce((n) => n + 1);
  };

  // 任务名称映射:为列表「任务」列展示 task_id → content。按当前项目过滤拉取。
  const [planTasks, setPlanTasks] = useState<PlanTask[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const resp = await listPlanTasks({
          page: 1,
          page_size: 200,
          project_id: projectFilter || undefined,
        });
        setPlanTasks(resp.items ?? []);
      } catch (e) {
        showToast(false, e instanceof Error ? e.message : "加载任务列表失败");
        setPlanTasks([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter]);

  const planTaskName = useCallback(
    (taskId: string | null): string | null => {
      if (!taskId) return null;
      return planTasks.find((t) => t.id === taskId)?.content ?? null;
    },
    [planTasks],
  );

  const userName = useCallback(
    (uid: string): string => {
      return userOptions.find((u) => u.value === uid)?.label ?? uid;
    },
    [userOptions],
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportWorkHours(buildParams(1, 1000));
      showToast(true, "导出已开始");
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleSave = async (body: WorkHourCreate | WorkHourUpdate) => {
    if (drawer.mode === "create") {
      await createWorkHour(body as WorkHourCreate);
      showToast(true, "工时已录入");
    } else if (drawer.item) {
      await updateWorkHour(drawer.item.id, body as WorkHourUpdate);
      showToast(true, "工时已更新");
    }
    setDrawer({ open: false, mode: "create" });
    await load();
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteWorkHour(target.id);
      showToast(true, "工时已删除");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<WorkHour>["columns"] = [
    {
      title: "日期",
      dataIndex: "work_date",
      key: "work_date",
      width: 120,
      render: (v: string) => fmtDay(v),
    },
    {
      title: "项目",
      key: "project",
      width: 160,
      render: (_v, r: WorkHour) => {
        const p = projects.find((x) => x.id === r.project_id);
        return p?.project_name ?? r.project_id;
      },
    },
    {
      title: "任务",
      key: "task",
      width: 200,
      ellipsis: true,
      render: (_v, r: WorkHour) => {
        if (r.type !== 1) return "—";
        return planTaskName(r.task_id) ?? "—";
      },
    },
    {
      title: "填报人",
      dataIndex: "user_id",
      key: "user_id",
      width: 120,
      render: (uid: string) => userName(uid),
    },
    {
      title: "工时(h)",
      dataIndex: "hours",
      key: "hours",
      width: 100,
      align: "right",
      render: (v: number) => (
        <span className="font-mono">{Number(v).toFixed(1)}</span>
      ),
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 100,
      render: (v: number) => typeLabel(v),
    },
    {
      title: "说明",
      dataIndex: "description",
      key: "description",
      width: 220,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "操作",
      key: "actions",
      align: "center",
      width: 120,
      fixed: "right",
      render: (_v, r: WorkHour) => (
        <div className="flex whitespace-nowrap gap-1 justify-center">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDrawer({ open: true, mode: "edit", item: r })}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-600 hover:text-red-700"
            onClick={() => setConfirmDelete(r)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageContainer size="full">
      <PageHeader
        title="工时录入"
        subtitle="按日期 / 项目 / 类型记录工时"
      />

      <Toast toast={toast} />

      <SectionCard bodyPadding="p-2">
        {/* 顶部按钮行(D-006):页面按钮(工时统计/导出/新建)左 | 基础组(搜索/重置)最右 */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => { window.location.href = "/ppm/work-hour-statistics"; }}>
            工时统计 →
          </Button>
          <Button size="sm" variant="outline" disabled={exporting} onClick={() => void handleExport()}>
            {exporting ? "导出中…" : "导出"}
          </Button>
          <Button size="sm" onClick={() => setDrawer({ open: true, mode: "create" })}>
            + 录入工时
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button size="sm" onClick={commitSearch}>
            搜索
          </Button>
          <Button size="sm" variant="outline" onClick={resetFilters}>
            重置
          </Button>
        </div>

        {/* 查询条件:垂直 grid-cols-4 */}
        <div className="grid w-full grid-cols-4 gap-3">
          <Field label="工作日期区间">
            <RangePicker
              className="w-full"
              value={dateRange as [Dayjs, Dayjs] | null}
              onChange={(v) =>
                setDateRange(v as [Dayjs | null, Dayjs | null] | null)
              }
              placeholder={["开始", "结束"]}
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
          <Field label="类型">
            <Select<number>
              className="w-full"
              placeholder="全部类型"
              allowClear
              value={typeFilter ?? undefined}
              onChange={(v) => {
                setTypeFilter(v ?? null);
                setSearchNonce((n) => n + 1);
              }}
              options={TYPE_OPTIONS.map((o) => ({
                label: o.label,
                value: o.value,
              }))}
            />
          </Field>
          <Field label="录入人">
            <PpmUserSelect
              res="user"
              style={{ width: "100%" }}
              placeholder="全部成员"
              allowClear
              value={userFilter}
              onChange={(v) => {
                setUserFilter((v as string | null) ?? null);
                setSearchNonce((n) => n + 1);
              }}
              onLoadedOptions={setUserOptions}
            />
          </Field>
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
        <Table<WorkHour>
          rowKey="id"
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
          locale={{ emptyText: "暂无工时记录" }}
        />
      )}

      {drawer.open && (
        <WorkHourDrawer
          state={drawer}
          projects={projects}
          currentUserId={currentUser?.id ?? ""}
          onClose={() => setDrawer({ open: false, mode: "create" })}
          onSubmit={handleSave}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-96 rounded-md border bg-background p-5 shadow-lg">
            <h3 className="text-sm font-semibold">确认删除工时记录？</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              将删除 {fmtDay(confirmDelete.work_date)} 的工时记录,该操作不可恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(null)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete()}
              >
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function WorkHourDrawer({
  state,
  projects,
  currentUserId,
  onClose,
  onSubmit,
}: {
  state: DrawerState;
  projects: ProjectSimpleItem[];
  currentUserId: string;
  onClose: () => void;
  onSubmit: (_body: WorkHourCreate | WorkHourUpdate) => Promise<void>;
}) {
  const editing = state.item;
  const [workDate, setWorkDate] = useState(
    editing?.work_date ? editing.work_date.slice(0, 10) : today(),
  );
  const [projectId, setProjectId] = useState(editing?.project_id ?? "");
  const [hours, setHours] = useState(
    editing ? String(editing.hours) : "",
  );
  const [type, setType] = useState(editing?.type ?? 1);
  const [taskId, setTaskId] = useState(editing?.task_id ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [userId, setUserId] = useState(editing?.user_id ?? currentUserId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 任务下拉:type===1 时按当前 projectId 拉取 PlanTask
  const [taskOptions, setTaskOptions] = useState<PlanTask[]>([]);
  useEffect(() => {
    if (type !== 1 || !projectId) {
      setTaskOptions([]);
      return;
    }
    void (async () => {
      try {
        const resp = await listPlanTasks({
          page: 1,
          page_size: 200,
          project_id: projectId,
        });
        setTaskOptions(resp.items ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "加载任务选项失败");
        setTaskOptions([]);
      }
    })();
  }, [type, projectId]);

  const submit = async () => {
    if (!projectId) {
      setErr("请选择项目");
      return;
    }
    if (type === 1 && !taskId) {
      setErr("任务工时需选择任务");
      return;
    }
    const h = Number(hours);
    if (Number.isNaN(h) || h <= 0) {
      setErr("请填写有效的工时数值");
      return;
    }
    if (h < 0.5 || h > 24) {
      setErr("工时数值需在 0.5 ~ 24 之间");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body: WorkHourCreate | WorkHourUpdate = {
        project_id: projectId,
        work_date: workDate,
        hours: h,
        type,
        description: description || null,
        user_id: userId,
      };
      if (type === 1) {
        body.task_id = taskId;
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
      <div className="w-[460px] rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">
          {state.mode === "create" ? "录入工时" : "编辑工时"}
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground">日期 *</label>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">工时(h) *</label>
            <input
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">项目 *</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={`mt-0.5 ${inputCls}`}
            >
              <option value="">请选择</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name ?? p.id}
                </option>
              ))}
            </select>
          </div>
          {type === 1 && (
            <div className="col-span-2">
              <label className="text-[11px] text-muted-foreground">任务 *</label>
              <select
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                className={`mt-0.5 ${inputCls}`}
              >
                <option value="">
                  {projectId ? "请选择任务" : "请先选择项目"}
                </option>
                {taskOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.content ?? t.id}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-[11px] text-muted-foreground">类型</label>
            <select
              value={type}
              onChange={(e) => setType(Number(e.target.value))}
              className={`mt-0.5 ${inputCls}`}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">录入人</label>
            <div className="mt-0.5">
              <PpmUserSelect
                res="user"
                value={userId}
                onChange={(v) => setUserId((v as string | null) ?? "")}
                placeholder="请选择录入人"
              />
            </div>
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">说明</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-0.5 w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm focus:border-ring focus:outline-none"
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
