// task-07（2026-09-09-askuser-pi-cursor / FR-03 / D-003@v2）：marker 型提问卡
// 组件 + turn-timeline 双路径接入测试。
//
// 覆盖：
//   1. 组件开放态渲染（原型场景三：提问徽标 / 引擎副行 / 问题 / 选项 / 提交并发送）；
//   2. 提交组装（design §Wave B.4）：select→所选 label、allowCustom 自定义输入
//      优先、confirm 无 options 合成 是/否、input 纯输入、editor 多行输入；
//   3. 已答态：prop answered 关闭态（无提交入口）+ 本地提交后转已答并回显答案；
//   4. recommendResponders 推荐 @条渲染（原型场景二样式语义）；
//   5. turn-timeline 接入：旧路径 output 气泡与 v2 SegmentedTurnBody 对话视图
//      text 段命中 → 卡原位渲染、正文换 textBefore、标记原文不可见；纯标记段
//      无正文气泡；
//   6. 解析 null（普通文本 / 非法 JSON）→ 零变化不渲染卡（降级不炸）；
//   7. 已答 best-effort：marker 轮之后存在用户消息 → 关闭态；提交经 onResend
//      发送链路（答案作下一条用户消息）。
//
// mock 口径：MarkdownText（next/dynamic ssr:false 在 jsdom 同步渲染为 null），
// 照抄 turn-timeline 系列既有测试。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AskUserMarkerCard } from "@/components/ask-user-marker-card";
import { TurnTimeline } from "@/components/daemon/turn-timeline";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import type { TurnSegment } from "@/components/daemon/session-log-assembler";
import type { AskUserMarkerPayload } from "@/lib/askuser-marker";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

afterEach(() => {
  cleanup();
});

/* ---------- 组件级 ---------- */

function payloadOf(
  overrides: Partial<AskUserMarkerPayload> = {},
): AskUserMarkerPayload {
  return {
    kind: "select",
    question: "重构范围选哪个？",
    options: [{ label: "全量重构" }, { label: "只拆文件" }],
    ...overrides,
  };
}

describe("AskUserMarkerCard 组件（task-07 / FR-03）", () => {
  it("开放态渲染：提问徽标 + 引擎副行 + 问题 + 选项 + 提交按钮（未作答禁用）", () => {
    render(
      <AskUserMarkerCard payload={payloadOf()} answered={false} onSubmit={vi.fn()} />,
    );
    expect(screen.getByText("提问")).toBeInTheDocument();
    expect(
      screen.getByText(/cursor · 本轮结束，你的回答将作为下一条消息自动发送/),
    ).toBeInTheDocument();
    expect(screen.getByText("重构范围选哪个？")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "全量重构" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "只拆文件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交并发送" })).toBeDisabled();
  });

  it("select 提交：所选 label 经 onSubmit 发出，卡片转已答态并回显答案", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserMarkerCard payload={payloadOf()} answered={false} onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "全量重构" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并发送" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("全量重构");
    expect(screen.getByText("提问 · 已回答")).toBeInTheDocument();
    expect(
      screen.getByText(/回答「全量重构」已作为下一条消息发送/),
    ).toBeInTheDocument();
    // 已提交：提交入口移除，不再重复作答
    expect(
      screen.queryByRole("button", { name: "提交并发送" }),
    ).not.toBeInTheDocument();
  });

  it("select allowCustom：自定义输入优先于选项选择（自定义时用输入文本）", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserMarkerCard
        payload={payloadOf({ allowCustom: true })}
        answered={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "只拆文件" }));
    fireEvent.change(screen.getByPlaceholderText(/或输入自定义回答/), {
      target: { value: " 先只拆 utils/bar " },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交并发送" }));
    // trim 后作答（下一条用户消息不带首尾空白）
    expect(onSubmit).toHaveBeenCalledWith("先只拆 utils/bar");
  });

  it("confirm 无 options：合成 是/否 两选项，点「否」提交", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserMarkerCard
        payload={payloadOf({
          kind: "confirm",
          options: undefined,
          question: "是否继续执行？",
        })}
        answered={false}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole("radio", { name: "是" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "否" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "否" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并发送" }));
    expect(onSubmit).toHaveBeenCalledWith("否");
  });

  it("input：仅文本输入无选项列表，输入后提交", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserMarkerCard
        payload={payloadOf({
          kind: "input",
          options: undefined,
          question: "当前线上版本号？",
        })}
        answered={false}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("输入你的回答"), {
      target: { value: "v1.3.0-rc2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交并发送" }));
    expect(onSubmit).toHaveBeenCalledWith("v1.3.0-rc2");
  });

  it("editor：多行 textarea 输入，多行文本原样提交", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserMarkerCard
        payload={payloadOf({
          kind: "editor",
          options: undefined,
          question: "写下迁移步骤",
        })}
        answered={false}
        onSubmit={onSubmit}
      />,
    );
    const ta = screen.getByPlaceholderText(/支持多行/) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "第一步：备份\n第二步：切换" } });
    fireEvent.click(screen.getByRole("button", { name: "提交并发送" }));
    expect(onSubmit).toHaveBeenCalledWith("第一步：备份\n第二步：切换");
  });

  it("已答态（prop answered）：关闭态展示，无交互入口", () => {
    render(
      <AskUserMarkerCard payload={payloadOf()} answered={true} onSubmit={vi.fn()} />,
    );
    expect(screen.getByText("提问 · 已回答")).toBeInTheDocument();
    expect(screen.getByText("重构范围选哪个？")).toBeInTheDocument();
    expect(screen.getByText(/已收到新的回答消息，本题已关闭/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "提交并发送" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("recommendResponders：渲染推荐 @条（原型场景二样式语义，软提示）", () => {
    render(
      <AskUserMarkerCard
        payload={payloadOf({ recommendResponders: ["张三", "李四"] })}
        answered={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/agent 推荐/)).toBeInTheDocument();
    expect(screen.getByText("@张三")).toBeInTheDocument();
    expect(screen.getByText("@李四")).toBeInTheDocument();
  });

  it("engineLabel 覆盖副行前缀（群聊等场景复用预留）", () => {
    render(
      <AskUserMarkerCard
        payload={payloadOf()}
        answered={false}
        onSubmit={vi.fn()}
        engineLabel="Cursor 成员"
      />,
    );
    expect(
      screen.getByText(/Cursor 成员 · 本轮结束，你的回答将作为下一条消息自动发送/),
    ).toBeInTheDocument();
  });
});

/* ---------- turn-timeline 接入级（双路径） ---------- */

/** 尾部带合法 askuser 标记的 output（流式与持久化历史同一形态）。 */
const MARKER_OUTPUT = [
  "utils 下 3 个模块耦合较深，需要先确认重构范围。",
  "```askuser",
  '{"kind":"select","question":"重构范围选哪个？","options":[{"label":"全量重构"},{"label":"只拆文件"}]}',
  "```",
].join("\n");

function makeTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "帮我重构 utils 目录",
    output: "",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ...overrides,
  };
}

function renderProps(
  turns: SessionTurnView[],
  overrides: Record<string, unknown> = {},
) {
  return {
    turns,
    viewMode: "conversation" as const,
    errorMsg: null,
    sessionStatus: "active" as const,
    pendingRequests: [],
    dialogHistory: [],
    onDialogResolved: vi.fn(),
    onResend: vi.fn(),
    onSwitchProvider: vi.fn(),
    hasOnlineProvider: true,
    emptyProviderLabel: "Cursor",
    ...overrides,
  };
}

describe("turn-timeline askuser 标记接入（task-07 双路径 / FR-03）", () => {
  it("旧路径：output 尾块命中 → 卡原位渲染、正文换 textBefore、标记原文不可见", () => {
    render(
      <TurnTimeline
        {...renderProps([makeTurn({ segments: undefined, output: MARKER_OUTPUT })])}
      />,
    );
    expect(screen.getByTestId("ask-user-marker-card")).toBeInTheDocument();
    expect(screen.getByText("重构范围选哪个？")).toBeInTheDocument();
    // textBefore 作为正文渲染
    expect(
      screen.getByText(/utils 下 3 个模块耦合较深/),
    ).toBeInTheDocument();
    // 标记原文（围栏 + JSON）不可见
    expect(screen.queryByText(/```askuser/)).toBeNull();
    expect(screen.queryByText(/"kind":"select"/)).toBeNull();
  });

  it("旧路径：纯标记 output（textBefore 空）→ 不渲染正文气泡，仅提问卡", () => {
    const markerOnly =
      '```askuser\n{"kind":"confirm","question":"继续吗？"}\n```';
    render(
      <TurnTimeline
        {...renderProps([makeTurn({ segments: undefined, output: markerOnly })])}
      />,
    );
    expect(screen.getByTestId("ask-user-marker-card")).toBeInTheDocument();
    expect(screen.getByText("继续吗？")).toBeInTheDocument();
    // confirm 无 options 合成 是/否
    expect(screen.getByRole("radio", { name: "是" })).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-text")).toBeNull();
  });

  it("v2 路径：对话视图 text 段尾块命中 → 正文换 textBefore + 卡原位渲染", () => {
    const segments: TurnSegment[] = [
      {
        kind: "text",
        id: "text:main:m1:1",
        text: MARKER_OUTPUT,
        streaming: false,
        startedAt: 1_000,
      },
    ];
    render(
      <TurnTimeline {...renderProps([makeTurn({ segments, output: MARKER_OUTPUT })])} />,
    );
    expect(screen.getByTestId("ask-user-marker-card")).toBeInTheDocument();
    expect(screen.getByText("重构范围选哪个？")).toBeInTheDocument();
    expect(screen.getByText(/utils 下 3 个模块耦合较深/)).toBeInTheDocument();
    expect(screen.queryByText(/```askuser/)).toBeNull();
  });

  it("v2 路径：纯标记段（textBefore 空）→ 无正文气泡仅卡；file 段不受影响", () => {
    const segments: TurnSegment[] = [
      {
        kind: "text",
        id: "text:main:m1:1",
        text: '```askuser\n{"kind":"input","question":"线上版本号？"}\n```',
        streaming: false,
        startedAt: null,
      },
      {
        kind: "file",
        id: "file:main:f1",
        fileId: "f-uuid-9",
        name: "report.csv",
        size: 1024,
        mime: "text/csv",
        description: "",
        ts: 1_787_400_000_000,
      },
    ];
    render(<TurnTimeline {...renderProps([makeTurn({ segments })])} />);
    expect(screen.getByTestId("ask-user-marker-card")).toBeInTheDocument();
    // input 形态：只有文本输入，无选项
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByPlaceholderText("输入你的回答")).toBeInTheDocument();
    // 纯标记段无正文气泡
    expect(screen.queryByTestId("markdown-text")).toBeNull();
    // file 段照常渲染
    expect(screen.getByText("agent 上传了文件")).toBeInTheDocument();
  });

  it("解析 null：普通文本与非法 JSON 标记 → 零变化不渲染卡（降级不炸）", () => {
    const { unmount } = render(
      <TurnTimeline
        {...renderProps([makeTurn({ segments: undefined, output: "普通答复正文" })])}
      />,
    );
    expect(screen.queryByTestId("ask-user-marker-card")).toBeNull();
    expect(screen.getByText("普通答复正文")).toBeInTheDocument();
    unmount();

    // 非法 JSON 标记 → 当普通文本整段渲染
    const bad = "答复正文\n```askuser\n{kind:select}\n```";
    render(
      <TurnTimeline
        {...renderProps([makeTurn({ segments: undefined, output: bad })])}
      />,
    );
    expect(screen.queryByTestId("ask-user-marker-card")).toBeNull();
    const md = screen.getByTestId("markdown-text");
    expect(md.textContent).toContain("{kind:select}");
  });

  it("已答 best-effort：marker 轮之后存在用户消息 → 卡呈已答关闭态", () => {
    render(
      <TurnTimeline
        {...renderProps([
          makeTurn({ runId: "r1", segments: undefined, output: MARKER_OUTPUT }),
          makeTurn({
            runId: "r2",
            turn: 2,
            prompt: "全量重构",
            output: "收到，开始全量重构…",
          }),
        ])}
      />,
    );
    expect(screen.getByTestId("ask-user-marker-card")).toBeInTheDocument();
    expect(screen.getByText("提问 · 已回答")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "提交并发送" }),
    ).not.toBeInTheDocument();
  });

  it("已答 best-effort：marker 为最后一轮（无后续用户消息）→ 开放态", () => {
    render(
      <TurnTimeline
        {...renderProps([makeTurn({ segments: undefined, output: MARKER_OUTPUT })])}
      />,
    );
    expect(
      screen.getByRole("button", { name: "提交并发送" }),
    ).toBeInTheDocument();
  });

  it("提交经既有 onResend 发送链路：答案作下一条用户消息", () => {
    const onResend = vi.fn();
    render(
      <TurnTimeline
        {...renderProps(
          [makeTurn({ segments: undefined, output: MARKER_OUTPUT })],
          { onResend },
        )}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "只拆文件" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并发送" }));
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(onResend).toHaveBeenCalledWith("只拆文件");
  });

  it("v2 路径提交同样经 onResend（段路径接线）", () => {
    const onResend = vi.fn();
    const segments: TurnSegment[] = [
      {
        kind: "text",
        id: "text:main:m1:1",
        text: MARKER_OUTPUT,
        streaming: false,
        startedAt: null,
      },
    ];
    render(
      <TurnTimeline
        {...renderProps([makeTurn({ segments })], { onResend })}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "全量重构" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并发送" }));
    expect(onResend).toHaveBeenCalledWith("全量重构");
  });
});
