"use client";

/**
 * 里程碑明细 (PsPlanNodeDetail) 页面 — task-04 主子展开 + task-05 表单差异化。
 *
 * 对照源 dept_project_front `psplannode` 下 6 个表单:
 *  - AddNodeDetailForm / NodeDetailForm   草稿新增/编辑(全字段可编辑)
 *  - AuditNodeDetailForm                  审核中(audit_opinion/audit_back_flag 可编辑,其余 disabled)
 *  - ApproveNodeDetailForm                审批中(approve_opinion/approve_back_flag 可编辑;前序审核意见只读)
 *  - ChangeNodeDetailForm                 变更(change_reason 可编辑;前序审核/审批只读)
 *  - ChangeApproveNodeDetailForm          变更审批(change_approve_* 可编辑)
 *  - ViewNodeDetailForm                   只读查看(全 disabled + AntD Timeline 履历)
 *
 * 主子结构沿用 task-04:顶层里程碑 → (实施阶段:模块二级 →) 明细列表。
 * 明细操作列点击「详情/编辑」按 status 打开对应抽屉表单:
 *  - draft → 草稿编辑(create/update PsPlanNodeDetail)
 *  - review → 审核表单(audit_user save/reject)
 *  - approve → 审批表单(approve_user save/reject)
 *  - rejected → 回草稿编辑(重新提交)
 *  - done/archived → 只读查看
 *  - 任意非终态 → 「变更」按钮打开变更表单(change_reason → 生成 parent_id 新版本)
 *
 * AntD Timeline:抽屉底部展示 ps_plan_node_detail_process 履历
 * (listPlanNodeDetailProcesses),按 node_key 染色(正常流转=绿 /
 * 驳回=红 / 变更=橙),人名经 PpmText 解析。
 *
 * task-07 工作日联动:draft 表单 plan_begin_time + plan_workload
 * → addWorkingDaysDate 自动算 plan_complete_time。
 *
 * 设计依据:
 *  - tasks/task-04.md (主子结构)
 *  - tasks/task-05.md (6 状态表单分发 + Timeline + 工作日集成)
 *  - design.md §7 (PpmSubTable + PpmUserSelect + PpmText + PpmFileUrls)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  type TableProps,
  Tag,
  Timeline,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { PpmSubTable } from "@/components/ppm-sub-table";
import { PpmUserSelect } from "@/components/ppm-user-select";
import { PpmFileUrls } from "@/components/ppm-file-urls";
import { PpmText } from "@/components/ppm-text";
import {
  matchAnyUser,
  PLAN_DETAIL_STATUS_COLOR,
  PLAN_DETAIL_STATUS_TEXT,
  PlanDetailActions,
} from "@/components/ppm-status-actions";
import { ApiError } from "@/lib/api";
import {
  fmtDate,
  fmtDateTime,
  changePlanNodeDetailProcess,
  createPlanNodeModule,
  createPsPlanNodeDetail,
  createPsPlanNode,
  deletePlanNodeModule,
  deletePsPlanNodeDetail,
  deletePsPlanNode,
  exportMilestoneDetails,
  getProjectPlan,
  listPlanNodeDetailProcesses,
  listPlanNodeModules,
  listPsPlanNodeDetails,
  listPsPlanNodeDetailVersions,
  listPsPlanNodes,
  rejectPlanNodeDetailProcess,
  savePlanNodeDetailProcess,
  updatePlanNodeModule,
  updatePsPlanNodeDetail,
  updatePsPlanNode,
  type PlanProcessActionReq,
  type PlanChangeProcessReq,
  type PlanNodeModule,
  type PsPlanNode,
  type PsPlanNodeDetail,
  type PsPlanNodeDetailProcess,
} from "@/lib/ppm";
import { addWorkingDaysDate } from "@/lib/ppm/workday";
import { useSession } from "@/stores/session";

/** 实施阶段标识(对齐源 overallStage === '实施阶段' 判定)。 */
const IMPLEMENT_STAGE = "实施阶段";

/** 抽屉形态(对照源 6 Vue 表单 + P0-8 变更审批)。 */
type DrawerMode =
  | "create" // 草稿新增(AddNodeDetailForm)
  | "edit" // 草稿编辑(NodeDetailForm,draft/rejected 返工)
  | "audit" // 审核中(AuditNodeDetailForm)
  | "approve" // 审批中(ApproveNodeDetailForm)
  | "change" // 变更原因录入(ChangeNodeDetailForm)
  | "changeApprove" // 变更审批(ChangeApproveNodeDetailForm,status=change_pending)
  | "view"; // 只读(ViewNodeDetailForm,done/archived)

interface DetailDrawerState {
  open: boolean;
  mode: DrawerMode;
  planNodeId?: string;
  moduleId?: string | null;
  detail?: PsPlanNodeDetail;
}

/**
 * 按明细 status 路由抽屉形态(对照源 6 表单 + P0-8 变更审批),模块级具名导出供单测断言映射。
 *
 * 映射表(对齐 task-04.md「状态 → 表单映射表」):
 *  - draft / rejected → edit(草稿编辑 / 驳回返工)
 *  - review            → audit(审核中)
 *  - approve           → approve(审批中)
 *  - change_pending    → changeApprove(变更审批,对照源 status='5' ChangeApproveNodeDetailForm)
 *  - done / archived   → view(终态只读)
 *  - 未识别状态        → view(降级只读,边界 1,不报错)
 *
 * 注:backend/app/modules/ppm/plan/fsm.py 当前状态机无 change_pending
 * (变更直接生成 draft 新版本 + 旧版本 archived),此分支为前端预留。
 */
export function modeForStatus(status: string): DrawerMode {
  switch (status) {
    case "draft":
    case "rejected":
      return "edit"; // 草稿 / 驳回返工:回草稿编辑
    case "review":
      return "audit";
    case "approve":
      return "approve";
    case "change_pending":
      return "changeApprove";
    case "done":
    case "archived":
    default:
      return "view";
  }
}

// modeForStatus 已提到模块级具名导出(见上),组件内直接复用,无需闭包转发。

export default function MilestoneDetailsPage() {
  const params = useSearchParams();
  const planId = params.get("plan") ?? "";
  const { user: currentUser } = useSession();
  const currentUserId = currentUser?.id ?? "";

  const [psNodes, setPsNodes] = useState<PsPlanNode[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectManagerId, setProjectManagerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DetailDrawerState>({
    open: false,
    mode: "view",
  });
  // P0-7:里程碑主表(PsPlanNode)CRUD 抽屉状态。
  const [masterDrawer, setMasterDrawer] = useState<{
    open: boolean;
    mode: "create" | "edit";
    node?: PsPlanNode;
  }>({ open: false, mode: "create" });
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  // plan 内前端过滤(overallStage/detailedStage/taskTheme):后端无对应过滤参数。
  const [overallStageFilter, setOverallStageFilter] = useState<string>("");
  const [detailedStageFilter, setDetailedStageFilter] = useState<string>("");
  const [taskThemeFilter, setTaskThemeFilter] = useState<string>("");

  // 里程碑列表 + 项目 ID(供 PpmUserSelect 的 searchData.pm_project_id)
  useEffect(() => {
    if (!planId) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const plan = await getProjectPlan(planId);
        setProjectId(plan.project_id ?? null);
        setProjectManagerId(plan.project_manager_id ?? null);
        const list = await listPsPlanNodes(planId);
        setPsNodes(list);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载里程碑失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [planId]);

  // readOnlyFlag:平台超管 bypass,否则非项目经理(无 create_user_id,退化为 project_manager_id)→ 只读
  const readOnly =
    !currentUser?.is_platform_admin && !matchAnyUser([projectManagerId], currentUserId);

  // 主表前端过滤:总体阶段(plan 内)
  const filteredNodes = useMemo(() => {
    const kw = overallStageFilter.trim().toLowerCase();
    if (!kw) return psNodes;
    return psNodes.filter((n) =>
      (n.overall_stage ?? "").toLowerCase().includes(kw),
    );
  }, [psNodes, overallStageFilter]);

  const reload = useCallback(async () => {
    try {
      setPsNodes(await listPsPlanNodes(planId));
    } catch {
      // 静默,错误已由顶层 effect 处理
    }
  }, [planId]);

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  };

  // P2-3:里程碑明细导出(对照源 psplannodedetail 导出)。
  const handleExport = async () => {
    setExporting(true);
    try {
      await exportMilestoneDetails();
      showToast(true, "导出已开始");
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  // P0-7:里程碑主表删除(对照源 OpenPlanNodeForm.handleDelete)。
  const handleDeleteNode = useCallback(
    async (n: PsPlanNode) => {
      if (!confirm(`删除里程碑「${n.task_theme ?? n.no ?? n.id}」及其所有明细?`))
        return;
      try {
        await deletePsPlanNode(n.id);
        showToast(true, "已删除里程碑");
        await reload();
      } catch (err) {
        showToast(false, err instanceof ApiError ? err.message : "删除里程碑失败");
      }
    },
    [reload],
  );

  // modeForStatus 已提到模块级具名导出,组件内直接复用,无需闭包转发。

  /**
   * 流程动作提交(save/reject/change)。表单 body 由调用方提供:
   *  - audit/approve 表单:handle_info(意见)
   *  - change 表单:change_reason
   *  - changeApprove 表单(P0-8):change_approve_back_flag + change_approve_opinion
   * 列表行内 PlanDetailActions 不带 body 时走 prompt 兜底(保留旧行为)。
   */
  const handleSubmit = async (
    detailId: string,
    action: "save" | "reject" | "change",
    body?: {
      handleInfo?: string;
      changeReason?: string;
      changeApproveBackFlag?: string;
      changeApproveOpinion?: string;
    },
  ) => {
    let rejectBody: PlanProcessActionReq | undefined;
    let changeBody: PlanChangeProcessReq | undefined;
    if (action === "reject") {
      const handleInfo =
        body?.handleInfo ?? (prompt("驳回意见(可选):") ?? "");
      rejectBody = { handle_info: handleInfo || null };
      // P0-8:变更审批驳回透传 change_approve_* 字段(对照源 ChangeApproveNodeDetailForm)。
      if (body?.changeApproveBackFlag) {
        rejectBody.change_approve_back_flag = body.changeApproveBackFlag;
        rejectBody.change_approve_opinion = body.changeApproveOpinion ?? null;
      }
    } else if (action === "change") {
      const changeReason =
        body?.changeReason ?? (prompt("变更原因(必填):") ?? "");
      if (!changeReason.trim()) {
        showToast(false, "变更原因不能为空");
        return;
      }
      changeBody = { change_reason: changeReason };
    } else if (body?.handleInfo) {
      // save 动作也可携带意见(audit/approve 通过意见)
      rejectBody = undefined; // save 不用 rejectBody
    }
    const saveBody: PlanProcessActionReq | undefined =
      action === "save" && body?.handleInfo
        ? { handle_info: body.handleInfo }
        : undefined;
    // P0-8:变更审批同意透传 change_approve_* 字段。
    if (
      action === "save" &&
      saveBody &&
      body?.changeApproveBackFlag
    ) {
      saveBody.change_approve_back_flag = body.changeApproveBackFlag;
      saveBody.change_approve_opinion = body.changeApproveOpinion ?? null;
    }
    try {
      if (action === "save") {
        await savePlanNodeDetailProcess(detailId, saveBody);
        showToast(true, "已提交");
      } else if (action === "reject") {
        await rejectPlanNodeDetailProcess(detailId, rejectBody);
        showToast(true, "已驳回");
      } else {
        await changePlanNodeDetailProcess(detailId, changeBody);
        showToast(true, "已创建变更新版本");
      }
    } catch (err) {
      // AC-8 并发审批乐观锁:后端 StateMachine 在状态已被他人推进时抛 422/
      // 状态不匹配(InvalidTransition)。识别到该类错误 → reload 列表拉最新状态
      // + 友好提示「该明细已被他人处理」,避免用户对着陈旧状态脏写重试。
      const isConcurrent =
        err instanceof ApiError &&
        (err.status === 422 || err.status === 409);
      if (isConcurrent) {
        showToast(false, "该明细已被他人处理,列表已刷新,请重试");
        void reload();
      } else {
        showToast(false, err instanceof ApiError ? err.message : "操作失败");
      }
    }
  };

  // 顶层里程碑主表列(展开行模式)
  const masterColumns = useMemo<TableProps<PsPlanNode>["columns"]>(
    () => [
      {
        title: "序号",
        dataIndex: "no",
        key: "no",
        width: 80,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "总体阶段",
        dataIndex: "overall_stage",
        key: "overall_stage",
        width: 140,
        render: (v: string | null) => (
          <div className="flex items-center gap-2">
            <span>{v ?? "—"}</span>
            {v === IMPLEMENT_STAGE && (
              <Tag color="blue" className="text-[10px]">
                三级
              </Tag>
            )}
          </div>
        ),
      },
      {
        title: "任务主题",
        dataIndex: "task_theme",
        key: "task_theme",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "责任人",
        dataIndex: "duty_user_id",
        key: "duty_user_id",
        width: 200,
        render: (v: string | null) =>
          projectId ? (
            <PpmUserSelect
              res="projectMember"
              searchData={{ pm_project_id: projectId }}
              value={v}
              disabled
              allowClear={false}
              placeholder="未指派"
            />
          ) : (
            <span className="text-xs text-muted-foreground">{v ?? "未指派"}</span>
          ),
      },
      {
        title: "预计工作量",
        dataIndex: "plan_workload",
        key: "plan_workload",
        width: 120,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "计划开始",
        dataIndex: "plan_begin_time",
        key: "plan_begin_time",
        width: 130,
        render: (v: string | null) => fmtDate(v),
      },
      {
        title: "计划结束",
        dataIndex: "plan_complete_time",
        key: "plan_complete_time",
        width: 130,
        render: (v: string | null) => fmtDate(v),
      },
      {
        title: "操作",
        key: "actions",
        align: "right",
        width: 280,
        render: (_v: unknown, n: PsPlanNode) => (
          <div className="flex flex-wrap justify-end gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly}
              title={readOnly ? "只读模式(非项目经理)" : undefined}
              onClick={() =>
                setDrawer({
                  open: true,
                  mode: "create",
                  planNodeId: n.id,
                  moduleId: n.overall_stage === IMPLEMENT_STAGE ? null : null,
                })
              }
            >
              + 新建明细
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={readOnly}
              title={readOnly ? "只读模式(非项目经理)" : undefined}
              onClick={() =>
                setMasterDrawer({ open: true, mode: "edit", node: n })
              }
            >
              编辑里程碑
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={readOnly}
              title={readOnly ? "只读模式(非项目经理)" : undefined}
              onClick={() => void handleDeleteNode(n)}
            >
              删除里程碑
            </Button>
          </div>
        ),
      },
    ],
    [projectId, handleDeleteNode, readOnly],
  );

  /** 打开明细抽屉,mode 默认按 status 路由,可显式覆盖(change/view)。 */
  const openDetail = useCallback(
    (nodeId: string, detail: PsPlanNodeDetail, mode?: DrawerMode) => {
      setDrawer({
        open: true,
        mode: mode ?? modeForStatus(detail.status),
        planNodeId: nodeId,
        moduleId: detail.module_id ?? null,
        detail,
      });
    },
    [],
  );

  // 展开行渲染:实施阶段→模块二级→明细三级;其他→明细二级
  const expandRender = useCallback(
    (node: PsPlanNode) => {
      if (node.overall_stage === IMPLEMENT_STAGE) {
        return (
          <ModuleLevelTable
            planNodeId={node.id}
            projectId={projectId}
            onAddDetail={(moduleId) =>
              setDrawer({
                open: true,
                mode: "create",
                planNodeId: node.id,
                moduleId,
              })
            }
            onOpenDetail={(d, mode) => openDetail(node.id, d, mode)}
            onSubmitDetail={handleSubmit}
            currentUserId={currentUserId}
            detailedStageFilter={detailedStageFilter}
            taskThemeFilter={taskThemeFilter}
            readOnly={readOnly}
          />
        );
      }
      return (
        <DetailLevelTable
          planNodeId={node.id}
          moduleId={null}
          onAddDetail={() =>
            setDrawer({
              open: true,
              mode: "create",
              planNodeId: node.id,
              moduleId: null,
            })
          }
          onOpenDetail={(d, mode) => openDetail(node.id, d, mode)}
          onSubmitDetail={handleSubmit}
          currentUserId={currentUserId}
          detailedStageFilter={detailedStageFilter}
          taskThemeFilter={taskThemeFilter}
          readOnly={readOnly}
        />
      );
    },
    [projectId, currentUserId, openDetail, detailedStageFilter, taskThemeFilter, readOnly],
  );

  if (!planId) {
    return (
      <PageContainer>
        <p className="py-10 text-center text-sm text-muted-foreground">
          请从「项目计划」页选择一条计划进入里程碑明细。
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="full">
      <PageHeader
        title="里程碑明细"
        subtitle={
          <>
            计划 {planId}
            {projectId ? ` · 项目 ${projectId}` : ""} · 实施阶段三级(里程碑→模块→明细),其他阶段二级
            {readOnly && " · 只读模式(非项目经理)"}
          </>
        }
      />

      {/* plan 内前端过滤(后端无对应过滤参数) */}
      <SectionCard bodyPadding="p-2">
        {/* 顶部按钮行:右对齐(重置 | 分隔 | 导出 | 新建里程碑 | 刷新) */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setOverallStageFilter("");
              setDetailedStageFilter("");
              setTaskThemeFilter("");
            }}
          >
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
          <Button
            size="sm"
            disabled={readOnly}
            title={readOnly ? "只读模式(非项目经理)" : undefined}
            onClick={() => setMasterDrawer({ open: true, mode: "create" })}
          >
            + 新建里程碑
          </Button>
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            刷新
          </Button>
        </div>

        {/* 查询条件:垂直 grid-cols-4(前端实时过滤,输入即生效) */}
        <div className="grid w-full grid-cols-4 gap-3">
          <Field label="总体阶段">
            <Input
              allowClear
              className="w-full"
              placeholder="总体阶段"
              value={overallStageFilter}
              onChange={(e) => setOverallStageFilter(e.target.value)}
            />
          </Field>
          <Field label="明细阶段">
            <Input
              allowClear
              className="w-full"
              placeholder="明细阶段"
              value={detailedStageFilter}
              onChange={(e) => setDetailedStageFilter(e.target.value)}
            />
          </Field>
          <Field label="任务主题">
            <Input
              allowClear
              className="w-full"
              placeholder="任务主题"
              value={taskThemeFilter}
              onChange={(e) => setTaskThemeFilter(e.target.value)}
            />
          </Field>
          <div className="self-end text-right text-xs text-muted-foreground">
            注:明细阶段/任务主题过滤在展开明细行内生效
          </div>
        </div>
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

      {error ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : (
        <PpmSubTable<PsPlanNode>
          masterRows={filteredNodes}
          masterColumns={masterColumns}
          expandRender={expandRender}
          expandableTriggerField="id"
          tableProps={{
            loading,
            pagination: false,
            bordered: true,
            // 不设 scroll.y:本页是主子表展开页,固定高度会让展开的明细子表
            // 表头被主表 sticky header 压住、末行超出 body 可视底部(首尾被切割)。
            // 主表随里程碑行数 + 展开子表自然撑高、整页滚动,子表完整可见。
            scroll: { x: "max-content" },
          }}
        />
      )}

      {drawer.open && drawer.planNodeId && (
        <DetailDrawer
          key={drawer.detail?.id ?? "new"}
          mode={drawer.mode}
          planNodeId={drawer.planNodeId}
          moduleId={drawer.moduleId ?? null}
          detail={drawer.detail}
          projectId={projectId}
          currentUserId={currentUserId}
          onClose={() => setDrawer({ open: false, mode: "view" })}
          onSaved={() => setDrawer({ open: false, mode: "view" })}
          onSubmit={handleSubmit}
        />
      )}

      {/* P0-7:里程碑主表(PsPlanNode)CRUD 抽屉,对照源 PsPlanNodeForm 7 字段。 */}
      <PsPlanNodeDrawer
        open={masterDrawer.open}
        mode={masterDrawer.mode}
        node={masterDrawer.node}
        planId={planId}
        projectId={projectId}
        nextNo={String(psNodes.length + 1)}
        onClose={() => setMasterDrawer({ open: false, mode: "create" })}
        onSaved={() => {
          setMasterDrawer({ open: false, mode: "create" });
          void reload();
        }}
      />
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// 模块中间层(实施阶段二级)→ 模块行展开 → 明细三级
// ---------------------------------------------------------------------------

interface ModuleLevelProps {
  planNodeId: string;
  projectId: string | null;
  onAddDetail: (moduleId: string | null) => void;
  onOpenDetail: (d: PsPlanNodeDetail, mode?: DrawerMode) => void;
  onSubmitDetail: (
    detailId: string,
    action: "save" | "reject" | "change",
    body?: {
      handleInfo?: string;
      changeReason?: string;
      changeApproveBackFlag?: string;
      changeApproveOpinion?: string;
    },
  ) => void;
  currentUserId: string;
  /** plan 内前端过滤:明细阶段。 */
  detailedStageFilter?: string;
  /** plan 内前端过滤:任务主题。 */
  taskThemeFilter?: string;
  /** 只读模式(非项目经理):禁用写入按钮。 */
  readOnly?: boolean;
}

function ModuleLevelTable({
  planNodeId,
  projectId,
  onAddDetail,
  onOpenDetail,
  onSubmitDetail,
  currentUserId,
  detailedStageFilter,
  taskThemeFilter,
  readOnly,
}: ModuleLevelProps) {
  const [modules, setModules] = useState<PlanNodeModule[]>([]);
  const [loading, setLoading] = useState(true);
  // P2-2:模块 CRUD 抽屉状态
  const [moduleDrawer, setModuleDrawer] = useState<{
    open: boolean;
    mode: "create" | "edit";
    module?: PlanNodeModule;
  }>({ open: false, mode: "create" });
  const [moduleSaving, setModuleSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setModules(await listPlanNodeModules(planNodeId));
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, [planNodeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // P2-2:模块 CRUD(对照源 PlanNodeModuleTable.vue)
  const handleSaveModule = async (
    vals: Pick<
      PlanNodeModule,
      | "module_name"
      | "plan_workload"
      | "plan_begin_time"
      | "plan_complete_time"
      | "duty_user_id"
    >,
  ) => {
    setModuleSaving(true);
    try {
      if (moduleDrawer.mode === "edit" && moduleDrawer.module) {
        await updatePlanNodeModule(moduleDrawer.module.id, vals);
      } else {
        await createPlanNodeModule({ ...vals, plan_node_id: planNodeId });
      }
      setModuleDrawer({ open: false, mode: "create" });
      await reload();
    } finally {
      setModuleSaving(false);
    }
  };

  const handleDeleteModule = async (m: PlanNodeModule) => {
    if (!confirm(`删除模块「${m.module_name ?? m.id}」?`)) return;
    try {
      await deletePlanNodeModule(m.id);
      await reload();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "删除模块失败",
      );
    }
  };

  const moduleColumns = useMemo<TableProps<PlanNodeModule>["columns"]>(
    () => [
      {
        title: "模块名称",
        dataIndex: "module_name",
        key: "module_name",
        render: (v: string | null) => v ?? "(未命名模块)",
      },
      {
        title: "责任人",
        dataIndex: "duty_user_id",
        key: "duty_user_id",
        width: 200,
        render: (v: string | null) =>
          projectId ? (
            <PpmUserSelect
              res="projectMember"
              searchData={{ pm_project_id: projectId }}
              value={v}
              disabled
              allowClear={false}
              placeholder="未指派"
            />
          ) : (
            <span className="text-xs text-muted-foreground">
              {v ?? "未指派"}
            </span>
          ),
      },
      {
        title: "计划工作量",
        dataIndex: "plan_workload",
        key: "plan_workload",
        width: 120,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "计划开始",
        dataIndex: "plan_begin_time",
        key: "plan_begin_time",
        width: 130,
        render: (v: string | null) => fmtDate(v),
      },
      {
        title: "计划结束",
        dataIndex: "plan_complete_time",
        key: "plan_complete_time",
        width: 130,
        render: (v: string | null) => fmtDate(v),
      },
      {
        title: "操作",
        key: "actions",
        align: "right",
        width: 260,
        render: (_v: unknown, m: PlanNodeModule) => (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly}
              title={readOnly ? "只读模式(非项目经理)" : undefined}
              onClick={() => onAddDetail(m.id)}
            >
              + 新建明细
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly}
              title={readOnly ? "只读模式(非项目经理)" : undefined}
              onClick={() =>
                setModuleDrawer({ open: true, mode: "edit", module: m })
              }
            >
              编辑
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={readOnly}
              title={readOnly ? "只读模式(非项目经理)" : undefined}
              onClick={() => void handleDeleteModule(m)}
            >
              删除
            </Button>
          </div>
        ),
      },
    ],
    [projectId, onAddDetail, readOnly, handleDeleteModule],
  );

  const moduleExpandRender = useCallback(
    (m: PlanNodeModule) => (
      <DetailLevelTable
        planNodeId={planNodeId}
        moduleId={m.id}
        moduleName={m.module_name}
        onAddDetail={() => onAddDetail(m.id)}
        onOpenDetail={onOpenDetail}
        onSubmitDetail={onSubmitDetail}
        currentUserId={currentUserId}
        detailedStageFilter={detailedStageFilter}
        taskThemeFilter={taskThemeFilter}
        readOnly={readOnly}
      />
    ),
    [
      planNodeId,
      onAddDetail,
      onOpenDetail,
      onSubmitDetail,
      currentUserId,
      detailedStageFilter,
      taskThemeFilter,
      readOnly,
    ],
  );

  return (
    <div className="rounded bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium text-foreground">
          模块(实施阶段)
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly}
          title={readOnly ? "只读模式(非项目经理)" : undefined}
          onClick={() => setModuleDrawer({ open: true, mode: "create" })}
        >
          + 新建模块
        </Button>
      </div>
      <PpmSubTable<PlanNodeModule>
        masterRows={modules}
        masterColumns={moduleColumns}
        expandRender={moduleExpandRender}
        expandableTriggerField="id"
        tableProps={{
          loading,
          pagination: false,
          bordered: true,
          scroll: { x: "max-content" },
        }}
      />
      <ModuleFormDrawer
        open={moduleDrawer.open}
        mode={moduleDrawer.mode}
        module={moduleDrawer.module}
        projectId={projectId}
        saving={moduleSaving}
        onClose={() => setModuleDrawer({ open: false, mode: "create" })}
        onSave={(vals) => void handleSaveModule(vals)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// P2-2:模块 CRUD 抽屉(对照源 PlanNodeModuleForm.vue)
// 字段:moduleName / planWorkload(InputNumber step=0.5)/ planBeginTime /
//       planCompleteTime(DatePicker YYYY-MM-DD)/ dutyUserId(PpmUserSelect)
// ---------------------------------------------------------------------------

interface ModuleFormDrawerProps {
  open: boolean;
  mode: "create" | "edit";
  module?: PlanNodeModule;
  projectId: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (vals: {
    module_name: string | null;
    plan_workload: string | null;
    plan_begin_time: string | null;
    plan_complete_time: string | null;
    duty_user_id: string | null;
  }) => void;
}

function ModuleFormDrawer({
  open,
  mode,
  module: moduleRow,
  projectId,
  saving,
  onClose,
  onSave,
}: ModuleFormDrawerProps) {
  const [form] = Form.useForm<{
    module_name: string;
    plan_workload: string;
    plan_begin_time: string;
    plan_complete_time: string;
    duty_user_id: string;
  }>();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      module_name: moduleRow?.module_name ?? "",
      plan_workload: moduleRow?.plan_workload ?? "",
      plan_begin_time: moduleRow?.plan_begin_time ?? "",
      plan_complete_time: moduleRow?.plan_complete_time ?? "",
      duty_user_id: moduleRow?.duty_user_id ?? "",
    });
  }, [open, moduleRow, form]);

  const submit = async () => {
    const vals = await form.validateFields();
    onSave({
      module_name: vals.module_name || null,
      plan_workload: vals.plan_workload ?? null,
      plan_begin_time: vals.plan_begin_time || null,
      plan_complete_time: vals.plan_complete_time || null,
      duty_user_id: vals.duty_user_id || null,
    });
  };

  return (
    <Drawer
      open={open}
      title={mode === "create" ? "新建模块" : "编辑模块"}
      width={520}
      onClose={onClose}
      destroyOnClose
      maskClosable={false}
      extra={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void submit()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="模块名称"
          name="module_name"
          rules={[{ required: true, message: "请输入模块名称" }]}
        >
          <Input placeholder="如:需求分析模块" />
        </Form.Item>
        <Form.Item label="计划工作量(工作日)" name="plan_workload">
          <InputNumber
            placeholder="如 5"
            step={0.5}
            precision={1}
            min={0}
            className="w-full"
          />
        </Form.Item>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item label="计划开始时间">
            <DatePicker
              className="w-full"
              format="YYYY-MM-DD"
              value={toDay(form.getFieldValue("plan_begin_time"))}
              onChange={(d) =>
                form.setFieldValue("plan_begin_time", fromDate(d))
              }
            />
          </Form.Item>
          <Form.Item label="计划完成时间">
            <DatePicker
              className="w-full"
              format="YYYY-MM-DD"
              value={toDay(form.getFieldValue("plan_complete_time"))}
              onChange={(d) =>
                form.setFieldValue("plan_complete_time", fromDate(d))
              }
            />
          </Form.Item>
        </div>
        <Form.Item label="责任人" name="duty_user_id">
          {projectId ? (
            <PpmUserSelect
              res="projectMember"
              searchData={{ pm_project_id: projectId }}
              allowClear
              placeholder="选择责任人(项目成员)"
            />
          ) : (
            <Input placeholder="需要先选择项目" disabled />
          )}
        </Form.Item>
      </Form>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// 明细列表(二级 / 三级通用,按 moduleId 过滤)
// ---------------------------------------------------------------------------

interface DetailLevelProps {
  planNodeId: string;
  /** null/undefined = 该里程碑下所有明细;string = 仅该模块下的明细。 */
  moduleId: string | null;
  /** 模块名称(实施阶段模块行展开透传,标题展示用);空兜底"(未命名模块)"。 */
  moduleName?: string | null;
  onAddDetail: () => void;
  onOpenDetail: (d: PsPlanNodeDetail, mode?: DrawerMode) => void;
  onSubmitDetail: (
    detailId: string,
    action: "save" | "reject" | "change",
    body?: {
      handleInfo?: string;
      changeReason?: string;
      changeApproveBackFlag?: string;
      changeApproveOpinion?: string;
    },
  ) => void;
  currentUserId: string;
  /** plan 内前端过滤:明细阶段。 */
  detailedStageFilter?: string;
  /** plan 内前端过滤:任务主题。 */
  taskThemeFilter?: string;
  /** 只读模式(非项目经理):禁用写入按钮。 */
  readOnly?: boolean;
}

function DetailLevelTable({
  planNodeId,
  moduleId,
  moduleName,
  onAddDetail,
  onOpenDetail,
  onSubmitDetail,
  currentUserId,
  detailedStageFilter,
  taskThemeFilter,
  readOnly,
}: DetailLevelProps) {
  const [details, setDetails] = useState<PsPlanNodeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await listPsPlanNodeDetails(planNodeId);
      const filtered =
        moduleId == null
          ? all
          : all.filter((d) => d.module_id === moduleId);
      setDetails(filtered);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载明细失败");
    } finally {
      setLoading(false);
    }
  }, [planNodeId, moduleId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // plan 内前端过滤:明细阶段 / 任务主题
  const visibleDetails = useMemo(() => {
    const ds = detailedStageFilter?.trim().toLowerCase() ?? "";
    const tt = taskThemeFilter?.trim().toLowerCase() ?? "";
    if (!ds && !tt) return details;
    return details.filter((d) => {
      if (ds && !(d.detailed_stage ?? "").toLowerCase().includes(ds)) {
        return false;
      }
      if (tt && !(d.task_theme ?? "").toLowerCase().includes(tt)) {
        return false;
      }
      return true;
    });
  }, [details, detailedStageFilter, taskThemeFilter]);

  const handleDelete = async (d: PsPlanNodeDetail) => {
    if (d.status !== "draft") return;
    if (!confirm("删除该里程碑明细?")) return;
    try {
      await deletePsPlanNodeDetail(d.id);
      await reload();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "删除里程碑明细失败",
      );
    }
  };

  const columns = useMemo<TableProps<PsPlanNodeDetail>["columns"]>(
    () => [
      {
        title: "明细阶段",
        dataIndex: "detailed_stage",
        key: "detailed_stage",
        render: (v: string | null, d: PsPlanNodeDetail) => (
          <div className="flex items-center gap-2">
            <span>{v ?? "—"}</span>
            {d.parent_id && (
              <Tag color="purple" className="text-[10px]">
                变更版
              </Tag>
            )}
          </div>
        ),
      },
      {
        title: "任务主题",
        dataIndex: "task_theme",
        key: "task_theme",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "角色",
        dataIndex: "role_name",
        key: "role_name",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "计划工时",
        dataIndex: "plan_workload",
        key: "plan_workload",
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "审核人",
        dataIndex: "audit_user_name",
        key: "audit_user_name",
        render: (v: string | null, d: PsPlanNodeDetail) =>
          v ?? (d.audit_user_id ? d.audit_user_id : "待指派"),
      },
      {
        title: "审批人",
        dataIndex: "approve_user_name",
        key: "approve_user_name",
        render: (v: string | null, d: PsPlanNodeDetail) =>
          v ?? (d.approve_user_id ? d.approve_user_id : "待指派"),
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        render: (v: string) => (
          <Tag color={PLAN_DETAIL_STATUS_COLOR[v] ?? "default"}>
            {PLAN_DETAIL_STATUS_TEXT[v] ?? v}
          </Tag>
        ),
      },
      {
        title: "操作",
        key: "actions",
        align: "right",
        width: 280,
        render: (_v: unknown, d: PsPlanNodeDetail) => (
          <div className="flex flex-wrap justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => onOpenDetail(d)}>
              详情
            </Button>
            {(d.status === "draft" || d.status === "rejected") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenDetail(d)}
              >
                编辑
              </Button>
            )}
            <PlanDetailActions
              detail={d}
              currentUserId={currentUserId}
              disabled={readOnly}
              onSubmit={(id, action) => {
                // change 动作:打开变更原因录入抽屉(对齐源 ChangeNodeDetailForm),
                // 其余动作(save/reject)在抽屉内填意见后提交,此处直接走 prompt 兜底。
                if (action === "change") {
                  onOpenDetail(d, "change");
                } else {
                  void onSubmitDetail(id, action);
                }
              }}
            />
            {d.status === "draft" && (
              <Button
                size="sm"
                variant="destructive"
                disabled={readOnly}
                title={readOnly ? "只读模式(非项目经理)" : undefined}
                onClick={() => void handleDelete(d)}
              >
                删除
              </Button>
            )}
          </div>
        ),
      },
    ],
    [currentUserId, onOpenDetail, onSubmitDetail, readOnly],
  );

  return (
    <div className="rounded bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">
          明细{moduleId ? ` · 模块 ${moduleName || "(未命名模块)"}` : ""}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly}
          title={readOnly ? "只读模式(非项目经理)" : undefined}
          onClick={onAddDetail}
        >
          + 新建明细
        </Button>
      </div>
      {error ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : (
        <DataTable<PsPlanNodeDetail>
          rowKey="id"
          columns={columns}
          dataSource={visibleDetails}
          loading={loading}
          size="small"
          bordered
          pagination={false}
          scroll={{ x: "max-content" }}
          emptyText={moduleId ? "该模块暂无明细" : "暂无明细"}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 明细抽屉:按 mode 分发到 6 类表单(对照源 6 Vue 表单)
// ---------------------------------------------------------------------------

/** AntD Form 字段值集合(松散,按需取)。 */
type FormVals = Record<string, string | number | null | undefined | string[]>;

/** 把字符串/null 归一为 Dayjs(空值返回 null)。 */
function toDay(v: string | null | undefined): Dayjs | null {
  if (!v) return null;
  const d = dayjs(v);
  return d.isValid() ? d : null;
}

/** 查询条件外壳:垂直布局(标题在上,控件在下),对齐 project-plans 风格。 */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-xs leading-4 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Dayjs → 'YYYY-MM-DD' 或 null。 */
function fromDate(d: Dayjs | null): string | null {
  return d ? d.format("YYYY-MM-DD") : null;
}

/**
 * 流程履历 node_key → AntD Timeline 颜色(对齐源 ViewNodeDetailForm)。
 *
 * 后端 ``business_type`` 恒为 ``PROCESS_BUSINESS_TYPE`` 常量
 * (``"ps_plan_node_detail"``),区分信息在 ``node_key``:
 *  - ``f"{from}->rejected"`` (如 ``review->rejected``) → 驳回,红
 *  - ``"change"``                          → 变更,橙
 *  - 其余 ``f"{from}->{to}"`` (如 ``draft->review``) → 正常流转,绿
 */
function processColor(nodeKey: string | null | undefined): string {
  if (!nodeKey) return "green";
  if (nodeKey.includes("reject")) return "red";
  if (nodeKey === "change" || nodeKey.includes("change")) return "orange";
  return "green";
}

function DetailDrawer({
  mode,
  planNodeId,
  moduleId,
  detail,
  projectId,
  currentUserId,
  onClose,
  onSaved,
  onSubmit,
}: {
  mode: DrawerMode;
  planNodeId: string;
  moduleId: string | null;
  detail?: PsPlanNodeDetail;
  projectId: string | null;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
  onSubmit: (
    detailId: string,
    action: "save" | "reject" | "change",
    body?: {
      handleInfo?: string;
      changeReason?: string;
      changeApproveBackFlag?: string;
      changeApproveOpinion?: string;
    },
  ) => void;
}) {
  const [form] = Form.useForm<FormVals>();

  // 所属模块下拉选项:按 planNodeId 自取当前里程碑下的模块列表(plan_node_module)。
  // DetailDrawer 在主组件渲染、模块数据在 ModuleLevelTable 子组件,跨层级透传别扭,
  // 故明细抽屉按自身 planNodeId 直接拉取,自包含且选项始终与当前里程碑一致。
  const [modules, setModules] = useState<PlanNodeModule[]>([]);
  useEffect(() => {
    if (!planNodeId) {
      setModules([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await listPlanNodeModules(planNodeId);
        if (!cancelled) setModules(list);
      } catch {
        // 模块列表加载失败不阻塞,降级为空下拉
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planNodeId]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [logs, setLogs] = useState<PsPlanNodeDetailProcess[]>([]);
  const [versions, setVersions] = useState<PsPlanNodeDetail[]>([]);

  // ── 模式语义(对照源) ────────────────────────────────────────────────────
  // 开立信息块只读性:仅 create/edit 可编辑(草稿新增/编辑 + rejected 返工)。
  const baseEditable = mode === "create" || mode === "edit";
  // 审核意见块可编辑:audit 模式 + 当前用户是审核人。
  const auditEditable =
    mode === "audit" &&
    !!detail?.audit_user_id &&
    matchAnyUser([detail.audit_user_id], currentUserId);
  // 审批意见块可编辑:approve 模式 + 当前用户是审批人。
  const approveEditable =
    mode === "approve" &&
    !!detail?.approve_user_id &&
    matchAnyUser([detail.approve_user_id], currentUserId);
  // P0-8:变更审批意见块可编辑:changeApprove 模式 + 当前用户是审批人
  // (对照源 ChangeApproveNodeDetailForm:status=change_pending 时由审批人
  // 填 changeApproveBackFlag/changeApproveOpinion)。
  const changeApproveEditable =
    mode === "changeApprove" &&
    !!detail?.approve_user_id &&
    matchAnyUser([detail.approve_user_id], currentUserId);
  // 变更原因块仅在 change 模式渲染,进入即默认可编辑,无需额外 disabled 计算。

  // 初值:detail 优先,否则用 moduleId 兜底。
  const initialValues = useMemo<FormVals>(
    () => ({
      detailed_stage: detail?.detailed_stage ?? "",
      task_theme: detail?.task_theme ?? "",
      task_description: detail?.task_description ?? "",
      requirements: detail?.requirements ?? "",
      role_name: detail?.role_name ?? "",
      achievement: detail?.achievement ?? "",
      plan_workload: detail?.plan_workload ?? "",
      plan_begin_time: detail?.plan_begin_time ?? "",
      plan_complete_time: detail?.plan_complete_time ?? "",
      module_id: detail?.module_id ?? moduleId ?? "",
      execute_user_id: detail?.execute_user_id ?? "",
      audit_user_id: detail?.audit_user_id ?? "",
      approve_user_id: detail?.approve_user_id ?? "",
      file_urls: detail?.file_urls ?? [],
      // 审批意见块默认值(对齐源:非驳回 + 「同意」)
      audit_back_flag: detail?.status === "review" ? "0" : detail?.audit_user_id ? "0" : undefined,
      audit_opinion: detail?.status === "review" ? "同意" : undefined,
      approve_back_flag: detail?.status === "approve" ? "0" : undefined,
      approve_opinion: detail?.status === "approve" ? "同意" : undefined,
      // P0-8:变更审批块默认值(对齐源 ChangeApproveNodeDetailForm:同意)。
      change_approve_back_flag:
        detail?.status === "change_pending" ? "0" : undefined,
      change_approve_opinion:
        detail?.status === "change_pending" ? "同意" : undefined,
      change_reason: "",
    }),
    [detail, moduleId],
  );

  useEffect(() => {
    form.setFieldsValue(initialValues);
  }, [form, initialValues]);

  // 履历 + 版本链(编辑态明细才拉)。
  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    void (async () => {
      try {
        const [v, l] = await Promise.all([
          listPsPlanNodeDetailVersions(detail.id),
          listPlanNodeDetailProcesses(detail.id),
        ]);
        if (cancelled) return;
        setVersions(v);
        setLogs(l);
      } catch {
        // 历史加载失败不阻塞编辑
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail]);

  // task-07 工作日联动:plan_begin_time + plan_workload → plan_complete_time
  // (仅 draft/edit 模式,且用户未手填 plan_complete_time 时自动算)。
  const recomputeComplete = useCallback(
    (begin?: string | null, workload?: string | null) => {
      if (!baseEditable) return;
      const b = begin ?? form.getFieldValue("plan_begin_time");
      const w = workload ?? form.getFieldValue("plan_workload");
      if (!b || !w) return;
      const days = Number(w);
      if (!Number.isFinite(days) || days <= 0) return;
      try {
        const computed = addWorkingDaysDate(b as string, days);
        form.setFieldValue("plan_complete_time", computed);
      } catch {
        // 联动失败忽略
      }
    },
    [baseEditable, form],
  );

  // ── 提交 ────────────────────────────────────────────────────────────────
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const vals = await form.validateFields();
      if (mode === "create" || mode === "edit") {
        const body = {
          detailed_stage: (vals.detailed_stage as string) || null,
          task_theme: (vals.task_theme as string) || null,
          task_description: (vals.task_description as string) || null,
          requirements: (vals.requirements as string) || null,
          role_name: (vals.role_name as string) || null,
          achievement: (vals.achievement as string) || null,
          plan_workload: (vals.plan_workload as string) || null,
          plan_begin_time: (vals.plan_begin_time as string) || null,
          plan_complete_time: (vals.plan_complete_time as string) || null,
          module_id: (vals.module_id as string) || null,
          execute_user_id: (vals.execute_user_id as string) || null,
          audit_user_id: (vals.audit_user_id as string) || null,
          approve_user_id: (vals.approve_user_id as string) || null,
          file_urls: (vals.file_urls as string[]) ?? [],
        };
        if (mode === "create") {
          await createPsPlanNodeDetail({ plan_node_id: planNodeId, ...body });
        } else if (detail) {
          await updatePsPlanNodeDetail(detail.id, body);
        }
        onSaved();
        return;
      }

      if (!detail) return;

      if (mode === "audit") {
        const backFlag = (vals.audit_back_flag as string) ?? "0";
        const opinion = (vals.audit_opinion as string) ?? "";
        onClose();
        if (backFlag === "1") {
          await onSubmit(detail.id, "reject", { handleInfo: opinion });
        } else {
          await onSubmit(detail.id, "save", { handleInfo: opinion });
        }
        return;
      }

      if (mode === "approve") {
        const backFlag = (vals.approve_back_flag as string) ?? "0";
        const opinion = (vals.approve_opinion as string) ?? "";
        onClose();
        if (backFlag === "1") {
          await onSubmit(detail.id, "reject", { handleInfo: opinion });
        } else {
          await onSubmit(detail.id, "save", { handleInfo: opinion });
        }
        return;
      }

      if (mode === "change") {
        const reason = ((vals.change_reason as string) ?? "").trim();
        if (!reason) {
          setErr("变更原因不能为空");
          return;
        }
        onClose();
        await onSubmit(detail.id, "change", { changeReason: reason });
        return;
      }

      if (mode === "changeApprove") {
        // P0-8:对照源 ChangeApproveNodeDetailForm.submitForm:
        // backFlag==='0' → saveProcess(同意);backFlag==='1' → rejectProcess(驳回)。
        const backFlag = (vals.change_approve_back_flag as string) ?? "0";
        const opinion = (vals.change_approve_opinion as string) ?? "";
        onClose();
        if (backFlag === "1") {
          await onSubmit(detail.id, "reject", {
            handleInfo: opinion,
            changeApproveBackFlag: "1",
            changeApproveOpinion: opinion,
          });
        } else {
          await onSubmit(detail.id, "save", {
            handleInfo: opinion,
            changeApproveBackFlag: "0",
            changeApproveOpinion: opinion,
          });
        }
        return;
      }
      // view 模式无提交
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message);
      } else if (e && typeof e === "object" && "errorFields" in e) {
        // AntD 校验失败,validateFields 已在字段下提示
      } else {
        setErr("操作失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const title = useMemo(() => {
    switch (mode) {
      case "create":
        return "新建里程碑明细";
      case "edit":
        return `编辑明细${detail ? ` · ${PLAN_DETAIL_STATUS_TEXT[detail.status] ?? detail.status}` : ""}`;
      case "audit":
        return "审核明细";
      case "approve":
        return "审批明细";
      case "change":
        return "计划变更";
      case "changeApprove":
        return "变更审批";
      default:
        return `明细详情${detail ? ` · ${PLAN_DETAIL_STATUS_TEXT[detail.status] ?? detail.status}` : ""}`;
    }
  }, [mode, detail]);

  // submit 按钮文案
  const submitText = useMemo(() => {
    if (mode === "create" || mode === "edit") return "保存";
    if (mode === "audit" || mode === "approve") return "提交";
    if (mode === "change") return "提交变更";
    if (mode === "changeApprove") return "提交审批";
    return "";
  }, [mode]);

  const showSubmit = mode !== "view";

  return (
    <Drawer
      title={title}
      open
      onClose={onClose}
      width={720}
      destroyOnClose
      extra={
        detail ? (
          <Tag color={PLAN_DETAIL_STATUS_COLOR[detail.status] ?? "default"}>
            {PLAN_DETAIL_STATUS_TEXT[detail.status] ?? detail.status}
          </Tag>
        ) : null
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {detail && mode !== "create" && (
              <PlanDetailActions
                detail={detail}
                currentUserId={currentUserId}
                disabled={busy}
                onSubmit={(id, action) => {
                  onClose();
                  void onSubmit(
                    id,
                    action,
                    action === "change"
                      ? undefined
                      : { handleInfo: undefined },
                  );
                }}
              />
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>
              关闭
            </Button>
            {showSubmit && (
              <Button size="sm" disabled={busy} onClick={() => void submit()}>
                {busy ? "提交中…" : submitText}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <Form<FormVals>
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={(changed) => {
          // 工作日联动:开始时间或工作量变化时重算完成时间
          if ("plan_begin_time" in changed || "plan_workload" in changed) {
            recomputeComplete(
              changed.plan_begin_time as string | undefined,
              changed.plan_workload as string | undefined,
            );
          }
        }}
      >
        {/* 开立信息块(对照源 AddNodeDetailForm / ViewNodeDetailForm 开立段) */}
        <FormSection title="开立信息">
          <div className="grid grid-cols-2 gap-3">
            <Form.Item label="明细阶段" name="detailed_stage">
              <Input disabled={!baseEditable} placeholder="请输入明细阶段" />
            </Form.Item>
            <Form.Item label="任务主题" name="task_theme">
              <Input disabled={!baseEditable} placeholder="请输入任务主题" />
            </Form.Item>
          </div>
          <Form.Item label="任务描述" name="task_description">
            <Input.TextArea
              disabled={!baseEditable}
              rows={2}
              placeholder="请输入任务描述"
            />
          </Form.Item>
          <Form.Item label="要求" name="requirements">
            <Input.TextArea
              disabled={!baseEditable}
              rows={2}
              placeholder="请输入要求"
            />
          </Form.Item>
          <div className="grid grid-cols-3 gap-3">
            <Form.Item label="角色" name="role_name">
              <Input disabled={!baseEditable} placeholder="角色" />
            </Form.Item>
            <Form.Item label="成果" name="achievement">
              <Input disabled={!baseEditable} placeholder="成果" />
            </Form.Item>
            <Form.Item
              label="计划工作量(工作日)"
              name="plan_workload"
              tooltip="填数字。修改后将按工作日自动推算计划完成时间。"
            >
              <InputNumber
                disabled={!baseEditable}
                placeholder="如 5"
                step={0.5}
                precision={1}
                min={0}
                className="w-full"
              />
            </Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item label="计划开始时间">
              <DatePicker
                disabled={!baseEditable}
                className="w-full"
                format="YYYY-MM-DD"
                value={toDay(form.getFieldValue("plan_begin_time"))}
                onChange={(d) => {
                  const v = fromDate(d);
                  form.setFieldValue("plan_begin_time", v);
                  recomputeComplete(v);
                }}
              />
            </Form.Item>
            <Form.Item label="计划完成时间">
              <DatePicker
                disabled={!baseEditable}
                className="w-full"
                format="YYYY-MM-DD"
                value={toDay(form.getFieldValue("plan_complete_time"))}
                onChange={(d) =>
                  form.setFieldValue("plan_complete_time", fromDate(d))
                }
              />
            </Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              label="所属模块"
              name="module_id"
              tooltip="实施阶段三级用,其他阶段可空;选项来自当前里程碑的模块列表"
            >
              <Select
                disabled={!baseEditable}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="选择所属模块(可空)"
                notFoundContent={
                  modules.length === 0 ? "该里程碑暂无模块" : undefined
                }
                options={modules.map((m) => ({
                  value: m.id,
                  label: m.module_name ?? m.id,
                }))}
              />
            </Form.Item>
            <Form.Item label="执行人" name="execute_user_id">
              {projectId ? (
                <PpmUserSelect
                  res="projectMember"
                  searchData={{ pm_project_id: projectId }}
                  disabled={!baseEditable}
                  allowClear
                  placeholder="选择执行人"
                />
              ) : (
                <Input disabled={!baseEditable} placeholder="执行人 ID" />
              )}
            </Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              label="审核人"
              name="audit_user_id"
              tooltip={auditEditable ? undefined : "审核中状态由后端指派"}
            >
              {projectId ? (
                <PpmUserSelect
                  res="projectMember"
                  searchData={{ pm_project_id: projectId }}
                  disabled={!baseEditable}
                  allowClear
                  placeholder="选择审核人"
                />
              ) : (
                <Input disabled={!baseEditable} placeholder="审核人 ID" />
              )}
            </Form.Item>
            <Form.Item
              label="审批人"
              name="approve_user_id"
              tooltip={approveEditable ? undefined : "审批中状态由后端指派"}
            >
              {projectId ? (
                <PpmUserSelect
                  res="projectMember"
                  searchData={{ pm_project_id: projectId }}
                  disabled={!baseEditable}
                  allowClear
                  placeholder="选择审批人"
                />
              ) : (
                <Input disabled={!baseEditable} placeholder="审批人 ID" />
              )}
            </Form.Item>
          </div>
          <Form.Item label="附件" name="file_urls">
            <PpmFileUrls disabled={!baseEditable} />
          </Form.Item>
        </FormSection>

        {/* 审核信息块:audit/edit/view 可见,审批/变更/变更审批阶段也展示(只读) */}
        {(mode === "audit" ||
          mode === "approve" ||
          mode === "change" ||
          mode === "changeApprove" ||
          mode === "view") &&
          detail?.audit_user_id && (
            <FormSection title="审核信息">
              <div className="grid grid-cols-2 gap-3">
                <Form.Item label="审核人">
                  <PpmText
                    res="user"
                    value={detail.audit_user_id}
                    name={detail.audit_user_name}
                  />
                </Form.Item>
                <Form.Item label="是否驳回" name="audit_back_flag">
                  <Select
                    disabled={!auditEditable}
                    options={[
                      { value: "0", label: "否" },
                      { value: "1", label: "是" },
                    ]}
                  />
                </Form.Item>
              </div>
              <Form.Item
                label="审核意见"
                name="audit_opinion"
                rules={
                  auditEditable
                    ? [{ required: true, message: "请输入审核意见" }]
                    : undefined
                }
              >
                <Input.TextArea
                  disabled={!auditEditable}
                  rows={2}
                  placeholder="请输入意见"
                />
              </Form.Item>
            </FormSection>
          )}

        {/* 审批信息块 */}
        {(mode === "approve" ||
          mode === "change" ||
          mode === "changeApprove" ||
          mode === "view") &&
          detail?.approve_user_id && (
            <FormSection title="审批信息">
              <div className="grid grid-cols-2 gap-3">
                <Form.Item label="审批人">
                  <PpmText
                    res="user"
                    value={detail.approve_user_id}
                    name={detail.approve_user_name}
                  />
                </Form.Item>
                <Form.Item label="是否驳回" name="approve_back_flag">
                  <Select
                    disabled={!approveEditable}
                    options={[
                      { value: "0", label: "否" },
                      { value: "1", label: "是" },
                    ]}
                  />
                </Form.Item>
              </div>
              <Form.Item
                label="审批意见"
                name="approve_opinion"
                rules={
                  approveEditable
                    ? [{ required: true, message: "请输入审批意见" }]
                    : undefined
                }
              >
                <Input.TextArea
                  disabled={!approveEditable}
                  rows={2}
                  placeholder="请输入意见"
                />
              </Form.Item>
            </FormSection>
          )}

        {/* 变更原因块 */}
        {mode === "change" && (
          <FormSection title="变更原因">
            <Form.Item
              label="变更原因"
              name="change_reason"
              rules={[{ required: true, message: "请输入变更原因" }]}
            >
              <Input.TextArea
                rows={3}
                placeholder="请输入变更原因,提交后生成新版本草稿,旧版本归档"
              />
            </Form.Item>
          </FormSection>
        )}

        {/* P0-8:变更审批块(对照源 ChangeApproveNodeDetailForm)。
            status=change_pending 时由审批人填写 changeApproveBackFlag/
            changeApproveOpinion,提交走 save(同意)/reject(驳回)。
            同时只读展示变更原因(detail.change_reason)。 */}
        {mode === "changeApprove" && (
          <>
            {detail?.change_reason && (
              <FormSection title="变更原因(只读)">
                <Form.Item label="变更原因">
                  <Input.TextArea
                    value={detail.change_reason}
                    disabled
                    rows={3}
                  />
                </Form.Item>
              </FormSection>
            )}
            <FormSection title="变更审批">
              <Form.Item label="审批人">
                <PpmText
                  res="user"
                  value={detail?.approve_user_id}
                  name={detail?.approve_user_name}
                />
              </Form.Item>
              <Form.Item
                label="是否驳回"
                name="change_approve_back_flag"
                rules={[{ required: true, message: "请选择" }]}
              >
                <Select
                  disabled={!changeApproveEditable}
                  options={[
                    { value: "0", label: "否" },
                    { value: "1", label: "是" },
                  ]}
                />
              </Form.Item>
              <Form.Item
                label="意见"
                name="change_approve_opinion"
                rules={[{ required: true, message: "请输入意见" }]}
              >
                <Input.TextArea
                  disabled={!changeApproveEditable}
                  rows={2}
                  placeholder="请输入意见"
                />
              </Form.Item>
            </FormSection>
          </>
        )}

        {/* 变更版本链 */}
        {detail && versions.length > 0 && (
          <FormSection title={`变更版本链(${versions.length})`}>
            <div className="space-y-1 rounded border bg-card p-2">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <Tag color={PLAN_DETAIL_STATUS_COLOR[v.status] ?? "default"}>
                    {PLAN_DETAIL_STATUS_TEXT[v.status] ?? v.status}
                  </Tag>
                  <span className="truncate">{v.task_theme ?? v.id}</span>
                  {v.change_reason && (
                    <span className="truncate text-muted-foreground">
                      {v.change_reason}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </FormSection>
        )}
      </Form>

      {/* 流程履历 Timeline(对照源 ViewNodeDetailForm el-timeline) */}
      {detail && logs.length > 0 && (
        <FormSection title={`流程履历(${logs.length})`}>
          <Timeline
            items={logs.map((l) => ({
              key: l.id,
              color: processColor(l.node_key),
              children: (
                <div className="space-y-0.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {l.handle_user_name ?? (
                        <PpmText res="user" value={l.handle_user_id} />
                      )}
                    </span>
                    <Tag className="text-[10px]">
                      {l.node_key ?? l.business_type}
                    </Tag>
                  </div>
                  {l.handle_info && (
                    <div className="text-muted-foreground">{l.handle_info}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {fmtDateTime(l.handle_date ?? l.created_at)}
                    {l.next_user_name
                      ? ` → 下一处理人:${l.next_user_name}`
                      : null}
                  </div>
                </div>
              ),
            }))}
          />
        </FormSection>
      )}

      {err && <p className="mt-2 text-[11px] text-destructive">{err}</p>}
    </Drawer>
  );
}

/** AntD Form 内的卡片化分组(对齐源 el-card header="...")。 */
function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 rounded border bg-card p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// P0-7:里程碑主表(PsPlanNode)CRUD 抽屉,对照源 PsPlanNodeForm.vue 7 字段
// (no / overallStage / dutyUserId / taskTheme / planWorkload /
//  planBeginTime / planCompleteTime)。
// ---------------------------------------------------------------------------

interface PsPlanNodeVals {
  no?: string | null;
  overall_stage?: string | null;
  duty_user_id?: string | null;
  task_theme?: string | null;
  plan_workload?: string | null;
  plan_begin_time?: string | null;
  plan_complete_time?: string | null;
}

function PsPlanNodeDrawer({
  open,
  mode,
  node,
  planId,
  projectId,
  nextNo,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  node?: PsPlanNode;
  planId: string;
  projectId: string | null;
  nextNo: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<PsPlanNodeVals>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const initialValues = useMemo<PsPlanNodeVals>(
    () => ({
      no: node?.no ?? (mode === "create" ? nextNo : ""),
      overall_stage: node?.overall_stage ?? "",
      duty_user_id: node?.duty_user_id ?? "",
      task_theme: node?.task_theme ?? "",
      plan_workload: node?.plan_workload ?? "",
      plan_begin_time: node?.plan_begin_time ?? "",
      plan_complete_time: node?.plan_complete_time ?? "",
    }),
    [node, mode, nextNo],
  );

  useEffect(() => {
    if (open) form.setFieldsValue(initialValues);
  }, [form, initialValues, open]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const vals = await form.validateFields();
      const body = {
        no: (vals.no as string) || null,
        overall_stage: (vals.overall_stage as string) || null,
        duty_user_id: (vals.duty_user_id as string) || null,
        task_theme: (vals.task_theme as string) || null,
        plan_workload: (vals.plan_workload as string) || null,
        plan_begin_time: (vals.plan_begin_time as string) || null,
        plan_complete_time: (vals.plan_complete_time as string) || null,
      };
      if (mode === "create") {
        await createPsPlanNode({ ps_project_plan_id: planId, ...body });
      } else if (node) {
        await updatePsPlanNode(node.id, body);
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message);
      } else if (e && typeof e === "object" && "errorFields" in e) {
        // AntD 校验失败,字段下已提示
      } else {
        setErr("保存失败");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={mode === "create" ? "新建里程碑" : "编辑里程碑"}
      open={open}
      onClose={onClose}
      width={640}
      destroyOnClose
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      }
    >
      <Form<PsPlanNodeVals>
        form={form}
        layout="vertical"
        initialValues={initialValues}
      >
        <div className="grid grid-cols-2 gap-3">
          <Form.Item
            label="序号"
            name="no"
            rules={[{ required: true, message: "请输入序号" }]}
          >
            <Input placeholder="如 1" />
          </Form.Item>
          <Form.Item
            label="总体阶段"
            name="overall_stage"
            rules={[{ required: true, message: "请输入总体阶段" }]}
          >
            <Input placeholder="如 实施阶段" />
          </Form.Item>
        </div>
        <Form.Item
          label="责任人"
          name="duty_user_id"
          rules={[{ required: true, message: "请选择责任人" }]}
        >
          {projectId ? (
            <PpmUserSelect
              res="projectMember"
              searchData={{ pm_project_id: projectId }}
              allowClear
              placeholder="选择责任人"
            />
          ) : (
            <Input placeholder="责任人 ID" />
          )}
        </Form.Item>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item label="任务主题" name="task_theme">
            <Input placeholder="请输入任务主题" />
          </Form.Item>
          <Form.Item
            label="预计工作量"
            name="plan_workload"
            rules={[{ required: true, message: "请输入预计工作量" }]}
          >
            <InputNumber
              placeholder="如 5(工作日)"
              step={0.5}
              precision={1}
              min={0}
              className="w-full"
            />
          </Form.Item>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item
            label="计划开始时间"
            name="plan_begin_time"
            rules={[{ required: true, message: "请选择计划开始时间" }]}
          >
            <DatePicker
              className="w-full"
              format="YYYY-MM-DD"
              value={toDay(form.getFieldValue("plan_begin_time"))}
              onChange={(d) =>
                form.setFieldValue("plan_begin_time", fromDate(d))
              }
            />
          </Form.Item>
          <Form.Item
            label="计划完成时间"
            name="plan_complete_time"
            rules={[{ required: true, message: "请选择计划完成时间" }]}
          >
            <DatePicker
              className="w-full"
              format="YYYY-MM-DD"
              value={toDay(form.getFieldValue("plan_complete_time"))}
              onChange={(d) =>
                form.setFieldValue("plan_complete_time", fromDate(d))
              }
            />
          </Form.Item>
        </div>
      </Form>
      {err && <p className="mt-2 text-[11px] text-destructive">{err}</p>}
    </Drawer>
  );
}
