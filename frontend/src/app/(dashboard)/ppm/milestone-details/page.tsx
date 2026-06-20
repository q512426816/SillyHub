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
 * (listPlanNodeDetailProcesses),按 business_type 染色(normal/reject/change),
 * 人名经 PpmText 解析。
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
  Select,
  Table,
  type TableProps,
  Tag,
  Timeline,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
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
  changePlanNodeDetailProcess,
  createPsPlanNodeDetail,
  deletePsPlanNodeDetail,
  getProjectPlan,
  listPlanNodeDetailProcesses,
  listPlanNodeModules,
  listPsPlanNodeDetails,
  listPsPlanNodeDetailVersions,
  listPsPlanNodes,
  rejectPlanNodeDetailProcess,
  savePlanNodeDetailProcess,
  updatePsPlanNodeDetail,
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

/** 抽屉形态(对照源 6 Vue 表单)。 */
type DrawerMode =
  | "create" // 草稿新增(AddNodeDetailForm)
  | "edit" // 草稿编辑(NodeDetailForm,draft/rejected 返工)
  | "audit" // 审核中(AuditNodeDetailForm)
  | "approve" // 审批中(ApproveNodeDetailForm)
  | "change" // 变更原因录入(ChangeNodeDetailForm)
  | "view"; // 只读(ViewNodeDetailForm,done/archived)

interface DetailDrawerState {
  open: boolean;
  mode: DrawerMode;
  planNodeId?: string;
  moduleId?: string | null;
  detail?: PsPlanNodeDetail;
}

export default function MilestoneDetailsPage() {
  const params = useSearchParams();
  const planId = params.get("plan") ?? "";
  const { user: currentUser } = useSession();
  const currentUserId = currentUser?.id ?? "";

  const [psNodes, setPsNodes] = useState<PsPlanNode[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DetailDrawerState>({
    open: false,
    mode: "view",
  });
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  // 里程碑列表 + 项目 ID(供 PpmUserSelect 的 searchData.pm_project_id)
  useEffect(() => {
    if (!planId) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const plan = await getProjectPlan(planId);
        setProjectId(plan.project_id ?? null);
        const list = await listPsPlanNodes(planId);
        setPsNodes(list);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载里程碑失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [planId]);

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

  /** 按明细 status 路由抽屉形态(对照源 6 表单)。 */
  const modeForStatus = (status: string): DrawerMode => {
    switch (status) {
      case "draft":
      case "rejected":
        return "edit"; // 草稿 / 驳回返工:回草稿编辑
      case "review":
        return "audit";
      case "approve":
        return "approve";
      case "done":
      case "archived":
      default:
        return "view";
    }
  };

  /**
   * 流程动作提交(save/reject/change)。表单 body 由调用方提供:
   *  - audit/approve 表单:handle_info(意见)
   *  - change 表单:change_reason
   * 列表行内 PlanDetailActions 不带 body 时走 prompt 兜底(保留旧行为)。
   */
  const handleSubmit = async (
    detailId: string,
    action: "save" | "reject" | "change",
    body?: {
      handleInfo?: string;
      changeReason?: string;
    },
  ) => {
    let rejectBody: PlanProcessActionReq | undefined;
    let changeBody: PlanChangeProcessReq | undefined;
    if (action === "reject") {
      const handleInfo =
        body?.handleInfo ?? (prompt("驳回意见(可选):") ?? "");
      rejectBody = { handle_info: handleInfo || null };
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
      showToast(false, err instanceof ApiError ? err.message : "操作失败");
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
              style={{ width: "100%" }}
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
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "计划结束",
        dataIndex: "plan_complete_time",
        key: "plan_complete_time",
        width: 130,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "操作",
        key: "actions",
        align: "right",
        width: 120,
        render: (_v: unknown, n: PsPlanNode) => (
          <Button
            size="sm"
            variant="outline"
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
        ),
      },
    ],
    [projectId],
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
        />
      );
    },
    [projectId, currentUserId, openDetail],
  );

  if (!planId) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10 text-center text-sm text-muted-foreground">
        请从「项目计划」页选择一条计划进入里程碑明细。
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">里程碑明细</h1>
          <p className="text-xs text-muted-foreground">
            计划 {planId}
            {projectId ? ` · 项目 ${projectId}` : ""} · 实施阶段三级(里程碑→模块→明细),其他阶段二级
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void reload()}>
          刷新
        </Button>
      </header>

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
          masterRows={psNodes}
          masterColumns={masterColumns}
          expandRender={expandRender}
          expandableTriggerField="id"
          tableProps={{ loading, pagination: false, scroll: { x: "max-content" } }}
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
    </div>
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
    body?: { handleInfo?: string; changeReason?: string },
  ) => void;
  currentUserId: string;
}

function ModuleLevelTable({
  planNodeId,
  projectId,
  onAddDetail,
  onOpenDetail,
  onSubmitDetail,
  currentUserId,
}: ModuleLevelProps) {
  const [modules, setModules] = useState<PlanNodeModule[]>([]);
  const [loading, setLoading] = useState(true);

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
              style={{ width: "100%" }}
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
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "计划结束",
        dataIndex: "plan_complete_time",
        key: "plan_complete_time",
        width: 130,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "操作",
        key: "actions",
        align: "right",
        width: 120,
        render: (_v: unknown, m: PlanNodeModule) => (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAddDetail(m.id)}
          >
            + 新建明细
          </Button>
        ),
      },
    ],
    [projectId, onAddDetail],
  );

  const moduleExpandRender = useCallback(
    (m: PlanNodeModule) => (
      <DetailLevelTable
        planNodeId={planNodeId}
        moduleId={m.id}
        onAddDetail={() => onAddDetail(m.id)}
        onOpenDetail={onOpenDetail}
        onSubmitDetail={onSubmitDetail}
        currentUserId={currentUserId}
      />
    ),
    [planNodeId, onAddDetail, onOpenDetail, onSubmitDetail, currentUserId],
  );

  return (
    <div className="rounded border border-dashed bg-muted/20 p-3">
      <PpmSubTable<PlanNodeModule>
        title="模块(实施阶段)"
        masterRows={modules}
        masterColumns={moduleColumns}
        expandRender={moduleExpandRender}
        expandableTriggerField="id"
        tableProps={{ loading, pagination: false, scroll: { x: "max-content" } }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 明细列表(二级 / 三级通用,按 moduleId 过滤)
// ---------------------------------------------------------------------------

interface DetailLevelProps {
  planNodeId: string;
  /** null/undefined = 该里程碑下所有明细;string = 仅该模块下的明细。 */
  moduleId: string | null;
  onAddDetail: () => void;
  onOpenDetail: (d: PsPlanNodeDetail, mode?: DrawerMode) => void;
  onSubmitDetail: (
    detailId: string,
    action: "save" | "reject" | "change",
    body?: { handleInfo?: string; changeReason?: string },
  ) => void;
  currentUserId: string;
}

function DetailLevelTable({
  planNodeId,
  moduleId,
  onAddDetail,
  onOpenDetail,
  onSubmitDetail,
  currentUserId,
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

  const handleDelete = async (d: PsPlanNodeDetail) => {
    if (d.status !== "draft") return;
    if (!confirm("删除该里程碑明细?")) return;
    try {
      await deletePsPlanNodeDetail(d.id);
      await reload();
    } catch {
      // 静默
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
                onClick={() => void handleDelete(d)}
              >
                删除
              </Button>
            )}
          </div>
        ),
      },
    ],
    [currentUserId, onOpenDetail, onSubmitDetail],
  );

  return (
    <div className="rounded border border-dashed bg-card/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">
          明细{moduleId ? ` · 模块 ${moduleId}` : ""}
        </span>
        <Button size="sm" variant="outline" onClick={onAddDetail}>
          + 新建明细
        </Button>
      </div>
      {error ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : (
        <Table<PsPlanNodeDetail>
          rowKey="id"
          columns={columns}
          dataSource={details}
          loading={loading}
          size="small"
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: moduleId ? "该模块暂无明细" : "暂无明细" }}
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

/** Dayjs → 'YYYY-MM-DD' 或 null。 */
function fromDate(d: Dayjs | null): string | null {
  return d ? d.format("YYYY-MM-DD") : null;
}

/** 流程履历 business_type → AntD Timeline 颜色(对齐源 ViewNodeDetailForm)。 */
function processColor(businessType: string | null | undefined): string {
  if (businessType === "reject") return "red";
  if (businessType === "change") return "orange";
  return "green"; // normal / 默认
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
    body?: { handleInfo?: string; changeReason?: string },
  ) => void;
}) {
  const [form] = Form.useForm<FormVals>();
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
      default:
        return `明细详情${detail ? ` · ${PLAN_DETAIL_STATUS_TEXT[detail.status] ?? detail.status}` : ""}`;
    }
  }, [mode, detail]);

  // submit 按钮文案
  const submitText = useMemo(() => {
    if (mode === "create" || mode === "edit") return "保存";
    if (mode === "audit" || mode === "approve") return "提交";
    if (mode === "change") return "提交变更";
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
              <Input disabled={!baseEditable} placeholder="如 5" />
            </Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item label="计划开始时间" name="plan_begin_time">
              <DatePicker
                disabled={!baseEditable}
                style={{ width: "100%" }}
                value={toDay(form.getFieldValue("plan_begin_time"))}
                onChange={(d) => {
                  const v = fromDate(d);
                  form.setFieldValue("plan_begin_time", v);
                  recomputeComplete(v);
                }}
              />
            </Form.Item>
            <Form.Item label="计划完成时间" name="plan_complete_time">
              <DatePicker
                disabled={!baseEditable}
                style={{ width: "100%" }}
                value={toDay(form.getFieldValue("plan_complete_time"))}
                onChange={(d) =>
                  form.setFieldValue("plan_complete_time", fromDate(d))
                }
              />
            </Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              label="所属模块 ID"
              name="module_id"
              tooltip="实施阶段三级用,其他阶段可空"
            >
              <Input disabled={!baseEditable} placeholder="可空" />
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

        {/* 审核信息块:audit/edit/view 可见,审批/变更阶段也展示(只读) */}
        {(mode === "audit" ||
          mode === "approve" ||
          mode === "change" ||
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
        {(mode === "approve" || mode === "change" || mode === "view") &&
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
              color: processColor(l.business_type),
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
                    {l.handle_date ?? l.created_at}
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
