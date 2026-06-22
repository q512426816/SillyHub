"use client";

/**
 * 问题清单 (ProblemList) 列表页 — 对齐源 dept_project_front problemlist/index.vue。
 *
 * 6 态表单分发(对照源 6 个 .vue):
 *  - status=1 已保存:creator → 编辑(ListForm)/ 删除 / 提交审核
 *  - status=2 审核中:now_handle_user → 审核(ListAuditForm)
 *  - status=3 处置中:duty_user → 开始(ListStartForm)/ 完成处置(ListDoneForm)/ 变更
 *  - status=6 待验证:audit_user → 验证关闭(ListCloseForm)
 *  - status=4/5 终态
 *  - 任意:详情(ListDetailForm)
 *
 * 列表字段 + 操作按钮显隐规则逐条对齐源 index.vue 操作列 v-if。
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-frontend-alignment/design.md §7
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DatePicker,
  Input,
  Select,
  Table,
  type TableProps,
  Tag,
} from "antd";
import type { Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
import {
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { PpmUserSelect } from "@/components/ppm-user-select";
import { matchAnyUser } from "@/components/ppm-status-actions";
import {
  PROBLEM_STATUS_COLOR,
  PROBLEM_STATUS_TEXT,
  PROBLEM_TYPE_TEXT,
} from "@/components/ppm-status-actions";
import { ApiError } from "@/lib/api";
import { deleteProblem, exportProblems, listProblems } from "@/lib/ppm";
import type { ProblemList } from "@/lib/ppm";
import { useSession } from "@/stores/session";
import { ProblemDrawer, type ProblemDrawerMode } from "./_problem-drawer";

const { RangePicker } = DatePicker;

const STATUS_OPTIONS = [
  { label: PROBLEM_STATUS_TEXT["1"] ?? "已保存", value: "1" },
  { label: PROBLEM_STATUS_TEXT["2"] ?? "审核中", value: "2" },
  { label: PROBLEM_STATUS_TEXT["3"] ?? "处置中", value: "3" },
  { label: PROBLEM_STATUS_TEXT["6"] ?? "待验证", value: "6" },
  { label: PROBLEM_STATUS_TEXT["4"] ?? "已关闭", value: "4" },
  { label: PROBLEM_STATUS_TEXT["5"] ?? "已作废", value: "5" },
  { label: PROBLEM_STATUS_TEXT["7"] ?? "变更中", value: "7" },
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

  const [items, setItems] = useState<ProblemList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 搜索栏(对照源 queryParams,本仓后端仅支持分页,复杂字段本地过滤)
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([
    "1",
    "2",
    "3",
    "6",
  ]);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [proTypeFilter, setProTypeFilter] = useState<string>("");
  const [isUrgentFilter, setIsUrgentFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);

  const [drawer, setDrawer] = useState<{
    open: boolean;
    mode: ProblemDrawerMode;
    problem?: ProblemList;
  }>({ open: false, mode: "create" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listProblems({ page: 1, page_size: 200 }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const [rangeStart, rangeEnd] = dateRange ?? [null, null];
    return items.filter((p) => {
      if (statusFilter.length > 0 && !statusFilter.includes(p.status)) {
        return false;
      }
      if (projectFilter && p.project_id !== projectFilter) {
        return false;
      }
      if (proTypeFilter && p.pro_type !== proTypeFilter) {
        return false;
      }
      if (isUrgentFilter) {
        const urgent = p.is_urgent === "1" || p.is_urgent === "是" ? "1" : "0";
        if (urgent !== isUrgentFilter) return false;
      }
      if (rangeStart && rangeEnd && p.find_time) {
        const t = new Date(p.find_time);
        if (Number.isNaN(t.getTime())) return false;
        if (t < rangeStart.startOf("day").toDate()) return false;
        if (t > rangeEnd.endOf("day").toDate()) return false;
      }
      if (!kw) return true;
      const hay = [
        p.project_name,
        p.model_name,
        p.pro_desc,
        p.func_name,
        p.duty_user_name,
        p.find_by,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(kw);
    });
  }, [
    items,
    keyword,
    statusFilter,
    projectFilter,
    proTypeFilter,
    isUrgentFilter,
    dateRange,
  ]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportProblems();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => {
    setKeyword("");
    setStatusFilter(["1", "2", "3", "6"]);
    setProjectFilter(null);
    setProTypeFilter("");
    setIsUrgentFilter("");
    setDateRange(null);
  };

  const openDrawer = (
    mode: ProblemDrawerMode,
    problem?: ProblemList,
  ) => {
    setDrawer({ open: true, mode, problem });
  };

  const handleDelete = async (p: ProblemList) => {
    if (p.status !== "1") return;
    if (!confirm("删除该问题清单?")) return;
    try {
      await deleteProblem(p.id);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<ProblemList>["columns"] = [
    {
      title: "责任人",
      dataIndex: "duty_user_name",
      key: "duty_user_name",
      width: 100,
      fixed: "left",
      render: (v: string | null, p: ProblemList) =>
        v ?? (p.duty_user_id ? p.duty_user_id : "待指派"),
    },
    {
      title: "项目",
      dataIndex: "project_name",
      key: "project_name",
      width: 150,
      render: (v: string | null, p: ProblemList) => v ?? p.project_id ?? "—",
    },
    {
      title: "模块名称",
      dataIndex: "model_name",
      key: "model_name",
      width: 120,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "问题描述",
      dataIndex: "pro_desc",
      key: "pro_desc",
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "功能名称",
      dataIndex: "func_name",
      key: "func_name",
      width: 120,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "问题类型",
      dataIndex: "pro_type",
      key: "pro_type",
      width: 100,
      render: (v: string | null) =>
        v ? (
          <Tag>{PROBLEM_TYPE_TEXT[v] ?? v}</Tag>
        ) : (
          <span style={{ color: "rgba(0,0,0,0.45)" }}>—</span>
        ),
    },
    {
      title: "紧急",
      dataIndex: "is_urgent",
      key: "is_urgent",
      width: 70,
      render: (v: string | null) =>
        v === "1" || v === "是" ? <Tag color="red">急</Tag> : "否",
    },
    {
      title: "发现人",
      dataIndex: "find_by",
      key: "find_by",
      width: 100,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "发现日期",
      dataIndex: "find_time",
      key: "find_time",
      width: 120,
      render: (v: string | null) =>
        v ? v.slice(0, 10) : <span style={{ color: "rgba(0,0,0,0.45)" }}>—</span>,
    },
    {
      title: "工作量(人/天)",
      dataIndex: "work_load",
      key: "work_load",
      width: 130,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "计划起止",
      key: "plan",
      width: 200,
      render: (_v: unknown, p: ProblemList) =>
        `${p.plan_start_time?.slice(0, 10) ?? "?"} ~ ${p.plan_end_time?.slice(0, 10) ?? "?"}`,
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
      fixed: "right",
      render: (_v: unknown, p: ProblemList) => {
        const display = p.effective_status === "7" ? "7" : p.status;
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
      fixed: "right",
      render: (_v: unknown, p: ProblemList) => {
        const isNowHandler = matchAnyUser(
          [p.now_handle_user],
          currentUserId,
        );
        const isCreator = matchAnyUser(
          [(p as ProblemList & { creator_id?: string }).creator_id],
          currentUserId,
        );
        const isDuty = matchAnyUser([p.duty_user_id], currentUserId);
        const isAuditor = matchAnyUser([p.audit_user_id], currentUserId);
        return (
          <div className="flex flex-wrap justify-end gap-1">
            {/* 审核:status=2 + now_handle_user(源 openAuditForm) */}
            {p.status === "2" && isNowHandler && (
              <Button size="sm" onClick={() => openDrawer("audit", p)}>
                审核
              </Button>
            )}
            {/* 变更:status=3 + creator/duty(源 openChangeForm → 新建 ProblemChange) */}
            {p.status === "3" && (isCreator || isDuty) && (
              <Button size="sm" variant="outline" onClick={() => openDrawer("change", p)}>
                变更
              </Button>
            )}
            {/* 编辑:status=1 + creator(源 openForm update) */}
            {p.status === "1" && isCreator && (
              <Button size="sm" onClick={() => openDrawer("edit", p)}>
                编辑
              </Button>
            )}
            {/* 开始处置:status=3 + duty(源 startTask) */}
            {p.status === "3" && isDuty && !p.handle_info && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDrawer("start", p)}
              >
                开始
              </Button>
            )}
            {/* 完成处置:status=3 + duty(源 doneTask) */}
            {p.status === "3" && isDuty && !!p.handle_info && (
              <Button
                size="sm"
                onClick={() => openDrawer("done", p)}
              >
                处置
              </Button>
            )}
            {/* 验证关闭:status=6 + audit_user(源 closeTask) */}
            {p.status === "6" && isAuditor && (
              <Button size="sm" onClick={() => openDrawer("close", p)}>
                验证并关闭
              </Button>
            )}
            {/* 详情:任意(源 openDetailForm) */}
            <Button size="sm" variant="outline" onClick={() => openDrawer("detail", p)}>
              详情
            </Button>
            {/* 删除:status=1 + creator(源 handleDelete) */}
            {p.status === "1" && isCreator && (
              <Button size="sm" variant="destructive" onClick={() => void handleDelete(p)}>
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
        subtitle="问题审批流:已保存→审核中→处置中→待验证→已关闭;bug 跳过部门经理"
      />

      <SectionCard bodyPadding="p-2">
        {/* 顶部按钮行:右对齐(重置 | 分隔 | 导出 / 新建) */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={resetFilters}>
            重置
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button
            size="sm"
            variant="outline"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? "导出中…" : "导出"}
          </Button>
          <Button size="sm" onClick={() => openDrawer("create")}>
            + 新建问题
          </Button>
        </div>

        {/* 查询条件:垂直 grid-cols-4(本地过滤,onChange 实时生效) */}
        <div className="grid w-full grid-cols-4 gap-3">
          <Field label="关键字">
            <Input
              allowClear
              placeholder="项目/模块/描述/功能/责任人/发现人"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </Field>
          <Field label="状态">
            <Select<string[]>
              mode="multiple"
              allowClear
              className="w-full"
              placeholder="状态(可多选)"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as string[])}
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
              onChange={(v) => setProjectFilter((v as string | null) ?? null)}
            />
          </Field>
          <Field label="问题类型">
            <Select<string>
              className="w-full"
              placeholder="全部类型"
              value={proTypeFilter || undefined}
              onChange={(v) => setProTypeFilter(v ?? "")}
              options={PRO_TYPE_OPTIONS}
            />
          </Field>
          <Field label="是否紧急">
            <Select<string>
              className="w-full"
              placeholder="全部"
              value={isUrgentFilter || undefined}
              onChange={(v) => setIsUrgentFilter(v ?? "")}
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
          <div className="col-span-2 self-end text-right text-xs text-muted-foreground">
            共 {filtered.length} 条
          </div>
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
        <Table<ProblemList>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          size="small"
          bordered
          scroll={{ x: "max-content", y: "calc(100vh - 430px)" }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50", "100"],
            showTotal: (t: number) => `共 ${t} 条`,
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
