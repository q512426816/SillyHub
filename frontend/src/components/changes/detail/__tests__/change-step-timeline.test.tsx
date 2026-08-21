import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ChangeStepTimeline,
  formatStepTime,
  type StepTimelineEntry,
} from "@/components/changes/detail/change-step-timeline";

/**
 * ChangeStepTimeline 组件测试（2026-08-15-change-step-visibility task-05 / FR-02；
 * 2026-08-16-change-owner-from-token task-05 / FR-03 / FR-05 增补）。
 *
 * 覆盖：七值状态色映射（含未知值灰兜底）/ stage 分组组头 / completed 时间与
 * output 全量展示（D-004@v1 不截断，原 line-clamp 断言翻转）/ waiting 显示
 * wait_reason / steps null 空态 / 分组顺序遵循后端 entries 顺序（组件不再排序）/
 * entry key 稳定（stage-ordering）/ kind=event 事件条目专属渲染（👤 + 紫色
 * chip）/ 事件与 steps 混合排序 / 纯 steps（kind 缺省）零变化回归。
 *
 * ql-20260821-017 增补：时间展示本地化（formatStepTime，断言用同款 Intl 调用
 * 现算期望值——测试与组件跑在同一时区，跨环境确定性）/ 组头改「N/M 步」徽标 /
 * focusStage 阶段筛选联动。
 */

/** 与组件同款 Intl 格式现算期望值（时区随运行环境，两侧一致即确定） */
function expectLocalTime(specIso: string): string {
  return new Date(specIso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function entry(
  over: Partial<StepTimelineEntry> & Pick<StepTimelineEntry, "name" | "stage">,
): StepTimelineEntry {
  return {
    status: "pending",
    output: null,
    completed_at: null,
    ordering: 0,
    wait_reason: null,
    // 2026-08-16-change-owner-from-token task-03：api-types 重生成后 kind 为必填
    // （带 default 的字段生成器按响应必含处理），mock 补缺省值（CLAUDE.md 规则 21）。
    kind: "step",
    ...over,
  };
}

/** 取状态点元素（data-status 挂在 .tl-dot 语义的 span 上） */
function dot(container: HTMLElement, status: string): HTMLElement {
  const el = container.querySelector(`[data-status="${status}"]`);
  expect(el, `dot[data-status=${status}] 应存在`).not.toBeNull();
  return el as HTMLElement;
}

describe("ChangeStepTimeline", () => {
  it("steps null / 空数组 → 空态不渲染不抛（D-003 降级）", () => {
    const { container } = render(<ChangeStepTimeline steps={null} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<ChangeStepTimeline steps={[]} />);
    expect(c2).toBeEmptyDOMElement();
  });

  it("七值状态色映射 + 未知值灰兜底", () => {
    const { container } = render(
      <ChangeStepTimeline
        steps={[
          entry({ name: "完成步", stage: "brainstorm", status: "completed", ordering: 1 }),
          entry({ name: "进行步", stage: "brainstorm", status: "in-progress", ordering: 2 }),
          entry({ name: "等待步", stage: "brainstorm", status: "waiting", ordering: 3 }),
          entry({ name: "失败步", stage: "brainstorm", status: "failed", ordering: 4 }),
          entry({ name: "阻塞步", stage: "brainstorm", status: "blocked", ordering: 5 }),
          entry({ name: "过期步", stage: "brainstorm", status: "stale", ordering: 6 }),
          entry({ name: "未来步", stage: "brainstorm", status: "pending", ordering: 7 }),
          entry({ name: "未知步", stage: "brainstorm", status: "weird-value", ordering: 8 }),
        ]}
      />,
    );
    expect(dot(container, "completed").className).toContain("bg-emerald-500");
    // in-progress brand 点脉动
    const active = dot(container, "in-progress");
    expect(active.className).toContain("bg-brand-500");
    expect(active.className).toContain("animate-pulse");
    expect(dot(container, "waiting").className).toContain("bg-amber-500");
    expect(dot(container, "failed").className).toContain("bg-red-500");
    // blocked 与 stale 同为橙
    expect(dot(container, "blocked").className).toContain("bg-orange-500");
    expect(dot(container, "stale").className).toContain("bg-orange-500");
    expect(dot(container, "pending").className).toContain("bg-gray-300");
    // 未知值按 pending 灰兜底
    expect(dot(container, "weird-value").className).toContain("bg-gray-300");
  });

  it("按 stage 分组渲染组头（中文标签 + 完成数/总数）", () => {
    render(
      <ChangeStepTimeline
        steps={[
          entry({ name: "a1", stage: "brainstorm", status: "completed", ordering: 1 }),
          entry({ name: "a2", stage: "brainstorm", status: "pending", ordering: 2 }),
          entry({ name: "b1", stage: "plan", status: "completed", ordering: 1 }),
        ]}
      />,
    );
    const brainstormHeader = screen
      .getByText("需求分析")
      .closest("[data-stage]");
    expect(brainstormHeader).toHaveTextContent("1/2 步");
    const planHeader = screen.getByText("规划").closest("[data-stage]");
    expect(planHeader).toHaveTextContent("1/1 步");
  });

  it("未知 stage 组头显示原 stage 名（quick 兜底）", () => {
    render(
      <ChangeStepTimeline
        steps={[
          entry({ name: "q1", stage: "quick", status: "completed", ordering: 1 }),
        ]}
      />,
    );
    expect(screen.getByText("quick")).toBeInTheDocument();
    expect(screen.getByText("1/1 步")).toBeInTheDocument();
  });

  it("分组顺序遵循后端 entries 顺序，组件不再排序", () => {
    const { container } = render(
      <ChangeStepTimeline
        steps={[
          entry({ name: "p1", stage: "plan", status: "completed", ordering: 1 }),
          entry({ name: "b1", stage: "brainstorm", status: "completed", ordering: 1 }),
        ]}
      />,
    );
    // 组头 data-stage 按 DOM 序断言：输入序 plan 在前（即使 STAGE_ORDER 中 brainstorm 更早）
    const stages = Array.from(
      container.querySelectorAll("[data-stage]"),
    ).map((n) => n.getAttribute("data-stage"));
    expect(stages).toEqual(["plan", "brainstorm"]);
  });

  it("completed 步显示本地化完成时间（title/datetime 保留原始 ISO）与 output 全量（D-004@v1 不截断：无 clamp + break-words + max-h 滚动兜底）", () => {
    render(
      <ChangeStepTimeline
        steps={[
          entry({
            name: "加载项目上下文",
            stage: "brainstorm",
            status: "completed",
            ordering: 1,
            completed_at: "2026-08-15T15:44:08+00:00",
            output: "关键发现：CLI 六表 JSON 已含 steps[] 数据，读侧仅投影 current_stage",
          }),
        ]}
      />,
    );
    // 展示层：zh-CN 2-digit 本地时间（与组件同款 Intl 现算期望，时区无关）
    const time = screen.getByText(expectLocalTime("2026-08-15T15:44:08Z"));
    expect(time).toBeInTheDocument();
    // 机器可读层：dateTime/title 均保留后端归一的原始 ISO
    expect(time).toHaveAttribute("datetime", "2026-08-15T15:44:08+00:00");
    expect(time).toHaveAttribute("title", "2026-08-15T15:44:08+00:00");
    const output = screen.getByText(/CLI 六表 JSON 已含 steps\[\] 数据/);
    // D-004@v1 明确修订截断行为（明细不截断）——原「clamp 存在」断言按新行为翻转：
    // 无 line-clamp 自然换行 + max-h 容器滚动兜底（R-07）。
    expect(output.className).not.toContain("line-clamp");
    expect(output.className).toContain("break-words");
    expect(output.className).toContain("max-h");
    expect(output.className).toContain("overflow-y-auto");
  });

  it("waiting 步显示 wait_reason 与状态文案", () => {
    render(
      <ChangeStepTimeline
        steps={[
          entry({
            name: "设计确认",
            stage: "plan",
            status: "waiting",
            ordering: 2,
            wait_reason: "等待 1 项用户决策：刷新机制选型",
          }),
        ]}
      />,
    );
    expect(
      screen.getByText(/等待原因：等待 1 项用户决策：刷新机制选型/),
    ).toBeInTheDocument();
    expect(screen.getByText("等待中")).toBeInTheDocument();
  });

  it("entry key=stage-ordering 稳定：步状态推进后 key 序列不变，变化步内容更新", () => {
    const base = [
      entry({ name: "步一", stage: "execute", status: "completed", ordering: 1 }),
      entry({ name: "步二", stage: "execute", status: "in-progress", ordering: 2 }),
      entry({ name: "步三", stage: "execute", status: "pending", ordering: 3 }),
    ];
    const { rerender } = render(<ChangeStepTimeline steps={base} />);
    const keysBefore = Array.from(
      document.querySelectorAll("[data-key]"),
    ).map((n) => n.getAttribute("data-key"));
    expect(keysBefore).toEqual(["execute-1", "execute-2", "execute-3"]);

    // 步二完成：仅该 entry 换对象（新引用），其余引用不变
    const stepTwo = base[1];
    expect(stepTwo).toBeDefined();
    const next: StepTimelineEntry[] = [
      base[0]!,
      { ...stepTwo!, status: "completed", completed_at: "2026-08-15T16:00:00+00:00" },
      base[2]!,
    ];
    rerender(<ChangeStepTimeline steps={next} />);
    const keysAfter = Array.from(
      document.querySelectorAll("[data-key]"),
    ).map((n) => n.getAttribute("data-key"));
    expect(keysAfter).toEqual(["execute-1", "execute-2", "execute-3"]);
    // 变化步内容更新：完成时间出现（本地化文案）
    expect(
      screen.getByText(expectLocalTime("2026-08-15T16:00:00Z")),
    ).toBeInTheDocument();
  });
});

// ── 事件条目（kind="event"，2026-08-16-change-owner-from-token D-003@v1）─────

/** 旧数据兼容构造：抹掉 kind 字段（runtime undefined，模拟 kind 缺省的存量数据） */
function legacyEntry(
  over: Partial<StepTimelineEntry> & Pick<StepTimelineEntry, "name" | "stage">,
): StepTimelineEntry {
  const { kind: _omit, ...rest } = entry(over);
  return rest as StepTimelineEntry;
}

describe("ChangeStepTimeline 事件条目（kind=event）", () => {
  it("kind=event → 专属渲染：data-kind 锚点 + 👤 + 紫色 chip（A → B）+ 无 data-status 色点", () => {
    const { container } = render(
      <ChangeStepTimeline
        steps={[
          entry({
            name: "责任人变更",
            stage: "brainstorm",
            kind: "event",
            event_type: "owner_change",
            status: "completed",
            ordering: 2,
            completed_at: "2026-08-16T07:20:00+00:00",
            output: "admin → qinyi",
          }),
        ]}
      />,
    );
    const eventNode = container.querySelector('[data-kind="event"]');
    expect(eventNode).not.toBeNull();
    // name + output（A → B）+ 👤 emoji（dot 位与 chip 内各一）
    expect(eventNode?.textContent).toContain("责任人变更");
    expect(eventNode?.textContent).toContain("admin");
    expect(eventNode?.textContent).toContain("→");
    expect(eventNode?.textContent).toContain("qinyi");
    expect(eventNode?.textContent).toContain("👤");
    // 事件条目无 data-status 色点（dot 被 emoji 替代，原型 .tl-item.owner-event）
    expect(eventNode?.querySelector("[data-status]")).toBeNull();
    // 紫色 chip 样式对齐原型 .owner-chip（#faf5ff/#7c3aed/#e9d5ff）
    const chip = eventNode?.querySelector(".rounded-lg");
    expect(chip).not.toBeNull();
    expect(chip?.className).toContain("bg-purple-50");
    expect(chip?.className).toContain("text-violet-600");
    expect(chip?.className).toContain("border-purple-200");
    // 箭头 violet 加粗（原型 .arrow #a78bfa）
    expect(chip?.querySelector(".font-bold")?.className).toContain(
      "text-violet-400",
    );
    // completed_at 沿用 time 元素渲染（事件 status=completed，design §5 Phase 2.2；
    // 展示本地化文案，datetime 保留原始 ISO）
    expect(screen.getByText(expectLocalTime("2026-08-16T07:20:00Z"))).toHaveAttribute(
      "datetime",
      "2026-08-16T07:20:00+00:00",
    );
    // output 已进 chip，底部不再重复渲染 <p>
    expect(eventNode?.querySelector("p")).toBeNull();
  });

  it("混合排序：同 stage 事件与 steps 交错 → DOM 序遵循 entries 顺序且 data-key 无重复", () => {
    const { container } = render(
      <ChangeStepTimeline
        steps={[
          // 后端已对混合序列统一重编 ordering（design §5 Phase 2.2 Grill P1-1），
          // 事件 key 唯一性由重编保证，前端不改 key 机制。
          entry({ name: "进度确认", stage: "brainstorm", status: "completed", ordering: 0, completed_at: "2026-08-16T07:19:00+00:00" }),
          entry({ name: "责任人变更", stage: "brainstorm", kind: "event", event_type: "owner_change", status: "completed", ordering: 1, completed_at: "2026-08-16T07:20:00+00:00", output: "admin → qinyi" }),
          entry({ name: "加载项目上下文", stage: "brainstorm", status: "completed", ordering: 2, completed_at: "2026-08-16T07:21:00+00:00" }),
        ]}
      />,
    );
    const keys = Array.from(
      container.querySelectorAll("[data-key]"),
    ).map((n) => n.getAttribute("data-key"));
    // DOM 序 = entries 序（组件不排序）；key 无重复
    expect(keys).toEqual(["brainstorm-0", "brainstorm-1", "brainstorm-2"]);
    expect(new Set(keys).size).toBe(keys.length);
    // 事件夹在两个 step 之间（第 2 个条目是事件）
    const nodes = container.querySelectorAll("[data-key]");
    expect(nodes[0]).not.toHaveAttribute("data-kind", "event");
    expect(nodes[1]).toHaveAttribute("data-kind", "event");
    expect(nodes[2]).not.toHaveAttribute("data-kind", "event");
  });

  it("纯 steps 回归：kind 缺省（旧数据）全部走 step 分支，容器内无 data-kind=event", () => {
    const { container } = render(
      <ChangeStepTimeline
        steps={[
          legacyEntry({ name: "旧步一", stage: "brainstorm", status: "completed", ordering: 1, completed_at: "2026-08-15T15:44:08+00:00" }),
          legacyEntry({ name: "旧步二", stage: "brainstorm", status: "in-progress", ordering: 2 }),
          legacyEntry({ name: "旧步三", stage: "plan", status: "waiting", ordering: 1, wait_reason: "等用户" }),
        ]}
      />,
    );
    // 无事件条目
    expect(container.querySelector('[data-kind="event"]')).toBeNull();
    // step 渲染照常：色点 + waiting 原因
    expect(container.querySelector('[data-status="completed"]')).not.toBeNull();
    expect(container.querySelector('[data-status="in-progress"]')).not.toBeNull();
    expect(screen.getByText(/等待原因：等用户/)).toBeInTheDocument();
    // 同 stage 的组头计数照常（brainstorm 1/2 + plan 0/1）
    expect(screen.getByText("1/2 步")).toBeInTheDocument();
    expect(screen.getByText("0/1 步")).toBeInTheDocument();
  });

  it("长文本不 clamp：超长 output 自然换行 + max-h 滚动兜底（D-004@v1 / R-07）", () => {
    const longOutput = `超长输出。${"明细全量透传内容 ".repeat(120)}`;
    const { container } = render(
      <ChangeStepTimeline
        steps={[
          entry({
            name: "执行步骤",
            stage: "execute",
            status: "completed",
            ordering: 1,
            completed_at: "2026-08-16T08:00:00+00:00",
            output: longOutput,
          }),
        ]}
      />,
    );
    const output = container.querySelector("p");
    expect(output).not.toBeNull();
    // D-004@v1：明细不截断——无 line-clamp，break-words 自然换行，max-h 容器滚动兜底
    expect(output?.className).not.toContain("line-clamp");
    expect(output?.className).toContain("break-words");
    expect(output?.className).toContain("max-h");
    expect(output?.className).toContain("overflow-y-auto");
    expect(output?.textContent).toBe(longOutput);
  });
});

// ── 时间格式化（ql-20260821-017）────────────────────────────────────────────

describe("formatStepTime", () => {
  it("标准 ISO（+00:00 / Z）→ 本地化 zh-CN 2-digit 输出，与直接解析等价", () => {
    expect(formatStepTime("2026-08-15T15:44:08+00:00")).toBe(
      expectLocalTime("2026-08-15T15:44:08Z"),
    );
    expect(formatStepTime("2026-08-16T07:20:00Z")).toBe(
      expectLocalTime("2026-08-16T07:20:00Z"),
    );
  });

  it("后端 isoformat 微秒（6 位）截到毫秒，结果与毫秒精度解析等价", () => {
    expect(formatStepTime("2026-08-15T15:44:08.123456+00:00")).toBe(
      expectLocalTime("2026-08-15T15:44:08.123Z"),
    );
  });

  it("缺秒 / 空格分隔 / 紧凑偏移（+0800）等宽松形状可解析", () => {
    expect(formatStepTime("2026-08-15T15:44+00:00")).toBe(
      expectLocalTime("2026-08-15T15:44:00Z"),
    );
    expect(formatStepTime("2026-08-15 15:44:08+00:00")).toBe(
      expectLocalTime("2026-08-15T15:44:08Z"),
    );
    expect(formatStepTime("2026-08-15T15:44:08+0000")).toBe(
      expectLocalTime("2026-08-15T15:44:08Z"),
    );
  });

  it("非 ISO 形状原串回退（Grill #18 兜底：不炸不猜）", () => {
    expect(formatStepTime("not-a-date")).toBe("not-a-date");
    expect(formatStepTime("")).toBe("");
    // 语义非法（13 月 / 25 时）正则可过但 Invalid Date → 仍回退原串
    expect(formatStepTime("2026-13-45T25:99:99+00:00")).toBe(
      "2026-13-45T25:99:99+00:00",
    );
  });
});

// ── 阶段筛选联动（ql-20260821-017）──────────────────────────────────────────

describe("ChangeStepTimeline focusStage 筛选", () => {
  const mixed: StepTimelineEntry[] = [
    entry({ name: "a1", stage: "brainstorm", status: "completed", ordering: 1, completed_at: "2026-08-15T15:44:08+00:00" }),
    entry({ name: "b1", stage: "plan", status: "completed", ordering: 1 }),
    entry({ name: "b2", stage: "plan", status: "in-progress", ordering: 2 }),
  ];

  it("focusStage=null/缺省 → 全部组渲染（默认行为回归）", () => {
    const { container, rerender } = render(<ChangeStepTimeline steps={mixed} />);
    expect(container.querySelectorAll("[data-stage]")).toHaveLength(2);
    rerender(<ChangeStepTimeline steps={mixed} focusStage={null} />);
    expect(container.querySelectorAll("[data-stage]")).toHaveLength(2);
  });

  it("focusStage=plan → 仅渲染 plan 组，brainstorm 组隐藏", () => {
    const { container } = render(
      <ChangeStepTimeline steps={mixed} focusStage="plan" />,
    );
    const stages = Array.from(
      container.querySelectorAll("[data-stage]"),
    ).map((n) => n.getAttribute("data-stage"));
    expect(stages).toEqual(["plan"]);
    // plan 组内两条目都在，组外条目不在
    expect(container.querySelectorAll("[data-key]")).toHaveLength(2);
    expect(screen.getByText("b2")).toBeInTheDocument();
    expect(screen.queryByText("a1")).not.toBeInTheDocument();
  });

  it("focusStage 命中空（异常防御）→ 弱提示行不抛错", () => {
    const { container } = render(
      <ChangeStepTimeline steps={mixed} focusStage="verify" />,
    );
    expect(container.querySelector("[data-stage]")).toBeNull();
    expect(screen.getByText("该阶段暂无步骤记录。")).toBeInTheDocument();
  });
});
