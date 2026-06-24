import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

// 直接 import 具体组件文件,绕过 charts/index.ts 的 next/dynamic(ssr:false)
// (dynamic 在 jsdom 测试环境会一直停在 loading 态)。
import { RuntimeUsageLineChart } from "@/components/charts/RuntimeUsageLineChart";
import type { RuntimeUsagePoint } from "@/components/charts/RuntimeUsageLineChart";

function makePoint(ts: string, input = 100, output = 50): RuntimeUsagePoint {
  return {
    ts,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    total_cost_usd: 0,
  };
}

describe("RuntimeUsageLineChart", () => {
  it("有数据时挂载 echarts 容器,不抛错", () => {
    const { container } = render(
      <RuntimeUsageLineChart
        points={[
          makePoint("2026-06-24T00:00:00", 1000, 500),
          makePoint("2026-06-24T01:00:00", 2000, 800),
        ]}
      />,
    );
    // echarts-for-react 渲染根 div 带 class
    expect(container.querySelector(".echarts-for-react")).not.toBeNull();
  });

  it("空数据显示暂无数据占位", () => {
    render(<RuntimeUsageLineChart points={[]} />);
    expect(screen.getByText("暂无数据")).not.toBeNull();
    expect(screen.queryByText(".echarts-for-react")).toBeNull();
  });

  it("loading=true 显示骨架", () => {
    render(
      <RuntimeUsageLineChart
        points={[makePoint("2026-06-24T00:00:00")]}
        loading
      />,
    );
    expect(screen.getByLabelText("用量折线图加载中")).not.toBeNull();
  });

  it("自定义高度透传", () => {
    const { container } = render(
      <RuntimeUsageLineChart
        points={[makePoint("2026-06-24T00:00:00")]}
        height={80}
      />,
    );
    const root = container.querySelector(".echarts-for-react") as HTMLElement;
    expect(root.style.height).toBe("80px");
  });

  it("单点序列不抛错(sparkline 退化场景)", () => {
    const { container } = render(
      <RuntimeUsageLineChart points={[makePoint("2026-06-24T00:00:00")]} />,
    );
    expect(container.querySelector(".echarts-for-react")).not.toBeNull();
  });

  it("默认高度 120", () => {
    const { container } = render(
      <RuntimeUsageLineChart
        points={[makePoint("2026-06-24T00:00:00")]}
      />,
    );
    const root = container.querySelector(".echarts-for-react") as HTMLElement;
    expect(root.style.height).toBe("120px");
  });
});
