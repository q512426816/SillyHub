/**
 * MessageQueueBar 单测（2026-08-21-session-message-queue task-09）。
 *
 * 依据：
 *   - changes/2026-08-21-session-message-queue/design.md §3.2（chips 栏行为：
 *     摘要 40 字截断 / 展开看全文 / 空队列 null）、D-002（满员 Tag「队列已满
 *     （N/max）」）、D-003（failed 重试+删除按钮，重试仅用户触发）、
 *     D-004（附件数展示）；
 *   - tasks/task-09.md acceptance：空队列 / pending / failed / sending 渲染 /
 *     按钮回调传正确 id / 满员 / 多条目；
 *   - .sillyspec/docs/frontend/scan/CONVENTIONS.md 代码风格第 7 条
 *     （Vitest jsdom + @testing-library/react，测试标题中文）。
 *
 * 说明：状态文案「等待中/发送中/发送失败」渲染在条目切换按钮的 aria-label
 * （非可见正文），按可访问名（getByRole name）断言；行为优先，不断言
 * destructive/brand 等颜色语义类。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { MessageQueueBar } from "@/components/daemon/message-queue-bar";
import type { QueueEntry } from "@/hooks/use-message-queue";

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: "mq-1",
    prompt: "排队消息",
    attachmentIds: [],
    displayPrompt: "排队消息",
    status: "pending",
    createdAt: 1755700000000,
    ...overrides,
  };
}

describe("MessageQueueBar（task-09 / D-002 D-003 D-004）", () => {
  afterEach(() => {
    cleanup();
  });

  it("空队列不渲染任何内容", () => {
    const { container } = render(
      <MessageQueueBar entries={[]} onRemove={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/排队消息（/)).toBeNull();
  });

  it("pending 条目：状态文案「等待中」+ 删除按钮，无重试按钮", () => {
    render(
      <MessageQueueBar
        entries={[makeEntry()]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    // 状态文案在条目按钮的可访问名中（组件实现：aria-label=「等待中，展开…」）
    expect(screen.getByRole("button", { name: /^等待中，/ })).toBeTruthy();
    expect(screen.getByText("排队消息")).toBeTruthy();
    expect(screen.getByText("排队消息（1）")).toBeTruthy();
    expect(screen.getByLabelText("从队列移除该消息")).toBeTruthy();
    expect(screen.queryByLabelText("重试发送该消息")).toBeNull();
  });

  it("failed 条目：重试+删除按钮在位，展开后显示完整失败原因（D-003）", () => {
    render(
      <MessageQueueBar
        entries={[
          makeEntry({
            id: "mq-f",
            prompt: "失败消息",
            status: "failed",
            errorMsg: "inject 500",
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /^发送失败，/ })).toBeTruthy();
    expect(screen.getByLabelText("重试发送该消息")).toBeTruthy();
    expect(screen.getByLabelText("从队列移除该消息")).toBeTruthy();

    // 点击条目展开：errorMsg 完整展示
    fireEvent.click(screen.getByRole("button", { name: /^发送失败，/ }));
    expect(screen.getByText("发送失败：inject 500")).toBeTruthy();
  });

  it("sending 条目：投递中无重试/删除按钮", () => {
    render(
      <MessageQueueBar
        entries={[makeEntry({ status: "sending" })]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /^发送中，/ })).toBeTruthy();
    expect(screen.queryByLabelText("从队列移除该消息")).toBeNull();
    expect(screen.queryByLabelText("重试发送该消息")).toBeNull();
  });

  it("点击删除/重试按钮：回调收到对应条目的正确 id", () => {
    const onRemove = vi.fn();
    const onRetry = vi.fn();
    render(
      <MessageQueueBar
        entries={[
          makeEntry({ id: "mq-a", prompt: "甲消息", status: "failed", errorMsg: "e1" }),
          makeEntry({ id: "mq-b", prompt: "乙消息", status: "failed", errorMsg: "e2" }),
        ]}
        onRemove={onRemove}
        onRetry={onRetry}
      />,
    );

    const retryButtons = screen.getAllByLabelText("重试发送该消息");
    const removeButtons = screen.getAllByLabelText("从队列移除该消息");
    fireEvent.click(retryButtons[0]!);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith("mq-a");

    fireEvent.click(removeButtons[1]!);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("mq-b");
  });

  it("满员提示（D-002）：默认 max=5，5 条时显示「队列已满（5/5）」", () => {
    const five = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ id: `mq-${i}`, prompt: `满员消息${i}` }),
    );
    render(
      <MessageQueueBar entries={five} onRemove={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(screen.getByText("队列已满（5/5）")).toBeTruthy();
  });

  it("满员提示：自定义 max=3 时按「N/3」展示", () => {
    const three = Array.from({ length: 3 }, (_, i) =>
      makeEntry({ id: `mq-${i}`, prompt: `自定义消息${i}` }),
    );
    render(
      <MessageQueueBar
        entries={three}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        max={3}
      />,
    );
    expect(screen.getByText("队列已满（3/3）")).toBeTruthy();
  });

  it("未满时不显示满员提示", () => {
    render(
      <MessageQueueBar
        entries={[makeEntry({ id: "mq-1" }), makeEntry({ id: "mq-2", prompt: "第二条" })]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByText(/队列已满/)).toBeNull();
  });

  it("多条目同时展示：各条摘要与计数标签可见", () => {
    render(
      <MessageQueueBar
        entries={[
          makeEntry({ id: "mq-1", prompt: "第一条" }),
          makeEntry({ id: "mq-2", prompt: "第二条", status: "sending" }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("第一条")).toBeTruthy();
    expect(screen.getByText("第二条")).toBeTruthy();
    expect(screen.getByText("排队消息（2）")).toBeTruthy();
  });

  it("点击条目展开：长文本摘要截断，展开显示完整 displayPrompt（含附件标记行）", () => {
    const head = "前".repeat(40);
    const tailMark = "尾部唯一标记XYZ";
    const longPrompt = `${head}${tailMark}`;
    const { container } = render(
      <MessageQueueBar
        entries={[
          makeEntry({
            id: "mq-long",
            prompt: longPrompt,
            displayPrompt: `${longPrompt}\n📎 2 个附件`,
            attachmentIds: ["a", "b"],
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    // 折叠态：40 字摘要 + 省略号，完整尾部与附件标记行不可见
    expect(container.textContent).toContain("…");
    expect(container.textContent).not.toContain(tailMark);
    expect(container.textContent).not.toContain("📎 2 个附件");

    // 展开：displayPrompt 全文可见（含附件标记行）
    fireEvent.click(screen.getByRole("button", { name: /^等待中，/ }));
    expect(container.textContent).toContain(tailMark);
    expect(container.textContent).toContain("📎 2 个附件");

    // 再点收起：回到截断摘要
    fireEvent.click(screen.getByRole("button", { name: /^等待中，收起/ }));
    expect(container.textContent).not.toContain(tailMark);
  });

  it("附件数显示（D-004）：有附件显示「📎 N」，无附件不显示", () => {
    render(
      <MessageQueueBar
        entries={[
          makeEntry({
            id: "mq-att",
            prompt: "带附件",
            attachmentIds: ["att-1", "att-2", "att-3"],
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("📎 3")).toBeTruthy();

    cleanup();
    render(
      <MessageQueueBar
        entries={[makeEntry({ id: "mq-plain", prompt: "无附件" })]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByText(/📎/)).toBeNull();
  });
});
