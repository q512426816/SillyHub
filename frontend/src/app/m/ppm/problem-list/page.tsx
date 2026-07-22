"use client";

/**
 * 问题清单 · 移动视图（task-10 / FR-06 / D-001 / D-003 / D-007 / D-008）。
 *
 * 桌面 antd Table + grid-cols-4 搜索区 + ProblemDrawer(Modal) 在手机重排为
 * **MobileCardList 卡片流 + MobileFilterDrawer 抽屉筛选 + MobileDetailSheet 表单**，
 * 全功能对齐桌面（新建/编辑/开始/执行/详情/删除/批量删/导出 + 筛选 + 分页）。
 *
 * 数据层 100% 复用 @/lib/ppm（D-003，禁止自写请求）：
 *   listProblems / startProblem / deleteProblem / exportProblems
 *   createProblem / updateProblem / listModulesByProject / addWorkingDaysDate
 * 类型取 @/lib/ppm（ProblemList / ProblemListPageReq / ProblemListCreate / Update）。
 *
 * 渲染层独立（D-001）：卡片 / 筛选 / 新建编辑表单 自绘，不复用桌面
 * (dashboard)/ppm/problem-list/** 组件（桌面零回归硬约束）。仅复用：
 *   - UI 无关文案/色板 @/components/ppm-status-actions（PROBLEM_STATUS_TEXT/COLOR、PROBLEM_TYPE_TEXT、matchAnyUser）
 *   - 通用下拉/上传组件 PpmUserSelect / FileUpload（纯控件，无桌面布局依赖）
 *   - 详情/执行公共弹窗 ProblemDetailModal（跨天填报 handleSubmit 逻辑复杂，
 *     复用避免三处复制漂移；导入不改桌面文件，R-03 最强缓解）
 *   - isOverEstimate @/lib/ppm/format
 *   - useSession @/stores/session（同源当前用户）
 *
 * 新建/编辑表单逻辑逐字对齐桌面 _problem-drawer.tsx + _forms.tsx（注释锚点防漂移，
 * R-03/R-10），仅外壳由桌面 Modal 换成 MobileDetailSheet，字段/校验/联动一致。
 *
 * 触摸热区 ≥ 44×44px、正文 ≥ 14px（R-04）。
 * 容器由 task-05 MobileLayoutShell（app/m/layout.tsx）自动包裹。
 *
 * 设计依据:.sillyspec/changes/2026-07-22-mobile-app-ui/design.md §5.5/FR-06/D-003/D-007/D-008
 *           桌面对照:app/(dashboard)/ppm/problem-list/page.tsx
 */
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef, type ReactNode } from "react";
import {
  DatePicker,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Switch,
  Tag,
} from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";

import { MobileCardList, type MobileAction } from "@/components/mobile/mobile-card-list";
import { MobileFilterDrawer } from "@/components/mobile/mobile-filter-drawer";
import { MobileDetailSheet } from "@/components/mobile/mobile-detail-sheet";
import { MobileBatchBar } from "@/components/mobile/mobile-batch-bar";
import { MobileExportButton } from "@/components/mobile/mobile-export-button";
import { FileUpload } from "@/components/file-upload";
import {
  PpmUserSelect,
  type PpmSelectOption,
} from "@/components/ppm-user-select";
import {
  matchAnyUser,
  PROBLEM_STATUS_COLOR,
  PROBLEM_STATUS_TEXT,
  PROBLEM_TYPE_TEXT,
} from "@/components/ppm-status-actions";
import {
  ProblemDetailModal,
  type ProblemDetailMode,
} from "@/app/(dashboard)/ppm/_components/problem-detail-modal";
import { ApiError } from "@/lib/api";
import { errMessage } from "@/lib/errors";
import { isOverEstimate } from "@/lib/ppm/format";
import { addWorkingDaysDate } from "@/lib/ppm/workday";
import {
  createProblem,
  deleteProblem,
  exportProblems,
  listModulesByProject,
  listProblems,
  startProblem,
  updateProblem,
} from "@/lib/ppm";
import type {
  ModuleSimpleItem,
  ProblemList,
  ProblemListCreate,
  ProblemListUpdate,
} from "@/lib/ppm";
import { useSession } from "@/stores/session";
import { cn } from "@/lib/utils";

const { RangePicker } = DatePicker;
const { TextArea } = Input;

// ── 筛选字典（对齐桌面 page.tsx） ─────────────────────────────────────────

const STATUS_OPTIONS = [
  { label: PROBLEM_STATUS_TEXT["新建"] ?? "新建", value: "新建" },
  { label: PROBLEM_STATUS_TEXT["进行中"] ?? "进行中", value: "进行中" },
  { label: PROBLEM_STATUS_TEXT["已完成"] ?? "已完成", value: "已完成" },
];

const PRO_TYPE_OPTIONS = [
  { label: "全部类型", value: "" },
  { label: PROBLEM_TYPE_TEXT.bug, value: "bug" },
  { label: PROBLEM_TYPE_TEXT.change, value: "change" },
];

const IS_URGENT_OPTIONS = [
  { label: "全部", value: "" },
  { label: "急", value: "1" },
  { label: "否", value: "0" },
];

const VIEW_OPTIONS = [
  { label: "我的", value: "mine" },
  { label: "全部", value: "all" },
];

// ── 表单字典（对齐桌面 _forms.tsx） ───────────────────────────────────────

const FORM_PRO_TYPE_OPTIONS = [
  { label: "系统BUG", value: "bug" },
  { label: "变更", value: "change" },
];

/** 源 ListForm.vue workType options:前端工作/后端工作/业务工作。 */
const WORK_TYPE_OPTIONS = [
  { label: "前端工作", value: "前端" },
  { label: "后端工作", value: "后端" },
  { label: "业务工作", value: "业务" },
];

const WORK_TYPE_LABEL: Record<string, string> = {
  前端: "前端工作",
  后端: "后端工作",
  业务: "业务工作",
};

/** workType value → 角色名（对齐桌面 _forms.tsx workTypeToRoleName）。 */
function workTypeToRoleName(workType: string | null | undefined): string | null {
  if (!workType) return null;
  return workType;
}

/** 表单字符串 → 后端 nullable ISO 串（YYYY-MM-DD）；空串 → null（对齐 _forms.tsx dayStrToApi）。 */
function dayStrToApi(v: string | null | undefined): string | null {
  if (!v) return null;
  return v;
}

export default function ProblemListMobilePage() {
  const { user: currentUser } = useSession();
  const currentUserId = currentUser?.id ?? "";

  // 归属:默认「全部」（对齐桌面 ql-20260722 调整）
  const [view, setView] = useState<"mine" | "all">("all");

  const [items, setItems] = useState<ProblemList[]>([]);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 筛选状态（对齐桌面 page.tsx）。
  // keywordInput 仅受控输入框显示值，输入过程不触发查询；按「确定」同步到 keyword。
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>(["新建", "进行中"]);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [proTypeFilter, setProTypeFilter] = useState<string>("");
  const [isUrgentFilter, setIsUrgentFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  // 搜索触发计数器（对齐桌面 searchNonce）：点「确定」即使 keyword 未变也强制触发查询。
  const [searchNonce, setSearchNonce] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);

  // 新建/编辑 Sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingProblem, setEditingProblem] = useState<ProblemList | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<ProblemFormHandle>(null);

  // 详情/执行公共弹窗（复用桌面 ProblemDetailModal）
  const [modalProblem, setModalProblem] = useState<ProblemList | null>(null);
  const [modalMode, setModalMode] = useState<ProblemDetailMode>("detail");

  // 批量选择
  const [batchMode, setBatchMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const [exporting, setExporting] = useState(false);

  const load = useCallback(
    async (opts: { page?: number; page_size?: number } = {}) => {
      const page = opts.page ?? current;
      const page_size = opts.page_size ?? pageSize;
      setLoading(true);
      setError(null);
      try {
        const resp = await listProblems({
          page,
          page_size,
          keyword: keyword || undefined,
          status: statusFilter.length > 0 ? statusFilter : undefined,
          project_id: projectFilter ?? undefined,
          pro_type: proTypeFilter || undefined,
          is_urgent: isUrgentFilter || undefined,
          find_time_start: dateRange?.[0]?.startOf("day")?.toISOString(),
          find_time_end: dateRange?.[1]?.endOf("day")?.toISOString(),
          duty_user_id: view === "mine" ? currentUserId : undefined,
          // 默认按计划开始时间正序（ql-20260722）；空值排最后
          order_by: "plan_start_time",
          order: "asc",
        });
        setItems(resp.items);
        setTotal(resp.total);
        setCurrent(page);
        setPageSize(page_size);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    },
    [
      current,
      pageSize,
      keyword,
      statusFilter,
      projectFilter,
      proTypeFilter,
      isUrgentFilter,
      dateRange,
      view,
      currentUserId,
    ],
  );

  // 首屏 + 过滤条件变化 + 搜索触发 → 回到第 1 页重拉（对齐桌面 useEffect）。
  useEffect(() => {
    void load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, statusFilter, projectFilter, proTypeFilter, isUrgentFilter, dateRange, searchNonce, view]);

  // ── 筛选操作 ──

  const resetFilters = () => {
    setKeywordInput("");
    setKeyword("");
    setStatusFilter(["新建", "进行中"]);
    setProjectFilter(null);
    setProTypeFilter("");
    setIsUrgentFilter("");
    setDateRange(null);
    setView("all");
  };

  /** 抽屉「确定」：提交关键字 + 触发查询（抽屉内 Select 选中即时生效）。 */
  const applyFilters = () => {
    setKeyword(keywordInput);
    setSearchNonce((n) => n + 1);
  };

  // ── 导出 ──

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportProblems();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  // ── 新建/编辑 ──

  const openCreate = () => {
    setEditingProblem(undefined);
    setSheetOpen(true);
  };

  const openEdit = (p: ProblemList) => {
    setEditingProblem(p);
    setSheetOpen(true);
  };

  const handleSheetSubmit = async () => {
    setSubmitting(true);
    try {
      await formRef.current?.submit();
    } finally {
      setSubmitting(false);
    }
  };

  // ── 详情/执行（复用桌面 ProblemDetailModal） ──

  const openDetail = (p: ProblemList) => {
    setModalProblem(p);
    setModalMode("detail");
  };

  const openExecute = (p: ProblemList) => {
    setModalProblem(p);
    setModalMode("execute");
  };

  // ── 开始：新建 → 进行中（建 in-flight TaskExecute，对齐桌面 handleStart） ──

  const handleStart = async (p: ProblemList) => {
    if (p.status !== "新建") return;
    try {
      await startProblem(p.id);
      await load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "开始失败");
    }
  };

  // ── 删除：任意状态（本人/管理员，对齐桌面 handleDelete） ──

  const handleDelete = (p: ProblemList) => {
    Modal.confirm({
      title: "删除该问题清单?",
      content: "该操作不可恢复。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      maskClosable: false,
      onOk: async () => {
        try {
          await deleteProblem(p.id);
          await load();
        } catch (err) {
          message.error(err instanceof ApiError ? err.message : "删除失败");
        }
      },
    });
  };

  // ── 批量 ──

  const enterBatch = () => {
    setBatchMode(true);
    setSelectedKeys([]);
  };
  const exitBatch = () => {
    setBatchMode(false);
    setSelectedKeys([]);
  };

  /** 批量删除：仅删 can_delete 为真的条目（D-008 按 can_delete）。 */
  const handleBatchDelete = () => {
    const targets = items.filter(
      (p) => selectedKeys.includes(p.id) && (p.can_delete ?? false),
    );
    if (targets.length === 0) {
      message.info("没有可删除的项（需有删除权限）");
      return;
    }
    Modal.confirm({
      title: `批量删除 ${targets.length} 项?`,
      content: `选中共 ${selectedKeys.length} 项，其中 ${targets.length} 项有删除权限。该操作不可恢复。`,
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      maskClosable: false,
      onOk: async () => {
        let failed = 0;
        for (const p of targets) {
          try {
            await deleteProblem(p.id);
          } catch {
            failed += 1;
          }
        }
        if (failed > 0) {
          message.warning(`已删除 ${targets.length - failed} 项，${failed} 项失败`);
        } else {
          message.success(`已删除 ${targets.length} 项`);
        }
        exitBatch();
        await load();
      },
    });
  };

  // ── 权限计算 + 动作集（对齐桌面 columns.actions） ──

  const buildActions = useCallback(
    (p: ProblemList): MobileAction[] => {
      const isDuty = matchAnyUser([p.duty_user_id], currentUserId);
      // 开始/执行：责任人 ‖ 超管
      const canOperate = isDuty || !!currentUser?.is_platform_admin;
      // 编辑/删除：后端集中判断，前端只读 can_edit/can_delete
      const canEdit = p.can_edit ?? false;
      const canDelete = p.can_delete ?? false;
      const actions: MobileAction[] = [];
      // 编辑：新建 / 进行中（D-003 进行中保留编辑入口，与执行分离）
      if ((p.status === "新建" || p.status === "进行中") && canEdit) {
        actions.push({ key: "edit", label: "编辑", onPress: () => openEdit(p) });
      }
      // 开始：新建 → 进行中
      if (p.status === "新建" && canOperate) {
        actions.push({ key: "start", label: "开始", onPress: () => void handleStart(p) });
      }
      // 执行：进行中 → 跨天填报
      if (p.status === "进行中" && canOperate) {
        actions.push({ key: "execute", label: "执行", onPress: () => openExecute(p) });
      }
      // 详情：任意状态
      actions.push({ key: "detail", label: "详情", onPress: () => openDetail(p) });
      // 删除：任意状态（后端 can_delete 判断）
      if (canDelete) {
        actions.push({
          key: "delete",
          label: "删除",
          danger: true,
          onPress: () => handleDelete(p),
        });
      }
      return actions;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId, currentUser?.is_platform_admin],
  );

  return (
    <div className="flex flex-col gap-3">
      <header className="px-1 pb-1">
        <h1 className="text-[18px] font-semibold text-foreground">问题清单</h1>
        <p className="text-[12px] text-muted-foreground">
          新建 → 开始 → 执行(可重复) → 完成
        </p>
      </header>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-destructive/30 bg-red-50 px-3 py-2 text-[13px] text-destructive">
          {error}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-3 inline-flex min-h-[44px] items-center rounded-[var(--radius-sm)] px-2 text-[14px] font-medium text-blue-600 hover:underline"
          >
            重新加载
          </button>
        </div>
      ) : null}

      <MobileCardList<ProblemList>
        items={items}
        itemKey={(p) => p.id}
        emptyText={loading ? "加载中…" : "暂无问题"}
        selectable={batchMode}
        selectedKeys={selectedKeys}
        onSelectedKeysChange={setSelectedKeys}
        onItemPress={(p) => openDetail(p)}
        actions={buildActions}
        pagination={{
          page: current,
          pageSize,
          total,
          onChange: (p) => void load({ page: p }),
        }}
        headerActions={
          <>
            <button
              type="button"
              data-testid="mobile-problem-create"
              onClick={openCreate}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] bg-primary px-3 text-[14px] font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              + 新建
            </button>
            <MobileExportButton loading={exporting} onClick={() => void handleExport()} />
            <button
              type="button"
              onClick={batchMode ? exitBatch : enterBatch}
              className={cn(
                "inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] border px-3 text-[14px] transition-colors",
                batchMode
                  ? "border-destructive/40 bg-red-50 text-destructive"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {batchMode ? "取消批量" : "批量"}
            </button>
            <MobileFilterDrawer
              open={filterOpen}
              onOpenChange={setFilterOpen}
              onApply={applyFilters}
              onReset={resetFilters}
              title="筛选问题"
              triggerLabel="筛选"
            >
              <div className="flex flex-col gap-4">
                <FilterField label="归属">
                  <Select
                    value={view}
                    onChange={(v) => setView(v as "mine" | "all")}
                    options={VIEW_OPTIONS}
                    style={{ width: "100%" }}
                  />
                </FilterField>

                <FilterField label="关键字">
                  <Input
                    allowClear
                    placeholder="项目/模块/描述/功能/责任人/发现人"
                    value={keywordInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      setKeywordInput(v);
                      // allowClear 点 x 清空时立即同步（显式清空 ≠ 输入过程）
                      if (!v) {
                        setKeyword("");
                        setSearchNonce((n) => n + 1);
                      }
                    }}
                    onPressEnter={applyFilters}
                  />
                </FilterField>

                <FilterField label="状态（可多选）">
                  <Select<string[]>
                    mode="multiple"
                    allowClear
                    className="w-full"
                    placeholder="状态"
                    value={statusFilter}
                    onChange={(v) => {
                      setStatusFilter(v as string[]);
                      setSearchNonce((n) => n + 1);
                    }}
                    options={STATUS_OPTIONS}
                  />
                </FilterField>

                <FilterField label="项目">
                  <PpmUserSelect
                    res="project"
                    allowClear
                    style={{ width: "100%" }}
                    placeholder="选择项目"
                    value={projectFilter}
                    onChange={(v) => {
                      setProjectFilter((v as string | null) ?? null);
                      setSearchNonce((n) => n + 1);
                    }}
                  />
                </FilterField>

                <FilterField label="问题类型">
                  <Select<string>
                    className="w-full"
                    placeholder="全部类型"
                    value={proTypeFilter || undefined}
                    onChange={(v) => {
                      setProTypeFilter(v ?? "");
                      setSearchNonce((n) => n + 1);
                    }}
                    options={PRO_TYPE_OPTIONS}
                  />
                </FilterField>

                <FilterField label="是否紧急">
                  <Select<string>
                    className="w-full"
                    placeholder="全部"
                    value={isUrgentFilter || undefined}
                    onChange={(v) => {
                      setIsUrgentFilter(v ?? "");
                      setSearchNonce((n) => n + 1);
                    }}
                    options={IS_URGENT_OPTIONS}
                  />
                </FilterField>

                <FilterField label="发现时间">
                  <RangePicker
                    className="w-full"
                    value={dateRange as [Dayjs, Dayjs] | null}
                    onChange={(v) => setDateRange(v as [Dayjs | null, Dayjs | null] | null)}
                    placeholder={["发现开始", "发现结束"]}
                  />
                </FilterField>
              </div>
            </MobileFilterDrawer>
          </>
        }
        renderCard={(p) => <ProblemCard problem={p} />}
      />

      {/* 批量栏：批量模式下固定底部，视觉替代 TabBar（z-50 盖 z-40） */}
      {batchMode ? (
        <MobileBatchBar
          selectedCount={selectedKeys.length}
          onDelete={handleBatchDelete}
          deleteLabel="删除"
        />
      ) : null}

      {/* 新建/编辑 Sheet（对齐桌面 ProblemDrawer，外壳换 MobileDetailSheet） */}
      <MobileDetailSheet
        open={sheetOpen}
        title={editingProblem ? "编辑问题" : "新建问题"}
        onClose={() => setSheetOpen(false)}
        onSubmit={() => void handleSheetSubmit()}
        loading={submitting}
      >
        <ProblemForm
          ref={formRef}
          problem={editingProblem}
          onSuccess={() => {
            setSheetOpen(false);
            void load();
          }}
        />
      </MobileDetailSheet>

      {/* 详情/执行公共弹窗（复用桌面 ProblemDetailModal，跨天填报逻辑不复制） */}
      <ProblemDetailModal
        problem={modalProblem}
        mode={modalMode}
        onClose={() => setModalProblem(null)}
        onChanged={() => void load()}
      />
    </div>
  );
}

/* ============================== 筛选项外壳 ============================== */

/** 筛选项外壳：标题在上、控件在下（对齐桌面 Field）。 */
function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-[13px] leading-4 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/* ============================== 问题卡片 ============================== */

/**
 * 问题卡片主体（替代表格一行）。
 *
 * 字段对齐桌面列：项目/模块/类型/描述/责任人&处置人/紧急/预估·已消耗/计划起止/状态。
 * bug / 紧急标红与桌面一致（antd Tag color="red"）；已消耗超预估标红（text-destructive）。
 */
function ProblemCard({ problem: p }: { problem: ProblemList }) {
  const isUrgent = p.is_urgent === "1" || p.is_urgent === "是";
  const spent = p.spent_time;
  const showSpent = spent != null && spent > 0;
  const over = showSpent && isOverEstimate(spent, p.work_load);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* 行 1：项目 + 状态 */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground"
          title={p.project_name ?? p.project_id}
        >
          {p.project_name ?? p.project_id ?? "—"}
        </span>
        <Tag color={PROBLEM_STATUS_COLOR[p.status] ?? "default"} className="shrink-0">
          {PROBLEM_STATUS_TEXT[p.status] ?? p.status}
        </Tag>
      </div>

      {/* 行 2：类型 / 紧急 / 模块 标签（bug 与紧急标红，对齐桌面） */}
      <div className="flex flex-wrap items-center gap-1.5">
        {p.pro_type ? (
          <Tag color={p.pro_type === "bug" ? "red" : "default"} className="shrink-0">
            {PROBLEM_TYPE_TEXT[p.pro_type] ?? p.pro_type}
          </Tag>
        ) : null}
        {isUrgent ? (
          <Tag color="red" className="shrink-0">急</Tag>
        ) : null}
        {p.model_name ? (
          <span
            className="truncate rounded bg-muted/60 px-1.5 py-0.5 text-[12px] text-muted-foreground"
            title={p.model_name}
          >
            {p.model_name}
          </span>
        ) : null}
      </div>

      {/* 行 3：问题描述（主信息） */}
      <div className="text-[14px] text-foreground">{p.pro_desc ?? "—"}</div>

      {/* 行 4：责任人 & 处置人 */}
      <div className="text-[13px] text-muted-foreground">
        <DutyHandleText problem={p} />
      </div>

      {/* 行 5：预估 / 已消耗（超预算标红） + 计划起止 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="text-muted-foreground">
          预估
          <span className="ml-1 text-foreground">{p.work_load ?? "—"}</span>
          <span className="mx-1 text-muted-foreground/70">/</span>
          已消耗
          {showSpent ? (
            <span className={cn("ml-1 font-medium", over ? "text-destructive" : "text-success")}>
              {spent}
            </span>
          ) : (
            <span className="ml-1 text-muted-foreground">—</span>
          )}
        </span>
        <span className="text-muted-foreground">
          计划
          <span className="ml-1 text-foreground tabular-nums">
            {p.plan_start_time?.slice(0, 10) ?? "?"} ~ {p.plan_end_time?.slice(0, 10) ?? "?"}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * 责任人 & 处置人 合并显示（对齐桌面 renderDutyHandle）：
 *  - 处置人为空        → 只显示责任人
 *  - 责任人 == 处置人  → 只显示一个
 *  - 两者不一致        → 显示「责任人 & 处置人」
 */
function DutyHandleText({ problem: p }: { problem: ProblemList }) {
  const duty = p.duty_user_name ?? (p.duty_user_id ? p.duty_user_id : "待指派");
  const handle = p.now_handle_user_name ?? (p.now_handle_user ? p.now_handle_user : null);
  const same =
    handle != null &&
    (p.now_handle_user === p.duty_user_id ||
      (!!p.now_handle_user_name && p.now_handle_user_name === p.duty_user_name));
  if (!handle || same) {
    return <span>责任人：{duty}</span>;
  }
  return (
    <span>
      责任人：{duty}
      <span className="mx-1 text-muted-foreground/70">&amp;</span>
      处置人：{handle}
    </span>
  );
}

/* ============================== 新建/编辑表单 ============================== */

/** 表单值类型（对齐桌面 _forms.tsx ProblemCreateValues）。 */
interface ProblemCreateValues {
  project_id?: string;
  module_id?: string;
  model_name?: string;
  func_name?: string;
  pro_desc?: string;
  pro_answer?: string;
  pro_type?: string;
  is_urgent?: boolean;
  find_by?: string;
  find_time?: Dayjs;
  work_type?: string;
  duty_user_id?: string;
  now_handle_user?: string;
  work_load?: string;
  plan_start_time?: Dayjs;
  plan_end_time?: Dayjs;
  audit_user_id?: string;
  remarks?: string;
}

/** ProblemForm 对外暴露的命令式句柄（供 MobileDetailSheet 顶栏「保存」触发）。 */
export interface ProblemFormHandle {
  submit: () => Promise<void>;
}

interface ProblemFormProps {
  /** undefined=新建，否则编辑（新建/进行中态均可编辑，D-003）。 */
  problem?: ProblemList;
  /** 提交成功回调（外层关闭 Sheet + 刷新列表）。 */
  onSuccess: () => void;
}

/**
 * 问题清单 新建/编辑 表单（对齐桌面 _forms.tsx ProblemCreateForm）。
 *
 * 逻辑逐字复刻桌面（initialValues / onValuesChange 联动 / 模块级联 / 责任人工作类型联动 /
 * 处置人姓名回填 / 工作日自动推算计划完成 / submit payload），注释锚点防漂移（R-03/R-10）。
 *
 * 差异：外壳由桌面 antd Modal 换成 MobileDetailSheet（由父层提供，顶栏「保存」经
 * useImperativeHandle 调本组件 submit）；表单本身无底部按钮区。
 */
export const ProblemForm = forwardRef<ProblemFormHandle, ProblemFormProps>(
  function ProblemForm({ problem, onSuccess }, ref) {
    const isEdit = !!problem;
    const [form] = Form.useForm<ProblemCreateValues>();
    // dutyUser 联动 searchData 依赖 projectId + workType（对齐桌面）
    const [projectId, setProjectId] = useState<string | undefined>(problem?.project_id);
    const [workType, setWorkType] = useState<string | undefined>(
      problem?.work_type ?? undefined,
    );
    const [fileUrls, setFileUrls] = useState<string[]>(problem?.file_urls ?? []);
    const [planEndTouched, setPlanEndTouched] = useState(false);
    // 处置人下拉选项缓存：提交时按选中 id 反查 user_name 一并回传（对齐桌面）
    const [handleOptions, setHandleOptions] = useState<PpmSelectOption[]>([]);
    // 关联模块下拉：按当前项目反查（对齐桌面）
    const [modules, setModules] = useState<ModuleSimpleItem[]>([]);

    // 模块级联：projectId 变化 → listModulesByProject（对齐桌面 useEffect）
    useEffect(() => {
      if (!projectId) {
        setModules([]);
        return;
      }
      let cancelled = false;
      listModulesByProject(projectId)
        .then((list) => {
          if (!cancelled) setModules(list);
        })
        .catch(() => {
          if (!cancelled) setModules([]);
        });
      return () => {
        cancelled = true;
      };
    }, [projectId]);

    // 初始值（对齐桌面 initialValues，逐字段复刻）
    const initialValues = useMemo<ProblemCreateValues>(
      () => ({
        project_id: problem?.project_id,
        module_id: problem?.module_id ?? undefined,
        model_name: problem?.model_name ?? undefined,
        func_name: problem?.func_name ?? undefined,
        pro_desc: problem?.pro_desc ?? undefined,
        pro_answer: problem?.pro_answer ?? undefined,
        pro_type: problem?.pro_type ?? "bug",
        is_urgent: problem?.is_urgent === "1" || problem?.is_urgent === "是",
        find_by: problem?.find_by ?? undefined,
        find_time:
          problem?.find_time != null && problem.find_time !== ""
            ? (dayjs(problem.find_time) as Dayjs | undefined)
            : (dayjs() as Dayjs),
        work_type: (problem?.work_type ?? undefined) as
          | (typeof WORK_TYPE_OPTIONS)[number]["value"]
          | undefined,
        duty_user_id: problem?.duty_user_id ?? undefined,
        now_handle_user: problem?.now_handle_user ?? undefined,
        work_load: problem?.work_load ?? undefined,
        plan_start_time:
          problem?.plan_start_time != null && problem.plan_start_time !== ""
            ? dayjs(problem.plan_start_time)
            : undefined,
        plan_end_time:
          problem?.plan_end_time != null && problem.plan_end_time !== ""
            ? dayjs(problem.plan_end_time)
            : undefined,
        audit_user_id: problem?.audit_user_id ?? undefined,
        remarks: problem?.remarks ?? undefined,
      }),
      [problem],
    );

    // 工作日联动：plan_start_time + work_load → plan_end_time（对齐桌面 useEffect）
    const planStart = Form.useWatch("plan_start_time", form);
    const workLoad = Form.useWatch("work_load", form);
    useEffect(() => {
      if (planEndTouched) return;
      const days = Number(workLoad ?? 0);
      if (!planStart || !Number.isFinite(days) || days <= 0) return;
      try {
        const computed = dayjs(addWorkingDaysDate(planStart.toISOString(), days));
        if (computed.isValid()) {
          form.setFieldValue("plan_end_time", computed);
        }
      } catch {
        // ignore
      }
    }, [planStart, workLoad, planEndTouched, form]);

    // 处置人下拉：编辑时当前处置人可能不在项目成员列表，补一条保证回填姓名（对齐桌面 mergedHandleOptions）
    const mergedHandleOptions = useMemo<PpmSelectOption[]>(() => {
      if (problem?.now_handle_user && problem?.now_handle_user_name) {
        const exists = handleOptions.some((o) => o.value === problem.now_handle_user);
        if (!exists) {
          return [
            ...handleOptions,
            { value: problem.now_handle_user, label: problem.now_handle_user_name },
          ];
        }
      }
      return handleOptions;
    }, [handleOptions, problem?.now_handle_user, problem?.now_handle_user_name]);

    const dutySearchData = useMemo(
      () => ({
        pm_project_id: projectId ?? null,
        role_name: workTypeToRoleName(workType),
      }),
      [projectId, workType],
    );

    // 校验失败抛出（由外层 MobileDetailSheet onSubmit 的 finally 复位 loading）；
    // API 错误 message.error 提示。成功 → onSuccess（外层关 Sheet + 刷新）。
    const submit = useCallback(async () => {
      const v = await form.validateFields();
      const payload: ProblemListCreate = {
        project_id: (v.project_id ?? "").trim(),
        project_name: problem?.project_name ?? null,
        module_id: v.module_id ?? null,
        model_name: v.model_name ?? null,
        func_name: v.func_name ?? null,
        pro_desc: v.pro_desc ?? null,
        pro_answer: v.pro_answer ?? null,
        file_urls: fileUrls,
        pro_type: v.pro_type ?? "bug",
        is_urgent: v.is_urgent ? "1" : "0",
        find_by: v.find_by ?? null,
        find_time: v.find_time ? dayStrToApi(v.find_time.format("YYYY-MM-DD")) : null,
        work_type: v.work_type ?? null,
        duty_user_id: v.duty_user_id ?? null,
        duty_user_name: null,
        plan_start_time: v.plan_start_time
          ? dayStrToApi(v.plan_start_time.format("YYYY-MM-DD"))
          : null,
        plan_end_time: v.plan_end_time
          ? dayStrToApi(v.plan_end_time.format("YYYY-MM-DD"))
          : null,
        audit_user_id: v.audit_user_id ?? null,
        remarks: v.remarks ?? null,
        work_load: v.work_load != null ? String(v.work_load) : null,
      };
      if (isEdit && problem) {
        const upd: ProblemListUpdate = {
          project_name: payload.project_name,
          module_id: payload.module_id,
          model_name: payload.model_name,
          func_name: payload.func_name,
          pro_desc: payload.pro_desc,
          pro_answer: payload.pro_answer,
          file_urls: payload.file_urls,
          pro_type: payload.pro_type,
          is_urgent: payload.is_urgent,
          find_by: payload.find_by,
          find_time: payload.find_time,
          work_type: payload.work_type,
          duty_user_id: payload.duty_user_id,
          now_handle_user: v.now_handle_user ?? null,
          now_handle_user_name:
            handleOptions.find((o) => o.value === v.now_handle_user)?.label ?? null,
          plan_start_time: payload.plan_start_time,
          plan_end_time: payload.plan_end_time,
          audit_user_id: payload.audit_user_id,
          remarks: payload.remarks,
          work_load: payload.work_load,
        };
        await updateProblem(problem.id, upd);
        message.success("已保存");
      } else {
        await createProblem(payload);
        message.success("已创建");
      }
      onSuccess();
    }, [form, fileUrls, isEdit, problem, handleOptions, onSuccess]);

    useImperativeHandle(ref, () => ({ submit }), [submit]);

    return (
      <Form<ProblemCreateValues>
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={(changed) => {
          if ("project_id" in changed) {
            setProjectId(changed.project_id ?? undefined);
            // 切换项目清空关联模块（对齐桌面）
            form.setFieldValue("module_id", undefined);
          }
          if ("work_type" in changed) {
            setWorkType(changed.work_type as string | undefined);
            // 切换工作类型清空责任人（对齐桌面）
            form.setFieldValue("duty_user_id", undefined);
          }
        }}
      >
        <Form.Item
          label="项目"
          name="project_id"
          rules={[{ required: true, message: "项目必填" }]}
        >
          <PpmUserSelect
            res="project"
            placeholder="请选择项目"
            onChange={(v) => setProjectId((v as string | null) ?? undefined)}
          />
        </Form.Item>

        <Form.Item label="关联模块" name="module_id">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            disabled={!projectId}
            placeholder={projectId ? "请选择模块(可选)" : "请先选择项目"}
            notFoundContent={projectId ? "该项目暂无模块" : "请先选择项目"}
            options={modules.map((m) => ({ value: m.id, label: m.module_name ?? m.id }))}
          />
        </Form.Item>

        <Form.Item label="模块名称" name="model_name">
          <Input placeholder="请输入模块名称" />
        </Form.Item>

        <Form.Item
          label="问题描述"
          name="pro_desc"
          rules={[{ required: true, message: "问题描述必填" }]}
        >
          <Input placeholder="请输入问题描述" />
        </Form.Item>

        <Form.Item label="问题答复/问题解答" name="pro_answer">
          <TextArea rows={2} placeholder="请输入问题解答(问题详细描述)" />
        </Form.Item>

        <Form.Item label="问题附件">
          <FileUpload
            value={fileUrls}
            onChange={setFileUrls}
            owner_type="ppm_problem"
            owner_id={problem?.id ?? null}
          />
        </Form.Item>

        <Form.Item
          label="功能名称"
          name="func_name"
          rules={[{ required: true, message: "功能名称必填" }]}
        >
          <Input placeholder="请输入功能名称" />
        </Form.Item>

        <Form.Item
          label="问题类型"
          name="pro_type"
          rules={[{ required: true, message: "问题类型必填" }]}
        >
          <Select options={FORM_PRO_TYPE_OPTIONS} placeholder="请选择问题类型" />
        </Form.Item>

        <Form.Item label="是否紧急" name="is_urgent" valuePropName="checked">
          <Switch checkedChildren="是" unCheckedChildren="否" />
        </Form.Item>

        <Form.Item
          label="发现人/提出人"
          name="find_by"
          rules={[{ required: true, message: "发现人/提出人必填" }]}
        >
          <Input placeholder="请输入发现人/提出人" />
        </Form.Item>

        <Form.Item
          label="发现日期"
          name="find_time"
          rules={[{ required: true, message: "发现日期必填" }]}
        >
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item
          label="工作类型"
          name="work_type"
          rules={[{ required: true, message: "工作类型必填" }]}
        >
          <Select options={WORK_TYPE_OPTIONS} placeholder="请选择工作类型" />
        </Form.Item>

        <Form.Item
          label="责任人"
          name="duty_user_id"
          rules={[{ required: true, message: "责任人必填" }]}
        >
          <PpmUserSelect
            res="projectMember"
            searchData={dutySearchData}
            placeholder={
              projectId && workType
                ? `请选择 ${WORK_TYPE_LABEL[workType] ?? workType} 人员`
                : "请先选择项目与工作类型"
            }
          />
        </Form.Item>

        {/* 处置人：编辑模式可调整，新建模式不展示（处置人由流程自动推进） */}
        {isEdit && (
          <Form.Item label="处置人" name="now_handle_user">
            <PpmUserSelect
              res="projectMember"
              searchData={{ pm_project_id: projectId ?? null }}
              placeholder="请选择处置人（可选）"
              onLoadedOptions={setHandleOptions}
              extraOptions={mergedHandleOptions}
            />
          </Form.Item>
        )}

        <Form.Item
          label="预计工作量"
          name="work_load"
          rules={[{ required: true, message: "工作量必填" }]}
        >
          <InputNumber
            placeholder="请输入工作量"
            precision={1}
            step={0.5}
            min={0}
            addonAfter="人/天"
            style={{ width: "100%" }}
          />
        </Form.Item>

        <Form.Item
          label="计划开始时间"
          name="plan_start_time"
          rules={[{ required: true, message: "计划开始时间必填" }]}
        >
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item
          label="计划完成时间"
          name="plan_end_time"
          rules={[{ required: true, message: "计划完成时间必填" }]}
        >
          <DatePicker
            style={{ width: "100%" }}
            onChange={() => setPlanEndTouched(true)}
          />
        </Form.Item>

        <Form.Item label="验证人" name="audit_user_id">
          <PpmUserSelect
            res="projectMember"
            searchData={{ pm_project_id: projectId ?? null }}
            placeholder="请选择验证人(可选)"
          />
        </Form.Item>

        <Form.Item label="备注" name="remarks">
          <TextArea rows={2} placeholder="请输入备注" />
        </Form.Item>
      </Form>
    );
  },
);

ProblemForm.displayName = "ProblemForm";
