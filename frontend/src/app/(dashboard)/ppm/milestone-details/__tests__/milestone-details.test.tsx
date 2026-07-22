// task-04:里程碑明细 6 态审批表单单测。
//
// 覆盖(task-04.md TDD 步骤 + AC-1/AC-4):
//   1. modeForStatus 6 态映射:draft/rejected → edit;review → audit;
//      approve → approve;done/archived/未知 → view(降级只读,边界 1)
//   2. PlanDetailActions 各 status 下按钮显隐 + 权限禁用:
//      - draft:提交审核 + 变更
//      - review:审核人可点(审核通过/驳回/变更);非审核人 disabled
//      - approve:审批人可点(审批通过/驳回/变更);非审批人 disabled
//      - rejected:重新提交 + 变更
//      - done/archived:无按钮(终态)
//   3. change 提交校验:空 reason 不调 onSubmit(边界 6,前端兜底)
//
// 测试边界:
//   - vitest jsdom 无 ResizeObserver/matchMedia,AntD Drawer/Table 会用到,
//     本测试只覆盖纯函数 modeForStatus + 纯 shadcn Button 组件 PlanDetailActions
//     (不渲染 AntD Drawer/DetailDrawer,规避 canvas/getBoundingClientRect 易碎点)。
//   - 「变更审批」ChangeApproveNodeDetailForm 并入 approve 分支,以 parent_id 区分,
//     属 DetailDrawer 内部 mode 分支(不在此单测,由 tsc + 人工对照源覆盖)。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { modeForStatus } from "@/app/(dashboard)/ppm/milestone-details/page";
import { PlanDetailActions } from "@/components/ppm-status-actions";
import type { PsPlanNodeDetail } from "@/lib/ppm";

// worktree 的 node_modules 不完整,@testing-library/jest-dom 的 toBeEnabled/
// toBeDisabled matcher 在 vitest 下未稳定注册(同环境 workspace 测试同样挂)。
// 改用原生 button.disabled 属性断言,与 admin-user-drawer.test.tsx 风格一致,
// 绕开 matcher 注册,保证测试在任何 node_modules 完整度下都稳定。
function btnDisabled(text: string): void {
  const el = screen.getByText(text).closest("button") as HTMLButtonElement;
  expect(el.disabled).toBe(true);
}
function btnEnabled(text: string): void {
  const el = screen.getByText(text).closest("button") as HTMLButtonElement;
  expect(el.disabled).toBe(false);
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function mkDetail(
  over: Partial<PsPlanNodeDetail> & { id: string; status: string },
): PsPlanNodeDetail {
  return {
    id: over.id,
    plan_node_id: over.plan_node_id ?? "node-1",
    detailed_stage: over.detailed_stage ?? null,
    task_theme: over.task_theme ?? "示例明细",
    task_description: over.task_description ?? null,
    requirements: over.requirements ?? null,
    role_name: over.role_name ?? null,
    achievement: over.achievement ?? null,
    overall_stage: over.overall_stage ?? null,
    plan_workload: over.plan_workload ?? null,
    plan_begin_time: over.plan_begin_time ?? null,
    plan_complete_time: over.plan_complete_time ?? null,
    actual_begin_time: over.actual_begin_time ?? null,
    actual_complete_time: over.actual_complete_time ?? null,
    no: over.no ?? "1",
    execute_user_id: over.execute_user_id ?? null,
    module_id: over.module_id ?? null,
    attach_group_id: over.attach_group_id ?? null,
    file_urls: over.file_urls ?? [],
    status: over.status,
    parent_id: over.parent_id ?? null,
    audit_user_id: over.audit_user_id ?? null,
    audit_user_name: over.audit_user_name ?? null,
    approve_user_id: over.approve_user_id ?? null,
    approve_user_name: over.approve_user_name ?? null,
    execute_user_name: over.execute_user_name ?? null,
    module_name: over.module_name ?? null,
    task_execute_status: over.task_execute_status ?? null,
    change_reason: over.change_reason ?? null,
    created_at: over.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: over.updated_at ?? "2026-01-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// AC-1:modeForStatus 6 态 + 边界 1(未识别降级 view)
// ---------------------------------------------------------------------------

describe("modeForStatus — 6 态映射(AC-1 + 边界 1)", () => {
  it("draft → edit(草稿编辑,对照 NodeDetailForm)", () => {
    expect(modeForStatus("draft")).toBe("edit");
  });

  it("rejected → edit(驳回返工,对照 NodeDetailForm)", () => {
    expect(modeForStatus("rejected")).toBe("edit");
  });

  it("review → audit(审核中,对照 AuditNodeDetailForm)", () => {
    expect(modeForStatus("review")).toBe("audit");
  });

  it("approve → approve(审批中,对照 ApproveNodeDetailForm/ChangeApprove)", () => {
    expect(modeForStatus("approve")).toBe("approve");
  });

  it("done → view(终态只读,对照 ViewNodeDetailForm)", () => {
    expect(modeForStatus("done")).toBe("view");
  });

  it("archived → view(变更归档终态)", () => {
    expect(modeForStatus("archived")).toBe("view");
  });

  it("未识别状态 → view(边界 1:降级只读,不报错)", () => {
    expect(modeForStatus("unknown")).toBe("view");
    expect(modeForStatus("")).toBe("view");
    expect(modeForStatus("pending")).toBe("view");
  });
});

// ---------------------------------------------------------------------------
// AC-4:PlanDetailActions 各 status 按钮显隐 + 权限禁用
// ---------------------------------------------------------------------------

describe("PlanDetailActions — 按钮 6 态显隐 + 权限(AC-4)", () => {
  const onSubmit = vi.fn();

  beforeEach(() => {
    onSubmit.mockClear();
  });

  it("draft:展示「提交审核」+「变更」,无权限门槛", () => {
    const d = mkDetail({ id: "d1", status: "draft" });
    render(
      <PlanDetailActions detail={d} currentUserId="u1" onSubmit={onSubmit} />,
    );
    btnEnabled("提交审核");
    btnEnabled("变更");

    fireEvent.click(screen.getByText("提交审核"));
    expect(onSubmit).toHaveBeenCalledWith("d1", "save");
  });

  it("review:审核人命中 → 审核通过/驳回可点", () => {
    const d = mkDetail({
      id: "d2",
      status: "review",
      audit_user_id: "auditor-1",
    });
    render(
      <PlanDetailActions
        detail={d}
        currentUserId="auditor-1"
        onSubmit={onSubmit}
      />,
    );
    btnEnabled("审核通过");
    btnEnabled("驳回");
    btnEnabled("变更");

    fireEvent.click(screen.getByText("驳回"));
    expect(onSubmit).toHaveBeenCalledWith("d2", "reject");
  });

  it("review:非审核人 → 审核通过/驳回 disabled(X-003 待指派提示)", () => {
    const d = mkDetail({
      id: "d3",
      status: "review",
      audit_user_id: "auditor-1",
    });
    render(
      <PlanDetailActions
        detail={d}
        currentUserId="other-user"
        onSubmit={onSubmit}
      />,
    );
    btnDisabled("审核通过");
    btnDisabled("驳回");
    // 变更不受审核人限制
    btnEnabled("变更");
  });

  it("review:audit_user 未指派 → 审核按钮 disabled + 待指派 title", () => {
    const d = mkDetail({ id: "d4", status: "review", audit_user_id: null });
    render(
      <PlanDetailActions
        detail={d}
        currentUserId="u1"
        onSubmit={onSubmit}
      />,
    );
    const approveBtn = screen.getByText("审核通过").closest("button") as HTMLButtonElement;
    expect(approveBtn.disabled).toBe(true);
    expect(approveBtn.getAttribute("title")).toContain("待指派");
  });

  it("approve:审批人命中 → 审批通过/驳回可点", () => {
    const d = mkDetail({
      id: "d5",
      status: "approve",
      approve_user_id: "approver-1",
    });
    render(
      <PlanDetailActions
        detail={d}
        currentUserId="approver-1"
        onSubmit={onSubmit}
      />,
    );
    btnEnabled("审批通过");
    btnEnabled("驳回");

    fireEvent.click(screen.getByText("审批通过"));
    expect(onSubmit).toHaveBeenCalledWith("d5", "save");
  });

  it("approve:非审批人 → 审批按钮 disabled", () => {
    const d = mkDetail({
      id: "d6",
      status: "approve",
      approve_user_id: "approver-1",
    });
    render(
      <PlanDetailActions
        detail={d}
        currentUserId="other-user"
        onSubmit={onSubmit}
      />,
    );
    btnDisabled("审批通过");
    btnDisabled("驳回");
  });

  it("rejected:展示「重新提交」+「变更」", () => {
    const d = mkDetail({ id: "d7", status: "rejected" });
    render(
      <PlanDetailActions detail={d} currentUserId="u1" onSubmit={onSubmit} />,
    );
    btnEnabled("重新提交");
    btnEnabled("变更");

    fireEvent.click(screen.getByText("重新提交"));
    expect(onSubmit).toHaveBeenCalledWith("d7", "save");
  });

  it("done:终态无操作按钮(渲染为空)", () => {
    const d = mkDetail({ id: "d8", status: "done" });
    const { container } = render(
      <PlanDetailActions detail={d} currentUserId="u1" onSubmit={onSubmit} />,
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByText("变更")).toBeNull();
  });

  it("archived:终态无操作按钮(渲染为空)", () => {
    const d = mkDetail({ id: "d9", status: "archived" });
    const { container } = render(
      <PlanDetailActions detail={d} currentUserId="u1" onSubmit={onSubmit} />,
    );
    expect(container.textContent).toBe("");
  });

  it("任意非终态 → 「变更」按钮可触发 change 动作", () => {
    const d = mkDetail({
      id: "d10",
      status: "review",
      audit_user_id: "auditor-1",
    });
    render(
      <PlanDetailActions
        detail={d}
        currentUserId="anyone"
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByText("变更"));
    expect(onSubmit).toHaveBeenCalledWith("d10", "change");
  });

  it("globalDisabled 透传:所有按钮禁用", () => {
    const d = mkDetail({ id: "d11", status: "draft" });
    render(
      <PlanDetailActions
        detail={d}
        currentUserId="u1"
        disabled
        onSubmit={onSubmit}
      />,
    );
    btnDisabled("提交审核");
    btnDisabled("变更");
  });
});

// ---------------------------------------------------------------------------
// 边界 6:change 必填校验由 DetailDrawer mode="change" 分支 + page.tsx
// handleSubmit 兜底(空 reason → showToast「变更原因不能为空」,不发请求)。
// 此处不渲染 DetailDrawer(依赖 AntD Drawer/jsdom 易碎),仅断言 PlanDetailActions
// 触发的 change action 会回调 onSubmit(id, "change"),由上层 handleSubmit 做校验。
// 详情校验逻辑见 page.tsx handleSubmit 的 `if (!changeReason.trim())` 分支。
// ---------------------------------------------------------------------------
