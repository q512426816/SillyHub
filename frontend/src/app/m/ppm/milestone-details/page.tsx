"use client";

/**
 * 里程碑明细 · 移动主页（竖屏钻取式，对照桌面 milestone-details/page.tsx 整页复刻）。
 *
 * 三层钻取：里程碑（PsPlanNode）→（has_module 时）模块（PlanNodeModule）→ 明细（PsPlanNodeDetail）。
 * 里程碑第一层（节点列表 + CRUD + readOnly + 导出）由可复用 MilestoneSheet 抽屉承载（与
 * 项目计划页共享），点里程碑下钻模块/明细整页层（W3/W5）。
 *
 * 数据层 100% 复用 lib/ppm（D-006）：getProjectPlan（权限/项目名）+ 明细/模块 CRUD + 流程。
 * 里程碑节点 CRUD 在 MilestoneSheet 内（复用桌面抽出的 PsPlanNodeDrawer，W1 抽取，D-007）。
 * 权限：readOnly = !(plan.can_edit)，后端按项目成员角色集中判断。
 *
 * middleware matcher 含 /ppm/:path* → 手机访问 /ppm/milestone-details 自动 rewrite 到本页。
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Modal, Tag } from "antd";

import { MobileCardList } from "@/components/mobile/mobile-card-list";
import { MilestoneSheet } from "@/components/mobile/milestone-sheet";
import { DetailDrawer } from "@/components/ppm/milestone/detail-drawer";
import {
  type DrawerMode,
  modeForStatus,
  TASK_EXECUTE_STATUS_COLOR,
} from "@/components/ppm/milestone/milestone-helpers";
import { ModuleFormDrawer } from "@/components/ppm/milestone/module-form-drawer";
import { ImportModuleModal } from "@/components/ppm/milestone/import-module-modal";
import { PpmText } from "@/components/ppm-text";
import {
  PLAN_DETAIL_STATUS_COLOR,
  PLAN_DETAIL_STATUS_TEXT,
} from "@/components/ppm-status-actions";
import { useSession } from "@/stores/session";
import { ApiError } from "@/lib/api";
import {
  changePlanNodeDetailProcess,
  createPlanNodeModule,
  deletePsPlanNodeDetail,
  deletePlanNodeModule,
  getProjectPlan,
  listPlanNodeModules,
  listPsPlanNodeDetails,
  rejectPlanNodeDetailProcess,
  savePlanNodeDetailProcess,
  type PlanChangeProcessReq,
  type PlanNodeModule,
  type PlanProcessActionReq,
  type PsPlanNode,
  type PsPlanNodeDetail,
  type PsProjectPlan,
  updatePlanNodeModule,
} from "@/lib/ppm";
import { useToast, Toast } from "@/app/(dashboard)/ppm/shared";
import { fmtDate } from "@/lib/ppm/format";

/** 钻取层级：里程碑（MilestoneSheet）→ 模块（has_module）→ 明细。 */
type DrillLevel = "nodes" | "modules" | "details";

export default function MilestoneDetailsMobilePage() {
  const params = useSearchParams();
  const planId = params.get("plan") ?? "";
  const { toast, showToast } = useToast();
  const { user: currentUser } = useSession();
  const currentUserId = currentUser?.id ?? "";

  const [plan, setPlan] = useState<PsProjectPlan | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 里程碑第一层抽屉面板开关（复用 MilestoneSheet；点里程碑钻取模块/明细层）。
  const [sheetOpen, setSheetOpen] = useState(true);

  // 钻取状态：当前层级 + 选中的里程碑/模块（W3/W5 用）。
  const [level, setLevel] = useState<DrillLevel>("nodes");
  const [selectedNode, setSelectedNode] = useState<PsPlanNode | null>(null);
  // W5 模块层选中（从模块钻取明细时按 module_id 过滤）。
  const [selectedModule, setSelectedModule] = useState<PlanNodeModule | null>(null);

  // W3 明细层：钻取到 details 层时按选中里程碑加载明细列表。
  const [details, setDetails] = useState<PsPlanNodeDetail[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // W5 模块层列表。
  const [modules, setModules] = useState<PlanNodeModule[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [modulesError, setModulesError] = useState<string | null>(null);

  // W3 明细 8 mode 表单抽屉（复用桌面抽出的 DetailDrawer，D-007）。
  const [detailDrawer, setDetailDrawer] = useState<{
    open: boolean;
    mode: DrawerMode;
    detail?: PsPlanNodeDetail;
    moduleId: string | null;
  }>({ open: false, mode: "view", moduleId: null });

  // W5 模块 CRUD 抽屉 + Excel 导入弹窗。
  const [moduleDrawer, setModuleDrawer] = useState<{
    open: boolean;
    mode: "create" | "edit";
    module?: PlanNodeModule;
  }>({ open: false, mode: "create" });
  const [moduleSaving, setModuleSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!planId) {
      setError("缺少 plan 参数");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const planResp = await getProjectPlan(planId);
      setPlan(planResp);
      setProjectId(planResp.project_id ?? null);
      setReadOnly(!(planResp.can_edit ?? false));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── W3 明细层 ───────────────────────────────────────────────────────────
  // 明细列表加载（钻取到 details 层 / 提交·删除后刷新）。
  const loadDetails = useCallback(
    async (nodeId: string, moduleId: string | null) => {
      if (!nodeId) return;
      setDetailsLoading(true);
      setDetailsError(null);
      try {
        const all = await listPsPlanNodeDetails(nodeId);
        // W5:从模块钻取时按 module_id 前端过滤（对齐桌面 DetailLevelTable）。
        setDetails(
          moduleId == null ? all : all.filter((d) => d.module_id === moduleId),
        );
      } catch (err) {
        setDetailsError(err instanceof ApiError ? err.message : "加载明细失败");
      } finally {
        setDetailsLoading(false);
      }
    },
    [],
  );

  // 钻取进入明细层时加载（按选中模块过滤）；离开清空避免回显旧数据。
  useEffect(() => {
    if (level === "details" && selectedNode) {
      void loadDetails(selectedNode.id, selectedModule?.id ?? null);
    }
    if (level !== "details") {
      setDetails([]);
      setDetailsError(null);
    }
  }, [level, selectedNode, selectedModule, loadDetails]);

  // 明细流程提交（save/reject/change，对齐桌面 handleSubmit）。
  // DetailDrawer 的 audit/approve/change/changeApprove 模式经 onSubmit 回调到此；
  // create/edit/changeInfo 自带 create/update，走 onSaved 不经此。
  const handleDetailSubmit = async (
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
      const handleInfo = body?.handleInfo ?? "";
      rejectBody = { handle_info: handleInfo || null };
      // P0-8:变更审批驳回透传 change_approve_* 字段。
      if (body?.changeApproveBackFlag) {
        rejectBody.change_approve_back_flag = body.changeApproveBackFlag;
        rejectBody.change_approve_opinion = body.changeApproveOpinion ?? null;
      }
    } else if (action === "change") {
      const changeReason = body?.changeReason ?? "";
      if (!changeReason.trim()) {
        showToast(false, "变更原因不能为空");
        return;
      }
      changeBody = { change_reason: changeReason };
    }
    const saveBody: PlanProcessActionReq | undefined =
      action === "save" && body?.handleInfo
        ? { handle_info: body.handleInfo }
        : undefined;
    if (action === "save" && saveBody && body?.changeApproveBackFlag) {
      saveBody.change_approve_back_flag = body.changeApproveBackFlag;
      saveBody.change_approve_opinion = body.changeApproveOpinion ?? null;
    }
    try {
      if (action === "save") {
        await savePlanNodeDetailProcess(detailId, saveBody);
        showToast(true, "已提交，已自动创建任务计划");
      } else if (action === "reject") {
        await rejectPlanNodeDetailProcess(detailId, rejectBody);
        showToast(true, "已驳回");
      } else {
        await changePlanNodeDetailProcess(detailId, changeBody);
        showToast(true, "已创建变更新版本");
      }
      if (selectedNode)
        await loadDetails(selectedNode.id, selectedModule?.id ?? null);
    } catch (err) {
      // 并发乐观锁：状态已被他人推进 → reload + 友好提示（对齐桌面 AC-8）。
      const isConcurrent =
        err instanceof ApiError && (err.status === 422 || err.status === 409);
      if (isConcurrent) {
        showToast(false, "该明细已被他人处理，列表已刷新，请重试");
        if (selectedNode)
          await loadDetails(selectedNode.id, selectedModule?.id ?? null);
      } else {
        showToast(false, err instanceof ApiError ? err.message : "操作失败");
      }
    }
  };

  // 明细删除（Modal.confirm 二次确认，对齐桌面 DetailLevelTable.handleDelete）。
  const handleDeleteDetail = (d: PsPlanNodeDetail) => {
    Modal.confirm({
      title: "删除该里程碑明细?",
      content: "该操作不可恢复。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      maskClosable: false,
      onOk: async () => {
        try {
          await deletePsPlanNodeDetail(d.id);
          showToast(true, "已删除");
          if (selectedNode)
            await loadDetails(selectedNode.id, selectedModule?.id ?? null);
        } catch (err) {
          showToast(false, err instanceof ApiError ? err.message : "删除失败");
        }
      },
    });
  };

  // ── W5 模块层 ───────────────────────────────────────────────────────────
  // 模块列表加载（钻取到 modules 层 / 保存·删除·导入后刷新）。
  const loadModules = useCallback(async (nodeId: string) => {
    if (!nodeId) return;
    setModulesLoading(true);
    setModulesError(null);
    try {
      setModules(await listPlanNodeModules(nodeId));
    } catch (err) {
      setModulesError(err instanceof ApiError ? err.message : "加载模块失败");
    } finally {
      setModulesLoading(false);
    }
  }, []);

  // 钻取进入模块层时加载；离开清空。
  useEffect(() => {
    if (level === "modules" && selectedNode) {
      void loadModules(selectedNode.id);
    }
    if (level !== "modules") {
      setModules([]);
      setModulesError(null);
    }
  }, [level, selectedNode, loadModules]);

  // 模块保存（create/update，复用 ModuleFormDrawer 的 onSave vals）。
  const handleModuleSave = async (vals: {
    module_name: string | null;
    plan_workload: string | null;
    plan_begin_time: string | null;
    plan_complete_time: string | null;
    duty_user_id: string | null;
  }) => {
    if (!selectedNode) return;
    setModuleSaving(true);
    try {
      if (moduleDrawer.mode === "create") {
        await createPlanNodeModule({ plan_node_id: selectedNode.id, ...vals });
        showToast(true, "已新建模块");
      } else if (moduleDrawer.module) {
        await updatePlanNodeModule(moduleDrawer.module.id, vals);
        showToast(true, "已保存");
      }
      setModuleDrawer({ open: false, mode: "create" });
      await loadModules(selectedNode.id);
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setModuleSaving(false);
    }
  };

  // 模块删除（Modal.confirm；模块下明细一并删除）。
  const handleDeleteModule = (m: PlanNodeModule) => {
    Modal.confirm({
      title: `删除模块「${m.module_name ?? m.id}」?`,
      content: "该操作不可恢复，模块下所有明细将一并删除。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      maskClosable: false,
      onOk: async () => {
        try {
          await deletePlanNodeModule(m.id);
          showToast(true, "已删除");
          if (selectedNode) await loadModules(selectedNode.id);
        } catch (err) {
          showToast(false, err instanceof ApiError ? err.message : "删除失败");
        }
      },
    });
  };

  // 里程碑第一层（节点卡片列表 + 新建/编辑/删除 + 导出）已由可复用 MilestoneSheet 承载，
  // 本页不再渲染节点卡片本体（只保留下钻的模块/明细层）。

  // W3 明细卡片（竖屏，对照桌面 DetailLevelTable 列）：变更版标识 + 状态/执行状态双徽标 +
  // 任务主题/明细阶段/角色/工时/周期/执行人。
  const renderDetailCard = (d: PsPlanNodeDetail) => (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {d.parent_id ? (
          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[11px] font-medium text-purple-700">
            变更版
          </span>
        ) : null}
        <Tag
          color={PLAN_DETAIL_STATUS_COLOR[d.status] ?? "default"}
          className="text-[11px] leading-5"
        >
          {PLAN_DETAIL_STATUS_TEXT[d.status] ?? d.status}
        </Tag>
        {d.task_execute_status ? (
          <Tag
            color={TASK_EXECUTE_STATUS_COLOR[d.task_execute_status] ?? "default"}
            className="text-[11px] leading-5"
          >
            {d.task_execute_status}
          </Tag>
        ) : null}
      </div>
      <div className="line-clamp-2 text-[14px] font-medium text-foreground">
        {d.task_theme ?? d.detailed_stage ?? "（未命名明细）"}
      </div>
      {d.detailed_stage ? (
        <div className="text-[12px] text-muted-foreground">
          明细阶段：{d.detailed_stage}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
        <span>角色：{d.role_name ?? "—"}</span>
        <span>工时：{d.plan_workload ?? "—"}</span>
      </div>
      <div className="text-[12px] text-muted-foreground">
        周期：{fmtDate(d.plan_begin_time)} ~ {fmtDate(d.plan_complete_time)}
      </div>
      <div className="text-[12px] text-muted-foreground">
        执行人：
        <PpmText res="user" value={d.execute_user_id} name={d.execute_user_name} />
      </div>
    </div>
  );

  // W3 明细卡片动作：详情(modeForStatus)/编辑(draft,rejected)/变更(done→changeInfo)/删除(readOnly 显隐)。
  const buildDetailActions = (d: PsPlanNodeDetail) => {
    const acts: { key: string; label: string; danger?: boolean; onPress: () => void }[] = [];
    const baseMode = modeForStatus(d.status);
    acts.push({
      key: "open",
      label: baseMode === "edit" ? "编辑" : "详情",
      onPress: () =>
        setDetailDrawer({ open: true, mode: baseMode, detail: d, moduleId: d.module_id }),
    });
    // 已完成明细信息变更（非版本变更；D-003 列表显式覆盖 done→changeInfo）。
    if (d.status === "done") {
      acts.push({
        key: "changeInfo",
        label: "变更",
        onPress: () =>
          setDetailDrawer({ open: true, mode: "changeInfo", detail: d, moduleId: d.module_id }),
      });
    }
    if (!readOnly) {
      acts.push({
        key: "delete",
        label: "删除",
        danger: true,
        onPress: () => handleDeleteDetail(d),
      });
    }
    return acts;
  };

  // W5 模块卡片（竖屏，对照桌面 ModuleLevelTable）：计划类型/模块名/工作量/周期/责任人。
  const renderModuleCard = (m: PlanNodeModule) => (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {m.plan_type ? (
          <Tag
            color={m.plan_type === "临时计划" ? "orange" : "blue"}
            className="text-[11px] leading-5"
          >
            {m.plan_type === "临时计划" ? "临时" : "正常"}
          </Tag>
        ) : null}
      </div>
      <div className="line-clamp-2 text-[14px] font-medium text-foreground">
        {m.module_name ?? "（未命名模块）"}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
        <span>工作量：{m.plan_workload ?? "—"}</span>
      </div>
      <div className="text-[12px] text-muted-foreground">
        周期：{fmtDate(m.plan_begin_time)} ~ {fmtDate(m.plan_complete_time)}
      </div>
      <div className="text-[12px] text-muted-foreground">
        责任人：<PpmText res="user" value={m.duty_user_id} />
      </div>
    </div>
  );

  // W5 模块卡片动作：查明细(钻取 details 带 moduleId)/编辑/删除(readOnly 显隐)。
  const buildModuleActions = (m: PlanNodeModule) => {
    const acts: { key: string; label: string; danger?: boolean; onPress: () => void }[] = [];
    acts.push({
      key: "drill",
      label: "查明细",
      onPress: () => {
        setSelectedModule(m);
        setLevel("details");
      },
    });
    if (!readOnly) {
      acts.push({
        key: "edit",
        label: "编辑模块",
        onPress: () => setModuleDrawer({ open: true, mode: "edit", module: m }),
      });
      acts.push({
        key: "delete",
        label: "删除模块",
        danger: true,
        onPress: () => handleDeleteModule(m),
      });
    }
    return acts;
  };

  // ── 渲染：里程碑第一层走可复用 MilestoneSheet（点卡片钻取 modules/details 整页层） ──
  return (
    <div className="flex flex-col gap-3">
      {/* 里程碑第一层（nodes）：抽屉面板「里程碑那块」，钻取关抽屉下钻；返回 nodes 重开 */}
      <MilestoneSheet
        open={sheetOpen && level === "nodes"}
        planId={planId}
        onClose={() => setSheetOpen(false)}
        onDrill={(node) => {
          setSelectedNode(node);
          setSelectedModule(null);
          setSheetOpen(false);
          setLevel(node.has_module ? "modules" : "details");
        }}
      />

      {/* 下钻层（modules/details）页头：返回重开里程碑面板 */}
      {level !== "nodes" && (
        <header className="flex items-center gap-2 px-1 pb-1">
          <button
            type="button"
            aria-label="返回"
            onClick={() => {
              // 三级返回：明细(从模块来)→模块；否则→里程碑
              if (level === "details" && selectedModule) {
                setLevel("modules");
                setSelectedModule(null);
              } else {
                setLevel("nodes");
                setSelectedNode(null);
                setSelectedModule(null);
                setSheetOpen(true);
              }
            }}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-foreground hover:bg-muted"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-semibold text-foreground">
              {level === "modules"
                ? `模块 · ${selectedNode?.task_theme ?? ""}`
                : `明细 · ${selectedModule?.module_name ?? selectedNode?.task_theme ?? ""}`}
            </h1>
            <p className="truncate text-[12px] text-muted-foreground">
              {plan?.project_name ?? "—"}
              {readOnly ? " · 只读" : ""}
            </p>
          </div>
        </header>
      )}

      {/* 下钻层错误提示（里程碑第一层错误在 MilestoneSheet 内自渲染） */}
      {level !== "nodes" && error ? (
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

      {level === "modules" && selectedNode && (
        <>
          {modulesError ? (
            <div className="rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-[13px] text-destructive">
              {modulesError}
              <button
                type="button"
                onClick={() => void loadModules(selectedNode.id)}
                className="ml-2 inline-flex min-h-[44px] items-center rounded-md px-2 text-[14px] font-medium text-blue-600 hover:underline"
              >
                重新加载
              </button>
            </div>
          ) : null}
          <MobileCardList<PlanNodeModule>
            items={modules}
            renderCard={renderModuleCard}
            onItemPress={(m) => {
              setSelectedModule(m);
              setLevel("details");
            }}
            actions={buildModuleActions}
            emptyText={modulesLoading ? "加载中…" : "暂无模块"}
            headerActions={
              !readOnly ? (
                <>
                  <button
                    type="button"
                    onClick={() => setImportOpen(true)}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-card px-3 text-[14px] font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    导入模块
                  </button>
                  <button
                    type="button"
                    onClick={() => setModuleDrawer({ open: true, mode: "create" })}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground transition-colors hover:opacity-90"
                  >
                    新建模块
                  </button>
                </>
              ) : null
            }
          />
        </>
      )}

      {level === "details" && selectedNode && (
        <>
          {detailsError ? (
            <div className="rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-[13px] text-destructive">
              {detailsError}
              <button
                type="button"
                onClick={() =>
                  void loadDetails(selectedNode.id, selectedModule?.id ?? null)
                }
                className="ml-2 inline-flex min-h-[44px] items-center rounded-md px-2 text-[14px] font-medium text-blue-600 hover:underline"
              >
                重新加载
              </button>
            </div>
          ) : null}
          <MobileCardList<PsPlanNodeDetail>
            items={details}
            renderCard={renderDetailCard}
            onItemPress={(d) =>
              setDetailDrawer({
                open: true,
                mode: modeForStatus(d.status),
                detail: d,
                moduleId: d.module_id,
              })
            }
            actions={buildDetailActions}
            emptyText={detailsLoading ? "加载中…" : "暂无明细"}
            headerActions={
              !readOnly ? (
                <button
                  type="button"
                  onClick={() =>
                    setDetailDrawer({
                      open: true,
                      mode: "create",
                      moduleId: selectedModule?.id ?? null,
                    })
                  }
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground transition-colors hover:opacity-90"
                >
                  新建明细
                </button>
              ) : null
            }
          />
        </>
      )}

      <Toast toast={toast} />

      {/* W3 明细 8 mode 表单：复用桌面抽出的 DetailDrawer（W1 抽取，内含 Timeline/工作日/版本链）。
          create/edit/changeInfo 自带 create/update 走 onSaved；audit/approve/change/changeApprove 经 onSubmit 流程。 */}
      {detailDrawer.open && selectedNode ? (
        <DetailDrawer
          mode={detailDrawer.mode}
          planNodeId={selectedNode.id}
          moduleId={detailDrawer.moduleId}
          overallStage={selectedNode.overall_stage}
          detail={detailDrawer.detail}
          projectId={projectId}
          currentUserId={currentUserId}
          onClose={() => setDetailDrawer((s) => ({ ...s, open: false }))}
          onSaved={async () => {
            setDetailDrawer((s) => ({ ...s, open: false }));
            if (selectedNode)
              await loadDetails(selectedNode.id, selectedModule?.id ?? null);
          }}
          onSubmit={handleDetailSubmit}
        />
      ) : null}

      {/* W5 模块新建/编辑：复用桌面抽出的 ModuleFormDrawer（W1 抽取），API 调用在 handleModuleSave。 */}
      <ModuleFormDrawer
        open={moduleDrawer.open}
        mode={moduleDrawer.mode}
        module={moduleDrawer.module}
        projectId={projectId}
        saving={moduleSaving}
        onClose={() => setModuleDrawer({ open: false, mode: "create" })}
        onSave={(vals) => void handleModuleSave(vals)}
      />

      {/* W5 模块 Excel 导入：复用抽取的 ImportModuleModal（3 步上传/预览/结果）。 */}
      {selectedNode && projectId ? (
        <ImportModuleModal
          planNodeId={selectedNode.id}
          projectId={projectId}
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onSuccess={async () => {
            setImportOpen(false);
            if (selectedNode) await loadModules(selectedNode.id);
          }}
        />
      ) : null}
    </div>
  );
}
