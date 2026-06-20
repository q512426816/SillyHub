import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

// 直接 import 具体组件文件,绕过 charts/index.ts 的 next/dynamic(ssr:false)
// (dynamic 在 jsdom 测试环境会一直停在 loading 态)。
import { WorkHourBarChart } from "@/components/charts/WorkHourBarChart";

describe("WorkHourBarChart", () => {
  it("有数据时挂载 echarts 容器,不抛错", () => {
    const { container } = render(
      <WorkHourBarChart
        rows={[
          { name: "alice", total_hours: 10 },
          { name: "bob", total_hours: 5 },
        ]}
      />,
    );
    // echarts-for-react 渲染根 div 带 class
    expect(container.querySelector(".echarts-for-react")).not.toBeNull();
  });

  it("空数据显示暂无数据占位", () => {
    render(<WorkHourBarChart rows={[]} />);
    expect(screen.getByText("暂无数据")).not.toBeNull();
    expect(screen.queryByText(".echarts-for-react")).toBeNull();
  });

  it("loading=true 显示骨架", () => {
    render(
      <WorkHourBarChart rows={[{ name: "a", total_hours: 1 }]} loading />,
    );
    expect(screen.getByLabelText("工时柱状图加载中")).not.toBeNull();
  });

  it("自定义颜色与高度透传", () => {
    const { container } = render(
      <WorkHourBarChart
        rows={[{ name: "a", total_hours: 1 }]}
        color="#52c41a"
        height={200}
      />,
    );
    const root = container.querySelector(".echarts-for-react") as HTMLElement;
    expect(root.style.height).toBe("200px");
  });
});
