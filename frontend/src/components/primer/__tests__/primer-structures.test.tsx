/**
 * primer 结构组件单测（2026-09-26-core-pages-visual-redesign task-03 / FR-01 FR-03）。
 *
 * 覆盖矩阵：UnderlineNav 受控切换+counter 联动+键盘切换、IssueRow 插槽渲染+hover
 * 操作+键盘激活、IssueRowHeader 列头、StatGrid tone 着色、PageHead 四插槽。
 * 依据：tasks/task-03.md acceptance。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IssueRow, IssueRowHeader } from "../issue-row";
import { MetaPanel, MetaPanelSection } from "../meta-panel";
import { StateIcon } from "../state-icon";
import { Timeline, TimelineItem } from "../timeline";
import { PageHead } from "../page-head";
import { StatGrid } from "../stat-grid";
import { UnderlineNav } from "../underline-nav";

type TabKey = "active" | "archived";

function renderNav(value: TabKey, onChange: (k: TabKey) => void) {
  return render(
    <UnderlineNav<TabKey>
      value={value}
      onChange={onChange}
      items={[
        { key: "active", label: "进行中", counter: 4 },
        { key: "archived", label: "已归档", counter: 12 },
      ]}
    />,
  );
}

describe("UnderlineNav 受控契约", () => {
  it("受控切换：点击非当前 tab 触发 onChange 且不内部改态", () => {
    const onChange = vi.fn();
    renderNav("active", onChange);
    fireEvent.click(screen.getByRole("tab", { name: /已归档/ }));
    expect(onChange).toHaveBeenCalledWith("archived");
    // 受控：未传新 value 前选中态不变
    expect(screen.getByRole("tab", { name: /已归档/ }).getAttribute("aria-selected")).toBe("false");
  });

  it("Counter 联动：两项计数渲染，当前项 active", () => {
    renderNav("active", () => {});
    expect(screen.getByText("4").className).toContain("border");
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("键盘激活只走原生 button 一次（2026-09-28-audit-risk-fixes：删容器级 onKeyDown 后不再双触发跳下一项）", () => {
    const onChange = vi.fn();
    renderNav("active", onChange);
    // 点击激活当前项恰好一次；容器不再在 keyDown 冒泡段二次分发 onChange(下一项)。
    fireEvent.click(screen.getByRole("tab", { name: /已归档/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("archived");
    // keyDown 冒泡到容器不再产生额外 onChange（原生 button 激活由浏览器承载）。
    fireEvent.keyDown(screen.getByRole("tab", { name: /进行中/ }), { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("IssueRow", () => {
  it("六 state 图标渲染 + leading/meta/right 插槽", () => {
    const { container } = render(
      <IssueRow
        state="open"
        title={<span>2026-09-25-observation-events-v3</span>}
        meta={<span>实现计划</span>}
        right={<span>5 分钟前</span>}
        leading={<input type="checkbox" aria-label="选择" />}
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("2026-09-25-observation-events-v3")).toBeTruthy();
    expect(screen.getByText("实现计划")).toBeTruthy();
    expect(screen.getByText("5 分钟前")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "选择" })).toBeTruthy();
  });

  it("hoverActions 默认 hidden（group-hover 浮现类）", () => {
    render(
      <IssueRow
        state="done"
        title="t"
        hoverActions={<button type="button">打开</button>}
      />,
    );
    const wrap = screen.getByRole("button", { name: "打开" }).parentElement;
    expect(wrap?.className).toContain("hidden");
    expect(wrap?.className).toContain("group-hover:flex");
  });

  it("leading 缺席渲染空占位——四子元素落设计轨道（2026-09-29-issue-row-grid-misalign）", () => {
    // 回归锚：此前 null 让主体列落第 2 轨 auto、右列内容挤进 1fr 轨被压后左溢
    // 出自身容器盒（与描述文字叠压）；占位 div（aria-hidden）对齐 IssueRowHeader
    // 先例，让主体回 1fr 轨、右列回 auto 轨。
    const { container } = render(
      <IssueRow
        state="open"
        title="标题"
        meta={<span>meta</span>}
        right={<span>右侧</span>}
        onClick={() => {}}
      />,
    );
    const row = container.querySelector("div[role=button]")!;
    const kids = Array.from(row.children);
    expect(kids).toHaveLength(4);
    const [placeholder] = kids;
    expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
    expect(placeholder?.childElementCount).toBe(0);
    // 带 leading 时占位槽由 leading 承担，子元素数不变（4）
    const { container: c2 } = render(
      <IssueRow
        state="open"
        title="标题2"
        leading={<input type="checkbox" aria-label="选择2" />}
        right={<span>右侧2</span>}
        onClick={() => {}}
      />,
    );
    expect(Array.from(c2.querySelector("div[role=button]")!.children)).toHaveLength(4);
  });

  it("onClick 行可键盘激活（Enter）", () => {
    const onClick = vi.fn();
    render(<IssueRow state="open" title="行标题" onClick={onClick} />);
    fireEvent.keyDown(screen.getByText("行标题").closest("div[role=button]")!, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("IssueRowHeader", () => {
  it("列头三段渲染", () => {
    render(
      <IssueRowHeader title="变更" right="更新时间" leading={<span>选</span>} />,
    );
    expect(screen.getByText("变更")).toBeTruthy();
    expect(screen.getByText("更新时间")).toBeTruthy();
    expect(screen.getByText("选")).toBeTruthy();
  });
});

describe("StatGrid", () => {
  it("tone=brand/warning 语义着色，default 无 inline 色", () => {
    render(
      <StatGrid
        items={[
          { label: "进行中变更", value: 4, tone: "brand" },
          { label: "待办处理", value: 2, tone: "warning" },
          { label: "会话", value: 12 },
        ]}
      />,
    );
    expect(screen.getByText("4").style.color).toBe("var(--color-brand-600)");
    expect(screen.getByText("2").style.color).toContain("var(--warning)");
    expect(screen.getByText("12").style.color).toBe("");
  });
});

describe("PageHead", () => {
  it("面包屑/标题/titleExtra/副标题/actions 五插槽齐渲染", () => {
    render(
      <PageHead
        breadcrumb={<span>workspaces / changes</span>}
        title="变更中心"
        titleExtra={<span>标签</span>}
        subtitle="4 个进行中 · 12 个已归档"
        actions={<button type="button">新建变更</button>}
      />,
    );
    expect(screen.getByText("workspaces / changes")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "变更中心" })).toBeTruthy();
    expect(screen.getByText("标签")).toBeTruthy();
    expect(screen.getByText("4 个进行中 · 12 个已归档")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建变更" })).toBeTruthy();
  });
});

describe("Timeline / TimelineItem（task-04 追加）", () => {
  it("children 折叠交互：默认隐藏，点击展开再收起", () => {
    render(
      <Timeline>
        <TimelineItem icon={<StateIcon name="check" size={12} />} title="需求设计完成" time="1 天前">
          日志行 1
        </TimelineItem>
      </Timeline>,
    );
    expect(screen.queryByText("日志行 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开详情" }));
    expect(screen.getByText("日志行 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起详情" }));
    expect(screen.queryByText("日志行 1")).toBeNull();
  });

  it("tone=current 节点用主题色 inline style", () => {
    const { container } = render(
      <TimelineItem icon={<StateIcon name="zap" size={12} />} title="执行中" tone="current" />,
    );
    const ring = container.querySelector("div.rounded-full") as HTMLElement;
    expect(ring.style.borderColor).toBe("var(--color-brand-600)");
  });
});

describe("MetaPanel / MetaPanelSection（task-04 追加）", () => {
  it("分组渲染：标题 + children 进容器", () => {
    render(
      <MetaPanel>
        <MetaPanelSection title="负责人">
          <span>qinyi</span>
        </MetaPanelSection>
        <MetaPanelSection title="消耗统计">
          <span>2.4M tok</span>
        </MetaPanelSection>
      </MetaPanel>,
    );
    expect(screen.getByText("负责人")).toBeTruthy();
    expect(screen.getByText("qinyi")).toBeTruthy();
    expect(screen.getByText("消耗统计")).toBeTruthy();
    expect(screen.getByText("2.4M tok")).toBeTruthy();
  });
});
