"use client";

/**
 * 项目计划 (PsProjectPlan) 列表页 — 左侧分组树 + 顶部搜索 + 右侧表格。
 *
 * 布局参考:典型后台"顶部搜索/操作 + 左侧分组树 + 右侧数据表"结构。
 *  - 顶部:标题 + 搜索表单(项目名称 / 合同名称 / 公司名称 + 展开时间范围) + 主操作按钮(导出 / 新建)。
 *  - 左侧:antd Tree 按项目经理分组,展示数量,点击节点客户端过滤右侧表格。
 *  - 右侧:DataTable 字段对齐源 dept_project_front index.vue(12 列 + 操作 + 合计行)。
 *
 * 走 lib/ppm/plan.ts:listProjectPlans + CRUD。apiFetch。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DatePicker,
  Form,
  Input,
  Table,
  Tree,
  type TableProps,
  type TreeDataNode,
} from "antd";
import type { Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { PpmProjectPlanDetail } from "@/components/ppm-project-plan-detail";
import { PpmProjectPlanForm } from "@/components/ppm-project-plan-form";
import { matchAnyUser } from "@/components/ppm-status-actions";
import { ApiError } from "@/lib/api";
import {
  deleteProjectPlan,
  exportProjectPlans,
  listProjectPlans,
  type PsProjectPlan,
} from "@/lib/ppm";
import { useSession } from "@/stores/session";

const { RangePicker } = DatePicker;

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  plan?: PsProjectPlan;
}

interface DetailState {
  open: boolean;
  planId: string | null;
}

interface SearchForm {
  projectName?: string;
  contractName?: string;
  companyName?: string;
  contractSignTimeRange?: [Dayjs, Dayjs] | null;
  projectStartTimeRange?: [Dayjs, Dayjs] | null;
  projectPlanEndTimeRange?: [Dayjs, Dayjs] | null;
}

function formatMoney(v: string | null | undefined): string {
  const n = Number(v ?? 0);
  if (Number.isNaN(n)) return "0.00";
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  // 后端可能返回 ISO 字符串或 YYYY-MM-DD;截取日期段。
  return v.length >= 10 ? v.slice(0, 10) : v;
}

// 单个查询条件的外壳:垂直布局(标题在上,控件在下)。
// 使用 Form.Item noStyle 让 antd 不渲染外层 label/wrapper,
// 标题和宽度完全由我们自定义的 div 控制,避免 antd inline 布局
// 给 RangePicker 留不足宽度导致内部换行。
// 外层 Form 用 grid-cols-4 强制一行最多 4 列,Field 用 w-full 占满网格列。
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

export default function ProjectPlansPage() {
  const router = useRouter();
  const { user: currentUser } = useSession();
  const currentUserId = currentUser?.id ?? "";
  const [plans, setPlans] = useState<PsProjectPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    mode: "create",
  });
  const [detail, setDetail] = useState<DetailState>({
    open: false,
    planId: null,
  });
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [search] = Form.useForm<SearchForm>();
  const [expanded, setExpanded] = useState(false);
  const [selectedManager, setSelectedManager] = useState<string>("all");

  // P0-6:跳转里程碑管理页(对照源 OpenPlanNodeForm 入口)。
  const goToMilestones = (planId: string) => {
    router.push(`/ppm/milestone-details?plan=${planId}`);
  };

  const load = useCallback(
    async (params?: Record<string, string | undefined>) => {
      setLoading(true);
      setError(null);
      try {
        setPlans(await listProjectPlans({ page: 1, page_size: 100, ...params }));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSearch = () => {
    const v = search.getFieldsValue();
    void load({
      project_name: v.projectName?.trim() || undefined,
      contract_name: v.contractName?.trim() || undefined,
      company_name: v.companyName?.trim() || undefined,
      contract_sign_time_start: v.contractSignTimeRange?.[0]?.format(
        "YYYY-MM-DD",
      ),
      contract_sign_time_end: v.contractSignTimeRange?.[1]?.format(
        "YYYY-MM-DD",
      ),
      project_start_time_start: v.projectStartTimeRange?.[0]?.format(
        "YYYY-MM-DD",
      ),
      project_start_time_end: v.projectStartTimeRange?.[1]?.format(
        "YYYY-MM-DD",
      ),
      project_plan_end_time_start: v.projectPlanEndTimeRange?.[0]?.format(
        "YYYY-MM-DD",
      ),
      project_plan_end_time_end: v.projectPlanEndTimeRange?.[1]?.format(
        "YYYY-MM-DD",
      ),
    });
  };

  const handleReset = () => {
    search.resetFields();
    void load();
  };

  const handleDelete = async (p: PsProjectPlan) => {
    if (!confirm(`删除项目计划「${p.project_name ?? p.id}」?`)) return;
    try {
      await deleteProjectPlan(p.id);
      showToast(true, "已删除");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportProjectPlans();
      showToast(true, "导出已开始");
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  // 左侧分组树:按项目经理分组,显示数量,点击节点客户端过滤右侧表格。
  // key 约定:"all" = 全部;"manager:<id|unknown>" = 单个项目经理。
  const managerTreeData = useMemo<TreeDataNode[]>(() => {
    const groups = new Map<string, { name: string; count: number }>();
    for (const p of plans) {
      const key = p.project_manager_id ?? "unknown";
      const name = p.project_manager_name?.trim() || "未分配";
      const prev = groups.get(key);
      if (prev) prev.count += 1;
      else groups.set(key, { name, count: 1 });
    }
    const children: TreeDataNode[] = Array.from(groups.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, { name, count }]) => ({
        title: (
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">{name}</span>
            <span className="text-xs text-muted-foreground">{count}</span>
          </span>
        ),
        key: `manager:${id}`,
        isLeaf: true,
      }));
    return [
      {
        title: (
          <span className="flex items-center justify-between gap-2 font-medium">
            <span>全部项目</span>
            <span className="text-xs text-muted-foreground">{plans.length}</span>
          </span>
        ),
        key: "all",
        children,
      },
    ];
  }, [plans]);

  // 客户端按所选树节点过滤 plans(选中"all"或空值时不过滤)。
  const filteredPlans = useMemo(() => {
    if (!selectedManager || selectedManager === "all") return plans;
    if (selectedManager.startsWith("manager:")) {
      const id = selectedManager.slice("manager:".length);
      return plans.filter((p) => (p.project_manager_id ?? "unknown") === id);
    }
    return plans;
  }, [plans, selectedManager]);

  // 合计行(对齐源 getSummaries):合同金额 / 利润金额 / 剩余人天 / 总成本 / 剩余成本。
  // 基于左侧树过滤后的 plans(选中"全部"时等同 plans)。
  const summaryRow = useMemo(() => {
    const sum = (sel: (p: PsProjectPlan) => number) =>
      filteredPlans.reduce((acc, p) => acc + sel(p), 0);
    return {
      contractAmount: sum((p) => Number(p.contract_amount ?? 0)),
      profitAmount: sum((p) => Number(p.profit_amount ?? 0)),
      remainingDays: sum((p) => Number(p.remaining_available_person_days ?? 0)),
      totalCost: sum((p) => Number(p.total_cost ?? 0)),
      remainingCost: sum((p) => Number(p.remaining_cost ?? 0)),
    };
  }, [filteredPlans]);

  const columns: TableProps<PsProjectPlan>["columns"] = [
    {
      title: "项目名称",
      dataIndex: "project_name",
      key: "project_name",
      width: 180,
      render: (v: string | null, p: PsProjectPlan) => (
        <button
          className="text-left font-medium hover:underline"
          onClick={() => setDetail({ open: true, planId: p.id })}
        >
          {v ?? p.id}
        </button>
      ),
    },
    {
      title: "项目经理",
      dataIndex: "project_manager_name",
      key: "project_manager_name",
      width: 120,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "合同名称",
      dataIndex: "contract_name",
      key: "contract_name",
      width: 180,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "合同金额(含税)/元",
      dataIndex: "contract_amount",
      key: "contract_amount",
      width: 160,
      align: "right",
      render: (v: string | null) => `¥ ${formatMoney(v)}`,
    },
    {
      title: "公司既定利润率/%",
      dataIndex: "profit_margin",
      key: "profit_margin",
      width: 150,
      align: "right",
      render: (v: string | null) => `${v ?? 0} %`,
    },
    {
      title: "公司既定利润金额/元",
      dataIndex: "profit_amount",
      key: "profit_amount",
      width: 170,
      align: "right",
      render: (v: string | null) => `¥ ${formatMoney(v)}`,
    },
    {
      title: "剩余可用人天",
      dataIndex: "remaining_available_person_days",
      key: "remaining_available_person_days",
      width: 120,
      align: "right",
      render: (v: string | null) => `${v ?? 0} 天`,
    },
    {
      title: "总成本/元",
      dataIndex: "total_cost",
      key: "total_cost",
      width: 120,
      align: "right",
      render: (v: string | null) => `¥ ${formatMoney(v)}`,
    },
    {
      title: "剩余成本/元",
      dataIndex: "remaining_cost",
      key: "remaining_cost",
      width: 120,
      align: "right",
      render: (v: string | null) => `¥ ${formatMoney(v)}`,
    },
    {
      title: "合同签订时间",
      dataIndex: "contract_sign_time",
      key: "contract_sign_time",
      width: 120,
      render: (v: string | null) => fmtDate(v),
    },
    {
      title: "项目开始时间",
      dataIndex: "project_start_time",
      key: "project_start_time",
      width: 120,
      render: (v: string | null) => fmtDate(v),
    },
    {
      title: "预计验收时间",
      dataIndex: "project_plan_end_time",
      key: "project_plan_end_time",
      width: 120,
      render: (v: string | null) => fmtDate(v),
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 240,
      render: (_v: unknown, p: PsProjectPlan) => {
        // RBAC:平台超管 bypass,否则按 project_manager_id 归属(无 create_user_id 字段)。
        const isManager =
          !!currentUser?.is_platform_admin ||
          matchAnyUser([p.project_manager_id], currentUserId);
        return (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="default"
              className="bg-blue-500 text-white hover:bg-blue-600"
              onClick={() => setDetail({ open: true, planId: p.id })}
            >
              详情
            </Button>
            <Button
              size="sm"
              variant="default"
              className="bg-amber-500 text-white hover:bg-amber-600"
              onClick={() => goToMilestones(p.id)}
            >
              里程碑
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={!isManager}
              title={isManager ? undefined : "仅项目经理可编辑"}
              onClick={() => setDrawer({ open: true, mode: "edit", plan: p })}
            >
              编辑
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!isManager}
              title={isManager ? undefined : "仅项目经理可删除"}
              onClick={() => void handleDelete(p)}
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
        title="项目计划"
        subtitle="ps_project_plan — 项目维度的计划主表"
      />

      {/* 顶部:主操作按钮行 + 搜索表单(换行时行间有间距) */}
      <SectionCard bodyPadding="p-2">
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button size="sm" onClick={() => handleSearch()}>
            搜索
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleReset()}
          >
            重置
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : "展开"}
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
          <Button
            size="sm"
            onClick={() => setDrawer({ open: true, mode: "create" })}
          >
            + 新建项目计划
          </Button>
        </div>
        <Form<SearchForm>
          form={search}
          layout="vertical"
          className="grid w-full grid-cols-4 gap-3"
        >
          <Field label="项目名称">
            <Form.Item name="projectName" noStyle>
              <Input
                placeholder="请输入项目名称"
                allowClear
                className="w-full"
                onPressEnter={() => handleSearch()}
              />
            </Form.Item>
          </Field>
          <Field label="合同名称">
            <Form.Item name="contractName" noStyle>
              <Input
                placeholder="请输入合同名称"
                allowClear
                className="w-full"
                onPressEnter={() => handleSearch()}
              />
            </Form.Item>
          </Field>
          <Field label="公司名称">
            <Form.Item name="companyName" noStyle>
              <Input
                placeholder="请输入公司名称"
                allowClear
                className="w-full"
                onPressEnter={() => handleSearch()}
              />
            </Form.Item>
          </Field>
          <Field label="合同签订时间">
            <Form.Item name="contractSignTimeRange" noStyle>
              <RangePicker allowClear={false} className="w-full" />
            </Form.Item>
          </Field>
          {expanded && (
            <>
              <Field label="项目开始时间">
                <Form.Item name="projectStartTimeRange" noStyle>
                  <RangePicker allowClear={false} className="w-full" />
                </Form.Item>
              </Field>
              <Field label="预计验收时间">
                <Form.Item name="projectPlanEndTimeRange" noStyle>
                  <RangePicker allowClear={false} className="w-full" />
                </Form.Item>
              </Field>
            </>
          )}
        </Form>
      </SectionCard>

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

      {/* 主体:左侧分组树 + 右侧数据表 */}
      <div className="flex gap-4">
        <aside className="w-56 shrink-0">
          <SectionCard
            title="按项目经理"
            bodyPadding="p-2"
          >
            <Tree
              blockNode
              defaultExpandAll
              treeData={managerTreeData}
              selectedKeys={[selectedManager]}
              onSelect={(keys) => {
                const k = keys[0] as string | undefined;
                setSelectedManager(k ?? "all");
              }}
            />
          </SectionCard>
        </aside>

        <div className="min-w-0 flex-1">
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
            <DataTable<PsProjectPlan>
              rowKey="id"
              columns={columns}
              dataSource={filteredPlans}
              loading={loading}
              size="small"
              scroll={{ x: "max-content" }}
              pagination={false}
              emptyText="暂无项目计划"
              summary={() => (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                    <Table.Summary.Cell index={1} />
                    <Table.Summary.Cell index={2} />
                    <Table.Summary.Cell index={3} align="right">
                      ¥ {formatMoney(String(summaryRow.contractAmount))}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} />
                    <Table.Summary.Cell index={5} align="right">
                      ¥ {formatMoney(String(summaryRow.profitAmount))}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} align="right">
                      {summaryRow.remainingDays} 天
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={7} align="right">
                      ¥ {formatMoney(String(summaryRow.totalCost))}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={8} align="right">
                      ¥ {formatMoney(String(summaryRow.remainingCost))}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={9} />
                    <Table.Summary.Cell index={10} />
                    <Table.Summary.Cell index={11} />
                    <Table.Summary.Cell index={12} />
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          )}
        </div>
      </div>

      <PpmProjectPlanForm
        open={drawer.open}
        mode={drawer.mode}
        plan={drawer.plan}
        onClose={() => setDrawer({ open: false, mode: "create" })}
        onSaved={() => {
          setDrawer({ open: false, mode: "create" });
          void load();
        }}
      />

      <PpmProjectPlanDetail
        open={detail.open}
        planId={detail.planId}
        onClose={() => setDetail({ open: false, planId: null })}
      />
    </PageContainer>
  );
}
