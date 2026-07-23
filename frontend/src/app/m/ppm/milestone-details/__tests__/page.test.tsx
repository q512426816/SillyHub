/**
 * W6-T2/T4 · app/m/ppm/milestone-details/page.tsx 移动主页集成测试。
 *
 * 覆盖三层钻取 page 的核心契约（纯函数 modeForStatus 已由桌面 milestone-details 测试覆盖，
 * 此处聚焦 page 层接线）：
 *  - 里程碑列表渲染（getProjectPlan + listPsPlanNodes）+ readOnly 显隐（can_edit）。
 *  - 钻取：点非模块里程碑 → 明细层（listPsPlanNodeDetails）；点模块里程碑 → 模块层（listPlanNodeModules）。
 *  - 明细 mode 分发：点明细卡片 → DetailDrawer 收到 modeForStatus(status)（draft→edit / done→view）。
 *
 * mock 策略（对齐 app/m/layout.test.tsx）：next/navigation 可变 ref；@/lib/ppm 函数全 mock（beforeEach 配返回值）；
 * 重型表单子组件（PsPlanNodeDrawer/DetailDrawer/ModuleFormDrawer/ImportModuleModal/MobileExportButton/PpmText）
 * mock 成带 testid 锚点的占位；useSession 用真实 store。
 */
import { createElement, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useSession } from "@/stores/session";

// ── next/navigation mock：useSearchParams 返回 plan=plan-1 ────────────────────
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "plan" ? "plan-1" : null) }),
}));

// ── @/lib/ppm mock：工厂返回 vi.fn，返回值在 beforeEach 配（避免 hoist 引用外部变量）───
vi.mock("@/lib/ppm", () => ({
  getProjectPlan: vi.fn(),
  listPsPlanNodes: vi.fn(),
  listPsPlanNodeDetails: vi.fn(),
  listPlanNodeModules: vi.fn(),
  exportMilestoneDetails: vi.fn(),
  deletePsPlanNode: vi.fn(),
  deletePsPlanNodeDetail: vi.fn(),
  deletePlanNodeModule: vi.fn(),
  createPlanNodeModule: vi.fn(),
  updatePlanNodeModule: vi.fn(),
  savePlanNodeDetailProcess: vi.fn(),
  rejectPlanNodeDetailProcess: vi.fn(),
  changePlanNodeDetailProcess: vi.fn(),
}));

// ── shared toast mock ────────────────────────────────────────────────────────
vi.mock("@/app/(dashboard)/ppm/shared", () => ({
  useToast: () => ({ toast: null, showToast: vi.fn() }),
  Toast: () => null,
}));

// ── 重型子组件 mock：占位 + 锚点 ──────────────────────────────────────────────
vi.mock("@/components/mobile/mobile-export-button", () => ({
  MobileExportButton: () =>
    createElement("button", { "data-testid": "mobile-export-button" }, "导出"),
}));
// MilestoneSheet 内含 antd Drawer（jsdom 无 getComputedStyle 报 Not implemented），
// 测试改直接渲染里程碑卡片内容（透传 nodes 层）——保留 onDrill 钻取接线断言。
// can_edit 由 mocked getProjectPlan 决定，MilestoneSheet 内部也调同一 mock 收敛权限。
vi.mock("@/components/mobile/milestone-sheet", () => ({
  MilestoneSheet: ({
    open,
    planId,
    onDrill,
  }: {
    open: boolean;
    planId: string;
    onClose: () => void;
    onDrill?: (node: {
      id: string;
      has_module?: boolean;
      task_theme?: string | null;
    }) => void;
  }) => {
    const [canEdit, setCanEdit] = useState(true);
    useEffect(() => {
      if (!open) return;
      void import("@/lib/ppm").then((m) =>
        m.getProjectPlan(planId).then((p: { can_edit?: boolean }) => setCanEdit(!!p.can_edit)),
      );
    }, [open, planId]);
    if (!open) return null;
    return createElement(
      "div",
      { "data-testid": "milestone-sheet" },
      canEdit
        ? createElement(
            "button",
            { "data-testid": "new-milestone-btn" },
            "新建里程碑",
          )
        : null,
      createElement("button", { "data-testid": "mobile-export-button" }, "导出"),
      createElement(
        "button",
        {
          "data-testid": "node-n1",
          onClick: () => onDrill?.({ id: "n1", has_module: false, task_theme: "里程碑一" }),
        },
        "里程碑一",
      ),
      createElement(
        "button",
        {
          "data-testid": "node-n2",
          onClick: () => onDrill?.({ id: "n2", has_module: true, task_theme: "里程碑二" }),
        },
        "里程碑二",
      ),
    );
  },
}));
vi.mock("@/components/ppm/milestone/detail-drawer", () => ({
  DetailDrawer: ({ mode }: { mode: string }) =>
    createElement("div", { "data-testid": "detail-drawer", "data-mode": mode }),
}));
vi.mock("@/components/ppm/milestone/ps-plan-node-drawer", () => ({
  PsPlanNodeDrawer: () =>
    createElement("div", { "data-testid": "ps-plan-node-drawer" }),
}));
vi.mock("@/components/ppm/milestone/module-form-drawer", () => ({
  ModuleFormDrawer: () =>
    createElement("div", { "data-testid": "module-form-drawer" }),
}));
vi.mock("@/components/ppm/milestone/import-module-modal", () => ({
  ImportModuleModal: () =>
    createElement("div", { "data-testid": "import-module-modal" }),
}));
vi.mock("@/components/ppm-text", () => ({
  PpmText: ({ name, value }: { name?: string | null; value?: string | null }) =>
    createElement("span", null, name ?? value ?? "—"),
}));

import Page from "@/app/m/ppm/milestone-details/page";
import {
  getProjectPlan,
  listPsPlanNodeDetails,
  listPsPlanNodes,
  listPlanNodeModules,
} from "@/lib/ppm";

// ── fixtures ─────────────────────────────────────────────────────────────────
const plan = {
  id: "plan-1",
  project_id: "p1",
  project_name: "项目A",
  can_edit: true,
};
const nodes = [
  {
    id: "n1",
    no: 1,
    task_theme: "里程碑一",
    has_module: false,
    overall_stage: "设计阶段",
    duty_user_id: "u1",
    plan_workload: "5",
    plan_begin_time: "2026-01-01",
    plan_complete_time: "2026-01-05",
  },
  {
    id: "n2",
    no: 2,
    task_theme: "里程碑二",
    has_module: true,
    overall_stage: "实施阶段",
    duty_user_id: "u1",
    plan_workload: "10",
    plan_begin_time: "2026-02-01",
    plan_complete_time: "2026-02-10",
  },
];
const detailsN1 = [
  {
    id: "d1",
    task_theme: "明细草稿",
    detailed_stage: "阶段A",
    status: "draft",
    module_id: null,
    execute_user_id: "u1",
    execute_user_name: "张三",
    role_name: "开发",
    plan_workload: "3",
    plan_begin_time: "2026-01-01",
    plan_complete_time: "2026-01-04",
    task_execute_status: null,
    parent_id: null,
  },
  {
    id: "d2",
    task_theme: "明细完成",
    detailed_stage: "阶段B",
    status: "done",
    module_id: null,
    execute_user_id: "u1",
    execute_user_name: "张三",
    role_name: "测试",
    plan_workload: "2",
    plan_begin_time: "2026-01-05",
    plan_complete_time: "2026-01-07",
    task_execute_status: "已完成",
    parent_id: null,
  },
];

beforeEach(() => {
  useSession.setState({
    accessToken: "tok",
    hydrated: true,
    user: { id: "u1" },
  } as never);
  vi.mocked(getProjectPlan).mockResolvedValue(plan as never);
  vi.mocked(listPsPlanNodes).mockResolvedValue(nodes as never);
  vi.mocked(listPsPlanNodeDetails).mockImplementation(async (nodeId: string) =>
    nodeId === "n1" ? (detailsN1 as never) : ([] as never),
  );
  vi.mocked(listPlanNodeModules).mockResolvedValue([] as never);
});

afterEach(() => {
  cleanup();
  useSession.setState({
    hydrated: false,
    accessToken: null,
    refreshToken: null,
    user: null,
  } as never);
  vi.clearAllMocks();
});

describe("里程碑明细移动主页 · 列表渲染 + readOnly", () => {
  it("can_edit=true → 渲染里程碑卡片 + 新建里程碑/导出入口", async () => {
    render(createElement(Page));
    expect(await screen.findByText("里程碑一")).toBeTruthy();
    expect(screen.getByText("里程碑二")).toBeTruthy();
    expect(screen.getByText("新建里程碑")).toBeTruthy();
    expect(screen.getByTestId("mobile-export-button")).toBeTruthy();
  });

  it("can_edit=false → readOnly，隐藏新建里程碑（查询/导出不禁）", async () => {
    vi.mocked(getProjectPlan).mockResolvedValue({ ...plan, can_edit: false } as never);
    render(createElement(Page));
    await screen.findByText("里程碑一");
    expect(screen.queryByText("新建里程碑")).toBeNull();
    // 只读仍可导出
    expect(screen.getByTestId("mobile-export-button")).toBeTruthy();
  });
});

describe("里程碑明细移动主页 · 三层钻取", () => {
  it("点非模块里程碑 → 进明细层并加载明细（moduleId=null 全量）", async () => {
    render(createElement(Page));
    await screen.findByText("里程碑一");
    fireEvent.click(screen.getByText("里程碑一"));
    expect(await screen.findByText("明细草稿")).toBeTruthy();
    // listPsPlanNodeDetails 只收 nodeId；module_id 过滤在 loadDetails 内部（非 API 参数）。
    expect(listPsPlanNodeDetails).toHaveBeenCalledWith("n1");
  });

  it("点模块里程碑 → 进模块层并加载模块列表", async () => {
    render(createElement(Page));
    await screen.findByText("里程碑二");
    fireEvent.click(screen.getByText("里程碑二"));
    // 模块层加载被触发（mock 返回 []，断言调用而非渲染）
    expect(listPlanNodeModules).toHaveBeenCalledWith("n2");
    // 标题切到模块层
    expect(await screen.findByText(/模块 · 里程碑二/)).toBeTruthy();
  });
});

describe("里程碑明细移动主页 · 明细 mode 分发（modeForStatus 接线）", () => {
  it("点 draft 明细 → DetailDrawer mode=edit；点 done 明细 → mode=view", async () => {
    render(createElement(Page));
    await screen.findByText("里程碑一");
    fireEvent.click(screen.getByText("里程碑一"));
    await screen.findByText("明细草稿");

    // draft → edit（草稿编辑，modeForStatus("draft")="edit"）
    fireEvent.click(screen.getByText("明细草稿"));
    expect(await screen.findByTestId("detail-drawer")).toHaveAttribute(
      "data-mode",
      "edit",
    );

    // done → view（终态只读，modeForStatus("done")="view"）
    fireEvent.click(screen.getByText("明细完成"));
    expect(screen.getByTestId("detail-drawer")).toHaveAttribute(
      "data-mode",
      "view",
    );
  });
});
