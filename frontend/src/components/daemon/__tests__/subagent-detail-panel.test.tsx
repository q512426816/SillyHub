/**
 * task-03（2026-09-15-subagent-three-pane-display / FR-03 / FR-05 / design §5.E）：
 * 右栏子代理详情面板 SubagentDetailPanel 单测。
 *
 * 覆盖（任务卡 implementation 逐条）：
 *   1. 头部渲染——✕（data-testid=subagent-panel-close，点击 → onClose）+
 *      名称 / subagentType 标签 / 时长（subagentHeaderOf 共享派生）；
 *   2. children 经 SegmentView 渲染（文本气泡 / 工具行可见，与主会话进度视图同构）；
 *   3. 无任何输入框（textbox / textarea / placeholder 断言不存在，FR-03 底线）；
 *   4. 嵌套子代理 child（tool 带 children）经 SubagentBlockView 紧凑卡片渲染，
 *      点击触发 context openSubagent(嵌套段 id)（SubagentPanelContext.Provider
 *      注入 spy 值——页面级 Provider 生效路径的组件级等价锁）；
 *   5. 组件契约——段由父级实时解析传入活引用：rerender 更新 segment（模拟 SSE
 *      追加 child）即重渲新内容；段失效（null）不在本组件处理（由 page 层
 *      effect 自动关闭，design §5.E），此处只锁非 null 契约下的实时性；
 *   6. subagentHeaderOf 纯函数——名称回退链（primary 优先 / subagentType /
 *      stub 回退）、taskElapsedMs 终态时长、running 走秒锚点缺失回退。
 *
 * 测试纪律对齐 turn-segment-views.test.tsx：仅按既有惯例 mock MarkdownText
 * （next/dynamic ssr:false 在 jsdom 同步渲染为 null）与 FileMessageCard（卡片
 * 本体另有专项测试）；antd Button 为真实渲染（session-panel 系测试同款）。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SubagentDetailPanel } from "../subagent-detail-panel";
import { subagentHeaderOf } from "../turn-segment-views";
import { SubagentPanelContext } from "../subagent-panel-context";
import type { SubagentPanelContextValue } from "../subagent-panel-context";
import type {
  SubagentContainerSegment,
  TextTurnSegment,
} from "../turn-segment-views";
import type {
  StubTurnSegment,
  ToolTurnSegment,
} from "../session-log-assembler";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

vi.mock("@/components/daemon/file-message-card", () => ({
  FileMessageCard: (props: Record<string, unknown>) => (
    <div data-testid="file-message-card" data-file-id={String(props.fileId)} />
  ),
}));

/* ───────── fixture 构造器（每用例独立） ───────── */

function makeTextSeg(overrides: Partial<TextTurnSegment> = {}): TextTurnSegment {
  return {
    kind: "text",
    id: "text:p1",
    text: "子代理产出正文",
    streaming: false,
    startedAt: 1_000,
    ...overrides,
  };
}

function makeBashSeg(overrides: Partial<ToolTurnSegment> = {}): ToolTurnSegment {
  return {
    kind: "tool",
    id: "call_b",
    raw: JSON.stringify({
      tool: "Bash",
      args: { command: "npm test" },
      tool_use_id: "call_b",
      success: true,
    }),
    result: "全部通过",
    status: "ok",
    toolName: "Bash",
    primary: "npm test",
    startedAt: 2_000,
    endedAt: 3_500,
    children: [],
    subagentType: null,
    ...overrides,
  };
}

function makeContainerSeg(
  overrides: Partial<ToolTurnSegment> = {},
): ToolTurnSegment {
  return {
    kind: "tool",
    id: "call_agent",
    raw: JSON.stringify({
      tool: "Agent",
      args: { description: "调研员" },
      tool_use_id: "call_agent",
      success: true,
    }),
    result: "调研结论",
    status: "ok",
    toolName: "Agent",
    primary: "调研员",
    startedAt: 60_000,
    endedAt: 144_000, // 84s → 01:24
    children: [makeTextSeg()],
    subagentType: "research",
    ...overrides,
  };
}

function makeStubSeg(overrides: Partial<StubTurnSegment> = {}): StubTurnSegment {
  return {
    kind: "subagent_stub",
    id: "call_stub",
    subagentType: "Explore",
    children: [],
    ...overrides,
  };
}

/** 挂 SubagentPanelContext.Provider 渲染面板（嵌套紧凑卡片点击路径用例）。 */
function renderWithPanelContext(
  segment: SubagentContainerSegment,
  value: Partial<SubagentPanelContextValue> = {},
) {
  const ctx: SubagentPanelContextValue = {
    openSubagent: vi.fn(),
    closeSubagent: vi.fn(),
    activeId: null,
    ...value,
  };
  const utils = render(
    <SubagentPanelContext.Provider value={ctx}>
      <SubagentDetailPanel segment={segment} onClose={vi.fn()} />
    </SubagentPanelContext.Provider>,
  );
  return { ...utils, ctx };
}

/* ───────── 1-3. 面板渲染 / 关闭 / 无输入框 ───────── */

describe("SubagentDetailPanel 渲染契约（task-03 / FR-03）", () => {
  it("头部渲染 ✕ / 名称 / 类型标签 / 时长，点击 ✕ 上抛 onClose", () => {
    const onClose = vi.fn();
    render(<SubagentDetailPanel segment={makeContainerSeg()} onClose={onClose} />);
    expect(screen.getByTestId("subagent-panel-close")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭子代理面板" })).toBeInTheDocument();
    expect(screen.getByText("调研员")).toBeInTheDocument(); // 名称（primary 优先）
    expect(screen.getByText("research")).toBeInTheDocument(); // subagentType 标签
    expect(screen.getByText("01:24")).toBeInTheDocument(); // 终态时长（起止差 mm:ss）
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("subagent-panel-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("children 经 SegmentView 渲染：文本气泡与工具行均可见（与主会话进度视图同构）", () => {
    render(
      <SubagentDetailPanel
        segment={makeContainerSeg({
          children: [makeTextSeg({ id: "text:body", text: "面板正文产出" }), makeBashSeg()],
        })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("markdown-text").textContent).toBe("面板正文产出");
    expect(screen.getByText("Bash")).toBeInTheDocument(); // 工具行工具名
    expect(screen.getByText("npm test")).toBeInTheDocument(); // 工具行主参数
  });

  it("无任何输入框 / 发送控件（FR-03 底线）", () => {
    const { container } = render(
      <SubagentDetailPanel segment={makeContainerSeg()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(screen.queryByPlaceholderText(/发送|输入|继续对话/)).toBeNull();
  });

  it("任务指令块：args.prompt 全文渲染在正文首块（2026-09-15 验收返工——初始化提示词可见）", () => {
    render(
      <SubagentDetailPanel
        segment={makeContainerSeg({
          raw: JSON.stringify({
            tool: "Task",
            args: {
              description: "调研员",
              prompt: "请调研导出乱码根因，输出修复建议\n注意覆盖 Windows 码页场景",
            },
          }),
        })}
        onClose={vi.fn()}
      />,
    );
    const block = screen.getByTestId("subagent-dispatch-prompt");
    expect(block).toBeInTheDocument();
    expect(screen.getByText("📋 任务指令（初始化提示词）")).toBeInTheDocument();
    // 全文含换行内容均可见（whitespace-pre-wrap 保留原始换行）。
    expect(
      screen.getByText(/请调研导出乱码根因，输出修复建议\s*注意覆盖 Windows 码页场景/),
    ).toBeInTheDocument();
  });

  it("无 args.prompt（仅 description）不渲染任务指令块；stub 段同不渲染", () => {
    const { rerender } = render(
      <SubagentDetailPanel segment={makeContainerSeg()} onClose={vi.fn()} />,
    );
    // 默认 fixture 只有 description——名称摘要归头部，正文不出指令块。
    expect(screen.queryByTestId("subagent-dispatch-prompt")).toBeNull();
    rerender(
      <SubagentDetailPanel
        segment={makeStubSeg({ children: [makeTextSeg()] })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("subagent-dispatch-prompt")).toBeNull();
    expect(screen.getByTestId("markdown-text")).toBeInTheDocument(); // stub 正文仍渲染
  });
});

/* ───────── 4. 嵌套子代理紧凑卡片 + context 联动 ───────── */

describe("SubagentDetailPanel 嵌套子代理（design §5.E 单槽位切换）", () => {
  it("嵌套 tool-with-children child 渲染为紧凑卡片（不内联展开），点击上抛 context openSubagent(嵌套段 id)", () => {
    const nested = makeContainerSeg({
      id: "call_nested",
      primary: "嵌套调研员",
      children: [makeTextSeg({ id: "text:nested", text: "嵌套内部文本" })],
    });
    const { ctx, container } = renderWithPanelContext(
      makeContainerSeg({ children: [nested] }),
    );
    // 紧凑卡片：嵌套块头可见、内部 children 不内联渲染（.seg-subagent-body 不存在）
    expect(screen.getByText("嵌套调研员")).toBeInTheDocument();
    expect(screen.queryByText("嵌套内部文本")).not.toBeInTheDocument();
    expect(container.querySelector(".seg-subagent-body")).toBeNull();
    // 点击嵌套卡片头部 → openSubagent(嵌套段 id)（父级切右栏内容，单槽位语义）
    fireEvent.click(screen.getByText("嵌套调研员"));
    expect(ctx.openSubagent).toHaveBeenCalledTimes(1);
    expect(ctx.openSubagent).toHaveBeenCalledWith("call_nested");
  });
});

/* ───────── 5. 活引用契约（段失效归 page 层，不在此测） ───────── */

describe("SubagentDetailPanel 活引用契约（段由父级实时解析传入）", () => {
  it("rerender 传入更新后的段（模拟 SSE 追加 child）即渲染新内容——非快照", () => {
    const base = makeContainerSeg({ children: [makeTextSeg({ text: "首批产出" })] });
    const { rerender } = render(<SubagentDetailPanel segment={base} onClose={vi.fn()} />);
    expect(screen.getByTestId("markdown-text").textContent).toBe("首批产出");
    const grown = makeContainerSeg({
      ...base,
      children: [
        makeTextSeg({ id: "text:g1", text: "首批产出" }),
        makeTextSeg({ id: "text:g2", text: "流式追加产出" }),
      ],
    });
    rerender(<SubagentDetailPanel segment={grown} onClose={vi.fn()} />);
    expect(screen.getByText("流式追加产出")).toBeInTheDocument();
  });
});

/* ───────── 6. subagentHeaderOf 纯函数（共享头部派生） ───────── */

describe("subagentHeaderOf 纯函数（task-03 / design §5.E 共享派生）", () => {
  it("名称回退链：tool 段 primary 优先 → subagentType → 「子代理」；stub 段无 primary 走 subagentType", () => {
    expect(subagentHeaderOf(makeContainerSeg(), 0).name).toBe("调研员"); // primary 优先
    expect(
      subagentHeaderOf(makeContainerSeg({ primary: "  ", subagentType: "research" }), 0).name,
    ).toBe("research"); // primary 空白 → subagentType
    expect(subagentHeaderOf(makeContainerSeg({ primary: "  ", subagentType: null }), 0).name).toBe(
      "子代理",
    ); // 双缺兜底
    expect(subagentHeaderOf(makeStubSeg(), 0).name).toBe("Explore"); // stub：subagentType
    expect(subagentHeaderOf(makeStubSeg({ subagentType: null }), 0).name).toBe("子代理");
  });

  it("元数据终态时长 = 服务端权威 taskElapsedMs（不随 now 变）+ 徽标映射", () => {
    const done = makeContainerSeg({
      taskStatus: "completed",
      taskAsync: true,
      taskElapsedMs: 84_000,
      startedAt: 0,
      endedAt: 500, // 迷惑项：回执差值 00:00
    });
    const h = subagentHeaderOf(done, 999_999);
    expect(h.durationText).toBe("01:24");
    expect(h.metaStatus).toBe("completed");
    expect(h.badge).toEqual({ label: "已完成", cls: "bg-emerald-600/15 text-emerald-600" });
    expect(h.running).toBe(false);
  });

  it("元数据运行中走秒 = now - startedAt；锚点缺失回退最近 taskElapsedMs 校准值，再缺不显示", () => {
    const anchored = makeContainerSeg({
      taskStatus: "running",
      taskAsync: true,
      startedAt: 10_000,
      endedAt: null,
    });
    expect(subagentHeaderOf(anchored, 94_000).durationText).toBe("01:24"); // 84s
    const noAnchor = makeContainerSeg({
      taskStatus: "running",
      taskAsync: true,
      taskElapsedMs: 8_000,
      startedAt: null,
      endedAt: null,
    });
    expect(subagentHeaderOf(noAnchor, 999_999).durationText).toBe("00:08"); // 校准兜底
    const nothing = makeContainerSeg({
      taskStatus: "running",
      taskAsync: true,
      startedAt: null,
      endedAt: null,
    });
    expect(subagentHeaderOf(nothing, 999_999).durationText).toBeNull(); // 不编造
  });

  it("无元数据段：运行中「运行中」（不读时钟）、终态起止差 mm:ss、无徽标；stub 恒 running", () => {
    expect(
      subagentHeaderOf(makeContainerSeg({ status: "running", endedAt: null }), Date.now())
        .durationText,
    ).toBe("运行中");
    expect(subagentHeaderOf(makeContainerSeg(), 0).durationText).toBe("01:24"); // 144s-60s
    const plain = subagentHeaderOf(makeContainerSeg(), 0);
    expect(plain.metaStatus).toBeNull();
    expect(plain.badge).toBeNull();
    expect(plain.status).toBe("ok");
    const stub = subagentHeaderOf(makeStubSeg(), 0);
    expect(stub.running).toBe(true); // stub 恒 running（子消息仍流入）
    expect(stub.durationText).toBe("运行中");
    expect(stub.dotCls).toContain("animate-pulse");
  });
});
