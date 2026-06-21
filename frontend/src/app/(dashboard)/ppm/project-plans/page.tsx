"use client";

/**
 * 项目计划 (PsProjectPlan) 列表页 — 对齐源 dept_project_front
 * src/views/ppm/projectplan/index.vue。
 *
 * 功能:
 *  - 搜索栏:项目名称 / 合同名称 / 公司名称 + 展开时间范围搜索。
 *  - 列表 Table(字段对齐源 index.vue):
 *      项目名称 / 项目经理 / 合同名称 / 合同金额(¥) / 公司既定利润率(%) /
 *      公司既定利润金额(¥) / 剩余可用人天(天) / 总成本(¥) / 剩余成本(¥) /
 *      合同签订时间 / 项目开始时间 / 预计验收时间 + 合计行。
 *  - 操作列:详情(三联表) / 编辑 / 删除。
 *  - 新建按钮:打开 17 字段表单抽屉 (PpmProjectPlanForm)。
 *
 * 走 lib/ppm/plan.ts:listProjectPlans + CRUD。apiFetch。
 *
 * 设计依据:tasks/task-03.md + 源 index.vue。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button as AntButton,
  DatePicker,
  Form,
  Input,
  Table,
  type TableProps,
} from "antd";
import type { Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
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

  // 合计行(对齐源 getSummaries):合同金额 / 利润金额 / 剩余人天 / 总成本 / 剩余成本。
  const summaryRow = useMemo(() => {
    const sum = (sel: (p: PsProjectPlan) => number) =>
      plans.reduce((acc, p) => acc + sel(p), 0);
    return {
      contractAmount: sum((p) => Number(p.contract_amount ?? 0)),
      profitAmount: sum((p) => Number(p.profit_amount ?? 0)),
      remainingDays: sum((p) => Number(p.remaining_available_person_days ?? 0)),
      totalCost: sum((p) => Number(p.total_cost ?? 0)),
      remainingCost: sum((p) => Number(p.remaining_cost ?? 0)),
    };
  }, [plans]);

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
      width: 300,
      render: (_v: unknown, p: PsProjectPlan) => {
        // RBAC:平台超管 bypass,否则按 project_manager_id 归属(无 create_user_id 字段)。
        const isManager =
          !!currentUser?.is_platform_admin ||
          matchAnyUser([p.project_manager_id], currentUserId);
        return (
          <div className="flex gap-1">
            <AntButton
              size="small"
              type="link"
              onClick={() => setDetail({ open: true, planId: p.id })}
            >
              详情
            </AntButton>
            <AntButton
              size="small"
              type="link"
              onClick={() => goToMilestones(p.id)}
            >
              里程碑
            </AntButton>
            <AntButton
              size="small"
              type="link"
              disabled={!isManager}
              title={isManager ? undefined : "仅项目经理可编辑"}
              onClick={() => setDrawer({ open: true, mode: "edit", plan: p })}
            >
              编辑
            </AntButton>
            <AntButton
              size="small"
              type="link"
              danger
              disabled={!isManager}
              title={isManager ? undefined : "仅项目经理可删除"}
              onClick={() => void handleDelete(p)}
            >
              删除
            </AntButton>
          </div>
        );
      },
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">项目计划</h1>
          <p className="text-xs text-muted-foreground">
            ps_project_plan — 项目维度的计划主表
          </p>
        </div>
        <div className="flex gap-2">
          <AntButton
            loading={exporting}
            onClick={() => void handleExport()}
          >
            导出
          </AntButton>
          <Button
            size="sm"
            onClick={() => setDrawer({ open: true, mode: "create" })}
          >
            + 新建项目计划
          </Button>
        </div>
      </header>

      {/* 搜索栏 */}
      <div className="rounded border bg-card p-3">
        <Form<SearchForm> form={search} layout="inline">
          <Form.Item label="项目名称" name="projectName">
            <Input
              placeholder="请输入项目名称"
              allowClear
              style={{ width: 220 }}
              onPressEnter={() => handleSearch()}
            />
          </Form.Item>
          <Form.Item label="合同名称" name="contractName">
            <Input
              placeholder="请输入合同名称"
              allowClear
              style={{ width: 220 }}
              onPressEnter={() => handleSearch()}
            />
          </Form.Item>
          <Form.Item>
            <AntButton type="primary" onClick={() => handleSearch()}>
              搜索
            </AntButton>
            <AntButton className="ml-2" onClick={() => handleReset()}>
              重置
            </AntButton>
            <AntButton
              className="ml-2"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收起" : "展开"}
            </AntButton>
          </Form.Item>
          {expanded && (
            <div className="mt-2 flex w-full flex-wrap gap-3">
              <Form.Item label="公司名称" name="companyName">
                <Input
                  placeholder="请输入公司名称"
                  allowClear
                  style={{ width: 220 }}
                  onPressEnter={() => handleSearch()}
                />
              </Form.Item>
              <Form.Item
                label="合同签订时间范围"
                name="contractSignTimeRange"
              >
                <RangePicker style={{ width: 240 }} />
              </Form.Item>
              <Form.Item
                label="项目开始时间范围"
                name="projectStartTimeRange"
              >
                <RangePicker style={{ width: 240 }} />
              </Form.Item>
              <Form.Item
                label="预计验收时间范围"
                name="projectPlanEndTimeRange"
              >
                <RangePicker style={{ width: 240 }} />
              </Form.Item>
            </div>
          )}
        </Form>
      </div>

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
        <Table<PsProjectPlan>
          rowKey="id"
          columns={columns}
          dataSource={plans}
          loading={loading}
          size="small"
          scroll={{ x: "max-content" }}
          pagination={false}
          locale={{ emptyText: "暂无项目计划" }}
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
    </div>
  );
}
