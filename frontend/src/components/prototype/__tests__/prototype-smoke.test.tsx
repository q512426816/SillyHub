/**
 * 原型视图冒烟测试（2026-09-27-prototype-pipeline FR-02 / FR-04）。
 *
 * 六个原型视图（五页面 + 一流程）渲染不崩、关键结构在位——
 * 守护点：生产 primer 组件 API 漂移破坏原型视图时在此拦截，而非编译产物才发现。
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChangeCenterView } from "../change-center-view";
import { ChangeDetailView } from "../change-detail-view";
import { SessionPortalView } from "../session-portal-view";
import { SillySpecFlowView } from "../sillyspec-flow-view";
import { WorkspaceListView } from "../workspace-list-view";
import { WorkspaceOverviewView } from "../workspace-overview-view";

describe("原型视图冒烟", () => {
  it("变更中心：页头/计数/tab/列表/脚注在位", () => {
    const { container, getByText, getByRole } = render(<ChangeCenterView />);
    expect(getByText("变更中心")).toBeTruthy();
    expect(getByText("新建变更")).toBeTruthy();
    expect(getByRole("tab", { name: /已归档/ })).toBeTruthy();
    expect(container.querySelector('[role="tablist"]')).toBeTruthy();
    expect(getByText(/显示 9 \/ 9 个变更/)).toBeTruthy();
  });

  it("变更详情：checks 横条/时间线/MetaPanel 六组在位", () => {
    const { container, getByText } = render(<ChangeDetailView />);
    expect(getByText("头脑风暴")).toBeTruthy();
    expect(container.querySelectorAll("li").length).toBeGreaterThan(3);
    for (const section of ["基本信息", "负责人", "消耗统计", "阶段进度", "关联会话", "平台同步"]) {
      expect(getByText(section)).toBeTruthy();
    }
  });

  it("工作区列表：行式列表/分页/脚注在位", () => {
    const { getByText } = render(<WorkspaceListView />);
    expect(getByText("multi-agent-platform")).toBeTruthy();
    expect(getByText("上一页")).toBeTruthy();
    expect(getByText(/显示 5 \/ 5 个工作区/)).toBeTruthy();
  });

  it("工作区概览：页头/守护横幅/统计四格在位", () => {
    const { getByText, getAllByText } = render(<WorkspaceOverviewView />);
    expect(getByText("守护运行中 · 最后心跳 2 分钟前 · 队列 0")).toBeTruthy();
    // 「活跃变更」同时出现在统计格与左栏节标题，getAllByText 断言两处都在位。
    expect(getAllByText("活跃变更").length).toBeGreaterThanOrEqual(2);
    for (const label of ["本周 token 消耗", "成员", "已归档变更"]) {
      expect(getByText(label)).toBeTruthy();
    }
  });

  it("会话门户：三栏结构与输入区在位", () => {
    const { getByText } = render(<SessionPortalView />);
    expect(getByText("今天")).toBeTruthy();
    expect(getByText("昨天")).toBeTruthy();
    expect(getByText("输入消息发送到该会话…")).toBeTruthy();
  });

  it("SillySpec 流程：双泳道状态机渲染", () => {
    const { container, getByText } = render(<SillySpecFlowView />);
    expect(getByText("轻量变更（默认快道）")).toBeTruthy();
    expect(getByText("完整流程（大改动）")).toBeTruthy();
    expect(container.querySelector('[data-flow-id="t-done"]')).toBeTruthy();
    expect(container.querySelector('[data-flow-id="f-verify"]')).toBeTruthy();
  });
});
