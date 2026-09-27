/**
 * FlowDiagram 原语单测（2026-09-27-prototype-pipeline FR-03）。
 *
 * 覆盖：节点/边渲染完整性、最长路径分层（下游 x 严格大于上游）、
 * 泳道行 y 分离、tone token 着色（CSS var，零硬编码）、虚线边。
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FlowDiagram } from "../flow-diagram";

const NODES = [
  { id: "a", label: "开始", tone: "brand" as const },
  { id: "b", label: "处理" },
  { id: "c", label: "门禁", tone: "warning" as const },
  { id: "d", label: "终态", tone: "success" as const },
];
const EDGES = [
  { from: "a", to: "b" },
  { from: "b", to: "c" },
  { from: "c", to: "d", label: "通过" },
];

function nodeX(container: HTMLElement, id: string): number {
  const transform = container.querySelector(`[data-flow-id="${id}"]`)?.getAttribute("transform");
  const m = transform?.match(/translate\((\d+)/);
  return m ? Number(m[1]) : -1;
}

describe("FlowDiagram 原语", () => {
  it("渲染全部节点、边与边标签", () => {
    const { container } = render(<FlowDiagram nodes={NODES} edges={EDGES} />);
    for (const n of NODES) {
      expect(container.querySelector(`[data-flow-id="${n.id}"]`)).toBeTruthy();
    }
    expect(container.querySelectorAll("path")).toHaveLength(EDGES.length + 1); // 3 边 + 1 marker 箭头
    expect(container.textContent).toContain("通过");
  });

  it("最长路径分层：下游节点 x 严格递增", () => {
    const { container } = render(<FlowDiagram nodes={NODES} edges={EDGES} />);
    expect(nodeX(container, "a")).toBeLessThan(nodeX(container, "b"));
    expect(nodeX(container, "b")).toBeLessThan(nodeX(container, "c"));
    expect(nodeX(container, "c")).toBeLessThan(nodeX(container, "d"));
  });

  it("泳道：不同 lane 的节点 y 分离", () => {
    const { container } = render(
      <FlowDiagram
        nodes={[
          { id: "x", lane: "l1", label: "泳道一" },
          { id: "y", lane: "l2", label: "泳道二" },
        ]}
        edges={[]}
        lanes={["l1", "l2"]}
      />,
    );
    const tx = (id: string) => {
      const t = container.querySelector(`[data-flow-id="${id}"]`)?.getAttribute("transform");
      const m = t?.match(/,\s*(\d+)\)/);
      return m ? Number(m[1]) : -1;
    };
    expect(tx("y")).toBeGreaterThan(tx("x"));
    expect(container.textContent).toContain("l1");
    expect(container.textContent).toContain("l2");
  });

  it("tone 着色走主题 token（brand 节点 fill=brand-50，无硬编码 hex）", () => {
    const { container } = render(<FlowDiagram nodes={NODES} edges={EDGES} />);
    const brandRect = container
      .querySelector('[data-flow-id="a"]')
      ?.querySelector("rect")
      ?.getAttribute("style");
    expect(brandRect).toContain("var(--color-brand-50)");
    const svgHtml = container.querySelector("svg")?.innerHTML ?? "";
    expect(svgHtml).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("虚线边渲染 stroke-dasharray", () => {
    const { container } = render(
      <FlowDiagram
        nodes={[
          { id: "a", label: "甲" },
          { id: "b", label: "乙" },
        ]}
        edges={[{ from: "a", to: "b", dashed: true }]}
      />,
    );
    const dashed = container.querySelector("path[stroke-dasharray]");
    expect(dashed).toBeTruthy();
  });

  it("显式 layer 权威钉住：跨道边不推挤钉住节点", () => {
    const { container } = render(
      <FlowDiagram
        nodes={[
          { id: "a", label: "源", layer: 3 },
          { id: "b", label: "钉住", layer: 1 },
        ]}
        edges={[{ from: "a", to: "b" }]}
      />,
    );
    // a 在第 3 列，b 钉在第 1 列——若被边推挤会落到第 4 列。
    expect(nodeX(container, "b")).toBeLessThan(nodeX(container, "a"));
  });
});
