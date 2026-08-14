// task-10（2026-08-14-change-center-conversation-driven / D-003@v1 / D-006@v2）：
// ChangeStageActions 已从「执行控制操作区」退化为「审批卡」——删推进/重新派发/
// 验证门禁/选档案/团队配置（含 quick 分支），改为意见输入 + 绑定会话只读展示 +
// 「通过/打回并通知绑定会话」单端点调用 + 三类降级提示。
//
// 覆盖（design §5 P5 + plan.md 前置钉死映射表 + R-03 降级语义）：
//   - 各 pending_review 阶段渲染通过/打回按钮，action 映射钉死（archive_confirm 无打回）
//   - 意见输入 textarea 调 onGateCommentChange
//   - 绑定会话只读展示（含空态）
//   - quick 阶段只读说明（无执行控制）
//   - 无待审阶段占位说明（无执行控制）
//   - 三类降级提示（turn_conflict / session_inactive / 其它）+ 文案可复制
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeStageActions } from "@/components/changes/detail/change-stage-actions";
import type { ChangeRead } from "@/lib/changes";
import type { AgentSessionListItem } from "@/lib/daemon";

function makeChange(over: Partial<ChangeRead>): ChangeRead {
  return {
    id: "ch-1",
    change_key: "2026-08-14-test-change",
    title: "测试变更",
    current_stage: "brainstorm",
    pending_review: "proposal_review",
    stages: {},
    affected_components: [],
    change_type: null,
    location: "active",
    updated_at: "2026-08-14T10:00:00Z",
    ...over,
  } as unknown as ChangeRead;
}

function makeProps(over: Record<string, unknown> = {}) {
  return {
    change: makeChange({}),
    boundSession: null,
    gateComment: "",
    onGateCommentChange: vi.fn(),
    onGateAction: vi.fn(),
    transitioning: false,
    notifyResult: null,
    ...over,
  };
}

function makeSession(over: Partial<AgentSessionListItem> = {}): AgentSessionListItem {
  return {
    id: "sess-12345678",
    provider: "claude",
    status: "active",
    turn_count: 3,
    author: { user_id: "u1", display_name: "小明" },
    last_active_at: "2026-08-14T09:00:00Z",
    title: "帮我推进一下这个变更",
    ...over,
  };
}

describe("ChangeStageActions 审批卡（task-10）", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("proposal_review：渲染通过/打回按钮，action 映射钉死 proposal_approve / proposal_revise", () => {
    const props = makeProps();
    render(<ChangeStageActions {...props} />);
    expect(screen.getByText("四件套已生成，请确认")).toBeInTheDocument();
    fireEvent.click(screen.getByText("通过并通知绑定会话"));
    expect(props.onGateAction).toHaveBeenCalledWith("proposal_approve");
    fireEvent.click(screen.getByText("打回并通知绑定会话"));
    expect(props.onGateAction).toHaveBeenCalledWith("proposal_revise");
  });

  it("plan_review：映射钉死 plan_approve / plan_replan", () => {
    const props = makeProps({
      change: makeChange({ current_stage: "plan", pending_review: "plan_review" }),
    });
    render(<ChangeStageActions {...props} />);
    fireEvent.click(screen.getByText("通过并通知绑定会话"));
    expect(props.onGateAction).toHaveBeenCalledWith("plan_approve");
    fireEvent.click(screen.getByText("打回并通知绑定会话"));
    expect(props.onGateAction).toHaveBeenCalledWith("plan_replan");
  });

  it("human_test：映射钉死 test_pass / test_bug", () => {
    const props = makeProps({
      change: makeChange({ current_stage: "verify", pending_review: "human_test" }),
    });
    render(<ChangeStageActions {...props} />);
    fireEvent.click(screen.getByText("通过并通知绑定会话"));
    expect(props.onGateAction).toHaveBeenCalledWith("test_pass");
    fireEvent.click(screen.getByText("打回并通知绑定会话"));
    expect(props.onGateAction).toHaveBeenCalledWith("test_bug");
  });

  it("archive_confirm：仅归档按钮（无打回），action=archive_confirm", () => {
    const props = makeProps({
      change: makeChange({ current_stage: "verify", pending_review: "archive_confirm" }),
    });
    render(<ChangeStageActions {...props} />);
    expect(screen.getByText("归档并通知绑定会话")).toBeInTheDocument();
    expect(screen.queryByText("打回并通知绑定会话")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("归档并通知绑定会话"));
    expect(props.onGateAction).toHaveBeenCalledWith("archive_confirm");
  });

  it("意见输入 textarea 调 onGateCommentChange", () => {
    const props = makeProps();
    render(<ChangeStageActions {...props} />);
    fireEvent.change(screen.getByPlaceholderText("审核意见（可选）"), {
      target: { value: "同意" },
    });
    expect(props.onGateCommentChange).toHaveBeenCalledWith("同意");
  });

  it("transitioning 时按钮禁用", () => {
    const props = makeProps({ transitioning: true });
    render(<ChangeStageActions {...props} />);
    expect(screen.getByText("通过并通知绑定会话")).toBeDisabled();
    expect(screen.getByText("打回并通知绑定会话")).toBeDisabled();
  });

  it("绑定会话只读展示：标题 + provider + 状态 + 最近活跃（locale zh-CN）", () => {
    const props = makeProps({ boundSession: makeSession() });
    render(<ChangeStageActions {...props} />);
    expect(screen.getByText(/帮我推进一下这个变更/)).toBeInTheDocument();
    expect(screen.getByText(/claude · 进行中/)).toBeInTheDocument();
    expect(screen.getByText(/最近活跃/)).toBeInTheDocument();
  });

  it("无绑定会话 → 空态文案「暂无可通知的绑定会话」", () => {
    const props = makeProps({ boundSession: null });
    render(<ChangeStageActions {...props} />);
    expect(
      screen.getByText("暂无可通知的绑定会话，审批结果仅落库展示"),
    ).toBeInTheDocument();
  });

  it("quick 阶段：只读说明，无任何执行控制按钮（含推进/触发/门禁）", () => {
    const props = makeProps({
      change: makeChange({ current_stage: "quick", pending_review: null }),
    });
    render(<ChangeStageActions {...props} />);
    expect(screen.getByText(/快速修复由智能体在会话中执行/)).toBeInTheDocument();
    expect(screen.queryByText(/通过并通知绑定会话/)).not.toBeInTheDocument();
    expect(screen.queryByText(/触发/)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("无待审阶段：占位说明，无执行控制按钮", () => {
    const props = makeProps({
      change: makeChange({ current_stage: "execute", pending_review: null }),
    });
    render(<ChangeStageActions {...props} />);
    expect(
      screen.getByText(/当前无可审批事项，阶段推进由智能体在会话中驱动/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/触发智能体/)).not.toBeInTheDocument();
    expect(screen.queryByText(/推进到/)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  // ── 三类降级提示（R-03：审批已落库，注入失败不回滚） ───────────────

  it("turn_conflict 降级：提示 agent 忙 + 文案可复制", async () => {
    const props = makeProps({
      notifyResult: { notified_session: false, notify_error: "turn_conflict" },
    });
    render(<ChangeStageActions {...props} />);
    expect(
      screen.getByText("审批已生效，agent 忙，请稍后在会话中告知继续"),
    ).toBeInTheDocument();
    const copyable = screen.getByText(/变更 2026-08-14-test-change 的审批已生效，请继续推进/);
    expect(copyable).toBeInTheDocument();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    fireEvent.click(screen.getByText("复制文案"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      "变更 2026-08-14-test-change 的审批已生效，请继续推进。",
    ));
  });

  it("session_inactive 降级：提示去会话页开启 + 文案可复制", () => {
    const props = makeProps({
      notifyResult: { notified_session: false, notify_error: "session_inactive" },
    });
    render(<ChangeStageActions {...props} />);
    expect(
      screen.getByText("绑定会话已结束，审批已生效，请去会话页开启新会话"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/变更 2026-08-14-test-change 的审批已生效，请开启新会话后继续推进/),
    ).toBeInTheDocument();
  });

  it("其它注入异常：通用提示 + 说明审批记录不受影响", () => {
    const props = makeProps({
      notifyResult: { notified_session: false, notify_error: "inject_failed" },
    });
    render(<ChangeStageActions {...props} />);
    expect(
      screen.getByText("审批已生效，但通知绑定会话失败（审批记录与状态不受影响）"),
    ).toBeInTheDocument();
  });

  it("注入成功：不显示降级提示", () => {
    const props = makeProps({
      notifyResult: { notified_session: true, notify_error: null },
    });
    render(<ChangeStageActions {...props} />);
    expect(screen.queryByTestId("approval-notify-degrade")).not.toBeInTheDocument();
  });
});
