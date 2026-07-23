"use client";

/**
 * 任务计划页面 (task-12 / FR-05) — 对齐 project-plans 风格。
 *
 * 功能:
 *  - 列表分页 (task-plan/page),视图/状态/项目/负责人/时间区间/配合人员服务端过滤。
 *  - 视图切换 (personal-task-plan/page 我的任务 / task-plan/page 全部任务)。
 *  - 编辑任务计划。
 *  - 执行任务 (task-plan/execute) — 联动生成/推进 TaskExecute。
 *  - 导出 Excel (后端生成 `任务计划_YYYYMMDD_HHMMSS.xlsx`)。
 *  - 列表固定按计划开始时间正序 (order_by=start_time asc)。
 *
 * 依赖:lib/ppm/task (API) + lib/ppm/project (项目下拉) + stores/session。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Button,
  DatePicker,
  Input,
  Select,
  Table,
  type TableProps,
  Tag,
} from "antd";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import {
  PpmUserSelect,
  type PpmSelectOption,
} from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import { useNotify } from "@/lib/errors";
import { isOverEstimate } from "@/lib/ppm/format";
import {
  exportPlanTasks,
  listPersonalPlanTasks,
  listPlanTasks,
  startPlanTask,
  updatePlanTask,
} from "@/lib/ppm/task";
import { listSimpleProjects } from "@/lib/ppm/project";
import type {
  PlanTask,
  PlanTaskPageReq,
  PlanTaskUpdate,
  ProjectSimpleItem,
} from "@/lib/ppm/types";
import { useSession } from "@/stores/session";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  fmtDay,
  inputCls,
  taskStatusTag,
} from "../shared";
import { TaskDetailModal } from "../_components/task-detail-modal";

import type { Dayjs } from "dayjs";

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
  mode: "edit";
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
  const notify = useNotify();

  const [view, setView] = useState<ViewMode>("all");
  const [rows, setRows] = useState<PlanTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 筛选(全部走服务端 PlanTaskPageReq)
  const [statusFilterList, setStatusFilterList] = useState<string[]>(["未开始", "进行中"]);
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
    mode: "edit",
  });
  const [detailTask, setDetailTask] = useState<PlanTask | null>(null);
  const [detailMode, setDetailMode] = useState<"detail" | "execute">("detail");
  const [executeBusy, setExecuteBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listSimpleProjects();
        setProjects(list ?? []);
      } catch (e) {
        notify.error(e, "加载项目列表失败");
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
        // 列表固定按计划开始时间正序
        (params as PlanTaskPageReq).order_by = "start_time";
        (params as PlanTaskPageReq).order = "asc";
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
      notify.error(err, "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleSave = async (body: PlanTaskUpdate) => {
    if (drawer.task) {
      await updatePlanTask(drawer.task.id, body);
      notify.success("任务计划已更新");
    }
    setDrawer({ open: false, mode: "edit" });
    await load();
  };

  const handleStart = async (task: PlanTask) => {
    setExecuteBusy(true);
    try {
      await startPlanTask({ plan_task_id: task.id });
      notify.success("任务已启动(进行中)");
      await load();
    } catch (err) {
      notify.error(err, "启动失败");
    } finally {
      setExecuteBusy(false);
    }
  };

  const columns: TableProps<PlanTask>["columns"] = [
    {
      title: "序号",
      key: "rowno",
      width: 60,
      align: "center",
      render: (_v, _t: PlanTask, idx: number) => idx + 1,
    },
    {
      title: "项目",
      dataIndex: "project_name",
      key: "project_name",
      width: 150,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "模块",
      dataIndex: "module_name",
      key: "module_name",
      width: 130,
      ellipsis: true,
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
      title: "负责人",
      dataIndex: "user_name",
      key: "user_name",
      width: 100,
      render: (v: string | null) => v ?? "—",
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
      title: "预估/已消耗(人天)",
      key: "estimate_spent",
      width: 150,
      render: (_v, t: PlanTask) => {
        const spent = t.spent_time ?? 0;
        const hasSpent = spent > 0;
        const over = isOverEstimate(spent, t.work_load);
        return (
          <span className="text-xs">
            <span>{t.work_load ?? "—"}</span>
            <span className="text-muted-foreground"> / </span>
            {hasSpent ? (
              <span
                className={
                  over
                    ? "font-medium text-red-600"
                    : "font-medium text-emerald-600"
                }
              >
                {spent}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        );
      },
    },
    {
      title: "任务内容",
      dataIndex: "content",
      key: "content",
      width: 240,
      ellipsis: true,
      render: (v: string | null) => (
        <span className="block truncate text-sm" title={v ?? ""}>
          {v ?? "（未填写）"}
        </span>
      ),
    },
    {
      title: "任务描述",
      dataIndex: "task_description",
      key: "task_description",
      width: 220,
      ellipsis: true,
      render: (v: string | null) => (
        <span
          className="block truncate text-xs text-muted-foreground"
          title={v ?? ""}
        >
          {v ?? "—"}
        </span>
      ),
    },
    {
      title: "配合人员",
      dataIndex: "work_partner",
      key: "work_partner",
      width: 120,
      ellipsis: true,
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
        // 处置操作(启动/执行): 仅管理员 + 本人
        const canOperate = isOwner || !!currentUser?.is_platform_admin;
        // 编辑:status="未开始"(PlanTask 中文初始态) + user_id 归属
        const canEdit = t.status === "未开始" && isOwner;
        return (
          <div className="flex whitespace-nowrap gap-1 justify-center">
            {t.status === "未开始" && canOperate && (
              <Button size="small" type="link" onClick={() => void handleStart(t)}>
                启动
              </Button>
            )}
            {t.status === "进行中" && canOperate && (
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setDetailTask(t);
                  setDetailMode("execute");
                }}
              >
                执行
              </Button>
            )}
            <Button
              size="small"
              type="link"
              onClick={() => {
                setDetailTask(t);
                setDetailMode("detail");
              }}
            >
              详情
            </Button>
            {canEdit && (
              <Button
                size="small"
                type="link"
                onClick={() =>
                  setDrawer({ open: true, mode: "edit", task: t })
                }
              >
                编辑
              </Button>
            )}
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

      <SectionCard bodyPadding="p-2">
        {/* 顶部按钮行(D-006):数据组(导出)左 | 基础组(搜索/重置/展开)最右 */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? "导出中…" : "导出"}
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button type="primary" onClick={commitSearch}>
            搜索
          </Button>
          <Button onClick={resetFilters}>
            重置
          </Button>
          <Button
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : "展开"}
          </Button>
        </div>

        {/* 查询条件:垂直 grid-cols-4(视图固定在首列,展开区外) */}
        <div className="grid w-full grid-cols-4 gap-3">
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
            </>
          )}
        </div>
      </SectionCard>

      {error ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
          <Button
            className="ml-3"
            onClick={() => void load()}
          >
            重新加载
          </Button>
        </div>
      ) : (
        <Table<PlanTask>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="small"
          bordered
          tableLayout="fixed"
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
          onClose={() => setDrawer({ open: false, mode: "edit" })}
          onSubmit={handleSave}
        />
      )}

      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          mode={detailMode}
          onClose={() => setDetailTask(null)}
          onChanged={() => void load()}
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
  onSubmit: (_body: PlanTaskUpdate) => Promise<void>;
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
      const body: PlanTaskUpdate = {
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
        <h3 className="text-sm font-semibold">编辑任务计划</h3>
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
          <Button onClick={onClose}>
            取消
          </Button>
          <Button type="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
