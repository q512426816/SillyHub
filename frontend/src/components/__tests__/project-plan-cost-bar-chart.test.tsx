import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProjectPlanCostBarChart } from "@/components/charts/ProjectPlanCostBarChart";
import type { PsProjectPlan } from "@/lib/ppm/types";

function makePlan(id: string): PsProjectPlan {
  return {
    id,
    project_id: "p1",
    project_name: id,
    project_manager_id: null,
    project_manager_name: null,
    project_start_time: null,
    project_plan_end_time: null,
    contract_sign_time: null,
    contract_name: null,
    contract_amount: null,
    profit_margin: null,
    profit_amount: null,
    module: null,
    budget_amount: "100",
    budget_person_days: null,
    actual_consumption_person_days: null,
    remaining_available_person_days: null,
    status: "active",
    adjustment_person_days: null,
    total_cost: "40",
    labor_cost: null,
    remaining_cost: "60",
    cost_adjustment: null,
    company_name: null,
    create_name: null,
    created_at: "",
    updated_at: "",
  };
}

describe("ProjectPlanCostBarChart", () => {
  it("有数据时挂载 echarts 容器", () => {
    const { container } = render(
      <ProjectPlanCostBarChart plans={[makePlan("A"), makePlan("B")]} />,
    );
    expect(container.querySelector(".echarts-for-react")).not.toBeNull();
  });

  it("空 plans 显示暂无数据占位", () => {
    render(<ProjectPlanCostBarChart plans={[]} />);
    expect(screen.getByText("暂无数据")).not.toBeNull();
  });

  it("null 字段不抛错", () => {
    const plan = makePlan("A");
    plan.budget_amount = null;
    plan.total_cost = null;
    plan.remaining_cost = null;
    const { container } = render(<ProjectPlanCostBarChart plans={[plan]} />);
    expect(container.querySelector(".echarts-for-react")).not.toBeNull();
  });
});
