"use client";

/**
 * 任务计划 · 移动视图（task-09 / FR-05 / D-001 / D-003 / D-007）。
 *
 * 桌面表格改为 MobileCardList 卡片列表（D-007）。
 * 移动端能力范围（用户 2026-07-23 调整）：浏览 + 筛选 + 导出 + 启动/执行/详情 + 编辑。
 * **不做**新建 / 删除（含批量删）——建/删在桌面端完成。
 *
 * 数据层 100% 复用（D-003，禁止自写请求）：
 *  - @/lib/ppm/task：listPlanTasks / listPersonalPlanTasks / updatePlanTask /
 *    startPlanTask / exportPlanTasks
 *  - @/lib/ppm/project：listSimpleProjects（项目下拉）
 *  - @/lib/ppm/format：isOverEstimate（预估·已消耗对比）
 *  - @/stores/session：useSession（id / is_platform_admin 权限同源）
 * 列表固定 order_by=start_time&order=asc（与桌面一致）。
 *
 * 详情/执行复用桌面 _components/task-detail-modal（跨天填报复杂逻辑单一源，只读引用
 * 不改 → 桌面零回归）。编辑用 task-07 MobileDetailSheet 承载表单，必填校验对齐桌面
 * TaskDrawer（源 PlanForm.vue formRules）。
 *
 * 权限：canOperate = 负责人本人 || 平台管理员（启动/执行）；canEdit = 未开始 && 本人。
 *
 * 桌面 `(dashboard)/ppm/task-plans/**` 不改（零回归硬约束）。容器由 app/m/layout 包裹。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DatePicker, Input, Select } from "antd";
import type { Dayjs } from "dayjs";

import { MobileCardList } from "@/components/mobile/mobile-card-list";
import { MobileDetailSheet } from "@/components/mobile/mobile-detail-sheet";
import { MobileExportButton } from "@/components/mobile/mobile-export-button";
import { MobileFilterDrawer } from "@/components/mobile/mobile-filter-drawer";
import { PpmUserSelect, type PpmSelectOption } from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import { isOverEstimate } from "@/lib/ppm/format";
import { listSimpleProjects } from "@/lib/ppm/project";
import {
  exportPlanTasks,
  listPersonalPlanTasks,
  listPlanTasks,
  startPlanTask,
  updatePlanTask,
} from "@/lib/ppm/task";
import type {
  PlanTask,
  PlanTaskPageReq,
  PlanTaskUpdate,
  ProjectSimpleItem,
} from "@/lib/ppm/types";
import { useSession } from "@/stores/session";
import { cn } from "@/lib/utils";
import { TaskDetailModal } from "@/app/(dashboard)/ppm/_components/task-detail-modal";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Toast,
  fmtDay,
  taskStatusTag,
  useToast,
} from "@/app/(dashboard)/ppm/shared";

const { RangePicker } = DatePicker;

type ViewMode = "all" | "personal";

// PlanTask.status 存中文（未开始/进行中/已完成），筛选值用中文以匹配后端 where status.in_(...)。
const STATUS_CODE_OPTIONS = [
  { label: "未开始", value: "未开始" },
  { label: "进行中", value: "进行中" },
  { label: "已完成", value: "已完成" },
];

/** 移动端表单输入样式（触摸 ≥ 44px、正文 ≥ 14px，R-04；不复用桌面 inputCls）。 */
const mobileInputCls =
  "min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-[14px] text-foreground focus:border-ring focus:outline-none";

interface DrawerState {
  open: boolean;
  mode: "edit";
  task: PlanTask;
}

export default function TaskPlansMobilePage() {
  const { user: currentUser } = useSession();
  const { toast, showToast } = useToast();

  const [view, setView] = useState<ViewMode>("all");
  const [rows, setRows] = useState<PlanTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 筛选（全部走服务端 PlanTaskPageReq）
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilterList, setStatusFilterList] = useState<string[]>([
    "未开始",
    "进行中",
  ]);
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<
    [Dayjs | null, Dayjs | null] | null
  >(null);
  const [workPartnerFilter, setWorkPartnerFilter] = useState<string>("");
  // 搜索触发计数器：点「确定」强制触发查询（即使条件未变），与桌面 searchNonce 同语义。
  const [searchNonce, setSearchNonce] = useState(0);

  const [exporting, setExporting] = useState(false);
  const [projects, setProjects] = useState<ProjectSimpleItem[]>([]);

  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [detailTask, setDetailTask] = useState<PlanTask | null>(null);
  const [detailMode, setDetailMode] = useState<"detail" | "execute">("detail");

  useEffect(() => {
    void (async () => {
      try {
        const list = await listSimpleProjects();
        setProjects(list ?? []);
      } catch (e) {
        showToast(false, e instanceof ApiError ? e.message : "加载项目列表失败");
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
    // personal 视图：user_id 由后端从 token 注入，前端不传
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
        const params = buildParams(p, ps, {
          includeUserId: view !== "personal",
        });
        // 列表固定按计划开始时间正序（与桌面一致）
        params.order_by = "start_time";
        params.order = "asc";
        const resp =
          view === "personal"
            ? await listPersonalPlanTasks(params)
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

  // 首屏 + 筛选「确定」→ 回第 1 页重拉。不直接监听 filter state（改条件不自动查询）。
  // 翻页/改 pageSize 走 pagination.onChange / Select 直接调 load，绕过此 effect。
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
      const params = buildParams(1, 1000, {
        includeUserId: view !== "personal",
      });
      await exportPlanTasks(params);
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleSave = async (body: PlanTaskUpdate) => {
    if (!drawer?.task) return;
    try {
      await updatePlanTask(drawer.task.id, body);
      showToast(true, "任务计划已更新");
      setDrawer(null);
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "保存失败");
    }
  };

  const handleStart = async (task: PlanTask) => {
    try {
      await startPlanTask({ plan_task_id: task.id });
      showToast(true, "任务已启动（进行中）");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "启动失败");
    }
  };

  // 卡片动作集（经 MobileActionMenu 底部 ActionSheet 触发）：启动/执行/详情/编辑
  // 用户 2026-07-23 调整：移动端不含删除（建/删在桌面端）
  const buildActions = (t: PlanTask) => {
    const isOwner = currentUser?.id === t.user_id;
    const canOperate = isOwner || !!currentUser?.is_platform_admin;
    const canEdit = t.status === "未开始" && isOwner;
    const acts: {
      key: string;
      label: string;
      danger?: boolean;
      onPress: () => void;
    }[] = [];
    if (t.status === "未开始" && canOperate) {
      acts.push({
        key: "start",
        label: "启动",
        onPress: () => void handleStart(t),
      });
    }
    if (t.status === "进行中" && canOperate) {
      acts.push({
        key: "execute",
        label: "执行",
        onPress: () => {
          setDetailTask(t);
          setDetailMode("execute");
        },
      });
    }
    acts.push({
      key: "detail",
      label: "详情",
      onPress: () => {
        setDetailTask(t);
        setDetailMode("detail");
      },
    });
    if (canEdit) {
      acts.push({
        key: "edit",
        label: "编辑",
        onPress: () => setDrawer({ open: true, mode: "edit", task: t }),
      });
    }
    return acts;
  };

  const renderCard = (t: PlanTask) => {
    const tag = taskStatusTag(t.status);
    const spent = t.spent_time ?? 0;
    const hasSpent = spent > 0;
    const over = isOverEstimate(spent, t.work_load);
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-medium",
              statusPillCls(tag.color),
            )}
          >
            {tag.text}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground"
            title={t.project_name ?? ""}
          >
            {t.project_name ?? "（无项目）"}
          </span>
        </div>
        <div className="line-clamp-2 text-[14px] font-medium text-foreground">
          {t.content ?? "（未填写）"}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
          <span>模块：{t.module_name ?? "—"}</span>
          <span>负责人：{t.user_name ?? "—"}</span>
        </div>
        <div className="text-[12px] text-muted-foreground">
          计划：{t.start_time ? fmtDay(t.start_time) : "—"} ~{" "}
          {t.end_time ? fmtDay(t.end_time) : "—"}
        </div>
        <div className="text-[12px]">
          <span className="text-muted-foreground">预估/已消耗：</span>
          <span>{t.work_load ?? "—"}</span>
          <span className="text-muted-foreground"> / </span>
          {hasSpent ? (
            <span
              className={cn(
                "font-medium",
                over ? "text-red-600" : "text-emerald-600",
              )}
            >
              {spent} 人天
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <header className="px-1 pb-1">
        <h1 className="text-[18px] font-semibold text-foreground">任务计划</h1>
        <p className="text-[12px] text-muted-foreground">
          {loading ? "加载中…" : "任务计划制定 / 执行推进 / 工时预估"}
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-[13px] text-destructive">
          {error}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-2 inline-flex min-h-[44px] items-center rounded-md px-2 text-[14px] font-medium text-blue-600 hover:underline"
          >
            重新加载
          </button>
        </div>
      ) : null}

      <MobileCardList<PlanTask>
        items={rows}
        renderCard={renderCard}
        onItemPress={(t) => {
          setDetailTask(t);
          setDetailMode("detail");
        }}
        actions={buildActions}
        pagination={{
          page,
          pageSize,
          total,
          onChange: (p) => void load({ page: p, page_size: pageSize }),
        }}
        emptyText={loading ? "加载中…" : "暂无任务计划"}
        headerActions={
          <>
            <MobileFilterDrawer
              open={filterOpen}
              onOpenChange={setFilterOpen}
              onApply={commitSearch}
              onReset={resetFilters}
              title="筛选任务计划"
            >
              <FilterFields
                view={view}
                onViewChange={setView}
                statusList={statusFilterList}
                onStatusChange={(v) => setStatusFilterList(v)}
                projectFilter={projectFilter}
                onProjectChange={(v) => setProjectFilter(v ?? "")}
                projects={projects}
                userFilter={userFilter}
                onUserChange={(v) => setUserFilter((v as string | null) ?? null)}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                workPartner={workPartnerFilter}
                onWorkPartnerChange={setWorkPartnerFilter}
              />
            </MobileFilterDrawer>
            <MobileExportButton
              onClick={() => void handleExport()}
              loading={exporting}
            />
            {/* 每页条数（桌面 PAGE_SIZE_OPTIONS）：改 pageSize 回第 1 页重拉 */}
            <Select<number>
              value={pageSize}
              onChange={(v) => void load({ page: 1, page_size: v })}
              options={PAGE_SIZE_OPTIONS.map((n) => ({
                label: `${n} 条/页`,
                value: n,
              }))}
              style={{ width: 116 }}
            />
          </>
        }
      />

      <Toast toast={toast} />

      {drawer?.open ? (
        <TaskFormSheet
          state={drawer}
          projects={projects}
          onClose={() => setDrawer(null)}
          onSave={handleSave}
        />
      ) : null}

      <TaskDetailModal
        task={detailTask}
        mode={detailMode}
        onClose={() => setDetailTask(null)}
        onChanged={() => void load()}
      />
    </div>
  );
}

/* ============================== 筛选抽屉字段 ============================== */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function FilterFields({
  view,
  onViewChange,
  statusList,
  onStatusChange,
  projectFilter,
  onProjectChange,
  projects,
  userFilter,
  onUserChange,
  dateRange,
  onDateRangeChange,
  workPartner,
  onWorkPartnerChange,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  statusList: string[];
  onStatusChange: (v: string[]) => void;
  projectFilter: string;
  onProjectChange: (v: string | undefined) => void;
  projects: ProjectSimpleItem[];
  userFilter: string | null;
  onUserChange: (v: string | string[] | null) => void;
  dateRange: [Dayjs | null, Dayjs | null] | null;
  onDateRangeChange: (v: [Dayjs | null, Dayjs | null] | null) => void;
  workPartner: string;
  onWorkPartnerChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="视图">
        <Select<ViewMode>
          className="w-full"
          value={view}
          onChange={onViewChange}
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
          showSearch
          optionFilterProp="label"
          className="w-full"
          placeholder="状态（可多选）"
          value={statusList}
          onChange={(v) => onStatusChange((v as string[]) ?? [])}
          options={STATUS_CODE_OPTIONS}
        />
      </Field>
      <Field label="项目">
        <Select<string>
          className="w-full"
          placeholder="全部项目"
          allowClear
          showSearch
          optionFilterProp="label"
          value={projectFilter || undefined}
          onChange={onProjectChange}
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
          placeholder="负责人"
          value={userFilter}
          onChange={onUserChange}
        />
      </Field>
      <Field label="计划时间区间">
        <RangePicker
          className="w-full"
          size="middle"
          value={dateRange as [Dayjs, Dayjs] | null}
          onChange={(v) =>
            onDateRangeChange(v as [Dayjs | null, Dayjs | null] | null)
          }
          placeholder={["开始", "结束"]}
        />
      </Field>
      <Field label="配合人员">
        <Input
          allowClear
          className="w-full"
          placeholder="配合人员"
          value={workPartner}
          onChange={(e) => onWorkPartnerChange(e.target.value)}
        />
      </Field>
    </div>
  );
}

/* ============================== 编辑表单（MobileDetailSheet 承载，仅编辑） ============================== */

function TaskFormSheet({
  state,
  projects,
  onClose,
  onSave,
}: {
  state: DrawerState;
  projects: ProjectSimpleItem[];
  onClose: () => void;
  onSave: (_body: PlanTaskUpdate) => Promise<void>;
}) {
  const editing = state.task;
  const [content, setContent] = useState(editing?.content ?? "");
  const [userId, setUserId] = useState(editing?.user_id ?? "");
  const [userName, setUserName] = useState(editing?.user_name ?? "");
  const [projectId, setProjectId] = useState(editing?.project_id ?? "");
  const [projectName, setProjectName] = useState(editing?.project_name ?? "");
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
    // 必填校验（对齐桌面 TaskDrawer / 源 PlanForm.vue formRules）
    const missing: string[] = [];
    if (!content.trim()) missing.push("任务内容");
    if (!userId) missing.push("负责人");
    if (!startTime) missing.push("开始时间");
    if (!endTime) missing.push("结束时间");
    if (!projectName.trim() && !projectId) missing.push("所属项目");
    if (!moduleId.trim()) missing.push("模块");
    if (!workLoad.trim()) missing.push("工作量");
    if (missing.length > 0) {
      setErr(`请填写：${missing.join("、")}`);
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
      await onSave(body);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <MobileDetailSheet
      open
      title="编辑任务计划"
      onClose={onClose}
      onSubmit={() => void submit()}
      loading={busy}
    >
      <div className="flex flex-col gap-3">
        <Field label="任务内容 *">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            className="min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-[14px] text-foreground focus:border-ring focus:outline-none"
          />
        </Field>
        <Field label="负责人 *">
          <PpmUserSelect
            res={projectId ? "projectMember" : "user"}
            searchData={
              projectId ? { pm_project_id: projectId } : undefined
            }
            value={userId}
            onChange={(v) => {
              setUserId((v as string | null) ?? "");
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
        </Field>
        <Field label="所属项目 *">
          <select
            value={projectId}
            onChange={(e) => {
              const v = e.target.value;
              setProjectId(v);
              const hit = projects.find((p) => p.id === v);
              setProjectName(hit?.project_name ?? "");
            }}
            className={mobileInputCls}
          >
            <option value="">无</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_name ?? p.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="模块 *">
          <input
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
            placeholder="模块 ID"
            className={mobileInputCls}
          />
        </Field>
        <Field label="模块名称">
          <input
            value={moduleName}
            onChange={(e) => setModuleName(e.target.value)}
            placeholder="模块名称（可选）"
            className={mobileInputCls}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="开始时间 *">
            <input
              type="date"
              value={startTime ? startTime.slice(0, 10) : ""}
              onChange={(e) => setStartTime(e.target.value)}
              className={mobileInputCls}
            />
          </Field>
          <Field label="结束时间 *">
            <input
              type="date"
              value={endTime ? endTime.slice(0, 10) : ""}
              onChange={(e) => setEndTime(e.target.value)}
              className={mobileInputCls}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="工作量（人天）*">
            <input
              value={workLoad}
              onChange={(e) => setWorkLoad(e.target.value)}
              placeholder="如 8 / 0.5"
              className={mobileInputCls}
            />
          </Field>
          <Field label="加班">
            <input
              value={addWork}
              onChange={(e) => setAddWork(e.target.value)}
              placeholder="加班（可选）"
              className={mobileInputCls}
            />
          </Field>
        </div>
        <Field label="配合人员">
          <input
            value={workPartner}
            onChange={(e) => setWorkPartner(e.target.value)}
            placeholder="配合人员（可选）"
            className={mobileInputCls}
          />
        </Field>
        <Field label="备注">
          <input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className={mobileInputCls}
          />
        </Field>
        {err ? <p className="text-[13px] text-destructive">{err}</p> : null}
      </div>
    </MobileDetailSheet>
  );
}

/* ============================== 状态徽标色（antd Tag color → tailwind） ============================== */

function statusPillCls(color: string): string {
  switch (color) {
    case "processing":
      return "bg-blue-100 text-blue-700";
    case "success":
      return "bg-emerald-100 text-emerald-700";
    case "warning":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}
