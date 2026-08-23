import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { WorkHourPieChart } from "@/components/charts/WorkHourPieChart";
import { useThemeStore } from "@/stores/theme";

describe("WorkHourPieChart", () => {
  // 组件订阅 useThemeStore(task-09),dark 用例改写 store 后恢复默认主题,
  // 避免 zustand 单例状态泄漏到其它测试文件。
  afterEach(() => {
    useThemeStore.setState({ theme: "ai-native" });
  });

  it("有数据时挂载 echarts 容器", () => {
    const { container } = render(
      <WorkHourPieChart
        rows={[
          { name: "alice", total_hours: 10 },
          { name: "bob", total_hours: 5 },
        ]}
        totalHours={15}
      />,
    );
    expect(container.querySelector(".echarts-for-react")).not.toBeNull();
  });

  it("空数据显示暂无数据占位", () => {
    render(<WorkHourPieChart rows={[]} totalHours={0} />);
    expect(screen.getByText("暂无数据")).not.toBeNull();
  });

  it("totalHours=0 显示占位", () => {
    render(
      <WorkHourPieChart rows={[{ name: "a", total_hours: 0 }]} totalHours={0} />,
    );
    expect(screen.getByText("暂无数据")).not.toBeNull();
  });

  it("Top N 聚合不抛错", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      name: `u${i}`,
      total_hours: 10 - i,
    }));
    const { container } = render(
      <WorkHourPieChart rows={rows} totalHours={49} topN={5} />,
    );
    expect(container.querySelector(".echarts-for-react")).not.toBeNull();
  });

  it("dark 主题下订阅 useThemeStore 正常渲染(dark 配色注入)", () => {
    useThemeStore.setState({ theme: "dark" });
    const { container } = render(
      <WorkHourPieChart
        rows={[
          { name: "alice", total_hours: 10 },
          { name: "bob", total_hours: 5 },
        ]}
        totalHours={15}
      />,
    );
    expect(container.querySelector(".echarts-for-react")).not.toBeNull();
  });
});
