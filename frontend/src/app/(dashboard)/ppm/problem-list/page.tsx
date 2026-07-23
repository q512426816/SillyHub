"use client";

/**
 * 问题清单 (ProblemList) 列表页 — 3 态执行模式, 对齐任务计划 (2026-07-20)。
 *
 * 状态机简化为 3 态 (新建/进行中/已完成), 删除审批/验证/驳回流:
 *  - 新建   : 编辑 / 开始 (start → 进行中, 建 in-flight TaskExecute) / 详情 / 删除
 *  - 进行中 : 编辑 / 执行 (打开 problem-detail-modal execute 模式, 跨天填报,
 *             提交回新建可重复 / 完成进已完成) / 详情 / 删除
 *  - 已完成 : 详情 / 删除
 *
 * 执行记录 + 跨天填报走公共弹窗 ProblemDetailModal (D-006 方案 B),
 * 与任务计划 task-detail-modal 行为一致。
 *
 * 设计依据:.sillyspec/changes/2026-07-20-problem-list-align-task-plan/design.md
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Button,
  DatePicker,
  Input,
  message,
  Modal,
  Select,
  Table,
  type TableProps,
  Tag,
} from "antd";
import type { Dayjs } from "dayjs";
import {
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { PpmUserSelect } from "@/components/ppm-user-select";
import {
  matchAnyUser,
  PROBLEM_STATUS_COLOR,
  PROBLEM_STATUS_TEXT,
  PROBLEM_TYPE_TEXT,
} from "@/components/ppm-status-actions";
import { ApiError } from "@/lib/api";
import { isOverEstimate } from "@/lib/ppm/format";
import {
  deleteProblem,
  exportProblems,
  listProblems,
  startProblem,
} from "@/lib/ppm";
import type { ProblemList } from "@/lib/ppm";
import { useSession } from "@/stores/session";
import { ProblemDrawer, type ProblemDrawerMode } from "./_problem-drawer";
import {
  ProblemDetailModal,
  type ProblemDetailMode,
} from "../_components/problem-detail-modal";

const { RangePicker } = DatePicker;

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

export default function ProblemListPage() {
  const { user: currentUser } = useSession();
  const currentUserId = currentUser?.id ?? "";
  // 归属:默认「全部」(ql-20260722 调整,不再默认只看我的)
  const [view, setView] = useState<"mine" | "all">("all");

  const [items, setItems] = useState<ProblemList[]>([]);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 搜索栏(对照源 queryParams,服务端过滤)。
  // keywordInput 仅受控输入框显示值,输入过程不触发查询;
  // 按 Enter 或点击"查询"按钮时同步到 keyword(实际查询用)。
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([
    "新建",
    "进行中",
  ]);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [proTypeFilter, setProTypeFilter] = useState<string>("");
  const [isUrgentFilter, setIsUrgentFilter] = useState<string>("");
  // 详情/执行公共弹窗 (对齐任务计划)
  const [modalProblem, setModalProblem] = useState<ProblemList | null>(null);
  const [modalMode, setModalMode] = useState<ProblemDetailMode>("detail");
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(
    null,
  );
  // 搜索触发计数器:点搜索/回车就 +1,即使 keyword 没变也强制 useEffect 触发查询
  const [searchNonce, setSearchNonce] = useState(0);
  const [exporting, setExporting] = useState(false);
  // 查询条件展开/收起:默认只显示 4 个,展开后追加 2 个(是否紧急/发现时间)
  const [expanded, setExpanded] = useState(false);

  const [drawer, setDrawer] = useState<{
    open: boolean;
    mode: ProblemDrawerMode;
    problem?: ProblemList;
  }>({ open: false, mode: "create" });

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
          // 默认按计划开始时间正序 (ql-20260722);计划开始时间为空的排最后
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
    ],
  );

  // 首屏 + 过滤条件变化 + 搜索按钮点击 → 回到第 1 页重拉。
  // keywordInput 不触发(只在 commit 时改 keyword + bump searchNonce)。
  // searchNonce 兜底:keyword 未变(如条件没动直接点搜索)也能强制触发查询。
  useEffect(() => {
    void load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, statusFilter, projectFilter, proTypeFilter, isUrgentFilter, dateRange, searchNonce, view]);

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

  const resetFilters = () => {
    setKeywordInput("");
    setKeyword("");
    setStatusFilter(["新建", "进行中"]);
    setProjectFilter(null);
    setProTypeFilter("");
    setIsUrgentFilter("");
    setDateRange(null);
  };

  const commitKeyword = () => {
    setKeyword(keywordInput);
    // 即使 keyword 未变也强制触发查询(用户点搜索/回车 = 显式意图)
    setSearchNonce((n) => n + 1);
  };

  const openDrawer = (
    mode: ProblemDrawerMode,
    problem?: ProblemList,
  ) => {
    setDrawer({ open: true, mode, problem });
  };

  // 详情弹窗 (只读)
  const openDetail = (problem: ProblemList) => {
    setModalProblem(problem);
    setModalMode("detail");
  };

  // 执行弹窗 (进行中 → 跨天填报)
  const openExecute = (problem: ProblemList) => {
    setModalProblem(problem);
    setModalMode("execute");
  };

  // 开始: 新建 → 进行中 (建 in-flight TaskExecute), 对齐任务计划「启动」
  const handleStart = async (p: ProblemList) => {
    if (p.status !== "新建") return;
    try {
      await startProblem(p.id);
      await load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "开始失败");
    }
  };

  // 删除: 任意状态 (本人/管理员, D-004)
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

  // 责任人&处置人 合并列显示规则 (ql-20260722):
  //  - 处置人为空         → 只显示责任人
  //  - 责任人 == 处置人    → 只显示一个
  //  - 两者不一致           → 显示「责任人 & 处置人」
  const renderDutyHandle = (p: ProblemList) => {
    const duty = p.duty_user_name ?? (p.duty_user_id ? p.duty_user_id : "待指派");
    const handle = p.now_handle_user_name ?? (p.now_handle_user ? p.now_handle_user : null);
    const same =
      handle != null &&
      (p.now_handle_user === p.duty_user_id ||
        (!!p.now_handle_user_name && p.now_handle_user_name === p.duty_user_name));
    if (!handle || same) {
      return <span>{duty}</span>;
    }
    return (
      <span>
        {duty}
        <span className="mx-1 text-muted-foreground">&amp;</span>
        {handle}
      </span>
    );
  };

  const columns: TableProps<ProblemList>["columns"] = [
    {
      title: "序号",
      key: "rowno",
      width: 60,
      align: "center",
      render: (_v, _t: ProblemList, idx: number) => idx + 1,
    },
    {
      title: "项目",
      dataIndex: "project_name",
      key: "project_name",
      width: 150,
      ellipsis: true,
      render: (v: string | null, p: ProblemList) => v ?? p.project_id ?? "—",
    },
    {
      title: "模块",
      dataIndex: "model_name",
      key: "model_name",
      width: 110,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "问题类型",
      dataIndex: "pro_type",
      key: "pro_type",
      width: 90,
      // bug 标红 (ql-20260722)
      render: (v: string | null) =>
        v ? (
          <Tag color={v === "bug" ? "red" : "default"}>
            {PROBLEM_TYPE_TEXT[v] ?? v}
          </Tag>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      title: "功能名称",
      dataIndex: "func_name",
      key: "func_name",
      width: 110,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "问题描述",
      dataIndex: "pro_desc",
      key: "pro_desc",
      width: 170,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "责任人&处置人",
      key: "duty_handle",
      width: 150,
      ellipsis: true,
      render: (_v: unknown, p: ProblemList) => renderDutyHandle(p),
    },
    {
      title: "紧急",
      dataIndex: "is_urgent",
      key: "is_urgent",
      width: 60,
      render: (v: string | null) =>
        v === "1" || v === "是" ? <Tag color="red">急</Tag> : "否",
    },
    {
      title: "预估/已消耗(人天)",
      key: "estimate_spent",
      width: 140,
      render: (_v: unknown, p: ProblemList) => {
        const estimate = p.work_load ?? "—";
        const spent = p.spent_time;
        const showSpent = spent != null && spent > 0;
        const over = showSpent && isOverEstimate(spent, p.work_load);
        return (
          <span>
            <span>{estimate}</span>
            <span className="mx-1 text-muted-foreground">/</span>
            {showSpent ? (
              <span
                className={`${over ? "text-destructive" : "text-success"} font-medium`}
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
      title: "计划起止",
      key: "plan",
      width: 180,
      render: (_v: unknown, p: ProblemList) =>
        `${p.plan_start_time?.slice(0, 10) ?? "?"} ~ ${p.plan_end_time?.slice(0, 10) ?? "?"}`,
    },
    {
      title: "状态",
      key: "status",
      width: 90,
      render: (_v: unknown, p: ProblemList) => (
        <Tag color={PROBLEM_STATUS_COLOR[p.status] ?? "default"}>
          {PROBLEM_STATUS_TEXT[p.status] ?? p.status}
        </Tag>
      ),
    },
    {
      title: "发现人",
      dataIndex: "find_by",
      key: "find_by",
      width: 90,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "发现时间",
      dataIndex: "find_time",
      key: "find_time",
      width: 110,
      render: (v: string | null) =>
        v ? v.slice(0, 10) : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      title: "问题答复/解答",
      dataIndex: "pro_answer",
      key: "pro_answer",
      width: 150,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "验证人",
      dataIndex: "audit_user_name",
      key: "audit_user_name",
      width: 90,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "备注",
      dataIndex: "remarks",
      key: "remarks",
      width: 140,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "操作",
      key: "actions",
      align: "center",
      width: 180,
      fixed: "right",
      render: (_v: unknown, p: ProblemList) => {
        const isDuty = matchAnyUser([p.duty_user_id], currentUserId);
        // 开始/执行: 责任人 ‖ 超管 (沿用; "干活"入口需是处置人,与编辑/删除的"管理"区分开)
        const canOperate = isDuty || !!currentUser?.is_platform_admin;
        // 编辑/删除: 后端集中判断 (超管 ‖ 创建人 ‖ 本项目经理 ‖ 责任人), 前端只读 can_edit/can_delete
        const canEdit = p.can_edit ?? false;
        const canDelete = p.can_delete ?? false;
        return (
          <div className="flex whitespace-nowrap gap-1 justify-center">
            {/* 编辑: 新建 / 进行中 (D-003 进行中保留编辑入口, 与执行分离) */}
            {(p.status === "新建" || p.status === "进行中") && canEdit && (
              <Button size="small" type="link" onClick={() => openDrawer("edit", p)}>
                编辑
              </Button>
            )}
            {/* 开始: 新建 → 进行中 (建 in-flight TaskExecute) */}
            {p.status === "新建" && canOperate && (
              <Button size="small" type="link" onClick={() => void handleStart(p)}>
                开始
              </Button>
            )}
            {/* 执行: 进行中 → 打开 execute 弹窗 (跨天填报, 提交回新建/完成) */}
            {p.status === "进行中" && canOperate && (
              <Button size="small" type="link" onClick={() => openExecute(p)}>
                执行
              </Button>
            )}
            {/* 详情: 任意状态 (打开 detail 弹窗只读) */}
            <Button size="small" type="link" onClick={() => openDetail(p)}>
              详情
            </Button>
            {/* 删除: 任意状态 (后端 can_delete 判断) */}
            {canDelete && (
              <Button size="small" type="link" danger onClick={() => void handleDelete(p)}>
                删除
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
        title="问题清单"
        subtitle="新建 → 开始 → 执行(可重复) → 完成, 与任务计划一致"
      />

      <SectionCard bodyPadding="p-2">
        {/* 顶部按钮行(D-006):数据组(导出/新建)左 | 基础组(搜索/重置/展开)最右 */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? "导出中…" : "导出"}
          </Button>
          <Button type="primary" onClick={() => openDrawer("create")}>
            + 新建问题
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button type="primary" onClick={commitKeyword}>
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

        {/* 查询条件:垂直 grid-cols-4(服务端过滤,Select/RangePicker 选中即查) */}
        <div className="grid w-full grid-cols-4 gap-3">
          <Field label="归属">
            <Select
              value={view}
              onChange={(v) => setView(v as "mine" | "all")}
              options={[
                { label: "我的", value: "mine" },
                { label: "全部", value: "all" },
              ]}
              style={{ width: "100%" }}
            />
          </Field>
          <Field label="关键字">
            <Input
              allowClear
              placeholder="项目/模块/描述/功能/责任人/发现人(回车查询)"
              value={keywordInput}
              onChange={(e) => {
                const v = e.target.value;
                setKeywordInput(v);
                // allowClear 点 x 清空时立即同步(显式清空动作 ≠ 输入过程)
                if (!v) setKeyword("");
              }}
              onPressEnter={commitKeyword}
            />
          </Field>
          <Field label="状态">
            <Select<string[]>
              mode="multiple"
              allowClear
              className="w-full"
              placeholder="状态(可多选)"
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v as string[]);
                setSearchNonce((n) => n + 1);
              }}
              options={STATUS_OPTIONS}
            />
          </Field>
          <Field label="项目">
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
          </Field>
          {expanded && (
            <>
              {/* 问题类型移入展开区 (ql-20260722):默认收起,减少首屏条件 */}
              <Field label="问题类型">
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
              </Field>
              <Field label="是否紧急">
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
              </Field>
              <Field label="发现时间">
                <RangePicker
                  className="w-full"
                  value={dateRange as [Dayjs, Dayjs] | null}
                  onChange={(v) =>
                    setDateRange(v as [Dayjs | null, Dayjs | null] | null)
                  }
                  placeholder={["发现开始", "发现结束"]}
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
        <Table<ProblemList>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading}
          size="small"
          bordered
          tableLayout="fixed"
          rowClassName={(_row, idx) => (idx % 2 === 1 ? "bg-muted/40" : "")}
          scroll={{ y: "calc(100vh - 430px)" }}
          pagination={{
            current,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50", "100"],
            showTotal: (t: number) => `共 ${t} 条`,
            onChange: (page: number, size: number) => void load({ page, page_size: size }),
          }}
          locale={{ emptyText: "暂无问题" }}
        />
      )}

      <ProblemDrawer
        open={drawer.open}
        mode={drawer.mode}
        problem={drawer.problem}
        onClose={() => setDrawer({ open: false, mode: "create" })}
        onSaved={() => {
          setDrawer({ open: false, mode: "create" });
          void load();
        }}
      />

      {/* 详情/执行公共弹窗 (对齐任务计划 task-detail-modal) */}
      <ProblemDetailModal
        problem={modalProblem}
        mode={modalMode}
        onClose={() => setModalProblem(null)}
        onChanged={() => void load()}
      />
    </PageContainer>
  );
}

/**
 * 查询条件外壳:垂直布局(标题在上,控件在下),对齐 project-plans 风格。
 */
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
