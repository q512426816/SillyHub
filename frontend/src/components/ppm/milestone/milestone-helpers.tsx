"use client";

import type { ReactNode } from "react";
import dayjs, { type Dayjs } from "dayjs";
import type { PsPlanNodeDetail, PlanNodeModule } from "@/lib/ppm";

/**
 * 里程碑明细共享辅助层 —— 从 app/(dashboard)/ppm/milestone-details/page.tsx 抽出，
 * 供桌面页与移动端复用（W1 纯位置重构，行为不变）。
 */

/** 实施阶段标识（对齐源 overallStage === '实施阶段' 判定）。 */
export const IMPLEMENT_STAGE = "实施阶段";

/**
 * 任务执行状态（明细关联任务 PlanTask.status）→ Tag 颜色。
 * 值为中文文本 (未开始/进行中/已完成)，后端实时查不落库。未知值用默认色。
 */
export const TASK_EXECUTE_STATUS_COLOR: Record<string, string> = {
  未开始: "default",
  进行中: "processing",
  已完成: "success",
};

/** 抽屉形态（对照源 6 Vue 表单 + P0-8 变更审批 + ql-20260720-006 信息变更）。 */
export type DrawerMode =
  | "create" // 草稿新增(AddNodeDetailForm)
  | "edit" // 草稿编辑(NodeDetailForm,draft/rejected 返工)
  | "audit" // 审核中(AuditNodeDetailForm)
  | "approve" // 审批中(ApproveNodeDetailForm)
  | "change" // 变更原因录入(ChangeNodeDetailForm)
  | "changeApprove" // 变更审批(ChangeApproveNodeDetailForm,status=change_pending)
  | "changeInfo" // 已完成明细信息变更(不改状态,update_detail 同步任务计划字段)
  | "view"; // 只读(ViewNodeDetailForm,done/archived)

export interface DetailDrawerState {
  open: boolean;
  mode: DrawerMode;
  planNodeId?: string;
  moduleId?: string | null;
  detail?: PsPlanNodeDetail;
  /** 当前里程碑 overall_stage,用于判断「所属模块」是否展示(仅实施阶段)。 */
  overallStage?: string | null;
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

/** 把字符串/null 归一为 Dayjs(空值返回 null)。 */
export function toDay(v: string | null | undefined): Dayjs | null {
  if (!v) return null;
  try {
    const d = dayjs(v);
    return typeof d?.isValid === "function" && d.isValid() ? d : null;
  } catch {
    return null;
  }
}

/** Dayjs → 'YYYY-MM-DD' 或 null。 */
export function fromDate(d: Dayjs | null): string | null {
  if (!d) return null;
  if (typeof (d as unknown as Record<string, unknown>)?.format !== "function") return null;
  return d.format("YYYY-MM-DD");
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
export function processColor(nodeKey: string | null | undefined): string {
  if (!nodeKey) return "green";
  if (nodeKey.includes("reject")) return "red";
  if (nodeKey === "change" || nodeKey.includes("change")) return "orange";
  return "green";
}

/** 结果态统计小盒子 (blue-600 主色)。 */
export function StatBox({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "blue" | "amber";
}) {
  const numCls = tone === "amber" ? "text-destructive" : "text-primary";
  return (
    <div className="min-w-[120px] flex-1 rounded-lg border border-border bg-muted/40 p-3 text-center">
      <div className={`text-2xl font-bold leading-tight ${numCls}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/** 查询条件外壳:垂直布局(标题在上,控件在下),对齐 project-plans 风格。 */
export function Field({
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

/** AntD Form 内的卡片化分组(对齐源 el-card header="...")。 */
export function FormSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 rounded border bg-card p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

/**
 * 只读展示所属模块名(非编辑模式用)。
 * 优先用后端派生的 module_name(模块被删/跨里程碑也能解析),
 * 兜底当前里程碑模块列表反查,最后兜底原 ID,避免裸露 UUID。
 */
export function ModuleReadText({
  value,
  name,
  modules,
}: {
  value?: string | null;
  name?: string | null;
  modules: PlanNodeModule[];
}) {
  if (name) return <span>{name}</span>;
  if (!value) return <span className="text-muted-foreground">—</span>;
  const found = modules.find((m) => m.id === value)?.module_name;
  return <span>{found ?? value}</span>;
}
