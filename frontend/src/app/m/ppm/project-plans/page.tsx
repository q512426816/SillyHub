"use client";

/**
 * 项目计划 (PsProjectPlan) · 移动视图。
 *
 * 移动端能力范围（与计划任务一致：只看不建删）：浏览 + 搜索 + 导出 + 查看详情。
 * 新建/编辑/删除在桌面端完成。
 *
 * 数据层 100% 复用（D-003，禁止自写请求）：
 *  - @/lib/ppm：listProjectPlans（分页）/ exportProjectPlans / statusLabel
 *  - 类型 PsProjectPlan / PageReq 来自 @/lib/ppm/types
 *
 * 详情复用桌面 @/components/ppm-project-plan-detail（PpmProjectPlanDetail，
 * 三联表 4 层嵌套，单一源只读引用不改 → 桌面零回归）；移动端以全屏 Modal 承载，
 * 内部 antd Table 窄屏横向滚动可查看。
 *
 * 桌面 `(dashboard)/ppm/project-plans/**` 不改（零回归硬约束）。容器由 app/m/layout 包裹。
 * middleware matcher 含 `/ppm/:path*` → 手机访问 /ppm/project-plans 自动 rewrite 到本页。
 */
import { useCallback, useEffect, useState } from "react";
import { Input } from "antd";

import { MobileCardList } from "@/components/mobile/mobile-card-list";
import { MobileExportButton } from "@/components/mobile/mobile-export-button";
import { PpmProjectPlanDetail } from "@/components/ppm-project-plan-detail";
import { ApiError } from "@/lib/api";
import {
  exportProjectPlans,
  listProjectPlans,
  statusLabel,
  type PageReq,
  type PsProjectPlan,
} from "@/lib/ppm";
import { useToast, Toast } from "@/app/(dashboard)/ppm/shared";
import { cn } from "@/lib/utils";

const DEFAULT_PAGE_SIZE = 20;

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return v.length >= 10 ? v.slice(0, 10) : v;
}

function fmtMoney(v: string | null | undefined): string {
  const n = Number(v ?? 0);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ProjectPlansMobilePage() {
  const { toast, showToast } = useToast();

  const [rows, setRows] = useState<PsProjectPlan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 搜索（服务端）
  const [projectName, setProjectName] = useState("");
  const [contractName, setContractName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [searchNonce, setSearchNonce] = useState(0);

  const [exporting, setExporting] = useState(false);
  const [detailPlanId, setDetailPlanId] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { page?: number; page_size?: number } = {}) => {
      const p = opts.page ?? page;
      const ps = opts.page_size ?? pageSize;
      setLoading(true);
      setError(null);
      try {
        const params: PageReq & {
          project_name?: string;
          contract_name?: string;
          company_name?: string;
        } = { page: p, page_size: ps };
        if (projectName.trim()) params.project_name = projectName.trim();
        if (contractName.trim()) params.contract_name = contractName.trim();
        if (companyName.trim()) params.company_name = companyName.trim();
        const resp = await listProjectPlans(params);
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
    [page, pageSize, projectName, contractName, companyName],
  );

  // 首屏 + 搜索「确定」→ 回第 1 页重拉
  useEffect(() => {
    void load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchNonce]);

  const commitSearch = () => setSearchNonce((n) => n + 1);

  const resetSearch = () => {
    setProjectName("");
    setContractName("");
    setCompanyName("");
    setSearchNonce((n) => n + 1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportProjectPlans();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const renderCard = (p: PsProjectPlan) => {
    const margin = p.profit_margin;
    const marginNum = Number(margin ?? "");
    const marginOver = !Number.isNaN(marginNum) && marginNum < 0;
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded-md bg-violet-100 px-1.5 py-0.5 text-[12px] font-medium text-violet-700">
            {statusLabel(p.status)}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground"
            title={p.company_name ?? ""}
          >
            {p.company_name ?? "—"}
          </span>
        </div>
        <div className="line-clamp-2 text-[14px] font-medium text-foreground">
          {p.project_name ?? "（未命名项目）"}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
          <span>项目经理：{p.project_manager_name ?? "—"}</span>
          <span>合同：{p.contract_name ?? "—"}</span>
        </div>
        <div className="text-[12px] text-muted-foreground">
          周期：{fmtDate(p.project_start_time)} ~{" "}
          {fmtDate(p.project_plan_end_time)}
        </div>
        <div className="text-[12px]">
          <span className="text-muted-foreground">合同金额：</span>
          <span className="font-medium text-foreground">
            {fmtMoney(p.contract_amount)}
          </span>
          {margin ? (
            <>
              <span className="ml-2 text-muted-foreground">利润率：</span>
              <span className={cn("font-medium", marginOver ? "text-red-600" : "text-emerald-600")}>
                {margin}%
              </span>
            </>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <header className="px-1 pb-1">
        <h1 className="text-[18px] font-semibold text-foreground">项目计划</h1>
        <p className="text-[12px] text-muted-foreground">
          {loading ? "加载中…" : "项目计划 / 合同 / 里程碑明细"}
        </p>
      </header>

      {/* 搜索（项目名 / 合同名 / 公司名） */}
      <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-card p-3">
        <Input
          allowClear
          placeholder="项目名称"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          onPressEnter={commitSearch}
          className="!min-h-[44px] !text-[14px]"
        />
        <Input
          allowClear
          placeholder="合同名称"
          value={contractName}
          onChange={(e) => setContractName(e.target.value)}
          onPressEnter={commitSearch}
          className="!min-h-[44px] !text-[14px]"
        />
        <Input
          allowClear
          placeholder="公司名称"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          onPressEnter={commitSearch}
          className="!min-h-[44px] !text-[14px]"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={commitSearch}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground"
          >
            搜索
          </button>
          <button
            type="button"
            onClick={resetSearch}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-card px-4 text-[14px] text-foreground"
          >
            重置
          </button>
        </div>
      </div>

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

      <MobileCardList<PsProjectPlan>
        items={rows}
        renderCard={renderCard}
        onItemPress={(p) => setDetailPlanId(p.id)}
        pagination={{
          page,
          pageSize,
          total,
          onChange: (p) => void load({ page: p, page_size: pageSize }),
        }}
        emptyText={loading ? "加载中…" : "暂无项目计划"}
        headerActions={
          <MobileExportButton
            onClick={() => void handleExport()}
            loading={exporting}
          />
        }
      />

      <Toast toast={toast} />

      {/* 详情：复用桌面 PpmProjectPlanDetail（三联表 4 层嵌套，单一源；移动端全屏 Modal，
          内部 antd Table 窄屏横向滚动可查看） */}
      <PpmProjectPlanDetail
        open={detailPlanId !== null}
        planId={detailPlanId}
        onClose={() => setDetailPlanId(null)}
      />
    </div>
  );
}
