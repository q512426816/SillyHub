/**
 * ScheduledMessagesBar 单测（2026-09-07-session-pin-rename-scheduled-send
 * task-09 / FR-04 / D-001@v1）。
 *
 * 依据：
 *   - components/daemon/scheduled-messages-bar.tsx（task-08 实现：局部
 *     QueryClientProvider 自建 client，render 无需外层 Provider）；
 *   - tasks/task-09.md acceptance：条目渲染（派发时间 + 摘要）/ 四态 tag
 *     （pending/dispatched/cancelled/failed）/ 仅 pending 取消且点击触发
 *     DELETE 回调 / 空态 null；
 *   - .sillyspec/docs/frontend/scan/CONVENTIONS.md 代码风格第 7 条
 *     （Vitest jsdom + @testing-library/react，测试标题中文）。
 *
 * mock 策略（照 session-list-panel.test.tsx / use-message-queue.test.ts 先例）：
 *   - @/lib/daemon：listScheduledMessages / cancelScheduledMessage 两 client 桩；
 *   - @/lib/errors：useNotify → spy（测试环境无 <AntApp> 包裹，不起 message DOM）；
 *   - @/lib/api 保留真实（ApiError instanceof 用）。
 *
 * Modal.confirm 交互照 session-list-panel.test.tsx 会话删除先例（危险按钮类
 * .ant-modal-confirm-btns .ant-btn-primary 锚定 ok）；Tooltip 悬停经
 * fireEvent.mouseEnter + waitFor（antd 默认 mouseEnterDelay 0.1s，全局
 * waitFor 5s 足够收敛）。
 *
 * 断言口径（constraints）：语义查询（aria-label/文案）+ mock 调用参数，
 * 不断言 warning/success 等颜色语义类（双主题铁律——antd Tag 预设色经
 * ConfigProvider token 取色，类名非稳定契约）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ScheduledMessagesBar } from "@/components/daemon/scheduled-messages-bar";
import type { ScheduledMessageRead } from "@/lib/daemon";

const mocks = vi.hoisted(() => ({
  listScheduledMessages: vi.fn(),
  cancelScheduledMessage: vi.fn(),
}));

vi.mock("@/lib/daemon", () => ({
  listScheduledMessages: (...args: unknown[]) =>
    mocks.listScheduledMessages(...args),
  cancelScheduledMessage: (...args: unknown[]) =>
    mocks.cancelScheduledMessage(...args),
}));

// useNotify spy（成功/失败 toast 可断言；errMessage 保真用真实现）。
const notifyMocks = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { errMessage: actual.errMessage, useNotify: () => notifyMocks };
});

// ── 固件 ─────────────────────────────────────────────────────────────────

/**
 * 本地时间固件 dispatch_at：组件按本地时区格式化「YYYY-MM-DD HH:mm」，
 * 用本地 Date 分量构造保证任意时区下断言值恒定。
 */
function localISO(y: number, mo: number, d: number, h: number, mi: number) {
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

function makeScheduled(
  overrides: Partial<ScheduledMessageRead> = {},
): ScheduledMessageRead {
  return {
    id: "sm-1",
    agent_session_id: "sess-1",
    prompt: "提醒我复盘本周变更",
    dispatch_at: localISO(2026, 9, 8, 14, 30),
    status: "pending",
    attachment_ids: null,
    agent_profile_id: null,
    llm_provider_id: null,
    error_code: null,
    error_message: null,
    created_at: "2026-09-07T10:00:00Z",
    dispatched_at: null,
    cancelled_at: null,
    ...overrides,
  } as ScheduledMessageRead;
}

/** 当前 Modal.confirm 弹层（portal 到 body；残留多枚时取末位——最新追加）。 */
function findConfirmOk() {
  return waitFor(() => {
    const btns = document.querySelectorAll(
      ".ant-modal-confirm-btns .ant-btn-primary",
    );
    const btn = btns[btns.length - 1] as HTMLElement | undefined;
    if (!btn) throw new Error("confirm ok button not found");
    return btn;
  });
}

beforeEach(() => {
  mocks.listScheduledMessages.mockReset().mockResolvedValue([]);
  mocks.cancelScheduledMessage.mockReset().mockResolvedValue(undefined);
  notifyMocks.success.mockClear();
  notifyMocks.error.mockClear();
});

afterEach(() => {
  cleanup();
});

// ── 空态与 idle 门控 ──────────────────────────────────────────────────────

describe("ScheduledMessagesBar 空态与 idle 门控", () => {
  it("空列表渲染 null（零布局变化验收项）", async () => {
    mocks.listScheduledMessages.mockResolvedValue([]);
    const { container } = render(<ScheduledMessagesBar sessionId="sess-1" />);
    // 等数据到位（初始为 undefined → [] 收敛后）整条仍不占位。
    await waitFor(() =>
      expect(mocks.listScheduledMessages).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByText(/定时消息（/)).toBeNull();
  });

  it("sessionId 空串（预会话 idle 态）→ 整条不渲染且零请求", async () => {
    const { container } = render(<ScheduledMessagesBar sessionId="" />);
    expect(container.firstChild).toBeNull();
    await waitFor(() =>
      expect(mocks.listScheduledMessages).not.toHaveBeenCalled(),
    );
  });
});

// ── 条目渲染与四态 tag（FR-04 / D-001@v1） ────────────────────────────────

describe("ScheduledMessagesBar 条目渲染与四态 tag", () => {
  it("条目渲染：本地时间（分钟级）+ prompt 摘要 + 计数标签", async () => {
    mocks.listScheduledMessages.mockResolvedValue([
      makeScheduled({ id: "sm-1", prompt: "第一条提醒" }),
      makeScheduled({ id: "sm-2", prompt: "第二条提醒", status: "dispatched" }),
    ]);
    render(<ScheduledMessagesBar sessionId="sess-1" />);

    expect(await screen.findByText("定时消息（2）")).toBeInTheDocument();
    // 派发时间：ISO UTC → 本地「YYYY-MM-DD HH:mm」。
    expect(screen.getAllByText("2026-09-08 14:30")).toHaveLength(2);
    expect(screen.getByText("第一条提醒")).toBeInTheDocument();
    expect(screen.getByText("第二条提醒")).toBeInTheDocument();
    expect(mocks.listScheduledMessages).toHaveBeenCalledWith("sess-1");
  });

  it("长 prompt 40 字截断（title 悬停全文，与 MessageQueueBar 同口径）", async () => {
    const head = "前".repeat(40);
    const tailMark = "尾部唯一标记XYZ";
    mocks.listScheduledMessages.mockResolvedValue([
      makeScheduled({ prompt: `${head}${tailMark}` }),
    ]);
    const { container } = render(<ScheduledMessagesBar sessionId="sess-1" />);

    await screen.findByText(/定时消息（1）/);
    // 折叠态：40 字摘要 + 省略号；完整尾部不可见，title 属性带全文。
    expect(container.textContent).toContain(`${head}…`);
    expect(container.textContent).not.toContain(tailMark);
    expect(screen.getByTitle(`${head}${tailMark}`)).toBeInTheDocument();
  });

  it("四态 tag 文案：pending 待发送 / dispatched 已发送 / cancelled 已取消 / failed 失败；仅 pending 有取消按钮", async () => {
    mocks.listScheduledMessages.mockResolvedValue([
      makeScheduled({ id: "sm-p", status: "pending" }),
      makeScheduled({ id: "sm-d", status: "dispatched" }),
      makeScheduled({ id: "sm-c", status: "cancelled" }),
      makeScheduled({
        id: "sm-f",
        status: "failed",
        error_code: "DISPATCH_TIMEOUT",
        error_message: "daemon 离线",
      }),
    ]);
    render(<ScheduledMessagesBar sessionId="sess-1" />);

    await screen.findByText(/定时消息（4）/);
    expect(screen.getByText("待发送")).toBeInTheDocument();
    expect(screen.getByText("已发送")).toBeInTheDocument();
    expect(screen.getByText("已取消")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    // 仅 pending 可取消（后端非 pending 409 双保险）。
    expect(screen.getAllByLabelText("取消该定时消息")).toHaveLength(1);
  });

  it("failed 悬停 Tooltip：error_message + error_code（审计留档可见）", async () => {
    mocks.listScheduledMessages.mockResolvedValue([
      makeScheduled({
        status: "failed",
        error_code: "DISPATCH_TIMEOUT",
        error_message: "daemon 离线",
      }),
    ]);
    render(<ScheduledMessagesBar sessionId="sess-1" />);

    // 悬停失败 tag（antd Tooltip mouseEnterDelay 0.1s → waitFor 收敛）。
    fireEvent.mouseEnter(await screen.findByText("失败"));
    await waitFor(() => {
      expect(document.body.textContent).toContain(
        "派发失败：daemon 离线（DISPATCH_TIMEOUT）",
      );
    });
  });
});

// ── 取消流（Modal.confirm 防误触 → DELETE → 失效重拉） ────────────────────

describe("ScheduledMessagesBar 取消流", () => {
  it("点取消 → Modal.confirm；确认 → cancelScheduledMessage(sessionId, id) + 成功 toast + 失效重拉", async () => {
    mocks.listScheduledMessages.mockResolvedValue([
      makeScheduled({ id: "sm-1", prompt: "第一条提醒" }),
      // 第二条 dispatched：终态无取消按钮，取消入口唯一可锚定。
      makeScheduled({ id: "sm-2", prompt: "第二条提醒", status: "dispatched" }),
    ]);
    render(<ScheduledMessagesBar sessionId="sess-1" />);
    expect(await screen.findByText(/定时消息（2）/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("取消该定时消息"));
    // 确认弹层：防误触文案带派发时间与摘要。
    const confirmRoot = await waitFor(() => {
      const roots = document.querySelectorAll(".ant-modal-confirm");
      const el = roots[roots.length - 1] as HTMLElement | undefined;
      if (!el) throw new Error("confirm not open");
      return el;
    });
    expect(confirmRoot.textContent).toContain("2026-09-08 14:30");
    expect(confirmRoot.textContent).toContain("第一条提醒");

    fireEvent.click(await findConfirmOk());
    await waitFor(() =>
      expect(mocks.cancelScheduledMessage).toHaveBeenCalledWith("sess-1", "sm-1"),
    );
    await waitFor(() =>
      expect(notifyMocks.success).toHaveBeenCalledWith("已取消定时消息"),
    );
    // 无论成败失效重拉（创建/取消后以服务端为准收敛，不等 30s 轮询）。
    await waitFor(() =>
      expect(mocks.listScheduledMessages.mock.calls.filter(
        (c) => c[0] === "sess-1",
      ).length).toBeGreaterThanOrEqual(2),
    );
  });

  it("确认弹层点「保留」→ DELETE 零调用（误点保护）", async () => {
    mocks.listScheduledMessages.mockResolvedValue([
      makeScheduled({ id: "sm-1" }),
    ]);
    render(<ScheduledMessagesBar sessionId="sess-1" />);
    expect(await screen.findByText(/定时消息（1）/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("取消该定时消息"));
    await waitFor(() => {
      const roots = document.querySelectorAll(".ant-modal-confirm");
      if (!roots.length) throw new Error("confirm not open");
    });
    // 「保留」为非主按钮（cancelText；antd 两字中文可访问名自动插空格）。
    const roots = document.querySelectorAll(".ant-modal-confirm");
    const lastRoot = roots[roots.length - 1] as HTMLElement;
    const keepBtn = [...lastRoot.querySelectorAll("button")].find(
      (b) => /保\s*留/.test(b.textContent ?? ""),
    );
    if (!keepBtn) throw new Error("keep button not found");
    fireEvent.click(keepBtn);
    await waitFor(() =>
      expect(document.querySelector(".ant-modal-confirm")).toBeNull(),
    );
    expect(mocks.cancelScheduledMessage).not.toHaveBeenCalled();
  });
});

// ── 2026-09-12-chat-turn-auto-recovery / FR-5.2：自动续跑徽标 + 数据上提回调 ──

describe("ScheduledMessagesBar 自动续跑徽标与 onEntriesChange（FR-5.0/5.2）", () => {
  it("origin=auto_resume:* 条目渲染「自动续跑」徽标；普通条目不渲染", async () => {
    mocks.listScheduledMessages.mockResolvedValue([
      makeScheduled({
        id: "sm-ar",
        prompt: "[系统续跑] 上游额度已重置…",
        origin: "auto_resume:11111111-1111-1111-1111-111111111111",
      }),
      makeScheduled({ id: "sm-user", prompt: "普通用户预约" }),
    ]);
    render(<ScheduledMessagesBar sessionId="sess-1" />);

    expect(await screen.findByText("定时消息（2）")).toBeInTheDocument();
    expect(screen.getByText("自动续跑")).toBeInTheDocument();
    // 普通条目无徽标（全文仅一处「自动续跑」）。
    expect(screen.getAllByText("自动续跑")).toHaveLength(1);
    expect(screen.getByText("普通用户预约")).toBeInTheDocument();
  });

  it("onEntriesChange：列表收敛即回传父层（FR-5.0 数据上提）", async () => {
    const entries = [makeScheduled({ id: "sm-x" })];
    mocks.listScheduledMessages.mockResolvedValue(entries);
    const onEntriesChange = vi.fn();
    render(
      <ScheduledMessagesBar sessionId="sess-1" onEntriesChange={onEntriesChange} />,
    );

    await screen.findByText(/定时消息（1）/);
    await waitFor(() => expect(onEntriesChange).toHaveBeenCalled());
    expect(onEntriesChange).toHaveBeenLastCalledWith(entries);
  });

  it("onEntriesChange 内容不变不重复回传（防引用抖动渲染循环）", async () => {
    mocks.listScheduledMessages.mockResolvedValue([makeScheduled({ id: "sm-y" })]);
    const onEntriesChange = vi.fn();
    const { rerender } = render(
      <ScheduledMessagesBar sessionId="sess-1" onEntriesChange={onEntriesChange} />,
    );
    await screen.findByText(/定时消息（1）/);
    // 两次合法内容变化：初挂空表（prev=null 必通知）→ 数据到达；此后收敛。
    await waitFor(() => expect(onEntriesChange).toHaveBeenCalledTimes(2));
    // 父层重渲（同 props 引用）——内容签名相同不再回传。
    rerender(
      <ScheduledMessagesBar sessionId="sess-1" onEntriesChange={onEntriesChange} />,
    );
    // 再等一拍仍为 2（引用抖动不触发第三回传）。
    await new Promise((r) => setTimeout(r, 50));
    expect(onEntriesChange).toHaveBeenCalledTimes(2);
  });
});
