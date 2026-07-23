"use client";

/**
 * MilestoneSheet — 里程碑节点层可复用移动面板（抽屉内嵌里程碑卡片列表）。
 *
 * 承载「里程碑第一层」（PsPlanNode 列表 + 新建/编辑/删除 + 导出 + 钻取），供两处复用：
 *  - 里程碑明细主页 app/m/ppm/milestone-details/page.tsx（第一层整页，经 onDrill 下钻模块/明细）
 *  - 项目计划 app/m/ppm/project-plans/page.tsx（点卡片弹「里程碑那块」，抽屉内只看里程碑层）
 *
 * 数据层 100% 复用 lib/ppm（D-006，禁止自写请求）：
 *   getProjectPlan / listPsPlanNodes + create/update/delete（经 PsPlanNodeDrawer）/ exportMilestoneDetails。
 * 表单复用桌面抽出的 PsPlanNodeDrawer（W1 抽取，D-007），单一源不重写 7 字段表单。
 * 权限：readOnly = !(plan.can_edit)，后端按项目成员角色集中判断；只读时隐藏新建/编辑/删除。
 *
 * 渲染层独立（D-001 桌面零回归）：antd Drawer 外壳 + MobileCardList 卡片，仅移动侧新增。
 * 触摸热区 ≥ 44×44px、正文 ≥ 14px（R-04）。
 */
import { useCallback, useEffect, useState } from "react";
import { Drawer, Modal } from "antd";

import { MobileCardList } from "@/components/mobile/mobile-card-list";
import { MobileExportButton } from "@/components/mobile/mobile-export-button";
import { PsPlanNodeDrawer } from "@/components/ppm/milestone/ps-plan-node-drawer";
import { ApiError } from "@/lib/api";
import {
  deletePsPlanNode,
  exportMilestoneDetails,
  getProjectPlan,
  listPsPlanNodes,
  type PsPlanNode,
} from "@/lib/ppm";
import { useToast, Toast } from "@/app/(dashboard)/ppm/shared";
import { fmtDate } from "@/lib/ppm/format";

export interface MilestoneSheetProps {
  /** 受控开关（抽屉显隐）。 */
  open: boolean;
  /** 项目计划 id（PsProjectPlan.id）。空串则不加载。 */
  planId: string;
  /** 关闭回调（标题栏 X / 遮罩）。 */
  onClose: () => void;
  /**
   * 钻取回调：点里程碑卡片（或卡片「查看模块/查明细」动作）时触发。
   * 有 → 卡片可点并出钻取动作；无 → 里程碑层为终点（卡片不可点、无钻取动作）。
   */
  onDrill?: (node: PsPlanNode) => void;
}

interface MasterDrawerState {
  open: boolean;
  mode: "create" | "edit";
  node?: PsPlanNode;
}

function statusBadge(node: PsPlanNode): string {
  return node.has_module ? "三级" : "明细";
}

export function MilestoneSheet({
  open,
  planId,
  onClose,
  onDrill,
}: MilestoneSheetProps) {
  const { toast, showToast } = useToast();

  const [planName, setPlanName] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [nodes, setNodes] = useState<PsPlanNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [masterDrawer, setMasterDrawer] = useState<MasterDrawerState>({
    open: false,
    mode: "create",
  });

  const load = useCallback(async () => {
    if (!planId) {
      setError("缺少 plan 参数");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [planResp, nodeList] = await Promise.all([
        getProjectPlan(planId),
        listPsPlanNodes(planId),
      ]);
      setPlanName(planResp.project_name ?? null);
      setProjectId(planResp.project_id ?? null);
      setReadOnly(!(planResp.can_edit ?? false));
      setNodes(nodeList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [planId]);

  // 抽屉打开才加载；关闭后不清空（destroyOnHidden 卸载自然清）。
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportMilestoneDetails(planId || undefined);
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteNode = (node: PsPlanNode) => {
    Modal.confirm({
      title: `删除里程碑「${node.task_theme ?? node.no ?? node.id}」?`,
      content: "该操作不可恢复，里程碑下所有模块/明细将一并删除。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      maskClosable: false,
      onOk: async () => {
        try {
          await deletePsPlanNode(node.id);
          showToast(true, "已删除");
          await load();
        } catch (err) {
          showToast(false, err instanceof ApiError ? err.message : "删除失败");
        }
      },
    });
  };

  const handleMasterSaved = async () => {
    setMasterDrawer({ open: false, mode: "create" });
    await load();
  };

  // 里程碑卡片动作：钻取（仅当 onDrill 存在）/ 编辑 / 删除（readOnly 显隐）。
  const buildNodeActions = (node: PsPlanNode) => {
    const acts: {
      key: string;
      label: string;
      danger?: boolean;
      onPress: () => void;
    }[] = [];
    if (onDrill) {
      acts.push({
        key: "drill",
        label: node.has_module ? "查看模块" : "查明细",
        onPress: () => onDrill(node),
      });
    }
    if (!readOnly) {
      acts.push({
        key: "edit",
        label: "编辑里程碑",
        onPress: () => setMasterDrawer({ open: true, mode: "edit", node }),
      });
      acts.push({
        key: "delete",
        label: "删除里程碑",
        danger: true,
        onPress: () => handleDeleteNode(node),
      });
    }
    return acts;
  };

  const renderNodeCard = (node: PsPlanNode) => (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-md bg-blue-100 px-1.5 py-0.5 text-[12px] font-medium text-blue-700">
          {node.no ?? "—"}
        </span>
        <span className="shrink-0 rounded-md bg-violet-100 px-1.5 py-0.5 text-[12px] font-medium text-violet-700">
          {statusBadge(node)}
        </span>
        {node.overall_stage ? (
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
            {node.overall_stage}
          </span>
        ) : null}
      </div>
      <div className="line-clamp-2 text-[14px] font-medium text-foreground">
        {node.task_theme ?? "（未命名里程碑）"}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
        <span>责任人：{node.duty_user_id ?? "—"}</span>
        <span>工作量：{node.plan_workload ?? "—"}</span>
      </div>
      <div className="text-[12px] text-muted-foreground">
        周期：{fmtDate(node.plan_begin_time)} ~ {fmtDate(node.plan_complete_time)}
      </div>
    </div>
  );

  return (
    <Drawer
      open={open}
      placement="right"
      size="100%"
      title={
        <span className="text-base font-medium text-foreground">
          里程碑{planName ? ` · ${planName}` : ""}
          {readOnly ? "（只读）" : ""}
        </span>
      }
      onClose={onClose}
      closable
      styles={{ wrapper: { maxWidth: 480, marginInline: "auto" } }}
      destroyOnHidden
    >
      <div data-testid="milestone-sheet-body" className="flex flex-col gap-3">
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

        <MobileCardList<PsPlanNode>
          items={nodes}
          renderCard={renderNodeCard}
          onItemPress={onDrill}
          actions={buildNodeActions}
          emptyText={loading ? "加载中…" : "暂无里程碑"}
          headerActions={
            <>
              <MobileExportButton
                onClick={() => void handleExport()}
                loading={exporting}
              />
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setMasterDrawer({ open: true, mode: "create" })}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground transition-colors hover:opacity-90"
                >
                  新建里程碑
                </button>
              )}
            </>
          }
        />

        <Toast toast={toast} />
      </div>

      {/* 里程碑新建/编辑：复用桌面抽出的 PsPlanNodeDrawer（单一源） */}
      <PsPlanNodeDrawer
        open={masterDrawer.open}
        mode={masterDrawer.mode}
        node={masterDrawer.node}
        planId={planId}
        projectId={projectId}
        nextNo={String(nodes.length + 1)}
        onClose={() => setMasterDrawer({ open: false, mode: "create" })}
        onSaved={() => void handleMasterSaved()}
      />
    </Drawer>
  );
}
